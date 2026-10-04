import { canonical, sha } from "../../../../packages/contracts/index";
import { atoms, gross, accountingDay } from "../../../../packages/domain/index";
import { stmt, one, rows, uid, atomic } from "../repositories/db";
import Decimal from "decimal.js";
import { multiplier } from "../../../../packages/domain";
import { frozenPaperPlan, FUN_DOUBLE } from "./fun-paper";
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
  secondDecisionId?: string,
) {
  const payload = secondDecisionId ? { ...p, secondDecisionId } : p;
  const r = await receipt(c, "place", key, payload);
  if (r.old) return { id: r.old.resultRef };
  const stake = Number(atoms(p.stakeAtoms, true));
  const d = await one(
    c.db,
    `SELECT d.*,e.ev,e.predictionId,e.quoteSelectionId,q.decimalOdds,q.selection,qs.observedAt,qs.suspended,pr.modelId,pr.fixtureRevisionId,fr.fixtureId,fr.kickoffAt,f.status FROM decisions d JOIN market_expectations e ON e.id=d.expectationId JOIN quote_selections q ON q.id=e.quoteSelectionId JOIN quote_sets qs ON qs.id=q.quoteSetId JOIN predictions pr ON pr.id=e.predictionId JOIN fixture_revisions fr ON fr.id=pr.fixtureRevisionId JOIN fixtures f ON f.id=fr.fixtureId WHERE d.id=?`,
    p.decisionId,
  );
  const secondary = secondDecisionId
    ? await one(
        c.db,
        `SELECT d.*,e.ev,e.predictionId,e.quoteSelectionId,q.decimalOdds,q.selection,qs.observedAt,qs.suspended,pr.modelId,pr.fixtureRevisionId,fr.fixtureId,fr.kickoffAt,f.status FROM decisions d JOIN market_expectations e ON e.id=d.expectationId JOIN quote_selections q ON q.id=e.quoteSelectionId JOIN quote_sets qs ON qs.id=q.quoteSetId JOIN predictions pr ON pr.id=e.predictionId JOIN fixture_revisions fr ON fr.id=pr.fixtureRevisionId JOIN fixtures f ON f.id=fr.fixtureId WHERE d.id=?`,
        secondDecisionId,
      )
    : null;
  if (!d.accepted) throw new Error(d.reason);
  if (d.observedAt > c.now) throw new Error("QUOTE_TIME_IN_FUTURE");
  if (c.now - d.observedAt > 600000) throw new Error("QUOTE_STALE");
  if (c.now >= d.kickoffAt || d.status !== "SCHEDULED")
    throw new Error("KICKOFF_PASSED");
  if (d.suspended) throw new Error("QUOTE_SUSPENDED");
  const portfolio = await one(
    c.db,
    "SELECT * FROM portfolios WHERE id=?",
    p.portfolioId,
  );
  const installation = await one(
    c.db,
    "SELECT mode FROM installations WHERE id=?",
    c.installationId,
  );
  const paper = portfolio.mode === "PAPER_RESEARCH";
  if (secondary && !paper) throw Error("MODE_MISMATCH");
  if (
    paper
      ? installation.mode !== "LOCAL_RESEARCH"
      : installation.mode !== "DEMO"
  )
    throw Error("MODE_MISMATCH");
  let marketSpec: any = {
    market: "1X2",
    selection: d.selection,
    lineQ: null,
    scope: "REGULATION_90",
  };
  const legs: any[] = [{ ...d, marketSpec }];
  let maximum = 100,
    policyId = "",
    businessKey = p.decisionId;
  if (paper) {
    const policy = await one(
      c.db,
      "SELECT * FROM paper_policies WHERE portfolioId=?",
      p.portfolioId,
    );
    if (!policy.enabled) throw Error("POLICY_PAUSED");
    const latestJob = await stmt(
      c.db,
      "SELECT j.state FROM jobs j JOIN input_bundles b ON b.id=j.bundleId JOIN observation_slots s ON s.id=b.slotId JOIN fixture_revisions r ON r.id=s.fixtureRevisionId WHERE r.fixtureId=? AND j.modelId=? ORDER BY b.cutoffAt DESC,j.rowid DESC LIMIT 1",
      d.fixtureId,
      d.modelId,
    ).first<any>();
    if (latestJob?.state === "FAILED" || latestJob?.state === "BLOCKED")
      throw Error("MODEL_CURRENTLY_FAILED");
    if (
      ["general-v2-double", FUN_DOUBLE.id].includes(policy.id) !== !!secondary
    )
      throw Error("PAPER_POLICY_MISMATCH");
    if (
      d.modelId !== "GENERAL_FOOTBALL_RESEARCH_V2" ||
      d.strategyVersion !== policy.strategyVersion ||
      stake !== 20000000
    )
      throw Error("PAPER_POLICY_MISMATCH");
    if (c.now < d.kickoffAt - 86400000 || c.now > d.kickoffAt - 600000)
      throw Error("KICKOFF_PASSED");
    const observed = await one(
      c.db,
      "SELECT outputJson FROM universal_observations WHERE predictionId=?",
      d.predictionId,
    );
    const plan = frozenPaperPlan(JSON.parse(observed.outputJson), d, policy.id);
    if (
      !plan ||
      !plan.accepted ||
      plan.odds !== d.decimalOdds ||
      plan.selection !== d.selection
    )
      throw Error("PAPER_POLICY_MISMATCH");
    if (
      ![
        "general-v2-all-singles",
        "general-v2-forced-fun",
        FUN_DOUBLE.id,
      ].includes(policy.id) &&
      (!plan.qualified || d.ev < 0.08)
    )
      throw Error("PAPER_POLICY_MISMATCH");
    marketSpec = {
      market: plan.market,
      selection: plan.selection,
      lineQ: plan.lineQ,
      scope: "REGULATION_90",
    };
    legs[0].marketSpec = marketSpec;
    if (secondary) {
      const latestOther = await stmt(
        c.db,
        "SELECT j.state FROM jobs j JOIN input_bundles b ON b.id=j.bundleId JOIN observation_slots s ON s.id=b.slotId JOIN fixture_revisions r ON r.id=s.fixtureRevisionId WHERE r.fixtureId=? AND j.modelId=? ORDER BY b.cutoffAt DESC,j.rowid DESC LIMIT 1",
        secondary.fixtureId,
        secondary.modelId,
      ).first<any>();
      if (latestOther?.state === "FAILED" || latestOther?.state === "BLOCKED")
        throw Error("MODEL_CURRENTLY_FAILED");
      const otherObservation = await one(
        c.db,
        "SELECT outputJson FROM universal_observations WHERE predictionId=?",
        secondary.predictionId,
      );
      const otherPlan = frozenPaperPlan(
        JSON.parse(otherObservation.outputJson),
        secondary,
        policy.id,
      );
      const leagueA =
        policy.id === FUN_DOUBLE.id
          ? { competition: null }
          : await one(
              c.db,
              "SELECT competition FROM fixture_catalog WHERE fixtureId=?",
              d.fixtureId,
            );
      const leagueB =
        policy.id === FUN_DOUBLE.id
          ? { competition: null }
          : await one(
              c.db,
              "SELECT competition FROM fixture_catalog WHERE fixtureId=?",
              secondary.fixtureId,
            );
      if (
        !secondary.accepted ||
        secondary.modelId !== d.modelId ||
        secondary.strategyVersion !== policy.strategyVersion ||
        !otherPlan?.accepted ||
        (policy.id !== FUN_DOUBLE.id && !otherPlan.qualified) ||
        otherPlan.odds !== secondary.decimalOdds ||
        otherPlan.selection !== secondary.selection ||
        (policy.id !== FUN_DOUBLE.id &&
          (secondary.ev < 0.08 ||
            [plan, otherPlan].some(
              (x) =>
                x.market !== "1X2" ||
                x.conservativeProbability < 0.5 ||
                Number(x.odds) > 2.5,
            ) ||
            leagueA.competition === leagueB.competition ||
            Math.abs(d.kickoffAt - secondary.kickoffAt) < 12 * 3600000)) ||
        d.fixtureId === secondary.fixtureId ||
        [plan, otherPlan].some((x) => x.market !== "1X2")
      )
        throw Error("DOUBLE_LEGS_NOT_DIVERSIFIED");
      if (
        secondary.observedAt > c.now ||
        c.now - secondary.observedAt > 600000 ||
        secondary.suspended
      )
        throw Error("QUOTE_STALE");
      if (
        secondary.status !== "SCHEDULED" ||
        c.now < secondary.kickoffAt - 86400000 ||
        c.now >= secondary.kickoffAt - 600000
      )
        throw Error("KICKOFF_PASSED");
      legs.push({
        ...secondary,
        marketSpec: {
          market: otherPlan.market,
          selection: otherPlan.selection,
          lineQ: otherPlan.lineQ,
          scope: "REGULATION_90",
        },
      });
    }
    maximum = policy.maximumPerDay;
    policyId = policy.id;
    businessKey = [
      legs
        .map((l) => l.fixtureId)
        .sort()
        .join("+"),
      d.modelId,
      d.strategyVersion,
      ...(policy.id === "general-v2-forced-fun" ? [marketSpec.market] : []),
    ].join("|");
    if (
      secondary &&
      (await stmt(
        c.db,
        "SELECT t.id FROM tickets t JOIN ticket_legs l ON l.ticketId=t.id JOIN fixture_revisions r ON r.id=l.fixtureRevisionId WHERE t.portfolioId=? AND r.fixtureId IN(?,?)",
        p.portfolioId,
        d.fixtureId,
        secondary.fixtureId,
      ).first())
    )
      throw Error("DUPLICATE_BUSINESS_ACTION");
    if (
      await stmt(
        c.db,
        "SELECT id FROM tickets WHERE portfolioId=? AND businessKey=?",
        p.portfolioId,
        businessKey,
      ).first()
    )
      throw Error("DUPLICATE_BUSINESS_ACTION");
    if (
      (
        await one(
          c.db,
          "SELECT COUNT(*) n FROM tickets WHERE portfolioId=? AND placementDay=?",
          p.portfolioId,
          accountingDay(c.now, "Europe/Berlin"),
        )
      ).n >= maximum
    )
      throw Error("DAILY_LIMIT");
  }
  const placementDay = accountingDay(
    c.now,
    paper ? "Europe/Berlin" : "Asia/Shanghai",
  );
  const id = uid(),
    cmd = uid();
  const list = [
    stmt(
      c.db,
      `INSERT INTO command_receipts VALUES(?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM portfolios WHERE id=? AND revision=? AND available>=? AND frozen=0 AND mode=?) AND EXISTS(SELECT 1 FROM fixtures f JOIN fixture_revisions r ON r.fixtureId=f.id WHERE r.id=? AND f.status='SCHEDULED' AND f.currentRevision=r.revision AND r.kickoffAt>?) AND (?=0 OR EXISTS(SELECT 1 FROM paper_policies WHERE id=? AND enabled=1 AND maximumPerDay=? AND (SELECT COUNT(*) FROM tickets WHERE portfolioId=? AND placementDay=?)<maximumPerDay)) ${secondary ? "AND EXISTS(SELECT 1 FROM fixtures f JOIN fixture_revisions r ON r.fixtureId=f.id WHERE r.id=? AND f.status='SCHEDULED' AND f.currentRevision=r.revision AND r.kickoffAt>?) AND NOT EXISTS(SELECT 1 FROM tickets t JOIN ticket_legs l ON l.ticketId=t.id JOIN fixture_revisions fr ON fr.id=l.fixtureRevisionId WHERE t.portfolioId=? AND fr.fixtureId IN(?,?))" : ""} ${paper ? legs.map(() => "AND COALESCE((SELECT j.state FROM jobs j JOIN input_bundles b ON b.id=j.bundleId JOIN observation_slots s ON s.id=b.slotId JOIN fixture_revisions fr ON fr.id=s.fixtureRevisionId WHERE fr.fixtureId=? AND j.modelId=? ORDER BY b.cutoffAt DESC,j.rowid DESC LIMIT 1),'BLOCKED') NOT IN('FAILED','BLOCKED')").join(" ") : ""} THEN 1 ELSE 0 END,?,?)`,
      cmd,
      r.scope,
      key,
      r.hash,
      p.portfolioId,
      p.expectedRevision,
      stake,
      portfolio.mode,
      d.fixtureRevisionId,
      c.now,
      paper ? 1 : 0,
      policyId,
      maximum,
      p.portfolioId,
      placementDay,
      ...(secondary
        ? [
            secondary.fixtureRevisionId,
            c.now + 600000,
            p.portfolioId,
            d.fixtureId,
            secondary.fixtureId,
          ]
        : []),
      ...(paper ? legs.flatMap((leg) => [leg.fixtureId, leg.modelId]) : []),
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
      businessKey,
      placementDay,
      portfolio.mode,
    ),
    ...legs.map((leg) =>
      stmt(
        c.db,
        "INSERT INTO ticket_legs VALUES(?,?,?,?,?,?,?,?)",
        uid(),
        id,
        leg.fixtureRevisionId,
        leg.quoteSelectionId,
        leg.predictionId,
        leg.decimalOdds,
        leg.selection,
        canonical(leg.marketSpec),
      ),
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
    const again = await receipt(c, "place", key, payload);
    if (again.old) return { id: again.old.resultRef };
    if (
      await stmt(
        c.db,
        "SELECT id FROM tickets WHERE portfolioId=? AND businessKey=?",
        p.portfolioId,
        businessKey,
      ).first()
    )
      throw new Error("DUPLICATE_BUSINESS_ACTION");
    throw new Error("REVISION_CONFLICT");
  }
  return { id };
}
export async function placeDouble(
  c: Context,
  key: string,
  p: { decisionIds: string[]; portfolioId: string; expectedRevision: number },
) {
  if (
    !Array.isArray(p.decisionIds) ||
    p.decisionIds.length !== 2 ||
    new Set(p.decisionIds).size !== 2
  )
    throw Error("DOUBLE_LEGS_INVALID");
  return place(
    c,
    key,
    {
      decisionId: p.decisionIds[0],
      portfolioId: p.portfolioId,
      stakeAtoms: "20000000",
      expectedRevision: p.expectedRevision,
    },
    p.decisionIds[1],
  );
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
    "SELECT t.*,s.currentStatus,s.gross,s.revision AS ticketRevision,s.currentSettlementId FROM tickets t JOIN ticket_state s ON s.ticketId=t.id WHERE t.id=?",
    p.ticketId,
  );
  const a = await one(
    c.db,
    "SELECT * FROM result_adjudications WHERE id=?",
    p.adjudicationId,
  );
  const legs = await rows(
    c.db,
    "SELECT l.*,r.fixtureId FROM ticket_legs l JOIN fixture_revisions r ON r.id=l.fixtureRevisionId WHERE l.ticketId=?",
    t.id,
  );
  if (!legs.some((l) => a.fixtureId === l.fixtureId))
    throw new Error("MARKET_MISMATCH");
  const duplicate = await stmt(
    c.db,
    "SELECT id FROM settlement_events WHERE ticketId=? AND adjudicationId=?",
    p.ticketId,
    p.adjudicationId,
  ).first<any>();
  if (duplicate) {
    // A business no-op still consumes its request key. Otherwise that same key
    // could later be reused with a different adjudication and move money.
    try {
      await atomic(
        c.db,
        [
          stmt(
            c.db,
            "INSERT INTO command_receipts VALUES(?,?,?,?,1,?,?)",
            uid(),
            r.scope,
            key,
            r.hash,
            duplicate.id,
            c.now,
          ),
        ],
        c.failAt,
      );
    } catch (error) {
      const replay = await receipt(c, "settle", key, p);
      if (!replay.old) throw error;
    }
    return { id: duplicate.id };
  }
  const latest = await Promise.all(
    legs.map((l) =>
      stmt(
        c.db,
        "SELECT * FROM result_adjudications WHERE fixtureId=? ORDER BY revision DESC LIMIT 1",
        l.fixtureId,
      ).first<any>(),
    ),
  );
  const terminal = latest.every(
    (result) =>
      result && ["ACCEPTED_REGULATION", "VOID_BY_RULE"].includes(result.state),
  );
  const needsReview =
    legs.length === 1 || latest.some((result) => result?.state === "REVIEW");
  const was = t.currentStatus === "SETTLED";
  const returnFactor = terminal
    ? legs.reduce<Decimal>(
        (factor, leg, i) =>
          latest[i]!.state === "VOID_BY_RULE"
            ? factor
            : factor.mul(
                multiplier(
                  JSON.parse(leg.marketSpecJson),
                  JSON.parse(latest[i]!.regulationJson),
                  leg.frozenOdds,
                ),
              ),
        new Decimal(1),
      )
    : new Decimal(0);
  const nextGross = terminal
    ? Number(
        atoms(
          new Decimal(String(t.stakeAtoms))
            .mul(returnFactor)
            .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
            .toFixed(0),
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
      `INSERT INTO command_receipts VALUES(?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM portfolios WHERE id=? AND revision=?) AND EXISTS(SELECT 1 FROM ticket_state WHERE ticketId=? AND revision=?) AND ?=(SELECT MAX(revision) FROM result_adjudications WHERE fixtureId=?) ${legs.map((leg, i) => (latest[i] ? "AND ?=(SELECT MAX(revision) FROM result_adjudications WHERE fixtureId=?)" : "AND NOT EXISTS(SELECT 1 FROM result_adjudications WHERE fixtureId=?)")).join(" ")} THEN 1 ELSE 0 END,?,?)`,
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
      ...legs.flatMap((leg, i) =>
        latest[i] ? [latest[i]!.revision, leg.fixtureId] : [leg.fixtureId],
      ),
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
      legs.length === 1 ? "RETURN_V1_HALF_UP_6" : "PARLAY_PRODUCT_V1_HALF_UP_6",
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
      terminal ? "SETTLED" : needsReview ? "REVIEW" : "OPEN",
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
