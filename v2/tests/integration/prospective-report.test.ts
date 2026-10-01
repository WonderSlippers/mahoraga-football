import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
// @ts-ignore shared isolated runtime
import { engine, migrate } from "../../scripts/runtime-lib.mjs";
// @ts-ignore shared build
import { workerBuild } from "../../scripts/build.mjs";
import {
  modelLaboratory,
  importWorkspace,
  workspaceReport,
} from "../../apps/api/src/services/workspace";
import {
  importPreview,
  importCommit,
} from "../../apps/api/src/services/imports";
import { stmt } from "../../apps/api/src/repositories/db";

test("strict cohort changes 0 to 1 from capture-time gates, excludes retrospective/DEMO and never retroactively promotes or double counts", async () => {
  await workerBuild();
  const cfg = {
      installationId: crypto.randomUUID(),
      mode: "LOCAL_RESEARCH",
      bootstrap: "test",
      serviceToken: "test",
      webOrigin: "http://127.0.0.1:5293",
      appCodeSha: "TEST_ONLY_COHORT_NOT_MODEL_VALIDATION",
    },
    mf = engine(cfg, ".runtime-v2/prospective-report-test", {
      port: 0,
      persist: false,
    });
  try {
    const db = await mf.getD1Database("DB"),
      now = Date.parse("2026-10-01T08:00:00Z"),
      c = { db, installationId: cfg.installationId, now };
    await migrate(db, cfg);
    await importWorkspace(c, {
      sourceHash: "1".repeat(64),
      sourceCutoffAt: now,
      metadata: { leagues: [] },
      study: { models: [] },
    });
    const count = async () =>
      (await modelLaboratory(c, new URLSearchParams())).prospective;
    assert.equal((await count()).n, 0);
    // These fixtures and outputs are test records for report qualification, not inference evidence.
    const add = async (id: string, options: any = {}) => {
      const model = options.model ?? id,
        fixture = options.fixture ?? id,
        at = now - 10000,
        manifest = {
          id: model,
          trainCutoffAt: new Date(now - 86400000).toISOString(),
          validation: options.validation ?? "TEST_ONLY",
        };
      const statements = [
        stmt(
          db,
          "INSERT OR IGNORE INTO model_manifests VALUES(?,?,?,'CENTRAL_1X2','REGISTERED')",
          model,
          JSON.stringify(manifest),
          "test-hash",
        ),
        stmt(
          db,
          "INSERT OR IGNORE INTO fixtures VALUES(?,?,?,1,'SCHEDULED')",
          fixture,
          "TEST HOME " + fixture,
          "TEST AWAY " + fixture,
        ),
        stmt(
          db,
          "INSERT INTO source_snapshots VALUES(?,?,?,?,?,? ,?,?,'COMPLETE')",
          id,
          "TEST",
          id,
          at,
          at,
          at,
          "test-hash",
          options.mode ?? "LOCAL_RESEARCH",
        ),
        stmt(
          db,
          "INSERT OR IGNORE INTO fixture_revisions VALUES(?,?,1,?,?,?)",
          "rev-" + fixture,
          fixture,
          now + 3600000,
          at,
          id,
        ),
        stmt(
          db,
          "INSERT OR IGNORE INTO market_definitions VALUES(?,?,?,'REGULATION_90','1X2')",
          "market-" + fixture,
          fixture,
          fixture,
        ),
        stmt(
          db,
          "INSERT INTO quote_sets VALUES(?,?,?,?,?,?,?,0,?)",
          id,
          "market-" + fixture,
          id,
          "TEST",
          at,
          options.missingTime ? null : at,
          options.phase ?? "PREMATCH_OBSERVED",
          "test-hash",
        ),
        stmt(
          db,
          "INSERT INTO observation_slots VALUES(?,?,?, ?,?,'DONE',NULL)",
          id,
          "rev-" + fixture,
          "TEST_ONLY_" + id,
          at,
          now + 300000,
        ),
        stmt(
          db,
          "INSERT INTO input_bundles VALUES(?,?,?,?,?,?,'READY')",
          id,
          id,
          id,
          at,
          "test-hash",
          "{}",
        ),
        stmt(
          db,
          "INSERT INTO feature_snapshots VALUES(?,?,?,?,?)",
          id,
          id,
          model,
          "test-hash",
          "{}",
        ),
        stmt(
          db,
          "INSERT INTO predictions VALUES(?,?,?,?,?,?,?,?)",
          id,
          id,
          "rev-" + fixture,
          model,
          id,
          now - 5000,
          "[0.5,0.3,0.2]",
          "TEST_NOT_VALIDATION",
        ),
      ];
      if (options.shadow)
        statements.push(
          stmt(
            db,
            "INSERT INTO model_registry_events VALUES(?,?,'SHADOW','TEST','TEST ONLY',?)",
            id,
            model,
            options.later ? now - 1000 : now - 20000,
          ),
        );
      await db.batch(statements);
    };
    await add("missing-time", { shadow: true, missingTime: true });
    await add("later-promotion", { shadow: true, later: true });
    await add("demo", { shadow: true, mode: "DEMO" });
    await add("retro", { shadow: true, validation: "RETROSPECTIVE" });
    await add("public-reference", {
      shadow: true,
      phase: "PUBLIC_REFERENCE_CAPTURED",
    });
    assert.equal((await count()).n, 0);
    await add("qualified", { shadow: true });
    assert.equal((await count()).n, 1);
    await add("second-capture", { model: "qualified", fixture: "qualified" });
    assert.equal((await count()).n, 1);
    await importWorkspace(c, {
      sourceHash: "2".repeat(64),
      sourceCutoffAt: now,
      metadata: {
        leagues: [],
        savedResearchObservations: [
          {
            contentHash: "3".repeat(64),
            raw: {
              leg: {
                home: "OLD",
                away: "ARCHIVE",
                evidence: {
                  modelVersion: "qualified",
                  calculatedAt: now - 100000,
                },
              },
            },
          },
        ],
      },
      study: { models: [] },
    });
    assert.equal((await count()).n, 1);
    assert.equal((await count()).roi, null);
  } finally {
    await mf.dispose();
  }
});

