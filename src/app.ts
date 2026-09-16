import SceneView from "@arcgis/core/views/SceneView";
import MapView from "@arcgis/core/views/MapView";
import Map from "@arcgis/core/Map";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Graphic from "@arcgis/core/Graphic";
import Circle from "@arcgis/core/geometry/Circle";
import BasemapGallery from "@arcgis/core/widgets/BasemapGallery";
import Fullscreen from "@arcgis/core/widgets/Fullscreen";
import Expand from "@arcgis/core/widgets/Expand";
import { enrichPoint } from "./services/geoenrichment";
import { sampleElevation } from "./services/elevation";
import { fetchPoiCategories, queryNearbyPois, type PoiResult } from "./services/poi";
import { solveServiceAreaCatchment } from "./services/serviceArea";
import type { Catchment } from "./services/catchment";
import { ENRICHMENT_COLLECTIONS, type EnrichmentCollection } from "./data/enrichmentVariables";
import { POC_LOCATIONS, type PocLocation } from "./data/locations";

let currentSceneView: SceneView | null = null;
let currentBigMapView: MapView | null = null;
let miniViews: MapView[] = [];
let poiCategoryList: string[] = [];

function destroyAllViews() {
  currentSceneView?.destroy();
  currentSceneView = null;
  currentBigMapView?.destroy();
  currentBigMapView = null;
  miniViews.forEach((v) => v.destroy());
  miniViews = [];
}

// --- Category colors -------------------------------------------------

// Same palette used for the consumer-styles donut, reused here so every
// POI category gets a stable color across the checkbox picker and the
// big map's layers/legend -- hashed off the category name so the color
// doesn't shift around if categories are added/removed from the layer.
const DONUT_COLORS = ["#0f6e56", "#5dcaa5", "#378add", "#b6771a", "#d85a30", "#6b4fbb", "#99355a", "#2f7d32", "#26215c", "#7f77dd"];

function categoryColor(category: string): string {
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  return DONUT_COLORS[hash % DONUT_COLORS.length];
}

// Keyword groups matching the 8 categories this PoC cares about --
// any fetched category whose label contains one of these substrings
// starts pre-checked in the "Nearby places" picker. Everything else
// still shows up, just unchecked, so nothing from the source layer is
// hidden -- it's only a sensible default selection.
const POI_DEFAULT_KEYWORD_GROUPS: string[][] = [
  ["restaurant", "qsr", "cafe", "cafeteria", "food", "dine", "dining"], // Restaurants and QSRs
  ["gym", "fitness"], // Gyms
  ["worship", "temple", "mosque", "church", "gurudwara", "religious"], // Places of worship
  ["residential", "apartment", "housing", "society"], // Residential accommodations
  ["market", "bazaar"], // Markets
  ["department", "supermarket", "hypermarket"], // Departmental stores
  ["retail", "shop", "store"], // Retail shops
  ["park", "garden"], // Parks
];

