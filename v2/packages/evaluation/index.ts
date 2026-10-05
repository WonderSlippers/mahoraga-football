export function probabilityMetrics(
  samples: { central: number[] | null; outcome: number | null }[],
) {
  let n = 0,
    brier = 0,
    logloss = 0;
  const excluded = { outputUnsupported: 0, resultMissing: 0 };
  for (const sample of samples) {
    if (sample.central === null) {
      excluded.outputUnsupported++;
      continue;
    }
    if (
      sample.central.length !== 3 ||
      sample.central.some((x) => !Number.isFinite(x) || x < 0 || x > 1) ||
      Math.abs(sample.central.reduce((a, b) => a + b, 0) - 1) > 1e-8
    )
      throw Error("MODEL_OUTPUT_INVALID");
    if (sample.outcome === null) {
      excluded.resultMissing++;
      continue;
    }
    if (![0, 1, 2].includes(sample.outcome)) throw Error("OUTCOME_INVALID");
    n++;
    brier += sample.central.reduce(
      (sum, p, i) => sum + (p - (i === sample.outcome ? 1 : 0)) ** 2,
      0,
    );
    logloss -= Math.log(Math.max(sample.central[sample.outcome], 1e-15));
  }
  return {
    sampleCount: n,
    brier: n ? brier / n : null,
    logLoss: n ? logloss / n : null,
    logFloor: 1e-15,
    brierDefinition: "SUM_OF_THREE_SQUARED_ERRORS",
    excluded,
  };
}
export function roi(stake: string, profit: string) {
  return BigInt(stake) === 0n ? null : Number(profit) / Number(stake);
}
export function csvCell(value: unknown) {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function referenceClv(
  frozen: {
    marketId: string;
    providerId: string;
    selection: string;
    odds: number;
  },
  close: {
    marketId: string;
    providerId: string;
    selection: string;
    odds: number;
    phase: string;
  } | null,
) {
  if (
    !close ||
    close.phase !== "CLOSING_REFERENCE" ||
    close.marketId !== frozen.marketId ||
    close.providerId !== frozen.providerId ||
    close.selection !== frozen.selection
  )
    return null;
  if (![frozen.odds, close.odds].every((x) => Number.isFinite(x) && x > 1))
    throw Error("ODDS_INVALID");
  return frozen.odds / close.odds - 1;
}
