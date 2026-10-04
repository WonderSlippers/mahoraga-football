import { rows } from "../repositories/db";
import type { Context } from "./commands";
import { selectedVersion, versionPolicy } from "./versions";
import {
  ledgerRows,
  summarizeRecords,
  rangeStart,
  localDay,
} from "./workspace";

// Money comes from settled original tickets, never from predictions or browser claims.
export async function strategyArena(c: Context, params: URLSearchParams) {
  const version = selectedVersion(params);
  const period = params.get("period") || "ALL";
  if (
    !["ALL", "TODAY", "YESTERDAY", "WEEK", "MONTH", "SEASON"].includes(period)
  )
    throw Error("INVALID_FILTER");
  const all = await ledgerRows(c.db, "PAPER_RESEARCH");
  const start = rangeStart(period, c.now);
  const inPeriod = (at: number | null) =>
    at != null &&
    at >= start &&
    (period !== "YESTERDAY" || at < rangeStart("TODAY", c.now));
  const policies = await rows(
    c.db,
    "SELECT pp.*,p.available,p.openStake,p.realized,p.initial FROM paper_policies pp JOIN portfolios p ON p.id=pp.portfolioId ORDER BY pp.rowid",
  );
  const strategies = policies
    .filter(
      (p) =>
        versionPolicy(p.id, version.id) &&
        ![
          "GENERAL_BROAD_PAPER_V1",
          "GENERAL_VALUE_PAPER_V1",
          "GENERAL_ASIAN_PAPER_V1",
        ].includes(p.strategyVersion),
    )
    .map((p: any): any => {
      const own = all.filter((r) => r.portfolio === p.portfolioId);
      const settled = own.filter(
        (r) => r.status === "SETTLED" && inPeriod(r.settledAt),
      );
      const metrics = summarizeRecords(settled);
      const open = own.filter((r) =>
        ["OPEN", "REVIEW", "REOPENED"].includes(r.status),
      );
      return {
        ...p,
        metrics,
        openN: open.length,
        placedN: own.filter((r) => inPeriod(r.at)).length,
        lifetimeN: own.length,
        lastTicketAt: own.length ? Math.max(...own.map((r) => r.at)) : null,
        category: /BROAD|FORCED|FUN/.test(p.strategyVersion)
          ? "BENCHMARK"
          : "VALUE",
        latest: own
          .sort((a, b) => b.at - a.at)
          .slice(0, 3)
          .map(({ raw, ...r }) => r),
      };
    });
  const currentIds = new Set(strategies.map((p) => p.portfolioId));
  const active = all.filter((r) => currentIds.has(r.portfolio));
  const settled = active.filter(
    (r) => r.status === "SETTLED" && inPeriod(r.settledAt),
  );
  const days = [...new Set(settled.map((r) => localDay(r.settledAt)))].sort();
  const automation = await rows(
    c.db,
    "SELECT enabled,lastSuccessAt,lastAttemptAt,stage,reason FROM automation_state",
  );
  return {
    version,
    asOf: c.now,
    period,
    accounting: {
      timeZone: "Europe/Berlin",
      basis: "收益按结算日；各策略独立账户，重叠票不可视为独立比赛",
    },
    summary: summarizeRecords(settled),
    firstPlacementAt: active.length
      ? Math.min(...active.map((r) => r.at))
      : null,
    openN: active.filter((r) =>
      ["OPEN", "REVIEW", "REOPENED"].includes(r.status),
    ).length,
    strategies,
    daily: days.map((day) => ({
      day,
      ...summarizeRecords(settled.filter((r) => localDay(r.settledAt) === day)),
    })),
    latest: active
      .sort((a, b) => b.at - a.at)
      .slice(0, 6)
      .map(({ raw, ...r }) => r),
    automation,
    legacyN: policies.filter((p) =>
      [
        "GENERAL_BROAD_PAPER_V1",
        "GENERAL_VALUE_PAPER_V1",
        "GENERAL_ASIAN_PAPER_V1",
      ].includes(p.strategyVersion),
    ).length,
  };
}
