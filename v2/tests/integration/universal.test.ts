import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
// @ts-ignore own real workerd runtime
import { engine, migrate } from "../../scripts/runtime-lib.mjs";
// @ts-ignore own build
import { workerBuild } from "../../scripts/build.mjs";
import {
  observe,
  claim,
  complete,
} from "../../apps/api/src/services/observations";
import {
  registerUniversal,
  completeUniversal,
  autoPaper,
  universalReport,
  configurePaper,
} from "../../apps/api/src/services/universal";
import {
  place,
  placeDouble,
  settle,
  summary,
} from "../../apps/api/src/services/commands";
import {
  one,
  rows,
  stmt,
  atomic,
  uid,
} from "../../apps/api/src/repositories/db";
import { canonical, sha } from "../../packages/contracts";
import { UNIVERSAL_ID } from "../../packages/domain/universal";
import { adjudicate } from "../../apps/api/src/services/adjudications";
import { autoSettle } from "../../apps/api/src/services/automation";
import {
  ledgerRows,
  workspaceReport,
  workspaceSchedule,
} from "../../apps/api/src/services/workspace";
import { generalMetrics } from "../../apps/api/src/services/general-metrics";
import { strategyArena } from "../../apps/api/src/services/arena";
import {
  FUN_DOUBLE,
  prepareFunDouble,
} from "../../apps/api/src/services/fun-paper";
let mf: any, c: any, f: any, b: any, cfg: any;
before(workerBuild);
beforeEach(async () => {
  cfg = {
    installationId: crypto.randomUUID(),
    mode: "DEMO",
    webOrigin: "http://127.0.0.1:5295",
    bootstrap: "test",
    serviceToken: "test",
    appCodeSha: "CONTRACT_TEST_ONLY",
  };
  mf = engine(cfg, ".runtime-v2/universal-test", { port: 0, persist: false });
  const db = await mf.getD1Database("DB");
  await migrate(db, cfg);
  c = { db, installationId: cfg.installationId, now: Date.now() };
  f = await observe(c, uid());
  b = await one(db, "SELECT * FROM input_bundles");
  await stmt(
    db,
    "UPDATE jobs SET state='BLOCKED',reason='CONTRACT_TEST_ONLY'",
  ).run();
  await stmt(db, "UPDATE installations SET mode='LOCAL_RESEARCH'").run();
  await registerUniversal(c);
});
afterEach(async () => mf.dispose());
async function job(at = c.now) {
  const value = JSON.parse(b.canonical);
  const current = await one(
    c.db,
    "SELECT r.* FROM fixture_revisions r JOIN fixtures f ON f.id=r.fixtureId AND f.currentRevision=r.revision WHERE f.id=?",
    f.id,
  );
  value.revisionId = current.id;
  value.kickoffAt = new Date(current.kickoffAt).toISOString();
  value.mode = "LOCAL_RESEARCH";
  value.cutoffAt = new Date(at).toISOString();
  value.comparisonFeatures = {
    competition: "TEST_ONLY",
    home: "CONTRACT ONLY",
    away: "CONTRACT ONLY",
    goalStats: null,
    featureRow: null,
    featureSources: [],
    featureHash: null,
    offers: [
      ...["HOME", "DRAW", "AWAY"].map((selection, i) => ({
        market: "1X2",
        selection,
        lineQ: null,
        odds: value.odds[i],
      })),
      { market: "ASIAN_HANDICAP", selection: "HOME", lineQ: -1, odds: "1.8" },
      { market: "ASIAN_HANDICAP", selection: "AWAY", lineQ: 1, odds: "1.8" },
    ],
  };
  const slot = uid(),
    bundle = uid(),
    raw = canonical(value);
  await atomic(c.db, [
    stmt(
      c.db,
      "INSERT INTO observation_slots VALUES(?,?,'CONTRACT_TEST_ONLY',?,?,'QUEUED',NULL)",
      slot,
      value.revisionId,
      at,
      at + 300000,
    ),
    stmt(
      c.db,
      "INSERT INTO input_bundles VALUES(?,?,?,?,?,?,'READY')",
      bundle,
      slot,
      b.quoteSetId,
      at,
      await sha(raw),
      raw,
    ),
    stmt(
      c.db,
      "INSERT INTO jobs(id,bundleId,modelId,state,deadlineAt) VALUES(?,?,?,'QUEUED',?)",
      uid(),
      bundle,
      UNIVERSAL_ID,
      at + 300000,
    ),
  ]);
  return await claim({ ...c, now: at }, "test");
}
function payload(
  j: any,
  o: any = {
    variant: UNIVERSAL_ID,
    state: "DONE",
    reason: "CONTRACT TEST NOT MODEL VALIDATION",
    central: [0.6, 0.3, 0.1],
    grid: [
      [0.1, 0.1, 0],
      [0.5, 0.2, 0],
      [0.1, 0, 0],
    ],
    uncertaintyMargin: 0.02,
    basis: "CLUB_STANDINGS_POISSON",
    researchOnly: true,
  },
) {
  return {
    owner: "test",
    fencingToken: j.fencingToken,
    bundleHash: j.bundleHash,
    modelHash: j.modelHash,
    featureCanonical: j.canonical,
    output: o,
  };
}
async function generated() {
  const j = await job();
  const p = payload(j);
  const record = await completeUniversal(c, j.id, p);
  return { j, p, record };
}
test("general completion freezes full quotes/prediction/decisions atomically and is idempotent", async () => {
  const { j, p, record } = await generated();
  assert.equal((await completeUniversal(c, j.id, p)).id, record.id);
  assert.equal((await one(c.db, "SELECT COUNT(*) n FROM predictions")).n, 1);
  const r = (await universalReport(c)).records[0];
  assert.equal(r.output.plans.length, 7);
  assert.equal(
    r.output.plans.filter((p: any) => p.ticketType === "DOUBLE_LEG").length,
    1,
  );
  assert.equal(r.outputJson, undefined);
  assert.equal(r.output.grid, undefined);
  assert.ok(
    (await universalReport(c, new URLSearchParams({ fixture: f.id })))
      .records[0].output.grid,
  );
  const q = await one(
    c.db,
    "SELECT qs.* FROM quote_sets qs JOIN market_definitions m ON m.id=qs.marketId WHERE m.type='ASIAN_HANDICAP'",
  );
  assert.equal(q.observedAt, c.now);
  assert.equal(q.providerUpdatedAt, null);
  assert.equal(
    (await c.db.prepare("PRAGMA foreign_key_check").all()).results.length,
    0,
  );
  await assert.rejects(
    completeUniversal(
      c,
      j.id,
      payload(j, { ...p.output, reason: p.output.reason + " altered" }),
    ),
    /IDEMPOTENCY_CONFLICT/,
  );
  for (const table of [
    "universal_observations",
    "predictions",
    "quote_sets",
    "decisions",
  ])
    await assert.rejects(
      stmt(c.db, "UPDATE " + table + " SET rowid=rowid").run(),
      /IMMUTABLE_FACT/,
    );
});
test("general faults and expired leases leave no partial prediction, quotes, decisions or financial changes", async () => {
  const j = await job();
  await assert.rejects(
    completeUniversal({ ...c, failAt: 6 }, j.id, payload(j)),
  );
  assert.equal((await one(c.db, "SELECT COUNT(*) n FROM predictions")).n, 0);
  assert.equal(
    (await one(c.db, "SELECT COUNT(*) n FROM universal_observations")).n,
    0,
  );
  assert.equal((await one(c.db, "SELECT COUNT(*) n FROM quote_sets")).n, 1);
  await assert.rejects(
    completeUniversal({ ...c, now: c.now + 31000 }, j.id, payload(j)),
  );
  assert.equal((await one(c.db, "SELECT COUNT(*) n FROM decisions")).n, 0);
});
test("automatic general paper placement never duplicates after refresh or changes direction; accounts and origins separate", async () => {
  await generated();
  const r = await autoPaper(c);
  assert.equal(r.placed, 6);
  assert.equal((await autoPaper(c)).placed, 0);
  const before = await rows(c.db, "SELECT * FROM tickets");
  const j = await job(c.now + 1000);
  await completeUniversal({ ...c, now: c.now + 1000 }, j.id, payload(j));
  assert.equal((await autoPaper({ ...c, now: c.now + 1000 })).placed, 0);
  assert.deepEqual(await rows(c.db, "SELECT * FROM tickets"), before);
  assert.equal((await ledgerRows(c.db, "PAPER_RESEARCH")).length, 6);
  assert.equal((await ledgerRows(c.db, "PAPER")).length, 0);
  for (const t of before) assert.equal(t.origin, "PAPER_RESEARCH");
  const account = await summary(c.db, "paper:general-v2-all-singles");
  assert.equal(
    Number(account.available) + Number(account.openStake),
    Number(account.initial) + Number(account.realized),
  );
});
test("paper policies preserve frozen tickets, enforce pause, server revisions and immutable stake", async () => {
  await generated();
  const policy = await one(
    c.db,
    "SELECT * FROM paper_policies WHERE id='general-v2-all-singles'",
  );
  const p = {
    id: policy.id,
    enabled: false,
    maximumPerDay: 1,
    expectedRevision: policy.revision,
  };
  await configurePaper(c, "pause", p);
  assert.equal((await configurePaper(c, "pause", p)).replayed, true);
  await assert.rejects(configurePaper(c, "other", p), /REVISION_CONFLICT/);
  const plan = (await universalReport(c)).records[0].output.plans[0];
  await assert.rejects(
    place(c, "bad", {
      decisionId: plan.decisionId,
      portfolioId: policy.portfolioId,
      stakeAtoms: "20000000",
      expectedRevision: 0,
    }),
    /POLICY_PAUSED/,
  );
  await configurePaper(c, "resume", {
    ...p,
    enabled: true,
    expectedRevision: 1,
  });
  await assert.rejects(
    place(c, "bad-stake", {
      decisionId: plan.decisionId,
      portfolioId: policy.portfolioId,
      stakeAtoms: "1000000",
      expectedRevision: 0,
    }),
    /PAPER_POLICY_MISMATCH/,
  );
  await autoPaper(c);
  const ticket = await one(
    c.db,
    "SELECT * FROM tickets WHERE portfolioId=?",
    policy.portfolioId,
  );
  await configurePaper(c, "pause-again", { ...p, expectedRevision: 2 });
  assert.deepEqual(
    await one(c.db, "SELECT * FROM tickets WHERE id=?", ticket.id),
    ticket,
  );
  await assert.rejects(
    place(c, "demo-cross-mode", {
      decisionId: plan.decisionId,
      portfolioId: "demo",
      stakeAtoms: "20000000",
      expectedRevision: 0,
    }),
    /MODE_MISMATCH/,
  );
});
test("paper placement refuses stale evidence and fixture start; blocked outputs create no fake predictions", async () => {
  const { j, p } = await generated();
  const plan = (await universalReport(c)).records[0].output.plans[0];
  await assert.rejects(
    place({ ...c, now: c.now + 600001 }, "stale", {
      decisionId: plan.decisionId,
      portfolioId: "paper:general-v2-all-singles",
      stakeAtoms: "20000000",
      expectedRevision: 0,
    }),
    /QUOTE_STALE/,
  );
  await stmt(c.db, "UPDATE fixtures SET status='STARTED'").run();
  await assert.rejects(
    place(c, "started", {
      decisionId: plan.decisionId,
      portfolioId: "paper:general-v2-all-singles",
      stakeAtoms: "20000000",
      expectedRevision: 0,
    }),
    /KICKOFF_PASSED/,
  );
  await stmt(c.db, "UPDATE fixtures SET status='SCHEDULED'").run();
  const next = await job(c.now + 1000);
  await completeUniversal(
    { ...c, now: c.now + 1000 },
    next.id,
    payload(next, {
      variant: UNIVERSAL_ID,
      state: "BLOCKED",
      reason: "NEUTRAL_VENUE_UNKNOWN",
      central: null,
      grid: null,
      researchOnly: true,
    }),
  );
  assert.equal((await one(c.db, "SELECT COUNT(*) n FROM predictions")).n, 1);
  assert.equal(
    (await universalReport({ ...c, now: c.now + 1000 })).records[0].state,
    "BLOCKED",
  );
});
async function result(home: number, away: number) {
  const snapshot = await one(c.db, "SELECT id FROM source_snapshots");
  const id = uid();
  await stmt(
    c.db,
    "INSERT INTO result_observations VALUES(?,?,?,?,'FINISHED',?)",
    id,
    f.id,
    snapshot.id,
    canonical({ home, away }),
    c.now,
  ).run();
  await stmt(
    c.db,
    "UPDATE fixtures SET status='FINISHED' WHERE id=?",
    f.id,
  ).run();
  return id;
}
test("new general paper AH settles half losses correctly; conflicts reopen and append corrections without modifying original facts", async () => {
  await generated();
  await autoPaper(c);
  await result(0, 0);
  await autoSettle(c);
  const ah = await one(
    c.db,
    "SELECT * FROM tickets WHERE portfolioId='paper:general-v2-spread-singles'",
  );
  let state = await one(
    c.db,
    "SELECT * FROM ticket_state WHERE ticketId=?",
    ah.id,
  );
  assert.equal(state.gross, 10000000);
  const original = await one(
    c.db,
    "SELECT * FROM ticket_legs WHERE ticketId=?",
    ah.id,
  );
  const evidence = await result(1, 0);
  await autoSettle(c);
  state = await one(c.db, "SELECT * FROM ticket_state WHERE ticketId=?", ah.id);
  assert.equal(state.currentStatus, "REVIEW");
  assert.equal(
    (
      await one(
        c.db,
        "SELECT kind FROM settlement_events WHERE ticketId=? ORDER BY revision DESC LIMIT 1",
        ah.id,
      )
    ).kind,
    "REOPEN",
  );
  const revision = (
    await one(c.db, "SELECT MAX(revision) n FROM result_adjudications")
  ).n;
  await adjudicate(c, "manual-correction", {
    fixtureId: f.id,
    expectedRevision: revision,
    selectedEvidenceId: evidence,
    reason: "CONTRACT TEST evidence override",
  });
  await autoSettle(c);
  state = await one(c.db, "SELECT * FROM ticket_state WHERE ticketId=?", ah.id);
  assert.equal(state.gross, 36000000);
  assert.deepEqual(
    await one(c.db, "SELECT * FROM ticket_legs WHERE ticketId=?", ah.id),
    original,
  );
  const account = await summary(c.db, ah.portfolioId);
  assert.equal(
    Number(account.available) + Number(account.openStake),
    Number(account.initial) + Number(account.realized),
  );
  assert.equal(
    (
      await one(
        c.db,
        "SELECT COUNT(*) n FROM settlement_events WHERE ticketId=?",
        ah.id,
      )
    ).n,
    3,
  );
});
test("schema upgrade is repeatable on populated new ledger and preserves all original frozen records and FK constraints", async () => {
  await generated();
  await autoPaper(c);
  const tables = [
    "tickets",
    "ticket_legs",
    "predictions",
    "universal_observations",
    "quote_sets",
    "quote_selections",
  ];
  const before = await Promise.all(
    tables.map((t) => rows(c.db, "SELECT * FROM " + t + " ORDER BY rowid")),
  );
  await stmt(c.db, "UPDATE installations SET schemaVersion=10").run();
  await migrate(c.db, { ...cfg, mode: "LOCAL_RESEARCH" });
  const after = await Promise.all(
    tables.map((t) => rows(c.db, "SELECT * FROM " + t + " ORDER BY rowid")),
  );
  assert.deepEqual(after, before);
  assert.equal(
    (await c.db.prepare("PRAGMA foreign_key_check").all()).results.length,
    0,
  );
  await migrate(c.db, { ...cfg, mode: "LOCAL_RESEARCH" });
  assert.equal(
    (await one(c.db, "SELECT schemaVersion FROM installations")).schemaVersion,
    13,
  );
  await assert.rejects(
    stmt(c.db, "UPDATE tickets SET stakeAtoms=1").run(),
    /IMMUTABLE_FACT/,
  );
});
test("a failed latest general job suspends new paper actions while preserving earlier frozen directions", async () => {
  await generated();
  const frozen = (await universalReport(c)).records[0].output;
  await stmt(
    c.db,
    "UPDATE jobs SET state='FAILED' WHERE modelId=?",
    UNIVERSAL_ID,
  ).run();
  assert.equal((await autoPaper(c)).placed, 0);
  const schedule = await workspaceSchedule(
    c,
    new URLSearchParams({ view: "ACTIVE" }),
  );
  assert.equal(schedule.items[0].state, "MODEL_FAILED");
  assert.ok(schedule.items[0].generalDirections.length);
  assert.deepEqual((await universalReport(c)).records[0].output, frozen);
});

