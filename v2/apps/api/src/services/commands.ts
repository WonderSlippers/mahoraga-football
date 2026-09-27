import { canonical, sha } from "../../../../packages/contracts/index";
import { atoms, gross, accountingDay } from "../../../../packages/domain/index";
import { stmt, one, rows, uid, atomic } from "../repositories/db";
export type Context = {
  db: D1Database;
  installationId: string;
  now: number;
  failAt?: number;
};
export async function receipt(
  c: Context,
  scope: string,
  key: string,
  payload: unknown,
) {
  if (payload && typeof payload === "object" && "expectedRevision" in payload) {
    const revision = (payload as { expectedRevision: unknown })
      .expectedRevision;
    if (
      typeof revision !== "number" ||
      !Number.isSafeInteger(revision) ||
      revision < 0
    )
      throw new Error("REVISION_INVALID");
  }
  if (!key || key.length > 120) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
  const hash = await sha(canonical(payload));
  const old = await stmt(
    c.db,
    "SELECT * FROM command_receipts WHERE scope=? AND idempotencyKey=?",
    c.installationId + ":" + scope,
    key,
  ).first<any>();
  if (old && old.requestHash !== hash) throw new Error("IDEMPOTENCY_CONFLICT");
  return { hash, old, scope: c.installationId + ":" + scope };
}
export async function place(
  c: Context,
  key: string,
  p: {
    decisionId: string;
    portfolioId: string;
    stakeAtoms: string;
    expectedRevision: number;
  },
) {
  const r = await receipt(c, "place", key, p);
  if (r.old) return { id: r.old.resultRef };
  const stake = Number(atoms(p.stakeAtoms, true));
  const d = await one(
    c.db,
    `SELECT d.*,e.ev,e.predictionId,e.quoteSelectionId,q.decimalOdds,q.selection,qs.observedAt,qs.suspended,pr.fixtureRevisionId,fr.kickoffAt,f.status FROM decisions d JOIN market_expectations e ON e.id=d.expectationId JOIN quote_selections q ON q.id=e.quoteSelectionId JOIN quote_sets qs ON qs.id=q.quoteSetId JOIN predictions pr ON pr.id=e.predictionId JOIN fixture_revisions fr ON fr.id=pr.fixtureRevisionId JOIN fixtures f ON f.id=fr.fixtureId WHERE d.id=?`,
    p.decisionId,
  );
  if (!d.accepted) throw new Error(d.reason);
  if (d.observedAt > c.now) throw new Error("QUOTE_TIME_IN_FUTURE");
  if (c.now - d.observedAt > 600000) throw new Error("QUOTE_STALE");
  if (c.now >= d.kickoffAt || d.status !== "SCHEDULED")
    throw new Error("KICKOFF_PASSED");
  if (d.suspended) throw new Error("QUOTE_SUSPENDED");
  const id = uid(),
    cmd = uid();
  const list = [
    stmt(
      c.db,
      `INSERT INTO command_receipts VALUES(?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM portfolios WHERE id=? AND revision=? AND available>=? AND frozen=0 AND mode='DEMO') AND EXISTS(SELECT 1 FROM fixtures f JOIN fixture_revisions r ON r.fixtureId=f.id WHERE r.id=? AND f.status='SCHEDULED' AND f.currentRevision=r.revision) THEN 1 ELSE 0 END,?,?)`,
      cmd,
      r.scope,
      key,
      r.hash,
      p.portfolioId,
      p.expectedRevision,
      stake,
      d.fixtureRevisionId,
      id,
      c.now,
    ),
    stmt(
      c.db,
      "INSERT INTO tickets VALUES(?,?,?,?,?,?,?,?)",
      id,
      p.portfolioId,
      p.decisionId,
      stake,
      c.now,
      p.decisionId,
      accountingDay(c.now, "Asia/Shanghai"),
      "DEMO",
    ),
    stmt(
      c.db,
      "INSERT INTO ticket_legs VALUES(?,?,?,?,?,?,?,?)",
      uid(),
      id,
      d.fixtureRevisionId,
      d.quoteSelectionId,
      d.predictionId,
      d.decimalOdds,
      d.selection,
      canonical({
        market: "1X2",
        selection: d.selection,
        lineQ: null,
        scope: "REGULATION_90",
      }),
    ),
    stmt(c.db, "INSERT INTO ticket_state VALUES(?,0,'OPEN',0,NULL)", id),
    stmt(
      c.db,
      "INSERT INTO ledger_entries VALUES(?,?,?,?,NULL,'PLACE',?,?,0)",
      uid(),
      p.portfolioId,
      cmd,
      id,
      -stake,
      stake,
    ),
    stmt(
      c.db,
      "UPDATE portfolios SET available=available-?,openStake=openStake+?,revision=revision+1 WHERE id=?",
      stake,
      stake,
      p.portfolioId,
    ),
  ];
  try {
    await atomic(c.db, list, c.failAt);
  } catch {
    const again = await receipt(c, "place", key, p);
    if (again.old) return { id: again.old.resultRef };
    if (
      await stmt(
        c.db,
        "SELECT id FROM tickets WHERE portfolioId=? AND businessKey=?",
        p.portfolioId,
        p.decisionId,
      ).first()
    )
      throw new Error("DUPLICATE_BUSINESS_ACTION");
    throw new Error("REVISION_CONFLICT");
  }
  return { id };
}
export async function settle(
  c: Context,
  key: string,
  p: { ticketId: string; adjudicationId: string; expectedRevision: number },
) {
  const r = await receipt(c, "settle", key, p);
  if (r.old) return { id: r.old.resultRef };
  const t = await one(
    c.db,
    "SELECT t.*,l.fixtureRevisionId,l.frozenOdds,l.marketSpecJson,s.currentStatus,s.gross,s.revision AS ticketRevision,s.currentSettlementId FROM tickets t JOIN ticket_legs l ON l.ticketId=t.id JOIN ticket_state s ON s.ticketId=t.id WHERE t.id=?",
    p.ticketId,
  );
  const a = await one(
    c.db,
    "SELECT * FROM result_adjudications WHERE id=?",
    p.adjudicationId,
  );
  const fr = await one(
    c.db,
    "SELECT * FROM fixture_revisions WHERE id=?",
    t.fixtureRevisionId,
  );
  if (a.fixtureId !== fr.fixtureId) throw new Error("MARKET_MISMATCH");
  const duplicate = await stmt(
    c.db,
    "SELECT id FROM settlement_events WHERE ticketId=? AND adjudicationId=?",
    p.ticketId,
    p.adjudicationId,
  ).first<any>();
  if (duplicate) return { id: duplicate.id };
  const terminal = ["ACCEPTED_REGULATION", "VOID_BY_RULE"].includes(a.state);
  const was = t.currentStatus === "SETTLED";
  const nextGross = terminal
    ? a.state === "VOID_BY_RULE"
      ? t.stakeAtoms
      : Number(
          gross(
            String(t.stakeAtoms),
            JSON.parse(t.marketSpecJson),
            JSON.parse(a.regulationJson),
            t.frozenOdds,
          ),
        )
    : 0;
  const delta = nextGross - (was ? t.gross : 0);
  const openDelta = terminal
    ? was
      ? 0
      : -t.stakeAtoms
    : was
      ? t.stakeAtoms
      : 0;
  const profitDelta = delta + openDelta;
  const id = uid(),
    cmd = uid();
  const list = [
    stmt(
      c.db,
      `INSERT INTO command_receipts VALUES(?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM portfolios WHERE id=? AND revision=?) AND EXISTS(SELECT 1 FROM ticket_state WHERE ticketId=? AND revision=?) AND ?=(SELECT MAX(revision) FROM result_adjudications WHERE fixtureId=?) THEN 1 ELSE 0 END,?,?)`,
      cmd,
      r.scope,
      key,
      r.hash,
      t.portfolioId,
      p.expectedRevision,
      t.id,
      t.ticketRevision,
      a.revision,
      a.fixtureId,
      id,
      c.now,
    ),
    stmt(
      c.db,
      "INSERT INTO settlement_events VALUES(?,?,?,?,?,?,?,?,?,?)",
      id,
      t.id,
      t.ticketRevision + 1,
      terminal ? (was ? "CORRECT" : "SETTLE") : was ? "REOPEN" : "REVIEW",
      a.id,
      t.currentSettlementId,
      nextGross,
      delta,
      c.now,
      "RETURN_V1_HALF_UP_6",
    ),
    stmt(
      c.db,
      "INSERT INTO ledger_entries VALUES(?,?,?,?,?,?,?,?,?)",
      uid(),
      t.portfolioId,
      cmd,
      t.id,
      id,
      terminal ? "SETTLE" : "REOPEN",
      delta,
      openDelta,
      profitDelta,
    ),
    stmt(
      c.db,
      "UPDATE ticket_state SET revision=revision+1,currentStatus=?,gross=?,currentSettlementId=? WHERE ticketId=?",
      terminal ? "SETTLED" : "REVIEW",
      nextGross,
      id,
      t.id,
    ),
    stmt(
      c.db,
      "UPDATE portfolios SET available=available+?,openStake=openStake+?,realized=realized+?,revision=revision+1,frozen=CASE WHEN available+?<0 THEN 1 ELSE 0 END WHERE id=?",
      delta,
      openDelta,
      profitDelta,
      delta,
      t.portfolioId,
    ),
  ];
  try {
    await atomic(c.db, list, c.failAt);
  } catch {
    const again = await receipt(c, "settle", key, p);
    if (again.old) return { id: again.old.resultRef };
    throw new Error("REVISION_CONFLICT");
  }
  return { id };
}
export async function summary(db: D1Database, id: string) {
  const p = await one(db, "SELECT * FROM portfolios WHERE id=?", id);
  const s = await one(
    db,
    "SELECT COALESCE(SUM(CASE WHEN s.currentStatus='SETTLED' THEN t.stakeAtoms ELSE 0 END),0) AS settledStake,COUNT(*) AS tickets FROM tickets t JOIN ticket_state s ON s.ticketId=t.id WHERE t.portfolioId=?",
    id,
  );
  return {
    ...p,
    revision: p.revision as number,
    frozen: p.frozen as number,
    available: String(p.available),
    openStake: String(p.openStake),
    realized: String(p.realized),
    initial: String(p.initial),
    settledStake: String(s.settledStake),
    tickets: s.tickets,
    roi: s.settledStake ? p.realized / s.settledStake : null,
  };
}
