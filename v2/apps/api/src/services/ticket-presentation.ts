import { multiplier } from "../../../../packages/domain";

const OPEN = ["OPEN", "REVIEW", "REOPENED", "PENDING", "UNSETTLED"];
export function ticketOutcome(
  status: string,
  profit: string | null,
  legs: any[] = [],
) {
  const state = String(status).toUpperCase();
  if (OPEN.includes(state)) return state === "REVIEW" ? "REVIEW" : "OPEN";
  if (["VOID", "CANCELLED"].includes(state)) return "VOID";
  if (profit == null)
    return ["WIN", "WON"].includes(state)
      ? "WIN"
      : ["LOSS", "LOST"].includes(state)
        ? "LOSS"
        : "UNKNOWN";
  if (BigInt(profit) > 0n)
    return legs.length === 1 && legs[0].outcome === "HALF_WIN"
      ? "HALF_WIN"
      : "WIN";
  if (BigInt(profit) < 0n)
    return legs.length === 1 && legs[0].outcome === "HALF_LOSS"
      ? "HALF_LOSS"
      : "LOSS";
  return legs.length && legs.every((l) => l.outcome === "VOID")
    ? "VOID"
    : "PUSH";
}
export function marketLabel(m: any) {
  if (!m) return "原方向未保存";
  if (m.market === "1X2")
    return (
      ({ HOME: "主胜", DRAW: "平局", AWAY: "客胜" } as any)[m.selection] ??
      "方向未知"
    );
  if (m.market === "TOTAL_GOALS")
    return `${m.selection === "OVER" ? "大" : "小"} ${m.lineQ / 4} 球`;
  if (m.market === "ASIAN_HANDICAP")
    return `${m.selection === "HOME" ? "主队" : "客队"} ${m.lineQ === 0 ? "平手" : `${m.lineQ > 0 ? "+" : ""}${m.lineQ / 4}`}`;
  return m.selection ?? "方向未知";
}
export function paperLeg(r: any) {
  const marketSpec = JSON.parse(r.marketSpecJson);
  const score =
    r.adjudicationState === "ACCEPTED_REGULATION"
      ? JSON.parse(r.regulationJson)
      : null;
  let outcome = r.adjudicationState === "REVIEW" ? "REVIEW" : "OPEN",
    factor: string | null = null;
  if (r.adjudicationState === "VOID_BY_RULE") {
    outcome = "VOID";
    factor = "1";
  }
  if (score) {
    const value = multiplier(marketSpec, score, r.frozenOdds);
    factor = value.toString();
    outcome = value.eq(0)
      ? "LOSS"
      : value.eq(1)
        ? "PUSH"
        : value.eq(r.frozenOdds)
          ? "WIN"
          : value.lt(1)
            ? "HALF_LOSS"
            : "HALF_WIN";
  }
  return {
    fixtureId: r.fixtureId,
    home: r.home,
    away: r.away,
    league: r.competition,
    model: r.modelId,
    market: marketSpec.market,
    marketSpec,
    selection: marketSpec.selection,
    selectionLabel: marketLabel(marketSpec),
    odds: r.frozenOdds,
    kickoffAt: r.kickoffAt,
    provider: r.quoteProvider,
    priceCapturedAt: r.quoteObservedAt,
    finalScore: score ? `${score.home}–${score.away}` : null,
    outcome,
    returnFactor: factor,
    adjudicationId: r.adjudicationId ?? null,
  };
}
export function legacyTicket(r: any) {
  const legs = (r.raw?.legs ?? []).map((l: any, index: number) => ({
    ...l,
    fixtureId: r.fixtureLinks?.[index]?.id ?? null,
    selectionLabel:
      l.pickName ??
      (l.market === "spread"
        ? `${l.side === "home" ? "主队" : l.side === "away" ? "客队" : "方向未保存"} ${l.line == null ? "盘口未保存" : Number(l.line) === 0 ? "平手" : `${Number(l.line) > 0 ? "+" : ""}${l.line}`}`
        : l.market === "total"
          ? `${l.side === "over" ? "大" : l.side === "under" ? "小" : "方向未保存"} ${l.line ?? "盘口未保存"} 球`
          : ["主胜", "平局", "客胜"][Number(l.pick)]) ??
      l.pick ??
      "原方向未保存",
    outcome:
      ["spread", "total"].includes(l.market) &&
      ["WIN", "LOSS", "VOID"].includes(String(l.status).toUpperCase()) &&
      l.returnFactor != null &&
      Number.isFinite(Number(l.returnFactor)) &&
      !/作废|取消/.test(l.finalScore ?? "")
        ? Number(l.returnFactor) === 1
          ? "PUSH"
          : Number(l.returnFactor) > 0 && Number(l.returnFactor) < 1
            ? "HALF_LOSS"
            : Number(l.returnFactor) > 1 &&
                Number(l.returnFactor) < Number(l.odds)
              ? "HALF_WIN"
              : Number(l.returnFactor) === 0
                ? "LOSS"
                : "WIN"
        : ((
            {
              WIN: "WIN",
              LOSS: "LOSS",
              VOID: "VOID",
              OPEN: "OPEN",
              REVIEW: "REVIEW",
              PUSH: "PUSH",
            } as any
          )[String(l.status).toUpperCase()] ?? "UNKNOWN"),
    finalScore: l.finalScore ?? null,
    odds: l.odds ?? null,
  }));
  const outcome = ticketOutcome(r.status, r.pnlAtoms, legs);
  return {
    ...r,
    legs,
    legCount: legs.length,
    strategyLabel: r.strategyLabel ?? r.strategy,
    outcome,
    grossAtoms:
      !OPEN.includes(String(r.status).toUpperCase()) &&
      r.stakeAtoms != null &&
      r.pnlAtoms != null
        ? String(BigInt(r.stakeAtoms) + BigInt(r.pnlAtoms))
        : null,
  };
}