test("general recommendations remain tracked after kickoff and scoring uses frozen first probabilities", async () => {
  await generated();
  await autoPaper(c);
  const before = await generalMetrics(c);
  assert.equal(before.populationN, 1);
  assert.equal(before.probability.logLoss, null);
  assert.equal(
    before.byStrategy.find((p: any) => p.id === "general-v2-value-singles")!
      .metrics.roi,
    null,
  );
  const tracked = await workspaceSchedule(
    c,
    new URLSearchParams({ view: "TRACKED", trackingModel: "GENERAL" }),
  );
  assert.equal(tracked.total, 1);
  const directions = tracked.items[0].generalDirections;
  await stmt(c.db, "UPDATE fixtures SET status='LIVE' WHERE id=?", f.id).run();
  const live = await workspaceSchedule(
    { ...c, now: c.now + 3700000 },
    new URLSearchParams({ view: "TRACKED", trackingModel: "GENERAL" }),
  );
  assert.equal(live.total, 1);
  assert.deepEqual(live.items[0].generalDirections, directions);
  await result(1, 0);
  await autoSettle(c);
  const scored = await generalMetrics(c);
  assert.equal(scored.probability.probabilityN, 1);
  assert.ok(Math.abs(scored.probability.logLoss! + Math.log(0.6)) < 1e-12);
  assert.equal(scored.baseline.probabilityN, 1);
});

