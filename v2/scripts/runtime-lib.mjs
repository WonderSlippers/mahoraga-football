import { Miniflare } from "miniflare";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { safeState, root } from "./safety.mjs";
import { migratePaper } from "./migrate-paper.mjs";
import { migrateMultiLeg } from "./migrate-multileg.mjs";
export const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const runtime = () =>
  safeState(path.join(root, ".runtime-v2", process.env.V2_PROFILE || "demo"));
export function config(dir = runtime()) {
  const file = path.join(dir, "manifest.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
export function engine(
  c,
  dir,
  { port = 8788, persist = true, sourceFetch = fetch } = {},
) {
  // This Windows host assigns ephemeral ports in 1024–15000, including
  // Fetch-forbidden ports. Miniflare's binding proxy uses Fetch too.
  // An explicitly unnamed endpoint uses a safe local development range;
  // occupied ports still fail and no existing listener is stopped.
  const selectedPort = port === 0 ? crypto.randomInt(20000, 30000) : port;
  return new Miniflare({
    modules: true,
    scriptPath: path.join(root, "dist/worker.js"),
    compatibilityDate: "2026-05-15",
    host: "127.0.0.1",
    port: selectedPort,
    d1Databases: { DB: "mahoraga-v2-" + c.installationId },
    d1Persist: persist ? path.join(safeState(dir), "d1") : false,
    bindings: {
      INSTALLATION_ID: c.installationId,
      MODE: c.mode,
      WEB_ORIGIN: c.webOrigin,
      API_HOST: "127.0.0.1:" + selectedPort,
      BOOTSTRAP_HASH: hash(c.bootstrap),
      SERVICE_TOKEN: c.serviceToken,
      LOCAL_SESSION_TOKEN: c.localSessionToken || "",
      APP_SHA: c.appCodeSha,
      APP_BUILD_HASH: c.workerBuildHash || "",
    },
    outboundService: async (request) => {
      const u = new URL(request.url);
      if (
        c.mode !== "LOCAL_RESEARCH" ||
        request.method !== "GET" ||
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.hash ||
        !(
          (u.host === "api.openligadb.de" &&
            !u.search &&
            /^\/getmatchdata\/bl1\/20\d{2}$/.test(u.pathname)) ||
          (u.host === "www.jfa.jp" &&
            u.pathname === "/match/news/00036688/" &&
            !u.search) ||
          (u.host === "site.api.espn.com" &&
            /^\/apis\/site\/v2\/sports\/soccer\/[a-z0-9_.]{3,50}\/scoreboard$/.test(
              u.pathname,
            ) &&
            /^\?dates=20\d{6}&limit=100$/.test(u.search)) ||
          (u.host === "site.api.espn.com" &&
            /^\/apis\/site\/v2\/sports\/soccer\/[a-z0-9_.]{3,50}\/summary$/.test(
              u.pathname,
            ) &&
            /^\?event=\d{3,30}$/.test(u.search)) ||
          (u.host === "site.web.api.espn.com" &&
            /^\/apis\/v2\/sports\/soccer\/(?:[a-z]{3}(?:\.w)?\.\d+|usa\.nwsl)\/standings$/.test(
              u.pathname,
            ) &&
            /^\?season=20\d{2}$/.test(u.search))
        )
      )
        return new Response("NETWORK_DISABLED", { status: 403 });
      return sourceFetch(u, {
        redirect: "error",
        signal: AbortSignal.timeout(25000),
        headers: { Accept: "application/json" },
      });
    },
  });
}
export async function migrate(db, c, { schemaOnly = false } = {}) {
  const sql = fs.readFileSync(
    path.join(root, "apps/api/migrations/0001_core.sql"),
    "utf8",
  );
  await db.exec(sql);
  await db.exec(
    fs.readFileSync(
      path.join(root, "apps/api/migrations/0002_sources.sql"),
      "utf8",
    ),
  );
  await db.exec(
    fs.readFileSync(
      path.join(root, "apps/api/migrations/0003_archives.sql"),
      "utf8",
    ),
  );
  await db.exec(
    fs.readFileSync(
      path.join(root, "apps/api/migrations/0004_research.sql"),
      "utf8",
    ),
  );
  await db.exec(
    fs.readFileSync(
      path.join(root, "apps/api/migrations/0005_pages.sql"),
      "utf8",
    ),
  );
  await db.exec(
    fs.readFileSync(
      path.join(root, "apps/api/migrations/0006_health.sql"),
      "utf8",
    ),
  );
  await db.exec(
    fs.readFileSync(
      path.join(root, "apps/api/migrations/0007_exports.sql"),
      "utf8",
    ),
  );
  await db.exec(
    fs.readFileSync(
      path.join(root, "apps/api/migrations/0008_workspace.sql"),
      "utf8",
    ),
  );
  await db.exec(
    fs.readFileSync(
      path.join(root, "apps/api/migrations/0009_comparison.sql"),
      "utf8",
    ),
  );
  await db.exec(
    fs.readFileSync(
      path.join(root, "apps/api/migrations/0010_lifecycle_reads.sql"),
      "utf8",
    ),
  );
  const immutable = [
    "universal_observations",
    "comparison_methods",
    "comparison_features",
    "comparison_observations",
    "workspace_imports",
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
    "import_file_chunks",
    "import_rows",
    "archive_keys",
    "archive_records",
    "import_commits",
    "model_registry_events",
    "reported_trade_events",
    "evaluation_runs",
    "evaluation_samples",
    "export_chunks",
    "market_definitions",
  ];
  await migratePaper(db);
  await migrateMultiLeg(db);
  await db.exec(
    fs.readFileSync(
      path.join(root, "apps/api/migrations/0011_universal_paper.sql"),
      "utf8",
    ),
  );
  for (const table of immutable)
    for (const action of ["UPDATE", "DELETE"])
      await db.exec(
        `CREATE TRIGGER IF NOT EXISTS immutable_${table}_${action} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_FACT'); END;`,
      );
  const existing = await db.prepare("SELECT * FROM installations").first();
  if (existing) {
    if (existing.id !== c.installationId || existing.mode !== c.mode)
      throw Error("INSTALLATION_MISMATCH");
    await db
      .prepare("UPDATE installations SET schemaVersion=12 WHERE id=?")
      .bind(c.installationId)
      .run();
    return;
  }
  if (schemaOnly) return;
  await db.batch([
    db
      .prepare("INSERT INTO installations VALUES(?,?,?,?,?)")
      .bind(c.installationId, c.mode, 12, c.appCodeSha, Date.now()),
    ...(c.mode === "DEMO"
      ? [
          db.prepare(
            "INSERT INTO portfolios VALUES('demo','DEMO',0,100000000,0,0,100000000,0)",
          ),
        ]
      : []),
  ]);
  for (const id of [
    "MARKET_PROPORTIONAL_V1",
    "DEMO_FIXED_CENTRAL_V1",
    "V6_C388_STRESS_REFERENCE",
    "V7_RETURN_PARTIAL_UNBLENDED",
  ]) {
    if (c.mode !== "DEMO" && id === "DEMO_FIXED_CENTRAL_V1") continue;
    const blocked = id.startsWith("V6") || id.startsWith("V7");
    const manifest = {
      id,
      mode: c.mode,
      variant: id,
      outputKind: id.startsWith("V6") ? "SELECTION_STRESS_ONLY" : "CENTRAL_1X2",
      trainCutoffAt: null,
      researchOnly: true,
      status: blocked
        ? "BLOCKED"
        : c.mode === "DEMO"
          ? "DEMO_ONLY"
          : "REGISTERED",
      reason: blocked ? "LIVE_FEATURE_BUILDER_AND_INPUTS_MISSING" : null,
    };
    const json = JSON.stringify(manifest);
    await db
      .prepare("INSERT INTO model_manifests VALUES(?,?,?,?,?)")
      .bind(id, json, hash(json), manifest.outputKind, manifest.status)
      .run();
  }
}
