import { test } from "node:test";
import assert from "node:assert/strict";
import {
  paperLeg,
  legacyTicket,
  ticketOutcome,
  marketLabel,
} from "../../apps/api/src/services/ticket-presentation";
import { rangeStart, rowMatches } from "../../apps/api/src/services/workspace";
const leg = (
  spec: any,
  state = "ACCEPTED_REGULATION",
  score: any = { home: 0, away: 0 },
) =>
  paperLeg({
    marketSpecJson: JSON.stringify(spec),
    frozenOdds: "1.8",
    adjudicationState: state,
    regulationJson: JSON.stringify(score),
    home: "Home",
    away: "Away",
  });
test("quarter-ball review exposes half-loss, half-win, pushes and refunded legs from authoritative adjudication", () => {
  assert.equal(
    leg({ market: "ASIAN_HANDICAP", selection: "HOME", lineQ: -1 }).outcome,
    "HALF_LOSS",
  );
  assert.equal(
    leg({ market: "ASIAN_HANDICAP", selection: "HOME", lineQ: 1 }).outcome,
    "HALF_WIN",
  );
  assert.equal(
    leg({ market: "TOTAL_GOALS", selection: "UNDER", lineQ: 0 }).outcome,
    "PUSH",
  );
  assert.equal(
    leg({ market: "1X2", selection: "HOME", lineQ: null }, "VOID_BY_RULE", null)
      .outcome,
    "VOID",
  );
});
test("missing or conflicted score remains unavailable rather than 0-0 or a computed win", () => {
  for (const state of ["", "REVIEW"]) {
    const r = leg(
      { market: "1X2", selection: "DRAW", lineQ: null },
      state,
      null,
    );
    assert.equal(r.finalScore, null);
    assert.equal(r.returnFactor, null);
    assert.equal(r.outcome, state === "REVIEW" ? "REVIEW" : "OPEN");
  }
});
test("settled ticket result follows server money while incomplete multi-leg ticket remains pending", () => {
  assert.equal(
    ticketOutcome("SETTLED", "-20000000", [
      { outcome: "WIN" },
      { outcome: "LOSS" },
    ]),
    "LOSS",
  );
  assert.equal(
    ticketOutcome("OPEN", null, [{ outcome: "WIN" }, { outcome: "OPEN" }]),
    "OPEN",
  );
  assert.equal(ticketOutcome("REVIEW", null, [{ outcome: "WIN" }]), "REVIEW");
  assert.equal(
    ticketOutcome("SETTLED", "0", [{ outcome: "VOID" }, { outcome: "VOID" }]),
    "VOID",
  );
  assert.equal(ticketOutcome("SETTLED", "0", [{ outcome: "PUSH" }]), "PUSH");
});
test("historical two-leg review preserves selections, prices and original data and does not invent missing score or return", () => {
  const raw = {
    legs: [
      {
        home: "H",
        away: "A",
        pickName: "大 2.5",
        odds: 1.9,
        status: "win",
        finalScore: "2-1",
      },
      { home: "C", away: "D", pick: 2, odds: 2, status: "loss" },
    ],
  };
  const before = JSON.stringify(raw);
  const r = legacyTicket({
    raw,
    status: "loss",
    stakeAtoms: "20000000",
    pnlAtoms: "-20000000",
    strategy: "double",
  });
  assert.equal(r.legCount, 2);
  assert.equal(r.legs[0].selectionLabel, "大 2.5");
  assert.equal(r.legs[1].selectionLabel, "客胜");
  assert.equal(r.legs[1].finalScore, null);
  assert.equal(r.grossAtoms, "0");
  assert.equal(r.outcome, "LOSS");
  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(
    legacyTicket({
      raw: {
        legs: [
          { market: "spread", status: "loss", returnFactor: 0.5, odds: 2 },
          { market: "total", status: "win", returnFactor: 1.4, odds: 1.8 },
          {
            market: "spread",
            status: "void",
            returnFactor: 1,
            odds: 2,
            finalScore: "1–1",
          },
          {
            market: "spread",
            status: "void",
            returnFactor: 1,
            odds: 2,
            finalScore: "作废",
          },
        ],
      },
    }).legs.map((l: any) => l.outcome),
    ["HALF_LOSS", "HALF_WIN", "PUSH", "VOID"],
  );
  assert.equal(
    legacyTicket({ raw, status: "win", stakeAtoms: null, pnlAtoms: null })
      .grossAtoms,
    null,
  );
});
test("selected market labels distinguish home, away, handicap sign and total lines", () => {
  const raw = {
    legs: [
      { market: "spread", side: "home", line: -0.5, pick: -1, odds: 1.9 },
      { market: "spread", side: "away", line: 0.25, pick: -1, odds: 2 },
      { market: "total", side: "under", line: 2.75, pick: -1, odds: 1.8 },
    ],
  };
  const before = JSON.stringify(raw);
  assert.deepEqual(
    legacyTicket({ raw }).legs.map((l: any) => l.selectionLabel),
    ["主队 -0.5", "客队 +0.25", "小 2.75 球"],
  );
  assert.equal(JSON.stringify(raw), before);
  assert.equal(
    marketLabel({ market: "ASIAN_HANDICAP", selection: "AWAY", lineQ: -1 }),
    "客队 -0.25",
  );
  assert.equal(
    marketLabel({ market: "TOTAL_GOALS", selection: "OVER", lineQ: 10 }),
    "大 2.5 球",
  );
  assert.equal(marketLabel({ market: "1X2", selection: "DRAW" }), "平局");
});
test("yesterday is a bounded Berlin calendar day including daylight-saving 23-hour day", () => {
  const now = Date.parse("2026-03-30T08:00:00Z"),
    p = new URLSearchParams("period=YESTERDAY");
  assert.equal(
    rangeStart("YESTERDAY", now),
    Date.parse("2026-03-28T23:00:00Z"),
  );
  assert.equal(
    rowMatches({ at: Date.parse("2026-03-28T22:59:59Z") }, p, now),
    false,
  );
  assert.equal(
    rowMatches({ at: Date.parse("2026-03-28T23:00:00Z") }, p, now),
    true,
  );
  assert.equal(
    rowMatches({ at: Date.parse("2026-03-29T21:59:59Z") }, p, now),
    true,
  );
  assert.equal(
    rowMatches({ at: Date.parse("2026-03-29T22:00:00Z") }, p, now),
    false,
  );
});
test("win and loss filters include half results despite stored SETTLED status", () => {
  assert.equal(
    rowMatches(
      { at: null, status: "SETTLED", outcome: "HALF_WIN" },
      new URLSearchParams("status=WIN"),
      Date.now(),
    ),
    true,
  );
  assert.equal(
    rowMatches(
      { at: null, status: "SETTLED", outcome: "LOSS" },
      new URLSearchParams("status=WIN"),
      Date.now(),
    ),
    false,
  );
});
