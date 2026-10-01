import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeRecords,
  rangeStart,
  rowMatches,
  fixtureStatus,
  fixtureScore,
} from "../../apps/api/src/services/workspace";
import { normalizeESPN, espnUrl } from "../../apps/api/src/services/automation";
import { normalizeJFA } from "../../apps/api/src/services/official";
const row = (id: string, pnl: string | null, extra: any = {}) => ({
  id,
  stakeAtoms: "1000000",
  pnlAtoms: pnl,
  status: "SETTLED",
  at: Date.parse("2026-10-01T10:00:00+08:00"),
  settledAt: Date.parse("2026-10-01T10:00:00+08:00"),
  currency: "PAPER",
  odds: 2,
  leagues: ["ger.1"],
  models: ["fixed"],
  markets: ["1X2"],
  strategy: "one",
  score: null,
  ...extra,
});
test("functional ledger uses settled denominator, preserves missing amounts and measures net-return drawdown", () => {
  const s = summarizeRecords([
    row("1", "1000000"),
    row("2", "-1000000"),
    row("3", null, { status: "OPEN" }),
  ]);
  assert.equal(s.stakeAtoms, "3000000");
  assert.equal(s.settledStakeAtoms, "2000000");
  assert.equal(s.roi, 0);
  assert.equal(s.maxDrawdownAtoms, "1000000");
  assert.equal(s.open, 1);
  assert.equal(s.settled, 2);
  assert.equal(summarizeRecords([row("1", null)]).roi, null);
  assert.equal(summarizeRecords([row("1", null)]).maxDrawdownAtoms, null);
  assert.equal(summarizeRecords([]).roi, null);
  assert.equal(
    summarizeRecords([row("x", null, { stakeAtoms: null, status: "UNKNOWN" })])
      .profitAtoms,
    null,
  );
  assert.equal(
    summarizeRecords([row("x", null, { stakeAtoms: null, status: "UNKNOWN" })])
      .stakeAtoms,
    null,
  );
  assert.equal(
    summarizeRecords([row("x", null, { status: "UNKNOWN" })]).settled,
    0,
  );
  assert.throws(() => espnUrl("eng.1", "2026-02-30"), /INVALID_CALENDAR_DATE/);
});
test("mixed currencies disable aggregate money; reopened tickets remain open", () => {
  const s = summarizeRecords([
    row("1", "1000000"),
    row("2", "-1000000", { currency: "CNY" }),
  ]);
  assert.equal(s.roi, null);
  assert.equal(s.profitAtoms, null);
  assert.equal(s.currencyMixed, true);
  assert.equal(
    summarizeRecords([row("1", null, { status: "REOPENED" })]).open,
    1,
  );
});
test("date and multidimensional filters keep unknown score distinct and use displayed Berlin calendar", () => {
  const now = Date.parse("2026-10-01T12:00:00+08:00");
  assert.equal(
    rowMatches(
      row("unknown-date", null, { at: null }),
      new URLSearchParams("period=ALL"),
      now,
    ),
    true,
  );
  assert.equal(
    rowMatches(
      row("unknown-date", null, { at: null }),
      new URLSearchParams("period=TODAY"),
      now,
    ),
    false,
  );
  assert.equal(
    new Date(rangeStart("MONTH", now)).toISOString(),
    "2026-09-30T22:00:00.000Z",
  );
  assert.equal(
    new Date(rangeStart("SEASON", now)).toISOString(),
    "2026-06-30T22:00:00.000Z",
  );
  assert.equal(
    rowMatches(
      row("1", "0"),
      new URLSearchParams("league=ger.1&model=fixed&market=1X2&odds=MID"),
      now,
    ),
    true,
  );
  assert.equal(
    rowMatches(row("1", "0"), new URLSearchParams("score=LOW"), now),
    false,
  );
});
test("all fixture states include rejected, stale, failed and post-match without synthesizing predictions", () => {
  const now = 10000,
    f = {
      status: "SCHEDULED",
      kickoffAt: 20000,
      predictionCount: 0,
      accepted: 0,
      failedJobs: 0,
      quoteAt: null,
    };
  assert.equal(fixtureStatus(f, now).state, "MISSING_DATA");
  assert.equal(fixtureStatus({ ...f, quoteAt: 9000 }, now).state, "OBSERVING");
  assert.equal(
    fixtureStatus({ ...f, predictionCount: 1 }, now).state,
    "OBSERVING",
  );
  assert.equal(fixtureStatus({ ...f, accepted: 1 }, now).state, "CANDIDATE");
  assert.equal(fixtureStatus({ ...f, quoteAt: 1 }, 900000).state, "STARTED");
  assert.equal(
    fixtureStatus({ ...f, kickoffAt: 2000000, quoteAt: 1 }, 900000).state,
    "STALE_QUOTE",
  );
  assert.equal(
    fixtureStatus({ ...f, failedJobs: 1 }, now).state,
    "MODEL_FAILED",
  );
  assert.equal(
    fixtureStatus({ ...f, status: "FINISHED" }, now).state,
    "FINISHED",
  );
});
test("ESPN regulation results reject AET, halftime and missing scores without zero imputation", () => {
  const data = (name: string, home: any, away: any) => ({
    events: [
      {
        id: "12345",
        date: "2026-10-01T10:00:00Z",
        competitions: [
          {
            status: { type: { state: "post", name } },
            competitors: [
              {
                homeAway: "home",
                score: home,
                team: { id: "1", displayName: "Home" },
              },
              {
                homeAway: "away",
                score: away,
                team: { id: "2", displayName: "Away" },
              },
            ],
          },
        ],
      },
    ],
  });
  assert.deepEqual(
    normalizeESPN(data("STATUS_FULL_TIME", "0", "0"), "eng.1", "2026-10-01")[0]
      .regulation,
    [0, 0],
  );
  for (const name of [
    "STATUS_HALFTIME",
    "STATUS_FINAL",
    "STATUS_FINAL_AET",
    "STATUS_FINAL_ET",
    "STATUS_FULL_TIME_EXTRA",
    "STATUS_FINAL_AFTER_EXTRA_TIME",
    "STATUS_FINAL_PENALTIES",
  ])
    assert.equal(
      normalizeESPN(data(name, "1", "0"), "eng.1", "2026-10-01")[0].regulation,
      null,
    );
  assert.equal(
    normalizeESPN(data("STATUS_FULL_TIME", null, "0"), "eng.1", "2026-10-01")[0]
      .regulation,
    null,
  );
  assert.throws(() => espnUrl("../evil", "2026-10-01"));
});

