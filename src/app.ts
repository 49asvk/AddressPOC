import SceneView from "@arcgis/core/views/SceneView";
import MapView from "@arcgis/core/views/MapView";
import Map from "@arcgis/core/Map";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import MapImageLayer from "@arcgis/core/layers/MapImageLayer";
import type Sublayer from "@arcgis/core/layers/support/Sublayer";
import SceneLayer from "@arcgis/core/layers/SceneLayer";
import FeatureFilter from "@arcgis/core/layers/support/FeatureFilter";
import Graphic from "@arcgis/core/Graphic";
import Circle from "@arcgis/core/geometry/Circle";
import Polygon from "@arcgis/core/geometry/Polygon";
import Point from "@arcgis/core/geometry/Point";
import CIMSymbol from "@arcgis/core/symbols/CIMSymbol";
import PictureMarkerSymbol from "@arcgis/core/symbols/PictureMarkerSymbol";
import * as symbolUtils from "@arcgis/core/symbols/support/symbolUtils";
import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";
import * as colorSchemes from "@arcgis/core/smartMapping/symbology/color";
import * as colorRendererCreator from "@arcgis/core/smartMapping/renderers/color";
import BasemapGallery from "@arcgis/core/widgets/BasemapGallery";
import LocalBasemapsSource from "@arcgis/core/widgets/BasemapGallery/support/LocalBasemapsSource";
import Basemap from "@arcgis/core/Basemap";
import Fullscreen from "@arcgis/core/widgets/Fullscreen";
import Measurement from "@arcgis/core/widgets/Measurement";
import Home from "@arcgis/core/widgets/Home";
import Expand from "@arcgis/core/widgets/Expand";
import Legend from "@arcgis/core/widgets/Legend";
import { enrichPoint } from "./services/geoenrichment";
import { sampleElevation } from "./services/elevation";
import { fetchPoiCategories, queryNearbyPois, queryPoisInGeometry, type PoiResult } from "./services/poi";
import { fetchLayerExtent } from "./services/layerExtent";
import { fetchKpnStoreByName, type KpnStorePoint } from "./services/kpnStores";
import { solveServiceAreaCatchment } from "./services/serviceArea";
import type { Catchment } from "./services/catchment";
import { ENRICHMENT_COLLECTIONS } from "./data/enrichmentVariables";
import { POC_LOCATIONS, type PocLocation } from "./data/locations";

// --- POI category icons (Calcite icon glyphs) ----------------------------
// Raw SVG source for a handful of @esri/calcite-ui-icons glyphs, imported
// as plain text via Vite's `?raw` suffix so the glyph <path> data can be
// re-embedded (recolored) inside the custom marker badges built below.
// IMPORTANT, checked directly against the full installed Calcite icon
// catalog: there is no dedicated icon anywhere in Calcite's icon set for
// restaurants/dining, places of worship, clothing, or footwear -- it's
// built for GIS-application chrome (data, analysis, layers), not
// real-world amenity types. Those categories fall back to "pin-tear" (a
// plain map-pin glyph) below rather than a mismatched substitute.
import runningIconSvg from "@esri/calcite-ui-icons/icons/running-24.svg?raw";
import homeIconSvg from "@esri/calcite-ui-icons/icons/home-24.svg?raw";
import shoppingCartIconSvg from "@esri/calcite-ui-icons/icons/shopping-cart-24.svg?raw";
import marketplaceIconSvg from "@esri/calcite-ui-icons/icons/marketplace-24.svg?raw";
import medicalIconSvg from "@esri/calcite-ui-icons/icons/medical-24.svg?raw";
import educationIconSvg from "@esri/calcite-ui-icons/icons/education-24.svg?raw";
import moneyIconSvg from "@esri/calcite-ui-icons/icons/money-24.svg?raw";
import governmentBuildingIconSvg from "@esri/calcite-ui-icons/icons/government-building-24.svg?raw";
import treeIconSvg from "@esri/calcite-ui-icons/icons/tree-24.svg?raw";
import busIconSvg from "@esri/calcite-ui-icons/icons/bus-24.svg?raw";
import carIconSvg from "@esri/calcite-ui-icons/icons/car-24.svg?raw";
import bookIconSvg from "@esri/calcite-ui-icons/icons/book-24.svg?raw";
import pinTearIconSvg from "@esri/calcite-ui-icons/icons/pin-tear-24.svg?raw";

// --- Live traffic (ArcGIS Living Atlas World Traffic service) -----------
// Scoped to India only by listing just sublayer 32 ("India") at the top
// level -- every other country/region group in the world service is left
// out entirely, so nothing outside India ever renders. Within India, only
// the "Traffic" leaf (id 35) is turned on -- that's the one the source
// service itself defaults to visible, showing current road-speed
// conditions; "Live Traffic" (id 34) and both "(Legacy)" leaves are kept
// in the sublayer tree but switched off. Sublayer 33 ("India Traffic")
// also carries its own minScale (~1:10,000,000) from the service, so it
// never draws at country/world zoom -- combined with this app always
// framing the map to the local 5-min/10-min catchment, that's what keeps
// traffic restricted to just the enriched location's area, with no extra
// clipping geometry needed.
const TRAFFIC_SERVICE_URL = "https://utility.arcgis.com/usrsvcs/servers/148a7ab55f5543159bb3d33ba97eb7ec/rest/services/World/Traffic/MapServer";

// Global photoreal/mesh 3D buildings layer for the scene-view card, so the
// small 3D map actually shows real building massing instead of a flat
// imagery basemap with a marker floating over it.
const BUILDINGS_3D_URL = "https://basemaps3d.arcgis.com/arcgis/rest/services/Esri3D_Buildings_v1/SceneServer";

// By default every ArcGIS view zooms on any mouse-wheel scroll, which
// fights with just scrolling the page past an embedded map -- the wheel
// gets caught by whichever map happens to be under the cursor instead of
// scrolling the page. There's no built-in "only zoom with a modifier key"
// setting on view.navigation, so this is done by hand: a capture-phase
// listener on the view's own container div, added here so it always sits
// above (runs before) the view's own internal wheel handling regardless
// of call order, since capture-phase events visit ancestors before the
// descendant elements a view attaches its own listeners to. When Ctrl
// isn't held, stopping propagation here keeps the event from ever
// reaching the view, so it neither zooms nor calls preventDefault, and
// the browser's normal page-scroll behavior proceeds untouched. When
// Ctrl is held, nothing is done and the view zooms exactly as it always
// did (including its own preventDefault, which already stops the
// browser's separate ctrl+wheel page-zoom).
function restrictWheelZoomToCtrl(container: HTMLDivElement) {
  container.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey) event.stopPropagation();
    },
    { capture: true }
  );
}

// Point sublayers (incidents) get the service's default popup explicitly
// built and assigned below -- Sublayer, unlike FeatureLayer, doesn't
// auto-generate one just from popupEnabled defaulting true, so without
// this clicking an incident wouldn't show anything. Road closures (the
// polyline sublayers) get the same treatment for consistency.
const ASIA_PACIFIC_INCIDENT_SUBLAYER_IDS = [46, 47, 48, 61, 62, 63];

async function createTrafficLayer(): Promise<MapImageLayer | null> {
  try {
    const layer = new MapImageLayer({
      url: TRAFFIC_SERVICE_URL,
      title: "Live traffic (India)",
      sublayers: [
        {
          id: 32, // India (group)
          visible: true,
          sublayers: [
            {
              id: 33, // India Traffic (group)
              visible: true,
              sublayers: [
                { id: 35, visible: true }, // Traffic -- current conditions, on by default upstream
                { id: 34, visible: false }, // Live Traffic
                { id: 134, visible: false }, // Live Traffic (Legacy)
                { id: 135, visible: false }, // Traffic (Legacy)
              ],
            },
          ],
        },
        {
          id: 40, // Asia Pacific (group)
          visible: true,
          sublayers: [
            {
              // Asia Pacific Traffic Incidents (group) -- toggled as one
              // unit from the traffic map's legend panel below. Only this
              // group (id 45) is included, not its sibling id 41 (Asia
              // Pacific traffic flow speed) -- the ask was incident data.
              id: 45,
              visible: true,
              sublayers: [
                // Overview incidents/closures only draw out past a very
                // small (country-level) scale -- left off, matching the
                // service's own defaultVisibility, since this app is
                // always framed to a local catchment, never that zoomed out.
                { id: 46, visible: false }, // Traffic Incidents Overview
                { id: 61, visible: false }, // Road Closures Overview
                { id: 47, visible: true }, // Traffic Incidents Intermediate
                { id: 62, visible: true }, // Road Closures Intermediate
                { id: 48, visible: true }, // Traffic Incidents Detailed
                { id: 63, visible: true }, // Road Closures Detailed
              ],
            },
          ],
        },
      ],
    } as any);
    await layer.load();

    for (const id of ASIA_PACIFIC_INCIDENT_SUBLAYER_IDS) {
      const sublayer = layer.findSublayerById(id);
      if (!sublayer) continue;
      try {
        await sublayer.load();
        sublayer.popupTemplate = sublayer.createPopupTemplate();
      } catch (err) {
        console.error(`Failed to build the default popup for traffic sublayer ${id}:`, err);
      }
    }

    return layer;
  } catch (err) {
    console.error("Traffic layer failed to load -- check TRAFFIC_SERVICE_URL:", err);
    return null;
  }
}

// --- KPN store marker (custom CIM teardrop pin) --------------------------
// Replaces the plain red dot for the selected location with a pin matching
// the KPN_Fresh_Stores hosted layer's point for that site: yellow-green
// teardrop body, semi-transparent black outline, white dot nested near the
// top. Built from two CIMVectorMarker layers (pin body, then dot on top)
// rather than a plain simple-marker, since neither shape nor the nested
// dot can be expressed with SimpleMarkerSymbol alone.

// Generates a closed polygon ring approximating a circle, used for both
// the dot and (via pinRing below) the rounded top of the pin.
function circlePath(cx: number, cy: number, r: number, segments = 32): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  return pts;
}

