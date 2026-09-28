import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { root } from "./safety.mjs";
const base =
  process.argv.find((x) => x.startsWith("--python="))?.slice(9) || "python";
const python = path.join(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
if (!fs.existsSync(python))
  execFileSync(base, ["-m", "venv", path.join(root, ".venv")], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
execFileSync(
  python,
  [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "-r",
    process.argv.includes("--research")
      ? "model-runner/requirements-research.txt"
      : "model-runner/requirements.txt",
  ],
  { cwd: root, stdio: "inherit", windowsHide: true },
);
execFileSync(
  python,
  [
    "-c",
    'import sys; assert sys.version_info[:2] == (3,12), "Python 3.12 is the pinned runtime"; print(sys.version)',
  ],
  { stdio: "inherit", windowsHide: true },
);
