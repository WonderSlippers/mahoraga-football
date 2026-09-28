import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
// @ts-ignore shared runtime
import { engine, migrate } from "./runtime-lib.mjs";
// @ts-ignore shared build
import { workerBuild } from "./build.mjs";
import {
  observe,
  claim,
  complete,
} from "../apps/api/src/services/observations";
import { one } from "../apps/api/src/repositories/db";
const id = crypto.randomUUID(),
  dir = ".runtime-v2/capacity-" + id;
fs.mkdirSync(dir, { recursive: true });
await workerBuild();
const cfg = {
  installationId: id,
  mode: "DEMO",
  webOrigin: "http://127.0.0.1:5293",
  bootstrap: id,
  serviceToken: id,
  appCodeSha: "SYNTHETIC_CAPACITY_ONLY",
};
const mf = engine(cfg, dir, { port: 0 });
const report: any = {
  mode: "DEMO",
  synthetic: true,
  startedAt: new Date().toISOString(),
  purpose: "actual Worker API capacity, not model validation",
  timings: {},
  failures: [],
};
try {
  const db = await mf.getD1Database("DB");
  await migrate(db, cfg);
  const now = Date.now(),
    c = { db, installationId: id, now };
  await observe(c, "capacity-seed");
  for (let i = 0; i < 2; i++) {
    const job = await claim(c, "capacity");
    await complete(c, job.id, {
      owner: "capacity",
      fencingToken: job.fencingToken,
      bundleHash: job.bundleHash,
      modelHash: job.modelHash,
      central: [0.6, 0.25, 0.15],
      featureCanonical: job.canonical,
    });
  }
  const decision = await one(
    db,
    "SELECT d.id,e.predictionId,e.quoteSelectionId,p.fixtureRevisionId,q.decimalOdds,q.selection FROM decisions d JOIN market_expectations e ON e.id=d.expectationId JOIN predictions p ON p.id=e.predictionId JOIN quote_selections q ON q.id=e.quoteSelectionId WHERE d.accepted=1 LIMIT 1",
  );
  // Performance-only seeding creates coherent joins and an exact matching ledger.
  await db.batch([
    db
      .prepare(
        "INSERT INTO command_receipts VALUES('capacity',?,'bulk','SYNTHETIC',1,'capacity',?)",
      )
      .bind(id, now),
    db
      .prepare(
        "WITH RECURSIVE seq(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<100000) INSERT INTO tickets SELECT 'capacity-'||printf('%06d',n),'demo',?,1,?,'capacity-'||n,'2026-09-28','DEMO' FROM seq",
      )
      .bind(decision.id, now),
    db
      .prepare("INSERT INTO ticket_legs SELECT id,id,?,?,?, ?,?,? FROM tickets")
      .bind(
        decision.fixtureRevisionId,
        decision.quoteSelectionId,
        decision.predictionId,
        decision.decimalOdds,
        decision.selection,
        JSON.stringify({
          market: "1X2",
          selection: decision.selection,
          lineQ: null,
          scope: "REGULATION_90",
        }),
      ),
    db.prepare(
      "INSERT INTO ticket_state SELECT id,0,'OPEN',0,NULL FROM tickets",
    ),
    db.prepare(
      "INSERT INTO ledger_entries SELECT id,'demo','capacity',id,NULL,'PLACE',-1,1,0 FROM tickets",
    ),
    db.prepare(
      "UPDATE portfolios SET available=available-100000,openStake=100000,revision=1 WHERE id='demo'",
    ),
  ]);
  const quote = await one(db, "SELECT * FROM quote_sets LIMIT 1");
  report.quoteMarketId = quote.marketId;
  for (let block = 0; block < 10; block++)
    await db
      .prepare(
        "WITH RECURSIVE seq(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<100000) INSERT INTO quote_sets SELECT 'capacity-quote-'||(?+n),?,?,?,?+n,NULL,'LOAD_SYNTHETIC',0,'LOAD_SYNTHETIC' FROM seq",
      )
      .bind(
        block * 100000,
        quote.marketId,
        quote.sourceSnapshotId,
        quote.providerId,
        now + block * 100000,
      )
      .run();
  const login = await mf.dispatchFetch(
    "http://127.0.0.1:0/api/v2/session/bootstrap",
    {
      method: "POST",
      headers: { Origin: cfg.webOrigin },
      body: JSON.stringify({ passphrase: id }),
    },
  );
  assert.equal(login.status, 200);
  const headers = {
    Cookie: login.headers.get("set-cookie"),
    Origin: cfg.webOrigin,
  };
  const call = async (route: string) => {
    const at = performance.now();
    const response = await mf.dispatchFetch(
      "http://127.0.0.1:0/api/v2" + route,
      { headers },
    );
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(Buffer.byteLength(text) < 65536);
    (report.timings[route] ||= []).push(performance.now() - at);
    return JSON.parse(text).data;
  };
  for (let i = 0; i < 100; i++) {
    await call("/meta");
    const page = await call("/ticket-page");
    assert.equal(page.items.length, 50);
    if (i === 0) {
      const next = await call(
        "/ticket-page?afterAt=" +
          encodeURIComponent(page.nextCursor.at) +
          "&afterId=" +
          page.nextCursor.id,
      );
      assert.equal(next.items.length, 50);
      assert.equal(
        new Set([...page.items, ...next.items].map((t: any) => t.id)).size,
        100,
      );
    }
  }
  const totals = await call("/portfolios/demo/summary");
  assert.equal(totals.tickets, 100000);
  assert.equal(totals.openStake, "100000");
  assert.equal(totals.available, "99900000");
  assert.equal(totals.roi, null);
  const sql =
    "SELECT t.id,s.currentStatus,l.predictionId FROM tickets t JOIN ticket_state s ON s.ticketId=t.id JOIN ticket_legs l ON l.ticketId=t.id ORDER BY t.createdAt DESC,t.id DESC LIMIT 50";
  const page = await db.prepare(sql).all();
  assert.equal(page.results.length, 50);
  assert.ok(page.meta.rows_read <= 1000);
  report.queryPlan = (
    await db.prepare("EXPLAIN QUERY PLAN " + sql).all()
  ).results;
  report.joinedPageRowsRead = page.meta.rows_read;
  report.counts = {
    tickets: 100000,
    legs: (await one(db, "SELECT COUNT(*) n FROM ticket_legs")).n,
    ledgerEntries: (await one(db, "SELECT COUNT(*) n FROM ledger_entries")).n,
    quoteSets: (await one(db, "SELECT COUNT(*) n FROM quote_sets")).n,
  };
  report.quoteQualification =
    "Million synthetic quote-set rows test index capacity; only seed quotes carry complete selections and evidence; not a million validated market observations";
  report.metrics = Object.fromEntries(
    Object.entries(report.timings).map(([route, values]: any) => {
      const ordered = [...values].sort((a, b) => a - b);
      return [
        route,
        {
          samples: values.length,
          p95Ms: ordered[Math.floor(ordered.length * 0.95)],
          maxMs: ordered.at(-1),
        },
      ];
    }),
  );
  report.nodeRss = process.memoryUsage().rss;
  report.exitCode = 0;
} catch (error) {
  report.exitCode = 1;
  report.failures.push(String(error));
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(dir + "/report.json", JSON.stringify(report, null, 2));
  await mf.dispose();
  console.log(
    JSON.stringify({
      dir,
      installationId: id,
      quoteMarketId: report.quoteMarketId,
      exitCode: report.exitCode,
      metrics: report.metrics,
      failures: report.failures,
    }),
  );
}
