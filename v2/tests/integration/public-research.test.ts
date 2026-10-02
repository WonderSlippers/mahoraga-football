import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
// @ts-ignore shared isolated runtime
import { engine, migrate } from "../../scripts/runtime-lib.mjs";
// @ts-ignore shared worker build
import { workerBuild } from "../../scripts/build.mjs";
import {
  captureESPN,
  automationTick,
  autoSettle,
} from "../../apps/api/src/services/automation";
import { claim, complete } from "../../apps/api/src/services/observations";
import { completeUniversal } from "../../apps/api/src/services/universal";
import {
  completeComparison,
  comparisonReport,
} from "../../apps/api/src/services/comparison";
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
          odds: [null],
        },
      ],
    };
    const summary = {
      pickcenter: [odds],
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
    let summaryFetches = 0;
    const fetcher: any = async (url: any) => {
      if (String(url).includes("summary?")) summaryFetches++;
      return Response.json(
        String(url).includes("summary?") ? summary : { events: [event] },
      );
    };
    await captureESPN(c, "fifa.friendly", day, fetcher);
    assert.equal((await rows(db, "SELECT * FROM quote_sets")).length, 1);
    assert.equal((await rows(db, "SELECT * FROM quote_selections")).length, 3);
    assert.equal((await rows(db, "SELECT * FROM jobs")).length, 5);
    assert.equal((await rows(db, "SELECT * FROM source_snapshots")).length, 2);
    const savedQuote = (await rows(db, "SELECT * FROM quote_sets"))[0];
    const priceEvidence = (
      await rows(
        db,
        "SELECT * FROM source_snapshots WHERE id=?",
        savedQuote.sourceSnapshotId,
      )
    )[0];
    assert.ok(priceEvidence.resourceKey.includes("/summary?"));
    assert.equal(savedQuote.observedAt, priceEvidence.observedAt);
    for (let i = 0; i < 5; i++) {
      const job = await claim({ ...c, now: Date.now() }, "python-test");
      assert.ok(job);
      const p = spawnSync(
        path.resolve(".venv/Scripts/python.exe"),
        [
          "-c",
          "import json,sys;sys.stdin.reconfigure(encoding='utf-8');from runner import predict,validate;from comparison_models import predict_comparison,IDS;from universal_model_v2 import predict_universal,MODEL_ID;j=json.load(sys.stdin);print(json.dumps(predict_universal(j,validate(json.loads(j['canonical']))) if j['modelId']==MODEL_ID else predict_comparison(j,validate(json.loads(j['canonical']))) if j['modelId'] in IDS else predict(j)))",
        ],
        {
          cwd: path.resolve("model-runner"),
          input: JSON.stringify(job),
          encoding: "utf8",
          windowsHide: true,
        },
      );
      assert.equal(p.status, 0, p.stderr);
      const comparison =
        job.modelId.startsWith("V6_C388_FROZEN") ||
        job.modelId.startsWith("LEGACY_20260920") ||
        job.modelId === "GENERAL_FOOTBALL_RESEARCH_V2";
      const result = await (
        job.modelId === "GENERAL_FOOTBALL_RESEARCH_V2"
          ? completeUniversal
          : comparison
            ? completeComparison
            : complete
      )({ ...c, now: Date.now() }, job.id, {
        owner: "python-test",
        fencingToken: job.fencingToken,
        bundleHash: job.bundleHash,
        modelHash: job.modelHash,
        central: JSON.parse(p.stdout),
        ...(comparison ? { output: JSON.parse(p.stdout) } : {}),
        featureCanonical: job.canonical,
      });
      assert.equal(
        result.state,
        job.modelId.startsWith("V6") ? "BLOCKED" : "DONE",
      );
    }
    const detail = await workspaceFixture(
      { ...c, now: Date.now() },
      "espn:fifa.friendly:123456",
    );
    assert.equal(detail.predictions.length, 3);
    const compared = await comparisonReport({ ...c, now: Date.now() });
    assert.equal(compared.totalRecords, 2);
    assert.equal(compared.commonFixtureN, 0);
    assert.equal(
      compared.methods.find((m) => m.id.startsWith("LEGACY"))!.metrics[0].all
        .openN,
      1,
    );
    assert.equal(compared.methods[0].metrics[0].all.roi, null);
    const active = await workspaceSchedule(
      { ...c, now: Date.now() },
      new URLSearchParams("upcoming=1"),
    );
    assert.equal(
      active.items[0].failedJobs,
      0,
      "Unsupported shadow jobs must not poison a valid schedule",
    );
    assert.notEqual(active.items[0].state, "MODEL_FAILED");
    await stmt(
      db,
      "UPDATE jobs SET state='FAILED' WHERE modelId='RECENT_FORM_MARKET80_RESEARCH_V1'",
    ).run();
    const failedPrimary = await workspaceSchedule(
      { ...c, now: Date.now() },
      new URLSearchParams("view=ACTIVE"),
    );
    assert.notEqual(
      failedPrimary.items[0].state,
      "MODEL_FAILED",
      "Demoted market80 cannot poison the general model",
    );
    await stmt(
      db,
      "UPDATE jobs SET state='FAILED' WHERE modelId='GENERAL_FOOTBALL_RESEARCH_V2'",
    ).run();
    const failedGeneral = await workspaceSchedule(
      { ...c, now: Date.now() },
      new URLSearchParams("view=ACTIVE"),
    );
    assert.equal(failedGeneral.items[0].state, "MODEL_FAILED");
    await stmt(
      db,
      "UPDATE jobs SET state='DONE' WHERE modelId='RECENT_FORM_MARKET80_RESEARCH_V1'",
    ).run();
    await stmt(
      db,
      "UPDATE jobs SET state='DONE' WHERE modelId='GENERAL_FOOTBALL_RESEARCH_V2'",
    ).run();
    const recoveredPrimary = await workspaceSchedule(
      { ...c, now: Date.now() },
      new URLSearchParams("view=ACTIVE"),
    );
    assert.equal(recoveredPrimary.items[0].failedJobs, 0);
    assert.equal(active.items[0].dataJson, undefined);
    assert.equal(active.items[0].referenceMarket.raw, undefined);
    await assert.rejects(
      stmt(db, "UPDATE comparison_observations SET outputJson='{}'").run(),
      /IMMUTABLE_FACT/,
    );
    assert.equal(detail.quotes[0].providerUpdatedAt, null);
    assert.equal(detail.models[0].status, "UNSUPPORTED_COMPETITION");
    const hashes = detail.predictions.map((p) => p.predictionHash);
    const originalQuoteAt = detail.quotes[0].observedAt;
    const originalTracking = active.items[0].tracking;
    assert.ok(
      originalTracking,
      "Test research direction is actually selected before kickoff",
    );
    await assert.rejects(
      stmt(
        db,
        "UPDATE predictions SET centralJson='[1,0,0]' WHERE id=?",
        detail.predictions[0].id,
      ).run(),
      /IMMUTABLE_FACT/,
    );
    assert.equal((await rows(db, "SELECT * FROM tickets")).length, 0);
    assert.equal((await rows(db, "SELECT * FROM portfolios")).length, 6);
    const fixtureId = "espn:fifa.friendly:123456";
    const cached = (
      await rows(
        db,
        "SELECT * FROM fixture_catalog WHERE fixtureId=?",
        fixtureId,
      )
    )[0];
    const cachedData = JSON.parse(cached.dataJson);
    const cachedAt = Date.now() - 360000;
    cachedData.detail.observedAt = cachedAt;
    await stmt(
      db,
      "UPDATE fixture_catalog SET dataJson=? WHERE fixtureId=?",
      JSON.stringify(cachedData),
      fixtureId,
    ).run();
    const beforeSummaryFetches = summaryFetches;
    await captureESPN({ ...c, now: Date.now() }, "fifa.friendly", day, fetcher);
    assert.equal(
      summaryFetches,
      beforeSummaryFetches + 1,
      "Quotes carried by summary must refresh before the 10-minute expiry, even while other context is cached",
    );
    const refreshedData = JSON.parse(
      (
        await rows(
          db,
          "SELECT dataJson FROM fixture_catalog WHERE fixtureId=?",
          fixtureId,
        )
      )[0].dataJson,
    );
    assert.ok(refreshedData.detail.observedAt > cachedAt);
    assert.equal((await rows(db, "SELECT * FROM quote_sets")).length, 1);
    await migrate(db, cfg);
    const schedule = await workspaceSchedule(
      { ...c, now: kickoff + 1 },
      new URLSearchParams("upcoming=1"),
    );
    assert.equal(schedule.total, 0);
    const startedClock = { ...c, now: kickoff + 1 };
    const pending = await workspaceSchedule(
      startedClock,
      new URLSearchParams("view=LIVE"),
    );
    assert.equal(pending.total, 1);
    assert.equal(pending.items[0].label, "开赛待确认");
    assert.equal(pending.items[0].scoreboard.score, null);
    assert.equal(
      (
        await workspaceSchedule(
          startedClock,
          new URLSearchParams("status=STARTED&upcoming=1"),
        )
      ).total,
      1,
    );
    const numberJobs = (await rows(db, "SELECT id FROM jobs")).length;
    const liveEvent = structuredClone(event) as any;
    liveEvent.competitions[0].status = {
      type: { state: "in", name: "STATUS_IN_PROGRESS" },
      displayClock: "67:32",
      period: 2,
    };
    liveEvent.competitions[0].competitors[0].score = "2";
    liveEvent.competitions[0].competitors[1].score = "1";
    await captureESPN(startedClock, "fifa.friendly", day, async () =>
      Response.json({ events: [liveEvent] }),
    );
    const live = await workspaceSchedule(
      startedClock,
      new URLSearchParams("view=LIVE"),
    );
    assert.equal(live.total, 1);
    assert.deepEqual(live.items[0].scoreboard.score, [2, 1]);
    assert.equal(live.items[0].scoreboard.clock, "67:32");
    assert.equal(live.items[0].scoreboard.kind, "LIVE_OBSERVATION");
    assert.equal(
      live.items[0].tracking.predictionId,
      originalTracking.predictionId,
    );
    assert.equal(live.items[0].tracking.quoteAt, originalTracking.quoteAt);
    assert.equal(
      live.items[0].tracking.probability,
      originalTracking.probability,
    );
    assert.equal(live.candidateCounts.research, 0);
    assert.equal(
      (await rows(db, "SELECT id FROM jobs")).length,
      numberJobs,
      "Live capture must not create late pre-match predictions",
    );
    const retained = await comparisonReport(startedClock);
    assert.equal(retained.currentDirections.length, 0);
    assert.ok(retained.trackedDirections.length > 0);
    liveEvent.competitions[0].status = {
      type: { state: "post", name: "STATUS_FULL_TIME" },
      period: 2,
    };
    const finalClock = { ...c, now: kickoff + 3 * 3600000 };
    await captureESPN(finalClock, "fifa.friendly", day, async () =>
      Response.json({ events: [liveEvent] }),
    );
    await autoSettle(finalClock);
    const resultCount = (await rows(db, "SELECT id FROM result_observations"))
      .length;
    const adjudicationCount = (
      await rows(db, "SELECT id FROM result_adjudications")
    ).length;
    await captureESPN(finalClock, "fifa.friendly", day, async () =>
      Response.json({ events: [liveEvent] }),
    );
    await autoSettle(finalClock);
    assert.equal(
      (await rows(db, "SELECT id FROM result_observations")).length,
      resultCount,
      "Unchanged same-provider final scores must not create endless new adjudications",
    );
    assert.equal(
      (await rows(db, "SELECT id FROM result_adjudications")).length,
      adjudicationCount,
    );
    const results = await workspaceSchedule(
      finalClock,
      new URLSearchParams("view=RESULTS"),
    );
    assert.equal(results.total, 1);
    assert.equal(
      (await workspaceSchedule(finalClock, new URLSearchParams("view=ACTIVE")))
        .total,
      0,
    );
    const followed = await workspaceSchedule(
      finalClock,
      new URLSearchParams("view=TRACKED"),
    );
    assert.equal(followed.total, 1);
    assert.equal(followed.items[0].scoreboard.kind, "ACCEPTED_REGULATION");
    assert.equal(
      followed.items[0].tracking.predictionId,
      originalTracking.predictionId,
    );
    const finalDetail = await workspaceFixture(
      finalClock,
      "espn:fifa.friendly:123456",
    );
    assert.equal(finalDetail.quotes[0].observedAt, originalQuoteAt);
    assert.equal(finalDetail.scoreboard.label, "90分钟已核验");
    assert.deepEqual(
      finalDetail.predictions.map((p) => p.predictionHash),
      hashes,
    );
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

test("feature-ready refresh advances past a quoteless fixture to a later quoted fixture", async () => {
  await workerBuild();
  const cfg = {
    installationId: crypto.randomUUID(),
    mode: "LOCAL_RESEARCH",
    bootstrap: "test",
    serviceToken: "test",
    webOrigin: "http://127.0.0.1:5293",
    appCodeSha: "QUEUE_CONTRACT_TEST_ONLY",
  };
  const mf = engine(cfg, ".runtime-v2/queue-test", { port: 0, persist: false });
  try {
    const db = await mf.getD1Database("DB");
    await migrate(db, cfg);
    const c = { db, installationId: cfg.installationId, now: Date.now() };
    await importWorkspace(c, {
      sourceHash: "c".repeat(64),
      sourceCutoffAt: c.now,
      metadata: {
        leagues: [
          { code: "eng.1", name: "英超" },
          { code: "fra.1", name: "法甲" },
        ],
      },
      study: { models: [] },
    });
    const make = (id: string, days: number, quoted: boolean) => ({
      id,
      date: new Date(c.now + days * 86400000).toISOString(),
      competitions: [
        {
          competitors: [
            {
              homeAway: "home",
              team: { id: "1", displayName: "Contract Home" },
            },
            {
              homeAway: "away",
              team: { id: "2", displayName: "Contract Away" },
            },
          ],
          status: { type: { state: "pre", name: "STATUS_SCHEDULED" } },
          odds: quoted
            ? [
                {
                  provider: { name: "TEST_REFERENCE_ONLY" },
                  moneyline: {
                    home: { close: { odds: "+100" } },
                    draw: { close: { odds: "+220" } },
                    away: { close: { odds: "+300" } },
                  },
                },
              ]
            : [],
        },
      ],
    });
    const noQuote = make("777777", 3, false),
      quoted = make("777778", 4, true);
    const noDay = noQuote.date.slice(0, 10),
      quotedDay = quoted.date.slice(0, 10);
    const urls: string[] = [];
    const fetcher: any = async (value: any) => {
      const url = String(value);
      urls.push(url);
      if (!url.includes("scoreboard?"))
        throw Error("TEST_ONLY_DETAIL_UNAVAILABLE");
      const day = new URL(url).searchParams.get("dates");
      return Response.json({
        events:
          day === noDay.replaceAll("-", "")
            ? [noQuote]
            : day === quotedDay.replaceAll("-", "")
              ? [quoted]
              : [],
      });
    };
    await captureESPN(c, "eng.1", noDay, fetcher);
    await captureESPN(c, "fra.1", quotedDay, fetcher);
    const failures = await rows(
      db,
      "SELECT snapshotId,reason FROM source_runs WHERE providerId='ESPN_STANDINGS_V1' AND state='FAILED'",
    );
    assert.equal(failures.length, 2);
    assert(
      failures.every(
        (r) =>
          r.snapshotId === null &&
          r.reason.includes("TEST_ONLY_DETAIL_UNAVAILABLE"),
      ),
    );
    for (const id of ["espn:eng.1:777777", "espn:fra.1:777778"]) {
      await stmt(
        db,
        "INSERT INTO comparison_features VALUES(?,?,'{}','[]',?)",
        id,
        "d".repeat(64),
        c.now,
      ).run();
      await stmt(
        db,
        "UPDATE fixture_catalog SET lastCapturedAt=? WHERE fixtureId=?",
        c.now - 60000,
        id,
      ).run();
    }
    urls.length = 0;
    await automationTick(c, "LOCAL_RESEARCH", true, fetcher);
    assert(
      urls.some(
        (url) =>
          url.includes("/fra.1/scoreboard") &&
          new URL(url).searchParams.get("dates") ===
            quotedDay.replaceAll("-", ""),
      ),
    );
    assert(
      !urls.some(
        (url) =>
          url.includes("/eng.1/scoreboard") &&
          new URL(url).searchParams.get("dates") === noDay.replaceAll("-", ""),
      ),
    );
    const latest = await rows(
      db,
      "SELECT canonical FROM input_bundles ORDER BY cutoffAt DESC LIMIT 1",
    );
    assert.equal(
      JSON.parse(latest[0].canonical).comparisonFeatures.featureHash,
      "d".repeat(64),
    );
    assert.equal((await rows(db, "SELECT * FROM tickets")).length, 0);
  } finally {
    await mf.dispose();
  }
});
