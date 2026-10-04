import { canonical, sha, central } from "../../../../packages/contracts";
import { multiplier, accountingDay } from "../../../../packages/domain";
import {
  SEPTEMBER_ID,
  V6_ID,
  VERSIONS,
  selectedVersion,
  versionPolicy,
} from "../../../../packages/domain/versions";
import pins from "../../../../packages/domain/legacy-september-pins.json";
import {
  legacyDefaults,
  legacyRound,
} from "../../../../packages/domain/legacy-september-engine";
import { atomic, one, rows, stmt, uid } from "../repositories/db";
import { receipt, type Context } from "./commands";
import { studyMetrics, oddsBand } from "./study-metrics";
import { ledgerRows, summarizeRecords } from "./workspace";
import { marketBaseline } from "../../../../packages/domain";

export const SEPTEMBER_MANIFEST = {
  id: SEPTEMBER_ID,
  variant: SEPTEMBER_ID,
  outputKind: "CENTRAL_AND_LEGACY_CANDIDATES",
  pins,
  researchOnly: true,
  automaticPromotion: false,
  validation:
    "PRESERVED_SOURCE_RULES_WITH_ARCHIVED_SEED_NOT_PROVEN_DIRTY_RUNTIME",
  seed: {
    modelW: 0.2,
    marginShift: 0.02,
    source:
      "2026-09-25 active ledger export; Sept20 1X2 tickets preserve 4.42PP margin",
  },
  clock: "Asia/Shanghai",
  stake: "ORIGINAL_FIXED_STAKE; old calculated Kelly was not applied",
};
const policyVersion = (id: string) =>
  "SEPTEMBER20_" + id.toUpperCase().replaceAll("-", "_") + "_V1";
const registered = new Set<string>();
const latestJobState = `(SELECT j.state FROM jobs j JOIN input_bundles jb ON jb.id=j.bundleId JOIN observation_slots js ON js.id=jb.slotId JOIN fixture_revisions jr ON jr.id=js.fixtureRevisionId WHERE j.modelId=p.modelId AND jr.fixtureId=fr.fixtureId ORDER BY jb.cutoffAt DESC,j.rowid DESC LIMIT 1)`;
async function latestFailed(c: Context, modelId: string, fixtureId: string) {
  const job = await one(
    c.db,
    "SELECT j.state FROM jobs j JOIN input_bundles b ON b.id=j.bundleId JOIN observation_slots s ON s.id=b.slotId JOIN fixture_revisions r ON r.id=s.fixtureRevisionId WHERE j.modelId=? AND r.fixtureId=? ORDER BY b.cutoffAt DESC,j.rowid DESC LIMIT 1",
    modelId,
    fixtureId,
  );
  return job && ["FAILED", "BLOCKED"].includes(job.state);
}
export async function registerVersions(c: Context) {
  if (registered.has(c.installationId)) return;
  const json = canonical(SEPTEMBER_MANIFEST),
    hash = await sha(json);
  await stmt(
    c.db,
    "INSERT OR IGNORE INTO model_manifests VALUES(?,?,?,'CENTRAL_AND_LEGACY_CANDIDATES','UNVALIDATED_FORWARD_RESEARCH')",
    SEPTEMBER_ID,
    json,
    hash,
  ).run();
  if (
    (
      await one(
        c.db,
        "SELECT manifestHash FROM model_manifests WHERE id=?",
        SEPTEMBER_ID,
      )
    ).manifestHash !== hash
  )
    throw Error("MODEL_HASH_MISMATCH");
  await stmt(
    c.db,
    "INSERT OR IGNORE INTO version_state VALUES(?,0,?,?,NULL,?)",
    SEPTEMBER_ID,
    canonical({ modelW: 0.2, marginShift: 0.02, notes: [], computedAt: 0 }),
    canonical(SEPTEMBER_MANIFEST.seed),
    c.now,
  ).run();
  const prior = await stmt(
    c.db,
    "SELECT metadataJson FROM workspace_imports ORDER BY rowid DESC LIMIT 1",
  ).first<any>();
  const saved = prior ? (JSON.parse(prior.metadataJson).strategies ?? []) : [];
  for (const p of legacyDefaults().portfolios) {
    const old = saved.find((s: any) => s.id === p.id);
    const id = "september20:" + p.id;
    await atomic(c.db, [
      stmt(
        c.db,
        "INSERT OR IGNORE INTO portfolios VALUES(?,'PAPER_RESEARCH',0,10000000000,0,0,10000000000,0)",
        "paper:" + id,
      ),
      stmt(
        c.db,
        "INSERT OR IGNORE INTO paper_policies VALUES(?,?,?,?,?,?,0)",
        id,
        "paper:" + id,
        p.name,
        policyVersion(p.id),
        old?.enabled === false ? 0 : p.id === "totals-baseline" ? 0 : 1,
        old?.maxTickets ?? p.maxTickets,
      ),
    ]);
  }
  const v6 = await stmt(
    c.db,
    "SELECT id FROM model_manifests WHERE id=?",
    V6_ID,
  ).first();
  if (v6)
    await atomic(c.db, [
      stmt(
        c.db,
        "INSERT OR IGNORE INTO portfolios VALUES('paper:v6-native','PAPER_RESEARCH',0,10000000000,0,0,10000000000,0)",
      ),
      stmt(
        c.db,
        "INSERT OR IGNORE INTO paper_policies VALUES('v6-native','paper:v6-native','V6原生价值单场','V6_NATIVE_PAPER_V1',1,5,0)",
      ),
    ]);
  if (v6) registered.add(c.installationId);
}
export async function legacyState(c: Context) {
  await registerVersions(c);
  const state = await one(
    c.db,
    "SELECT * FROM version_state WHERE modelId=?",
    SEPTEMBER_ID,
  );
  return {
    revision: state.revision,
    evolution: JSON.parse(state.evolutionJson),
    seed: JSON.parse(state.seedJson),
  };
}
const candidateKey = (leg: any) =>
  [
    leg.matchId,
    leg.market ?? "1x2",
    leg.pick,
    leg.side ?? "",
    leg.line ?? "",
  ].join("|");
