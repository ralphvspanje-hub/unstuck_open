// Builds the extension into dist/ (load it in chrome://extensions → Load unpacked → dist).
// For tests next to a running server: UNSTUCK_OUT=dist-test UNSTUCK_PORT=4718 builds a copy
// that talks to another port, and leaves dist/ (the one loaded in Chrome) alone.
import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const watch = process.argv.includes("--watch");
const out = process.env.UNSTUCK_OUT || "dist";
const port = String(Number(process.env.UNSTUCK_PORT || 4717));
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
cpSync("extension", out, { recursive: true });
cpSync("node_modules/@mediapipe/tasks-vision/wasm", `${out}/wasm`, { recursive: true });
if (port !== "4717") {
  const manifest = `${out}/manifest.json`;
  writeFileSync(manifest, readFileSync(manifest, "utf8").replaceAll("127.0.0.1:4717", `127.0.0.1:${port}`));
}

const common: esbuild.BuildOptions = {
  bundle: true,
  target: "chrome116",
  logLevel: "info",
  legalComments: "none",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  define: { __UNSTUCK_PORT__: JSON.stringify(port) },
};
const scripts = await esbuild.context({
  ...common,
  format: "iife",
  entryPoints: { page: "src/page/page.ts", content: "src/content/content.ts", panopto: "src/content/panopto.ts", sim: "src/sim/sim.ts", three: "src/sim/three-global.js" },
  outdir: out,
});
const modules = await esbuild.context({
  ...common,
  format: "esm",
  entryPoints: { background: "src/background/background.ts", offscreen: "src/offscreen/offscreen.ts", setup: "src/setup/setup.ts", camera: "src/camera/camera.ts" },
  outdir: out,
});

if (!existsSync("extension/assets/face_landmarker.task")) {
  console.warn("⚠️  Face model missing: run `npm run fetch-model`. Until then Unstuck runs without the camera.");
}
if (watch) {
  await Promise.all([scripts.watch(), modules.watch()]);
  console.log("👀 watching src/ (static files in extension/ need a rebuild)");
} else {
  await Promise.all([scripts.rebuild(), modules.rebuild()]);
  await Promise.all([scripts.dispose(), modules.dispose()]);
  console.log(`✅ built ${out}/${port !== "4717" ? ` (server port ${port})` : ""}`);
}
