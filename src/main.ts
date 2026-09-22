import esriConfig from "@arcgis/core/config";
import "@arcgis/core/assets/esri/themes/light/main.css";
import "./style.css";
import { ARCGIS_API_KEY } from "./config";
import { renderApp } from "./app";

// Vite content-hashes every JS chunk it builds -- including ones
// @arcgis/core loads internally via dynamic import() only when actually
// needed (e.g. SceneLayerView3D, pulled in the first time a scene view
// renders a SceneLayer). Each new deploy replaces those hashed files
// entirely, so a browser tab that's been open since before the latest
// deploy (or that loaded a cached index.html referencing old hashes) can
// try to fetch a chunk file that no longer exists, which throws exactly
// this: "Failed to fetch dynamically imported module: .../SceneLayerView3D-*.js"
// -- with the 3D Buildings layer (or whatever else needed that chunk)
// silently failing to render as a result. There's no way to recover that
// one failed import in place, so this is Vite's own documented fix for
// this exact class of error: reload once to pick up the current
// index.html and its matching, currently-deployed asset hashes.
window.addEventListener("vite:preloadError", () => {
  window.location.reload();
});

// Calcite's web components fetch their icon/font assets from this path
// at runtime. Pointing at the CDN keeps this starter simple -- for a
// real deployment, copy node_modules/@esri/calcite-components/dist/calcite/assets
// into /public and point this at "/assets" instead, so the app doesn't
// depend on js.arcgis.com being reachable in production.

// One key, assigned once here, is what every service call in src/services
// authenticates with -- see config.ts and .env.example for where it comes
// from and what privileges it needs.
esriConfig.apiKey = ARCGIS_API_KEY;

renderApp(document.getElementById("app")!);