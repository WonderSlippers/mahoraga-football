import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
// @ts-ignore isolated test runtime
import { engine, migrate } from "../../scripts/runtime-lib.mjs";
// @ts-ignore worker compiler
import { workerBuild } from "../../scripts/build.mjs";
import { observe, claim } from "../../apps/api/src/services/observations";
import {
  registerComparison,
  completeComparison,
  comparisonReport,
} from "../../apps/api/src/services/comparison";
import {
  stmt,
  one,
  rows,
  atomic,
  uid,
} from "../../apps/api/src/repositories/db";
import { canonical, sha } from "../../packages/contracts";
import { demoResult } from "../../apps/api/src/services/observations";
import { adjudicate } from "../../apps/api/src/services/adjudications";
import { COMPARISON_METHODS } from "../../packages/domain/comparison";
let mf: any, c: any, f: any, q: any;
before(workerBuild);
beforeEach(async () => {
  const cfg = {
    installationId: crypto.randomUUID(),
    mode: "DEMO",
    bootstrap: "test",
    serviceToken: "test",
    webOrigin: "http://127.0.0.1:5295",
    appCodeSha: "CONTRACT_TEST_ONLY",
  };
  mf = engine(cfg, ".runtime-v2/comparison-test", { port: 0, persist: false });
  const db = await mf.getD1Database("DB");
  await migrate(db, cfg);
  c = { db, installationId: cfg.installationId, now: Date.now() };
  f = await observe(c, uid());
  q = await one(
    db,
    "SELECT b.* FROM input_bundles b JOIN observation_slots s ON s.id=b.slotId JOIN fixture_revisions r ON r.id=s.fixtureRevisionId WHERE r.fixtureId=?",
    f.id,
  );
  await stmt(db, "UPDATE jobs SET state='BLOCKED',reason='TEST_ONLY'").run();
  await registerComparison(c);
});
afterEach(async () => mf.dispose());
async function bundle(at = c.now) {
  const slot = uid(),
    bundle = uid(),
    input = JSON.parse(q.canonical);
  input.mode = "LOCAL_RESEARCH";
  input.cutoffAt = new Date(at).toISOString();
  input.comparisonFeatures = {
    competition: "eng.1",
    home: "TEST ONLY",
    away: "TEST ONLY",
    goalStats: null,
    featureRow: null,
    featureSources: [],
    featureHash: null,
    offers: [{ market: "1X2", selection: "HOME", lineQ: null, odds: "2" }],
  };
  const text = canonical(input);
  await atomic(c.db, [
    stmt(
      c.db,
      "INSERT INTO observation_slots VALUES(?,?,'CONTRACT_TEST_ONLY',?,?,'QUEUED',NULL)",
      slot,
      input.revisionId,
      at,
      at + 300000,
    ),
    stmt(
      c.db,
      "INSERT INTO input_bundles VALUES(?,?,?,?,?,?,'READY')",
      bundle,
      slot,
      q.quoteSetId,
      at,
      await sha(text),
      text,
    ),
    ...COMPARISON_METHODS.map((m) =>
      stmt(
        c.db,
        "INSERT INTO jobs(id,bundleId,modelId,state,deadlineAt) VALUES(?,?,?,'QUEUED',?)",
        uid(),
        bundle,
        m.id,
        at + 300000,
      ),
    ),
  ]);
  return bundle;
}
function output(j: any) {
  const v6 = j.modelId.startsWith("V6");
  return {
    variant: j.modelId,
    state: "DONE",
    reason: "CONTRACT_TEST_ONLY_NOT_MODEL_VALIDATION",
    researchOnly: true,
    central: v6 ? null : [0.55, 0.25, 0.2],
    stressBySelection: v6 ? { HOME: 0.55, DRAW: null, AWAY: null } : null,
    actions: [
      {
        strategy: v6 ? "V6_NATIVE" : "BROAD_1X2",
        market: "1X2",
        selection: "HOME",
        lineQ: null,
        odds: "2",
        probability: 0.55,
        estimatedEV: 0.1,
      },
    ],
  };
}
function payload(j: any, o = output(j)) {
  return {
    owner: "test",
    fencingToken: j.fencingToken,
    bundleHash: j.bundleHash,
    modelHash: j.modelHash,
    featureCanonical: j.canonical,
    output: o,
  };
}
async function runBoth(at = c.now) {
  await bundle(at);
  for (let i = 0; i < 2; i++) {
    const j = await claim({ ...c, now: at }, "test");
    await completeComparison({ ...c, now: at }, j.id, payload(j));
  }
}
test("paired reports require the same frozen bundle and repeated refresh never increases fixture N", async () => {
  await runBoth();
  await runBoth(c.now + 1000);
  assert.equal((await comparisonReport(c)).totalRecords, 2);
  const later = { ...c, now: c.now + 1000 };
  const report = await comparisonReport(later);
  assert.equal(report.commonFixtureN, 1);
  assert.equal(report.totalRecords, 4);
  const scoped = await comparisonReport(
    later,
    new URLSearchParams({ fixture: f.id }),
  );
  assert.equal(scoped.totalRecords, report.totalRecords);
  assert.deepEqual(
    scoped.records.map((r: any) => r.id),
    report.records.map((r: any) => r.id),
  );
  assert.equal(
    (await comparisonReport(later, new URLSearchParams({ fixture: "absent" })))
      .totalRecords,
    0,
  );
  assert.equal(report.successfulRecords.length, 2);
  const exportPage = await comparisonReport(
    later,
    new URLSearchParams({ export: "1", offset: "2" }),
  );
  assert.equal(exportPage.records.length, 2);
  assert.equal(exportPage.exportNextOffset, null);
  assert.equal(
    (
      await comparisonReport(
        later,
        new URLSearchParams({ before: String(c.now) }),
      )
    ).totalRecords,
    2,
  );
  await assert.rejects(
    comparisonReport(c, new URLSearchParams({ offset: "-1" })),
    /INVALID_FIELDS/,
  );
  for (const m of report.methods) {
    assert.equal(m.successfulFixtureN, 1);
    assert.equal(m.metrics[0].common.predictionN, 1);
    assert.equal(m.metrics[0].common.openN, 1);
    assert.equal(m.metrics[0].common.roi, null);
    assert.equal(m.metrics[0].breakdown.odds[1].common.actionN, 1);
    assert.equal(m.metrics[0].breakdown.odds[0].common.actionN, 0);
  }
  await assert.rejects(
    stmt(c.db, "UPDATE comparison_methods SET label='changed'").run(),
    /IMMUTABLE_FACT/,
  );
});