const marketSpec = (leg: any) => ({
  market:
    leg.market === "spread"
      ? "ASIAN_HANDICAP"
      : leg.market === "total"
        ? "TOTAL_GOALS"
        : "1X2",
  selection: leg.market
    ? String(leg.side).toUpperCase()
    : ["HOME", "DRAW", "AWAY"][leg.pick],
  lineQ: leg.market ? Math.round(leg.line * 4) : null,
  scope: "REGULATION_90",
});

export async function completeVersion(c: Context, id: string, p: any) {
  const j = await one(c.db, "SELECT * FROM jobs WHERE id=?", id),
    b = await one(c.db, "SELECT * FROM input_bundles WHERE id=?", j.bundleId),
    m = await one(c.db, "SELECT * FROM model_manifests WHERE id=?", j.modelId),
    input = JSON.parse(b.canonical);
  if (
    j.modelId !== SEPTEMBER_ID ||
    p.modelHash !== m.manifestHash ||
    p.bundleHash !== b.manifestHash ||
    p.featureCanonical !== b.canonical ||
    (await sha(b.canonical)) !== b.manifestHash
  )
    throw Error("MODEL_HASH_MISMATCH");
  const o = p.output;
  if (
    o?.variant !== SEPTEMBER_ID ||
    o.researchOnly !== true ||
    !["DONE", "BLOCKED"].includes(o.state) ||
    typeof o.reason !== "string"
  )
    throw Error("MODEL_OUTPUT_INVALID");
  if (o.state === "DONE") {
    central(o.central);
    if (
      o.stateRevision !== input.comparisonFeatures?.legacyState?.revision ||
      canonical(o.evolution) !==
        canonical(input.comparisonFeatures.legacyState.evolution)
    )
      throw Error("MODEL_HASH_MISMATCH");
    if (
      !o.match ||
      o.match.id !== input.fixtureId ||
      o.match.status !== "soon" ||
      o.match.date !== Date.parse(input.kickoffAt)
    )
      throw Error("MODEL_OUTPUT_INVALID");
  }
  const requestHash = await sha(canonical(o));
  const prior = await stmt(
    c.db,
    "SELECT * FROM version_observations WHERE jobId=?",
    id,
  ).first<any>();
  if (prior) {
    if (
      j.leaseOwner !== p.owner ||
      j.fencingToken !== p.fencingToken ||
      JSON.parse(prior.outputJson).runnerOutputHash !== requestHash
    )
      throw Error("IDEMPOTENCY_CONFLICT");
    return {
      id: prior.id,
      predictionId: prior.predictionId,
      state: prior.state,
    };
  }
  if (c.now < b.cutoffAt || c.now >= Date.parse(input.kickoffAt))
    throw Error("FEATURE_LATE");
  const feature = uid(),
    prediction = o.state === "DONE" ? uid() : null,
    observation = uid();
  const q = [
    stmt(
      c.db,
      "INSERT INTO fault_guard VALUES(CASE WHEN EXISTS(SELECT 1 FROM jobs WHERE id=? AND state='RUNNING' AND leaseOwner=? AND fencingToken=? AND leaseUntil>? AND deadlineAt>?) AND EXISTS(SELECT 1 FROM fixtures f JOIN fixture_revisions r ON r.fixtureId=f.id WHERE r.id=? AND f.currentRevision=r.revision AND f.status='SCHEDULED') THEN 1 ELSE 0 END)",
      id,
      p.owner,
      p.fencingToken,
      c.now,
      c.now,
      input.revisionId,
    ),
    stmt(c.db, "DELETE FROM fault_guard"),
  ];
  const output = { ...o, runnerOutputHash: requestHash, quoted: [] as any[] };
  if (prediction) {
    q.push(
      stmt(
        c.db,
        "INSERT INTO feature_snapshots VALUES(?,?,?,?,?)",
        feature,
        b.id,
        SEPTEMBER_ID,
        b.manifestHash,
        b.canonical,
      ),
      stmt(
        c.db,
        "INSERT INTO predictions VALUES(?,?,?,?,?,?,?,?)",
        prediction,
        b.slotId,
        input.revisionId,
        SEPTEMBER_ID,
        feature,
        c.now,
        canonical(o.central),
        await sha(
          canonical({
            modelId: SEPTEMBER_ID,
            bundleHash: b.manifestHash,
            output: o,
          }),
        ),
      ),
    );
    const base = await one(
      c.db,
      "SELECT * FROM quote_sets WHERE id=?",
      b.quoteSetId,
    );
    const original = await rows(
      c.db,
      "SELECT * FROM quote_selections WHERE quoteSetId=?",
      b.quoteSetId,
    );
    const unique = new Map<string, any>();
    for (const candidate of Object.values(o.candidates ?? {}) as any[]) {
      if (!candidate) continue;
      const spec = marketSpec(candidate.leg);
      const offered = input.comparisonFeatures.offers.find(
        (a: any) =>
          a.market === spec.market &&
          a.selection === spec.selection &&
          a.lineQ === spec.lineQ &&
          Number(a.odds) === candidate.leg.odds,
      );
      if (
        !offered ||
        candidate.leg.matchId !== input.fixtureId ||
        !Number.isFinite(candidate.edge) ||
        !Number.isFinite(candidate.leg.probability) ||
        candidate.leg.probability < 0 ||
        candidate.leg.probability > 1 ||
        Math.abs(
          candidate.leg.probability * candidate.leg.odds - 1 - candidate.edge,
        ) > 1e-10
      )
        throw Error("QUOTE_MISMATCH");
      multiplier(spec, { home: 0, away: 0 }, offered.odds);
      unique.set(candidateKey(candidate.leg), { candidate, spec, offered });
    }
    for (const [key, { candidate, spec, offered }] of unique) {
      let quoteSelectionId = original.find(
        (a: any) => a.selection === spec.selection,
      )?.id;
      if (spec.market !== "1X2") {
        const mh = await sha(
          input.fixtureId +
            ":REGULATION_90:" +
            spec.market +
            ":" +
            (spec.market === "ASIAN_HANDICAP" && spec.selection === "AWAY"
              ? -spec.lineQ
              : spec.lineQ),
        );
        const priorMarket = await stmt(
          c.db,
          "SELECT id FROM market_definitions WHERE specHash=?",
          mh,
        ).first<any>();
        const market = priorMarket?.id ?? uid(),
          set = uid();
        quoteSelectionId = uid();
        if (!priorMarket)
          q.push(
            stmt(
              c.db,
              "INSERT INTO market_definitions VALUES(?,?,?,'REGULATION_90',?)",
              market,
              input.fixtureId,
              mh,
              spec.market,
            ),
          );
        q.push(
          stmt(
            c.db,
            "INSERT INTO quote_sets VALUES(?,?,?,?,?,?,?,?,?)",
            set,
            market,
            base.sourceSnapshotId,
            base.providerId,
            base.observedAt,
            base.providerUpdatedAt,
            base.phase,
            base.suspended,
            await sha(canonical(offered)),
          ),
          stmt(
            c.db,
            "INSERT INTO quote_selections VALUES(?,?,?,?,?,'decimal')",
            quoteSelectionId,
            set,
            spec.selection,
            offered.odds,
            offered.odds,
          ),
        );
      }
      const expectation = uid();
      q.push(
        stmt(
          c.db,
          "INSERT INTO market_expectations VALUES(?,?,?,?,?,?,?)",
          expectation,
          prediction,
          quoteSelectionId,
          candidate.leg.probability * candidate.leg.odds,
          candidate.edge,
          candidate.leg.probability,
          "SEPTEMBER20_ORIGINAL_CANDIDATE_V1",
        ),
      );
      output.quoted.push({
        key,
        candidate,
        spec,
        expectationId: expectation,
        quoteSelectionId,
        predictionId: prediction,
      });
    }
  }
  const json = canonical(output);
  q.push(
    stmt(
      c.db,
      "INSERT INTO version_observations VALUES(?,?,?,?,?,?,?,?,?,?)",
      observation,
      id,
      SEPTEMBER_ID,
      prediction,
      input.revisionId,
      b.id,
      o.state,
      json,
      await sha(json),
      c.now,
    ),
    stmt(
      c.db,
      "UPDATE jobs SET state=?,reason=?,leaseUntil=0 WHERE id=?",
      o.state,
      o.reason,
      id,
    ),
  );
  await atomic(c.db, q, c.failAt);
  return { id: observation, predictionId: prediction, state: o.state };
}

