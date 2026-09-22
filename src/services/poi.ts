import Query from "@arcgis/core/rest/support/Query";
import * as query from "@arcgis/core/rest/query";
import type { Catchment } from "./catchment";

export const POI_LAYER_URL = "https://services7.arcgis.com/8phUg7DrlXpKgLyA/arcgis/rest/services/KPN_POIs_15min/FeatureServer/0";

// This layer's own category field is fine-grained -- ~100 distinct
// values like "Restaurant-Indian", "Shop-Variety Store", each following
// a "<Main category>-<Sub category>" convention. The main category (the
// text before the first hyphen) is what drives the picker/legend/layers,
// so all restaurant subtypes group under one "Restaurant" checkbox
// instead of listing every one of the ~100 individually.
const DESC_FIELD = "ESRI_INDIA_CATEGORY_DESC";

// Field storing each POI's brand/chain name (e.g. "Dominos", "Reliance
// Trends"), null/empty for independent, non-branded POIs -- this is what
// the brand-wise breakdown in the POI count table groups on. NOTE: this
// field name has NOT been verified against the live layer (this app was
// built in a sandbox that can't reach services7.arcgis.com -- it's
// blocked outbound, and a direct fetch of this layer's own ?f=json
// definition hit a "Token Required" auth wall). Confirm/correct this
// against the layer's actual field list. If it's wrong, the queries below
// automatically detect that and fall back to querying without it (see
// executeQueryWithBrandFallback), so a wrong guess here degrades to
// "everything shows as Other" rather than breaking POI fetching entirely.
const BRAND_FIELD = "BRAND_NAME";

export interface PoiResult {
  name: string;
  /** Main category, e.g. "Restaurant" -- what the layer/legend/color is keyed on. */
  category: string;
  /** Full sub-category as stored on the feature, e.g. "Restaurant-Indian". */
  description: string;
  /** Brand/chain name, or null for an independent (non-branded) POI. */
  brand: string | null;
  x: number;
  y: number;
}

// Once a query against BRAND_FIELD fails (most likely because the field
// name above is wrong), every later query in the session stops asking for
// it too -- there's no point re-failing the same request over and over,
// and this keeps a bad field name from doubling every query's round trips.
let brandFieldKnownBad = false;

async function executeQueryWithBrandFallback(q: Query): Promise<{ features: __esri.Graphic[]; brandFieldUsed: boolean }> {
  const tryBrand = !brandFieldKnownBad;
  q.outFields = tryBrand ? ["NAME", DESC_FIELD, BRAND_FIELD] : ["NAME", DESC_FIELD];
  try {
    const result = await query.executeQueryJSON(POI_LAYER_URL, q);
    return { features: result.features, brandFieldUsed: tryBrand };
  } catch (err) {
    if (!tryBrand) throw err;
    console.error(
      `POI query with BRAND_FIELD ("${BRAND_FIELD}") failed -- confirm the real Brand Name field on the KPN_POIs_15min layer in services/poi.ts. Falling back to querying without it for the rest of this session.`,
      err
    );
    brandFieldKnownBad = true;
    q.outFields = ["NAME", DESC_FIELD];
    const result = await query.executeQueryJSON(POI_LAYER_URL, q);
    return { features: result.features, brandFieldUsed: false };
  }
}