// Teardrop pin outline: a rounded cap (the top arc of a circle) tapering
// down to a point via the two tangent lines from that point back to the
// circle -- the classic "map pin" silhouette, computed exactly rather than
// eyeballed so the taper lines meet the circle smoothly with no kink.
function pinRing(cx: number, cy: number, r: number, tipY: number, segments = 48): number[][] {
  const d = cy - tipY;
  const halfAngle = Math.acos(r / d);
  const baseAngle = -Math.PI / 2; // straight down, from center to tip
  const startAngle = baseAngle + halfAngle;
  const endAngle = baseAngle - halfAngle + Math.PI * 2; // long way round, through the top
  const pts: number[][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = startAngle + ((endAngle - startAngle) * i) / segments;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  pts.push([cx, tipY]);
  pts.push(pts[0].slice());
  return pts;
}

const KPN_PIN_FRAME = { xmin: -8, ymin: -12, xmax: 8, ymax: 13 };
const KPN_PIN_RING = pinRing(0, 6, 6.5, -11);
const KPN_DOT_RING = circlePath(0, 7.5, 2.6, 24);

function kpnStoreCimSymbol(): CIMSymbol {
  return new CIMSymbol({
    data: {
      type: "CIMSymbolReference",
      symbol: {
        type: "CIMPointSymbol",
        // CIM stacks symbolLayers with the FIRST entry on TOP (opposite of
        // CSS/SVG's last-child-on-top rule) -- the dot must be listed
        // before the pin body, or the opaque pin paints over it and it
        // never appears at all, which is exactly what was happening.
        symbolLayers: [
          {
            // Dark green dot (#055F2A) nested near the top of the pin.
            type: "CIMVectorMarker",
            enable: true,
            size: 34,
            frame: KPN_PIN_FRAME,
            markerGraphics: [
              {
                type: "CIMMarkerGraphic",
                geometry: { rings: [KPN_DOT_RING] },
                symbol: {
                  type: "CIMPolygonSymbol",
                  symbolLayers: [{ type: "CIMSolidFill", enable: true, color: [5, 95, 42, 255] }],
                },
              },
            ],
          },
          {
            // Pin body -- bright yellow fill (#FFEF03), semi-transparent
            // black stroke.
            type: "CIMVectorMarker",
            enable: true,
            size: 34,
            frame: KPN_PIN_FRAME,
            markerGraphics: [
              {
                type: "CIMMarkerGraphic",
                geometry: { rings: [KPN_PIN_RING] },
                symbol: {
                  type: "CIMPolygonSymbol",
                  symbolLayers: [
                    { type: "CIMSolidStroke", enable: true, color: [0, 0, 0, 140], width: 1 },
                    { type: "CIMSolidFill", enable: true, color: [255, 239, 3, 255] },
                  ],
                },
              },
            ],
          },
        ],
      },
    } as any,
  });
}

function kpnStoreGraphic(x: number, y: number, attributes?: Record<string, any>, popupTemplate?: __esri.PopupTemplateProperties) {
  return new Graphic({
    geometry: { type: "point", x, y, spatialReference: { wkid: 4326 } } as any,
    symbol: kpnStoreCimSymbol(),
    attributes,
    popupTemplate: popupTemplate as any,
  });
}

// Point-in-catchment test used by the POI count table -- checks a raw
// POI point against a walk/drive Catchment directly, independent of
// whatever geometry the POI was actually fetched against (the suitability
// extent, now -- see queryPoisInGeometry).
function catchmentContains(catchment: Catchment, centerX: number, centerY: number, px: number, py: number): boolean {
  if (catchment.kind === "ring") {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(py - centerY);
    const dLon = toRad(px - centerX);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(centerY)) * Math.cos(toRad(py)) * Math.sin(dLon / 2) ** 2;
    const dist = 2 * R * Math.asin(Math.sqrt(a));
    return dist <= catchment.km;
  }
  const polygon = new Polygon({ rings: catchment.rings, spatialReference: { wkid: 4326 } });
  const point = new Point({ x: px, y: py, spatialReference: { wkid: 4326 } });
  return geometryEngine.contains(polygon, point);
}

let currentSceneView: SceneView | null = null;
// Two big maps now (the main catchment/POI map and the traffic map), so
// this tracks all of them rather than a single view.
let bigMapViews: MapView[] = [];
let miniViews: MapView[] = [];
let poiCategoryList: string[] = [];

function destroyAllViews() {
  currentSceneView?.destroy();
  currentSceneView = null;
  bigMapViews.forEach((v) => v.destroy());
  bigMapViews = [];
  miniViews.forEach((v) => v.destroy());
  miniViews = [];
}

// --- Category colors -------------------------------------------------

// Used by the consumer-styles donut only (buildConsumerStylesDonut below
// indexes into this directly) -- that chart never has more than 10
// segments, so a small palette is fine there.
const DONUT_COLORS = ["#0f6e56", "#5dcaa5", "#378add", "#b6771a", "#d85a30", "#6b4fbb", "#99355a", "#2f7d32", "#26215c", "#7f77dd"];

// A separate, wider palette for POI categories -- the real POI layer's
// main-category list runs well past 10 entries, and hashing the category
// name into a 10-color palette reliably produces same-color collisions
// once the category count exceeds it (exactly what happened: "Leisure"/
// "Workshop" landed on the same hash bucket, and separately so did
// "Restaurant"/"Stadium"). categoryColor() below assigns by each
// category's position in the actual fetched list instead of a hash, so
// every category gets its own color as long as the layer has no more
// main categories than there are colors here.
const POI_CATEGORY_COLORS = [
  "#0f6e56", "#5dcaa5", "#378add", "#b6771a", "#d85a30",
  "#6b4fbb", "#99355a", "#2f7d32", "#26215c", "#7f77dd",
  "#c0392b", "#16a085", "#8e44ad", "#e67e22", "#2980b9",
  "#27ae60", "#c2185b", "#00838f", "#f39c12", "#5d4037",
  "#455a64", "#7cb342", "#ad1457", "#3949ab", "#00695c",
  "#bf360c", "#4527a0", "#558b2f", "#ef6c00", "#01579b",
];

function categoryColor(category: string): string {
  // Index within poiCategoryList (the actual list fetched from the
  // layer) -- deterministic and collision-free up to
  // POI_CATEGORY_COLORS.length categories, instead of hoping a hash
  // lands in different buckets by luck.
  const index = poiCategoryList.indexOf(category);
  if (index !== -1) return POI_CATEGORY_COLORS[index % POI_CATEGORY_COLORS.length];
  // Fallback for anything called before fetchPoiCategories() has
  // resolved (so poiCategoryList is still empty) -- keeps this from ever
  // throwing or returning undefined; once the list is populated,
  // everything re-renders through the index-based path above anyway.
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  return POI_CATEGORY_COLORS[hash % POI_CATEGORY_COLORS.length];
}

// Some main categories (derived by splitting each POI's description on
// the first hyphen -- see mainCategoryOf in services/poi.ts) collapse a
// single, more specific sub-category down to a generic-sounding label.
// "Market" is one of these: every POI under it is actually
// "Market-Supermarkets & Hypermarkets", so showing just "Market" hid
// real information instead of usefully grouping several sub-types the
// way "Restaurant" does. This only changes what's *displayed* -- the
// underlying "Market" string is still what's used for the query filter
// (LIKE 'Market-%'), poiByCategory's keys, and the color/icon lookups
// above, so nothing else needs to change.
const CATEGORY_DISPLAY_OVERRIDES: Record<string, string> = {
  Market: "Market-Supermarkets & Hypermarkets",
};

function categoryDisplayName(category: string): string {
  return CATEGORY_DISPLAY_OVERRIDES[category] ?? category;
}

// Keyword groups matched against the main-category names derived from
// the new POI layer (see services/poi.ts) -- any category whose name
// contains one of these substrings starts pre-checked in the "Nearby
// places" picker. Everything else still shows up, just unchecked, so
// nothing from the source layer is hidden -- it's only a sensible
// default selection. Updated for the new layer's main-category names
// (e.g. "Sports Center", not "Gym"; there's no "Park"/"Garden" category
// in this layer at all, so that old default group is dropped).
const POI_DEFAULT_KEYWORD_GROUPS: string[][] = [
  ["restaurant"], // Restaurants and QSRs
  ["sports center", "sports centre"], // Gyms / fitness centers
  ["place of worship"], // Places of worship
  ["residential accommodation"], // Residential accommodations
  ["market"], // Markets
  ["department store"], // Departmental stores
  ["shop", "shopping center", "shopping centre"], // Retail shops across multiple categories
];

function isDefaultPoiCategory(category: string): boolean {
  const lower = category.toLowerCase();
  return POI_DEFAULT_KEYWORD_GROUPS.some((group) => group.some((k) => lower.includes(k)));
}

// --- Category icons ---------------------------------------------------
// Keyword-matched the same way as POI_DEFAULT_KEYWORD_GROUPS above, but
// picking a Calcite icon glyph instead of a default-checked state. Used
// both for the map markers (baked into a colored badge, see
// poiMarkerDataUri) and the legend rows (as a plain <calcite-icon>), so
// the same glyph always represents the same category everywhere.
interface PoiIconInfo {
  /** Calcite icon name, e.g. "running" -- passed straight to <calcite-icon icon="..."> in the legend. */
  calciteIcon: string;
  /** Raw SVG source of that icon (24px viewBox), for building the map-marker badge. */
  svg: string;
}

const POI_FALLBACK_ICON: PoiIconInfo = { calciteIcon: "pin-tear", svg: pinTearIconSvg };

const POI_ICON_KEYWORD_GROUPS: { keywords: string[]; icon: PoiIconInfo }[] = [
  // No matching Calcite icon exists for dining or worship -- see the note
  // above the icon imports. Both intentionally fall through to the
  // generic "pin-tear" fallback at the bottom of categoryIcon() rather
  // than being listed here with a mismatched glyph.
  { keywords: ["sports center", "sports centre", "gym", "fitness"], icon: { calciteIcon: "running", svg: runningIconSvg } },
  { keywords: ["residential accommodation", "hotel", "lodging", "apartment"], icon: { calciteIcon: "home", svg: homeIconSvg } },
  { keywords: ["market", "grocery", "supermarket"], icon: { calciteIcon: "marketplace", svg: marketplaceIconSvg } },
  { keywords: ["department store", "shop", "shopping center", "shopping centre", "retail", "clothing", "footwear", "apparel"], icon: { calciteIcon: "shopping-cart", svg: shoppingCartIconSvg } },
  { keywords: ["hospital", "clinic", "pharmacy", "medical", "health"], icon: { calciteIcon: "medical", svg: medicalIconSvg } },
  { keywords: ["school", "college", "university", "education"], icon: { calciteIcon: "education", svg: educationIconSvg } },
  { keywords: ["bank", "atm", "finance"], icon: { calciteIcon: "money", svg: moneyIconSvg } },
  { keywords: ["government", "civic", "municipal", "post office"], icon: { calciteIcon: "government-building", svg: governmentBuildingIconSvg } },
  { keywords: ["park", "garden"], icon: { calciteIcon: "tree", svg: treeIconSvg } },
  { keywords: ["bus", "transport", "transit"], icon: { calciteIcon: "bus", svg: busIconSvg } },
  { keywords: ["fuel", "gas station", "parking", "automotive"], icon: { calciteIcon: "car", svg: carIconSvg } },
  { keywords: ["library", "book store", "bookstore"], icon: { calciteIcon: "book", svg: bookIconSvg } },
];

function categoryIcon(category: string): PoiIconInfo {
  const lower = category.toLowerCase();
  const match = POI_ICON_KEYWORD_GROUPS.find((group) => group.keywords.some((k) => lower.includes(k)));
  return match?.icon ?? POI_FALLBACK_ICON;
}

// Builds a small colored line-icon for the category -- just the glyph
// itself in the category's color on a transparent background, encoded as
// a data: URI -- used as a PictureMarkerSymbol's url so POI points render
// as recognizable icons on the map. This intentionally goes back to a
// plain outlined/line-style icon rather than a solid filled circular
// badge: with a lot of nearby POIs, overlapping solid discs merge into an
// unreadable blob, while overlapping line icons stay visually distinct
// since only the glyph strokes themselves carry ink, not a full circle.
// Reuses the glyph's own <path> data as-is (stripping Calcite's invisible
// no-op bounding-box path and its own <svg> wrapper), just recolored via
// the wrapping <g>. A plain object rather than the built-in generic Map
// here -- this module already imports the ArcGIS SDK's own `Map` class as
// the default export of "@arcgis/core/Map" (for the scene/2D maps'
// basemap+layers), which shadows the global `Map<K, V>` collection type
// for the rest of this file.
const poiMarkerUriCache: Record<string, string> = {};

