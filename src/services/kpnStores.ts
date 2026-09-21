import Query from "@arcgis/core/rest/support/Query";
import * as query from "@arcgis/core/rest/query";

// TODO: paste the real KPN_Fresh_Stores FeatureServer layer URL here
// (Layer: KPN, ID 0 -- the layer with FID/place_id/place_name/LAT_LONG/
// Long/Lat fields for all 5 KPN store points). Until this is filled in,
// fetchKpnStoreByName() below always returns null and the app falls back
// to the plain marker at the location's own coordinates, so nothing
// breaks -- the custom KPN pin just doesn't appear yet.
export const KPN_STORES_LAYER_URL = "https://services7.arcgis.com/8phUg7DrlXpKgLyA/arcgis/rest/services/KPN_Fresh_Stores/FeatureServer/0";

export interface KpnStorePoint {
  placeId: string;
  placeName: string;
  x: number;
  y: number;
}

const FIELD_PLACE_NAME = "place_name";

// Matches this PoC's location by its display name (e.g. "KPN FF 2005
// Alwal") against the store layer's place_name field -- the two are the
// same string by construction (src/data/locations.ts names were taken
// straight from this layer), so an exact match is enough.
export async function fetchKpnStoreByName(placeName: string): Promise<KpnStorePoint | null> {
  if (!KPN_STORES_LAYER_URL) return null;
  try {
    const escaped = placeName.replace(/'/g, "''");
    const q = new Query({
      where: `${FIELD_PLACE_NAME} = '${escaped}'`,
      outFields: ["FID", "place_id", "place_name", "Long", "Lat"],
      returnGeometry: true,
      outSpatialReference: { wkid: 4326 } as any,
    });
    const result = await query.executeQueryJSON(KPN_STORES_LAYER_URL, q);
    const f = result.features[0];
    if (!f) {
      console.warn(`No KPN store point found for place_name = "${placeName}" -- check KPN_STORES_LAYER_URL / spelling.`);
      return null;
    }
    const pt = f.geometry as __esri.Point;
    const x = pt?.x ?? Number(f.attributes.Long);
    const y = pt?.y ?? Number(f.attributes.Lat);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      placeId: String(f.attributes.place_id ?? f.attributes.FID ?? ""),
      placeName: String(f.attributes.place_name ?? placeName),
      x,
      y,
    };
  } catch (err) {
    console.error("Failed to fetch KPN store point for", placeName, err);
    return null;
  }
}