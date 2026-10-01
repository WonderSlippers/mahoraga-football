import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeRecords,
  rangeStart,
  rowMatches,
  fixtureStatus,
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
