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
import { importWorkspace } from "../../apps/api/src/services/workspace";
import { calendarDay } from "../../packages/display";
import { rows, stmt } from "../../apps/api/src/repositories/db";
test("normal rotation covers consecutive leagues, advances across dates and isolates a failed provider", async () => {
  await workerBuild();
  const cfg = {
      installationId: crypto.randomUUID(),
      mode: "LOCAL_RESEARCH",
      bootstrap: "test",
      serviceToken: "test",
      webOrigin: "http://127.0.0.1:5293",
      appCodeSha: "rotation-test",
    },
    mf = engine(cfg, ".runtime-v2/rotation-test", { port: 0, persist: false });
  try {
    const db = await mf.getD1Database("DB"),
      now = Date.now(),
      c = { db, installationId: cfg.installationId, now },
      day = calendarDay(now),
      codes = ["eng.1", "ger.1", "fra.1", "ita.1", "esp.1"];
    await migrate(db, cfg);
    await importWorkspace(c, {
      sourceHash: "a".repeat(64),
      sourceCutoffAt: now,
      metadata: { leagues: codes.map((code) => ({ code, name: code })) },
      study: { models: [] },
    });
    for (const code of codes)
      await captureESPN(c, code, day, async () =>
        Response.json({ events: [] }),
      );
    await stmt(
      db,
      "INSERT INTO source_runs VALUES('openliga-tested','OPENLIGADB_V1','bl1',2026,'test',?,?,'EMPTY',NULL,NULL,0,?)",
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
    const fetcher: any = async (url: string) => {
      urls.push(url);
      if (url.includes("ger.1")) throw Error("ONE_PROVIDER_FAILED");
      return Response.json({ events: [] });
    };
    const wide: any = await automationTick(c, "LOCAL_RESEARCH", true, fetcher);
    assert.equal(wide.capture.state, "WIDE_MODEL_DISCOVERY");
    assert.equal(urls.length, 4);
    assert.equal(
      (await rows(db, "SELECT cursor FROM automation_state"))[0].cursor,
      0,
    );
    assert(
      urls.every(
        (url) =>
          new URL(url).searchParams.get("dates")! > day.replaceAll("-", ""),
      ),
    );
    urls.length = 0;
    const first: any = await automationTick(
      { ...c, now: now + 1000 },
      "LOCAL_RESEARCH",
      true,
      fetcher,
    );
    assert.equal(first.capture.state, "ROTATION_BATCH");
    assert.equal(urls.length, 4);
    assert(
      codes
        .slice(0, 4)
        .every((code) => urls.some((url) => url.includes("/" + code + "/"))),
    );
    assert.equal(
      first.capture.results.filter((r: any) => r.state === "FAILED").length,
      1,
    );
    assert.equal(
      (await rows(db, "SELECT cursor FROM automation_state"))[0].cursor,
      4,
    );
    urls.length = 0;
    const secondWide: any = await automationTick(
      { ...c, now: now + 2000 },
      "LOCAL_RESEARCH",
      true,
      fetcher,
    );
    assert.equal(secondWide.capture.state, "WIDE_MODEL_DISCOVERY");
    assert.equal(
      (await rows(db, "SELECT cursor FROM automation_state"))[0].cursor,
      4,
    );
    urls.length = 0;
    await automationTick(
      { ...c, now: now + 3000 },
      "LOCAL_RESEARCH",
      true,
      fetcher,
    );
    assert.equal(urls.length, 4);
    assert(urls.some((url) => url.includes("/esp.1/")));
    assert(urls.some((url) => url.includes("/eng.1/")));
    assert.notEqual(
      new URL(urls.find((url) => url.includes("/esp.1/"))!).searchParams.get(
        "dates",
      ),
      new URL(urls.find((url) => url.includes("/eng.1/"))!).searchParams.get(
        "dates",
      ),
    );
    assert.equal(
      (await rows(db, "SELECT cursor FROM automation_state"))[0].cursor,
      8,
    );
    const tomorrowUTC =
      new Date(calendarDay(now) + "T00:30:00Z").getTime() + 86400000;
    const event = {
      id: "555555",
      date: new Date(tomorrowUTC).toISOString(),
      competitions: [
        {
          status: { type: { state: "pre", name: "STATUS_SCHEDULED" } },
          competitors: [
            { homeAway: "home", team: { id: "1", displayName: "Home" } },
            { homeAway: "away", team: { id: "2", displayName: "Away" } },
          ],
          odds: [null],
        },
      ],
    };
    await captureESPN(c, "eng.1", day, async () =>
      Response.json({ events: [event] }),
    );
    urls.length = 0;
    const urgent: any = await automationTick(
      { ...c, now: now + 301000 },
      "LOCAL_RESEARCH",
      true,
      async (url: any) => {
        urls.push(String(url));
        return Response.json({ events: [] });
      },
    );
    assert.equal(urgent.capture.priority, "URGENT");
    assert.equal(
      new URL(urls[0]).searchParams.get("dates"),
      day.replaceAll("-", ""),
    );
    assert.equal(
      (await rows(db, "SELECT cursor FROM automation_state"))[0].cursor,
      8,
    );
  } finally {
    await mf.dispose();
  }
});