async function loadLab(c: Context, state: any) {
  const lab = legacyDefaults();
  lab.evolution = JSON.parse(state.evolutionJson);
  const policies = await rows(
    c.db,
    "SELECT pp.*,p.initial FROM paper_policies pp JOIN portfolios p ON p.id=pp.portfolioId WHERE pp.id LIKE 'september20:%'",
  );
  const archived = await stmt(
    c.db,
    "SELECT metadataJson FROM workspace_imports ORDER BY rowid DESC LIMIT 1",
  ).first<any>();
  const saved = archived
    ? (JSON.parse(archived.metadataJson).strategies ?? [])
    : [];
  const tickets = await rows(
    c.db,
    "SELECT t.*,s.currentStatus,s.gross,x.originalJson,fr.fixtureId legFixtureId,a.regulationJson FROM version_ticket_evidence x JOIN tickets t ON t.id=x.ticketId JOIN ticket_state s ON s.ticketId=t.id LEFT JOIN ticket_legs tl ON tl.ticketId=t.id LEFT JOIN fixture_revisions fr ON fr.id=tl.fixtureRevisionId LEFT JOIN result_adjudications a ON a.fixtureId=fr.fixtureId AND a.revision=(SELECT MAX(revision) FROM result_adjudications WHERE fixtureId=fr.fixtureId) WHERE x.modelId=? ORDER BY t.createdAt",
    SEPTEMBER_ID,
  );
  for (const portfolio of lab.portfolios) {
    const p = policies.find((a: any) => a.id === "september20:" + portfolio.id);
    const prior = saved.find((a: any) => a.id === portfolio.id);
    portfolio.enabled = !!p?.enabled;
    portfolio.maxTickets = p?.maximumPerDay ?? portfolio.maxTickets;
    portfolio.stake = prior?.stake ?? portfolio.stake;
    portfolio.initialBalance = Number(p?.initial ?? 10000000000) / 1e6;
    const own = new Map<string, any>();
    for (const t of tickets.filter(
      (t: any) => t.portfolioId === p?.portfolioId,
    )) {
      const record = own.get(t.id) ?? JSON.parse(t.originalJson);
      if (t.currentStatus === "SETTLED") {
        record.pnl = (t.gross - t.stakeAtoms) / 1e6;
        record.status =
          record.pnl < 0 ? "loss" : record.pnl > 0 ? "win" : "void";
        for (const leg of record.legs) {
          if (t.regulationJson && leg.matchId === t.legFixtureId) {
            const score = JSON.parse(t.regulationJson);
            const spec = marketSpec(leg);
            const factor = Number(multiplier(spec, score, String(leg.odds)));
            leg.status = factor === 0 ? "loss" : factor === 1 ? "void" : "win";
          }
        }
      } else {
        record.status = t.currentStatus === "REVIEW" ? "review" : "open";
        record.pnl = 0;
      }
      own.set(t.id, record);
    }
    portfolio.tickets = [...own.values()];
  }
  return lab;
}

