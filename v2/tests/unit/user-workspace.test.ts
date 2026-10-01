import test from "node:test";
import assert from "node:assert/strict";
import { teamName, calendarDay } from "../../packages/display";
import {
  decimalAmerican,
  publicMarkets,
  recentGames,
} from "../../apps/api/src/services/public-research";
import { normalizeESPN } from "../../apps/api/src/services/automation";
import { fixtureStatus } from "../../apps/api/src/services/workspace";
import {
  summarizeRecords,
  rowMatches,
} from "../../apps/api/src/services/workspace";
import {
  counterfactualTicket,
  reviewLedger,
} from "../../apps/api/src/services/ledger-review";
import {
  studyMetrics,
  referenceOdds,
} from "../../apps/api/src/services/study-metrics";
test("Chinese exact identities cover current national and club aliases without merging United/City", () => {
  assert.equal(teamName("Maldives"), "马尔代夫");
  assert.equal(teamName("Lebanon"), "黎巴嫩");
  assert.equal(
    teamName("Austria Vienna", "uefa.wchampions"),
    "奥地利维也纳女足",
  );
  assert.notEqual(teamName("Manchester United"), teamName("Manchester City"));
});
test("display dates and times share Berlin including midnight and DST", () => {
  assert.equal(calendarDay("2026-10-01T16:00:00Z"), "2026-10-01");
  assert.equal(calendarDay("2026-10-01T22:30:00Z"), "2026-10-02");
  assert.equal(calendarDay("2026-10-25T23:30:00Z"), "2026-10-26");
});
test("actual provider null-odds shape is harmless and complete quotes keep draw and signed spread", () => {
  assert.deepEqual(publicMarkets([null]), []);
  assert.equal(decimalAmerican(-200), "1.5");
  assert.equal(decimalAmerican(300), "4");
  assert.equal(decimalAmerican(null), null);
  const q = publicMarkets([
    null,
    {
      provider: { name: "Public" },
      moneyline: {
        home: { close: { odds: "-200" } },
        draw: { close: { odds: "+300" } },
        away: { close: { odds: "+500" } },
      },
      pointSpread: {
        home: { close: { line: "-1.5", odds: "+105" } },
        away: { close: { line: "+1.5", odds: "-145" } },
      },
    },
  ])[0];
  assert.equal(q.prices[1], "4");
  assert.ok(Math.abs(q.probabilities!.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.equal(q.asian.home.line, "-1.5");
  assert.equal(q.asian.away.line, "+1.5");
});
test("recent histories exclude future, missing scores and shootouts, preserve genuine zero and sort", () => {
  const event = {
    id: "111",
    gameDate: "2026-09-28T10:30Z",
    homeTeamId: "1",
    homeTeamScore: "0",
    awayTeamScore: "2",
    opponent: { displayName: "Opponent" },
  };
  const r = recentGames(
    {
      lastFiveGames: [
        {
          team: { id: "1" },
          events: [
            event,
            { ...event, id: "112", gameDate: "2026-10-02T10:30Z" },
            { ...event, id: "113", homeTeamScore: null },
            { ...event, id: "114", homeShootoutScore: "3" },
          ],
        },
      ],
    },
    "1",
    Date.parse("2026-10-01T04:00:00Z"),
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].gf, 0);
  assert.equal(r[0].ga, 2);
  assert.equal(r[0].at, "2026-09-28T10:30:00.000Z");
});
test("postponed fixtures never become started from the clock and recovered jobs no longer read as failed", () => {
  assert.equal(
    fixtureStatus({ status: "POSTPONED", kickoffAt: 1 }, 10).state,
    "POSTPONED",
  );
  assert.equal(
    fixtureStatus(
      {
        status: "SCHEDULED",
        kickoffAt: 100,
        failedJobs: 0,
        predictionCount: 1,
        quoteAt: 9,
      },
      10,
    ).state,
    "OBSERVING",
  );
  const payload = {
    events: [
      {
        id: "12345",
        date: "2026-10-01T16:00Z",
        competitions: [
          {
            status: { type: { state: "pre", name: "STATUS_POSTPONED" } },
            odds: [null],
            competitors: [
              { homeAway: "home", team: { id: "1", displayName: "Maldives" } },
              { homeAway: "away", team: { id: "2", displayName: "Lebanon" } },
            ],
          },
        ],
      },
    ],
  };
  const n = normalizeESPN(payload, "fifa.friendly", "2026-10-01")[0];
  assert.equal(n.status, "POSTPONED");
  assert.deepEqual(n.providerOdds, []);
  assert.equal(n.regulation, null);
});
test("current job failure remains a failure even when an earlier snapshot succeeded", () => {
  assert.equal(
    fixtureStatus(
      {
        status: "SCHEDULED",
        kickoffAt: 100,
        failedJobs: 1,
        predictionCount: 1,
        quoteAt: 9,
      },
      10,
    ).state,
    "MODEL_FAILED",
  );
});
const ticket = (id: string, status: string, pnl: string, extra: any = {}) => ({
  id,
  status,
  pnlAtoms: pnl,
  stakeAtoms: "20000000",
  mode: "LEGACY_IMPORT",
  currency: "PAPER",
  at: Date.parse("2026-09-30T16:00:00Z"),
  settledAt: Date.parse("2026-10-01T03:00:00Z"),
  strategy: "one",
  leagues: ["eng.1"],
  markets: ["1x2"],
  models: ["v6"],
  score: null,
  raw: { legs: [] },
  ...extra,
});
test("legacy void stakes never dilute ROI and void-only has no action ROI", () => {
  const s = summarizeRecords([
    ticket("win", "WIN", "10000000"),
    ticket("void", "VOID", "0"),
  ]);
  assert.equal(s.stakeAtoms, "40000000");
  assert.equal(s.settledStakeAtoms, "20000000");
  assert.equal(s.roi, 0.5);
  assert.equal(summarizeRecords([ticket("void", "VOID", "0")]).roi, null);
  for (const status of ["OPEN", "REVIEW", "REOPENED", "PENDING", "UNSETTLED"]) {
    assert.equal(
      rowMatches(
        ticket("open", status, "0"),
        new URLSearchParams("status=OPEN"),
        Date.now(),
      ),
      true,
    );
  }
  assert.equal(
    rowMatches(
      ticket("closed", "WIN", "0"),
      new URLSearchParams("status=OPEN"),
      Date.now(),
    ),
    false,
  );
});
test("ten-strategy daily review keeps missing strategies and combined attribution without duplicates", () => {
  const r = reviewLedger(
    [ticket("one", "WIN", "10000000", { models: ["v6", "v7"] })],
    Date.parse("2026-10-02T03:00:00Z"),
    [
      { id: "one", name: "原策略一" },
      { id: "two", name: "原策略二" },
    ],
  );
  assert.equal(r.strategies.length, 2);
  assert.equal(r.strategies[1].roi, null);
  assert.equal(r.daily.length, 1);
  assert.equal(r.daily[0].day, "2026-10-01");
  assert.equal(r.models.length, 1);
  assert.equal(r.models[0].profitAtoms, "10000000");
  assert.equal(r.yesterday.count, 1);
});
test("saved alternative counterfactual recomputes entire multi-leg return, never guesses a missing side or quote", () => {
  const raw = {
    stake: 10,
    legs: [
      { market: "1x2", pick: 0, odds: 2, status: "win", finalScore: "2-0" },
      { market: "1x2", pick: 0, odds: 2, status: "loss", finalScore: "0-1" },
    ],
  };
  assert.equal(
    counterfactualTicket(raw, 1, { market: "1x2", pick: 2, odds: 2.5 }),
    40,
  );
  assert.equal(
    counterfactualTicket(raw, 1, { market: "spread", line: 0, odds: 2 }),
    null,
  );
  assert.equal(counterfactualTicket(raw, 1, { market: "1x2", pick: 2 }), null);
  assert.equal(
    counterfactualTicket({ ...raw, stake: NaN }, 1, {
      market: "1x2",
      pick: 2,
      odds: 2.5,
    }),
    null,
  );
  assert.equal(raw.legs[1].pick, 0);
});
test("common comparison odds are market-favourite odds and probabilities score the same no-action cohort", () => {
  const row = {
    fixtureId: "x",
    date: "2026-09-01",
    marketOdds: [2, 3.5, 4],
    central: [0.5, 0.3, 0.2],
    outcome: 0,
    action: "NO_ACTION",
    odds: null,
    pnl: null,
  };
  assert.equal(referenceOdds(row), 2);
  const m = studyMetrics([row], 2);
  assert.equal(m.eligibleN, 1);
  assert.equal(m.probabilityN, 1);
  assert.equal(m.coverage, 0.5);
  assert.equal(m.actionRate, 0);
  assert.equal(m.roi, null);
  assert.ok(Math.abs(m.logLoss! - Math.log(2)) < 1e-12);
});
