import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
// @ts-ignore isolated real runtime
import { engine, migrate } from "../../scripts/runtime-lib.mjs";
// @ts-ignore actual Worker build
import { workerBuild } from "../../scripts/build.mjs";
import {
  importPreview,
  importCommit,
} from "../../apps/api/src/services/imports";
import { workspaceReport } from "../../apps/api/src/services/workspace";
test("old multi-leg tickets retain original day and result; yesterday placement and settlement cohorts differ without duplicating stake", async () => {
  await workerBuild();
  const cfg = {
    installationId: crypto.randomUUID(),
    mode: "LOCAL_RESEARCH",
    bootstrap: "test",
    serviceToken: "test",
    webOrigin: "http://127.0.0.1:5390",
    appCodeSha: "ticket-review-test",
  };
  const mf = engine(cfg, ".runtime-v2/ticket-review-test", {
    port: 0,
    persist: false,
  });
  try {
    const db = await mf.getD1Database("DB");
    await migrate(db, cfg);
    const c = {
      db,
      installationId: cfg.installationId,
      now: Date.parse("2026-10-03T10:00:00Z"),
    };
    const files = [
      {
        name: "state.json",
        content: JSON.stringify({
          portfolios: [
            {
              id: "double",
              name: "二串一",
              tickets: [
                {
                  id: "old-double",
                  createdAt: Date.parse("2026-10-01T09:00:00Z"),
                  settledAt: Date.parse("2026-10-02T21:00:00Z"),
                  day: "2026-10-01",
                  odds: 3.8,
                  stake: 20,
                  pnl: 56,
                  status: "win",
                  legs: [
                    {
                      home: "Old H",
                      away: "Old A",
                      pick: 0,
                      odds: 1.9,
                      status: "win",
                      finalScore: "2-0",
                    },
                    {
                      home: "Old C",
                      away: "Old D",
                      pick: 2,
                      odds: 2,
                      status: "win",
                      finalScore: "0-1",
                    },
                  ],
                },
                {
                  id: "yesterday-open",
                  createdAt: Date.parse("2026-10-02T23:30:00Z"),
                  day: "2026-10-02",
                  odds: 2,
                  stake: 20,
                  status: "open",
                  legs: [
                    {
                      home: "Pending H",
                      away: "Pending A",
                      pick: 1,
                      odds: 2,
                      status: "open",
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
      namespace: "ticket-review-test",
      files,
    });
    await importCommit(c, {
      previewId: preview.id,
      previewHash: preview.previewHash,
      files,
    });
    const placed = await workspaceReport(
      c,
      new URLSearchParams("mode=LEGACY_IMPORT&period=YESTERDAY&basis=PLACED"),
      "ledger",
    );
    assert.equal(placed.total, 1);
    assert.equal(placed.items[0].raw.id, "yesterday-open");
    assert.equal(placed.items[0].outcome, "OPEN");
    assert.equal(placed.summary.stakeAtoms, "20000000");
    const settled = await workspaceReport(
      c,
      new URLSearchParams("mode=LEGACY_IMPORT&period=YESTERDAY&basis=SETTLED"),
      "ledger",
    );
    assert.equal(settled.total, 1);
    assert.equal(settled.items[0].legCount, 2);
    assert.equal(settled.items[0].outcome, "WIN");
    assert.equal(settled.items[0].grossAtoms, "76000000");
    assert.equal(settled.items[0].legs[1].selectionLabel, "客胜");
    assert.equal(settled.summary.profitAtoms, "56000000");
    assert.equal(settled.summary.settledStakeAtoms, "20000000");
    assert.equal(settled.items[0].settledDay, "2026-10-02");
    const today = await workspaceReport(
      c,
      new URLSearchParams("mode=LEGACY_IMPORT&period=TODAY&basis=PLACED"),
      "ledger",
    );
    assert.equal(today.total, 0);
    const all = await workspaceReport(
      c,
      new URLSearchParams(
        "mode=LEGACY_IMPORT&period=ALL&basis=PLACED&status=WIN",
      ),
      "ledger",
    );
    assert.equal(all.total, 1);
  } finally {
    await mf.dispose();
  }
});