export async function versionPaperStep(c: Context) {
  const installation = await one(
    c.db,
    "SELECT mode FROM installations WHERE id=?",
    c.installationId,
  );
  if (installation.mode !== "LOCAL_RESEARCH") return { placed: 0 };
  await registerVersions(c);
  const v6Placed = await v6PaperStep(c);
  const state = await one(
    c.db,
    "SELECT * FROM version_state WHERE modelId=?",
    SEPTEMBER_ID,
  );
  const latest = await rows(
    c.db,
    "WITH newest AS(SELECT fr.fixtureId,MAX(o.rowid) rowId FROM version_observations o JOIN fixture_revisions fr ON fr.id=o.fixtureRevisionId JOIN fixtures f ON f.id=fr.fixtureId JOIN input_bundles b ON b.id=o.bundleId JOIN quote_sets q ON q.id=b.quoteSetId WHERE o.modelId=? AND o.state='DONE' AND f.status='SCHEDULED' AND f.currentRevision=fr.revision AND fr.kickoffAt>=? AND fr.kickoffAt<=? AND q.observedAt>=? GROUP BY fr.fixtureId) SELECT o.*,q.observedAt quoteAt FROM newest n JOIN version_observations o ON o.rowid=n.rowId JOIN input_bundles b ON b.id=o.bundleId JOIN quote_sets q ON q.id=b.quoteSetId ORDER BY o.calculatedAt,o.id",
    SEPTEMBER_ID,
    c.now + 600000,
    c.now + 86400000,
    c.now - 600000,
  );
  const observations = latest
    .map((o: any) => ({ ...o, output: JSON.parse(o.outputJson) }))
    .filter((o: any) => o.output.stateRevision === state.revision);
  for (let i = observations.length - 1; i >= 0; i--)
    if (await latestFailed(c, SEPTEMBER_ID, observations[i].output.match.id))
      observations.splice(i, 1);
  const lab = await loadLab(c, state);
  const roundKey = await sha(
    canonical({
      observations: observations.map((o: any) => o.id),
      tickets: lab.portfolios.map((p: any) =>
        p.tickets.map((t: any) => [t.id, t.status, t.pnl]),
      ),
      policies: lab.portfolios.map((p: any) => [p.id, p.enabled, p.maxTickets]),
    }),
  );
  if (!observations.length || roundKey === state.lastRoundKey)
    return { placed: v6Placed, revision: state.revision };
  const matches = observations.map((o: any) => ({
    ...o.output.match,
    frozenCandidates: o.output.candidates,
  }));
  const round = legacyRound(lab, matches, c.now);
  let placed = 0;
  const pending: D1PreparedStatement[] = [];
  const offsets = new Map<string, number>();
  const proposedKeys = new Set<string>();
  for (const proposal of round.proposals) {
    const key = proposal.portfolioId + "|" + proposal.ticket.id;
    const reason =
      new Set(proposal.ticket.legs.map((l: any) => l.matchId)).size !==
      proposal.ticket.legs.length
        ? "SAME_FIXTURE_PARLAY_UNSUPPORTED"
        : proposedKeys.has(key)
          ? "DUPLICATE_ORIGINAL_PROPOSAL"
          : null;
    if (reason) {
      pending.push(
        stmt(
          c.db,
          "INSERT OR IGNORE INTO version_execution_rejections VALUES(?,?,?,?,?,?,?,?)",
          uid(),
          SEPTEMBER_ID,
          roundKey,
          proposal.portfolioId,
          proposal.ticket.id,
          reason,
          canonical(proposal.ticket),
          c.now,
        ),
      );
      continue;
    }
    proposedKeys.add(key);
    const policy = await one(
      c.db,
      "SELECT pp.*,p.revision accountRevision FROM paper_policies pp JOIN portfolios p ON p.id=pp.portfolioId WHERE pp.id=?",
      "september20:" + proposal.portfolioId,
    );
    const bindings = proposal.ticket.legs.map((leg: any) => {
      const observation = observations.find(
        (o: any) => o.output.match.id === leg.matchId,
      );
      const q = observation?.output.quoted.find(
        (a: any) => a.key === candidateKey(leg),
      );
      if (!q) throw Error("FROZEN_PLAN_MISMATCH");
      return { ...q, fixtureRevisionId: observation.fixtureRevisionId };
    });
    const offset = offsets.get(policy.portfolioId) ?? 0;
    const prepared = await placeVersion(
      c,
      policy,
      proposal.ticket,
      bindings,
      state.revision,
      SEPTEMBER_ID,
      true,
      offset,
    );
    if (prepared.queries) {
      pending.push(...prepared.queries);
      offsets.set(policy.portfolioId, offset + 1);
      placed++;
    }
  }
  const evolution = canonical(round.lab.evolution);
  const previousEvolution = JSON.parse(state.evolutionJson);
  const changed =
    round.lab.evolution.modelW !== previousEvolution.modelW ||
    round.lab.evolution.marginShift !== previousEvolution.marginShift;
  const q = [
    stmt(
      c.db,
      "INSERT INTO fault_guard VALUES(CASE WHEN EXISTS(SELECT 1 FROM version_state WHERE modelId=? AND revision=? AND COALESCE(lastRoundKey,'')=?) THEN 1 ELSE 0 END)",
      SEPTEMBER_ID,
      state.revision,
      state.lastRoundKey ?? "",
    ),
    stmt(c.db, "DELETE FROM fault_guard"),
    stmt(
      c.db,
      "UPDATE version_state SET revision=revision+?,evolutionJson=?,lastRoundKey=?,updatedAt=? WHERE modelId=?",
      changed ? 1 : 0,
      evolution,
      roundKey,
      c.now,
      SEPTEMBER_ID,
    ),
  ];
  if (changed)
    q.push(
      stmt(
        c.db,
        "INSERT INTO version_state_events VALUES(?,?,?,?,?,?)",
        uid(),
        SEPTEMBER_ID,
        state.revision + 1,
        evolution,
        roundKey,
        c.now,
      ),
    );
  await atomic(c.db, [...pending, ...q], c.failAt);
  return {
    placed: placed + v6Placed,
    legacyPlaced: placed,
    v6Placed,
    revision: state.revision + (changed ? 1 : 0),
    evolution: round.lab.evolution,
  };
}

