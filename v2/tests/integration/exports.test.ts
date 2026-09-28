import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
// @ts-ignore local runtime
import { engine, migrate } from "../../scripts/runtime-lib.mjs";
// @ts-ignore local build
import { workerBuild } from "../../scripts/build.mjs";
import { observe } from "../../apps/api/src/services/observations";
import {
  createExport,
  stepExport,
  downloadExport,
} from "../../apps/api/src/services/exports";
import { rows, one } from "../../apps/api/src/repositories/db";
import type { Context } from "../../apps/api/src/services/commands";
let mf: any, db: D1Database, c: Context, cfg: any, dir: string;
before(async () => {
  await workerBuild();
});
beforeEach(async () => {
  cfg = {
    installationId: crypto.randomUUID(),
    mode: "DEMO",
    webOrigin: "http://127.0.0.1:5293",
    bootstrap: "test",
    serviceToken: "test",
    appCodeSha: "export-tests",
  };
  dir = ".runtime-v2/export-" + cfg.installationId;
  mf = engine(cfg, dir, { port: 0 });
  db = await mf.getD1Database("DB");
  await migrate(db, cfg);
  c = { db, installationId: cfg.installationId, now: Date.now() };
});
afterEach(async () => {
  await mf.dispose();
});
test("A75 full export freezes high water before pages; survives restart and concurrent steps", async () => {
  await observe(c, "seed");
  const q = await one(db, "SELECT * FROM quote_sets LIMIT 1");
  await db
    .prepare(
      "WITH RECURSIVE seq(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<321) INSERT INTO quote_sets SELECT 'export-quote-'||n,?,?,?,?+n,NULL,'PREMATCH_OBSERVED',0,'TEST' FROM seq",
    )
    .bind(q.marketId, q.sourceSnapshotId, q.providerId, c.now)
    .run();
  const [job, duplicate] = await Promise.all([
    createExport(c, "export"),
    createExport(c, "export"),
  ]);
  assert.deepEqual(job, duplicate);
  await assert.rejects(downloadExport(db, job.id), /EXPORT_NOT_COMPLETE/);
  await observe(c, "after-watermark");
  for (let i = 0; i < 5; i++) await stepExport(c);
  await mf.dispose();
  mf = engine(cfg, dir, { port: 0 });
  db = await mf.getD1Database("DB");
  c = { ...c, db };
  for (let i = 0; i < 60; i++) {
    await Promise.all([stepExport(c), stepExport(c)]);
    if (
      (await one(db, "SELECT state FROM export_jobs WHERE id=?", job.id))
        .state === "COMPLETE"
    )
      break;
  }
  const state = await one(db, "SELECT * FROM export_jobs WHERE id=?", job.id);
  assert.equal(state.state, "COMPLETE");
  const response = await downloadExport(db, job.id),
    lines = (await response.text())
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
  assert.equal(lines[0].rows, lines.length - 1);
  assert.equal(lines.filter((x) => x.table === "quote_sets").length, 322);
  assert.equal(
    new Set(lines.filter((x) => x.table === "quote_sets").map((x) => x.data.id))
      .size,
    322,
  );
  assert.equal(lines.filter((x) => x.table === "fixture_revisions").length, 1);
  let chain = crypto.createHash("sha256").update("").digest("hex");
  for (const chunk of await rows(
    db,
    "SELECT * FROM export_chunks WHERE jobId=? ORDER BY ordinal",
    job.id,
  )) {
    assert.equal(
      crypto.createHash("sha256").update(chunk.content).digest("hex"),
      chunk.sha256,
    );
    chain = crypto
      .createHash("sha256")
      .update(chain + chunk.sha256)
      .digest("hex");
  }
  assert.equal(chain, state.chainHash);
  assert.equal((await stepExport(c)).active, false);
});
test("A32 export chunk receipt and cursor rollback together on injected fault", async () => {
  await observe(c, "seed");
  const job = await createExport(c, "export");
  const original = await one(
    db,
    "SELECT * FROM export_jobs WHERE id=?",
    job.id,
  );
  await assert.rejects(stepExport({ ...c, failAt: 2 }));
  assert.deepEqual(
    await one(db, "SELECT * FROM export_jobs WHERE id=?", job.id),
    original,
  );
  assert.equal((await rows(db, "SELECT * FROM export_chunks")).length, 0);
  await stepExport(c);
  assert.equal((await rows(db, "SELECT * FROM export_chunks")).length, 1);
});
