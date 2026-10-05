import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parse as parseCSV } from "csv-parse/sync";
import { root } from "./safety.mjs";
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
export async function importLegacyWorkspace(c, base) {
  const configPath = path.join(root, ".runtime-v2/workspace-sources.json");
  if (!fs.existsSync(configPath))
    return {
      status: "NO_EXISTING_EXPORT_CONFIG",
      reason: "自动迁移仅读取已定位的静态一致导出",
    };
  const paths = JSON.parse(fs.readFileSync(configPath, "utf8"));
  for (const p of [paths.exportDirectory, paths.legacySource])
    if (!path.isAbsolute(p) || fs.realpathSync(p) !== path.resolve(p))
      throw Error("SOURCE_PATH_NOT_VERIFIED");
  const source = fs.readFileSync(
    path.join(paths.legacySource, "public/app.js"),
    "utf8",
  );
  const area = source.slice(
    source.indexOf("const leagues=["),
    source.indexOf("].map(([code,name])"),
  );
  const leagues = [...area.matchAll(/\['([^']+)','([^']+)'\]/g)].map((m) => ({
    code: m[1],
    name: m[2],
  }));
  if (leagues.length < 5) throw Error("LEGACY_LEAGUE_LIST_UNREADABLE");
  const ledgerPath = path.join(paths.exportDirectory, "ledger-and-state.json"),
    buffer = fs.readFileSync(ledgerPath),
    ledger = JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  const hashes = { "ledger-and-state.json": hash(buffer) };
  const post = async (route, payload) => {
    const r = await fetch(base + route, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + c.serviceToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(180000),
    });
    const j = await r.json();
    if (!r.ok) throw Error(j.error?.code || "LOCAL_IMPORT_FAILED");
    return j.data;
  };
  const namespace = "legacy-export-20260925";
  const first = await post("/internal/v2/archive-import", {
    namespace,
    files: [
      { name: "ledger-and-state.json", content: buffer.toString("utf8") },
    ],
  });
  const references = [
    "market_quotes.csv",
    "odds_snapshots.csv",
    "model_forecasts.json",
    "model_outcomes.json",
    "market_results.json",
  ]
    .filter((n) => fs.existsSync(path.join(paths.exportDirectory, n)))
    .map((name) => {
      const b = fs.readFileSync(path.join(paths.exportDirectory, name));
      hashes[name] = hash(b);
      return { name, content: b.toString("utf8") };
    });
  const second = references.length
    ? await post("/internal/v2/archive-import", {
        namespace,
        files: references,
      })
    : null;
  const studyPath = path.join(root, ".runtime-v2/workspace-study.json"),
    study = fs.existsSync(studyPath)
      ? JSON.parse(fs.readFileSync(studyPath, "utf8"))
      : { models: [], limitations: ["研究包本地重放尚未完成"] };
  const sourceCutoffAt = Number(
    ledger.simulation_lab_v1?.updated_at ||
      ledger.simulation_lab_v1?.data?.updatedAt,
  );
  const savedQuoteIndex = {},
    savedFixtureIndex = {};
  const savedQuoteRows = { oneXTwo: 0, markets: 0 };
  const quoteFile = references.find((f) => f.name === "market_quotes.csv");
  if (quoteFile)
    for (const q of parseCSV(quoteFile.content, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
    })) {
      const key = q.league_code + "|" + q.match_id;
      if (!savedQuoteIndex[key])
        savedQuoteIndex[key] = { markets: [], oneXTwo: [] };
      savedQuoteRows.markets++;
      savedQuoteIndex[key].markets.push(q);
      savedFixtureIndex[key] = {
        competition: q.league_code,
        sourceEventId: q.match_id,
        home: q.home,
        away: q.away,
        kickoffAt: Number(q.kickoff_at),
      };
    }
  const oddsFile = references.find((f) => f.name === "odds_snapshots.csv");
  if (oddsFile)
    for (const q of parseCSV(oddsFile.content, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
    })) {
      const key = q.league_code + "|" + q.match_id;
      if (!savedQuoteIndex[key])
        savedQuoteIndex[key] = { markets: [], oneXTwo: [] };
      savedQuoteRows.oneXTwo++;
      savedQuoteIndex[key].oneXTwo.push(q);
    }
  for (const q of Object.values(savedQuoteIndex)) {
    q.markets.sort((a, b) => Number(b.captured_at) - Number(a.captured_at));
    q.markets = q.markets.slice(0, 12);
    q.oneXTwo.sort((a, b) => Number(b.captured_at) - Number(a.captured_at));
    q.oneXTwo = q.oneXTwo.slice(0, 8);
  }
  const observationIndex = new Map();
  for (const collection of ["reviews", "marketReviews"])
    for (const raw of ledger.simulation_lab_v1?.data?.[collection] || []) {
      const contentHash = hash(JSON.stringify(raw));
      const previous = observationIndex.get(contentHash);
      if (previous) previous.collections.push(collection);
      else
        observationIndex.set(contentHash, {
          contentHash,
          collections: [collection],
          raw,
        });
    }
  const metadata = {
    savedResearchObservations: [...observationIndex.values()],
    leagues,
    savedQuoteIndex,
    savedFixtureIndex,
    savedQuoteRows,
    settings: ledger.sim_settings?.data ?? {},
    strategies: (ledger.simulation_lab_v1?.data?.portfolios || []).map(
      ({ tickets, ...p }) => p,
    ),
    sourceFiles: hashes,
    sourceReadAt: paths.sourceReadAt || null,
    legacyPage: "/legacy",
    automaticNewTickets: false,
  };
  const sourceHash = hash(
    JSON.stringify({
      hashes,
      leagues,
      projectionVersion: 4,
      sourceReadAt: paths.sourceReadAt || null,
      studyHash: hash(JSON.stringify(study)),
    }),
  );
  const imported = await post("/internal/v2/workspace-import", {
    sourceHash,
    sourceCutoffAt,
    metadata,
    study,
  });
  for (const [name, digest] of Object.entries(hashes))
    if (
      hash(fs.readFileSync(path.join(paths.exportDirectory, name))) !== digest
    )
      throw Error("READONLY_SOURCE_CHANGED");
  return {
    status: "IMPORTED_READONLY_LEGACY",
    leagues: leagues.length,
    firstBatch: first.id,
    secondBatch: second?.id,
    workspaceImport: imported.id,
    sourceHash,
    sourceCutoffAt,
  };
}
