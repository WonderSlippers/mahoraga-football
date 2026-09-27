import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
// @ts-ignore shared local runner
import { engine, migrate, hash } from "../../scripts/runtime-lib.mjs";
// @ts-ignore shared build
import { workerBuild } from "../../scripts/build.mjs";
import {
  observe,
  claim,
  complete,
  demoResult,
} from "../../apps/api/src/services/observations";
import {
  place,
  settle,
  summary,
  Context,
} from "../../apps/api/src/services/commands";
import { one, rows, stmt } from "../../apps/api/src/repositories/db";
import { marketBaseline } from "../../packages/domain/index";
import { reschedule } from "../../apps/api/src/services/revisions";
let mf: any, db: D1Database, c: Context, config: any;
before(async () => {
  await workerBuild();
});
beforeEach(async () => {
  config = {
    installationId: crypto.randomUUID(),
    mode: "DEMO",
    webOrigin: "http://127.0.0.1:5273",
    bootstrap: crypto.randomUUID(),
    serviceToken: crypto.randomUUID(),
    appCodeSha: "integration",
  };
  mf = engine(config, ".runtime-v2/integration", { port: 0, persist: false });
  db = await mf.getD1Database("DB");
  await migrate(db, config);
  c = { db, installationId: config.installationId, now: Date.now() };
});
afterEach(async () => {
  await mf.dispose();
});
async function generated() {
  const f = await observe(c, crypto.randomUUID());
  for (let i = 0; i < 2; i++) {
    const j = await claim(c, "test");
    await complete(c, j.id, {
      owner: "test",
      fencingToken: j.fencingToken,
      bundleHash: j.bundleHash,
      modelHash: j.modelHash,
      featureCanonical: j.canonical,
      central:
        j.modelId === "DEMO_FIXED_CENTRAL_V1"
          ? [0.6, 0.25, 0.15]
          : marketBaseline(JSON.parse(j.canonical).odds),
    });
  }
  const d = await one(
    db,
    `SELECT d.id FROM decisions d JOIN market_expectations e ON e.id=d.expectationId JOIN predictions p ON p.id=e.predictionId JOIN fixture_revisions r ON r.id=p.fixtureRevisionId WHERE r.fixtureId=? AND d.accepted=1`,
    f.id,
  );
  return { fixtureId: f.id, decisionId: d.id };
}
async function ticket(stake = "25000000") {
  const g = await generated();
  const p = await summary(db, "demo");
  const t = await place(c, crypto.randomUUID(), {
    decisionId: g.decisionId,
    portfolioId: "demo",
    stakeAtoms: stake,
    expectedRevision: p.revision,
  });
  return { ...g, ticketId: t.id };
}
async function adjudicate(g: any, scenario: string) {
  const prev = await stmt(
    db,
    "SELECT MAX(revision) AS n FROM result_adjudications WHERE fixtureId=?",
    g.fixtureId,
  ).first<any>();
  return demoResult(c, crypto.randomUUID(), {
    fixtureId: g.fixtureId,
    scenario,
    expectedRevision: prev?.n || 0,
    reason: "DEMO integration evidence",
  });
}
async function apply(g: any, a: any) {
  return settle(c, crypto.randomUUID(), {
    ticketId: g.ticketId,
    adjudicationId: a.id,
    expectedRevision: (await summary(db, "demo")).revision,
  });
}
async function replay() {
  const p = await summary(db, "demo");
  const s = await one(
    db,
    "SELECT COALESCE(SUM(availableDelta),0) a,COALESCE(SUM(openDelta),0) o,COALESCE(SUM(realizedDelta),0) r FROM ledger_entries",
  );
  assert.equal(Number(p.available), Number(p.initial) + s.a);
  assert.equal(Number(p.openStake), s.o);
  assert.equal(Number(p.realized), s.r);
  assert.equal(
    Number(p.available) + Number(p.openStake),
    Number(p.initial) + Number(p.realized),
  );
  return p;
}
test("A14 A15 D1 constraints, migration replay, immutable triggers and isolation", async () => {
  await migrate(db, config);
  assert.equal((await rows(db, "SELECT * FROM portfolios")).length, 1);
  await assert.rejects(migrate(db, { ...config, installationId: "wrong" }));
  await assert.rejects(
    db
      .prepare(
        "INSERT INTO fixture_revisions VALUES('x','missing',1,1,1,'none')",
      )
      .run(),
  );
  await assert.rejects(
    db
      .prepare("INSERT INTO fixtures VALUES('x','same','same',1,'SCHEDULED')")
      .run(),
  );
  const g = await generated();
  await assert.rejects(
    db.prepare("UPDATE predictions SET centralJson=?").bind("[0,0,1]").run(),
  );
  await assert.rejects(db.prepare("DELETE FROM predictions").run());
  const market = await one(db, "SELECT * FROM market_definitions LIMIT 1");
  await assert.rejects(
    stmt(
      db,
      "INSERT INTO market_definitions VALUES(?,?,?,?,?)",
      crypto.randomUUID(),
      g.fixtureId,
      market.specHash,
      "REGULATION_90",
      "1X2",
    ).run(),
  );
});
test("A26 A27 A28 A29 A30 frozen chain, no-action and unchanged explanation", async () => {
  const first = await observe(c, "same-slot");
  assert.deepEqual(await observe(c, "same-slot"), first);
  assert.equal((await rows(db, "SELECT * FROM observation_slots")).length, 1);
  const j = await claim(c, "o");
  await assert.rejects(
    complete(c, j.id, {
      owner: "o",
      fencingToken: j.fencingToken,
      bundleHash: "bad",
      modelHash: j.modelHash,
      featureCanonical: j.canonical,
      central: [0.6, 0.25, 0.15],
    }),
  );
  await complete(c, j.id, {
    owner: "o",
    fencingToken: j.fencingToken,
    bundleHash: j.bundleHash,
    modelHash: j.modelHash,
    featureCanonical: j.canonical,
    central: marketBaseline(["2", "3.2", "4"]),
  });
  const before = await rows(db, "SELECT * FROM predictions");
  assert.ok(
    (await rows(db, "SELECT * FROM decisions")).every((d) => d.accepted === 0),
  );
  await demoResult(c, "r", {
    fixtureId: first.id,
    scenario: "LOSS",
    expectedRevision: 0,
    reason: "synthetic",
  });
  assert.deepEqual(await rows(db, "SELECT * FROM predictions"), before);
});
test("A31 same key 100 concurrent replays, altered payload and business duplicates", async () => {
  const g = await generated();
  const payload = {
    decisionId: g.decisionId,
    portfolioId: "demo",
    stakeAtoms: "25000000",
    expectedRevision: 0,
  };
  const all = await Promise.all(
    Array.from({ length: 100 }, () => place(c, "same", payload)),
  );
  assert.equal(new Set(all.map((x) => x.id)).size, 1);
  assert.equal((await rows(db, "SELECT * FROM tickets")).length, 1);
  await assert.rejects(
    place(c, "same", { ...payload, stakeAtoms: "30000000" }),
    /IDEMPOTENCY_CONFLICT/,
  );
  await assert.rejects(
    place(c, "other", { ...payload, expectedRevision: 1 }),
    /DUPLICATE_BUSINESS_ACTION/,
  );
  await replay();
});
test("A32 every ticket statement failure rolls receipt/ticket/ledger/account back", async () => {
  const g = await generated();
  for (let failAt = 0; failAt <= 6; failAt++) {
    await assert.rejects(
      place({ ...c, failAt }, "fault-" + failAt, {
        decisionId: g.decisionId,
        portfolioId: "demo",
        stakeAtoms: "25000000",
        expectedRevision: 0,
      }),
    );
    assert.equal((await rows(db, "SELECT * FROM tickets")).length, 0);
    assert.equal((await rows(db, "SELECT * FROM ledger_entries")).length, 0);
    assert.equal((await summary(db, "demo")).revision, 0);
    assert.equal(
      (
        await rows(
          db,
          "SELECT * FROM command_receipts WHERE scope LIKE '%:place'",
        )
      ).length,
      0,
    );
  }
});
test("A33 A34 CAS conflict and competing balance cannot publish a half ticket", async () => {
  const a = await generated(),
    b = await generated();
  const result = await Promise.allSettled(
    [a, b].map((g) =>
      place(c, crypto.randomUUID(), {
        decisionId: g.decisionId,
        portfolioId: "demo",
        stakeAtoms: "75000000",
        expectedRevision: 0,
      }),
    ),
  );
  assert.equal(result.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal((await rows(db, "SELECT * FROM tickets")).length, 1);
  assert.equal((await replay()).revision, 1);
});
test("A35 A36 A28 win to loss, duplicate adjudication, reopen, void, immutable original", async () => {
  const g = await ticket();
  const original = await one(
      db,
      "SELECT * FROM tickets WHERE id=?",
      g.ticketId,
    ),
    predictions = await rows(db, "SELECT * FROM predictions");
  const win = await adjudicate(g, "WIN");
  await apply(g, win);
  assert.equal((await replay()).available, "125000000");
  await apply(g, win);
  assert.equal((await replay()).revision, 2);
  const loss = await adjudicate(g, "LOSS");
  await apply(g, loss);
  assert.equal((await replay()).available, "75000000");
  await apply(g, await adjudicate(g, "CONFLICT"));
  let p = await replay();
  assert.equal(p.openStake, "25000000");
  assert.equal(p.realized, "0");
  await apply(g, await adjudicate(g, "VOID"));
  assert.equal((await replay()).available, "100000000");
  assert.deepEqual(
    await one(db, "SELECT * FROM tickets WHERE id=?", g.ticketId),
    original,
  );
  assert.deepEqual(await rows(db, "SELECT * FROM predictions"), predictions);
  assert.equal((await rows(db, "SELECT * FROM settlement_events")).length, 4);
});
test("A32 settlement failures rollback every statement", async () => {
  const g = await ticket(),
    win = await adjudicate(g, "WIN");
  for (let failAt = 0; failAt <= 5; failAt++) {
    await assert.rejects(
      settle({ ...c, failAt }, "settle-fault-" + failAt, {
        ticketId: g.ticketId,
        adjudicationId: win.id,
        expectedRevision: 1,
      }),
    );
    assert.equal((await rows(db, "SELECT * FROM settlement_events")).length, 0);
    assert.equal((await replay()).revision, 1);
  }
});
test("A37 correcting wins to losses may cause negative balance and freeze only new placement", async () => {
  const g = await ticket("100000000");
  await apply(g, await adjudicate(g, "WIN"));
  const other = await ticket("200000000");
  await apply(g, await adjudicate(g, "LOSS"));
  const p = await replay();
  assert.equal(p.available, "-200000000");
  assert.equal(p.frozen, 1);
  await apply(other, await adjudicate(other, "VOID"));
  assert.equal((await replay()).available, "0");
});
test("A39 A61 missing regulation score is review, recovery uses appended evidence", async () => {
  const g = await ticket();
  await apply(g, await adjudicate(g, "AET"));
  assert.equal(
    (await one(db, "SELECT * FROM ticket_state")).currentStatus,
    "REVIEW",
  );
  assert.equal((await replay()).openStake, "25000000");
  await apply(g, await adjudicate(g, "WIN"));
  assert.equal(
    (await one(db, "SELECT * FROM ticket_state")).currentStatus,
    "SETTLED",
  );
});
test("A46 runner lease fencing and changed input/model reject stale completion", async () => {
  await observe(c, "job");
  const j = await claim(c, "first");
  const newer = await claim({ ...c, now: c.now + 31000 }, "second");
  assert.equal(newer.id, j.id);
  await assert.rejects(
    complete({ ...c, now: c.now + 31000 }, j.id, {
      owner: "first",
      fencingToken: j.fencingToken,
      bundleHash: j.bundleHash,
      modelHash: j.modelHash,
      featureCanonical: j.canonical,
      central: [0.6, 0.25, 0.15],
    }),
    /LEASE_EXPIRED/,
  );
  assert.equal((await rows(db, "SELECT * FROM predictions")).length, 0);
});
test("A17 A18 A19 A62 real Worker routes reject false auth, cross-origin and authority fields", async () => {
  const fetch = (path: string, init: any = {}) =>
    mf.dispatchFetch("http://127.0.0.1:0" + path, init);
  let r = await fetch("/api/v2/meta", {
    headers: { "oai-authenticated-user": "owner" },
  });
  assert.equal(r.status, 401);
  r = await fetch("/api/v2/session/bootstrap", {
    method: "POST",
    headers: { Origin: config.webOrigin },
    body: JSON.stringify({ passphrase: config.bootstrap }),
  });
  assert.equal(r.status, 200);
  const cookie = r.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const csrf = (await r.json()).data.csrf;
  const headers = {
    Cookie: cookie,
    Origin: config.webOrigin,
    "X-CSRF-Token": csrf,
    "Idempotency-Key": "x",
  };
  assert.equal((await fetch("/api/v2/meta", { headers })).status, 200);
  assert.equal(
    (
      await fetch("/api/v2/paper-tickets", {
        method: "POST",
        headers,
        body: JSON.stringify({ status: "win", pnl: 20 }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch("/api/v2/observation-requests", {
        method: "POST",
        headers: { ...headers, Origin: "http://evil.test" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch("/api/v2/observation-requests", {
        method: "POST",
        headers: { ...headers, "X-CSRF-Token": "bad" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch("/api/v2/paper-tickets", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + config.serviceToken,
          Origin: config.webOrigin,
        },
        body: "{}",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch("/internal/v2/model-jobs/claim", {
        method: "POST",
        headers,
        body: '{"owner":"x"}',
      })
    ).status,
    401,
  );
  assert.equal(
    (await mf.dispatchFetch("http://evil.test/api/v2/meta", { headers }))
      .status,
    403,
  );
});
test("A48 A64 bounded meta and no-action ROI is null", async () => {
  const p = await summary(db, "demo");
  assert.equal(p.roi, null);
  await generated();
  assert.equal((await summary(db, "demo")).roi, null);
});
test("A16 A26 fixture revision preserves original ticket and supersedes slots", async () => {
  const g = await ticket();
  const before = await one(db, "SELECT * FROM ticket_legs");
  const changed = await reschedule(c, "move", {
    fixtureId: g.fixtureId,
    expectedRevision: 1,
    kickoffAt: c.now + 7200000,
  });
  assert.notEqual(changed.id, before.fixtureRevisionId);
  assert.deepEqual(await one(db, "SELECT * FROM ticket_legs"), before);
  assert.equal(
    (await one(db, "SELECT * FROM fixtures WHERE id=?", g.fixtureId))
      .currentRevision,
    2,
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT * FROM observation_slots WHERE fixtureRevisionId=?",
        before.fixtureRevisionId,
      )
    ).state,
    "SUPERSEDED",
  );
  await assert.rejects(
    place(c, "old-decision", {
      decisionId: g.decisionId,
      portfolioId: "demo",
      stakeAtoms: "1000000",
      expectedRevision: 1,
    }),
  );
});
test("A26 A27 A39 after-deadline or result cannot publish late prospective output", async () => {
  const f = await observe(c, "late");
  const j = await claim(c, "worker");
  const p = {
    owner: "worker",
    fencingToken: j.fencingToken,
    bundleHash: j.bundleHash,
    modelHash: j.modelHash,
    featureCanonical: j.canonical,
    central: [0.6, 0.25, 0.15],
  };
  await demoResult(c, "finish", {
    fixtureId: f.id,
    scenario: "WIN",
    expectedRevision: 0,
    reason: "DEMO result",
  });
  await assert.rejects(complete(c, j.id, p));
  await claim({ ...c, now: c.now + 600000 }, "late");
  assert.equal(
    (await one(db, "SELECT * FROM observation_slots")).state,
    "MISSED",
  );
  assert.equal((await rows(db, "SELECT * FROM predictions")).length, 0);
});
test("A31 model completion response replay is immutable and hash checked", async () => {
  await observe(c, "replay");
  const j = await claim(c, "worker");
  const p = {
    owner: "worker",
    fencingToken: j.fencingToken,
    bundleHash: j.bundleHash,
    modelHash: j.modelHash,
    featureCanonical: j.canonical,
    central: [0.6, 0.25, 0.15],
  };
  const a = await complete(c, j.id, p);
  assert.deepEqual(await complete(c, j.id, p), a);
  await assert.rejects(
    complete(c, j.id, { ...p, central: [0.5, 0.25, 0.25] }),
    /IDEMPOTENCY_CONFLICT/,
  );
});
test("A48 meta queue query stays bounded with 100000 synthetic tickets", async () => {
  const g = await generated();
  const before = await db
    .prepare("SELECT state,COUNT(*) AS count FROM jobs GROUP BY state")
    .all();
  await stmt(
    db,
    `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<100000) INSERT INTO tickets SELECT 'load-'||n,'demo',?,1,?,'load-'||n,'2026-09-28','DEMO' FROM seq`,
    g.decisionId,
    c.now,
  ).run();
  assert.equal((await one(db, "SELECT COUNT(*) n FROM tickets")).n, 100000);
  const after = await db
    .prepare("SELECT state,COUNT(*) AS count FROM jobs GROUP BY state")
    .all();
  assert.deepEqual(after.results, before.results);
  assert.equal(after.meta.rows_read, before.meta.rows_read);
  assert.ok(JSON.stringify(after.results).length < 16384);
});
