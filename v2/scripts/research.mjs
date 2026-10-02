import { spawn } from "node:child_process";
import fs from "node:fs";
const profile =
  process.env.V2_PROFILE ||
  (fs.existsSync(
    new URL("../.runtime-v2/research-general/manifest.json", import.meta.url),
  )
    ? "research-general"
    : "research");
const child = spawn(
  process.execPath,
  ["scripts/runtime.mjs", process.argv[2] || "dev"],
  {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, V2_MODE: "LOCAL_RESEARCH", V2_PROFILE: profile },
  },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
