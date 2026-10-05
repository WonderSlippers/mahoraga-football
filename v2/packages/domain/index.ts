import Decimal from "decimal.js";
export const MAX = 9007199254740991n;
export function atoms(v: unknown, positive = false): bigint {
  if (typeof v !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(v))
    throw new Error("AMOUNT_INVALID");
  const n = BigInt(v);
  if (n > MAX || n < -MAX || (positive && n <= 0n))
    throw new Error("AMOUNT_INVALID");
  return n;
}
export function score(v: unknown): { home: number; away: number } {
  const s = v as { home: number; away: number };
  if (
    !s ||
    ![s.home, s.away].every(
      (x) => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 100,
    )
  )
    throw new Error("RESULT_REGULATION_UNKNOWN");
  return s;
}
export function odds(raw: string, format: string) {
  if (typeof raw !== "string" || !/^[+-]?\d+(\.\d{1,12})?$/.test(raw))
    throw new Error("ODDS_INVALID");
  let d = new Decimal(raw);
  if (format === "american") {
    if (d.abs().lt(100)) throw new Error("ODDS_INVALID");
    d = d.gt(0) ? d.div(100).plus(1) : new Decimal(100).div(d.abs()).plus(1);
  } else if (format !== "decimal") throw new Error("ODDS_FORMAT_UNKNOWN");
  if (!d.isFinite() || d.lte(1)) throw new Error("ODDS_INVALID");
  return d.toDecimalPlaces(12).toString();
}
export type Market = {
  market: string;
  selection: string;
  lineQ: number | null;
  scope?: string;
};
export function multiplier(m: Market, s: unknown, d: string): Decimal {
  const sc = score(s);
  const o = new Decimal(odds(d, "decimal"));
  if (m.scope && m.scope !== "REGULATION_90")
    throw new Error("MARKET_MISMATCH");
  if (m.market === "1X2") {
    if (m.lineQ !== null || !["HOME", "DRAW", "AWAY"].includes(m.selection))
      throw new Error("MARKET_MISMATCH");
    return new Decimal(
      m.selection ===
        (sc.home > sc.away ? "HOME" : sc.home === sc.away ? "DRAW" : "AWAY")
        ? o
        : 0,
    );
  }
  if (!Number.isInteger(m.lineQ)) throw new Error("MARKET_MISMATCH");
  const q = m.lineQ!;
  if (
    (m.market === "ASIAN_HANDICAP" &&
      !["HOME", "AWAY"].includes(m.selection)) ||
    (m.market === "TOTAL_GOALS" &&
      (!["OVER", "UNDER"].includes(m.selection) || q < 0)) ||
    !["ASIAN_HANDICAP", "TOTAL_GOALS"].includes(m.market)
  )
    throw new Error("MARKET_MISMATCH");
  const lines = q % 2 === 0 ? [q] : [q - 1, q + 1];
  return lines
    .reduce((a, l) => {
      const n =
        m.market === "ASIAN_HANDICAP"
          ? 4 *
              (m.selection === "HOME" ? sc.home - sc.away : sc.away - sc.home) +
            l
          : (4 * (sc.home + sc.away) - l) * (m.selection === "OVER" ? 1 : -1);
      return a.plus(n > 0 ? o : n === 0 ? 1 : 0);
    }, new Decimal(0))
    .div(lines.length);
}
export function gross(stake: string, m: Market, s: unknown, d: string) {
  const n = new Decimal(atoms(stake, true).toString())
    .mul(multiplier(m, s, d))
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toFixed(0);
  atoms(n);
  return n;
}
export function marketBaseline(o: string[]) {
  if (o.length !== 3) throw new Error("QUOTE_INCOMPLETE");
  const a = o.map((x) => 1 / Number(odds(x, "decimal")));
  const sum = a.reduce((x, y) => x + y, 0);
  return a.map((x) => x / sum);
}
export function expected(p: Record<string, number>, d: number) {
  if (
    Object.values(p).some((x) => !Number.isFinite(x) || x < 0) ||
    Math.abs(Object.values(p).reduce((a, b) => a + b, 0) - 1) > 1e-8
  )
    throw new Error("MODEL_OUTPUT_INVALID");
  return p.winFull * d + (p.winHalf * (1 + d)) / 2 + p.push + p.loseHalf / 2;
}
export function accountingDay(ms: number, zone: string, cutoffHour = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ms);
  const get = (s: string) => parts.find((p) => p.type === s)!.value;
  const day = `${get("year")}-${get("month")}-${get("day")}`;
  return Number(get("hour")) < cutoffHour
    ? new Date(Date.parse(day + "T00:00:00Z") - 86400000)
        .toISOString()
        .slice(0, 10)
    : day;
}
export function quoteGroup(
  rows: {
    provider: string;
    phase: string;
    marketId: string;
    snapshotId: string;
    selection: string;
    observedAt: number;
  }[],
) {
  if (
    rows.length !== 3 ||
    new Set(rows.map((x) => x.selection)).size !== 3 ||
    rows.some((x) => !["HOME", "DRAW", "AWAY"].includes(x.selection))
  )
    throw new Error("QUOTE_INCOMPLETE");
  for (const k of [
    "provider",
    "phase",
    "marketId",
    "snapshotId",
    "observedAt",
  ] as const)
    if (new Set(rows.map((x) => x[k])).size !== 1)
      throw new Error("MARKET_MISMATCH");
  return true;
}
