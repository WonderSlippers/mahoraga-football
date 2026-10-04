import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
// @ts-ignore local runtime
import { engine, migrate } from "../../scripts/runtime-lib.mjs";
// @ts-ignore local compiler
import { workerBuild } from "../../scripts/build.mjs";
import {
  observe,
  claim,
  demoResult,
} from "../../apps/api/src/services/observations";
import {
  registerComparison,
  completeComparison,
} from "../../apps/api/src/services/comparison";
import {
  registerVersions,
  legacyState,
  completeVersion,
  versionPaperStep,
  versionMetrics,
} from "../../apps/api/src/services/versions";
import { strategyArena } from "../../apps/api/src/services/arena";
import {
  workspaceReport,
  workspaceSchedule,
} from "../../apps/api/src/services/workspace";
import { settle } from "../../apps/api/src/services/commands";
import { adjudicate } from "../../apps/api/src/services/adjudications";
import {
  one,
  rows,
  stmt,
  uid,
  atomic,
} from "../../apps/api/src/repositories/db";
import { canonical, sha } from "../../packages/contracts";
import { legacyEvaluate } from "../../packages/domain/legacy-september-engine";
import { SEPTEMBER_ID, V6_ID } from "../../packages/domain/versions";
let mf: any, c: any;
before(workerBuild);
beforeEach(async () => {
  const cfg = {
    installationId: crypto.randomUUID(),
    mode: "DEMO",
    bootstrap: "test",
    serviceToken: "test",
    webOrigin: "http://127.0.0.1:5295",
    appCodeSha: "SOFTWARE_TEST_ONLY",
  };
  mf = engine(cfg, ".runtime-v2/version-test", { port: 0, persist: false });
  const db = await mf.getD1Database("DB");
  await migrate(db, cfg);
  c = {
    db,
    installationId: cfg.installationId,
    now: Date.parse("2026-10-04T10:00:00Z"),
  };
  await stmt(db, "UPDATE installations SET mode='LOCAL_RESEARCH'").run();
  await registerComparison(c);
  await registerVersions(c);
});
afterEach(async () => mf.dispose());
async function infer(withTotals = false) {
  const f = await observe(c, uid());
  await stmt(
    c.db,
    "UPDATE jobs SET state='BLOCKED' WHERE modelId<>?",
    SEPTEMBER_ID,
  ).run();
  const b = await one(
    c.db,
    "SELECT b.* FROM input_bundles b JOIN observation_slots s ON s.id=b.slotId JOIN fixture_revisions r ON r.id=s.fixtureRevisionId WHERE r.fixtureId=?",
    f.id,
  );
  const value = JSON.parse(b.canonical);
  value.mode = "LOCAL_RESEARCH";
  const state = await legacyState(c);
  value.comparisonFeatures = {
    legacyState: state,
    competition: "TEST_ONLY",
    home: "TEST HOME",
    away: "TEST AWAY",
    goalStats: null,
    offers: [
      { market: "1X2", selection: "HOME", lineQ: null, odds: "2.00" },
      { market: "1X2", selection: "DRAW", lineQ: null, odds: "3.20" },
      { market: "1X2", selection: "AWAY", lineQ: null, odds: "4.00" },
      ...(withTotals
        ? [
            {
              market: "TOTAL_GOALS",
              selection: "OVER",
              lineQ: 10,
              odds: "2.00",
            },
          ]
        : []),
    ],
  };
  const bundle = uid(),
    slot = uid(),
    raw = canonical(value);
  await atomic(c.db, [
    stmt(
      c.db,
      "INSERT INTO observation_slots VALUES(?,?,'VERSION_TEST',?,?,'QUEUED',NULL)",
      slot,
      value.revisionId,
      c.now,
      c.now + 300000,
    ),
    stmt(
      c.db,
      "INSERT INTO input_bundles VALUES(?,?,?,?,?,?,'READY')",
      bundle,
      slot,
      b.quoteSetId,
      c.now,
      await sha(raw),
      raw,
    ),
    stmt(
      c.db,
      "INSERT INTO jobs(id,bundleId,modelId,state,deadlineAt) VALUES(?,?,?,'QUEUED',?)",
      uid(),
      bundle,
      SEPTEMBER_ID,
      c.now + 300000,
    ),
  ]);
  const job = await claim(c, "TEST RUNNER");
  const match = {
    id: f.id,
    leagueCode: "TEST_ONLY",
    home: "TEST HOME",
    away: "TEST AWAY",
    date: Date.parse(value.kickoffAt),
    status: "soon",
    detail: "",
    odds: [2, 3.2, 4],
    providers: ["TEST", "TEST", "TEST"],
    homeForm: "WWWW",
    awayForm: "LLLL",
    spreadOffers: [],
    totalOffers: [],
  };
  const computed = legacyEvaluate({
    at: c.now,
    match,
    evolution: state.evolution,
    goalStats: null,
  });
  if (withTotals) {
    // Controlled contract fixture for original same-match parlay fill behavior.
    // This does not validate real model probability or market profitability.
    computed.candidates.total = {
      ...structuredClone(computed.candidates.broad),
      edge: 0.2,
      shift: 0.02,
      value: false,
      leg: {
        ...structuredClone(computed.candidates.broad.leg),
        market: "total",
        side: "over",
        line: 2.5,
        odds: 2,
        probability: 0.6,
      },
    };
  }
  const output = {
    ...computed,
    variant: SEPTEMBER_ID,
    state: "DONE",
    reason: "SOFTWARE_TEST_ONLY",
    stateRevision: state.revision,
    evolution: state.evolution,
    researchOnly: true,
  };
  const payload = {
    owner: "TEST RUNNER",
    fencingToken: job.fencingToken,
    bundleHash: job.bundleHash,
    modelHash: job.modelHash,
    featureCanonical: raw,
    output: JSON.parse(JSON.stringify(output)),
  };
  const result = await completeVersion(c, job.id, payload);
  return { f, job, payload, result };
}
test("independent original portfolios place atomically and repeated steps cannot duplicate or mutate a prediction", async () => {
  await infer();
  const before = await rows(
    c.db,
    "SELECT * FROM predictions WHERE modelId=?",
    SEPTEMBER_ID,
  );
  const a = await versionPaperStep(c);
  assert.ok(a.placed > 0);
  const tickets = await rows(c.db, "SELECT * FROM tickets");
  assert.ok(
    tickets.every((t) => t.portfolioId.startsWith("paper:september20:")),
  );
  const b = await versionPaperStep(c);
  assert.equal(b.placed, 0);
  assert.equal(
    (await rows(c.db, "SELECT * FROM tickets")).length,
    tickets.length,
  );
  assert.deepEqual(
    await rows(c.db, "SELECT * FROM predictions WHERE modelId=?", SEPTEMBER_ID),
    before,
  );
  const legacy = await strategyArena(
    c,
    new URLSearchParams({ version: "SEPTEMBER20" }),
  );
  const general = await strategyArena(
    c,
    new URLSearchParams({ version: "GENERAL" }),
  );
  assert.equal(legacy.strategies.length, 10);
  assert.ok(legacy.openN > 0);
  assert.equal(general.openN, 0);
  assert.equal(
    (
      await one(
        c.db,
        "SELECT COUNT(*) n FROM portfolios WHERE available+openStake<>initial+realized",
      )
    ).n,
    0,
  );
});
test("original correlated parlay proposal is audited while valid single tickets still commit atomically", async () => {
  await infer(true);
  const round = await versionPaperStep(c);
  assert.ok(round.placed > 0);
  const rejected = await rows(
    c.db,
    "SELECT * FROM version_execution_rejections",
  );
  assert.ok(
    rejected.some((r) => r.reason === "SAME_FIXTURE_PARLAY_UNSUPPORTED"),
  );
  assert.equal(
    (
      await one(
        c.db,
        "SELECT COUNT(*) n FROM (SELECT ticketId,fixtureRevisionId,COUNT(*) n FROM ticket_legs GROUP BY ticketId,fixtureRevisionId HAVING n>1)",
      )
    ).n,
    0,
  );
  await assert.rejects(
    stmt(c.db, "DELETE FROM version_execution_rejections").run(),
    /IMMUTABLE_FACT/,
  );
});

