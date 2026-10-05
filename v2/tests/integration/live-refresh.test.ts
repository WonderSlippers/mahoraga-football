import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
// @ts-ignore isolated runtime
import { engine, migrate } from "../../scripts/runtime-lib.mjs";
// @ts-ignore worker build
import { workerBuild } from "../../scripts/build.mjs";
import {
  captureESPN,
  automationTick,
} from "../../apps/api/src/services/automation";
import {
  importWorkspace,
  workspaceSchedule,
} from "../../apps/api/src/services/workspace";
import { calendarDay } from "../../packages/display";
import { rows, stmt } from "../../apps/api/src/repositories/db";

test("live priority refresh reuses provider day, preserves unknown scores, and alternates with fixture discovery", async () => {
  await workerBuild();
  const cfg = {
    installationId: crypto.randomUUID(),
    mode: "LOCAL_RESEARCH",
    bootstrap: "test",
    serviceToken: "test",
    webOrigin: "http://127.0.0.1:5293",
    appCodeSha: "CONTRACT_TEST_ONLY",
  };
  const mf = engine(cfg, ".runtime-v2/live-refresh-test", {
    port: 0,
    persist: false,
  });
  try {
    const db = await mf.getD1Database("DB"),
      now = Date.now(),
      c = { db, installationId: cfg.installationId, now };
    await migrate(db, cfg);
    await importWorkspace(c, {
      sourceHash: "a".repeat(64),
      sourceCutoffAt: now,
      metadata: { leagues: [{ code: "fifa.friendly", name: "测试专用" }] },
      study: { models: [] },
    });
    const day = calendarDay(now);
    const event: any = {
      id: "987654",
      date: new Date(now - 30 * 60000).toISOString(),
      competitions: [
        {
          status: {
            type: { state: "in", name: "STATUS_IN_PROGRESS" },
            period: 1,
            displayClock: "29:14",
          },
          competitors: [
            {
              homeAway: "home",
              score: "0",
              team: { id: "1", displayName: "TEST ONLY Home" },
            },
            {
              homeAway: "away",
              score: null,
              team: { id: "2", displayName: "TEST ONLY Away" },
            },
          ],
        },
      ],
    };
    await captureESPN(c, "fifa.friendly", day, async () =>
      Response.json({ events: [event] }),
    );
    const initialProgress = JSON.parse(
      (await rows(db, "SELECT dataJson FROM fixture_catalog"))[0].dataJson,
    ).progressObservedAt;
    await captureESPN(c, "fifa.friendly", day, async () =>
      Response.json({ events: [event] }),
    );
    assert.equal(
      JSON.parse(
        (await rows(db, "SELECT dataJson FROM fixture_catalog"))[0].dataJson,
      ).progressObservedAt,
      initialProgress,
      "Repeated reads of an unchanged source clock must not give its progress a new timestamp",
    );
    await stmt(
      db,
      "UPDATE fixture_catalog SET lastCapturedAt=?",
      now - 120000,
    ).run();
    await stmt(
      db,
      "UPDATE source_runs SET startedAt=?,finishedAt=?",
      now - 120000,
      now - 120000,
    ).run();
    await stmt(
      db,
      "INSERT INTO source_runs VALUES('openliga-test','OPENLIGADB_V1','bl1',2026,'test',?,?,'EMPTY',NULL,NULL,0,?)",
      now,
      now,
      now + 3600000,
    ).run();
    await stmt(
      db,
      "INSERT INTO automation_state VALUES('LOCAL_PIPELINE',1,0,NULL,NULL,?,'IDLE',NULL)",
      now,
    ).run();
    const urls: string[] = [];
    const live: any = await automationTick(
      c,
      "LOCAL_RESEARCH",
      true,
      async (url: any) => {
        urls.push(String(url));
        return Response.json({ events: [event] });
      },
    );
    assert.equal(live.capture.priority, "LIVE");
    assert.equal(urls.length, 1);
    assert.equal(
      new URL(urls[0]).searchParams.get("dates"),
      day.replaceAll("-", ""),
    );
    const schedule = await workspaceSchedule(
      { ...c, now: Date.now() },
      new URLSearchParams("view=LIVE"),
    );
    assert.equal(schedule.total, 1);
    assert.deepEqual(schedule.items[0].scoreboard.score, [0, null]);
    assert.equal(schedule.items[0].scoreboard.clock, "29:14");
    assert.equal(schedule.items[0].scoreboard.stale, false);
    assert.equal((await rows(db, "SELECT * FROM jobs")).length, 0);
    assert.equal(
      (await rows(db, "SELECT * FROM result_observations")).length,
      0,
    );
    // Force another due live observation: discovery must still get its turn.
    await stmt(
      db,
      "UPDATE fixture_catalog SET lastCapturedAt=?",
      now - 120000,
    ).run();
    await stmt(
      db,
      "UPDATE source_runs SET startedAt=?,finishedAt=? WHERE providerId='ESPN_PUBLIC_V1'",
      now - 120000,
      now - 120000,
    ).run();
    const rotation: any = await automationTick(
      c,
      "LOCAL_RESEARCH",
      true,
      async () => Response.json({ events: [] }),
    );
    assert.ok(
      ["ROTATION_BATCH", "WIDE_MODEL_DISCOVERY"].includes(
        rotation.capture.state,
      ),
      "Live refresh alternates with discovery including national competitions beyond seven days",
    );
    assert.equal(
      (await rows(db, "SELECT cursor FROM automation_state"))[0].cursor,
      rotation.capture.state === "WIDE_MODEL_DISCOVERY" ? 0 : 1,
    );
    await assert.rejects(
      workspaceSchedule(c, new URLSearchParams("view=TYPO")),
      /INVALID_SCHEDULE_VIEW/,
    );
  } finally {
    await mf.dispose();
  }
});
