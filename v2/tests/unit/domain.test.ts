import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import {
  gross,
  atoms,
  score,
  odds,
  marketBaseline,
  expected,
  accountingDay,
  quoteGroup,
} from "../../packages/domain/index";
import { input, canonical, sha, central } from "../../packages/contracts/index";
import golden from "../../packages/test-fixtures/golden-market-cases.json";
for (const c of golden.cases)
  test("A10 A24 " + c.id, () => {
    const stake = String(Math.round(Number(c.stake) * 1e6));
    assert.equal(
      gross(stake, c, c.score, c.decimalOdds),
      String(Math.round(Number(c.expectedGross) * 1e6)),
    );
  });
test("A09 A12 rejects absent/invalid values without treating them as zero", () => {
  for (const x of [null, "", NaN, Infinity, {}, "1.0", "9007199254740992"])
    assert.throws(() => atoms(x));
  assert.equal(atoms("0"), 0n);
  for (const s of [
    { home: null, away: null },
    { home: "", away: "" },
    { home: NaN, away: 0 },
  ])
    assert.throws(() => score(s));
  assert.deepEqual(score({ home: 0, away: 0 }), { home: 0, away: 0 });
  for (const p of [
    [0.5, 0.5, 0.5],
    [NaN, 0, 1],
    [null, 0, 1],
  ])
    assert.throws(() => central(p));
});
test("A20 A22 complete market, explicit decimal/american and water", () => {
  assert.equal(odds("21.00", "decimal"), "21");
  assert.equal(odds("100.00", "decimal"), "100");
  assert.equal(odds("+100", "american"), "2");
  assert.equal(odds("-110", "american"), "1.909090909091");
  assert.throws(() => odds("21", "unknown"));
  assert.throws(() => marketBaseline(["2", "3"]));
  const p = marketBaseline(["2", "3.2", "4"]);
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-8);
  assert.ok(p.every((x, i) => x * Number(["2", "3.2", "4"][i]) - 1 < 0));
});
test("A25 push mass yields 25 percent", () =>
  assert.equal(expected(golden.expectationCase.probabilities, 2) - 1, 0.25));
test("A21 A24 selected side handicap sign", () => {
  assert.equal(
    gross(
      "25000000",
      { market: "ASIAN_HANDICAP", selection: "HOME", lineQ: -3 },
      { home: 1, away: 0 },
      "1.9",
    ),
    gross(
      "25000000",
      { market: "ASIAN_HANDICAP", selection: "AWAY", lineQ: -3 },
      { home: 0, away: 1 },
      "1.9",
    ),
  );
  assert.throws(() =>
    gross(
      "25000000",
      { market: "1X2", selection: "HOME", lineQ: null, scope: "EXTRA_TIME" },
      { home: 2, away: 1 },
      "2",
    ),
  );
});
test("A23 quote sets cannot mix provider/phase/snapshot/time/market", () => {
  const base = ["HOME", "DRAW", "AWAY"].map((selection) => ({
    selection,
    provider: "demo",
    phase: "PRE",
    marketId: "m",
    snapshotId: "s",
    observedAt: 1,
  }));
  assert.ok(quoteGroup(base));
  for (const k of [
    "provider",
    "phase",
    "marketId",
    "snapshotId",
    "observedAt",
  ]) {
    const rows = structuredClone(base);
    (rows[1] as any)[k] = "different";
    assert.throws(() => quoteGroup(rows));
  }
});
test("A11 accounting day uses timezone calendar and cutoff", () => {
  assert.equal(
    accountingDay(Date.parse("2026-09-27T16:00:00Z"), "Asia/Shanghai"),
    "2026-09-28",
  );
  assert.equal(
    accountingDay(Date.parse("2026-09-27T23:59:59Z"), "Asia/Shanghai", 8),
    "2026-09-27",
  );
  assert.equal(
    accountingDay(Date.parse("2026-09-28T00:00:00Z"), "Asia/Shanghai", 8),
    "2026-09-28",
  );
  for (const s of ["2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"])
    assert.equal(accountingDay(Date.parse(s), "Europe/Berlin"), "2026-10-25");
});
test("A13 TS/Python contract matrix, exact canonical bytes and missing masks", async () => {
  const base = {
    mode: "DEMO",
    fixtureId: "f",
    revisionId: "r",
    observedAt: "2026-09-28T01:00:00Z",
    ingestedAt: "2026-09-28T01:00:00Z",
    cutoffAt: "2026-09-28T01:00:00Z",
    kickoffAt: "2026-09-28T02:00:00Z",
    odds: ["2", "3.2", "4"],
    missingMask: [],
  };
  const samples = [
    base,
    { ...base, missingMask: ["xg"] },
    { ...base, odds: ["", "3", "4"] },
    { ...base, odds: [null, "3", "4"] },
    { ...base, observedAt: "2026-09-28T01:00:00" },
    { ...base, observedAt: "2026-02-30T01:00:00Z" },
    { ...base, ingestedAt: "2026-09-28T01:01:00Z" },
    { ...base, extra: 1 },
    { ...base, mode: "PUBLIC" },
  ];
  const bytes = samples.map(canonical);
  const py = JSON.parse(
    execFileSync(
      ".venv/Scripts/python.exe",
      ["model-runner/contract_check.py"],
      { input: JSON.stringify(bytes), encoding: "utf8" },
    ),
  );
  for (let i = 0; i < samples.length; i++) {
    let valid = true;
    try {
      input(samples[i]);
    } catch {
      valid = false;
    }
    assert.equal(valid, py[i].valid, bytes[i]);
    if (valid) {
      assert.equal(await sha(bytes[i]), py[i].hash);
      assert.deepEqual(samples[i].missingMask, py[i].missingMask);
    }
  }
});