async function placeVersion(
  c: Context,
  policy: any,
  ticket: any,
  bindings: any[],
  stateRevision: number,
  modelId = SEPTEMBER_ID,
  defer = false,
  offset = 0,
): Promise<any> {
  const key = await sha(policy.id + "|" + ticket.id);
  const request = { policy: policy.id, ticket, bindings, stateRevision };
  const r = await receipt(c, "version-paper", key, request);
  if (r.old) return { id: r.old.resultRef };
  const stake = Math.round(ticket.stake * 1e6);
  if (
    !Number.isSafeInteger(stake) ||
    stake < 1000000 ||
    stake > 500000000 ||
    !bindings.length ||
    bindings.length > 3
  )
    throw Error("INVALID_FIELDS");
  const portfolio = await one(
    c.db,
    "SELECT * FROM portfolios WHERE id=?",
    policy.portfolioId,
  );
  const day = accountingDay(
    c.now,
    modelId === SEPTEMBER_ID ? "Asia/Shanghai" : "Europe/Berlin",
  );
  const id = uid(),
    command = uid(),
    decision = uid(),
    placementExpectation = uid();
  const guard =
    "EXISTS(SELECT 1 FROM portfolios WHERE id=? AND revision=? AND mode='PAPER_RESEARCH' AND available>=? AND frozen=0) AND EXISTS(SELECT 1 FROM paper_policies WHERE id=? AND enabled=1 AND revision=? AND (SELECT COUNT(*) FROM tickets WHERE portfolioId=? AND placementDay=?)<maximumPerDay)";
  const checks = bindings
    .map(
      () =>
        `EXISTS(SELECT 1 FROM predictions p JOIN fixture_revisions fr ON fr.id=p.fixtureRevisionId JOIN fixtures f ON f.id=fr.fixtureId JOIN quote_selections qs ON qs.id=? JOIN quote_sets q ON q.id=qs.quoteSetId JOIN market_definitions m ON m.id=q.marketId JOIN market_expectations e ON e.id=? AND e.predictionId=p.id AND e.quoteSelectionId=qs.id WHERE p.id=? AND p.modelId=? AND f.status='SCHEDULED' AND f.currentRevision=fr.revision AND m.fixtureId=f.id AND fr.kickoffAt>=? AND fr.kickoffAt<=? AND q.observedAt>=? AND q.observedAt<=? AND q.suspended=0 AND ${latestJobState} NOT IN('FAILED','BLOCKED'))`,
    )
    .join(" AND ");
  const queries = [
    stmt(
      c.db,
      `INSERT INTO command_receipts VALUES(?,?,?,?,CASE WHEN ${guard} AND ${checks} THEN 1 ELSE 0 END,?,?)`,
      command,
      r.scope,
      key,
      r.hash,
      policy.portfolioId,
      portfolio.revision + offset,
      stake,
      policy.id,
      policy.revision,
      policy.portfolioId,
      day,
      ...bindings.flatMap((b: any) => [
        b.quoteSelectionId,
        b.expectationId,
        b.predictionId,
        modelId,
        c.now + 600000,
        c.now + 86400000,
        c.now - 600000,
        c.now,
      ]),
      id,
      c.now,
    ),
    stmt(
      c.db,
      "INSERT INTO market_expectations SELECT ?,predictionId,quoteSelectionId,expectedReturn,ev,probability,pricingVersion||? FROM market_expectations WHERE id=?",
      placementExpectation,
      ":" + policy.id + ":" + ticket.id,
      bindings[0].expectationId,
    ),
    stmt(
      c.db,
      "INSERT INTO decisions VALUES(?,?,1,?,?,?)",
      decision,
      placementExpectation,
      ticket.id.includes(":fill:")
        ? "LEGACY_BELOW_THRESHOLD_FILL"
        : modelId === V6_ID
          ? "V6_NATIVE_PAPER_POLICY"
          : "LEGACY_ORIGINAL_PAPER_POLICY",
      c.now,
      policy.strategyVersion,
    ),
    stmt(
      c.db,
      "INSERT INTO tickets VALUES(?,?,?,?,?,?,?,?)",
      id,
      policy.portfolioId,
      decision,
      stake,
      c.now,
      ticket.id,
      day,
      "PAPER_RESEARCH",
    ),
    ...bindings.map((b: any, i: number) =>
      stmt(
        c.db,
        "INSERT INTO ticket_legs VALUES(?,?,?,?,?,?,?,?)",
        uid(),
        id,
        b.fixtureRevisionId,
        b.quoteSelectionId,
        b.predictionId,
        String(ticket.legs[i].odds),
        b.spec.selection,
        canonical(b.spec),
      ),
    ),
    stmt(c.db, "INSERT INTO ticket_state VALUES(?,0,'OPEN',0,NULL)", id),
    stmt(
      c.db,
      "INSERT INTO ledger_entries VALUES(?,?,?,?,NULL,'PLACE',?,?,0)",
      uid(),
      policy.portfolioId,
      command,
      id,
      -stake,
      stake,
    ),
    stmt(
      c.db,
      "UPDATE portfolios SET available=available-?,openStake=openStake+?,revision=revision+1 WHERE id=?",
      stake,
      stake,
      policy.portfolioId,
    ),
    stmt(
      c.db,
      "INSERT INTO version_ticket_evidence VALUES(?,?,?,?,?)",
      id,
      modelId,
      canonical(ticket),
      stateRevision,
      c.now,
    ),
  ];
  if (defer) return { id, queries };
  try {
    await atomic(c.db, queries, c.failAt);
  } catch (e) {
    if (
      await stmt(
        c.db,
        "SELECT id FROM tickets WHERE portfolioId=? AND businessKey=?",
        policy.portfolioId,
        ticket.id,
      ).first()
    )
      throw Error("DUPLICATE_BUSINESS_ACTION");
    throw Error("REVISION_CONFLICT");
  }
  return { id };
}