test("ledger date ranges separate new stake from later settlement and retain earlier open exposure", async () => {
  await workerBuild();
  const cfg = {
      installationId: crypto.randomUUID(),
      mode: "LOCAL_RESEARCH",
      bootstrap: "test",
      serviceToken: "test",
      webOrigin: "http://127.0.0.1:5293",
      appCodeSha: "ledger-date-test",
    },
    mf = engine(cfg, ".runtime-v2/ledger-date-test", {
      port: 0,
      persist: false,
    });
  try {
    const db = await mf.getD1Database("DB"),
      now = Date.parse("2026-10-01T23:00:00Z"),
      c = { db, installationId: cfg.installationId, now };
    await migrate(db, cfg);
    const files = [
      {
        name: "state.json",
        content: JSON.stringify({
          portfolios: [
            {
              id: "test",
              tickets: [
                {
                  id: "old-settled",
                  createdAt: Date.parse("2026-09-30T20:00Z"),
                  settledAt: Date.parse("2026-10-01T10:00Z"),
                  status: "win",
                  stake: 20,
                  pnl: 10,
                  odds: 1.5,
                  legs: [
                    { home: "OLD", away: "WIN", odds: 1.5, status: "win" },
                  ],
                },
                {
                  id: "old-open",
                  createdAt: Date.parse("2026-09-30T20:00Z"),
                  status: "open",
                  stake: 20,
                  odds: 2,
                  legs: [
                    { home: "OLD", away: "OPEN", odds: 2, status: "open" },
                  ],
                },
                {
                  id: "new-open",
                  createdAt: Date.parse("2026-10-01T20:00Z"),
                  status: "open",
                  stake: 20,
                  odds: 2,
                  legs: [
                    { home: "NEW", away: "OPEN", odds: 2, status: "open" },
                  ],
                },
              ],
            },
          ],
        }),
      },
    ];
    const preview = await importPreview(c, { namespace: "test-date", files });
    await importCommit(c, {
      previewId: preview.id,
      previewHash: preview.previewHash,
      files,
    });
    const daily = await workspaceReport(
      c,
      new URLSearchParams("mode=LEGACY_IMPORT&period=TODAY"),
      "ledger",
    );
    assert.equal(daily.total, 2);
    assert.equal(daily.summary.stakeAtoms, "20000000");
    assert.equal(daily.summary.profitAtoms, "10000000");
    assert.equal(daily.summary.roi, 0.5);
    assert.equal(daily.exposure.open, 2);
    assert.equal(daily.exposure.stakeAtoms, "40000000");
    const berlinHistory = await workspaceReport(
      c,
      new URLSearchParams("from=2026-10-02&to=2026-10-02"),
      "history",
    );
    assert.equal(berlinHistory.total, 0);
  } finally {
    await mf.dispose();
  }
});