test("bilingual schedule and ledger search preserve frozen recommendation scores through settlement", async () => {
  await stmt(
    c.db,
    "UPDATE fixtures SET home='Manchester United',away='Liverpool' WHERE id=?",
    f.id,
  ).run();
  await generated();
  await autoPaper(c);
  const frozen = (await universalReport(c)).records[0].output;
  const first = await workspaceSchedule(c, new URLSearchParams({ q: "曼联" }));
  assert.equal(first.total, 1);
  assert.equal(first.items[0].home, "Manchester United");
  const directions = first.items[0].generalDirections;
  assert.ok(directions.length > 0);
  assert.equal(directions[0].rank, 92);
  for (const q of ["Manchester United", "man utd", "man-utd"]) {
    const filtered = await universalReport(c, new URLSearchParams({ q }));
    assert.equal(filtered.records.length, 1);
    assert.deepEqual(filtered.records[0].output, frozen);
    const schedule = await workspaceSchedule(c, new URLSearchParams({ q }));
    assert.deepEqual(
      schedule.items.map((r: any) => r.id),
      first.items.map((r: any) => r.id),
    );
    const ledger = await workspaceReport(
      c,
      new URLSearchParams({ q, mode: "PAPER_RESEARCH", period: "ALL" }),
      "ledger",
    );
    assert.ok(ledger.total > 0);
  }
  assert.equal(
    (await workspaceSchedule(c, new URLSearchParams({ q: "曼城" }))).total,
    0,
  );
  assert.equal(
    (await universalReport(c, new URLSearchParams({ q: "曼城" }))).records
      .length,
    0,
  );
  await result(1, 0);
  await autoSettle(c);
  const ended = await workspaceSchedule(
    { ...c, now: c.now + 3700000 },
    new URLSearchParams({ q: "曼联", view: "TRACKED" }),
  );
  assert.deepEqual(ended.items[0].generalDirections, directions);
  assert.deepEqual((await universalReport(c)).records[0].output, frozen);
});
test("arena uses actual settled tickets, isolated accounts and Berlin settlement periods; no actions keep ROI null", async () => {
  await generated();
  await autoPaper(c);
  let arena = await strategyArena(c, new URLSearchParams());
  assert.equal(arena.summary.settled, 0);
  assert.equal(arena.summary.roi, null);
  assert.equal(arena.openN, 6);
  assert.ok(arena.latest.every((r: any) => r.pnlAtoms === null && !r.raw));
  await result(1, 0);
  await autoSettle(c);
  arena = await strategyArena(c, new URLSearchParams({ period: "TODAY" }));
  assert.equal(arena.summary.settled, 6);
  const broad = arena.strategies.find(
    (p: any) => p.id === "general-v2-all-singles",
  );
  assert.equal(broad.metrics.count, 1);
  assert.equal(broad.metrics.profitAtoms, "20000000");
  assert.equal(broad.metrics.roi, 1);
  assert.equal(broad.metrics.wins, 1);
  assert.equal(broad.metrics.curve.length, 1);
  assert.equal(arena.daily.length, 1);
  const yesterday = await strategyArena(
    c,
    new URLSearchParams({ period: "YESTERDAY" }),
  );
  assert.equal(yesterday.summary.settled, 0);
  assert.equal(yesterday.summary.roi, null);
  assert.equal(
    yesterday.strategies.find((p: any) => p.id === "general-v2-all-singles")
      .metrics.profitAtoms,
    "0",
  );
  await assert.rejects(
    strategyArena(c, new URLSearchParams({ period: "FAKE" })),
    /INVALID_FILTER/,
  );
});