export async function mirrorV6Queries(c: Context, j: any, b: any, o: any) {
  if (j.modelId !== V6_ID || o.state !== "DONE") return [];
  const input = JSON.parse(b.canonical),
    feature = uid(),
    prediction = uid(),
    observation = uid();
  const q = [
    stmt(
      c.db,
      "INSERT INTO feature_snapshots VALUES(?,?,?,?,?)",
      feature,
      b.id,
      V6_ID,
      b.manifestHash,
      b.canonical,
    ),
    stmt(
      c.db,
      "INSERT INTO predictions VALUES(?,?,?,?,?,?,?,?)",
      prediction,
      b.slotId,
      input.revisionId,
      V6_ID,
      feature,
      c.now,
      "null",
      await sha(
        canonical({ variant: V6_ID, bundle: b.manifestHash, output: o }),
      ),
    ),
  ];
  const selections = await rows(
    c.db,
    "SELECT * FROM quote_selections WHERE quoteSetId=?",
    b.quoteSetId,
  );
  const quoted = [];
  for (const a of o.actions) {
    const quote = selections.find(
      (s: any) =>
        s.selection === a.selection && Number(s.decimalOdds) === Number(a.odds),
    );
    if (!quote) throw Error("QUOTE_MISMATCH");
    const expectation = uid();
    q.push(
      stmt(
        c.db,
        "INSERT INTO market_expectations VALUES(?,?,?,?,?,?,?)",
        expectation,
        prediction,
        quote.id,
        a.probability * Number(a.odds),
        a.estimatedEV,
        a.probability,
        "V6_NATIVE_STRESS_V1",
      ),
    );
    quoted.push({
      expectationId: expectation,
      quoteSelectionId: quote.id,
      predictionId: prediction,
      fixtureRevisionId: input.revisionId,
      spec: {
        market: "1X2",
        selection: a.selection,
        lineQ: null,
        scope: "REGULATION_90",
      },
      action: a,
    });
  }
  const output = canonical({ ...o, quoted });
  q.push(
    stmt(
      c.db,
      "INSERT INTO version_observations VALUES(?,?,?,?,?,?,?,?,?,?)",
      observation,
      j.id,
      V6_ID,
      prediction,
      input.revisionId,
      b.id,
      "DONE",
      output,
      await sha(output),
      c.now,
    ),
  );
  return q;
}
async function v6PaperStep(c: Context) {
  const data = await rows(
    c.db,
    "WITH latest AS(SELECT fr.fixtureId,MAX(o.rowid) rowId FROM version_observations o JOIN fixture_revisions fr ON fr.id=o.fixtureRevisionId WHERE o.modelId=? GROUP BY fr.fixtureId) SELECT o.*,fr.fixtureId,fr.kickoffAt,f.home,f.away,q.observedAt FROM latest x JOIN version_observations o ON o.rowid=x.rowId JOIN fixture_revisions fr ON fr.id=o.fixtureRevisionId JOIN fixtures f ON f.id=fr.fixtureId JOIN input_bundles b ON b.id=o.bundleId JOIN quote_sets q ON q.id=b.quoteSetId WHERE f.status='SCHEDULED' AND f.currentRevision=fr.revision AND fr.kickoffAt>=? AND fr.kickoffAt<=? AND q.observedAt>=? AND NOT EXISTS(SELECT 1 FROM tickets t WHERE t.portfolioId='paper:v6-native' AND t.businessKey='v6-native:'||fr.fixtureId) ORDER BY fr.kickoffAt",
    V6_ID,
    c.now + 600000,
    c.now + 86400000,
    c.now - 600000,
  );
  let placed = 0;
  for (const r of data) {
    if (await latestFailed(c, V6_ID, r.fixtureId)) continue;
    const o = JSON.parse(r.outputJson);
    if (!o.quoted?.length) continue;
    const policy = await one(
      c.db,
      "SELECT * FROM paper_policies WHERE id='v6-native'",
    );
    if (!policy.enabled) continue;
    const a = o.quoted[0].action;
    const ticket = {
      id: "v6-native:" + r.fixtureId,
      day: accountingDay(c.now, "Europe/Berlin"),
      createdAt: c.now,
      stake: 20,
      odds: Number(a.odds),
      status: "open",
      pnl: 0,
      estimatedEdge: a.estimatedEV,
      legs: [
        {
          matchId: r.fixtureId,
          home: r.home,
          away: r.away,
          kickoffAt: r.kickoffAt,
          pick: ["HOME", "DRAW", "AWAY"].indexOf(a.selection),
          odds: Number(a.odds),
          probability: a.probability,
          status: "open",
        },
      ],
    };
    try {
      await placeVersion(c, policy, ticket, o.quoted, 0, V6_ID);
      placed++;
    } catch (e) {
      if (!/DUPLICATE_BUSINESS_ACTION|REVISION_CONFLICT/.test(String(e)))
        throw e;
    }
  }
  return placed;
}

