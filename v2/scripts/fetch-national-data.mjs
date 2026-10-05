import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { root } from "./safety.mjs";
// Verification/reproduction only. No training, credentials or ledger access.
const pin = JSON.parse(
  fs.readFileSync(
    path.join(root, "packages/domain/national-model-pin.json"),
    "utf8",
  ),
);
const directory = path.join(root, ".models-local/universal");
fs.mkdirSync(directory, { recursive: true });
for (const source of pin.sources) {
  const url = new URL(source.url);
  if (
    url.hostname !== "raw.githubusercontent.com" ||
    !url.pathname.startsWith("/martj42/international_results/")
  )
    throw Error("UNAPPROVED_DATA_SOURCE");
  const file = path.join(directory, path.basename(url.pathname));
  const hash = (data) => crypto.createHash("sha256").update(data).digest("hex");
  if (fs.existsSync(file)) {
    if (hash(fs.readFileSync(file)) !== source.sha256)
      throw Error("EXISTING_DATA_HASH_MISMATCH");
    console.log("VERIFIED_CACHE", path.basename(file));
    continue;
  }
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error("DATA_HTTP_" + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 40 * 1024 * 1024 || hash(bytes) !== source.sha256)
    throw Error("SOURCE_CHANGED_USE_PINNED_GIT_HISTORY_OR_A_NEW_VARIANT");
  fs.writeFileSync(file, bytes, { flag: "wx" });
  console.log("VERIFIED_SOURCE", path.basename(file));
}
