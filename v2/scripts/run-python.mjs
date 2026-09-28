import { spawn } from "node:child_process";
import path from "node:path";
import { root } from "./safety.mjs";
const python = path.join(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const commands = { "model-parity": "tests/model_parity.py" };
const script = commands[process.argv[2]];
if (!script) throw Error("UNKNOWN_PYTHON_COMMAND");
const child = spawn(python, [script], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});
child.on("error", () => {
  console.error("PYTHON_ENVIRONMENT_MISSING");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
