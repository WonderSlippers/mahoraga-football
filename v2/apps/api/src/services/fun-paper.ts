import { rows, stmt, uid, atomic } from "../repositories/db";
import type { Context } from "./commands";
export const FUN_DOUBLE = {
  id: "general-fun-double-v1",
  version: "GENERAL_FUN_DOUBLE_PAPER_V1",
  portfolio: "paper:general-fun-double-v1",
};
// Independent entertainment policy. Original model/value decisions stay frozen.
export async function prepareFunDouble(c: Context) {
  await atomic(c.db, [
    stmt(
      c.db,
      "INSERT OR IGNORE INTO portfolios VALUES(?,'PAPER_RESEARCH',0,10000000000,0,0,10000000000,0)",
      FUN_DOUBLE.portfolio,
    ),
    stmt(
      c.db,
      "INSERT OR IGNORE INTO paper_policies VALUES(?,?,?,?,1,5,0)",
      FUN_DOUBLE.id,
      FUN_DOUBLE.portfolio,
      "娱乐二串一对照",
      FUN_DOUBLE.version,
    ),
  ]);
  const enabled = await stmt(
    c.db,
    "SELECT enabled FROM paper_policies WHERE id=?",
    FUN_DOUBLE.id,
  ).first<any>();
  if (!enabled?.enabled) return;
  const choices = await rows(
    c.db,
    `WITH eligible AS MATERIALIZED (SELECT e.*,r.fixtureId,d.decidedAt,d.strategyVersion FROM decisions d JOIN market_expectations e ON e.id=d.expectationId
    JOIN predictions p ON p.id=e.predictionId JOIN fixture_revisions r ON r.id=p.fixtureRevisionId JOIN fixtures f ON f.id=r.fixtureId
    JOIN quote_selections qs ON qs.id=e.quoteSelectionId JOIN quote_sets q ON q.id=qs.quoteSetId
    WHERE d.strategyVersion='GENERAL_BROAD_PAPER_V2' AND d.accepted=1 AND f.status='SCHEDULED' AND f.currentRevision=r.revision
    AND r.kickoffAt>? AND r.kickoffAt<=? AND q.observedAt>=? AND q.observedAt<=? AND q.suspended=0)
    SELECT e.* FROM eligible e WHERE e.decidedAt=(SELECT MAX(d2.decidedAt) FROM decisions d2 JOIN market_expectations e2 ON e2.id=d2.expectationId JOIN predictions p2 ON p2.id=e2.predictionId JOIN fixture_revisions r2 ON r2.id=p2.fixtureRevisionId WHERE r2.fixtureId=e.fixtureId AND d2.strategyVersion=e.strategyVersion)
    AND NOT EXISTS(SELECT 1 FROM market_expectations x WHERE x.predictionId=e.predictionId AND x.quoteSelectionId=e.quoteSelectionId AND x.pricingVersion='GENERAL_FUN_DOUBLE_PAPER_V1')`,
    c.now + 600000,
    c.now + 86400000,
    c.now - 600000,
    c.now,
  );
  for (const e of choices) {
    const id = uid();
    await atomic(c.db, [
      stmt(
        c.db,
        "INSERT INTO market_expectations VALUES(?,?,?,?,?,?,?)",
        id,
        e.predictionId,
        e.quoteSelectionId,
        e.expectedReturn,
        e.ev,
        e.probability,
        FUN_DOUBLE.version,
      ),
      stmt(
        c.db,
        "INSERT INTO decisions VALUES(?,?,1,'PAPER_ENTERTAINMENT_NOT_VALUE',?,?)",
        uid(),
        id,
        c.now,
        FUN_DOUBLE.version,
      ),
    ]);
  }
}
export function frozenPaperPlan(output: any, decision: any, policyId: string) {
  return policyId === FUN_DOUBLE.id
    ? output.plans.find(
        (p: any) =>
          p.policyId === "general-v2-all-singles" &&
          p.accepted &&
          p.odds === decision.decimalOdds &&
          p.selection === decision.selection &&
          decision.reason === "PAPER_ENTERTAINMENT_NOT_VALUE" &&
          decision.ev === p.estimatedEV,
      )
    : output.plans.find((p: any) => p.decisionId === decision.id);
}