test("entertainment double runs same-window distinct matches without relaxing value rules; replay, pause and two-result payout remain correct", async () => {
  const first = f;
  await generated();
  f = await observe(c, uid());
  b = await one(
    c.db,
    "SELECT b.* FROM input_bundles b JOIN observation_slots s ON s.id=b.slotId JOIN fixture_revisions r ON r.id=s.fixtureRevisionId WHERE r.fixtureId=?",
    f.id,
  );
  await stmt(
    c.db,
    "UPDATE jobs SET state='BLOCKED' WHERE modelId<>?",
    UNIVERSAL_ID,
  ).run();
  const second = f;
  await generated();
  const originals = await rows(
    c.db,
    "SELECT id,outputJson,outputHash FROM universal_observations ORDER BY rowid",
  );
  await prepareFunDouble(c);
  const choices = await rows(
    c.db,
    "SELECT id FROM decisions WHERE strategyVersion=?",
    FUN_DOUBLE.version,
  );
  assert.equal(choices.length, 2);
  await assert.rejects(
    placeDouble({ ...c, now: c.now + 600001 }, "stale-fun", {
      decisionIds: choices.map((r) => r.id),
      portfolioId: FUN_DOUBLE.portfolio,
      expectedRevision: 0,
    }),
    /QUOTE_STALE/,
  );
  await assert.rejects(
    placeDouble(c, "same-leg", {
      decisionIds: [choices[0].id, choices[0].id],
      portfolioId: FUN_DOUBLE.portfolio,
      expectedRevision: 0,
    }),
    /DOUBLE_LEGS_INVALID/,
  );
  assert.equal((await autoPaper(c)).placed, 13);
  assert.equal((await autoPaper(c)).placed, 0);
  assert.equal(
    (
      await one(
        c.db,
        "SELECT COUNT(*) n FROM tickets WHERE portfolioId='paper:general-v2-double'",
      )
    ).n,
    0,
  );
  const t = await one(
    c.db,
    "SELECT * FROM tickets WHERE portfolioId=?",
    FUN_DOUBLE.portfolio,
  );
  const legs = await rows(
    c.db,
    "SELECT * FROM ticket_legs WHERE ticketId=?",
    t.id,
  );
  assert.equal(legs.length, 2);
  assert.equal(new Set(legs.map((l) => l.fixtureRevisionId)).size, 2);
  f = first;
  await result(1, 0);
  await autoSettle(c);
  assert.equal(
    (
      await one(
        c.db,
        "SELECT currentStatus FROM ticket_state WHERE ticketId=?",
        t.id,
      )
    ).currentStatus,
    "OPEN",
  );
  f = second;
  await result(1, 0);
  await autoSettle(c);
  const entry = (await ledgerRows(c.db, "PAPER_RESEARCH")).find(
    (r) => r.id === t.id,
  )!;
  assert.equal(entry.odds, 4);
  assert.equal(entry.pnlAtoms, "60000000");
  assert.equal(entry.legCount, 2);
  const report = await strategyArena(c, new URLSearchParams());
  const strategy = report.strategies.find((p: any) => p.id === FUN_DOUBLE.id);
  assert.equal(strategy.category, "BENCHMARK");
  assert.equal(strategy.metrics.count, 1);
  assert.equal(strategy.metrics.roi, 3);
  const p = await one(
    c.db,
    "SELECT * FROM paper_policies WHERE id=?",
    FUN_DOUBLE.id,
  );
  await configurePaper(c, "pause-fun", {
    id: p.id,
    enabled: false,
    maximumPerDay: 5,
    expectedRevision: p.revision,
  });
  assert.equal((await autoPaper(c)).placed, 0);
  assert.deepEqual(
    await rows(
      c.db,
      "SELECT id,outputJson,outputHash FROM universal_observations ORDER BY rowid",
    ),
    originals,
  );
  assert.deepEqual(
    await rows(c.db, "SELECT * FROM ticket_legs WHERE ticketId=?", t.id),
    legs,
  );
});

