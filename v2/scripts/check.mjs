import { spawnSync } from "node:child_process";
for (const args of [
  ["node_modules/typescript/bin/tsc", "--noEmit"],
  [
    "node_modules/prettier/bin/prettier.cjs",
    "--check",
    "apps/**/*.{ts,tsx,css,json}",
    "packages/**/*.{ts,json}",
    "scripts/**/*.{ts,mjs}",
    "tests/**/*.{ts,json}",
    "package.json",
    "tsconfig.json",
    "playwright.config.ts",
  ],
  ["scripts/check-boundaries.mjs"],
]) {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
