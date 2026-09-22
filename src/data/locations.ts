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
  // Per-location population-gradient (H10 hex grid) layer shown on the
  // mini maps under both the 5min drive and 10min walk population
  // analysis cards, in place of the old traffic layer there. One layer
  // per location -- it already covers the full area around the site, so
  // the same URL is used for both catchments' mini maps, just centered/
  // zoomed to each catchment separately. Optional so a location without
  // one yet just shows the plain basemap + marker.
  populationLayerUrl?: string;
}

export const POC_LOCATIONS: PocLocation[] = [
  {
    id: "loc-1",
    name: "KPN FF 1099 T Nagar 3",
    x: 80.238249,
    y: 13.034878,
    suitabilityLayerUrl: "https://services7.arcgis.com/8phUg7DrlXpKgLyA/arcgis/rest/services/Candidate_Sites_T_Nagar_3/FeatureServer/1",
    populationLayerUrl: "https://services7.arcgis.com/8phUg7DrlXpKgLyA/arcgis/rest/services/KPN_HexGridH10_TNagar3_EnrichLayer/FeatureServer/0",
  },
  {
    id: "loc-2",
    name: "KPN FF 2005 Alwal",
    x: 78.5112555,
    y: 17.499804,
    suitabilityLayerUrl: "https://services7.arcgis.com/8phUg7DrlXpKgLyA/arcgis/rest/services/Candidate_Sites_Alwal/FeatureServer/1",
    populationLayerUrl: "https://services7.arcgis.com/8phUg7DrlXpKgLyA/arcgis/rest/services/KPN_HexGridH10_Alwal_EnrichLayer/FeatureServer/0",
  },
  {
    id: "loc-3",
    name: "KPN FF 2020 Mokila",
    x: 78.197697,
    y: 17.428812,
    suitabilityLayerUrl: "https://services7.arcgis.com/8phUg7DrlXpKgLyA/arcgis/rest/services/Candidate_Sites_Mokila/FeatureServer/1",
    populationLayerUrl: "https://services7.arcgis.com/8phUg7DrlXpKgLyA/arcgis/rest/services/KPN_HexGridH10_Mokila_EnrichLayer/FeatureServer/0",
  },
  {
    id: "loc-4",
    name: "KPN FF 3042 Girinagar",
    x: 77.547451,
    y: 12.942595,
    suitabilityLayerUrl: "https://services7.arcgis.com/8phUg7DrlXpKgLyA/arcgis/rest/services/Candidate_Sites_Girinagar/FeatureServer/1",
    populationLayerUrl: "https://services7.arcgis.com/8phUg7DrlXpKgLyA/arcgis/rest/services/KPN_HexGridH10_Girinagar_EnrichLayer/FeatureServer/0",
  },
  {
    id: "loc-5",
    name: "KPN FF 5002 Sreemoolanagaram",
    x: 76.403008,
    y: 10.134563,
    suitabilityLayerUrl: "https://services7.arcgis.com/8phUg7DrlXpKgLyA/arcgis/rest/services/Candidate_Sites_Sreemoolanagaram/FeatureServer/1",
    populationLayerUrl: "https://services7.arcgis.com/8phUg7DrlXpKgLyA/arcgis/rest/services/KPN_HexGridH10_Sreemoolanagaram_EnrichLayer/FeatureServer/0",
  },
];