import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
// @ts-ignore local runtime
import { engine, migrate } from "../../scripts/runtime-lib.mjs";
// @ts-ignore local build
import { workerBuild } from "../../scripts/build.mjs";
import {
  importPreview,
  importCommit,
} from "../../apps/api/src/services/imports";
import { rows, one } from "../../apps/api/src/repositories/db";
import type { Context } from "../../apps/api/src/services/commands";
let mf: any, db: D1Database, c: Context;
before(async () => {
  await workerBuild();
});
beforeEach(async () => {
  const config = {
    installationId: crypto.randomUUID(),
    mode: "DEMO",
    webOrigin: "http://127.0.0.1:5273",
    bootstrap: "x",
    serviceToken: "x",
    appCodeSha: "test",
  };
  mf = engine(config, ".runtime-v2/import-tests", { port: 0, persist: false });
  db = await mf.getD1Database("DB");
  await migrate(db, config);
  c = { db, installationId: config.installationId, now: Date.now() };
});
afterEach(async () => {
  await mf.dispose();
});
const files = [
  {
    name: "state.json",
    content: JSON.stringify({
      portfolios: [
        {
          id: "p",
          balance: 999,
          tickets: [
            { id: "t", stake: 20, pnl: 30, legs: [{}, {}], status: "win" },
          ],
        },
      ],
    }),
  },
];
test("A66 interrupted staging is invisible and resumes using same source hash", async () => {
  await assert.rejects(
    importPreview({ ...c, failAt: 0 }, { namespace: "resume", files }),
  );
  assert.equal(
    (await one(db, "SELECT * FROM import_batches")).state,
    "STAGING",
  );
  assert.equal((await rows(db, "SELECT * FROM archive_records")).length, 0);
  const recovered = await importPreview(c, { namespace: "resume", files });
  assert.equal(recovered.state, "PREVIEW");
  assert.equal((await rows(db, "SELECT * FROM import_batches")).length, 1);
});
test("A66 A68 preview cannot publish; changed source refuses; repeated commit is idempotent", async () => {
  const before = await rows(db, "SELECT * FROM portfolios");
  const p = await importPreview(c, { namespace: "legacy", files });
  assert.equal(p.state, "PREVIEW");
  assert.equal((await rows(db, "SELECT * FROM archive_records")).length, 0);
  await assert.rejects(
    importCommit(c, {
      previewId: p.id,
      previewHash: p.previewHash,
      files: [{ ...files[0], content: files[0].content + " " }],
    }),
    /IMPORT_SOURCE_CHANGED/,
  );
  const payload = { previewId: p.id, previewHash: p.previewHash, files };
  const results = await Promise.all(
    Array.from({ length: 10 }, () => importCommit(c, payload)),
  );
  assert.ok(results.every((r) => r.state === "COMMITTED"));
  assert.equal((await rows(db, "SELECT * FROM archive_records")).length, 1);
  assert.deepEqual(await rows(db, "SELECT * FROM portfolios"), before);
  assert.equal((await rows(db, "SELECT * FROM predictions")).length, 0);
  assert.equal(
    (await importPreview(c, { namespace: "legacy", files })).id,
    p.id,
  );
});
test("A67 changed legacy record is quarantined instead of overwriting archived original", async () => {
  const p = await importPreview(c, { namespace: "legacy", files });
  await importCommit(c, { previewId: p.id, previewHash: p.previewHash, files });
  const next = [
    {
      name: "state.json",
      content: files[0].content.replace('"pnl":30', '"pnl":-20'),
    },
  ];
  const second = await importPreview(c, { namespace: "legacy", files: next });
  assert.equal(second.report.portfolios.p.quarantine, 1);
  await importCommit(c, {
    previewId: second.id,
    previewHash: second.previewHash,
    files: next,
  });
  assert.equal(
    (await one(db, "SELECT * FROM archive_records")).pnlAtoms,
    "30000000",
  );
  await assert.rejects(
    db.prepare("UPDATE archive_records SET pnlAtoms=0").run(),
  );
});
test("A32 A66 commit statement faults never expose partial archive or alter money", async () => {
  const p = await importPreview(c, { namespace: "legacy", files });
  for (let failAt = 0; failAt < 4; failAt++) {
    await assert.rejects(
      importCommit(
        { ...c, failAt },
        { previewId: p.id, previewHash: p.previewHash, files },
      ),
      /IMPORT_COMMIT_CONFLICT/,
    );
    assert.equal((await rows(db, "SELECT * FROM archive_records")).length, 0);
    assert.equal(
      (await one(db, "SELECT * FROM import_batches")).state,
      "PREVIEW",
    );
  }
  await importCommit(c, { previewId: p.id, previewHash: p.previewHash, files });
  assert.equal((await rows(db, "SELECT * FROM archive_records")).length, 1);
});

test("A66 simultaneous identical previews converge on one complete staging batch", async () => {
  const previews = await Promise.all(
    Array.from({ length: 8 }, () =>
      importPreview(c, { namespace: "concurrent-preview", files }),
    ),
  );
  assert.ok(
    previews.every((p) => p.id === previews[0].id && p.state === "PREVIEW"),
  );
  assert.equal((await rows(db, "SELECT * FROM import_batches")).length, 1);
  assert.equal((await rows(db, "SELECT * FROM import_rows")).length, 1);
  assert.equal((await rows(db, "SELECT * FROM archive_records")).length, 0);
});
