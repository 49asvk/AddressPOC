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
}

// TODO: replace name/x/y for each of the 5 with the actual client sites.
// Placeholder coordinates below just point at 5 different Indian cities
// so the dropdown and map have something real to render against.
export const POC_LOCATIONS: PocLocation[] = [
  { id: "loc-1", name: "KPN FF 1099 T Nagar 3", x: 80.238249, y: 13.034878 },
  { id: "loc-2", name: "KPN FF 2005 Alwal", x: 78.5112555, y: 17.499804 },
  { id: "loc-3", name: "KPN FF 2020 Mokila", x: 78.197697, y: 17.428812 },
  { id: "loc-4", name: "KPN FF 3042 Girinagar", x: 77.547451, y: 12.942595 },
  { id: "loc-5", name: "KPN FF 5002 Sreemoolanagaram", x: 76.403008, y: 10.134563 },
];
	
 
 