test("official cup announcement supplies fixtures without fabricating score or price", () => {
  const html = `天皇杯 第106回 emperorscup_2026 <table><tr><td>【57】</td><td>9月23日</td><td>19:00</td><td>Home vs Away</td><td>Stadium</td></tr><tr><td>【58】</td><td>2月30日</td><td>19:00</td><td>X vs Y</td><td>Z</td></tr></table>`;
  const rows = normalizeJFA(html);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].regulation, null);
  assert.deepEqual(rows[0].providerOdds, []);
  assert.equal(rows[0].status, "SCHEDULED");
  assert.throws(
    () => normalizeJFA(html.replaceAll("2026", "2025")),
    /SOURCE_SEASON_MISMATCH/,
  );
});

test("live source scores and minutes are observations; scheduled, missing and AET never become regulation results", () => {
  const event: any = {
    id: "123456",
    date: "2026-10-01T18:00:00Z",
    competitions: [
      {
        status: {
          type: { state: "in", name: "STATUS_IN_PROGRESS" },
          displayClock: "63:18",
          period: 2,
        },
        competitors: [
          {
            homeAway: "home",
            score: "0",
            team: { id: "1", displayName: "Home" },
          },
          {
            homeAway: "away",
            score: null,
            team: { id: "2", displayName: "Away" },
          },
        ],
      },
    ],
  };
  const live = normalizeESPN({ events: [event] }, "eng.1", "2026-10-01")[0];
  assert.equal(live.status, "LIVE");
  assert.deepEqual(live.score, [0, null]);
  assert.equal(live.clock, "63:18");
  assert.equal(live.regulation, null);
  event.competitions[0].status.type = {
    state: "pre",
    name: "STATUS_SCHEDULED",
  };
  const pre = normalizeESPN({ events: [event] }, "eng.1", "2026-10-01")[0];
  assert.equal(pre.score, null);
  assert.equal(pre.clock, null);
  event.competitions[0].status.type = {
    state: "post",
    name: "STATUS_FINAL_AET",
  };
  event.competitions[0].competitors[1].score = "1";
  const aet = normalizeESPN({ events: [event] }, "eng.1", "2026-10-01")[0];
  assert.deepEqual(aet.score, [0, 1]);
  assert.equal(aet.regulation, null);
});

