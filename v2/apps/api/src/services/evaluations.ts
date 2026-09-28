import { canonical, sha } from "../../../../packages/contracts/index";
import { probabilityMetrics, roi } from "../../../../packages/evaluation/index";
import { rows, one, stmt, uid, atomic } from "../repositories/db";
import { receipt, type Context } from "./commands";
export async function evaluate(c: Context, key: string, p: { asOf: string }) {
  const command = await receipt(c, "evaluate", key, p);
  if (command.old) {
    const old = await one(
      c.db,
      "SELECT * FROM evaluation_runs WHERE id=?",
      command.old.resultRef,
    );
    const count = await one(
      c.db,
      "SELECT COUNT(*) n FROM evaluation_samples WHERE evaluationId=?",
      old.id,
    );
    return {
      id: old.id,
      mode: old.mode,
      asOf: old.asOf,
      manifestHash: old.manifestHash,
      metrics: JSON.parse(old.metricsJson),
      sampleCount: count.n,
    };
  }
  if (typeof p.asOf !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(p.asOf))
    throw Error("TIMEZONE_REQUIRED");
  const asOf = Date.parse(p.asOf);
  if (!Number.isFinite(asOf) || asOf > c.now) throw Error("INVALID_AS_OF");
  const installation = await one(
    c.db,
    "SELECT mode FROM installations WHERE id=?",
    c.installationId,
  );
  const predictions = await rows(
    c.db,
    `SELECT p.*,r.fixtureId,s.protocolId,b.cutoffAt,a.id adjudicationId,a.state resultState,a.regulationJson FROM predictions p JOIN fixture_revisions r ON r.id=p.fixtureRevisionId JOIN observation_slots s ON s.id=p.slotId JOIN input_bundles b ON b.slotId=s.id LEFT JOIN result_adjudications a ON a.id=(SELECT result.id FROM result_adjudications result JOIN command_receipts receipt ON receipt.resultRef=result.id WHERE result.fixtureId=r.fixtureId AND receipt.committedAt<=? ORDER BY result.revision DESC LIMIT 1) WHERE p.calculatedAt<=? ORDER BY b.cutoffAt,p.id LIMIT 10001`,
    asOf,
    asOf,
  );
  if (predictions.length > 10000) throw Error("EVALUATION_CAPACITY_EXCEEDED");
  // The selection is fixed before presentation pagination; historical imports never enter this table.
  const samples: any[] = [];
  const byModel: Record<string, any[]> = {};
  const seen = new Set<string>();
  for (const prediction of predictions) {
    const key = canonical([
      prediction.fixtureId,
      prediction.protocolId,
      prediction.modelId,
    ]);
    let exclusion: string | null = null;
    let outcome: number | null = null;
    if (seen.has(key)) exclusion = "DUPLICATE_FIXTURE_PROTOCOL";
    else seen.add(key);
    if (prediction.resultState === "ACCEPTED_REGULATION") {
      const score = JSON.parse(prediction.regulationJson);
      outcome = score.home > score.away ? 0 : score.home === score.away ? 1 : 2;
    }
    const central = JSON.parse(prediction.centralJson);
    if (!exclusion) {
      (byModel[prediction.modelId] ||= []).push({ central, outcome });
      if (central === null) exclusion = "OUTPUT_UNSUPPORTED";
      else if (outcome === null) exclusion = "RESULT_MISSING_OR_REVIEW";
    }
    samples.push({
      predictionId: prediction.id,
      adjudicationId: prediction.adjudicationId || null,
      modelId: prediction.modelId,
      exclusion,
    });
  }
  const finance = await rows(
    c.db,
    `SELECT t.id,t.stakeAtoms,e.gross,e.kind,p.modelId FROM tickets t JOIN ticket_legs l ON l.ticketId=t.id JOIN predictions p ON p.id=l.predictionId JOIN settlement_events e ON e.ticketId=t.id WHERE t.createdAt<=? AND e.revision=(SELECT MAX(s.revision) FROM settlement_events s WHERE s.ticketId=t.id AND s.at<=?) AND e.kind IN('SETTLE','CORRECT') ORDER BY t.id LIMIT 10001`,
    asOf,
    asOf,
  );
  if (finance.length > 10000) throw Error("EVALUATION_CAPACITY_EXCEEDED");
  const metrics: Record<string, any> = {};
  for (const [id, values] of Object.entries(byModel)) {
    const tickets = finance.filter((f) => f.modelId === id),
      stake = tickets.reduce((n, f) => n + BigInt(f.stakeAtoms), 0n),
      profit = tickets.reduce(
        (n, f) => n + BigInt(f.gross) - BigInt(f.stakeAtoms),
        0n,
      );
    metrics[id] = {
      ...probabilityMetrics(values),
      settledTickets: tickets.length,
      settledStakeAtoms: stake.toString(),
      profitAtoms: profit.toString(),
      roi: roi(stake.toString(), profit.toString()),
      referenceClv: null,
      clvReason: "MATCHED_CLOSING_REFERENCE_MISSING",
    };
  }
  const manifestHash = await sha(
    canonical({
      mode: installation.mode,
      protocol: "FIRST_FIXTURE_PROTOCOL_ASOF_V1",
      asOf,
      samples,
      settlements: finance,
    }),
  );
  const id = uid();
  try {
    await atomic(
      c.db,
      [
        stmt(
          c.db,
          "INSERT INTO command_receipts VALUES(?,?,?,?,1,?,?)",
          uid(),
          command.scope,
          key,
          command.hash,
          id,
          c.now,
        ),
        stmt(
          c.db,
          "INSERT INTO evaluation_runs VALUES(?,?,?, ?,?,'COMPLETE',?,?)",
          id,
          installation.mode,
          "FIRST_FIXTURE_PROTOCOL_ASOF_V1",
          asOf,
          c.now,
          manifestHash,
          canonical(metrics),
        ),
        ...samples.map((s, i) =>
          stmt(
            c.db,
            "INSERT INTO evaluation_samples VALUES(?,?,?,?,?,?)",
            id,
            i,
            s.predictionId,
            s.adjudicationId,
            s.modelId,
            s.exclusion,
          ),
        ),
      ],
      c.failAt,
    );
  } catch (error) {
    const replay = await receipt(c, "evaluate", key, p);
    if (replay.old) return evaluate(c, key, p);
    throw error;
  }
  return {
    id,
    mode: installation.mode,
    asOf,
    manifestHash,
    metrics,
    sampleCount: samples.length,
  };
}
