import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generalPricing,
  validateGeneralOutput,
} from "../../apps/api/src/services/universal";
import { UNIVERSAL_ID } from "../../packages/domain/universal";
const output: any = {
  variant: UNIVERSAL_ID,
  state: "DONE",
  reason: "TEST ONLY",
  central: [0.6, 0.3, 0.1],
  grid: [
    [0.1, 0.1, 0],
    [0.5, 0.2, 0],
    [0.1, 0, 0],
  ],
  uncertaintyMargin: 0.02,
  basis: "CLUB_STANDINGS_POISSON",
  researchOnly: true,
};
test("general pricing includes quarter-goal half losses/pushes, rather than probability times odds", () => {
  const p = generalPricing(output, {
    market: "ASIAN_HANDICAP",
    selection: "HOME",
    lineQ: -1,
    odds: "2",
  })!;
  assert.ok(Math.abs(p.states.winFull - 0.6) < 1e-12);
  assert.ok(Math.abs(p.states.loseHalf - 0.3) < 1e-12);
  assert.ok(Math.abs(p.states.loseFull - 0.1) < 1e-12);
  assert.ok(Math.abs(p.rawReturn - 1.35) < 1e-12);
  assert.ok(Math.abs(p.expectedReturn - 1.31) < 1e-12);
  assert.notEqual(p.probability * 2, p.expectedReturn);
  assert.ok(p.minimumOdds! >= (1.08 - 0.15) / 0.58);
});
test("generic research policy refuses longshot/market-only/negative EV and keeps probability distinct", () => {
  const p = generalPricing(output, {
    market: "1X2",
    selection: "HOME",
    lineQ: null,
    odds: "2",
  })!;
  assert.equal(p.probability, 0.6);
  assert.equal(p.conservativeProbability, 0.58);
  assert.equal(p.qualified, true);
  assert.equal(
    generalPricing(output, {
      market: "1X2",
      selection: "HOME",
      lineQ: null,
      odds: "6",
    })!.qualified,
    false,
  );
  assert.equal(
    generalPricing(
      { ...output, grid: null, basis: "MARKET_FORM_ONLY" },
      { market: "1X2", selection: "HOME", lineQ: null, odds: "2" },
    )!.qualified,
    false,
  );
  assert.equal(
    generalPricing(output, {
      market: "1X2",
      selection: "AWAY",
      lineQ: null,
      odds: "2",
    })!.qualified,
    false,
  );
  assert.equal(
    generalPricing(
      { ...output, grid: null },
      { market: "TOTAL_GOALS", selection: "OVER", lineQ: 9, odds: "2" },
    ),
    null,
  );
});
test("frozen general distributions reject missing probability, excess mass and blocked fake forecasts", () => {
  validateGeneralOutput(output);
  for (const o of [
    { ...output, central: [0.5, 0.3, 0.3] },
    {
      ...output,
      grid: [
        [1, 1],
        [1, 1],
      ],
    },
    {
      ...output,
      grid: [
        [null, 0],
        [0, 1],
      ],
    },
    { ...output, uncertaintyMargin: null },
    { ...output, state: "BLOCKED" },
  ])
    assert.throws(() => validateGeneralOutput(o), /MODEL_OUTPUT_INVALID|PROB/);
  validateGeneralOutput({
    variant: UNIVERSAL_ID,
    state: "BLOCKED",
    central: null,
    grid: null,
    reason: "NEUTRAL_VENUE_UNKNOWN",
    researchOnly: true,
  });
});