test("kickoff does not prove a live status; stale live and halftime remain visible with honest labels", () => {
  const now = Date.parse("2026-10-01T20:00:00Z");
  const f = { status: "SCHEDULED", kickoffAt: now - 60000 };
  assert.equal(fixtureStatus(f, now).label, "开赛待确认");
  assert.equal(
    fixtureStatus({ ...f, kickoffAt: now - 7 * 3600000 }, now).label,
    "赛果待确认",
  );
  assert.equal(
    fixtureStatus({ ...f, status: "LIVE", lastCapturedAt: now - 1000 }, now)
      .label,
    "进行中",
  );
  assert.equal(
    fixtureStatus({ ...f, status: "LIVE", lastCapturedAt: now - 181000 }, now)
      .label,
    "直播待更新",
  );
  assert.equal(
    fixtureStatus(
      {
        ...f,
        status: "LIVE",
        lastCapturedAt: now - 1000,
        providerStatus: { type: { name: "STATUS_HALFTIME" } },
      },
      now,
    ).label,
    "中场",
  );
});

test("score projections distinguish source observation, accepted regulation and review without filling missing sides", () => {
  const now = Date.now();
  const base = {
    status: "LIVE",
    lastCapturedAt: now - 200000,
    publicData: {
      score: [0, null],
      clock: "45:00",
      scoreObservedAt: now - 200000,
    },
  };
  const live = fixtureScore(base, now);
  assert.deepEqual(live.score, [0, null]);
  assert.equal(live.stale, true);
  assert.equal(live.kind, "LIVE_OBSERVATION");
  const accepted = fixtureScore(
    {
      ...base,
      status: "FINISHED",
      resultState: "ACCEPTED_REGULATION",
      regulationJson: '{"home":2,"away":1}',
    },
    now,
  );
  assert.deepEqual(accepted.score, [2, 1]);
  assert.equal(accepted.clock, null);
  assert.equal(accepted.kind, "ACCEPTED_REGULATION");
  const review = fixtureScore(
    { ...base, status: "FINISHED", resultState: "REVIEW" },
    now,
  );
  assert.equal(review.label, "赛果待复核");
  assert.equal(review.kind, "REVIEW");
  assert.equal(
    fixtureScore({ status: "SCHEDULED", publicData: {} }, now).score,
    null,
  );
});

test("a fresh fetch cannot renew a stalled source clock; normal halftime gets its own observation tolerance", () => {
  const now = Date.now();
  const live = {
    status: "LIVE",
    kickoffAt: now - 3600000,
    lastCapturedAt: now,
    publicData: {
      score: [0, 1],
      clock: "63:00",
      progressObservedAt: now - 181000,
    },
  };
  assert.equal(fixtureScore(live, now).stalled, true);
  assert.equal(fixtureScore(live, now).stale, true);
  assert.equal(fixtureStatus(live, now).label, "直播待更新");
  const halftime = {
    ...live,
    publicData: {
      ...live.publicData,
      clock: "45:00",
      progressObservedAt: now - 15 * 60000,
      providerStatus: { type: { name: "STATUS_HALFTIME" } },
    },
  };
  assert.equal(fixtureScore(halftime, now).stalled, false);
  assert.equal(
    fixtureScore(
      {
        ...halftime,
        publicData: {
          ...halftime.publicData,
          progressObservedAt: now - 26 * 60000,
        },
      },
      now,
    ).stalled,
    true,
  );
});
