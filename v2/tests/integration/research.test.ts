import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
// @ts-ignore local runtime
import { engine, migrate } from "../../scripts/runtime-lib.mjs";
// @ts-ignore local build
import { workerBuild } from "../../scripts/build.mjs";
import {
  observe,
  claim,
  complete,
  demoResult,
  heartbeat,
  failJob,
} from "../../apps/api/src/services/observations";
import { adjudicate } from "../../apps/api/src/services/adjudications";
import { reportTrade } from "../../apps/api/src/services/reported";
import { evaluate } from "../../apps/api/src/services/evaluations";
import { rows, one } from "../../apps/api/src/repositories/db";
import type { Context } from "../../apps/api/src/services/commands";
let mf: any, db: D1Database, c: Context;
before(async () => {
  await workerBuild();
});
beforeEach(async () => {
  const cfg = {
    installationId: crypto.randomUUID(),
    mode: "DEMO",
    webOrigin: "http://127.0.0.1:5273",
    bootstrap: "test",
    serviceToken: "test",
    appCodeSha: "test",
  };
  mf = engine(cfg, ".runtime-v2/research-tests", { port: 0, persist: false });
  db = await mf.getD1Database("DB");
  await migrate(db, cfg);
  c = { db, installationId: cfg.installationId, now: Date.now() };
});
afterEach(async () => {
  await mf.dispose();
});
test("A46 heartbeat is fenced; retryable job stops after three actual claims", async () => {
  await observe(c, "q");
  const j = await claim(c, "runner");
  await heartbeat({ ...c, now: c.now + 10000 }, j.id, {
    owner: "runner",
    fencingToken: j.fencingToken,
  });
  await assert.rejects(
    heartbeat(c, j.id, { owner: "wrong", fencingToken: j.fencingToken }),
    /LEASE_EXPIRED/,
  );
  await failJob(c, j.id, {
    owner: "runner",
    fencingToken: j.fencingToken,
    reason: "MODEL_RUNNER_ERROR",
    retryable: true,
  });
  for (let i = 2; i <= 3; i++) {
    const retry = await claim(c, "runner");
    assert.equal(retry.attempts, i);
    await failJob(c, retry.id, {
      owner: "runner",
      fencingToken: retry.fencingToken,
      reason: "MODEL_RUNNER_ERROR",
      retryable: true,
    });
  }
  assert.equal(
    (await one(db, "SELECT * FROM jobs WHERE id=?", j.id)).state,
    "BLOCKED",
  );
  assert.equal((await rows(db, "SELECT * FROM predictions")).length, 0);
});
test("A59 A60 real adjudication service preserves known conflict and requires evidence resolution", async () => {
  const f = await observe(c, "f");
  await demoResult(c, "win", {
    fixtureId: f.id,
    scenario: "WIN",
    expectedRevision: 0,
    reason: "DEMO",
  });
  await demoResult(c, "loss", {
    fixtureId: f.id,
    scenario: "LOSS",
    expectedRevision: 1,
    reason: "DEMO",
  });
  const review = await adjudicate(c, "review", {
    fixtureId: f.id,
    expectedRevision: 2,
    selectedEvidenceId: null,
    reason: "Review all supplied evidence",
  });
  assert.equal(
    (await one(db, "SELECT * FROM result_adjudications WHERE id=?", review.id))
      .state,
    "REVIEW",
  );
  const observation = await one(
    db,
    "SELECT * FROM result_observations WHERE status='LOSS'",
  );
  const fixed = await adjudicate(c, "choose", {
    fixtureId: f.id,
    expectedRevision: 3,
    selectedEvidenceId: observation.id,
    reason: "Explicit operator selected existing evidence",
  });
  const accepted = await one(
    db,
    "SELECT * FROM result_adjudications WHERE id=?",
    fixed.id,
  );
  assert.equal(accepted.state, "ACCEPTED_REGULATION");
  assert.equal(JSON.parse(accepted.evidenceRefs).length, 2);
  assert.equal(accepted.actor, "LOCAL_RESEARCH_OPERATOR");
  assert.equal(
    (await rows(db, "SELECT * FROM result_adjudications")).length,
    4,
  );
});
test("A63 user reported corrections append independently without changing paper balances", async () => {
  const balance = await one(db, "SELECT * FROM portfolios");
  const p = {
    account: "manual",
    externalKey: "claim-1",
    expectedRevision: 0,
    stakeAtoms: "20000000",
    grossClaimAtoms: null,
    currency: "EUR",
    description: "User-reported receipt",
    evidenceNote: "USER_REPORTED TEST ONLY",
    reason: "Initial claim",
  };
  const first = await reportTrade(c, "claim", p);
  assert.deepEqual(await reportTrade(c, "claim", p), first);
  await reportTrade(c, "correct", {
    ...p,
    expectedRevision: 1,
    grossClaimAtoms: "30000000",
    reason: "Receipt payout update",
  });
  const events = await rows(
    db,
    "SELECT * FROM reported_trade_events ORDER BY revision",
  );
  assert.equal(events.length, 2);
  assert.equal(events[0].grossClaimAtoms, null);
  assert.equal(events[1].grossClaimAtoms, "30000000");
  assert.deepEqual(await one(db, "SELECT * FROM portfolios"), balance);
  assert.equal((await rows(db, "SELECT * FROM ledger_entries")).length, 0);
  await assert.rejects(
    db.prepare("UPDATE reported_trade_events SET currency='USD'").run(),
  );
});
test("A76 A77 fixed asOf sample manifest and metrics survive later result correction and pages", async () => {
  const f = await observe(c, "eval");
  const j = await claim(c, "r");
  await complete(c, j.id, {
    owner: "r",
    fencingToken: j.fencingToken,
    bundleHash: j.bundleHash,
    modelHash: j.modelHash,
    central: [0.5, 0.3, 0.2],
    featureCanonical: j.canonical,
  });
  await demoResult({ ...c, now: c.now + 1000 }, "w", {
    fixtureId: f.id,
    scenario: "WIN",
    expectedRevision: 0,
    reason: "DEMO",
  });
  const payload = { asOf: new Date(c.now + 1500).toISOString() };
  const run = await evaluate({ ...c, now: c.now + 2000 }, "eval-run", payload);
  const frozen = await one(
    db,
    "SELECT * FROM evaluation_runs WHERE id=?",
    run.id,
  );
  await demoResult({ ...c, now: c.now + 3000 }, "l", {
    fixtureId: f.id,
    scenario: "LOSS",
    expectedRevision: 1,
    reason: "DEMO correction",
  });
  const again = await evaluate(
    { ...c, now: c.now + 4000 },
    "same-protocol",
    payload,
  );
  assert.equal(again.manifestHash, run.manifestHash);
  assert.deepEqual(again.metrics, run.metrics);
  assert.deepEqual(
    await one(db, "SELECT * FROM evaluation_runs WHERE id=?", run.id),
    frozen,
  );
  assert.ok(Math.abs(run.metrics[j.modelId].brier - 0.38) < 1e-12);
  assert.equal(run.metrics[j.modelId].roi, null);
  assert.equal(
    (
      await rows(
        db,
        "SELECT * FROM evaluation_samples WHERE evaluationId=? AND ordinal>=0 LIMIT 1",
        run.id,
      )
    )[0].predictionId,
    (
      await rows(
        db,
        "SELECT * FROM evaluation_samples WHERE evaluationId=? LIMIT 100",
        run.id,
      )
    )[0].predictionId,
  );
});

test("A76 concurrent evaluation replay has identical receipt and sample count", async () => {
  const p = { asOf: new Date(c.now).toISOString() };
  const results = await Promise.all(
    Array.from({ length: 10 }, () => evaluate(c, "concurrent", p)),
  );
  for (const r of results) assert.deepEqual(r, results[0]);
  assert.equal((await rows(db, "SELECT * FROM evaluation_runs")).length, 1);
});
