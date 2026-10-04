import { multiplier, accountingDay } from "../../../../packages/domain";
import { summarizeRecords } from "./workspace";
import { researchScoreBand } from "../../../../packages/display";
export function scorePerformance(records: any[], now: number) {
  const summarize = (selected: any[]) => {
    const summary = summarizeRecords(selected);
    return {
      ...summary,
      profitAtoms: summary.settled ? summary.profitAtoms : null,
      hitRate:
        summary.wins + summary.losses
          ? summary.wins / (summary.wins + summary.losses)
          : null,
      neutral: selected.filter((r) =>
        ["VOID", "PUSH", "CANCELLED"].includes(
          r.outcome ?? String(r.status).toUpperCase(),
        ),
      ).length,
    };
  };
  const bands = [
    { grade: "A", range: "75–100" },
    { grade: "B", range: "60–74" },
    { grade: "C", range: "45–59" },
    { grade: "D", range: "0–44" },
    { grade: "UNKNOWN", range: "出票评分未记录 / 不可用" },
  ].map((band) => ({
    ...band,
    ...summarize(
      records.filter((r) => researchScoreBand(r.score).grade === band.grade),
    ),
  }));
  const exactScores = [
    ...new Set(records.map((r) => researchScoreBand(r.score).score)),
  ]
    .sort((a, b) => (b ?? -1) - (a ?? -1))
    .map((score) => ({
      score,
      grade: researchScoreBand(score).grade,
      ...summarize(
        records.filter((r) => researchScoreBand(r.score).score === score),
      ),
    }));
  return {
    bands,
    exactScores,
    asOf: now,
    tickets: records.length,
    attribution:
      "按出票时冻结评分；串关取最低一腿，任一腿缺评分归入未记录。整票盈亏只计一次，半赢/半输计入赢/输，未结不进入ROI分母。",
  };
}
export function reviewLedger(
  records: any[],
  now: number,
  strategies: any[] = [],
) {
  const groups = (key: string, get: (r: any) => string) =>
    [...new Set(records.map(get))].map((value) => ({
      value,
      ...summarizeRecords(records.filter((r) => get(r) === value)),
    }));
  const resolved = records.filter((r) =>
    ["WIN", "LOSS", "VOID", "SETTLED", "WON", "LOST"].includes(
      String(r.status).toUpperCase(),
    ),
  );
  const yesterday = new Date(
    Date.parse(accountingDay(now, "Asia/Shanghai", 8) + "T00:00:00Z") -
      86400000,
  )
    .toISOString()
    .slice(0, 10);
  const legs = resolved.flatMap((r) =>
    (r.raw?.legs || []).map((l: any, index: number) => ({
      ticketId: r.id,
      index,
      leg: l,
      stakeAtoms: r.stakeAtoms,
    })),
  );
  const failed = legs
    .filter((x) => String(x.leg.status).toUpperCase() === "LOSS")
    .map((x) => ({
      ticketId: x.ticketId,
      index: x.index,
      home: x.leg.home,
      away: x.leg.away,
      selection: x.leg.pickName ?? x.leg.pick,
      odds: x.leg.odds,
      score: x.leg.score,
      finalScore: x.leg.finalScore ?? null,
      reason: x.leg.rationale ?? [],
      alternatives: x.leg.alternatives ?? [],
    }));
  const bands = groups("score", (r) =>
    r.score == null
      ? "未知/非原始评分"
      : r.score >= 75
        ? "≥75"
        : r.score >= 60
          ? "60–74"
          : r.score >= 45
            ? "45–59"
            : "<45",
  );
  const calibration = Array.from({ length: 10 }, (_, i) => ({
    lower: i / 10,
    n: 0,
    predicted: 0,
    observed: 0,
  }));
  for (const { leg: l } of legs) {
    const p =
      l.evidence?.modelProbability ??
      l.goalEvidence?.modelProbability ??
      l.probability;
    if (
      typeof p !== "number" ||
      !Number.isFinite(p) ||
      p <= 0 ||
      p >= 1 ||
      !["win", "loss"].includes(String(l.status).toLowerCase())
    )
      continue;
    const b = calibration[Math.min(9, Math.floor(p * 10))];
    b.n++;
    b.predicted += p;
    b.observed += +(String(l.status).toLowerCase() === "win");
  }
  const uniqueFixtureIds = new Set(
    legs.map((x) => x.leg.matchId).filter(Boolean),
  );
  return {
    scope: "LEGACY_DESCRIPTIVE_NON_PROSPECTIVE",
    asOf: now,
    yesterday: {
      day: yesterday,
      ...summarizeRecords(
        resolved.filter(
          (r) =>
            r.settledAt &&
            accountingDay(r.settledAt, "Asia/Shanghai", 8) === yesterday,
        ),
      ),
    },
    yesterdayCreated: {
      day: yesterday,
      ...summarizeRecords(
        records.filter(
          (r) => r.at && accountingDay(r.at, "Asia/Shanghai", 8) === yesterday,
        ),
      ),
    },
    selectionTypes: groups("selection", (r) =>
      String(r.raw?.id ?? "").includes(":fill:") ||
      r.raw?.legs?.some(
        (l: any) =>
          Array.isArray(l.rationale) &&
          l.rationale.some((x: any) => String(x).includes("保底补位")),
      )
        ? "历史补位"
        : r.strategy === "all-singles"
          ? "广覆盖对照"
          : r.strategy === "forced-fun"
            ? "娱乐强制对照"
            : r.raw?.legs?.length &&
                r.raw.legs.every(
                  (l: any) => l.decisionVersion === "profit-guard-v4",
                )
              ? "原v4规则组（历史导入）"
              : r.raw?.legs?.length &&
                  r.raw.legs.every(
                    (l: any) => l.decisionVersion === "evidence-v3",
                  )
                ? "原v3规则组（历史导入）"
                : "历史规则未保存",
    ),
    oddsBands: groups("odds", (r) =>
      r.odds == null
        ? "赔率未记录"
        : r.odds < 1.6
          ? "<1.60"
          : r.odds < 2
            ? "1.60–1.99"
            : r.odds < 3
              ? "2.00–2.99"
              : r.odds < 5
                ? "3.00–4.99"
                : "≥5.00",
    ),
    strategies: [
      ...new Set([
        ...strategies.map((s) => s.id),
        ...records.map((r) => r.strategy),
      ]),
    ]
      .filter(Boolean)
      .map((value) => ({
        value: strategies.find((s) => s.id === value)?.name ?? value,
        id: value,
        ...summarizeRecords(records.filter((r) => r.strategy === value)),
      })),
    daily: [
      ...new Set(
        resolved
          .filter((r) => r.settledAt)
          .map((r) => accountingDay(r.settledAt, "Asia/Shanghai", 8)),
      ),
    ]
      .sort()
      .map((day) => ({
        day,
        strategies: [
          ...new Set([
            ...strategies.map((s) => s.id),
            ...records.map((r) => r.strategy),
          ]),
        ]
          .filter(Boolean)
          .map((id) => ({
            id,
            name: strategies.find((s) => s.id === id)?.name ?? id,
            ...summarizeRecords(
              resolved.filter(
                (r) =>
                  r.strategy === id &&
                  r.settledAt &&
                  accountingDay(r.settledAt, "Asia/Shanghai", 8) === day,
              ),
            ),
          })),
      })),
    months: groups("month", (r) =>
      r.settledAt
        ? accountingDay(r.settledAt, "Asia/Shanghai", 8).slice(0, 7)
        : "结算时间未知",
    ),
    leagues: groups(
      "league",
      (r) => [...r.leagues].sort().join(" / ") || "未知赛事",
    ),
    models: groups(
      "model",
      (r) => [...r.models].sort().join(" / ") || "模型未知",
    ),
    markets: groups(
      "market",
      (r) => [...r.markets].sort().join(" / ") || "市场未知",
    ),
    scoreBands: bands,
    failedLegs: failed,
    failedLegTotal: failed.length,
    calibration: calibration
      .filter((b) => b.n)
      .map((b) => ({
        ...b,
        predicted: b.predicted / b.n,
        observed: b.observed / b.n,
      })),
    sampling: {
      tickets: records.length,
      legs: legs.length,
      uniqueKnownFixtures: uniqueFixtureIds.size,
      missingFixtureId: legs.filter((x) => !x.leg.matchId).length,
      missingQuoteTime: legs.filter((x) => x.leg.priceCapturedAt == null)
        .length,
      missingModel: legs.filter(
        (x) =>
          !(
            x.leg.evidence?.modelVersion ??
            x.leg.goalEvidence?.modelVersion ??
            x.leg.modelVersion
          ),
      ).length,
      unscorable: records.filter((r) => r.score == null).length,
    },
    attribution:
      "含多个模型/联赛/市场的串关作为一个组合组；整票盈亏不分摊到单腿模型。",
  };
}
export function counterfactualTicket(
  raw: any,
  index: number,
  alternative: any,
): number | null {
  if (
    !Array.isArray(raw.legs) ||
    index < 0 ||
    index >= raw.legs.length ||
    typeof raw.stake !== "number" ||
    !Number.isFinite(raw.stake) ||
    raw.stake <= 0
  )
    return null;
  let product = 1;
  try {
    for (let i = 0; i < raw.legs.length; i++) {
      const original = raw.legs[i],
        selected = i === index ? alternative : original;
      if (original.status === "void") {
        product *= 1;
        continue;
      }
      const score = /^(\d+)\s*[-—–:：]\s*(\d+)$/.exec(
        String(original.finalScore ?? ""),
      );
      if (
        !score ||
        typeof selected.odds !== "number" ||
        !Number.isFinite(selected.odds) ||
        selected.odds <= 1
      )
        return null;
      const market = selected.market ?? original.market ?? "1x2",
        selection =
          market === "total"
            ? String(selected.side).toUpperCase()
            : market === "spread"
              ? ["home", "away"].includes(selected.side)
                ? String(selected.side).toUpperCase()
                : "UNKNOWN"
              : ["HOME", "DRAW", "AWAY"][Number(selected.pick)];
      if (
        !["1x2", "total", "spread"].includes(market) ||
        !selection ||
        selection === "UNKNOWN"
      )
        return null;
      const line = selected.line;
      if (
        market !== "1x2" &&
        (typeof line !== "number" || !Number.isInteger(line * 4))
      )
        return null;
      product *= Number(
        multiplier(
          {
            market:
              market === "1x2"
                ? "1X2"
                : market === "total"
                  ? "TOTAL_GOALS"
                  : "ASIAN_HANDICAP",
            selection,
            lineQ: market === "1x2" ? null : line * 4,
          },
          { home: Number(score[1]), away: Number(score[2]) },
          String(selected.odds),
        ),
      );
    }
    return Math.round(raw.stake * (product - 1) * 100) / 100;
  } catch {
    return null;
  }
}
export function savedCounterfactuals(raw: any) {
  return (Array.isArray(raw?.legs) ? raw.legs : []).flatMap(
    (leg: any, index: number) =>
      (Array.isArray(leg.alternatives) ? leg.alternatives : []).map(
        (alternative: any) => ({
          index,
          selection:
            alternative.pickName ??
            alternative.side ??
            alternative.pick ??
            "未知",
          odds: alternative.odds ?? null,
          market: alternative.market ?? leg.market ?? "1x2",
          line: alternative.line ?? null,
          hypotheticalProfit: counterfactualTicket(raw, index, alternative),
        }),
      ),
  );
}