function brandOf(attributes: Record<string, any>, brandFieldUsed: boolean): string | null {
  if (!brandFieldUsed) return null;
  const raw = attributes[BRAND_FIELD];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function mainCategoryOf(desc: string): string {
  const idx = desc.indexOf("-");
  return (idx === -1 ? desc : desc.slice(0, idx)).trim();
}

let categoriesPromise: Promise<string[]> | null = null;

export function fetchPoiCategories(): Promise<string[]> {
  if (!categoriesPromise) {
    categoriesPromise = (async () => {
      const q = new Query({
        where: `${DESC_FIELD} IS NOT NULL`,
        outFields: [DESC_FIELD],
        returnDistinctValues: true,
        returnGeometry: false,
        orderByFields: [DESC_FIELD],
      });
      const result = await query.executeQueryJSON(POI_LAYER_URL, q);
      const descriptions = result.features.map((f) => f.attributes[DESC_FIELD] as string).filter(Boolean);
      // Grouped client-side from whatever descriptions actually exist on
      // the layer right now, rather than a hardcoded list -- stays
      // correct even if sub-categories are added/renamed later.
      const mainCategories = Array.from(new Set(descriptions.map(mainCategoryOf))).sort();
      return mainCategories;
    })().catch((err) => {
      console.error("Failed to fetch POI categories -- check POI_LAYER_URL and item access on the API key:", err);
      return [];
    });
  }
  return categoriesPromise;
}

export async function queryNearbyPois(
  x: number,
  y: number,
  mainCategory: string,
  catchment: Catchment
): Promise<PoiResult[]> {
  // The polygon branch needs `type: "polygon"` -- without it the geometry
  // literal fails autocast and Query.geometry never actually gets set,
  // so the spatial filter silently vanishes and the query returns up to
  // maxRecordCount rows with no location constraint at all.
  const geometryParams =
    catchment.kind === "polygon"
      ? {
          geometry: { type: "polygon", rings: catchment.rings, spatialReference: { wkid: 4326 } } as any,
          spatialRelationship: "intersects" as const,
        }
      : {
          geometry: { type: "point", x, y, spatialReference: { wkid: 4326 } } as any,
          distance: catchment.km * 1000,
          units: "meters" as const,
          spatialRelationship: "intersects" as const,
        };

  // LIKE 'MainCategory-%' matches every sub-category under this main
  // category (e.g. "Restaurant-Indian", "Restaurant-Fast Food", ...)
  // without needing a hardcoded list of every sub-category string.
  const escaped = mainCategory.replace(/'/g, "''");
  const q = new Query({
    ...geometryParams,
    where: `${DESC_FIELD} LIKE '${escaped}-%'`,
    returnGeometry: true,
    outSpatialReference: { wkid: 4326 } as any,
  });

  const { features, brandFieldUsed } = await executeQueryWithBrandFallback(q);

  return features
    .map((f) => {
      const pt = f.geometry as __esri.Point;
      const description = (f.attributes[DESC_FIELD] as string) || mainCategory;
      return {
        name: (f.attributes.NAME as string) || description,
        category: mainCategory,
        description,
        brand: brandOf(f.attributes, brandFieldUsed),
        x: pt?.x,
        y: pt?.y,
      };
    })
    .filter((p): p is PoiResult => p.x != null && p.y != null);
}

// Same as queryNearbyPois but scoped to an arbitrary geometry (an Extent,
// typically) instead of a walk/drive Catchment -- used to fetch POIs
// across a location's entire suitability-analysis layer rather than just
// its 10-min walk catchment. The geometry carries its own
// spatialReference (as returned by queryExtent), so this reprojects
// correctly against the POI layer without any manual conversion.
export async function queryPoisInGeometry(geometry: __esri.Geometry, mainCategory: string): Promise<PoiResult[]> {
  const escaped = mainCategory.replace(/'/g, "''");
  const q = new Query({
    geometry: geometry as any,
    spatialRelationship: "intersects",
    where: `${DESC_FIELD} LIKE '${escaped}-%'`,
    returnGeometry: true,
    outSpatialReference: { wkid: 4326 } as any,
  });

  const { features, brandFieldUsed } = await executeQueryWithBrandFallback(q);

  return features
    .map((f) => {
      const pt = f.geometry as __esri.Point;
      const description = (f.attributes[DESC_FIELD] as string) || mainCategory;
      return {
        name: (f.attributes.NAME as string) || description,
        category: mainCategory,
        description,
        brand: brandOf(f.attributes, brandFieldUsed),
        x: pt?.x,
        y: pt?.y,
      };
    })
    .filter((p): p is PoiResult => p.x != null && p.y != null);
}