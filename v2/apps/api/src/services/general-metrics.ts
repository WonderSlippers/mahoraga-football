import { rows } from "../repositories/db";
import type { Context } from "./commands";
import {
  UNIVERSAL_ID,
  UNIVERSAL_MANIFEST,
} from "../../../../packages/domain/universal";
import { ledgerRows, summarizeRecords } from "./workspace";
import { marketBaseline } from "../../../../packages/domain";
import { studyMetrics, oddsBand } from "./study-metrics";

// One earliest pre-match snapshot per fixture; results only score frozen probabilities.
export async function generalMetrics(c: Context) {
  const frozen = await rows(
    c.db,
    `SELECT * FROM (
    SELECT o.outputJson,r.fixtureId,r.kickoffAt,b.cutoffAt,b.canonical,cat.competition,cat.season,a.state resultState,a.regulationJson,
    ROW_NUMBER() OVER(PARTITION BY r.fixtureId ORDER BY o.calculatedAt,o.id) n
    FROM universal_observations o JOIN fixture_revisions r ON r.id=o.fixtureRevisionId
    JOIN input_bundles b ON b.id=o.bundleId JOIN quote_sets q ON q.id=b.quoteSetId
    LEFT JOIN fixture_catalog cat ON cat.fixtureId=r.fixtureId
    LEFT JOIN result_adjudications a ON a.fixtureId=r.fixtureId AND a.revision=(SELECT MAX(x.revision) FROM result_adjudications x WHERE x.fixtureId=r.fixtureId)
    WHERE o.state='DONE' AND json_extract(o.outputJson,'$.variant')=? AND o.calculatedAt<r.kickoffAt AND b.cutoffAt<r.kickoffAt AND q.observedAt<=b.cutoffAt
    ) WHERE n=1`,
    UNIVERSAL_ID,
  );
  const samples = frozen
    .filter((r) => r.resultState === "ACCEPTED_REGULATION")
    .map((r) => {
      const result = JSON.parse(r.regulationJson),
        output = JSON.parse(r.outputJson),
        input = JSON.parse(r.canonical);
      return {
        fixtureId: r.fixtureId,
        date: new Date(r.kickoffAt).toISOString(),
        competition: r.competition,
        season: r.season,
        marketOdds: input.odds.map(Number),
        central: output.central,
        baseline: marketBaseline(input.odds),
        outcome:
          result.home > result.away ? 0 : result.home === result.away ? 1 : 2,
        action: "NO_ACTION",
      };
    });
  const probability = studyMetrics(samples, frozen.length);
  const baseline = studyMetrics(
    samples.map((r) => ({ ...r, central: r.baseline })),
    frozen.length,
  );
  const policies = await rows(
    c.db,
    "SELECT * FROM paper_policies ORDER BY CASE WHEN strategyVersion LIKE '%V1' THEN 1 ELSE 0 END,rowid",
  );
  const records = await ledgerRows(c.db, "PAPER_RESEARCH");
  const byStrategy = policies.map((p) => ({
    ...p,
    metrics: summarizeRecords(
      records.filter((r) => r.portfolio === p.portfolioId),
    ),
  }));
  const groups = (key: string) =>
    [
      ...new Set(
        samples.map((s: any) =>
          key === "odds"
            ? oddsBand(Math.min(...s.marketOdds))
            : String(s[key] ?? "UNKNOWN"),
        ),
      ),
    ]
      .sort()
      .map((value) => {
        const selected = samples.filter(
          (s: any) =>
            (key === "odds"
              ? oddsBand(Math.min(...s.marketOdds))
              : String(s[key] ?? "UNKNOWN")) === value,
        );
        return {
          key: value,
          N: selected.length,
          model: studyMetrics(selected, selected.length),
          baseline: studyMetrics(
            selected.map((s) => ({ ...s, central: s.baseline })),
            selected.length,
          ),
        };
      });
  return {
    manifest: UNIVERSAL_MANIFEST,
    asOf: c.now,
    scope: "FIRST_FROZEN_PREMATCH_WITH_ACCEPTED_REGULATION",
    populationN: frozen.length,
    firstCutoffAt: frozen.length
      ? Math.min(...frozen.map((r) => r.cutoffAt))
      : null,
    lastCutoffAt: frozen.length
      ? Math.max(...frozen.map((r) => r.cutoffAt))
      : null,
    probability,
    baseline,
    byStrategy,
    bySeason: groups("season"),
    byLeague: groups("competition"),
    byOdds: groups("odds"),
    limits: [
      "历史友谊赛验证不等于通用实时盈利验证",
      "概率比较使用同一批已核验90分钟赛果",
      "资金指标分策略，初版已暂停账户仍保留历史",
      "参考价纸面记录，不是真实成交",
    ],
  };
}
