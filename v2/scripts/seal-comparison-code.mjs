import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { root } from "./safety.mjs";
const hashes = {};
for (const name of [
  "comparison_models.py",
  "prepare_comparison_features.py",
  "research_adapters.py",
  "legacy-bridge.mjs",
]) {
  const relative = "model-runner/" + name,
    bytes = fs.readFileSync(path.join(root, relative)),
    file = path.join(root, ".models-local/frozen/20261001-r1/local-code", name);
  hashes[relative] = crypto.createHash("sha256").update(bytes).digest("hex");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    if (
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(file))
        .digest("hex") !== hashes[relative]
    )
      throw Error("FROZEN_CODE_CHANGED:" + name);
  } else fs.writeFileSync(file, bytes, { flag: "wx" });
}
const data = JSON.stringify(hashes, null, 2) + "\n",
  file = path.join(root, "model-runner/comparison-code-pins.json");
if (fs.existsSync(file) && fs.readFileSync(file, "utf8") !== data)
  throw Error("FROZEN_CODE_CHANGED");
if (!fs.existsSync(file)) fs.writeFileSync(file, data, { flag: "wx" });
console.log("FROZEN_LOCAL_CODE", Object.keys(hashes).length);
