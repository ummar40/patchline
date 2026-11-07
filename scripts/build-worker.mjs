// Bundles the worker entry point into dist/worker/main.js. Application code and the generated
// database client are bundled; packages from node_modules stay external and are resolved at
// runtime, so a production install only needs `npm ci --omit=dev`.
import { build } from "esbuild";

await build({
  entryPoints: ["src/worker/main.ts"],
  outfile: "dist/worker/main.js",
  bundle: true,
  packages: "external",
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  tsconfig: "tsconfig.json",
  logLevel: "info",
});
