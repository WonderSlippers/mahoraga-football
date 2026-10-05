import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
// @ts-ignore shared local runtime
import { engine, migrate } from "./runtime-lib.mjs";
// @ts-ignore shared build
import { workerBuild } from "./build.mjs";
import {
  observe,
  claim,
  complete,
} from "../apps/api/src/services/observations";
import { one } from "../apps/api/src/repositories/db";
const id = crypto.randomUUID();
const dir = path.resolve(".runtime-v2/load-" + id);
fs.mkdirSync(dir, { recursive: true });
const startedAt = new Date().toISOString();
const report: any = {
  id,
  mode: "DEMO",
  synthetic: true,
  startedAt,
  pid: process.pid,
  phase: "SEEDING",
  durationRequiredMs: 3600000,
  samples: 0,
  failures: [],
  latency: [],
  memory: [],
};
const save = () =>
  fs.writeFileSync(
    path.join(dir, "report.json"),
    JSON.stringify(report, null, 2),
  );
fs.writeFileSync(
  ".runtime-v2/active-load.json",
  JSON.stringify({ id, dir, pid: process.pid, startedAt }),
);
await workerBuild();
const mf = engine(
  {
    installationId: id,
    mode: "DEMO",
    webOrigin: "http://127.0.0.1:5273",
    bootstrap: id,
    serviceToken: id,
    appCodeSha: "LOAD_ONLY",
  },
  dir,
  { port: 0 },
);
try {
  const db = await mf.getD1Database("DB");
  await migrate(db, {
    installationId: id,
    mode: "DEMO",
    appCodeSha: "LOAD_ONLY",
  });
  const c = { db, installationId: id, now: Date.now() };
  await observe(c, "load-seed");
  const job = await claim(c, "load");
  await complete(c, job.id, {
    owner: "load",
    fencingToken: job.fencingToken,
    bundleHash: job.bundleHash,
    modelHash: job.modelHash,
    central: [0.6, 0.25, 0.15],
    featureCanonical: job.canonical,
  });
  const d = await one(db, "SELECT id FROM decisions LIMIT 1");
  await db
    .prepare(
      "WITH RECURSIVE seq(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<100000) INSERT INTO tickets SELECT 'load-'||n,'demo',?,1,?+n,'load-'||n,'2026-09-28','DEMO' FROM seq",
    )
    .bind(d.id, c.now)
    .run();
  const quote = await one(db, "SELECT * FROM quote_sets LIMIT 1");
  for (let block = 0; block < 10; block++) {
    await db
      .prepare(
        "WITH RECURSIVE seq(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<100000) INSERT INTO quote_sets SELECT 'load-quote-'||(?+n),?,?,?,?+?+n,NULL,'PREMATCH_OBSERVED',0,'LOAD_ONLY' FROM seq",
      )
      .bind(
        block * 100000,
        quote.marketId,
        quote.sourceSnapshotId,
        quote.providerId,
        c.now,
        block * 100000,
      )
      .run();
    console.log("SEEDED_QUOTES", (block + 1) * 100000);
  }
  report.counts = {
    tickets: (await one(db, "SELECT COUNT(*) n FROM tickets")).n,
    quotes: (await one(db, "SELECT COUNT(*) n FROM quote_sets")).n,
  };
  report.plans = {
    tickets: (
      await db
        .prepare(
          "EXPLAIN QUERY PLAN SELECT id,stakeAtoms FROM tickets ORDER BY createdAt DESC,id DESC LIMIT 50",
        )
        .all()
    ).results,
    quotes: (
      await db
        .prepare(
          "EXPLAIN QUERY PLAN SELECT id,observedAt FROM quote_sets WHERE marketId=? ORDER BY observedAt DESC,id DESC LIMIT 50",
        )
        .bind(quote.marketId)
        .all()
    ).results,
  };
  const begin = performance.now();
  let lastSample = begin;
  report.phase = "RUNNING";
  report.loadStartedAt = new Date().toISOString();
  report.maxSampleGapMs = 0;
  report.runtimeVersion = JSON.parse(
    fs.readFileSync("node_modules/miniflare/package.json", "utf8"),
  ).version;
  save();
  while (performance.now() - begin < 3600000) {
    const t = performance.now();
    const gap = t - lastSample;
    report.maxSampleGapMs = Math.max(report.maxSampleGapMs, gap);
    lastSample = t;
    if (gap > 15000) throw Error("CONTINUITY_GAP_EXCEEDED_15_SECONDS");
    const result = await db.batch([
      db.prepare("SELECT state,COUNT(*) count FROM jobs GROUP BY state"),
      db.prepare(
        "SELECT id,stakeAtoms FROM tickets ORDER BY createdAt DESC,id DESC LIMIT 50",
      ),
      db
        .prepare(
          "SELECT id,observedAt FROM quote_sets WHERE marketId=? ORDER BY observedAt DESC,id DESC LIMIT 50",
        )
        .bind(quote.marketId),
    ]);
    const bytes = Buffer.byteLength(
      JSON.stringify(result.map((r: any) => r.results)),
    );
    const reads = result.map((r: any) => r.meta.rows_read);
    if (bytes > 65536 || reads.some((n: number) => n > 1000))
      throw Error("QUERY_BUDGET_EXCEEDED");
    report.latency.push(performance.now() - t);
    report.samples++;
    report.maxBytes = Math.max(report.maxBytes || 0, bytes);
    report.maxRowsRead = Math.max(report.maxRowsRead || 0, ...reads);
    if (report.samples % 60 === 1) {
      let owned: any = null;
      if (process.platform === "win32") {
        const script = `$all=Get-CimInstance Win32_Process; $ids=@(${process.pid}); for($i=0;$i -lt 4;$i++){ $ids+=@($all | Where-Object { $_.ParentProcessId -in $ids } | Select-Object -ExpandProperty ProcessId); $ids=@($ids | Select-Object -Unique) }; @($all | Where-Object { $_.ProcessId -in $ids } | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize) | ConvertTo-Json -Compress`;
        owned = JSON.parse(
          execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
            encoding: "utf8",
            windowsHide: true,
          }),
        );
      }
      report.memory.push({
        at: new Date().toISOString(),
        nodeRss: process.memoryUsage().rss,
        ownedProcesses: owned,
      });
      report.elapsedMs = performance.now() - begin;
      save();
    }
    await new Promise((r) =>
      setTimeout(r, Math.max(0, 1000 - (performance.now() - t))),
    );
  }
  report.elapsedMs = performance.now() - begin;
  if (performance.now() - lastSample > 15000 || report.samples < 3500)
    throw Error("INSUFFICIENT_CONTINUOUS_SAMPLES");
  const ordered = [...report.latency].sort((a, b) => a - b);
  report.p95Ms = ordered[Math.floor(ordered.length * 0.95)];
  report.p99Ms = ordered[Math.floor(ordered.length * 0.99)];
  report.phase = "COMPLETE";
  report.exitCode = 0;
} catch (e) {
  report.phase = "FAILED";
  report.exitCode = 1;
  report.failures.push(String(e));
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  save();
  await mf.dispose();
  console.log(
    JSON.stringify({ dir, phase: report.phase, exitCode: report.exitCode }),
  );
}
