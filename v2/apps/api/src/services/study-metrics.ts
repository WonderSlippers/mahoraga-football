import { summarizeRecords } from "./workspace";
export function studyMetrics(
  samples: any[],
  originalN: number = samples.length,
) {
  const actions = samples
    .filter((r) => r.action !== "NO_ACTION")
    .map((r) => ({
      ...r,
      id: r.fixtureId,
      at: Date.parse(r.date),
      settledAt: Date.parse(r.date),
      status: "SETTLED",
      currency: "RESEARCH_UNIT",
      stakeAtoms: "1000000",
      pnlAtoms: String(Math.round(r.pnl * 1e6)),
    }));
  const predictions = samples.filter(
    (r) =>
      Array.isArray(r.central) &&
      r.central.length === 3 &&
      [0, 1, 2].includes(r.outcome),
  );
  const bins = Array.from({ length: 10 }, (_, i) => ({
    lower: i / 10,
    n: 0,
    predicted: 0,
    observed: 0,
  }));
  let ll = 0,
    brier = 0;
  for (const r of predictions) {
    ll -= Math.log(Math.max(r.central[r.outcome], 1e-15));
    brier += r.central.reduce(
      (s: number, p: number, i: number) => s + (p - +(i === r.outcome)) ** 2,
      0,
    );
    r.central.forEach((p: number, i: number) => {
      const b = bins[Math.min(9, Math.floor(p * 10))];
      b.n++;
      b.predicted += p;
      b.observed += +(i === r.outcome);
    });
  }
  return {
    ...summarizeRecords(actions),
    eligibleN: samples.length,
    originalN,
    sampleRange: {
      from: samples.map((r) => r.date).sort()[0] ?? null,
      to:
        samples
          .map((r) => r.date)
          .sort()
          .at(-1) ?? null,
    },
    probabilityN: predictions.length,
    logLoss: predictions.length ? ll / predictions.length : null,
    brier: predictions.length ? brier / predictions.length : null,
    coverage: originalN ? samples.length / originalN : null,
    actionRate: samples.length ? actions.length / samples.length : null,
    calibration: bins
      .filter((b) => b.n)
      .map((b) => ({
        ...b,
        predicted: b.predicted / b.n,
        observed: b.observed / b.n,
      })),
  };
}
export const referenceOdds = (row: any) =>
  Array.isArray(row.marketOdds) &&
  row.marketOdds.length === 3 &&
  row.marketOdds.every(
    (v: any) => typeof v === "number" && Number.isFinite(v) && v > 1,
  )
    ? Math.min(...row.marketOdds)
    : null;
export const oddsBand = (n: number | null) =>
  n == null ? "UNKNOWN" : n < 1.8 ? "<1.8" : n < 2.5 ? "1.8–2.5" : "≥2.5";
export function matchesStudySample(r: any, p: URLSearchParams) {
  return (
    (!p.get("season") ||
      p.get("season") === "ALL" ||
      String(r.season) === p.get("season")) &&
    (!p.get("league") ||
      p.get("league") === "ALL" ||
      r.competition === p.get("league")) &&
    (!p.get("odds") ||
      p.get("odds") === "ALL" ||
      (referenceOdds(r) !== null &&
        (p.get("odds") === "LOW"
          ? referenceOdds(r)! < 1.8
          : p.get("odds") === "MID"
            ? referenceOdds(r)! >= 1.8 && referenceOdds(r)! < 2.5
            : referenceOdds(r)! >= 2.5)))
  );
}
