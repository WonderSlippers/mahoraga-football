import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  calibrate,
  calibrationMetrics,
  validationDecision,
  INITIAL_CALIBRATION,
} from "../../packages/domain/general-adaptation";
import { input } from "../../packages/contracts";
const base = [0.9, 0.05, 0.05],
  market = [0.5, 0.25, 0.25];
const sample = (outcome: number, i: number) => ({
  fixtureId: String(i),
  observationId: String(i),
  adjudicationId: String(i),
  cutoffAt: 1,
  kickoffAt: 2,
  base,
  market,
  outcome,
});
test("neutral parameters preserve fixed General; reduced trust and temperature soften overconfidence", () => {
  assert.deepEqual(calibrate(base, market, INITIAL_CALIBRATION), base);
  const p = calibrate(base, market, { modelTrust: 0.95, temperature: 1.05 });
  assert.ok(p[0] < base[0]);
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-12);
});
test("forward acceptance uses proper probability scores, rejects deterioration and small cohorts", () => {
  const mixed = Array.from({ length: 30 }, (_, i) => sample(i % 3, i)),
    wins = Array.from({ length: 30 }, (_, i) => sample(0, i)),
    p = { modelTrust: 0.95, temperature: 1.05 };
  assert.equal(
    validationDecision(mixed, INITIAL_CALIBRATION, p).accepted,
    true,
  );
  assert.equal(
    validationDecision(wins, INITIAL_CALIBRATION, p).accepted,
    false,
  );
  assert.equal(
    validationDecision(mixed.slice(0, 29), INITIAL_CALIBRATION, p).accepted,
    false,
  );
  assert.deepEqual(calibrationMetrics([], p), {
    N: 0,
    logLoss: null,
    brier: null,
  });
});
test("invalid calibration and oversized updates are rejected", () => {
  for (const p of [
    { modelTrust: 0, temperature: 1 },
    { modelTrust: 1, temperature: NaN },
    { modelTrust: 1, temperature: 2 },
  ])
    assert.throws(() => calibrate(base, market, p));
  assert.throws(
    () =>
      validationDecision([], INITIAL_CALIBRATION, {
        modelTrust: 0.8,
        temperature: 1,
      }),
    /STEP_TOO_LARGE/,
  );
});
test("Python train-only learner chooses bounded parameters and matches TypeScript calibration", () => {
  const training = Array.from({ length: 60 }, (_, i) => sample(i % 3, i));
  const result = spawnSync(
    path.resolve(".venv/Scripts/python.exe"),
    [
      "-c",
      "import json,sys;from general_adaptation import fit,calibrate;j=json.load(sys.stdin);p=fit(j);print(json.dumps(dict(parameters=p,central=calibrate(j['training'][0]['base'],j['training'][0]['market'],p))))",
    ],
    {
      cwd: path.resolve("model-runner"),
      input: JSON.stringify({
        protocol: "GENERAL_PREQUENTIAL_CALIBRATION_V1",
        parameters: INITIAL_CALIBRATION,
        training,
      }),
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const o = JSON.parse(result.stdout);
  assert.deepEqual(o.parameters, { modelTrust: 0.95, temperature: 1.05 });
  const expected = calibrate(base, market, o.parameters);
  o.central.forEach((v: number, i: number) =>
    assert.ok(Math.abs(v - expected[i]) < 1e-12),
  );
});
test("parameter snapshots cannot contain information from after forecast cutoff", () => {
  assert.throws(
    () =>
      input({
        mode: "LOCAL_RESEARCH",
        fixtureId: "TEST",
        revisionId: "TEST",
        observedAt: "2026-10-01T00:00:00Z",
        ingestedAt: "2026-10-01T00:00:00Z",
        cutoffAt: "2026-10-01T00:00:00Z",
        kickoffAt: "2026-10-02T00:00:00Z",
        odds: ["2", "4", "4"],
        missingMask: [],
        generalCalibration: {
          protocol: "GENERAL_PREQUENTIAL_CALIBRATION_V1",
          revision: 1,
          modelTrust: 0.95,
          temperature: 1.05,
          effectiveAt: Date.parse("2026-10-01T00:00:01Z"),
        },
      }),
    /FEATURE_LATE/,
  );
});