test("two-leg automatic paper is atomic, distinct, idempotent, grouped once and settles/corrects only after both results", async () => {
  const first = f;
  await stmt(
    c.db,
    "INSERT INTO fixture_catalog VALUES(?,'TEST_A',2026,?,'CONTRACT_TEST_ONLY','{}')",
    f.id,
    c.now,
  ).run();
  await generated();
  f = await observe(c, uid());
  b = await one(
    c.db,
    "SELECT b.* FROM input_bundles b JOIN observation_slots s ON s.id=b.slotId JOIN fixture_revisions r ON r.id=s.fixtureRevisionId WHERE r.fixtureId=?",
    f.id,
  );
  await stmt(
    c.db,
    "UPDATE jobs SET state='BLOCKED',reason='CONTRACT_TEST_ONLY' WHERE modelId<>?",
    UNIVERSAL_ID,
  ).run();
  const second = f,
    original = await one(
      c.db,
      "SELECT * FROM fixture_revisions WHERE fixtureId=?",
      f.id,
    ),
    rev = uid();
  await stmt(
    c.db,
    "INSERT INTO fixture_revisions VALUES(?,?,2,?,?,?)",
    rev,
    f.id,
    c.now + 14 * 3600000,
    c.now,
    original.sourceSnapshotId,
  ).run();
  await stmt(
    c.db,
    "UPDATE fixtures SET currentRevision=2 WHERE id=?",
    f.id,
  ).run();
  await stmt(
    c.db,
    "INSERT INTO fixture_catalog VALUES(?,'TEST_B',2026,?,'CONTRACT_TEST_ONLY','{}')",
    f.id,
    c.now,
  ).run();
  await generated();
  const decisions = await rows(
    c.db,
    "SELECT id FROM decisions WHERE strategyVersion='GENERAL_DOUBLE_LEG_PAPER_V2'",
  );
  const command = {
    decisionIds: decisions.map((d) => d.id),
    portfolioId: "paper:general-v2-double",
    expectedRevision: 0,
  };
  await assert.rejects(
    placeDouble({ ...c, failAt: 4 }, "fault-double", command),
  );
  assert.equal((await one(c.db, "SELECT COUNT(*) n FROM tickets")).n, 0);
  const placed = await autoPaper(c);
  assert.equal(placed.placed, 14); // Original 13 actions plus independent entertainment double.
  assert.equal((await autoPaper(c)).placed, 0);
  const ticket = await one(
    c.db,
    "SELECT * FROM tickets WHERE portfolioId='paper:general-v2-double'",
  );
  const legs = await rows(
    c.db,
    "SELECT * FROM ticket_legs WHERE ticketId=?",
    ticket.id,
  );
  assert.equal(legs.length, 2);
  const ledger = (await ledgerRows(c.db, "PAPER_RESEARCH")).filter(
    (t) => t.id === ticket.id,
  );
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].stakeAtoms, "20000000");
  assert.equal(ledger[0].odds, 4);
  assert.equal(ledger[0].leagues.length, 2);
  assert.equal(ledger[0].legCount, 2);
  assert.equal(ledger[0].outcome, "OPEN");
  assert.equal(ledger[0].legs[0].selectionLabel, "主胜");
  assert.equal(ledger[0].legs[0].odds, legs[0].frozenOdds);
  assert.equal(ledger[0].legs[0].finalScore, null);
  f = first;
  await result(1, 0);
  await autoSettle(c);
  assert.equal(
    (await one(c.db, "SELECT * FROM ticket_state WHERE ticketId=?", ticket.id))
      .currentStatus,
    "OPEN",
  );
  f = second;
  const partial = (await ledgerRows(c.db, "PAPER_RESEARCH")).find(
    (t) => t.id === ticket.id,
  )!;
  assert.equal(partial.outcome, "OPEN");
  assert.equal(partial.grossAtoms, null);
  assert.deepEqual(
    partial.legs.map((l: any) => l.outcome),
    ["WIN", "OPEN"],
  );
  await result(1, 0);
  await autoSettle(c);
  assert.equal(
    (await one(c.db, "SELECT * FROM ticket_state WHERE ticketId=?", ticket.id))
      .gross,
    80000000,
  );
  f = first;
  const contrary = await result(0, 1);
  const won = (await ledgerRows(c.db, "PAPER_RESEARCH")).find(
    (t) => t.id === ticket.id,
  )!;
  assert.equal(won.outcome, "WIN");
  assert.equal(won.grossAtoms, "80000000");
  assert.equal(won.pnlAtoms, "60000000");
  assert.deepEqual(
    won.legs.map((l: any) => l.finalScore),
    ["1–0", "1–0"],
  );
  await autoSettle(c);
  const review = (await ledgerRows(c.db, "PAPER_RESEARCH")).find(
    (t) => t.id === ticket.id,
  )!;
  assert.equal(review.outcome, "REVIEW");
  assert.equal(review.pnlAtoms, null);
  assert.equal(
    (await one(c.db, "SELECT * FROM ticket_state WHERE ticketId=?", ticket.id))
      .currentStatus,
    "REVIEW",
  );
  await adjudicate(c, "correct-double", {
    fixtureId: f.id,
    expectedRevision: (
      await one(
        c.db,
        "SELECT MAX(revision) n FROM result_adjudications WHERE fixtureId=?",
        f.id,
      )
    ).n,
    selectedEvidenceId: contrary,
    reason: "CONTRACT_TEST_CORRECTION",
  });
  await autoSettle(c);
  const corrected = (await ledgerRows(c.db, "PAPER_RESEARCH")).find(
    (t) => t.id === ticket.id,
  )!;
  assert.equal(corrected.outcome, "LOSS");
  assert.equal(corrected.pnlAtoms, "-20000000");
  assert.deepEqual(
    corrected.legs.map((l: any) => l.outcome),
    ["LOSS", "WIN"],
  );
  assert.equal(
    (await one(c.db, "SELECT * FROM ticket_state WHERE ticketId=?", ticket.id))
      .gross,
    0,
  );
  assert.deepEqual(
    await rows(c.db, "SELECT * FROM ticket_legs WHERE ticketId=?", ticket.id),
    legs,
  );
  const account = await summary(c.db, ticket.portfolioId);
  assert.equal(
    Number(account.available) + Number(account.openStake),
    Number(account.initial) + Number(account.realized),
  );
});
