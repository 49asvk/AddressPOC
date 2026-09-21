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

export interface PoiResult {
  name: string;
  /** Main category, e.g. "Restaurant" -- what the layer/legend/color is keyed on. */
  category: string;
  /** Full sub-category as stored on the feature, e.g. "Restaurant-Indian". */
  description: string;
  x: number;
  y: number;
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
    outFields: ["NAME", DESC_FIELD],
    returnGeometry: true,
    outSpatialReference: { wkid: 4326 } as any,
  });

  const result = await query.executeQueryJSON(POI_LAYER_URL, q);

  return result.features
    .map((f) => {
      const pt = f.geometry as __esri.Point;
      const description = (f.attributes[DESC_FIELD] as string) || mainCategory;
      return {
        name: (f.attributes.NAME as string) || description,
        category: mainCategory,
        description,
        x: pt?.x,
        y: pt?.y,
      };
    })
    .filter((p): p is PoiResult => p.x != null && p.y != null);
}