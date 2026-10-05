import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { root } from "./safety.mjs";
const destination = path.join(root, ".runtime-v2/research/features");
fs.mkdirSync(destination, { recursive: true });
const leagues = [
  ["eng.1", "E0"],
  ["ger.1", "D1"],
  ["ita.1", "I1"],
  ["esp.1", "SP1"],
  ["fra.1", "F1"],
];
const day = new Date().toISOString().slice(0, 10),
  year = Number(day.slice(0, 4)) - (Number(day.slice(5, 7)) < 7 ? 1 : 0),
  season = String(year).slice(2) + String(year + 1).slice(2);
const manifestFile = path.join(destination, "source-manifest.json");
let existing = fs.existsSync(manifestFile)
  ? JSON.parse(fs.readFileSync(manifestFile))
  : [];
for (const [competition, code] of leagues) {
  const url = `https://football-data.co.uk/mmz4281/${season}/${code}.csv`;
  if (
    existing.some(
      (s) =>
        s.url === url && new Date(s.observedAt).toISOString().startsWith(day),
    )
  )
    continue;
  try {
    // A small daily local personal-research snapshot; no model-weight training or account access.
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw Error("HTTP_" + response.status);
    const data = Buffer.from(await response.arrayBuffer());
    if (
      data.length > 1048576 ||
      !data.toString("utf8").split("\n")[0].includes("FTHG")
    )
      throw Error("SOURCE_FORMAT_REVIEW");
    const sha256 = crypto.createHash("sha256").update(data).digest("hex"),
      name = `${competition}-${season}-${sha256.slice(0, 16)}.csv`,
      file = path.join(destination, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, data, { flag: "wx" });
    existing = existing.filter((s) => s.url !== url);
    existing.push({
      url,
      competition,
      season: year,
      observedAt: Date.now(),
      sha256,
      file: path.relative(root, file),
      scope: "PERSONAL_LOCAL_RESEARCH",
      providerUpdatedAt: null,
    });
    fs.writeFileSync(manifestFile, JSON.stringify(existing, null, 2));
    console.log("HISTORY_CAPTURED", competition, data.length);
  } catch (e) {
    console.error("HISTORY_SOURCE_RETRY", competition, e.message);
  }
}
