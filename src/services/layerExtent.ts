import Query from "@arcgis/core/rest/support/Query";
import Extent from "@arcgis/core/geometry/Extent";
import { executeForExtent } from "@arcgis/core/rest/query";

// Used to scope the POI fetch to a location's entire suitability-analysis
// layer instead of the (much smaller) walk-time catchment. executeForExtent
// asks the service itself for the bounding extent of every feature it
// holds (returnExtentOnly under the hood), in the layer's own spatial
// reference -- wrapping the raw xmin/ymin/xmax/ymax/spatialReference JSON
// it returns in an actual Extent instance lets it carry that spatial
// reference along when passed straight into a Query.geometry against a
// differently-projected layer (the POI layer), so it reprojects correctly
// server-side without any manual conversion.
export async function fetchLayerExtent(url: string): Promise<__esri.Extent | null> {
  try {
    const result = await executeForExtent(url, new Query({ where: "1=1" }));
    const raw = result?.extent;
    if (!raw || raw.xmin == null) return null;
    return new Extent({
      xmin: raw.xmin,
      ymin: raw.ymin,
      xmax: raw.xmax,
      ymax: raw.ymax,
      spatialReference: raw.spatialReference,
    });
  } catch (err) {
    console.error("Failed to fetch layer extent for POI scoping -- check the URL:", err, url);
    return null;
  }
}