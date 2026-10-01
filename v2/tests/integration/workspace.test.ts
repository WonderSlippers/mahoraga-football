import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
// @ts-ignore shared isolated runtime
import { engine, migrate } from "../../scripts/runtime-lib.mjs";
// @ts-ignore shared build
import { workerBuild } from "../../scripts/build.mjs";
import {
  importWorkspace,
  workspaceSchedule,
  workspaceReport,
  modelLaboratory,
  workspaceFixture,
  restoreLegacyFixtureCatalog,
} from "../../apps/api/src/services/workspace";
import {
  captureESPN,
  autoSettle,
  automationTick,
} from "../../apps/api/src/services/automation";
import {
  observe,
  claim,
  complete,
} from "../../apps/api/src/services/observations";
import { place, summary } from "../../apps/api/src/services/commands";
import { adjudicate } from "../../apps/api/src/services/adjudications";
import {
  importPreview,
  importCommit,
} from "../../apps/api/src/services/imports";
import { stmt, rows } from "../../apps/api/src/repositories/db";
test("full schedule retains noncandidate fixtures and auto capture publishes source evidence; empty/failed stay distinct", async () => {
  await workerBuild();
  const cfg = {
    installationId: crypto.randomUUID(),
    mode: "LOCAL_RESEARCH",
    bootstrap: "test",
    serviceToken: "test",
    webOrigin: "http://127.0.0.1:5293",
    appCodeSha: "functional-test",
  };
  const mf = engine(cfg, ".runtime-v2/functional-test", {
    port: 0,
    persist: false,
  });
  try {
    const db = await mf.getD1Database("DB");
    await migrate(db, cfg);
    const c = {
      db,
      installationId: cfg.installationId,
      now: Date.parse("2026-10-01T08:00:00Z"),
    };
    const payload = {
      sourceHash: "a".repeat(64),
      sourceCutoffAt: c.now,
      metadata: {
        leagues: [{ code: "eng.1", name: "英超" }],
        settings: { autoStake: 20 },
        savedResearchObservations: [
          {
            contentHash: "b".repeat(64),
            collections: ["reviews", "marketReviews"],
            raw: {
              leg: {
                home: "Original",
                away: "Observation",
                leagueCode: "eng.1",
                odds: 1.75,
                evidence: {
                  modelVersion: "old-research",
                  calculatedAt: c.now - 86400000,
                },
              },
            },
          },
        ],
        savedQuoteIndex: {
          "eng.1|old-match": {
            markets: [],
            oneXTwo: [
              {
                id: "old-price",
                captured_at: "1788249600000",
                home_odds: "1.75",
                draw_odds: "3.5",
                away_odds: "5",
                provider: "original",
              },
            ],
          },
        },
      },
      study: { models: [] },
    };
    const first = await importWorkspace(c, payload);
    const researchOnly = await workspaceReport(
      c,
      new URLSearchParams("strategy=" + encodeURIComponent("旧研究观测")),
      "history",
    );
    assert.equal(researchOnly.total, 1);
    assert.equal(researchOnly.items[0].at, c.now - 86400000);
    assert.equal(researchOnly.items[0].pnlAtoms, null);
    assert.equal(
      (await workspaceReport(c, new URLSearchParams(), "ledger")).total,
      0,
    );
    assert.equal((await importWorkspace(c, payload)).id, first.id);
    await assert.rejects(
      importWorkspace(c, {
        ...payload,
        metadata: { ...payload.metadata, settings: { autoStake: 30 } },
      }),
      /IDEMPOTENCY_CONFLICT/,
    );
    const files = [
      {
        name: "state.json",
        content: JSON.stringify({
          portfolios: [
            {
              id: "original",
              tickets: [
                {
                  id: "archive-ticket",
                  status: "win",
                  stake: 20,
                  pnl: 15,
                  legs: [
                    {
                      matchId: "old-match",
                      leagueCode: "eng.1",
                      home: "Historic Home",
                      away: "Historic Away",
                      kickoffAt: Date.parse("2026-09-01T12:00:00Z"),
                      status: "win",
                      odds: 1.75,
                      priceCapturedAt: null,
                      probability: 0.6,
                      evidence: { modelVersion: "old-V6" },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      },
    ];
    const preview = await importPreview(c, {
      namespace: "readonly-test",
      files,
    });
    await importCommit(c, {
      previewId: preview.id,
      previewHash: preview.previewHash,
      files,
    });
    assert.equal(
      (await restoreLegacyFixtureCatalog(c, payload.sourceHash)).fixtures,
      1,
    );
    assert.equal(
      (await restoreLegacyFixtureCatalog(c, payload.sourceHash)).fixtures,
      0,
    );
    const original = (await rows(db, "SELECT * FROM fixture_catalog")).find(
      (r) => r.fixtureId.startsWith("legacy:"),
    )!;
    const detail = await workspaceFixture(c, original.fixtureId);
    assert.equal(detail.publicData.legacyMarkets[0].odds, 1.75);
    assert.equal(detail.publicData.legacyMarkets[0].priceCapturedAt, null);
    assert.equal(detail.archives.length, 1);
    assert.equal(detail.savedQuotes.oneXTwo[0].captured_at, "1788249600000");
    assert(
      Math.abs(
        detail.savedQuotes.oneXTwo[0].marketProbabilities.reduce(
          (s: number, p: number) => s + p,
          0,
        ) - 1,
      ) < 1e-12,
    );
    assert.equal(detail.predictions.length, 0);
    assert.equal((await rows(db, "SELECT * FROM tickets")).length, 0);
    await stmt(
      db,
      "INSERT INTO automation_state VALUES('LOCAL_PIPELINE',1,0,?,NULL,?,'RUNNING',NULL)",
      c.now,
      c.now + 60000,
    ).run();
    let fetched = false;
    const locked = await automationTick(c, "LOCAL_RESEARCH", true, async () => {
      fetched = true;
      return Response.json({ events: [] });
    });
    assert.equal(locked.stage, "RUNNING");
    assert.equal(fetched, false);
    const recorded = {
      events: [
        {
          id: "12345",
          date: "2026-10-01T12:00:00Z",
          competitions: [
            {
              status: { type: { state: "pre", name: "STATUS_SCHEDULED" } },
              competitors: [
                {
                  homeAway: "home",
                  team: { id: "1", displayName: "Not selected home" },
                },
                {
                  homeAway: "away",
                  team: { id: "2", displayName: "Not selected away" },
                },
              ],
            },
          ],
        },
      ],
    };
    await captureESPN(c, "eng.1", "2026-10-01", async () =>
      Response.json(recorded),
    );
    const schedule = await workspaceSchedule(
      c,
      new URLSearchParams("from=2026-10-01&to=2026-10-01"),
    );
    assert.equal(schedule.total, 1);
    assert.equal(schedule.items[0].state, "MISSING_DATA");
    assert.equal(schedule.strictCandidates.length, 0);
    assert.equal((await rows(db, "SELECT * FROM source_chunks")).length, 2);
    await captureESPN(c, "eng.1", "2026-10-02", async () =>
      Response.json({ events: [] }),
    );
    assert.equal(
      (await rows(db, "SELECT state FROM source_runs WHERE state='EMPTY'"))
        .length,
      1,
    );
    await assert.rejects(
      captureESPN(
        c,
        "eng.1",
        "2026-10-03",
        async () => new Response("limited", { status: 429 }),
      ),
    );
    assert.equal(
      (await rows(db, "SELECT state FROM source_runs WHERE state='FAILED'"))
        .length,
      1,
    );
    assert.equal(
      (await workspaceReport(c, new URLSearchParams("mode=PAPER"), "ledger"))
        .summary.roi,
      null,
    );
    assert.equal(
      (await modelLaboratory(c, new URLSearchParams())).prospective.n,
      0,
    );
  } finally {
    await mf.dispose();
  }
});
test("automatic unambiguous result settlement reuses the existing atomic ledger and repeats without financial effect", async () => {
  await workerBuild();
  const cfg = {
    installationId: crypto.randomUUID(),
    mode: "DEMO",
    bootstrap: "test",
    serviceToken: "test",
    webOrigin: "http://127.0.0.1:5293",
    appCodeSha: "auto-settle-test",
  };
  const mf = engine(cfg, ".runtime-v2/auto-settle-test", {
    port: 0,
    persist: false,
  });
  try {
    const db = await mf.getD1Database("DB");
    await migrate(db, cfg);
    const c = { db, installationId: cfg.installationId, now: Date.now() };
    const f = await observe(c, "observe-auto");
    for (let i = 0; i < 2; i++) {
      const j = await claim(c, "runner");
      const q = JSON.parse(j!.canonical);
      await complete(c, j!.id, {
        owner: "runner",
        fencingToken: j!.fencingToken,
        bundleHash: j!.bundleHash,
        modelHash: j!.modelHash,
        central: j!.modelId.startsWith("DEMO")
          ? [0.6, 0.25, 0.15]
          : [1 / 2, 1 / 3.2, 1 / 4].map(
              (n, _, a) => n / a.reduce((s, v) => s + v, 0),
            ),
        featureCanonical: j!.canonical,
      });
    }
    const decision = (
      await rows(db, "SELECT d.id FROM decisions d WHERE accepted=1")
    )[0];
    await place(c, "ticket-auto", {
      decisionId: decision.id,
      portfolioId: "demo",
      stakeAtoms: "25000000",
      expectedRevision: 0,
    });
    const snap = (await rows(db, "SELECT id FROM source_snapshots"))[0];
    await stmt(
      db,
      "INSERT INTO result_observations VALUES(?,?,?,?,?,?)",
      crypto.randomUUID(),
      f.id,
      snap.id,
      JSON.stringify({ home: 2, away: 0 }),
      "FINISHED",
      c.now + 1000,
    ).run();
    await autoSettle({ ...c, now: c.now + 2000 });
    const before = await summary(db, "demo");
    assert.equal(before.available, "125000000");
    const count = (await rows(db, "SELECT * FROM ledger_entries")).length;
    await autoSettle({ ...c, now: c.now + 3000 });
    assert.deepEqual(await summary(db, "demo"), before);
    assert.equal(
      (await rows(db, "SELECT * FROM ledger_entries")).length,
      count,
    );
    const correctedId = crypto.randomUUID();
    await stmt(
      db,
      "INSERT INTO result_observations VALUES(?,?,?,?,?,?)",
      correctedId,
      f.id,
      snap.id,
      JSON.stringify({ home: 0, away: 1 }),
      "FINISHED",
      c.now + 4000,
    ).run();
    await autoSettle({ ...c, now: c.now + 5000 });
    assert.equal(
      (
        await rows(
          db,
          "SELECT state FROM result_adjudications ORDER BY revision DESC LIMIT 1",
        )
      )[0].state,
      "REVIEW",
    );
    const latest = (
      await rows(
        db,
        "SELECT revision FROM result_adjudications ORDER BY revision DESC LIMIT 1",
      )
    )[0];
    await adjudicate({ ...c, now: c.now + 6000 }, "manual-correction", {
      fixtureId: f.id,
      expectedRevision: latest.revision,
      selectedEvidenceId: correctedId,
      reason: "CONTRACT TEST ONLY: resolve contradictory observation",
    });
    await autoSettle({ ...c, now: c.now + 7000 });
    const corrected = await summary(db, "demo");
    assert.equal(
      corrected.available,
      "75000000",
      "Automatic settlement must use latest manual adjudication, never an old auto receipt",
    );
    const correctedEntries = (await rows(db, "SELECT id FROM ledger_entries"))
      .length;
    await autoSettle({ ...c, now: c.now + 8000 });
    assert.deepEqual(await summary(db, "demo"), corrected);
    assert.equal(
      (await rows(db, "SELECT id FROM ledger_entries")).length,
      correctedEntries,
    );
  } finally {
    await mf.dispose();
  }
});
