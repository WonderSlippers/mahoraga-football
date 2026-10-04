import test from "node:test";
import assert from "node:assert/strict";
import {
  teamOriginalName,
  matchesTeamSearch,
  researchScoreBand,
  groupResearchDirections,
  researchBetKey,
} from "../../packages/display";
import { rowMatches } from "../../apps/api/src/services/workspace";
test("bilingual names preserve source spelling and recover known English names for Chinese archives", () => {
  assert.equal(teamOriginalName("Manchester United"), "Manchester United");
  assert.equal(teamOriginalName("曼联"), "Manchester United");
  assert.equal(teamOriginalName("Unknown United"), "Unknown United");
  assert.equal(teamOriginalName("未知队"), "未知队");
});
test("one display direction keeps all strategy snapshots without taking the maximum score or changing frozen records", () => {
  const first = {
    modelId: "GENERAL",
    market: "ASIAN_HANDICAP",
    selection: "HOME",
    lineQ: 2,
    odds: "1.95",
    rank: 78,
    cutoffAt: 1,
    policyLabel: "价值单场",
  };
  const plans = [
    first,
    { ...first, policyLabel: "精选玩法" },
    { ...first, rank: 92, cutoffAt: 2, odds: "2.1" },
    { ...first, lineQ: 3 },
    { ...first, modelId: "V6", rank: null },
  ];
  const before = JSON.stringify(plans);
  const groups = groupResearchDirections(plans);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].primary, first);
  assert.equal(groups[0].primary.rank, 78);
  assert.equal(groups[0].records.length, 3);
  assert.deepEqual(groups[0].policies, ["价值单场", "精选玩法"]);
  assert.equal(groups[2].primary.rank, null);
  assert.notEqual(researchBetKey(first), researchBetKey(plans[3]));
  assert.equal(JSON.stringify(plans), before);
});
test("team search supports both languages, aliases, accents and punctuation without merging clubs", () => {
  for (const query of ["曼联", "Manchester United", "man utd", "man-utd"]) {
    assert.ok(matchesTeamSearch(query, ["Manchester United"]));
    assert.equal(matchesTeamSearch(query, ["Manchester City"]), false);
  }
  assert.ok(matchesTeamSearch("Manchester United", ["曼联"]));
  assert.ok(matchesTeamSearch("韩国", ["Korea Republic"]));
  assert.ok(matchesTeamSearch("South Korea", ["Korea Republic"]));
  assert.ok(matchesTeamSearch("Malaga", ["Málaga"]));
  assert.ok(matchesTeamSearch("女足", ["England"], "fifa.friendly.w"));
  assert.equal(matchesTeamSearch("女足", ["England"], "fifa.friendly"), false);
});
test("score bands retain original cutoffs, never convert missing scores or probabilities into a score", () => {
  for (const [score, grade] of [
    [0, "D"],
    [44, "D"],
    [45, "C"],
    [59, "C"],
    [60, "B"],
    [74, "B"],
    [75, "A"],
    [100, "A"],
  ] as const)
    assert.equal(researchScoreBand(score).grade, grade);
  for (const missing of [null, undefined, NaN, Infinity, -1, 101, "75"])
    assert.equal(researchScoreBand(missing).score, null);
  assert.equal(researchScoreBand(0).score, 0);
});
test("ledger search finds Chinese and English names from frozen ticket legs even when title differs", () => {
  const r = {
    title: "原票",
    id: "ticket",
    portfolio: "paper",
    legs: [{ home: "Manchester United", away: "Manchester City" }],
  };
  for (const q of ["曼联", "man utd", "Manchester United"])
    assert.ok(rowMatches(r, new URLSearchParams({ q }), Date.now()));
  assert.equal(
    rowMatches(r, new URLSearchParams({ q: "Liverpool" }), Date.now()),
    false,
  );
});