function poiMarkerDataUri(category: string): string {
  const color = categoryColor(category);
  const icon = categoryIcon(category);
  const cacheKey = `${color}|${icon.calciteIcon}|line`;
  const cached = poiMarkerUriCache[cacheKey];
  if (cached) return cached;

  const glyphPaths = Array.from(icon.svg.matchAll(/<path[^>]*\/>/g))
    .map((m) => m[0])
    .filter((p) => !p.includes('fill="none"'));

  // A thin white halo (stroke drawn behind the fill, via paint-order)
  // keeps the colored glyph legible over similarly-colored or dark map
  // features, without adding a filled background shape behind it.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
    `<g fill="${color}" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round" paint-order="stroke fill">${glyphPaths.join("")}</g>` +
    `</svg>`;

  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  poiMarkerUriCache[cacheKey] = uri;
  return uri;
}

// Renders the exact same colored line-icon used for a category's map
// marker (poiMarkerDataUri) as an <img>, for use anywhere else a category
// needs to be identified -- the legend, the POI picker, and the POI count
// table. Using the identical data: URI (not a separately styled
// <calcite-icon>) is what guarantees these all look pixel-for-pixel the
// same as the marker on the map.
function poiIconBadgeHtml(category: string, size = 16): string {
  return `<img class="poi-icon-badge" src="${poiMarkerDataUri(category)}" width="${size}" height="${size}" alt="">`;
}

// Icon-badge equivalent of pointGraphic(), used only for POI points --
// the KPN store marker and the plain selected-location dot (pointGraphic
// itself) are untouched. Sized a bit larger than the old filled badge
// (28 vs 22) since a bare line icon has less visual weight than a solid
// disc and needs the extra size to stay as legible on the map.
function poiIconGraphic(
  x: number,
  y: number,
  category: string,
  attributes?: Record<string, any>,
  popupTemplate?: __esri.PopupTemplateProperties
) {
  return new Graphic({
    geometry: { type: "point", x, y, spatialReference: { wkid: 4326 } } as any,
    symbol: new PictureMarkerSymbol({ url: poiMarkerDataUri(category), width: 12, height: 12 }),
    attributes,
    popupTemplate: popupTemplate as any,
  });
}

// --- Pickers --------------------------------------------------------

function buildVariablePanel(): string {
  return `
    <calcite-block heading="Customize data" description="Choose which GeoEnrichment variables to fetch" collapsible open>
      <div class="var-picker-actions">
        <calcite-button appearance="outline" scale="s" id="select-all-vars">Select all</calcite-button>
        <calcite-button appearance="outline" scale="s" id="select-none-vars">Select none</calcite-button>
      </div>
      ${ENRICHMENT_COLLECTIONS.map((c) => `
        <calcite-block heading="${c.label}" collapsible>
          ${c.variables.map((v) => `
            <calcite-label layout="inline" class="var-checkbox-label">
              <calcite-checkbox class="var-checkbox" data-key="${v.sourceCollectionId ?? c.collectionId}.${v.id}" checked></calcite-checkbox>
              ${v.label}
            </calcite-label>
          `).join("")}
        </calcite-block>
      `).join("")}
    </calcite-block>
  `;
}

function getSelectedVariableKeys(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<any>(".var-checkbox"))
    .filter((cb) => cb.checked)
    .map((cb) => cb.dataset.key as string);
}

async function buildPoiPicker(container: HTMLElement) {
  container.innerHTML = `<calcite-loader label="Loading POI categories" active scale="s"></calcite-loader>`;
  const categories = await fetchPoiCategories();
  poiCategoryList = categories;
  if (categories.length === 0) {
    container.innerHTML = `<calcite-notice open kind="warning" scale="s"><div slot="message">No POI categories loaded — check POI_LAYER_URL in services/poi.ts, and confirm the API key has item access to this layer.</div></calcite-notice>`;
    return;
  }
  container.innerHTML = `
    <calcite-block heading="Nearby places" description="Choose which categories to fetch from your uploaded POI layer — each shows up as its own toggleable, color-coded layer on the map" collapsible open>
      <div class="var-picker-actions">
        <calcite-button appearance="outline" scale="s" id="select-all-pois">Select all</calcite-button>
        <calcite-button appearance="outline" scale="s" id="select-none-pois">Select none</calcite-button>
      </div>
      ${categories.map((cat, i) => `
        <calcite-label layout="inline" class="poi-checkbox-label">
          <calcite-checkbox class="poi-checkbox" data-index="${i}" ${isDefaultPoiCategory(cat) ? "checked" : ""}></calcite-checkbox>
          ${poiIconBadgeHtml(cat)}
          ${categoryDisplayName(cat)}
        </calcite-label>
      `).join("")}
    </calcite-block>
  `;

  // Wired here (rather than in renderApp) since this container's markup
  // is replaced by this function, asynchronously, well after renderApp's
  // own querySelectors would have run against the "Loading..." placeholder.
  container.querySelector("#select-all-pois")?.addEventListener("click", () => {
    container.querySelectorAll<any>(".poi-checkbox").forEach((cb) => (cb.checked = true));
  });
  container.querySelector("#select-none-pois")?.addEventListener("click", () => {
    container.querySelectorAll<any>(".poi-checkbox").forEach((cb) => (cb.checked = false));
  });
}

function getSelectedPoiCategories(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<any>(".poi-checkbox"))
    .filter((cb) => cb.checked)
    .map((cb) => poiCategoryList[Number(cb.dataset.index)]);
}

// --- Catchments -------------------------------------------------------
// Fixed to the 10-min walk + 5-min drive service-area pair for every
// location in this PoC -- there's no ring/buffer choice anymore since
// all 5 sites use the same catchment definition.

interface DemographicCatchment {
  label: string;
  catchment: Catchment;
}

interface ResolvedCatchments {
  primary: Catchment;
  primaryLabel: string;
  summaryLabel: string;
  demographics: DemographicCatchment[];
}

async function resolveCatchments(x: number, y: number): Promise<ResolvedCatchments> {
  const [walkResult, driveResult] = await Promise.allSettled([
    solveServiceAreaCatchment(x, y, "Walking Time", 10),
    solveServiceAreaCatchment(x, y, "Driving Time", 5),
  ]);

  let walkCatchment: Catchment;
  if (walkResult.status === "fulfilled" && walkResult.value) {
    walkCatchment = { kind: "polygon", rings: walkResult.value.rings };
  } else {
    console.error("Walk-time service area failed -- falling back to a 1 km ring.", walkResult.status === "rejected" ? walkResult.reason : "no polygon returned");
    walkCatchment = { kind: "ring", km: 1 };
  }

  let driveCatchment: Catchment;
  if (driveResult.status === "fulfilled" && driveResult.value) {
    driveCatchment = { kind: "polygon", rings: driveResult.value.rings };
  } else {
    console.error("Drive-time service area failed -- falling back to a 3 km ring.", driveResult.status === "rejected" ? driveResult.reason : "no polygon returned");
    driveCatchment = { kind: "ring", km: 3 };
  }

  return {
    primary: walkCatchment,
    primaryLabel: "10-min walk-time catchment",
    summaryLabel: "10-min walk + 5-min drive catchments",
    demographics: [
      { label: "10-min walk-time catchment", catchment: walkCatchment },
      { label: "5-min drive-time catchment", catchment: driveCatchment },
    ],
  };
}

// --- App shell --------------------------------------------------------

