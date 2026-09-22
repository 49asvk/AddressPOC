// Fixed set of locations for this client PoC. Address geocoding was
// removed in favor of a dropdown over exactly these 5 sites -- replace
// the placeholder coordinates below with the real ones for this client.
// x/y are WGS84 longitude/latitude, same convention used everywhere
// else in this app (see services/geocode.ts's GeocodeResult in the
// original AddressInsights app for reference).

export interface PocLocation {
  id: string;
  name: string;
  x: number;
  y: number;
  // Hosted suitability-analysis layer for this specific site (grid cells
  // scored/ranked by FinalScore). Optional so a location can still work
  // without one -- the big map just skips that layer if it's unset.
  suitabilityLayerUrl?: string;
  // Per-location population-gradient layers (uploaded separately for each
  // catchment) shown on the mini maps under the 5min drive / 10min walk
  // population analysis cards, in place of the old traffic layer there.
  // Both optional -- a mini map just shows the plain basemap + marker if
  // the relevant URL isn't set yet.
  populationLayerUrls?: {
    walk?: string;
    drive?: string;
  };
}

export const POC_LOCATIONS: PocLocation[] = [
  {
    id: "loc-1",
    name: "KPN FF 1099 T Nagar 3",
    x: 80.238249,
    y: 13.034878,
    suitabilityLayerUrl: "https://services7.arcgis.com/8phUg7DrlXpKgLyA/arcgis/rest/services/Candidate_Sites_T_Nagar_3/FeatureServer/1",
  },
  {
    id: "loc-2",
    name: "KPN FF 2005 Alwal",
    x: 78.5112555,
    y: 17.499804,
    suitabilityLayerUrl: "https://services7.arcgis.com/8phUg7DrlXpKgLyA/arcgis/rest/services/Candidate_Sites_Alwal/FeatureServer/1",
  },
  {
    id: "loc-3",
    name: "KPN FF 2020 Mokila",
    x: 78.197697,
    y: 17.428812,
    suitabilityLayerUrl: "https://services7.arcgis.com/8phUg7DrlXpKgLyA/arcgis/rest/services/Candidate_Sites_Mokila/FeatureServer/1",
  },
  {
    id: "loc-4",
    name: "KPN FF 3042 Girinagar",
    x: 77.547451,
    y: 12.942595,
    suitabilityLayerUrl: "https://services7.arcgis.com/8phUg7DrlXpKgLyA/arcgis/rest/services/Candidate_Sites_Girinagar/FeatureServer/1",
  },
  {
    id: "loc-5",
    name: "KPN FF 5002 Sreemoolanagaram",
    x: 76.403008,
    y: 10.134563,
    suitabilityLayerUrl: "https://services7.arcgis.com/8phUg7DrlXpKgLyA/arcgis/rest/services/Candidate_Sites_Sreemoolanagaram/FeatureServer/1",
  },
];