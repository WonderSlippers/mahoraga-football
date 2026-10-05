import { build } from "esbuild";
import { build as webBuild } from "vite";
import { fileURLToPath } from "node:url";
export async function workerBuild() {
  await build({
    entryPoints: ["apps/api/src/index.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    outfile: "dist/worker.js",
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await workerBuild();
  await webBuild({ configFile: "apps/web/vite.config.ts" });
}
