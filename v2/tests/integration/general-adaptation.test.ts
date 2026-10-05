import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
// @ts-ignore own real workerd runtime
import { engine, migrate } from "../../scripts/runtime-lib.mjs";
// @ts-ignore own build
import { workerBuild } from "../../scripts/build.mjs";
import {
  atomic,
  one,
  stmt,
  uid,
  rows,
} from "../../apps/api/src/repositories/db";
import {
  calibrationSnapshot,
  learningSamples,
  claimGeneralLearning,
  proposeGeneralLearning,
  generalAdaptationReport,
} from "../../apps/api/src/services/general-adaptation";
import { canonical, sha } from "../../packages/contracts";
import { GENERAL_FIXED_ID } from "../../packages/domain/general-adaptation";
let mf: any,
  c: any,
  serial = 0;
before(workerBuild);
beforeEach(async () => {
  const cfg = {
    installationId: crypto.randomUUID(),
    mode: "DEMO",
    webOrigin: "http://127.0.0.1:5295",
    bootstrap: "test",
    serviceToken: "test",
    appCodeSha: "CONTRACT_TEST_ONLY",
  };
  mf = engine(cfg, ".runtime-v2/general-adaptation-test", {
    port: 0,
    persist: false,
  });
  const db = await mf.getD1Database("DB");
  await migrate(db, cfg);
  c = { db, installationId: cfg.installationId, now: Date.now() };
  await stmt(db, "UPDATE installations SET mode='LOCAL_RESEARCH'").run();
  await stmt(
    db,
    "INSERT INTO model_manifests VALUES(?,?,?,'CENTRAL_1X2','CONTRACT_TEST_ONLY')",
    GENERAL_FIXED_ID,
    "{}",
    "TEST_ONLY",
  ).run();
  serial = 0;
});
afterEach(async () => mf.dispose());
// Explicit synthetic software fixtures in a disposable DB, never model validation or production results.
async function seed(
  n: number,
  start: number,
  outcome: (i: number) => number = (i) => i % 3,
  mode = "LOCAL_RESEARCH",
  kickoffDelay = 500,
) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = "CONTRACT_ONLY:" + serial++,
      src = uid(),
      rev = uid(),
      market = uid(),
      qs = uid(),
      slot = uid(),
      bundle = uid(),
      job = uid(),
      observation = uid(),
      adjudication = uid(),
      cutoff = start + i * 1000,
      kickoff = cutoff + kickoffDelay;
    const value = {
        mode,
        fixtureId: id,
        cutoffAt: new Date(cutoff).toISOString(),
        odds: ["2", "4", "4"],
      },
      output = { central: [0.9, 0.05, 0.05], state: "DONE" },
      score =
        outcome(i) === 0
          ? { home: 1, away: 0 }
          : outcome(i) === 1
            ? { home: 0, away: 0 }
            : { home: 0, away: 1 };
    await atomic(c.db, [
      stmt(
        c.db,
        "INSERT INTO source_snapshots VALUES(?,?,?,?,?,NULL,?,?,'COMPLETE')",
        src,
        "CONTRACT_TEST_ONLY",
        id,
        cutoff,
        cutoff,
        "TEST",
        mode === "LOCAL_RESEARCH" ? "LOCAL_RESEARCH" : "DEMO",
      ),
      stmt(
        c.db,
        "INSERT INTO fixtures VALUES(?,?,?,1,'FINISHED')",
        id,
        "CONTRACT HOME",
        "CONTRACT AWAY",
      ),
      stmt(
        c.db,
        "INSERT INTO fixture_revisions VALUES(?,?,1,?,?,?)",
        rev,
        id,
        kickoff,
        cutoff,
        src,
      ),
      stmt(
        c.db,
        "INSERT INTO market_definitions VALUES(?,?,?,'REGULATION_90','1X2')",
        market,
        id,
        id,
      ),
      stmt(
        c.db,
        "INSERT INTO quote_sets VALUES(?,?,?,?,?,NULL,'PREMATCH_PUBLIC_REFERENCE',0,?)",
        qs,
        market,
        src,
        "CONTRACT_TEST_ONLY",
        cutoff,
        "TEST",
      ),
      stmt(
        c.db,
        "INSERT INTO observation_slots VALUES(?,?,'CONTRACT_TEST_ONLY',?,?,'DONE',NULL)",
        slot,
        rev,
        cutoff,
        kickoff,
      ),
      stmt(
        c.db,
        "INSERT INTO input_bundles VALUES(?,?,?,?,?,?,'READY')",
        bundle,
        slot,
        qs,
        cutoff,
        await sha(canonical(value)),
        canonical(value),
      ),
      stmt(
        c.db,
        "INSERT INTO jobs(id,bundleId,modelId,state,deadlineAt) VALUES(?,?,?,'DONE',?)",
        job,
        bundle,
        GENERAL_FIXED_ID,
        kickoff,
      ),
      stmt(
        c.db,
        "INSERT INTO universal_observations VALUES(?,?,NULL,?,?,'DONE',?,?,?)",
        observation,
        job,
        rev,
        bundle,
        canonical(output),
        "TEST",
        cutoff,
      ),
      stmt(
        c.db,
        "INSERT INTO result_adjudications VALUES(?,?,1,'ACCEPTED_REGULATION',?,'[]','CONTRACT_TEST_ONLY','TEST',NULL)",
        adjudication,
        id,
        canonical(score),
      ),
      stmt(
        c.db,
        "INSERT INTO command_receipts VALUES(?,?,?,?,1,?,?)",
        uid(),
        "CONTRACT_RESULT",
        id,
        "TEST",
        adjudication,
        kickoff + 500,
      ),
    ]);
    ids.push(id);
  }
  return ids;
}
async function refreshed(ids: string[], start: number) {
  for (let i = 0; i < ids.length; i++) {
    const old = await one(
      c.db,
      "SELECT o.fixtureRevisionId,b.quoteSetId FROM universal_observations o JOIN input_bundles b ON b.id=o.bundleId JOIN fixture_revisions r ON r.id=o.fixtureRevisionId WHERE r.fixtureId=? LIMIT 1",
      ids[i],
    );
    const cutoff = start + i * 1000,
      slot = uid(),
      bundle = uid(),
      job = uid(),
      raw = canonical({
        mode: "LOCAL_RESEARCH",
        fixtureId: ids[i],
        odds: ["2", "4", "4"],
      });
    await atomic(c.db, [
      stmt(
        c.db,
        "INSERT INTO observation_slots VALUES(?,?,'CONTRACT_REFRESH',?,?,'DONE',NULL)",
        slot,
        old.fixtureRevisionId,
        cutoff,
        cutoff + 1000,
      ),
      stmt(
        c.db,
        "INSERT INTO input_bundles VALUES(?,?,?,?,?,?,'READY')",
        bundle,
        slot,
        old.quoteSetId,
        cutoff,
        await sha(raw),
        raw,
      ),
      stmt(
        c.db,
        "INSERT INTO jobs(id,bundleId,modelId,state,deadlineAt) VALUES(?,?,?,'DONE',?)",
        job,
        bundle,
        GENERAL_FIXED_ID,
        cutoff + 1000,
      ),
      stmt(
        c.db,
        "INSERT INTO universal_observations VALUES(?,?,NULL,?,?,'DONE',?,'TEST',?)",
        uid(),
        job,
        old.fixtureRevisionId,
        bundle,
        canonical({ central: [0.9, 0.05, 0.05], state: "DONE" }),
        cutoff,
      ),
    ]);
  }
}
async function proposal() {
  const first = await claimGeneralLearning(c, "learner");
  assert.ok(first.job);
  const j = first.job;
  const run = spawnSync(
    path.resolve(".venv/Scripts/python.exe"),
    [
      "-c",
      "import json,sys;from general_adaptation import fit;print(json.dumps(fit(json.load(sys.stdin))))",
    ],
    {
      cwd: path.resolve("model-runner"),
      input: JSON.stringify(j),
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert.equal(run.status, 0, run.stderr);
  const p = {
    owner: "learner",
    fencingToken: j.fencingToken,
    trainingHash: j.trainingHash,
    parameters: JSON.parse(run.stdout),
  };
  return { j, p };
}
test("learner has train-only data, persistent leases, bounded proposal and idempotent replay", async () => {
  await seed(60, c.now - 100000);
  const { j, p } = await proposal();
  assert.equal(j.training.length, 60);
  assert.equal("validation" in j, false);
  assert.equal((await claimGeneralLearning(c, "other")).state, "BUSY");
  assert.equal((await proposeGeneralLearning(c, j.id, p)).state, "VALIDATING");
  assert.equal((await proposeGeneralLearning(c, j.id, p)).replayed, true);
  await assert.rejects(
    proposeGeneralLearning(c, j.id, {
      ...p,
      parameters: { modelTrust: 1, temperature: 1.05 },
    }),
    /IDEMPOTENCY_CONFLICT/,
  );
  const restarted = { ...c };
  assert.equal(
    (await claimGeneralLearning(restarted, "recovered")).state,
    "VALIDATING",
  );
  assert.equal((await calibrationSnapshot(c)).revision, 0);
  await assert.rejects(
    stmt(
      c.db,
      "UPDATE general_learning_jobs SET trainingJson='[]' WHERE id=?",
      j.id,
    ).run(),
    /IMMUTABLE_FACT/,
  );
});
test("only thirty genuinely subsequent fixtures can apply a change; old predictions stay byte identical", async () => {
  await seed(60, c.now - 100000);
  const before = await rows(
    c.db,
    "SELECT id,outputJson FROM universal_observations ORDER BY id",
  );
  const { j, p } = await proposal();
  await proposeGeneralLearning(c, j.id, p);
  await seed(35, c.now - 50000);
  const early = await claimGeneralLearning(c, "other");
  assert.ok("validationN" in early);
  assert.equal(
    early.validationN,
    0,
    "old-cutoff games cannot validate even if first settled now",
  );
  const proposedAt = c.now;
  await seed(29, proposedAt + 1000);
  c.now += 100000;
  const partial = await claimGeneralLearning(c, "learner");
  assert.ok("validationN" in partial);
  assert.equal(partial.validationN, 29);
  await seed(1, proposedAt + 40000, () => 2);
  await claimGeneralLearning(c, "learner");
  const state = await calibrationSnapshot(c);
  assert.equal(state.revision, 1);
  assert.equal(state.modelTrust, 0.95);
  assert.equal(state.temperature, 1.05);
  assert.deepEqual(
    (
      await rows(
        c.db,
        "SELECT id,outputJson FROM universal_observations ORDER BY id",
      )
    ).filter((r) => before.some((b) => b.id === r.id)),
    before,
  );
  const events = (await generalAdaptationReport(c)).history;
  const applied = events.find((e) => e.kind === "APPLIED");
  assert.ok(applied);
  assert.equal(applied.evidence.validation.length, 30);
  assert.ok(applied.evidence.after.logLoss < applied.evidence.before.logLoss);
});
test("worse future performance rejects proposal without changing revision", async () => {
  await seed(60, c.now - 100000);
  const { j, p } = await proposal();
  await proposeGeneralLearning(c, j.id, p);
  const at = c.now;
  await seed(30, at + 1000, () => 0);
  c.now += 100000;
  await claimGeneralLearning(c, "learner");
  assert.equal((await calibrationSnapshot(c)).revision, 0);
  assert.ok(
    (await generalAdaptationReport(c)).history.some(
      (e) => e.kind === "REJECTED",
    ),
  );
});
test("expired leases and stale fencing cannot submit parameters", async () => {
  await seed(60, c.now - 100000);
  const { j, p } = await proposal();
  c.now += 60001;
  const reclaimed = (await claimGeneralLearning(c, "new-owner")).job;
  assert.ok(reclaimed);
  assert.equal(reclaimed.id, j.id);
  assert.ok(reclaimed.fencingToken > j.fencingToken);
  await assert.rejects(proposeGeneralLearning(c, j.id, p));
  assert.equal(
    (await one(c.db, "SELECT COUNT(*) n FROM general_learning_proposals")).n,
    0,
  );
});
test("atomic injected failure leaves no proposal or revision change", async () => {
  await seed(60, c.now - 100000);
  const { j, p } = await proposal();
  await assert.rejects(proposeGeneralLearning({ ...c, failAt: 3 }, j.id, p));
  assert.equal(
    (await one(c.db, "SELECT COUNT(*) n FROM general_learning_proposals")).n,
    0,
  );
  assert.equal((await calibrationSnapshot(c)).revision, 0);
  assert.equal(
    (
      await one(
        c.db,
        "SELECT state FROM general_learning_jobs WHERE id=?",
        j.id,
      )
    ).state,
    "RUNNING",
  );
});
test("conflicted and imported/DEMO records are excluded; corrected training invalidates pending proposal", async () => {
  const ids = await seed(60, c.now - 100000);
  await seed(10, c.now - 50000, () => 0, "LEGACY_IMPORT");
  assert.equal((await learningSamples(c)).length, 60);
  const { j, p } = await proposal();
  await proposeGeneralLearning(c, j.id, p);
  const previous = await one(
    c.db,
    "SELECT id FROM result_adjudications WHERE fixtureId=?",
    ids[0],
  );
  await stmt(
    c.db,
    "INSERT INTO result_adjudications VALUES(?,?,2,'REVIEW',NULL,'[]','CONTRACT_CONFLICT','TEST',?)",
    uid(),
    ids[0],
    previous.id,
  ).run();
  assert.equal((await learningSamples(c)).length, 59);
  await claimGeneralLearning(c, "learner");
  assert.equal(
    (
      await one(
        c.db,
        "SELECT state FROM general_learning_jobs WHERE id=?",
        j.id,
      )
    ).state,
    "STALE",
  );
  assert.equal((await calibrationSnapshot(c)).revision, 0);
});
test("no new fixtures means no repeated fitting of same outcomes", async () => {
  await seed(60, c.now - 100000);
  const j = (await claimGeneralLearning(c, "learner")).job;
  assert.ok(j);
  await proposeGeneralLearning(c, j.id, {
    owner: "learner",
    fencingToken: j.fencingToken,
    trainingHash: j.trainingHash,
    parameters: j.parameters,
  });
  assert.equal(
    (await claimGeneralLearning(c, "learner")).state,
    "WAITING_FOR_NEW_TRAINING_FIXTURES",
  );
  assert.equal(
    (await one(c.db, "SELECT COUNT(*) n FROM general_learning_jobs")).n,
    1,
  );
});

test("already discovered fixtures validate using their first qualifying snapshot after proposal", async () => {
  await seed(60, c.now - 100000);
  const ids = await seed(
    30,
    c.now - 1000,
    (i) => i % 3,
    "LOCAL_RESEARCH",
    100000,
  );
  const { j, p } = await proposal();
  assert.equal(j.training.length, 60);
  await proposeGeneralLearning(c, j.id, p);
  await refreshed(ids, c.now + 1000);
  c.now += 150000;
  await claimGeneralLearning(c, "learner");
  assert.equal((await calibrationSnapshot(c)).revision, 1);
  const applied = (await generalAdaptationReport(c)).history.find(
    (e) => e.kind === "APPLIED",
  );
  assert.ok(applied);
  assert.ok(
    applied.evidence.validation.every(
      (s: any) => s.cutoffAt > applied.evidence.proposedAt,
    ),
  );
});