function isDefaultPoiCategory(category: string): boolean {
  const lower = category.toLowerCase();
  return POI_DEFAULT_KEYWORD_GROUPS.some((group) => group.some((k) => lower.includes(k)));
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
              <calcite-checkbox class="var-checkbox" data-key="${c.collectionId}.${v.id}" checked></calcite-checkbox>
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
      ${categories.map((cat, i) => `
        <calcite-label layout="inline" class="poi-checkbox-label">
          <calcite-checkbox class="poi-checkbox" data-index="${i}" ${isDefaultPoiCategory(cat) ? "checked" : ""}></calcite-checkbox>
          <span class="poi-swatch" style="background:${categoryColor(cat)}"></span>
          ${cat}
        </calcite-label>
      `).join("")}
    </calcite-block>
  `;
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

const CACHE_VERSION = "v9";

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
    const catchments = await resolveCatchments(location.x, location.y);

    const [miscResults, poiSettled, enrichmentSettled] = await Promise.all([
      Promise.allSettled([
        sampleElevation(location.x, location.y),
        sampleElevationRing(location.x, location.y),
      ]),
      Promise.allSettled(poiCategories.map((cat) => queryNearbyPois(location.x, location.y, cat, catchments.primary))),
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

function formatCompact(n: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function formatInt(n: number) {
  return new Intl.NumberFormat().format(Math.round(n));
}

function formatFieldValue(raw: any, unit?: "currency") {
  if (typeof raw !== "number") return raw ?? "—";
  return unit === "currency" ? `₹${formatCompact(raw)}` : formatCompact(raw);
}

function pointGraphic(x: number, y: number, color = "#d85a30") {
  return new Graphic({
    geometry: { type: "point", x, y, spatialReference: { wkid: 4326 } } as any,
    symbol: { type: "simple-marker", color, outline: { color: "#ffffff", width: 1 }, size: 10 } as any,
  });
}

function catchmentGraphic(
  x: number,
  y: number,
  catchment: Catchment,
  outlineColor = "#0f6e56",
  fillColor: [number, number, number, number] = [15, 110, 86, 0.15]
) {
  if (catchment.kind === "ring") {
    const circle = new Circle({
      center: { x, y, spatialReference: { wkid: 4326 } } as any,
      radius: catchment.km,
      radiusUnit: "kilometers",
    });
    return new Graphic({ geometry: circle, symbol: { type: "simple-fill", color: fillColor, outline: { color: outlineColor, width: 1.5 } } as any });
  }
  return new Graphic({
    geometry: { type: "polygon", rings: catchment.rings, spatialReference: { wkid: 4326 } } as any,
    symbol: { type: "simple-fill", color: fillColor, outline: { color: outlineColor, width: 1.5 } } as any,
  });
}

async function createMiniMap(container: HTMLDivElement, x: number, y: number, catchment?: Catchment) {
  const layer = new GraphicsLayer();
  if (catchment) layer.add(catchmentGraphic(x, y, catchment));
  layer.add(pointGraphic(x, y));

  const view = new MapView({
    container,
    map: new Map({ basemap: "arcgis/streets", layers: [layer] }),
    center: [x, y],
    zoom: 15,
    constraints: { rotationEnabled: false },
    ui: { components: ["attribution"] },
  });
  miniViews.push(view);
  await view.when();
  if (catchment) await view.goTo(layer.graphics.toArray(), { animate: false });
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
  poiByCategory: Record<string, PoiResult[]>
) {
  const driveLayer = new GraphicsLayer({ title: driveSection.label });
  driveLayer.add(catchmentGraphic(x, y, driveSection.catchment, "#378add", [55, 138, 221, 0.12]));

  const walkLayer = new GraphicsLayer({ title: walkSection.label });
  walkLayer.add(catchmentGraphic(x, y, walkSection.catchment, "#0f6e56", [15, 110, 86, 0.18]));

  const centerLayer = new GraphicsLayer({ title: "Selected location" });
  centerLayer.add(pointGraphic(x, y));

  const poiLayers = Object.entries(poiByCategory).map(([category, pois]) => {
    const layer = new GraphicsLayer({ title: category });
    const color = categoryColor(category);
    pois.forEach((p) => layer.add(pointGraphic(p.x, p.y, color)));
    return layer;
  });

  const view = new MapView({
    container,
    map: new Map({ basemap: "arcgis/streets", layers: [driveLayer, walkLayer, ...poiLayers, centerLayer] }),
    constraints: { rotationEnabled: false },
    ui: { components: ["attribution"] },
  });
  currentBigMapView = view;
  await view.when();

  const fitGraphics = [...driveLayer.graphics.toArray(), ...walkLayer.graphics.toArray()];
  await view.goTo(fitGraphics, { animate: false }).catch(() => {});

  // Fullscreen toggle
  const fullscreen = new Fullscreen({ view });
  view.ui.add(fullscreen, "top-right");

  // Basemap toggle -- same Expand + BasemapGallery pattern as the 3D scene card
  const basemapGallery = new BasemapGallery({ view });
  const basemapExpand = new Expand({ view, content: basemapGallery, expandIcon: "basemap", expandTooltip: "Change basemap" });
  view.ui.add(basemapExpand, "top-right");

  // Legend + per-layer visibility toggles -- a custom panel rather than
  // the built-in Legend widget, since that widget only reads renderers
  // off FeatureLayers and these are plain GraphicsLayers.
  const legendRows = [
    { title: driveLayer.title as string, color: "#378add", layer: driveLayer as GraphicsLayer },
    { title: walkLayer.title as string, color: "#0f6e56", layer: walkLayer as GraphicsLayer },
    ...poiLayers.map((l) => ({ title: l.title as string, color: categoryColor(l.title as string), layer: l as GraphicsLayer })),
  ];
  legendContainer.innerHTML = `
    <div class="map-legend-panel">
      ${legendRows.map((r, i) => `
        <label class="fake-legend__row">
          <input type="checkbox" class="map-legend__toggle" data-layer-index="${i}" checked>
          <span class="fake-legend__swatch" style="background:${r.color}"></span>
          ${r.title}
        </label>
      `).join("")}
    </div>
  `;
  legendContainer.querySelectorAll<HTMLInputElement>(".map-legend__toggle").forEach((cb) => {
    cb.addEventListener("change", () => {
      const idx = Number(cb.dataset.layerIndex);
      legendRows[idx].layer.visible = cb.checked;
    });
  });
  const legendExpand = new Expand({ view, content: legendContainer, expandIcon: "legend", expandTooltip: "Legend & layers", expanded: true });
  view.ui.add(legendExpand, "top-left");

  return view;
}

// --- Demographic card builders -------------------------------------------

const populationCollection = ENRICHMENT_COLLECTIONS.find((c) => c.collectionId === "PopulationEsriIndia")!;
const ageIncrementsCollection = ENRICHMENT_COLLECTIONS.find((c) => c.collectionId === "15YearIncrementsEsriIndia")!;
const consumerStylesCollection = ENRICHMENT_COLLECTIONS.find((c) => c.collectionId === "ConsumerStylesEsriIndia")!;
const householdsCollection = ENRICHMENT_COLLECTIONS.find((c) => c.collectionId === "HouseholdsEsriIndia")!;
const purchasingPowerCollection = ENRICHMENT_COLLECTIONS.find((c) => c.collectionId === "PurchasingPowerEsriIndia")!;
const spendingCollection = ENRICHMENT_COLLECTIONS.find((c) => c.collectionId === "SpendingEsriIndia")!;
const consumerStylesLabels = Object.fromEntries(consumerStylesCollection.variables.map((v) => [v.id, v.label]));

function buildNearbyPopulation(enrichment: Record<string, any>): string | null {
  const curatedIds = ["TOTPOP_CY", "MALES_CY", "FEMALES_CY", "POPDENS_CY"];
  const stats: { label: string; value: string }[] = [];
  if ("TOTPOP_CY" in enrichment) stats.push({ label: "Total", value: formatInt(enrichment.TOTPOP_CY) });
  if ("MALES_CY" in enrichment) stats.push({ label: "Male", value: formatInt(enrichment.MALES_CY) });
  if ("FEMALES_CY" in enrichment) stats.push({ label: "Female", value: formatInt(enrichment.FEMALES_CY) });
  if ("POPDENS_CY" in enrichment) stats.push({ label: "Per km²", value: Number(enrichment.POPDENS_CY).toFixed(0) });

  const extraRows = populationCollection.variables
    .filter((v) => !curatedIds.includes(v.id) && v.id in enrichment)
    .map((v) => `<div class="ai-card__row"><span>${v.label}</span><b>${formatFieldValue(enrichment[v.id], v.unit)}</b></div>`)
    .join("");

  if (stats.length === 0 && !extraRows) return null;

  const gridHtml = stats.length
    ? `<div class="stat-grid">${stats.map((s) => `<div><div class="ai-card__stat" style="font-size:20px">${s.value}</div><div class="ai-card__stat-label">${s.label}</div></div>`).join("")}</div>`
    : "";

  return `${gridHtml}${extraRows}<div class="ai-card__minimap"></div>`;
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
          <div class="pyramid-row__side pyramid-row__side--m"><div class="pyramid-row__fill pyramid-row__fill--m" style="width:${(b.m / max) * 100}%"></div></div>
          <div class="pyramid-row__label">${b.label}</div>
          <div class="pyramid-row__side pyramid-row__side--f"><div class="pyramid-row__fill pyramid-row__fill--f" style="width:${(b.f / max) * 100}%"></div></div>
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

function buildConsumerStylesDonut(enrichment: Record<string, any>): string | null {
  const codes = Object.keys(consumerStylesLabels).filter((c) => c in enrichment);
  if (codes.length < 2) return null;
  const entries = codes
    .map((c) => ({ code: c, label: consumerStylesLabels[c], value: Number(enrichment[c]) || 0 }))
    .sort((a, b) => b.value - a.value);
  const total = entries.reduce((s, e) => s + e.value, 0) || 1;

  let cumulative = 0;
  const stops = entries
    .map((e, i) => {
      const startPct = (cumulative / total) * 100;
      cumulative += e.value;
      const endPct = (cumulative / total) * 100;
      return `${DONUT_COLORS[i % DONUT_COLORS.length]} ${startPct}% ${endPct}%`;
    })
    .join(", ");

  return `
    <div class="donut-chart" style="background: conic-gradient(${stops});"></div>
    <div class="donut-legend">
      ${entries.map((e, i) => `<div class="donut-legend__row"><span class="donut-legend__swatch" style="background:${DONUT_COLORS[i % DONUT_COLORS.length]}"></span>${e.label} — ${((e.value / total) * 100).toFixed(0)}%</div>`).join("")}
    </div>
  `;
}

function buildGenericCollectionCard(collection: EnrichmentCollection, enrichment: Record<string, any>): { body: string } | null {
  const present = collection.variables.filter((v) => v.id in enrichment);
  if (present.length === 0) return null;

  const [hero, ...rest] = present;
  const heroHtml = `
    <div class="ai-card__stat">${formatFieldValue(enrichment[hero.id], hero.unit)}</div>
    <div class="ai-card__stat-label">${hero.label}</div>
  `;
  const restHtml = rest
    .map((v) => `<div class="ai-card__row"><span>${v.label}</span><b>${formatFieldValue(enrichment[v.id], v.unit)}</b></div>`)
    .join("");

  return { body: heroHtml + restHtml };
}

function buildDemographicCards(enrichment: Record<string, any> | null): { kind: string; title: string; body: string }[] {
  if (!enrichment) {
    return [{
      kind: "teal",
      title: "Demographics",
      body: `<div class="ai-card__stat-label">No variables selected, or unavailable — check the Demographics (GeoEnrichment) privilege on your API key.</div>`,
    }];
  }

  const cards: { kind: string; title: string; body: string }[] = [];

  const popHtml = buildNearbyPopulation(enrichment);
  if (popHtml) cards.push({ kind: "teal", title: "Population analysis", body: popHtml });

  const donutHtml = buildConsumerStylesDonut(enrichment);
  if (donutHtml) cards.push({ kind: "purple", title: "Lifestyle segmentation", body: donutHtml });

  const pyramidHtml = buildAgePyramid(enrichment);
  if (pyramidHtml) cards.push({ kind: "teal", title: "Age-group segmentation", body: pyramidHtml });

  const householdCard = buildGenericCollectionCard(householdsCollection, enrichment);
  if (householdCard) cards.push({ kind: "teal", title: "Household analysis", body: householdCard.body });

  const incomeCard = buildGenericCollectionCard(purchasingPowerCollection, enrichment);
  if (incomeCard) cards.push({ kind: "teal", title: "Income-based analysis", body: incomeCard.body });

  const spendingCard = buildGenericCollectionCard(spendingCollection, enrichment);
  if (spendingCard) cards.push({ kind: "teal", title: "Consumer spending on Food & Beverages", body: spendingCard.body });

  if (cards.length === 0) {
    return [{ kind: "teal", title: "Demographics", body: `<div class="ai-card__stat-label">No data returned for the selected variables in this catchment.</div>` }];
  }

  return cards;
}

async function appendDemographicCards(
  container: HTMLElement,
  cards: { kind: string; title: string; body: string }[],
  x: number,
  y: number,
  catchment: Catchment
) {
  for (const c of cards) {
    const card = document.createElement("div");
    card.className = "ai-card";
    card.dataset.kind = c.kind;
    card.innerHTML = `<div class="ai-card__header">${c.title}</div><div class="ai-card__body">${c.body}</div>`;
    container.appendChild(card);

    const minimap = card.querySelector(".ai-card__minimap");
    if (minimap) await createMiniMap(minimap as HTMLDivElement, x, y, catchment);
  }
}

// -------------------------------------------------------------------------

async function renderResults(root: HTMLDivElement, data: any) {
  destroyAllViews();

  const {
    locationName, location, elevation, elevationSamples,
    demographicsSections, poiByCategory, summaryLabel,
  } = data as {
    locationName: string; location: { x: number; y: number };
    elevation: number | null; elevationSamples: number[];
    demographicsSections: { label: string; catchment: Catchment; enrichment: Record<string, any> | null }[];
    poiByCategory: Record<string, PoiResult[]>;
    summaryLabel: string;
  };
  const roughness = stdDev(elevationSamples || []);
  const x = location.x, y = location.y;

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
  `;

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
  const sceneLayer = new GraphicsLayer();
  sceneLayer.add(pointGraphic(x, y));
  currentSceneView = new SceneView({
    container: sceneDiv,
    map: new Map({ basemap: "arcgis/topographic", ground: "world-elevation", layers: [sceneLayer] }),
    center: [x, y],
    zoom: 17,
    ui: { components: ["attribution"] },
  });
  await currentSceneView.when();
  currentSceneView.goTo({ tilt: 45 }, { animate: false });

  const basemapGallery = new BasemapGallery({ view: currentSceneView });
  const basemapExpand = new Expand({ view: currentSceneView, content: basemapGallery, expandIcon: "basemap", expandTooltip: "Change basemap" });
  currentSceneView.ui.add(basemapExpand, "top-right");

  addLeftCard("amber", "Elevation", elevation != null
    ? `<div class="ai-card__stat">${elevation.toFixed(1)} m</div><div class="ai-card__stat-label">Above sea level</div>`
    : `<div class="ai-card__stat-label">Unavailable — check the Elevation privilege on your API key.</div>`);

  addLeftCard("amber", "Terrain roughness", `
    <div class="ai-card__stat">${roughness.toFixed(2)}</div>
    <div class="ai-card__stat-label">Std. dev. of nearby elevation samples (real, derived)</div>
  `);

  const walkSection = demographicsSections.find((s) => s.label.toLowerCase().includes("walk")) ?? demographicsSections[0];
  const driveSection = demographicsSections.find((s) => s.label.toLowerCase().includes("drive")) ?? demographicsSections[1];

  const bigMapDiv = root.querySelector("#big-map") as HTMLDivElement;
  const legendContainer = document.createElement("div");
  await createBigMap(bigMapDiv, legendContainer, x, y, walkSection, driveSection, poiByCategory);

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
    await appendDemographicCards(col, cards, x, y, section.catchment);
  }
}