export function renderApp(root: HTMLElement) {
  root.innerHTML = `
    <div class="app-shell">
      <div id="selection-summary" class="selection-summary" style="display:none">
        <div class="selection-summary__text">
          <span class="selection-summary__label">Location:</span>
          <span id="selection-summary__location">—</span>
        </div>
        <calcite-button id="edit-selection-btn" appearance="outline" scale="s">Edit selections</calcite-button>
      </div>
      <div id="selection-panel">
        <div class="search-bar">
          <calcite-label layout="inline" style="width:420px">
            Location
            <calcite-select id="location-select">
              ${POC_LOCATIONS.map((loc, i) => `<calcite-option value="${loc.id}" ${i === 0 ? "selected" : ""}>${loc.name}</calcite-option>`).join("")}
            </calcite-select>
          </calcite-label>
          <calcite-button id="search-btn">Search</calcite-button>
        </div>
        <div class="catchment-note">Enrichment always uses a fixed 10-minute walk + 5-minute drive service-area catchment for whichever location is selected.</div>
        <div class="var-picker">
          ${buildVariablePanel()}
        </div>
        <div class="poi-picker"></div>
      </div>
      <div id="results"></div>
    </div>
  `;

  const select = root.querySelector("#location-select") as any;
  const button = root.querySelector("#search-btn") as HTMLElement;
  const results = root.querySelector("#results") as HTMLDivElement;
  const selectionPanel = root.querySelector("#selection-panel") as HTMLElement;
  const selectionSummary = root.querySelector("#selection-summary") as HTMLElement;
  const selectionSummaryLocation = root.querySelector("#selection-summary__location") as HTMLElement;
  const editBtn = root.querySelector("#edit-selection-btn") as HTMLElement;

  root.querySelector("#select-all-vars")?.addEventListener("click", () => {
    root.querySelectorAll<any>(".var-checkbox").forEach((cb) => (cb.checked = true));
  });
  root.querySelector("#select-none-vars")?.addEventListener("click", () => {
    root.querySelectorAll<any>(".var-checkbox").forEach((cb) => (cb.checked = false));
  });

  buildPoiPicker(root.querySelector(".poi-picker") as HTMLElement);

  editBtn.addEventListener("click", () => {
    selectionPanel.style.display = "";
    selectionSummary.style.display = "none";
  });

  button.addEventListener("click", async () => {
    const locationId = select.value;
    const location = POC_LOCATIONS.find((l) => l.id === locationId) ?? POC_LOCATIONS[0];
    const variableKeys = getSelectedVariableKeys(root);
    const poiCategories = getSelectedPoiCategories(root);

    await runSearch(location, results, variableKeys, poiCategories);

    // Collapse the selection UI and jump straight to the results once
    // a search has actually run, so the first card is what's in view.
    selectionPanel.style.display = "none";
    selectionSummaryLocation.textContent = location.name;
    selectionSummary.style.display = "";
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// Bumped -- PoiResult now carries a `brand` field the older cached bundles
// don't have, which the new brand-dropdown feature needs.
const CACHE_VERSION = "v14";

async function runSearch(
  location: PocLocation,
  results: HTMLDivElement,
  variableKeys: string[],
  poiCategories: string[]
) {
  const signature = `${[...variableKeys].sort().join(",")}|${[...poiCategories].sort().join(",")}`;
  const cacheKey = `address-poc:${CACHE_VERSION}:${location.id}:${signature}`;
  const cached = sessionStorage.getItem(cacheKey);

  results.innerHTML = `<calcite-loader label="Loading location" active></calcite-loader>`;

  let bundle: any = null;

  if (cached) {
    bundle = JSON.parse(cached);
    if (!bundle?.demographicsSections) {
      console.warn("Cached entry missing expected shape, re-fetching.");
      bundle = null;
    }
  }

  if (!bundle) {
    const [catchments, suitabilityExtent, kpnStorePoint] = await Promise.all([
      resolveCatchments(location.x, location.y),
      location.suitabilityLayerUrl ? fetchLayerExtent(location.suitabilityLayerUrl) : Promise.resolve(null),
      fetchKpnStoreByName(location.name),
    ]);

    if (location.suitabilityLayerUrl && !suitabilityExtent) {
      console.warn("Could not read the suitability layer's extent -- falling back to the 10-min walk catchment for the POI fetch.");
    }

    // POIs are fetched across the whole suitability-analysis layer's
    // extent for this site, not just the 10-min walk catchment, so the
    // picker's counts and the map's POI layers cover the full candidate
    // area. Falls back to the old walk-catchment query when a location
    // has no suitability layer (or its extent couldn't be read).
    const [miscResults, poiSettled, enrichmentSettled] = await Promise.all([
      Promise.allSettled([
        sampleElevation(location.x, location.y),
        sampleElevationRing(location.x, location.y),
      ]),
      Promise.allSettled(
        poiCategories.map((cat) =>
          suitabilityExtent
            ? queryPoisInGeometry(suitabilityExtent, cat)
            : queryNearbyPois(location.x, location.y, cat, catchments.primary)
        )
      ),
      Promise.allSettled(catchments.demographics.map((d) => enrichPoint(location.x, location.y, variableKeys, d.catchment))),
    ]);

    const [elevationResult, ringResult] = miscResults;
    if (elevationResult.status === "rejected") console.error("Elevation failed:", elevationResult.reason);

    enrichmentSettled.forEach((r, i) => {
      if (r.status === "rejected") console.error(`Enrichment failed for "${catchments.demographics[i].label}":`, r.reason);
    });

    const demographicsSections = catchments.demographics.map((d, i) => ({
      label: d.label,
      catchment: d.catchment,
      enrichment: enrichmentSettled[i].status === "fulfilled" ? (enrichmentSettled[i] as PromiseFulfilledResult<any>).value : null,
    }));

    const poiByCategory: Record<string, PoiResult[]> = {};
    poiCategories.forEach((cat, i) => {
      const r = poiSettled[i];
      if (r.status === "fulfilled") poiByCategory[cat] = r.value;
      else {
        console.error(`POI query failed for "${cat}":`, r.reason);
        poiByCategory[cat] = [];
      }
    });

    bundle = {
      locationName: location.name,
      location: { x: location.x, y: location.y },
      suitabilityLayerUrl: location.suitabilityLayerUrl,
      populationLayerUrl: location.populationLayerUrl,
      kpnStorePoint,
      elevation: elevationResult.status === "fulfilled" ? elevationResult.value : null,
      elevationSamples: ringResult.status === "fulfilled" ? ringResult.value : [],
      demographicsSections,
      poiByCategory,
      primaryLabel: catchments.primaryLabel,
      summaryLabel: catchments.summaryLabel,
    };

    sessionStorage.setItem(cacheKey, JSON.stringify(bundle));
  }

  await renderResults(results, bundle);
}

async function sampleElevationRing(x: number, y: number) {
  const offsets: [number, number][] = [[0.0015, 0], [-0.0015, 0], [0, 0.0015], [0, -0.0015]];
  const samples = await Promise.all(offsets.map(([dx, dy]) => sampleElevation(x + dx, y + dy)));
  return samples.filter((v): v is number => v != null);
}

function stdDev(values: number[]) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function formatInt(n: number) {
  return new Intl.NumberFormat().format(Math.round(n));
}

// Exact value, grouped with commas, no "k"/"million"/"bn" abbreviation --
// shows up to 2 decimal places only when the value actually has them.
function formatExact(n: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}

function formatFieldValue(raw: any, unit?: "currency") {
  if (typeof raw !== "number") return raw ?? "—";
  return unit === "currency" ? `₹${formatExact(raw)}` : formatExact(raw);
}

function pointGraphic(
  x: number,
  y: number,
  color = "#d85a30",
  attributes?: Record<string, any>,
  popupTemplate?: __esri.PopupTemplateProperties
) {
  return new Graphic({
    geometry: { type: "point", x, y, spatialReference: { wkid: 4326 } } as any,
    symbol: { type: "simple-marker", color, outline: { color: "#ffffff", width: 1 }, size: 10 } as any,
    attributes,
    popupTemplate: popupTemplate as any,
  });
}

// Shared by catchmentGraphic (drawing the catchment outline) and the
// FeatureFilter spatial clips below (restricting other layers to a
// catchment's shape) -- one place that turns a Catchment into an actual
// geometry, so both uses always agree on what "the catchment" is.
function catchmentGeometry(x: number, y: number, catchment: Catchment): Circle | Polygon {
  if (catchment.kind === "ring") {
    return new Circle({
      center: { x, y, spatialReference: { wkid: 4326 } } as any,
      radius: catchment.km,
      radiusUnit: "kilometers",
    });
  }
  return new Polygon({ rings: catchment.rings, spatialReference: { wkid: 4326 } });
}

function catchmentGraphic(
  x: number,
  y: number,
  catchment: Catchment,
  outlineColor = "#0f6e56",
  fillColor: [number, number, number, number] = [15, 110, 86, 0.15]
) {
  return new Graphic({
    geometry: catchmentGeometry(x, y, catchment),
    symbol: { type: "simple-fill", color: fillColor, outline: { color: outlineColor, width: 1.5 } } as any,
  });
}

// Determines which numeric field the population layer's own published
// renderer already classifies on, so applyGreenPopulationRenderer (below)
// can reapply the same classification with a different color ramp
// without hardcoding a field name that can't be independently verified
// from this sandbox (same category of blocker as the POI Brand Name
// field in services/poi.ts).
function inferColorField(layer: FeatureLayer): string | null {
  const renderer = layer.renderer as any;
  if (!renderer) return null;
  if (typeof renderer.field === "string" && renderer.field) return renderer.field;
  const colorVariable = (renderer.visualVariables as any[] | undefined)?.find(
    (v) => v?.type === "color" && typeof v.field === "string"
  );
  return colorVariable?.field ?? null;
}

// Applies Esri's built-in "Green 5" smart-mapping color ramp to the
// population hex-grid layer. This is also the fix for a style edit made
// on the hosted layer not showing up on the map: FeatureLayer.load() only
// ever reads a layer's own default renderer, and a style change made in
// the ArcGIS Online map viewer's "Styles" pane is usually saved to that
// *web map's* layer entry, not to the hosted layer's own default renderer
// -- so it can look saved there while never actually changing what a
// fresh FeatureLayer(url) picks up. Setting the renderer explicitly here,
// client-side, means this map's colors no longer depend on that at all.
async function applyGreenPopulationRenderer(layer: FeatureLayer, view: MapView) {
  const field = inferColorField(layer);
  if (!field) {
    console.error("Could not determine which field the population layer is classified on -- leaving its published renderer as-is.", layer.url);
    return;
  }
  try {
    const colorScheme = colorSchemes.getSchemeByName({
      name: "Green 5",
      geometryType: (layer.geometryType as any) ?? "polygon",
      theme: "high-to-low",
    });
    if (!colorScheme) {
      console.error('The "Green 5" color scheme was not found in this SDK version\'s smart-mapping catalog.');
      return;
    }
    const { renderer } = await colorRendererCreator.createContinuousRenderer({
      layer,
      view,
      field,
      theme: "high-to-low",
      colorScheme,
    });
    layer.renderer = renderer;
  } catch (err) {
    console.error("Failed to apply the Green 5 renderer to the population layer:", err, { field, url: layer.url });
  }
}

async function createMiniMap(
  container: HTMLDivElement,
  x: number,
  y: number,
  catchment?: Catchment,
  storePoint?: KpnStorePoint | null,
  populationLayerUrl?: string
) {
  const layer = new GraphicsLayer();
  // Border-only on this mini map specifically -- no inner fill -- so the
  // population layer's own gradient underneath reads clearly. createBigMap
  // still draws its own catchment fills (unaffected: it calls
  // catchmentGraphic with its own explicit fill colors, not this default).
  if (catchment) layer.add(catchmentGraphic(x, y, catchment, "#0f6e56", [15, 110, 86, 0]));
  layer.add(storePoint ? kpnStoreGraphic(storePoint.x, storePoint.y) : pointGraphic(x, y));

  // Population gradient (H10 hex grid) layer for this location -- same
  // URL used for both the walk and drive mini maps, just centered/zoomed
  // differently. Skipped with no error until a URL is actually configured
  // (see PocLocation.populationLayerUrl in data/locations.ts).
  let populationLayer: FeatureLayer | null = null;
  if (populationLayerUrl) {
    try {
      const pLayer = new FeatureLayer({ url: populationLayerUrl, opacity: 0.75 });
      await pLayer.load();
      populationLayer = pLayer;
    } catch (err) {
      console.error("Population gradient layer failed to load -- check the URL:", err, populationLayerUrl);
    }
  }

  restrictWheelZoomToCtrl(container);
  const view = new MapView({
    container,
    // Dark Gray Canvas instead of Streets -- the population hex-grid's own
    // color ramp reads much more clearly against a muted dark basemap than
    // against Streets' busy, light road/label styling.
    map: new Map({ basemap: "arcgis/dark-gray", layers: [...(populationLayer ? [populationLayer] : []), layer] }),
    center: [x, y],
    zoom: 15,
    constraints: { rotationEnabled: false },
    ui: { components: ["attribution"] },
  });
  miniViews.push(view);
  await view.when();
  if (catchment) await view.goTo(layer.graphics.toArray(), { animate: false });

  if (populationLayer) {
    await applyGreenPopulationRenderer(populationLayer, view);
    // The built-in Legend widget (unlike the big map's custom fake-legend
    // panel) works fine here since populationLayer is a real FeatureLayer
    // with an actual renderer -- it just reads the Green 5 ramp applied
    // above and draws its class swatches, no custom markup needed. Added
    // after applyGreenPopulationRenderer so it reflects that renderer,
    // not the layer's original published one.
    try {
      const legend = new Legend({
        view,
        layerInfos: [{ layer: populationLayer, title: "Population" }],
        // Legend's default "auto" layout picks side-by-side once it
        // decides there's room, which inside this card-sized mini map
        // (and the Expand panel's own width) is what turned into rows of
        // swatches running horizontally instead of a normal top-to-bottom
        // list -- forcing "stack" makes it always lay out vertically.
        style: { type: "classic", layout: "stack" },
      });
      const legendExpand = new Expand({ view, content: legend, expandIcon: "legend", expandTooltip: "Legend", expanded: false });
      view.ui.add(legendExpand, "top-right");
    } catch (err) {
      console.error("Legend widget failed to initialize on the population mini map:", err);
    }
  }

  // Clip the population layer to just this catchment's shape -- the
  // uploaded hex grid covers a much larger area than any single 5-min
  // drive / 10-min walk catchment, so without this every mini map showed
  // the same big swath of hexagons regardless of which catchment it was
  // meant to represent. FeatureFilter is a client-side spatial filter on
  // the layer view: it hides non-intersecting hexagons without touching
  // the layer's own renderer/symbology.
  if (populationLayer && catchment) {
    try {
      const populationLayerView = await view.whenLayerView(populationLayer);
      populationLayerView.filter = new FeatureFilter({
        geometry: catchmentGeometry(x, y, catchment) as any,
        spatialRelationship: "intersects",
      });
    } catch (err) {
      console.error("Failed to clip population layer to the catchment:", err);
    }
  }

  try {
    const home = new Home({ view });
    view.ui.add(home, "top-left");
  } catch (err) {
    console.error("Home widget failed to initialize on mini map:", err);
  }

  return view;
}

// --- Big consolidated map (catchments + all POI layers) -----------------
// Replaces the old per-POI-category minimaps, the route minimap, and the
// demographics-area minimap: one 2D map with everything as a toggleable,
// legended layer instead of a grid of small static-looking maps.

async function createBigMap(
  container: HTMLDivElement,
  legendContainer: HTMLDivElement,
  x: number,
  y: number,
  walkSection: DemographicCatchment,
  driveSection: DemographicCatchment,
  poiByCategory: Record<string, PoiResult[]>,
  suitabilityLayerUrl?: string,
  kpnStorePoint?: KpnStorePoint | null,
  includeTraffic = false
) {
  const driveLayer = new GraphicsLayer({ title: driveSection.label });
  driveLayer.add(catchmentGraphic(x, y, driveSection.catchment, "#378add", [55, 138, 221, 0.12]));

  const walkLayer = new GraphicsLayer({ title: walkSection.label });
  walkLayer.add(catchmentGraphic(x, y, walkSection.catchment, "#0f6e56", [15, 110, 86, 0.18]));

  const centerLayer = new GraphicsLayer({ title: "KPN Fresh" });
  centerLayer.add(
    kpnStorePoint
      ? kpnStoreGraphic(
          kpnStorePoint.x,
          kpnStorePoint.y,
          { placeName: kpnStorePoint.placeName, placeId: kpnStorePoint.placeId },
          { title: "{placeName}", content: "KPN Fresh store location" }
        )
      : pointGraphic(x, y, "#d85a30", { placeName: "Selected location" }, { title: "{placeName}", content: "Enriched location for this search." })
  );

  // All other layers -- suitability, drive/walk catchments, and this KPN
  // marker -- stay on by default; every POI category layer starts
  // switched off (fetched, but not shown) until the person checks it in
  // the legend.
  //
  // POIs are scoped to the 5min drive-time catchment specifically (not
  // the 10min walk one) -- this mirrors the "Nearby places" count table,
  // which counts drive-catchment hits into its own column, and matches
  // what was asked for: only points actually reachable within the drive
  // catchment should be plotted on the map itself.
  const poiLayers = Object.entries(poiByCategory).map(([category, pois]) => {
    const layer = new GraphicsLayer({ title: category, visible: false });
    pois
      .filter((p) => catchmentContains(driveSection.catchment, x, y, p.x, p.y))
      .forEach((p) =>
        layer.add(
          poiIconGraphic(p.x, p.y, category, { name: p.name, category: categoryDisplayName(p.category), description: p.description, brand: p.brand }, {
            title: "{name}",
            content: p.brand ? "Category: {category}<br>Type: {description}<br>Brand: {brand}" : "Category: {category}<br>Type: {description}",
          })
        )
      );
    return layer;
  });

  // Suitability analysis -- a hosted FeatureLayer specific to this
  // location's candidate-site grid, added straight from its URL. We
  // deliberately don't set our own renderer: the layer keeps whatever
  // symbology/classification it was published with (the class breaks on
  // FinalScore), we only curate the popup so it doesn't dump all ~40
  // Score_/Weighted_score_ fields on click.
  let suitabilityLayer: FeatureLayer | null = null;
  if (suitabilityLayerUrl) {
    try {
      const layer = new FeatureLayer({
        url: suitabilityLayerUrl,
        title: "Suitability analysis",
        opacity: 0.75,
        popupTemplate: {
          title: "Suitability zone — Rank {Rank}",
          content: [
            {
              type: "fields",
              fieldInfos: [
                { fieldName: "FinalScore", label: "Suitability score", format: { places: 3 } },
                { fieldName: "Rank", label: "Rank" },
                { fieldName: "GRID_ID", label: "Grid cell ID" },
              ],
            },
          ],
        } as any,
      });
      await layer.load();
      suitabilityLayer = layer;
    } catch (err) {
      console.error("Suitability layer failed to load -- check the URL and that the item is shared publicly:", err, suitabilityLayerUrl);
    }
  }

  // Live traffic -- only built for the dedicated traffic map (this
  // function is also used for the main catchment/POI map, which never
  // shows traffic at all).
  let trafficLayer: MapImageLayer | null = null;
  if (includeTraffic) {
    trafficLayer = await createTrafficLayer();
  }

  // Suitability sits below the catchment fills so their boundary lines
  // stay visible on top of it, traffic (when present) draws above that
  // as road lines, POIs draw above that as discrete points, and the
  // location marker stays on top of everything.
  restrictWheelZoomToCtrl(container);
  const view = new MapView({
    container,
    map: new Map({
      basemap: "arcgis/streets",
      layers: [
        ...(suitabilityLayer ? [suitabilityLayer] : []),
        driveLayer,
        walkLayer,
        ...(trafficLayer ? [trafficLayer] : []),
        ...poiLayers,
        centerLayer,
      ],
    }),
    constraints: { rotationEnabled: false },
    ui: { components: ["attribution"] },
  });
  bigMapViews.push(view);
  await view.when();

  const fitGraphics = [...driveLayer.graphics.toArray(), ...walkLayer.graphics.toArray()];
  await view.goTo(fitGraphics, { animate: false }).catch(() => {});

  // Clip the suitability layer to the 5min drive-time catchment. The
  // suitability grid was published for a whole candidate-site area, which
  // can extend past (or fall short of) the drive-time polygon solved live
  // here -- clipping it to that catchment is the fallback fix for that
  // mismatch (the POI points above are scoped the same way, via the
  // catchmentContains filter). Same FeatureFilter approach as the
  // population-layer clipping on the mini maps.
  if (suitabilityLayer) {
    try {
      const suitabilityLayerView = await view.whenLayerView(suitabilityLayer);
      suitabilityLayerView.filter = new FeatureFilter({
        geometry: catchmentGeometry(x, y, driveSection.catchment) as any,
        spatialRelationship: "intersects",
      });
    } catch (err) {
      console.error("Failed to clip suitability layer to the drive-time catchment:", err);
    }
  }

  // "Return to original extent" -- captures the view's current
  // viewpoint (the fitted extent above) as its home, since it's
  // constructed right after that goTo resolves.
  try {
    const home = new Home({ view });
    view.ui.add(home, "top-left");
  } catch (err) {
    console.error("Home widget failed to initialize:", err);
  }

  // Fullscreen toggle
  try {
    const fullscreen = new Fullscreen({ view });
    view.ui.add(fullscreen, "top-right");
  } catch (err) {
    console.error("Fullscreen widget failed to initialize:", err);
  }

  // Basemap toggle -- same Expand pattern as the 3D scene card, but with
  // an explicit, fixed basemap list rather than the gallery's default
  // auto-discovered source, so it's always the same list and always
  // re-selectable. Basemap.fromId() only recognizes the legacy keyword
  // ids ("streets", "topo", "satellite"...) -- for the newer
  // "arcgis/xxx" basemap-styles ids used everywhere else in this app,
  // it returns undefined, which is what broke this. The style-object
  // constructor is the correct way to build a Basemap from those ids.
  try {
    const basemapGallery = new BasemapGallery({
      view,
      source: new LocalBasemapsSource({
        basemaps: [
          new Basemap({ style: { id: "arcgis/streets" } }),
          new Basemap({ style: { id: "arcgis/imagery" } }),
          new Basemap({ style: { id: "arcgis/topographic" } }),
          new Basemap({ style: { id: "arcgis/navigation" } }),
          new Basemap({ style: { id: "arcgis/dark-gray" } }),
          new Basemap({ style: { id: "arcgis/light-gray" } }),
          new Basemap({ style: { id: "arcgis/oceans" } }),
        ],
      }),
    });
    const basemapExpand = new Expand({ view, content: basemapGallery, expandIcon: "basemap", expandTooltip: "Change basemap" });
    view.ui.add(basemapExpand, "top-right");
  } catch (err) {
    console.error("Basemap gallery failed to initialize:", err);
  }

  // Measure tool -- driven by our own buttons rather than the
  // Measurement widget's own built-in UI, since that built-in UI needs
  // its container actually mounted in the page to wire up clicks. This
  // way the widget only ever has to do the measuring itself.
  try {
    const measurement = new Measurement({ view });
    const measurePanel = document.createElement("div");
    measurePanel.className = "measure-panel";
    measurePanel.innerHTML = `
      <div class="measure-panel__row">
        <calcite-button id="measure-distance-btn" scale="s">Distance</calcite-button>
        <calcite-button id="measure-area-btn" scale="s">Area</calcite-button>
        <calcite-button id="measure-clear-btn" scale="s" appearance="outline">Clear</calcite-button>
      </div>
    `;
    measurePanel.querySelector("#measure-distance-btn")!.addEventListener("click", () => {
      measurement.activeTool = "distance";
    });
    measurePanel.querySelector("#measure-area-btn")!.addEventListener("click", () => {
      measurement.activeTool = "area";
    });
    measurePanel.querySelector("#measure-clear-btn")!.addEventListener("click", () => {
      measurement.clear();
    });
    const measurementExpand = new Expand({ view, content: measurePanel, expandIcon: "measure-line", expandTooltip: "Measure" });
    measurementExpand.watch("expanded", (expanded: boolean) => {
      if (!expanded) measurement.clear();
    });
    view.ui.add(measurementExpand, "top-right");
  } catch (err) {
    console.error("Measurement widget failed to initialize:", err);
  }

  // Legend + per-layer visibility toggles. GraphicsLayers (KPN marker,
  // catchments, POI) have no published renderer for the built-in Legend
  // widget to read, so those still get a custom row with a manual
  // swatch/icon/CIM-symbol preview. The suitability FeatureLayer and both
  // traffic sublayer groups, though, ARE real hosted layers whose
  // symbology genuinely lives on the service -- for those, a hand-picked
  // flat color was never actually representative of what's drawn (e.g.
  // suitability's real class-break colors, or the traffic service's own
  // speed-based line colors), so a real Legend widget is mounted for
  // them below the toggle list instead, exactly like the population mini
  // maps.
  try {
    // KPN Fresh is listed first -- always on top, both in this list and
    // (via the `layers` array above, where centerLayer is last) on the
    // map itself.
    //
    // The India and Asia Pacific incidents groups are two separate
    // Sublayers of the SAME trafficLayer MapImageLayer, toggled
    // independently -- targeting trafficLayer.visible directly for the
    // "India" row (as before) turned the whole service off, hiding the
    // Asia Pacific incidents along with it, since a MapImageLayer's own
    // visible=false overrides every sublayer's visible flag underneath
    // it. Each row now targets its own Sublayer instead, so the two
    // toggle independently, and the incidents row is listed first here
    // to match their actual draw order on the map (the Asia Pacific
    // group is added after the India group in createTrafficLayer, so it
    // draws on top of it).
    const indiaTraffic = trafficLayer?.findSublayerById(32) ?? null;
    const asiaPacificIncidents = trafficLayer?.findSublayerById(45) ?? null;
    const legendRows: { title: string; color: string; symbol?: CIMSymbol; category?: string; native?: boolean; layer: GraphicsLayer | FeatureLayer | MapImageLayer | Sublayer }[] = [
      { title: "KPN Fresh", color: "#bada55", symbol: kpnStoreCimSymbol(), layer: centerLayer },
      ...(suitabilityLayer ? [{ title: "Suitability analysis", color: "#2f7d32", native: true, layer: suitabilityLayer }] : []),
      { title: driveLayer.title as string, color: "#378add", layer: driveLayer },
      { title: walkLayer.title as string, color: "#0f6e56", layer: walkLayer },
      ...(asiaPacificIncidents ? [{ title: "Traffic incidents (Asia Pacific)", color: "#d85a30", native: true, layer: asiaPacificIncidents }] : []),
      ...(indiaTraffic ? [{ title: "Live traffic (India)", color: "#e08b2f", native: true, layer: indiaTraffic }] : []),
      // `category` (rather than a separately-styled <calcite-icon>) is
      // what makes this render as the literal same badge image as the
      // marker on the map itself -- see poiIconBadgeHtml. It stays the
      // raw category string (for correct color/icon lookup); only the
      // displayed `title` runs through categoryDisplayName.
      ...poiLayers.map((l) => ({ title: categoryDisplayName(l.title as string), color: categoryColor(l.title as string), category: l.title as string, layer: l })),
    ];
    // Checkbox state mirrors each layer's actual default `visible` --
    // true for everything above, false for the POI layers -- rather than
    // being hardcoded, so this panel can never drift out of sync with
    // what's actually drawn on the map.
        // Real, REST-published symbology for the hosted layers, via the
    // built-in Legend widget -- same approach as the population mini
    // maps (see createMiniMap above). One Legend widget per native row
    // (rather than one shared widget for all of them), each in its own
    // wrapper div -- that wrapper's display is toggled directly by the
    // checkbox handler below, since the widget itself doesn't reliably
    // react to a *sublayer's* own visible flag when it's referenced via
    // sublayerIds on the parent MapImageLayer (that's what let a
    // toggled-off layer's symbology keep showing). Referenced via the
    // parent trafficLayer + `sublayerIds` (rather than passing the group
    // Sublayer object directly) -- that's the documented way to scope a
    // MapImageLayer's legend to specific sublayers, and it's what
    // actually walks down into each sublayer's own renderer; passing the
    // Sublayer instance directly was leaving the incidents group's entry
    // blank.
    const nativeLegendMount = legendContainer.querySelector<HTMLDivElement>(".map-legend-panel__native");
    legendRows.forEach((r, i) => {
      if (!r.native || !nativeLegendMount) return;
      let layerInfo: __esri.LegendViewModelLayerInfo | null = null;
      if (r.layer === asiaPacificIncidents && trafficLayer) {
        layerInfo = { layer: trafficLayer, sublayerIds: [45], title: r.title };
      } else if (r.layer === indiaTraffic && trafficLayer) {
        layerInfo = { layer: trafficLayer, sublayerIds: [32], title: r.title };
      } else if (r.layer === suitabilityLayer) {
        layerInfo = { layer: suitabilityLayer as FeatureLayer, title: r.title };
      }
      if (!layerInfo) return;
      const item = document.createElement("div");
      item.dataset.nativeIndex = String(i);
      item.style.display = r.layer.visible ? "" : "none";
      nativeLegendMount.appendChild(item);
      new Legend({
        view,
        container: item,
        layerInfos: [layerInfo],
        style: { type: "classic", layout: "stack" },
        // The incidents/road-closures sublayers only draw at certain map
        // scales (their Overview tier is excluded entirely in
        // createTrafficLayer; Intermediate/Detailed still have their own
        // scale ranges) -- Legend hides a sublayer's entry outside its
        // scale range by default, which was the other half of why that
        // row showed empty. This makes the legend describe the
        // symbology regardless of the view's current zoom level.
        respectLayerVisibility: false,
      });
    });
    // Swap the flat swatch for a rendered preview of the real symbol,
    // where one was given -- async, so it fills in a moment after the
    // legend first paints rather than blocking it.
    legendRows.forEach((r, i) => {
      if (!r.symbol) return;
      const node = legendContainer.querySelector<HTMLElement>(`[data-swatch-index="${i}"]`);
      if (!node) return;
      symbolUtils.renderPreviewHTML(r.symbol, { node, size: 14 }).catch((err) => {
        console.error("Legend symbol preview failed to render:", err);
      });
    });
    legendContainer.querySelectorAll<HTMLInputElement>(".map-legend__toggle").forEach((cb) => {
      cb.addEventListener("change", () => {
        const idx = Number(cb.dataset.layerIndex);
        legendRows[idx].layer.visible = cb.checked;
        // Native rows (suitability/traffic) have their own Legend widget
        // in a wrapper div built above -- hide/show that wrapper in step
        // with the checkbox, since the Legend widget doesn't reliably
        // react to a sublayer's own visible flag on its own.
        const nativeItem = legendContainer.querySelector<HTMLElement>(`[data-native-index="${idx}"]`);
        if (nativeItem) nativeItem.style.display = cb.checked ? "" : "none";
      });
    });
    const legendExpand = new Expand({ view, content: legendContainer, expandIcon: "legend", expandTooltip: "Legend & layers", expanded: true });
    view.ui.add(legendExpand, "top-left");
  } catch (err) {
    console.error("Legend panel failed to initialize:", err);
  }


  return view;
}

// --- Demographic card builders -------------------------------------------

const populationCollection = ENRICHMENT_COLLECTIONS.find((c) => c.collectionId === "PopulationEsriIndia")!;
const ageIncrementsCollection = ENRICHMENT_COLLECTIONS.find((c) => c.collectionId === "15YearIncrementsEsriIndia")!;
const consumerStylesCollection = ENRICHMENT_COLLECTIONS.find((c) => c.collectionId === "ConsumerStylesEsriIndia")!;
const purchasingPowerCollection = ENRICHMENT_COLLECTIONS.find((c) => c.collectionId === "PurchasingPowerEsriIndia")!;
const spendingCollection = ENRICHMENT_COLLECTIONS.find((c) => c.collectionId === "SpendingEsriIndia")!;
const consumerStylesLabels = Object.fromEntries(consumerStylesCollection.variables.map((v) => [v.id, v.label]));

// Split into an explicit "2024" group and "2026 Projected" group, each
// with its own subheading, so it's never ambiguous which year a number
// on this card belongs to (previously "Total"/"Male"/"Female" mixed both
// years together under one unlabeled grid).
function buildNearbyPopulation(enrichment: Record<string, any>): string | null {
  const curatedIds = ["TOTPOP_CY", "MALES_CY", "FEMALES_CY", "POPDENS_CY", "TOT_P_2026", "TOT_M_2026", "TOT_F_2026"];

  const stats2024: { label: string; value: string }[] = [];
  if ("TOTPOP_CY" in enrichment) stats2024.push({ label: "2024 Total", value: formatInt(enrichment.TOTPOP_CY) });
  if ("MALES_CY" in enrichment) stats2024.push({ label: "2024 Male", value: formatInt(enrichment.MALES_CY) });
  if ("FEMALES_CY" in enrichment) stats2024.push({ label: "2024 Female", value: formatInt(enrichment.FEMALES_CY) });
  if ("POPDENS_CY" in enrichment) stats2024.push({ label: "2024 Density (per km²)", value: Number(enrichment.POPDENS_CY).toFixed(0) });

  const stats2026: { label: string; value: string }[] = [];
  if ("TOT_P_2026" in enrichment) stats2026.push({ label: "2026 Projected Total", value: formatInt(enrichment.TOT_P_2026) });
  if ("TOT_M_2026" in enrichment) stats2026.push({ label: "2026 Projected Male", value: formatInt(enrichment.TOT_M_2026) });
  if ("TOT_F_2026" in enrichment) stats2026.push({ label: "2026 Projected Female", value: formatInt(enrichment.TOT_F_2026) });

  const extraRows = populationCollection.variables
    .filter((v) => !curatedIds.includes(v.id) && v.id in enrichment)
    .map((v) => `<div class="ai-card__row"><span>${v.label}</span><b>${formatFieldValue(enrichment[v.id], v.unit)}</b></div>`)
    .join("");

  if (stats2024.length === 0 && stats2026.length === 0 && !extraRows) return null;

  const gridHtml = (stats: { label: string; value: string }[], heading: string) =>
    stats.length
      ? `<div class="ai-card__subheading">${heading}</div><div class="stat-grid">${stats.map((s) => `<div><div class="ai-card__stat" style="font-size:20px">${s.value}</div><div class="ai-card__stat-label">${s.label}</div></div>`).join("")}</div>`
      : "";

  return `${gridHtml(stats2024, "2024 Population")}${gridHtml(stats2026, "2026 Projected Population")}${extraRows}<div class="ai-card__minimap"></div>`;
}

function buildAgePyramid(enrichment: Record<string, any>): string | null {
  const coveredIds = new Set(["MAGE01_CY", "MAGE02_CY", "MAGE03_CY", "MAGE04_CY", "MAGE05_CY", "FAGE01_CY", "FAGE02_CY", "FAGE03_CY", "FAGE04_CY", "FAGE05_CY"]);

  const brackets = [
    { label: "60+", mKey: "MAGE05_CY", fKey: "FAGE05_CY" },
    { label: "45–59", mKey: "MAGE04_CY", fKey: "FAGE04_CY" },
    { label: "30–44", mKey: "MAGE03_CY", fKey: "FAGE03_CY" },
    { label: "15–29", mKey: "MAGE02_CY", fKey: "FAGE02_CY" },
    { label: "0–14", mKey: "MAGE01_CY", fKey: "FAGE01_CY" },
  ]
    .map((b) => ({ label: b.label, m: enrichment[b.mKey] || 0, f: enrichment[b.fKey] || 0, present: b.mKey in enrichment || b.fKey in enrichment }))
    .filter((b) => b.present);

  const pyramidHtml = brackets.length === 0 ? "" : (() => {
    const max = Math.max(...brackets.flatMap((b) => [b.m, b.f]), 1);
    return `
      <div class="pyramid-legend"><span class="pyramid-swatch pyramid-swatch--m"></span>Male<span class="pyramid-swatch pyramid-swatch--f" style="margin-left:14px"></span>Female</div>
      ${brackets.map((b) => `
        <div class="pyramid-row">
          <div class="pyramid-row__side pyramid-row__side--m" title="Male, ${b.label}: ${formatInt(b.m)}"><div class="pyramid-row__fill pyramid-row__fill--m" style="width:${(b.m / max) * 100}%"></div></div>
          <div class="pyramid-row__label">${b.label}</div>
          <div class="pyramid-row__side pyramid-row__side--f" title="Female, ${b.label}: ${formatInt(b.f)}"><div class="pyramid-row__fill pyramid-row__fill--f" style="width:${(b.f / max) * 100}%"></div></div>
        </div>
      `).join("")}
    `;
  })();

  const extraRows = ageIncrementsCollection.variables
    .filter((v) => !coveredIds.has(v.id) && v.id in enrichment)
    .map((v) => `<div class="ai-card__row"><span>${v.label}</span><b>${formatFieldValue(enrichment[v.id], v.unit)}</b></div>`)
    .join("");

  if (!pyramidHtml && !extraRows) return null;
  return `${pyramidHtml}${extraRows}`;
}

let donutInstanceCounter = 0;

function buildConsumerStylesDonut(enrichment: Record<string, any>): { body: string; wire: (card: HTMLElement) => void } | null {
  const codes = Object.keys(consumerStylesLabels).filter((c) => c in enrichment);
  if (codes.length < 2) return null;
  const entries = codes
    .map((c) => ({ code: c, label: consumerStylesLabels[c], value: Number(enrichment[c]) || 0 }))
    .sort((a, b) => b.value - a.value);
  const total = entries.reduce((s, e) => s + e.value, 0) || 1;

  // Unique per card instance -- both catchment columns render a
  // "Lifestyle segmentation" card at once, so IDs can't collide.
  const uid = `donut-${donutInstanceCounter++}`;

  const rowsHtml = entries
    .map((e, i) => {
      const color = DONUT_COLORS[i % DONUT_COLORS.length];
      const pct = ((e.value / total) * 100).toFixed(0);
      return `
        <label class="donut-legend__row">
          <input type="checkbox" class="donut-legend__checkbox" data-value="${e.value}" data-color="${color}" checked>
          <span class="donut-legend__label"><span class="donut-legend__swatch" style="background:${color}"></span>${e.label}</span>
          <span class="donut-legend__value">${formatInt(e.value)} · ${pct}%</span>
        </label>
      `;
    })
    .join("");

  const body = `
    <div class="donut-chart" data-donut-chart="${uid}"></div>
    <div class="donut-legend" data-donut-legend="${uid}">
      ${rowsHtml}
      <div class="donut-legend__row donut-legend__row--total">
        <span class="donut-legend__label">Total (selected)</span>
        <span class="donut-legend__value" data-donut-total="${uid}">${formatInt(total)}</span>
      </div>
    </div>
  `;

  function wire(card: HTMLElement) {
    const chartDiv = card.querySelector<HTMLElement>(`[data-donut-chart="${uid}"]`);
    const totalSpan = card.querySelector<HTMLElement>(`[data-donut-total="${uid}"]`);
    const checkboxes = Array.from(
      card.querySelectorAll<HTMLInputElement>(`[data-donut-legend="${uid}"] .donut-legend__checkbox`)
    );

    function recompute() {
      const checked = checkboxes.filter((cb) => cb.checked);
      const sum = checked.reduce((s, cb) => s + Number(cb.dataset.value), 0);
      if (totalSpan) totalSpan.textContent = formatInt(sum);
      if (!chartDiv) return;
      if (sum === 0) {
        chartDiv.style.background = "#eee";
        return;
      }
      // Re-normalized to the checked subset -- the ring always fills
      // to show how the selected segments compare to each other,
      // rather than shrinking to leave an empty gap for the rest.
      let cumulative = 0;
      const stops = checked
        .map((cb) => {
          const v = Number(cb.dataset.value);
          const startPct = (cumulative / sum) * 100;
          cumulative += v;
          const endPct = (cumulative / sum) * 100;
          return `${cb.dataset.color} ${startPct}% ${endPct}%`;
        })
        .join(", ");
      chartDiv.style.background = `conic-gradient(${stops})`;
    }

    checkboxes.forEach((cb) => cb.addEventListener("change", recompute));
    recompute();
  }

  return { body, wire };
}

// Shared by the Income-based analysis and Consumer spending cards below --
// every variable in the given collection, as plain label/value rows via
// the existing `.ai-card table` styling (same left/right-aligned
// two-column look used elsewhere in the app), rather than a hero stat
// plus a handful of loose rows.
function buildVariableTable(variables: { id: string; label: string; unit?: "currency" }[], enrichment: Record<string, any>): string | null {
  const rows = variables
    .filter((v) => v.id in enrichment)
    .map((v) => `<tr><td>${v.label}</td><td>${formatFieldValue(enrichment[v.id], v.unit)}</td></tr>`)
    .join("");

  if (!rows) return null;
  return `<table><tbody>${rows}</tbody></table>`;
}

function buildDemographicCards(enrichment: Record<string, any> | null): { kind: string; title: string; body: string; wire?: (card: HTMLElement) => void }[] {
  if (!enrichment) {
    return [{
      kind: "teal",
      title: "Demographics",
      body: `<div class="ai-card__stat-label">No variables selected, or unavailable — check the Demographics (GeoEnrichment) privilege on your API key.</div>`,
    }];
  }

  const cards: { kind: string; title: string; body: string; wire?: (card: HTMLElement) => void }[] = [];

  const popHtml = buildNearbyPopulation(enrichment);
  if (popHtml) cards.push({ kind: "teal", title: "Population analysis", body: popHtml });

  const donut = buildConsumerStylesDonut(enrichment);
  if (donut) cards.push({ kind: "purple", title: "Lifestyle segmentation", body: donut.body, wire: donut.wire });

  const pyramidHtml = buildAgePyramid(enrichment);
  if (pyramidHtml) cards.push({ kind: "teal", title: "Age-group segmentation", body: pyramidHtml });

  // Income (Purchasing Power) and Spending are two separate cards -- each
  // is its own GeoEnrichment collection with its own set of variables, and
  // Spending now carries all 20 categories, so combining them into one
  // card made an already-long table even harder to scan.
  const incomeTableHtml = buildVariableTable(purchasingPowerCollection.variables, enrichment);
  if (incomeTableHtml) cards.push({ kind: "teal", title: "Income-based analysis", body: incomeTableHtml });

  const spendingTableHtml = buildVariableTable(spendingCollection.variables, enrichment);
  if (spendingTableHtml) cards.push({ kind: "teal", title: "Consumer spending", body: spendingTableHtml });

  if (cards.length === 0) {
    return [{ kind: "teal", title: "Demographics", body: `<div class="ai-card__stat-label">No data returned for the selected variables in this catchment.</div>` }];
  }

  return cards;
}

async function appendDemographicCards(
  container: HTMLElement,
  cards: { kind: string; title: string; body: string; wire?: (card: HTMLElement) => void }[],
  x: number,
  y: number,
  catchment: Catchment,
  storePoint?: KpnStorePoint | null,
  populationLayerUrl?: string
) {
  for (const c of cards) {
    const card = document.createElement("div");
    card.className = "ai-card";
    card.dataset.kind = c.kind;
    card.innerHTML = `<div class="ai-card__header">${c.title}</div><div class="ai-card__body">${c.body}</div>`;
    container.appendChild(card);

    const minimap = card.querySelector(".ai-card__minimap");
    if (minimap) await createMiniMap(minimap as HTMLDivElement, x, y, catchment, storePoint, populationLayerUrl);

    c.wire?.(card);
  }
}

// Replaces the old separate "Elevation" / "Terrain roughness" cards --
// those two numbers aren't useful for this PoC's actual purpose, so this
// pulls a quick top-line summary instead from data already being
// fetched anyway (5-min drive enrichment + the POI count table), for a
// glance at "who lives here and what's around" before scrolling further.
function buildTldrCard(enrichment: Record<string, any> | null, nearbyPlacesCount: number): string {
  const rows: { label: string; value: string }[] = [];

  if (enrichment) {
    if ("TOTPOP_CY" in enrichment) rows.push({ label: "Population (5-min drive)", value: formatInt(enrichment.TOTPOP_CY) });
    if ("PPPC_CY" in enrichment) rows.push({ label: "Purchasing power / capita", value: formatFieldValue(enrichment.PPPC_CY, "currency") });

    // Whichever Consumer Styles segment has the highest value here is the
    // single dominant lifestyle group in the catchment -- a quick
    // qualitative read to go with the population/spending numbers.
    const topSegmentCode = Object.keys(consumerStylesLabels)
      .filter((c) => c in enrichment)
      .sort((a, b) => (Number(enrichment[b]) || 0) - (Number(enrichment[a]) || 0))[0];
    if (topSegmentCode) rows.push({ label: "Dominant lifestyle segment", value: consumerStylesLabels[topSegmentCode] });
  }

  rows.push({ label: "Nearby places found (5-min drive)", value: formatInt(nearbyPlacesCount) });

  return `<div class="tldr-card">${rows.map((r) => `<div class="ai-card__row"><span>${r.label}</span><b>${r.value}</b></div>`).join("")}</div>`;
}

// -------------------------------------------------------------------------

async function renderResults(root: HTMLDivElement, data: any) {
  destroyAllViews();

  const {
    locationName, location, elevation, elevationSamples,
    demographicsSections, poiByCategory, summaryLabel, suitabilityLayerUrl, kpnStorePoint, populationLayerUrl,
  } = data as {
    locationName: string; location: { x: number; y: number };
    elevation: number | null; elevationSamples: number[];
    demographicsSections: { label: string; catchment: Catchment; enrichment: Record<string, any> | null }[];
    poiByCategory: Record<string, PoiResult[]>;
    summaryLabel: string;
    suitabilityLayerUrl?: string;
    kpnStorePoint?: KpnStorePoint | null;
    populationLayerUrl?: string;
  };
  const roughness = stdDev(elevationSamples || []);
  const x = location.x, y = location.y;

  const walkSection = demographicsSections.find((s) => s.label.toLowerCase().includes("walk")) ?? demographicsSections[0];
  const driveSection = demographicsSections.find((s) => s.label.toLowerCase().includes("drive")) ?? demographicsSections[1];

  // POI category/count table -- counts each already-fetched category's
  // points against the 5-min drive and 10-min walk catchments specifically,
  // independent of the (now much larger) suitability-extent geometry they
  // were actually queried against.
  const poiCountRows = Object.entries(poiByCategory)
    .map(([category, pois]) => {
      const drivePois = pois.filter((p) => catchmentContains(driveSection.catchment, x, y, p.x, p.y));
      const walkPois = pois.filter((p) => catchmentContains(walkSection.catchment, x, y, p.x, p.y));

      // Only categories where at least one fetched POI actually carries a
      // brand -- everything else keeps the old plain (non-expandable) row,
      // rather than showing an empty/"all Other" dropdown for every category.
      const brandNames = Array.from(new Set(pois.map((p) => p.brand).filter((b): b is string => !!b))).sort();
      const brandRows = brandNames.map((brand) => ({
        brand,
        driveCount: drivePois.filter((p) => p.brand === brand).length,
        walkCount: walkPois.filter((p) => p.brand === brand).length,
      }));
      // Non-branded POIs in this category, so brandRows (+ Other) always
      // sums back to driveCount/walkCount exactly.
      if (brandRows.length > 0) {
        brandRows.push({
          brand: "Other",
          driveCount: drivePois.filter((p) => !p.brand).length,
          walkCount: walkPois.filter((p) => !p.brand).length,
        });
      }

      return { category, driveCount: drivePois.length, walkCount: walkPois.length, brandRows };
    })
    .sort((a, b) => b.driveCount + b.walkCount - (a.driveCount + a.walkCount));

  const poiCountTableHtml = poiCountRows.length
    ? `
    <div class="ai-card poi-count-card" data-kind="teal">
      <div class="ai-card__header">Nearby places — counts by catchment</div>
      <div class="ai-card__body">
        <table class="poi-count-table">
          <thead>
            <tr><th>Category</th><th>5-min drive</th><th>10-min walk</th></tr>
          </thead>
          <tbody>
            ${poiCountRows
              .map(
                (r, i) => `
              <tr class="poi-count-row${r.brandRows.length ? " poi-count-row--expandable" : ""}" data-toggle-index="${i}">
                <td>
                  ${r.brandRows.length ? `<calcite-icon class="poi-count-chevron" icon="chevron-right" scale="s"></calcite-icon>` : ""}
                  ${poiIconBadgeHtml(r.category, 14)}${categoryDisplayName(r.category)}
                </td>
                <td>${formatInt(r.driveCount)}</td>
                <td>${formatInt(r.walkCount)}</td>
              </tr>
              ${
                r.brandRows.length
                  ? `
              <tr class="poi-brand-rows" data-toggle-index="${i}" hidden>
                <td colspan="3">
                  <table class="poi-brand-table">
                    <tbody>
                      ${r.brandRows
                        .map((b) => `<tr><td>${b.brand}</td><td>${formatInt(b.driveCount)}</td><td>${formatInt(b.walkCount)}</td></tr>`)
                        .join("")}
                    </tbody>
                  </table>
                </td>
              </tr>`
                  : ""
              }
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `
    : "";

  root.innerHTML = `
    <div class="result-header">
      <div class="logo-dots"><span></span><span></span><span></span><span></span></div>
      <div>
        <div class="result-title">Esri Address Insights</div>
        <div class="result-subtitle">${locationName} · ${summaryLabel}</div>
      </div>
    </div>
    <div class="top-panel">
      <div class="top-panel__left" id="top-panel-left"></div>
      <div class="top-panel__right">
        <div class="ai-card big-map-card" data-kind="teal">
          <div class="ai-card__header">Catchment & POI map</div>
          <div class="ai-card__body">
            <div class="big-map" id="big-map"></div>
          </div>
        </div>
      </div>
    </div>
    ${poiCountTableHtml}
    <div class="ai-card traffic-map-card" data-kind="teal">
      <div class="ai-card__header">Live traffic map</div>
      <div class="ai-card__body">
        <div class="big-map" id="traffic-map"></div>
      </div>
    </div>
  `;

  // Brand-breakdown dropdown toggles for the POI count table -- each
  // expandable category row reveals/hides its sibling brand-rows tr.
  root.querySelectorAll<HTMLTableRowElement>(".poi-count-row--expandable").forEach((row) => {
    row.addEventListener("click", () => {
      const idx = row.dataset.toggleIndex;
      const detail = root.querySelector<HTMLTableRowElement>(`.poi-brand-rows[data-toggle-index="${idx}"]`);
      const chevron = row.querySelector<HTMLElement>(".poi-count-chevron");
      if (!detail) return;
      const willShow = detail.hidden;
      detail.hidden = !willShow;
      chevron?.setAttribute("icon", willShow ? "chevron-down" : "chevron-right");
    });
  });

  const leftCol = root.querySelector("#top-panel-left") as HTMLDivElement;

  function addLeftCard(kind: string, title: string, bodyHtml: string) {
    const card = document.createElement("div");
    card.className = "ai-card";
    card.dataset.kind = kind;
    card.innerHTML = `<div class="ai-card__header">${title}</div><div class="ai-card__body">${bodyHtml}</div>`;
    leftCol.appendChild(card);
    return card;
  }

  const sceneCard = document.createElement("div");
  sceneCard.className = "ai-card ai-card--scene";
  sceneCard.dataset.kind = "teal";
  sceneCard.innerHTML = `<div class="ai-card__header">${locationName}</div><div class="ai-card__scene"></div>`;
  leftCol.appendChild(sceneCard);

  const sceneDiv = sceneCard.querySelector(".ai-card__scene") as HTMLDivElement;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    console.error("Scene view: invalid coordinates for", locationName, "-- check that entry in src/data/locations.ts", { x, y });
  }

  const centerGraphic = kpnStorePoint ? kpnStoreGraphic(kpnStorePoint.x, kpnStorePoint.y) : pointGraphic(x, y);
  const sceneLayer = new GraphicsLayer({
    // relative-to-scene draws the graphic at the elevation of whatever is
    // highest at that map point -- ground, mesh, or (here) the 3D
    // Buildings layer -- instead of draping it flat on bare terrain.
    // Without this the marker sat right on the ground and any building
    // taller than it at that spot would render in front of it from most
    // camera angles, which is exactly what started happening once the 3D
    // Buildings layer was added below; this keeps it visible above
    // whatever building occupies the site.
    elevationInfo: { mode: "relative-to-scene", offset: 3 },
  });
  sceneLayer.add(centerGraphic);
  // Real 3D building massing instead of a flat imagery basemap -- loads
  // progressively in the background like any other scene layer, so it's
  // just added here rather than awaited before the view is usable.
  const buildingsLayer = new SceneLayer({ url: BUILDINGS_3D_URL, title: "3D Buildings" });
  const sceneMap = new Map({ basemap: "arcgis/imagery", ground: "world-elevation", layers: [buildingsLayer, sceneLayer] });
  restrictWheelZoomToCtrl(sceneDiv);
  currentSceneView = new SceneView({
    container: sceneDiv,
    map: sceneMap,
    ui: { components: ["attribution"] },
  });
  await currentSceneView.when();
  // Setting center/zoom in the constructor computes the camera before
  // the 3D terrain has loaded, against a flat ellipsoid -- once real
  // elevation loads in, that camera can end up looking at empty sky or
  // buried in terrain, and a later tilt just pivots around that wrong
  // position. Reusing the marker's own geometry as the goTo target,
  // after the view (and its ground) is ready, keeps it centered
  // regardless of terrain -- and guarantees the target matches the dot
  // exactly, rather than a second, separately-typed point literal.
  //
  // That's still an un-elevated (z-less) point, though -- goTo has to
  // clamp it to the ground surface itself, and for at least one site
  // (Sreemoolanagaram) that implicit clamp landed off from where the
  // marker actually draws, most likely because goTo ran a hair ahead of
  // that spot's real terrain tile finishing its load, leaving it framed
  // against whatever (wrong) elevation was in at that instant. Querying
  // the real ground elevation explicitly first and going to that already-
  // elevated point removes the guesswork -- applied to every location,
  // since the exact terrain-timing condition can't be reproduced or
  // confirmed from this sandbox (no live network access to the terrain
  // service), so this is the safe fix either way: elsewhere it's a no-op
  // (the elevated point sits wherever the un-elevated one already did).
  let goToTarget: __esri.Point = centerGraphic.geometry as __esri.Point;
  try {
    const ground = sceneMap.ground;
    // queryElevation needs Ground's own elevation layers loaded first --
    // without this it can silently resolve against unloaded/default
    // elevation (effectively z=0) instead of throwing, which sent the
    // camera's goTo target to the wrong height and hid the 3D Buildings
    // layer entirely (camera ended up framed against empty space/terrain
    // instead of the building meshes).
    await ground.load();
    const elevationResult = await ground.queryElevation(goToTarget);
    if (elevationResult?.geometry) {
      goToTarget = elevationResult.geometry as __esri.Point;
    }
  } catch (err) {
    console.error("Ground elevation query failed for the scene view's initial camera target -- falling back to the un-elevated point:", err, locationName);
  }
  await currentSceneView.goTo(
    { target: goToTarget, scale: 2000, tilt: 60 },
    { animate: false }
  );

  // The marker's own elevation is already correct (relative-to-scene,
  // above) -- this is a separate problem: a *neighboring* building can
  // still sit between the camera and the marker from this particular
  // heading, hiding a perfectly well-placed rooftop marker behind
  // someone else's roofline. There's no direct "is this graphic visible"
  // query in the SDK, so hitTest at the marker's own screen position
  // (restricted to just the marker's layer and the buildings layer, so
  // it can't be confused by anything else) is the only way to tell --
  // if the closest thing along that ray isn't the marker itself, try a
  // few other headings around the same target until one has a clear
  // line of sight.
  async function markerIsVisible(): Promise<boolean> {
    if (!currentSceneView) return true;
    const screenPoint = currentSceneView.toScreen(goToTarget);
    const hit = await currentSceneView.hitTest(screenPoint, { include: [sceneLayer, buildingsLayer] });
    const top = hit.results[0];
    return !!top && top.type === "graphic" && top.graphic === centerGraphic;
  }

  try {
    if (!(await markerIsVisible())) {
      const candidateHeadings = [90, 180, 270];
      let clear = false;
      for (const heading of candidateHeadings) {
        await currentSceneView.goTo({ target: goToTarget, scale: 2000, tilt: 60, heading }, { animate: false });
        if (await markerIsVisible()) {
          clear = true;
          break;
        }
      }
      if (!clear) {
        // None of those headings cleared it either -- a near-overhead
        // view makes a neighboring building far less likely to sit
        // between the camera and a rooftop-height marker regardless of
        // which direction it's in, so this is the safe fallback rather
        // than trying still more headings.
        await currentSceneView.goTo({ target: goToTarget, scale: 2000, tilt: 15 }, { animate: false });
      }
    }
  } catch (err) {
    console.error("Marker-visibility check failed -- keeping the current camera position:", err, locationName);
  }

  const basemapGallery = new BasemapGallery({ view: currentSceneView });
  const basemapExpand = new Expand({ view: currentSceneView, content: basemapGallery, expandIcon: "basemap", expandTooltip: "Change basemap" });
  currentSceneView.ui.add(basemapExpand, "top-right");

  try {
    const sceneHome = new Home({ view: currentSceneView });
    currentSceneView.ui.add(sceneHome, "top-left");
  } catch (err) {
    console.error("Home widget failed to initialize on scene view:", err);
  }

  addLeftCard(
    "amber",
    "At a glance",
    buildTldrCard(driveSection.enrichment, poiCountRows.reduce((sum, r) => sum + r.driveCount, 0))
  );

  const bigMapDiv = root.querySelector("#big-map") as HTMLDivElement;
  const legendContainer = document.createElement("div");
  await createBigMap(bigMapDiv, legendContainer, x, y, walkSection, driveSection, poiByCategory, suitabilityLayerUrl, kpnStorePoint);

  // Second big map, traffic-focused: same catchments/POIs/marker, no
  // suitability layer, with live traffic switched on.
  const trafficMapDiv = root.querySelector("#traffic-map") as HTMLDivElement;
  const trafficLegendContainer = document.createElement("div");
  await createBigMap(trafficMapDiv, trafficLegendContainer, x, y, walkSection, driveSection, poiByCategory, undefined, kpnStorePoint, true);

  if (demographicsSections.length < 2) {
    console.error("Expected two demographic sections (walk + drive); got", demographicsSections.length);
  }

  const splitWrap = document.createElement("div");
  splitWrap.className = "demo-split";
  root.appendChild(splitWrap);

  for (const section of demographicsSections) {
    const col = document.createElement("div");
    col.className = "demo-split__col";
    const heading = document.createElement("div");
    heading.className = "demo-split__heading";
    heading.textContent = section.label;
    col.appendChild(heading);
    splitWrap.appendChild(col);

    const cards = buildDemographicCards(section.enrichment);
    await appendDemographicCards(col, cards, x, y, section.catchment, kpnStorePoint, populationLayerUrl);
  }
}