test("comparison review crosses a 1000-row page without losing chronology, double-counting fixtures or changing capture bounds", async () => {
  await runBoth();
  const seed = await one(
    c.db,
    "SELECT * FROM comparison_observations ORDER BY rowid LIMIT 1",
  );
  for (let start = 0; start < 1001; start += 50) {
    const statements = [];
    for (let i = start; i < Math.min(start + 50, 1001); i++) {
      const slot = uid(),
        bundleId = uid(),
        jobId = uid(),
        at = c.now - i - 1;
      statements.push(
        stmt(
          c.db,
          "INSERT INTO observation_slots VALUES(?,?,'CONTRACT_TEST_PAGING',?,?,'DONE',NULL)",
          slot,
          seed.fixtureRevisionId,
          at,
          c.now + 300000,
        ),
        stmt(
          c.db,
          "INSERT INTO input_bundles VALUES(?,?,?,?,?,?,'READY')",
          bundleId,
          slot,
          q.quoteSetId,
          at,
          q.manifestHash,
          q.canonical,
        ),
        stmt(
          c.db,
          "INSERT INTO jobs(id,bundleId,modelId,state,deadlineAt) VALUES(?,?,?,'DONE',?)",
          jobId,
          bundleId,
          seed.methodId,
          c.now + 300000,
        ),
        stmt(
          c.db,
          "INSERT INTO comparison_observations VALUES(?,?,?,?,?,'DONE',?,?,?)",
          uid(),
          jobId,
          seed.methodId,
          seed.fixtureRevisionId,
          bundleId,
          seed.outputJson,
          seed.outputHash,
          at,
        ),
      );
    }
    await atomic(c.db, statements);
  }
  const report = await comparisonReport(
    c,
    new URLSearchParams({ fixture: f.id, export: "1" }),
  );
  assert.equal(report.totalRecords, 1003);
  assert.equal(report.commonFixtureN, 1);
  const records = [...report.records];
  for (let offset = report.exportNextOffset; offset !== null; ) {
    const page = await comparisonReport(
      c,
      new URLSearchParams({
        fixture: f.id,
        export: "1",
        offset: String(offset),
        before: String(report.recordCaptureBeforeAt),
        sequence: String(report.observationSequence),
        adjudicationSequence: String(report.adjudicationSequence),
      }),
    );
    records.push(...page.records);
    offset = page.exportNextOffset;
  }
  assert.equal(new Set(records.map((r) => r.id)).size, 1003);
  assert.ok(
    records.every((r, i) => i === 0 || records[i - 1].cutoffAt <= r.cutoffAt),
  );
  assert.equal(
    (
      await comparisonReport(
        c,
        new URLSearchParams({ before: String(c.now - 1000), fixture: f.id }),
      )
    ).totalRecords,
    2,
  );
});
test("completion is atomic, lease fenced, idempotent and original predictions stay empty", async () => {
  await bundle();
  const j = await claim(c, "test");
  const p = payload(j);
  await assert.rejects(
    completeComparison(c, j.id, { ...p, fencingToken: j.fencingToken + 1 }),
  );
  assert.equal(
    (await rows(c.db, "SELECT * FROM comparison_observations")).length,
    0,
  );
  assert.equal(
    (await one(c.db, "SELECT * FROM jobs WHERE id=?", j.id)).state,
    "RUNNING",
  );
  const saved = await completeComparison(c, j.id, p);
  assert.deepEqual(await completeComparison(c, j.id, p), saved);
  await assert.rejects(
    completeComparison(c, j.id, {
      ...p,
      output: { ...p.output, reason: "different" },
    }),
    /IDEMPOTENCY_CONFLICT/,
  );
  assert.equal((await rows(c.db, "SELECT * FROM predictions")).length, 0);
  assert.equal((await rows(c.db, "SELECT * FROM tickets")).length, 0);
});
test("normalized V6 probability, quote spoofing and forged EV cannot be accepted", async () => {
  await bundle();
  const j = await claim(c, "test");
  assert.ok(j.modelId.startsWith("V6"));
  const p = payload(j);
  await assert.rejects(
    completeComparison(c, j.id, {
      ...p,
      output: { ...p.output, central: [0.5, 0.3, 0.2] },
    }),
    /STRESS_NORMALIZATION_FORBIDDEN/,
  );
  await assert.rejects(
    completeComparison(c, j.id, {
      ...p,
      output: { ...p.output, actions: [{ ...p.output.actions[0], odds: "3" }] },
    }),
    /QUOTE_MISMATCH/,
  );
  await assert.rejects(
    completeComparison(c, j.id, {
      ...p,
      output: {
        ...p.output,
        actions: [{ ...p.output.actions[0], estimatedEV: 99 }],
      },
    }),
    /MODEL_OUTPUT_INVALID/,
  );
  assert.equal(
    (await rows(c.db, "SELECT * FROM comparison_observations")).length,
    0,
  );
});
test("expired leases and post-kickoff work cannot append observations", async () => {
  await bundle();
  const j = await claim(c, "test");
  await assert.rejects(
    completeComparison({ ...c, now: c.now + 31000 }, j.id, payload(j)),
  );
  await assert.rejects(
    completeComparison({ ...c, now: c.now + 3600001 }, j.id, payload(j)),
    /FEATURE_LATE/,
  );
  assert.equal(
    (await rows(c.db, "SELECT * FROM comparison_observations")).length,
    0,
  );
});
test("result conflicts suspend comparison returns and an appended correction updates metrics without rewriting output", async () => {
  await runBoth();
  const original = await rows(
    c.db,
    "SELECT outputHash FROM comparison_observations ORDER BY id",
  );
  const late = { ...c, now: c.now + 3600001 };
  await demoResult(late, "result-first", {
    fixtureId: f.id,
    scenario: "WIN",
    expectedRevision: 0,
    reason: "Contract test only",
  });
  await adjudicate(late, "accept-first", {
    fixtureId: f.id,
    expectedRevision: 1,
    selectedEvidenceId: null,
    reason: "contract test consistent",
  });
  let report = await comparisonReport(late);
  assert.equal(report.methods[0].metrics[0].common.roi, 1);
  const acceptedSnapshot = new URLSearchParams({
    sequence: String(report.observationSequence),
    adjudicationSequence: String(report.adjudicationSequence),
    before: String(report.recordCaptureBeforeAt),
  });
  assert.equal(report.methods[0].metrics[0].breakdown.odds[1].common.roi, 1);
  assert.equal(report.methods[0].metrics[0].breakdown.seasons[0].common.roi, 1);
  await demoResult(late, "result-conflict", {
    fixtureId: f.id,
    scenario: "LOSS",
    expectedRevision: 2,
    reason: "Contract test only",
  });
  await adjudicate(late, "conflict-review", {
    fixtureId: f.id,
    expectedRevision: 3,
    selectedEvidenceId: null,
    reason: "contract test conflicting observations",
  });
  report = await comparisonReport(late);
  assert.equal(report.methods[0].metrics[0].common.roi, null);
  const evidence = await one(
    c.db,
    "SELECT * FROM result_observations WHERE fixtureId=? AND status='LOSS' ORDER BY observedAt DESC LIMIT 1",
    f.id,
  );
  await adjudicate(late, "correct-append", {
    fixtureId: f.id,
    expectedRevision: 4,
    selectedEvidenceId: evidence.id,
    reason: "contract test evidence selection",
  });
  report = await comparisonReport(late);
  assert.equal(report.methods[0].metrics[0].common.roi, -1);
  assert.equal(
    (await comparisonReport(late, acceptedSnapshot)).methods[0].metrics[0]
      .common.roi,
    1,
  );
  assert.deepEqual(
    await rows(
      c.db,
      "SELECT outputHash FROM comparison_observations ORDER BY id",
    ),
    original,
  );
});
