import { central } from "../contracts";

export const GENERAL_ADAPTIVE_ID = "GENERAL_FOOTBALL_ADAPTIVE_RESEARCH_V1";
export const GENERAL_FIXED_ID = "GENERAL_FOOTBALL_RESEARCH_V2";
export const ADAPTATION_PROTOCOL = "GENERAL_PREQUENTIAL_CALIBRATION_V1";
export type Calibration = { modelTrust: number; temperature: number };
export const INITIAL_CALIBRATION: Calibration = {
  modelTrust: 1,
  temperature: 1,
};
export const ADAPTATION_RULES = {
  protocol: ADAPTATION_PROTOCOL,
  minimumTraining: 60,
  minimumNewTraining: 20,
  minimumValidation: 30,
  maximumTraining: 400,
  maximumStep: 0.05,
  modelTrustBounds: [0.6, 1],
  temperatureBounds: [0.8, 1.4],
  minimumLogLossGain: 0.002,
  maximumBrierRegression: 0.0005,
  validation: "NEW_FIXTURES_WITH_INPUT_CUTOFF_AFTER_PROPOSAL",
  objective: "MULTICLASS_LOGLOSS_NOT_GRADE_ROI",
  status: "UNVALIDATED_PAPER_RESEARCH_NO_STRICT_PROMOTION",
} as const;
export function validCalibration(p: Calibration) {
  if (
    !p ||
    Object.keys(p).sort().join() !== "modelTrust,temperature" ||
    !Number.isFinite(p.modelTrust) ||
    p.modelTrust < 0.6 ||
    p.modelTrust > 1 ||
    !Number.isFinite(p.temperature) ||
    p.temperature < 0.8 ||
    p.temperature > 1.4
  )
    throw Error("CALIBRATION_INVALID");
  return p;
}
export function calibrate(base: number[], market: number[], p: Calibration) {
  central(base);
  central(market);
  validCalibration(p);
  if (p.modelTrust === 1 && p.temperature === 1) return [...base];
  const blended = base.map(
    (x, i) => p.modelTrust * x + (1 - p.modelTrust) * market[i],
  );
  const power = blended.map((x) =>
    Math.pow(Math.max(1e-12, x), 1 / p.temperature),
  );
  const sum = power.reduce((a, b) => a + b, 0);
  return power.map((x) => x / sum);
}
export type CalibrationSample = {
  fixtureId: string;
  observationId: string;
  adjudicationId: string;
  cutoffAt: number;
  kickoffAt: number;
  base: number[];
  market: number[];
  outcome: number;
};
export function calibrationMetrics(
  samples: CalibrationSample[],
  p: Calibration,
) {
  if (!samples.length) return { N: 0, logLoss: null, brier: null };
  let loss = 0,
    brier = 0;
  for (const s of samples) {
    if (![0, 1, 2].includes(s.outcome)) throw Error("OUTCOME_INVALID");
    const probabilities = calibrate(s.base, s.market, p);
    loss -= Math.log(Math.max(1e-12, probabilities[s.outcome]));
    brier += probabilities.reduce(
      (sum, x, i) => sum + (x - (i === s.outcome ? 1 : 0)) ** 2,
      0,
    );
  }
  return {
    N: samples.length,
    logLoss: loss / samples.length,
    brier: brier / samples.length,
  };
}
export function validationDecision(
  samples: CalibrationSample[],
  current: Calibration,
  proposed: Calibration,
) {
  validCalibration(proposed);
  if (
    Math.abs(proposed.modelTrust - current.modelTrust) > 0.050000001 ||
    Math.abs(proposed.temperature - current.temperature) > 0.050000001
  )
    throw Error("CALIBRATION_STEP_TOO_LARGE");
  const before = calibrationMetrics(samples, current),
    after = calibrationMetrics(samples, proposed),
    fixed = calibrationMetrics(samples, INITIAL_CALIBRATION);
  const accepted =
    samples.length >= ADAPTATION_RULES.minimumValidation &&
    after.logLoss! <= before.logLoss! - ADAPTATION_RULES.minimumLogLossGain &&
    after.brier! <= before.brier! + ADAPTATION_RULES.maximumBrierRegression &&
    after.logLoss! <= fixed.logLoss! + 0.005;
  return {
    accepted,
    before,
    after,
    fixed,
    reason:
      samples.length < ADAPTATION_RULES.minimumValidation
        ? "WAITING_FOR_NEW_FORWARD_RESULTS"
        : accepted
          ? "FORWARD_CALIBRATION_GAIN"
          : "FORWARD_GAIN_NOT_CONFIRMED",
  };
}