export async function versionsReport(c: Context) {
  const state = await stmt(
    c.db,
    "SELECT * FROM version_state WHERE modelId=?",
    SEPTEMBER_ID,
  ).first<any>();
  const coverage = await rows(
    c.db,
    "SELECT modelId,COUNT(*) n FROM jobs WHERE state='DONE' GROUP BY modelId",
  );
  return {
    versions: VERSIONS.map((v) => ({
      ...v,
      completedJobs: coverage.find((j: any) => j.modelId === v.modelId)?.n ?? 0,
    })),
    september: state
      ? {
          ...state,
          evolution: JSON.parse(state.evolutionJson),
          seed: JSON.parse(state.seedJson),
        }
      : null,
    asOf: c.now,
    identity:
      "Original preserved source rules; exact September20 dirty runtime not proven",
    executionRejections: await rows(
      c.db,
      "SELECT policyId,reason,at,originalJson FROM version_execution_rejections ORDER BY rowid DESC LIMIT 10",
    ),
  };
}
export { selectedVersion, versionPolicy };

export async function versionDirections(c: Context, params: URLSearchParams) {
  const version = selectedVersion(params);
  const saved = await rows(
    c.db,
    "WITH newest AS(SELECT fr.fixtureId,MAX(o.rowid) rowId FROM version_observations o JOIN fixture_revisions fr ON fr.id=o.fixtureRevisionId WHERE o.modelId=? AND (?='' OR fr.fixtureId=?) GROUP BY fr.fixtureId) SELECT o.*,fr.fixtureId,fr.kickoffAt,f.home,f.away,f.status fixtureStatus,cat.competition,q.observedAt quoteObservedAt,q.providerId,b.cutoffAt FROM newest n JOIN version_observations o ON o.rowid=n.rowId JOIN fixture_revisions fr ON fr.id=o.fixtureRevisionId JOIN fixtures f ON f.id=fr.fixtureId JOIN input_bundles b ON b.id=o.bundleId JOIN quote_sets q ON q.id=b.quoteSetId LEFT JOIN fixture_catalog cat ON cat.fixtureId=f.id ORDER BY fr.kickoffAt LIMIT 2000",
    version.modelId,
    params.get("fixture") ?? "",
    params.get("fixture") ?? "",
  );
  const records = saved.map((r: any) => {
    const o = JSON.parse(r.outputJson);
    const quoted = o.quoted ?? [];
    const plans = quoted.map((q: any) => {
      const candidate = q.candidate;
      const action = q.action;
      const spec = q.spec;
      return {
        ...spec,
        odds: candidate ? String(candidate.leg.odds) : action.odds,
        probability: candidate?.leg.probability ?? action?.probability,
        probabilityKind: candidate ? "CONSERVATIVE" : "STRESS",
        originalStrategy: true,
        conservativeProbability:
          candidate?.leg.probability ?? action?.probability,
        estimatedEV: candidate?.edge ?? action?.estimatedEV,
        rank: candidate?.leg.score ?? null,
        qualified: candidate ? candidate.value : true,
        isValue: candidate ? candidate.value : true,
        accepted: true,
        ticketType: "SINGLE",
        decisionId: q.expectationId,
        policyId: "version-candidate",
        reasons:
          candidate && !candidate.value
            ? ["未过原版价值门槛；仍可进入广覆盖或保底对照"]
            : [],
        rationale: candidate?.leg.rationale,
        minimumOdds: null,
      };
    });
    const broad = version.id === "SEPTEMBER20" && o.candidates?.broad;
    const broadSpec = broad ? marketSpec(broad.leg) : null;
    if (broad)
      plans.push({
        ...broadSpec,
        odds: String(broad.leg.odds),
        probability: broad.leg.probability,
        probabilityKind: "CONSERVATIVE",
        originalStrategy: true,
        conservativeProbability: broad.leg.probability,
        estimatedEV: broad.edge,
        rank: broad.leg.score,
        qualified: false,
        isValue: false,
        accepted: true,
        ticketType: "SINGLE",
        decisionId: r.id + "broad",
        policyId: "general-v2-all-singles",
        reasons: ["原版广覆盖对照，可记录负EV"],
        minimumOdds: null,
      });
    return {
      ...r,
      output: {
        ...o,
        plans,
        evaluated: plans,
        basis: version.label,
        sampleN: null,
        assumptions: [version.description],
        quoteObservedAt: r.quoteObservedAt,
      },
      fresh: r.quoteObservedAt <= c.now && c.now - r.quoteObservedAt <= 600000,
      actionable:
        r.fixtureStatus === "SCHEDULED" &&
        r.kickoffAt >= c.now + 600000 &&
        r.kickoffAt <= c.now + 86400000,
    };
  });
  return {
    manifest: { ...SEPTEMBER_MANIFEST, label: version.label },
    version,
    records,
    asOf: c.now,
    coverage: {
      totalN: records.length,
      analysedN: records.filter((r) => r.state === "DONE").length,
      independentN: records.filter((r) => !!r.output.goalModel).length,
      competitionN: new Set(records.map((r) => r.competition)).size,
    },
  };
}
export async function versionMetrics(c: Context, params: URLSearchParams) {
  const version = selectedVersion(params);
  const data = await rows(
    c.db,
    "WITH firsts AS(SELECT fr.fixtureId,MIN(o.rowid) rowId FROM version_observations o JOIN fixture_revisions fr ON fr.id=o.fixtureRevisionId WHERE o.modelId=? AND o.state='DONE' AND o.calculatedAt<fr.kickoffAt GROUP BY fr.fixtureId) SELECT o.outputJson,fr.fixtureId,fr.kickoffAt,cat.competition,cat.season,b.canonical,b.cutoffAt,a.state resultState,a.regulationJson FROM firsts x JOIN version_observations o ON o.rowid=x.rowId JOIN fixture_revisions fr ON fr.id=o.fixtureRevisionId JOIN input_bundles b ON b.id=o.bundleId LEFT JOIN fixture_catalog cat ON cat.fixtureId=fr.fixtureId LEFT JOIN result_adjudications a ON a.fixtureId=fr.fixtureId AND a.revision=(SELECT MAX(revision) FROM result_adjudications WHERE fixtureId=fr.fixtureId)",
    version.modelId,
  );
  const samples = data
    .filter((r) => r.resultState === "ACCEPTED_REGULATION")
    .map((r) => {
      const result = JSON.parse(r.regulationJson),
        input = JSON.parse(r.canonical),
        output = JSON.parse(r.outputJson);
      return {
        fixtureId: r.fixtureId,
        date: new Date(r.kickoffAt).toISOString(),
        competition: r.competition,
        season: r.season,
        marketOdds: input.odds.map(Number),
        central: output.central ?? null,
        baseline: marketBaseline(input.odds),
        outcome:
          result.home > result.away ? 0 : result.home === result.away ? 1 : 2,
        action: "NO_ACTION",
      };
    });
  const baseline = (s: any[]) =>
    studyMetrics(
      s.map((r) => ({ ...r, central: r.baseline })),
      data.length,
    );
  const tickets = await ledgerRows(c.db, "PAPER_RESEARCH");
  const policies = await rows(
    c.db,
    "SELECT * FROM paper_policies ORDER BY rowid",
  );
  const groups = (key: string) =>
    [
      ...new Set(
        samples.map((s) =>
          key === "odds"
            ? oddsBand(Math.min(...s.marketOdds))
            : String((s as any)[key] ?? "UNKNOWN"),
        ),
      ),
    ].map((value) => {
      const selected = samples.filter(
        (s) =>
          (key === "odds"
            ? oddsBand(Math.min(...s.marketOdds))
            : String((s as any)[key] ?? "UNKNOWN")) === value,
      );
      return {
        key: value,
        N: selected.length,
        model: studyMetrics(selected, selected.length),
        baseline: baseline(selected),
      };
    });
  return {
    version,
    manifest: {
      label: version.label,
      national: { validation: { holdout: null } },
    },
    asOf: c.now,
    populationN: data.length,
    firstCutoffAt: data.length
      ? Math.min(...data.map((r) => r.cutoffAt))
      : null,
    lastCutoffAt: data.length ? Math.max(...data.map((r) => r.cutoffAt)) : null,
    probability: studyMetrics(samples, data.length),
    baseline: baseline(samples),
    byStrategy: policies
      .filter((p) => versionPolicy(p.id, version.id))
      .map((p) => ({
        ...p,
        metrics: summarizeRecords(
          tickets.filter((t) => t.portfolio === p.portfolioId),
        ),
      })),
    bySeason: groups("season"),
    byLeague: groups("competition"),
    byOdds: groups("odds"),
    limits: [version.description, "首次冻结赛前记录；独立原票账户；未自动晋升"],
  };
}