test("a newer failed model job prevents placing a saved direction", async () => {
  const inferred = await infer();
  await stmt(
    c.db,
    "UPDATE jobs SET state='FAILED',reason='TEST_RETRY_FAILURE' WHERE id=?",
    inferred.job.id,
  ).run();
  assert.equal((await versionPaperStep(c)).placed, 0);
  assert.equal((await rows(c.db, "SELECT * FROM tickets")).length, 0);
});

test("a failed round rolls back every ticket, decision, ledger entry and PP revision", async () => {
  await infer();
  const before = await one(
    c.db,
    "SELECT * FROM version_state WHERE modelId=?",
    SEPTEMBER_ID,
  );
  await assert.rejects(() => versionPaperStep({ ...c, failAt: 8 }));
  for (const table of [
    "tickets",
    "decisions",
    "ledger_entries",
    "version_ticket_evidence",
    "version_state_events",
  ])
    assert.equal(
      (await one(c.db, "SELECT COUNT(*) n FROM " + table)).n,
      0,
      table,
    );
  assert.deepEqual(
    await one(
      c.db,
      "SELECT * FROM version_state WHERE modelId=?",
      SEPTEMBER_ID,
    ),
    before,
  );
  assert.ok((await versionPaperStep(c)).placed > 0);
});
test("job replay is idempotent and mismatched parameter/quote cannot create authoritative output", async () => {
  const { job, payload, result } = await infer();
  assert.deepEqual(await completeVersion(c, job.id, payload), result);
  await assert.rejects(
    () =>
      completeVersion(c, job.id, {
        ...payload,
        output: { ...payload.output, stateRevision: 999 },
      }),
    /MODEL_HASH_MISMATCH/,
  );
  assert.equal(
    (await one(c.db, "SELECT COUNT(*) n FROM version_observations")).n,
    1,
  );
});
test("settlement and correction use original core; switched ledger cannot mix models or old balances", async () => {
  const { f } = await infer();
  await versionPaperStep(c);
  const ticket = await one(
    c.db,
    "SELECT * FROM tickets WHERE portfolioId='paper:september20:all-singles'",
  );
  const hashes = await rows(
    c.db,
    "SELECT * FROM predictions WHERE modelId=?",
    SEPTEMBER_ID,
  );
  const adjudication = await demoResult(c, uid(), {
    fixtureId: f.id,
    scenario: "WIN",
    expectedRevision: 0,
    reason: "SOFTWARE TEST RESULT",
  });
  let account = await one(
    c.db,
    "SELECT * FROM portfolios WHERE id=?",
    ticket.portfolioId,
  );
  await settle(c, uid(), {
    ticketId: ticket.id,
    adjudicationId: adjudication.id,
    expectedRevision: account.revision,
  });
  const legacy = await workspaceReport(
    c,
    new URLSearchParams({ mode: "PAPER_RESEARCH", version: "SEPTEMBER20" }),
    "ledger",
  );
  const general = await workspaceReport(
    c,
    new URLSearchParams({ mode: "PAPER_RESEARCH", version: "GENERAL" }),
    "ledger",
  );
  assert.ok(legacy.items.length > 0);
  for (const row of legacy.items) {
    const original = JSON.parse(
      (
        await one(
          c.db,
          "SELECT originalJson FROM version_ticket_evidence WHERE ticketId=?",
          row.id,
        )
      ).originalJson,
    );
    assert.equal(
      row.score,
      Math.min(...original.legs.map((l: any) => l.score)),
    );
  }
  assert.equal(general.items.length, 0);
  await demoResult(c, uid(), {
    fixtureId: f.id,
    scenario: "LOSS",
    expectedRevision: 1,
    reason: "SOFTWARE TEST CORRECTION",
  }).then(async (a) => {
    account = await one(
      c.db,
      "SELECT * FROM portfolios WHERE id=?",
      ticket.portfolioId,
    );
    await settle(c, uid(), {
      ticketId: ticket.id,
      adjudicationId: a.id,
      expectedRevision: account.revision,
    });
  });
  assert.deepEqual(
    await rows(c.db, "SELECT * FROM predictions WHERE modelId=?", SEPTEMBER_ID),
    hashes,
  );
  const corrected = await workspaceReport(
    c,
    new URLSearchParams({ mode: "PAPER_RESEARCH", version: "SEPTEMBER20" }),
    "ledger",
  );
  assert.deepEqual(
    corrected.items.map((t) => ({ id: t.id, score: t.score })),
    legacy.items.map((t) => ({ id: t.id, score: t.score })),
  );
  assert.equal(
    (
      await one(
        c.db,
        "SELECT realized FROM portfolios WHERE id=?",
        ticket.portfolioId,
      )
    ).realized,
    -ticket.stakeAtoms,
  );
});
test("full fixture discovery remains visible when selected version has no model output", async () => {
  await infer();
  const legacy = await workspaceSchedule(
    c,
    new URLSearchParams({ version: "SEPTEMBER20" }),
  );
  const v6 = await workspaceSchedule(c, new URLSearchParams({ version: "V6" }));
  assert.equal(legacy.totalKnown, v6.totalKnown);
  assert.ok(legacy.items[0].research);
  assert.equal(v6.items[0].research, null);
  const metrics = await versionMetrics(
    c,
    new URLSearchParams({ version: "V6" }),
  );
  assert.equal(metrics.probability.logLoss, null);
});
test("original double and treble tickets share existing multi-leg settlement and remain distinct policies", async () => {
  await infer();
  await infer();
  await infer();
  await versionPaperStep(c);
  const tickets = await rows(
    c.db,
    "SELECT t.id,t.portfolioId,COUNT(l.id) legs FROM tickets t JOIN ticket_legs l ON l.ticketId=t.id GROUP BY t.id",
  );
  assert.ok(
    tickets.some(
      (t) => t.portfolioId === "paper:september20:double" && t.legs === 2,
    ),
  );
  assert.ok(
    tickets.some(
      (t) => t.portfolioId === "paper:september20:treble" && t.legs === 3,
    ),
  );
  assert.equal(
    (
      await one(
        c.db,
        "SELECT COUNT(*) n FROM portfolios WHERE available+openStake<>initial+realized",
      )
    ).n,
    0,
  );
});
test("V6 native stress action creates its own paper ticket without inventing central probabilities", async () => {
  const { job } = await infer();
  await stmt(
    c.db,
    "INSERT INTO jobs(id,bundleId,modelId,state,deadlineAt) VALUES(?,?,?,'QUEUED',?)",
    uid(),
    job.bundleId,
    V6_ID,
    c.now + 300000,
  ).run();
  const claimed = await claim(c, "V6 TEST RUNNER");
  const b = await one(
    c.db,
    "SELECT * FROM input_bundles WHERE id=?",
    claimed.bundleId,
  );
  await completeComparison(c, claimed.id, {
    owner: "V6 TEST RUNNER",
    fencingToken: claimed.fencingToken,
    bundleHash: claimed.bundleHash,
    modelHash: claimed.modelHash,
    featureCanonical: b.canonical,
    output: {
      variant: V6_ID,
      state: "DONE",
      central: null,
      reason: "SOFTWARE_TEST_ONLY",
      researchOnly: true,
      stressBySelection: { HOME: 0.55, DRAW: null, AWAY: null },
      actions: [
        {
          strategy: "V6_NATIVE",
          market: "1X2",
          selection: "HOME",
          lineQ: null,
          odds: "2.00",
          probability: 0.55,
          estimatedEV: 0.1,
        },
      ],
    },
  });
  await versionPaperStep(c);
  const v6 = await strategyArena(c, new URLSearchParams({ version: "V6" }));
  assert.equal(v6.openN, 1);
  const prediction = await one(
    c.db,
    "SELECT * FROM predictions WHERE modelId=?",
    V6_ID,
  );
  assert.equal(prediction.centralJson, "null");
  const metrics = await versionMetrics(
    c,
    new URLSearchParams({ version: "V6" }),
  );
  assert.equal(metrics.probability.logLoss, null);
  assert.equal(metrics.probability.brier, null);
});
