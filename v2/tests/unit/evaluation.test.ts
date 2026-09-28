import { test } from "node:test";
import assert from "node:assert/strict";
import {
  probabilityMetrics,
  roi,
  csvCell,
  referenceClv,
} from "../../packages/evaluation/index";
test("A76 probability losses use three-class sum; V6 stress and missing results excluded", () => {
  const m = probabilityMetrics([
    { central: [0.5, 0.3, 0.2], outcome: 0 },
    { central: null, outcome: 0 },
    { central: [0.5, 0.3, 0.2], outcome: null },
  ]);
  assert.equal(m.sampleCount, 1);
  assert.ok(Math.abs(m.brier! - 0.38) < 1e-12);
  assert.ok(Math.abs(m.logLoss! - Math.log(2)) < 1e-12);
  assert.deepEqual(m.excluded, { outputUnsupported: 1, resultMissing: 1 });
  assert.equal(probabilityMetrics([]).brier, null);
  assert.throws(() =>
    probabilityMetrics([{ central: [0.5, 0.5, 0.5], outcome: 0 }]),
  );
});
test("A64 A75 no action ROI null and exported CSV formulas are escaped", () => {
  assert.equal(roi("0", "0"), null);
  assert.equal(roi("100", "-20"), -0.2);
  for (const text of ["=1+1", "+SUM(A1)", "-CMD", "@CMD", "\t=1", " \n=1"])
    assert.ok(csvCell(text).startsWith("\"'"));
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell(null), '""');
});
test("A78 closing reference cannot mix provider/market/selection or phase", () => {
  const frozen = {
    marketId: "90min-1x2",
    providerId: "a",
    selection: "HOME",
    odds: 2.1,
  };
  const close = { ...frozen, odds: 2, phase: "CLOSING_REFERENCE" };
  assert.ok(Math.abs(referenceClv(frozen, close)! - 0.05) < 1e-12);
  for (const change of [
    { marketId: "aet" },
    { providerId: "b" },
    { selection: "AWAY" },
    { phase: "LATEST" },
  ])
    assert.equal(referenceClv(frozen, { ...close, ...change }), null);
});
