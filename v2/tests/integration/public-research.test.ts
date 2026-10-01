import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
// @ts-ignore shared isolated runtime
import { engine, migrate } from "../../scripts/runtime-lib.mjs";
// @ts-ignore shared worker build
import { workerBuild } from "../../scripts/build.mjs";
import { captureESPN } from "../../apps/api/src/services/automation";
import { claim, complete } from "../../apps/api/src/services/observations";
import {
  importWorkspace,
  workspaceSchedule,
  workspaceFixture,
} from "../../apps/api/src/services/workspace";
import { rows, stmt } from "../../apps/api/src/repositories/db";
test("public fixture to frozen quote, real Python inference, decision and migration replay preserves evidence without placing tickets", async () => {
  await workerBuild();
  const cfg = {
    installationId: crypto.randomUUID(),
    mode: "LOCAL_RESEARCH",
    bootstrap: "test",
    serviceToken: "test",
    webOrigin: "http://127.0.0.1:5293",
    appCodeSha: "public-research-test",
  };
  const mf = engine(cfg, ".runtime-v2/public-research-test", {
    port: 0,
    persist: false,
  });
  try {
    const db = await mf.getD1Database("DB"),
      now = Date.now(),
      c = { db, installationId: cfg.installationId, now },
      kickoff = now + 3 * 3600000,
      day = new Date(kickoff).toISOString().slice(0, 10);
    await migrate(db, cfg);
    await importWorkspace(c, {
      sourceHash: "a".repeat(64),
      sourceCutoffAt: now,
      metadata: { leagues: [{ code: "fifa.friendly", name: "国家队友谊赛" }] },
      study: { models: [] },
    });
    const home = { id: "1", displayName: "Maldives" },
      away = { id: "2", displayName: "Lebanon" };
    const competitors = [
        { homeAway: "home", team: home },
        { homeAway: "away", team: away },
      ],
      odds = {
        provider: { name: "Recorded public test" },
        moneyline: {
          home: { close: { odds: "+200" } },
          draw: { close: { odds: "+220" } },
          away: { close: { odds: "+200" } },
        },
      };
    const event = {
      id: "123456",
      date: new Date(kickoff).toISOString(),
      competitions: [
        {
          competitors,
          status: { type: { state: "pre", name: "STATUS_SCHEDULED" } },
          odds: [null, odds],
        },
      ],
    };
    const summary = {
      header: {
        id: "123456",
        competitions: [{ competitors, neutralSite: true }],
      },
      lastFiveGames: [home, away].map((t) => ({
        team: t,
        events: Array.from({ length: 5 }, (_, i) => ({
          id: String(400 + i + Number(t.id) * 10),
          gameDate: new Date(now - (i + 1) * 3 * 86400000).toISOString(),
          homeTeamId: t.id,
          homeTeamScore: "1",
          awayTeamScore: "1",
          opponent: { displayName: "Known opponent" },
        })),
      })),
      rosters: [],
      standings: { groups: [] },
      news: { articles: [] },
    };
    const fetcher: any = async (url: any) =>
      Response.json(
        String(url).includes("summary?") ? summary : { events: [event] },
      );
    await captureESPN(c, "fifa.friendly", day, fetcher);
    assert.equal((await rows(db, "SELECT * FROM quote_sets")).length, 1);
    assert.equal((await rows(db, "SELECT * FROM quote_selections")).length, 3);
    assert.equal((await rows(db, "SELECT * FROM jobs")).length, 2);
    assert.equal((await rows(db, "SELECT * FROM source_snapshots")).length, 2);
    for (let i = 0; i < 2; i++) {
      const job = await claim({ ...c, now: Date.now() }, "python-test");
      assert.ok(job);
      const p = spawnSync(
        path.resolve(".venv/Scripts/python.exe"),
        [
          "-c",
          "import json,sys;sys.stdin.reconfigure(encoding='utf-8');from runner import predict;print(json.dumps(predict(json.load(sys.stdin))))",
        ],
        {
          cwd: path.resolve("model-runner"),
          input: JSON.stringify(job),
          encoding: "utf8",
          windowsHide: true,
        },
      );
      assert.equal(p.status, 0, p.stderr);
      const result = await complete({ ...c, now: Date.now() }, job.id, {
        owner: "python-test",
        fencingToken: job.fencingToken,
        bundleHash: job.bundleHash,
        modelHash: job.modelHash,
        central: JSON.parse(p.stdout),
        featureCanonical: job.canonical,
      });
      assert.equal(result.state, "DONE");
    }
    const detail = await workspaceFixture(
      { ...c, now: Date.now() },
      "espn:fifa.friendly:123456",
    );
    assert.equal(detail.predictions.length, 2);
    assert.equal(detail.quotes[0].providerUpdatedAt, null);
    assert.equal(detail.models[0].status, "UNSUPPORTED_COMPETITION");
    const hashes = detail.predictions.map((p) => p.predictionHash);
    await assert.rejects(
      stmt(
        db,
        "UPDATE predictions SET centralJson='[1,0,0]' WHERE id=?",
        detail.predictions[0].id,
      ).run(),
      /IMMUTABLE_FACT/,
    );
    assert.equal((await rows(db, "SELECT * FROM tickets")).length, 0);
    assert.equal((await rows(db, "SELECT * FROM portfolios")).length, 0);
    await captureESPN({ ...c, now: Date.now() }, "fifa.friendly", day, fetcher);
    assert.equal((await rows(db, "SELECT * FROM quote_sets")).length, 1);
    await migrate(db, cfg);
    const schedule = await workspaceSchedule(
      { ...c, now: kickoff + 1 },
      new URLSearchParams("upcoming=1"),
    );
    assert.equal(schedule.total, 0);
    assert.deepEqual(
      (
        await workspaceFixture(
          { ...c, now: kickoff + 1 },
          "espn:fifa.friendly:123456",
        )
      ).predictions.map((p) => p.predictionHash),
      hashes,
    );
  } finally {
    await mf.dispose();
  }
});
