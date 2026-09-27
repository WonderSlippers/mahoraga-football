import { Miniflare } from "miniflare";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { safeState, root } from "./safety.mjs";
export const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const runtime = () =>
  safeState(path.join(root, ".runtime-v2", process.env.V2_PROFILE || "demo"));
export function config(dir = runtime()) {
  const file = path.join(dir, "manifest.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
export function engine(c, dir, { port = 8788, persist = true, sourceFetch = fetch } = {}) {
  return new Miniflare({
    modules: true,
    scriptPath: path.join(root, "dist/worker.js"),
    compatibilityDate: "2026-05-15",
    host: "127.0.0.1",
    port,
    d1Databases: { DB: "mahoraga-v2-" + c.installationId },
    d1Persist: persist ? path.join(safeState(dir), "d1") : false,
    bindings: {
      INSTALLATION_ID: c.installationId,
      MODE: c.mode,
      WEB_ORIGIN: c.webOrigin,
      API_HOST: "127.0.0.1:" + port,
      BOOTSTRAP_HASH: hash(c.bootstrap),
      SERVICE_TOKEN: c.serviceToken,
      LOCAL_SESSION_TOKEN: c.localSessionToken || "",
      APP_SHA: c.appCodeSha,
    },
    outboundService: async (request) => {
      const u = new URL(request.url);
      if (c.mode !== 'LOCAL_RESEARCH' || request.method !== 'GET' || u.protocol !== 'https:' ||
          u.host !== 'api.openligadb.de' || u.username || u.password || u.search || u.hash ||
          !/^\/getmatchdata\/bl1\/20\d{2}$/.test(u.pathname))
        return new Response('NETWORK_DISABLED', { status: 403 });
      return sourceFetch(u, { redirect: 'error', signal: AbortSignal.timeout(25000), headers: { Accept: 'application/json' } });
    },
  });
}
export async function migrate(db, c) {
  const sql = fs.readFileSync(
    path.join(root, "apps/api/migrations/0001_core.sql"),
    "utf8",
  );
  await db.exec(sql);
  await db.exec(fs.readFileSync(path.join(root, 'apps/api/migrations/0002_sources.sql'), 'utf8'));
  const immutable = [
    "source_snapshots",
    "source_chunks",
    "fixture_revisions",
    "quote_sets",
    "quote_selections",
    "input_bundles",
    "model_manifests",
    "feature_snapshots",
    "predictions",
    "market_expectations",
    "decisions",
    "tickets",
    "ticket_legs",
    "result_observations",
    "result_adjudications",
    "settlement_events",
    "ledger_entries",
    "command_receipts",
    "normalization_receipts",
  ];
  for (const table of immutable)
    for (const action of ["UPDATE", "DELETE"])
      await db.exec(
        `CREATE TRIGGER IF NOT EXISTS immutable_${table}_${action} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_FACT'); END;`,
      );
  const existing = await db.prepare("SELECT * FROM installations").first();
  if (existing) {
    if (existing.id !== c.installationId || existing.mode !== c.mode)
      throw Error("INSTALLATION_MISMATCH");
    await db.prepare('UPDATE installations SET schemaVersion=2 WHERE id=?').bind(c.installationId).run();
    return;
  }
  await db.batch([
    db
      .prepare("INSERT INTO installations VALUES(?,?,?,?,?)")
      .bind(c.installationId, c.mode, 2, c.appCodeSha, Date.now()),
    ...(c.mode === 'DEMO' ? [db.prepare(
      "INSERT INTO portfolios VALUES('demo','DEMO',0,100000000,0,0,100000000,0)",
    )] : []),
  ]);
  for (const id of [
    "MARKET_PROPORTIONAL_V1",
    "DEMO_FIXED_CENTRAL_V1",
    "V6_C388_STRESS_REFERENCE",
    "V7_RETURN_PARTIAL_UNBLENDED",
  ]) {
    if (c.mode !== 'DEMO' && id === 'DEMO_FIXED_CENTRAL_V1') continue;
    const blocked = id.startsWith("V6") || id.startsWith("V7");
    const manifest = {
      id,
      mode: c.mode,
      variant: id,
      outputKind: id.startsWith("V6") ? "SELECTION_STRESS_ONLY" : "CENTRAL_1X2",
      trainCutoffAt: null,
      researchOnly: true,
      status: blocked ? "BLOCKED" : c.mode === 'DEMO' ? "DEMO_ONLY" : "REGISTERED",
      reason: blocked ? "LIVE_FEATURE_BUILDER_AND_INPUTS_MISSING" : null,
    };
    const json = JSON.stringify(manifest);
    await db
      .prepare("INSERT INTO model_manifests VALUES(?,?,?,?,?)")
      .bind(id, json, hash(json), manifest.outputKind, manifest.status)
      .run();
  }
}
