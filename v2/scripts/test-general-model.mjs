import path from "node:path";
import { spawnSync } from "node:child_process";
const result = spawnSync(
  path.resolve(
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  ),
  [
    "-X",
    "utf8",
    "-m",
    "unittest",
    "discover",
    "-s",
    "model-runner",
    "-p",
    "test_general.py",
    "-v",
  ],
  { stdio: "inherit", windowsHide: true },
);
process.exitCode = result.status ?? 1;
