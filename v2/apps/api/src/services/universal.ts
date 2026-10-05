import {
  GENERAL_FIXED_ID,
  calibrate,
} from "../../../../packages/domain/general-adaptation";
import { canonical, central, sha } from "../../../../packages/contracts";
import {
  marketBaseline,
  accountingDay,
  multiplier,
  type Market,
} from "../../../../packages/domain";
import {
  UNIVERSAL_ID,
  UNIVERSAL_MANIFEST,
  PAPER_STRATEGIES,
} from "../../../../packages/domain/universal";
import { atomic, one, rows, stmt, uid } from "../repositories/db";
import { place, placeDouble, receipt, type Context } from "./commands";
import { prepareFunDouble, FUN_DOUBLE } from "./fun-paper";
import { matchesTeamSearch, teamName } from "../../../../packages/display";

export async function registerUniversal(c: Context) {
  const json = canonical(UNIVERSAL_MANIFEST),
    hash = await sha(json);
  await stmt(
    c.db,
    "INSERT OR IGNORE INTO model_manifests VALUES(?,?,?,'CENTRAL_AND_SCORE_DISTRIBUTION','UNVALIDATED_FORWARD_RESEARCH')",
    UNIVERSAL_ID,
    json,
    hash,
  ).run();
  if (
    (
      await one(
        c.db,
        "SELECT manifestHash FROM model_manifests WHERE id=?",
        UNIVERSAL_ID,
      )
    ).manifestHash !== hash
  )
    throw Error("MODEL_HASH_MISMATCH");
  const installation = await one(
    c.db,
    "SELECT mode FROM installations WHERE id=?",
    c.installationId,
  );
  if (installation.mode !== "LOCAL_RESEARCH") return;
  const imported = await stmt(
    c.db,
    "SELECT metadataJson FROM workspace_imports ORDER BY rowid DESC LIMIT 1",
  ).first<any>();
  const old = imported
    ? (JSON.parse(imported.metadataJson).strategies ?? [])
    : [];
  for (const policy of PAPER_STRATEGIES) {
    const priorPolicy = await stmt(
      c.db,
      "SELECT * FROM paper_policies WHERE id=?",
      policy.legacyId,
    ).first<any>();
    const saved = old.find((p: any) => p.id === policy.legacyId),
      portfolio = "paper:" + policy.id;
    await atomic(c.db, [
      stmt(
        c.db,
        "INSERT OR IGNORE INTO portfolios VALUES(?,'PAPER_RESEARCH',0,10000000000,0,0,10000000000,0)",
        portfolio,
      ),
      stmt(
        c.db,
        "INSERT OR IGNORE INTO paper_policies VALUES(?,?,?,?,?,?,0)",
        policy.id,
        portfolio,
        policy.label,
        policy.version,
        priorPolicy ? priorPolicy.enabled : saved?.enabled === false ? 0 : 1,
        Number.isInteger(saved?.maxTickets)
          ? Math.min(100, Math.max(1, saved.maxTickets))
          : policy.maximum,
      ),
    ]);
  }
  for (const policy of await rows(
    c.db,
    "SELECT * FROM paper_policies WHERE strategyVersion IN('GENERAL_BROAD_PAPER_V1','GENERAL_VALUE_PAPER_V1','GENERAL_ASIAN_PAPER_V1') AND enabled=1",
  )) {
    await configurePaper(c, "retire-general-v1:" + policy.id, {
      id: policy.id,
      enabled: false,
      maximumPerDay: policy.maximumPerDay,
      expectedRevision: policy.revision,
    });
  }
}

export function validateGeneralOutput(o: any, modelId: string = UNIVERSAL_ID) {
  if (
    o?.variant !== modelId ||
    o.researchOnly !== true ||
    !["DONE", "BLOCKED"].includes(o.state) ||
    typeof o.reason !== "string"
  )
    throw Error("MODEL_OUTPUT_INVALID");
  if (o.state === "BLOCKED") {
    if (o.central !== null || o.grid !== null)
      throw Error("MODEL_OUTPUT_INVALID");
    return;
  }
  central(o.central);
  if (
    typeof o.uncertaintyMargin !== "number" ||
    !Number.isFinite(o.uncertaintyMargin) ||
    o.uncertaintyMargin < 0 ||
    o.uncertaintyMargin > 0.3 ||
    ![
      "NATIONAL_OPPONENT_ADJUSTED_POISSON",
      "CLUB_STANDINGS_POISSON",
      "MARKET_FORM_ONLY",
      "MARKET_ONLY",
    ].includes(o.basis)
  )
    throw Error("MODEL_OUTPUT_INVALID");
  if (o.grid !== null) {
    if (
      !Array.isArray(o.grid) ||
      o.grid.length < 2 ||
      o.grid.length > 21 ||
      o.grid.some(
        (r: any) =>
          !Array.isArray(r) ||
          r.length !== o.grid.length ||
          r.some(
            (p: any) =>
              typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1,
          ),
      ) ||
      Math.abs(o.grid.flat().reduce((a: number, b: number) => a + b, 0) - 1) >
        1e-8
    )
      throw Error("MODEL_OUTPUT_INVALID");
    const probabilities = [0, 0, 0];
    for (let i = 0; i < o.grid.length; i++)
      for (let j = 0; j < o.grid.length; j++)
        probabilities[i > j ? 0 : i === j ? 1 : 2] += o.grid[i][j];
    if (probabilities.some((p, i) => Math.abs(p - o.central[i]) > 1e-8))
      throw Error("MODEL_OUTPUT_INVALID");
  }
  if (
    o.grid === null &&
    ["NATIONAL_OPPONENT_ADJUSTED_POISSON", "CLUB_STANDINGS_POISSON"].includes(
      o.basis,
    )
  )
    throw Error("MODEL_OUTPUT_INVALID");
}
export function generalPricing(o: any, offered: any) {
  const states: Record<string, number> = {
    winFull: 0,
    winHalf: 0,
    push: 0,
    loseHalf: 0,
    loseFull: 0,
  };
  if (offered.market === "1X2") {
    const p = o.central[["HOME", "DRAW", "AWAY"].indexOf(offered.selection)];
    if (p === undefined || offered.lineQ !== null)
      throw Error("MARKET_MISMATCH");
    states.winFull = p;
    states.loseFull = 1 - p;
  } else {
    if (!o.grid) return null;
    for (let h = 0; h < o.grid.length; h++)
      for (let a = 0; a < o.grid.length; a++) {
        const f = multiplier(offered, { home: h, away: a }, "2").toNumber();
        const key =
          f === 2
            ? "winFull"
            : f === 1.5
              ? "winHalf"
              : f === 1
                ? "push"
                : f === 0.5
                  ? "loseHalf"
                  : "loseFull";
        states[key] += o.grid[h][a];
      }
  }
  const probability = states.winFull + states.winHalf,
    d = Number(offered.odds),
    margin = o.uncertaintyMargin;
  const slope = Math.max(0, states.winFull + states.winHalf / 2 - margin);
  const constant = states.winHalf / 2 + states.push + states.loseHalf / 2;
  const rawReturn = (states.winFull + states.winHalf / 2) * d + constant;
  const expectedReturn = Math.max(0, rawReturn - margin * d),
    ev = expectedReturn - 1;
  const conservativeProbability =
    offered.market === "1X2"
      ? Math.max(0.02, probability - margin)
      : probability;
  const rank = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        50 +
          Math.max(-25, Math.min(30, ev * 200)) +
          (conservativeProbability >= 0.55
            ? 8
            : conservativeProbability >= 0.4
              ? 4
              : conservativeProbability >= 0.25
                ? 0
                : -6) +
          (o.grid ? 8 : -6) -
          4,
      ),
    ),
  );
  const reasons: string[] = [];
  if (!o.grid) reasons.push("只有市场/战绩修正，缺独立进球依据");
  if (ev < 0.08) reasons.push("保守EV低于8%");
  if (ev > 0.2) reasons.push("模型与盘口偏差过大，需复核，不能当作已验证价值");
  if (conservativeProbability < 0.4) reasons.push("所选概率低于40%");
  if (d < 1.2 || d > 3) reasons.push("参考赔率不在1.20–3.00");
  if (rank < 75) reasons.push("研究排序低于75分");
  return {
    ...offered,
    scope: "REGULATION_90",
    states,
    probability,
    conservativeProbability,
    expectedReturn,
    rawReturn,
    estimatedEV: ev,
    rank,
    minimumOdds:
      slope > 0 ? Math.ceil(((1.08 - constant) / slope) * 100) / 100 : null,
    qualified: reasons.length === 0,
    reasons,
  };
}

export async function completeUniversal(c: Context, id: string, p: any) {
  const j = await one(c.db, "SELECT * FROM jobs WHERE id=?", id),
    b = await one(c.db, "SELECT * FROM input_bundles WHERE id=?", j.bundleId);
  const model = await one(
      c.db,
      "SELECT * FROM model_manifests WHERE id=?",
      j.modelId,
    ),
    input = JSON.parse(b.canonical);
  if (
    ![UNIVERSAL_ID, GENERAL_FIXED_ID].includes(j.modelId) ||
    p.bundleHash !== b.manifestHash ||
    p.modelHash !== model.manifestHash ||
    p.featureCanonical !== b.canonical ||
    (await sha(b.canonical)) !== b.manifestHash
  )
    throw Error("MODEL_HASH_MISMATCH");
  if (
    input.mode !== "LOCAL_RESEARCH" ||
    (
      await one(
        c.db,
        "SELECT mode FROM installations WHERE id=?",
        c.installationId,
      )
    ).mode !== "LOCAL_RESEARCH"
  )
    throw Error("MODE_MISMATCH");
  validateGeneralOutput(p.output, j.modelId);
  if (j.modelId === UNIVERSAL_ID) {
    if (
      !input.generalCalibration ||
      input.generalCalibration.effectiveAt > b.cutoffAt
    )
      throw Error("CALIBRATION_SNAPSHOT_MISSING");
    if (p.output.state === "DONE") {
      const a = p.output.adaptation;
      if (
        !a ||
        a.baseVariant !== GENERAL_FIXED_ID ||
        canonical(a.snapshot) !== canonical(input.generalCalibration)
      )
        throw Error("CALIBRATION_SNAPSHOT_MISMATCH");
      const calculated = calibrate(a.baseCentral, marketBaseline(input.odds), {
        modelTrust: input.generalCalibration.modelTrust,
        temperature: input.generalCalibration.temperature,
      });
      if (calculated.some((v, i) => Math.abs(v - p.output.central[i]) > 1e-8))
        throw Error("CALIBRATION_OUTPUT_MISMATCH");
    }
  }
  const requestHash = await sha(canonical(p.output));
  const prior = await stmt(
    c.db,
    "SELECT * FROM universal_observations WHERE jobId=?",
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
  const observation = uid(),
    feature = uid(),
    prediction = p.output.state === "DONE" ? uid() : null,
    output: any = {
      ...p.output,
      runnerOutputHash: requestHash,
      plans: [],
      evaluated: [],
    };
  const queries = [
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
  if (prediction) {
    queries.push(
      stmt(
        c.db,
        "INSERT INTO feature_snapshots VALUES(?,?,?,?,?)",
        feature,
        b.id,
        j.modelId,
        b.manifestHash,
        b.canonical,
      ),
      stmt(
        c.db,
        "INSERT INTO predictions VALUES(?,?,?,?,?,?,?,?)",
        prediction,
        b.slotId,
        input.revisionId,
        j.modelId,
        feature,
        c.now,
        canonical(p.output.central),
        await sha(
          canonical({
            modelId: j.modelId,
            bundleHash: b.manifestHash,
            output: p.output,
          }),
        ),
      ),
    );
    const base = await one(
        c.db,
        "SELECT * FROM quote_sets WHERE id=?",
        b.quoteSetId,
      ),
      selections = await rows(
        c.db,
        "SELECT * FROM quote_selections WHERE quoteSetId=?",
        b.quoteSetId,
      );
    const quoteMap = new Map(
      selections.map((q: any) => ["1X2:" + q.selection + ":" + null, q.id]),
    );
    // Freeze AH/TOTAL source prices as normalized quotes with the original source time.
    const grouped = new Map<string, any[]>();
    for (const offered of input.comparisonFeatures.offers) {
      if (offered.market === "1X2") continue;
      multiplier(offered, { home: 0, away: 0 }, offered.odds);
      const group =
        offered.market +
        ":" +
        (offered.market === "ASIAN_HANDICAP" && offered.selection === "AWAY"
          ? -offered.lineQ
          : offered.lineQ);
      grouped.set(group, [...(grouped.get(group) ?? []), offered]);
    }
    for (const [group, offered] of grouped) {
      if (
        offered.length !== 2 ||
        (offered[0].market === "ASIAN_HANDICAP"
          ? offered[0].lineQ !== -offered[1].lineQ
          : offered[0].lineQ !== offered[1].lineQ)
      )
        continue;
      const hash = await sha(input.fixtureId + ":REGULATION_90:" + group);
      const existing = await stmt(
          c.db,
          "SELECT id FROM market_definitions WHERE specHash=?",
          hash,
        ).first<any>(),
        market = existing?.id ?? uid(),
        set = uid();
      if (!existing)
        queries.push(
          stmt(
            c.db,
            "INSERT INTO market_definitions VALUES(?,?,?,'REGULATION_90',?)",
            market,
            input.fixtureId,
            hash,
            offered[0].market,
          ),
        );
      queries.push(
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
      );
      for (const q of offered) {
        const selection = uid();
        quoteMap.set(q.market + ":" + q.selection + ":" + q.lineQ, selection);
        queries.push(
          stmt(
            c.db,
            "INSERT INTO quote_selections VALUES(?,?,?,?,?,'decimal')",
            selection,
            set,
            q.selection,
            q.odds,
            q.odds,
          ),
        );
      }
    }
    const evaluated = input.comparisonFeatures.offers
      .map((o: any) => generalPricing(p.output, o))
      .filter(
        (e: any) =>
          e && quoteMap.has(e.market + ":" + e.selection + ":" + e.lineQ),
      );
    const age = c.now - base.observedAt,
      minutes = (Date.parse(input.kickoffAt) - c.now) / 60000;
    const timingReasons = [
      ...(age > 600000 ? ["报价超过10分钟"] : []),
      ...(minutes < 10 || minutes > 1440
        ? ["未处于赛前10分钟–24小时窗口"]
        : []),
    ];
    for (const e of evaluated) {
      e.reasons.push(...timingReasons);
      e.qualified = e.reasons.length === 0;
    }
    const broad = evaluated
      .filter((e: any) => e.market === "1X2" && Number(e.odds) >= 1.2)
      .sort((a: any, b: any) => b.probability - a.probability)[0];
    const value = evaluated
      .filter((e: any) => e.qualified)
      .sort((a: any, b: any) => b.estimatedEV - a.estimatedEV)[0];
    const asian = evaluated
      .filter((e: any) => e.qualified && e.market === "ASIAN_HANDICAP")
      .sort((a: any, b: any) => b.estimatedEV - a.estimatedEV)[0];
    const forced = ["1X2", "ASIAN_HANDICAP", "TOTAL_GOALS"]
      .map(
        (m) =>
          evaluated
            .filter((e: any) => e.market === m)
            .sort((a: any, b: any) => b.probability - a.probability)[0],
      )
      .filter(Boolean);
    const double = evaluated
      .filter(
        (e: any) =>
          e.qualified &&
          e.market === "1X2" &&
          e.conservativeProbability >= 0.5 &&
          Number(e.odds) <= 2.5,
      )
      .sort((a: any, b: any) => b.estimatedEV - a.estimatedEV)[0];
    const selected = [broad, value, asian, value, ...forced, double];
    const policies = [
      PAPER_STRATEGIES[0],
      PAPER_STRATEGIES[1],
      PAPER_STRATEGIES[2],
      PAPER_STRATEGIES[3],
      ...forced.map(() => PAPER_STRATEGIES[4]),
      PAPER_STRATEGIES[5],
    ];
    for (let i = 0; i < selected.length; i++) {
      const plan = selected[i];
      if (!plan) continue;
      const policy = policies[i],
        expectation = uid(),
        decision = uid(),
        benchmark =
          policy.legacyId === "all-singles" || policy.legacyId === "forced-fun",
        accepted = benchmark ? timingReasons.length === 0 : plan.qualified;
      queries.push(
        stmt(
          c.db,
          "INSERT INTO market_expectations VALUES(?,?,?,?,?,?,?)",
          expectation,
          prediction,
          quoteMap.get(plan.market + ":" + plan.selection + ":" + plan.lineQ),
          plan.expectedReturn,
          plan.estimatedEV,
          plan.conservativeProbability,
          "GENERAL_COHERENT_RETURN_V2:" + policy.id,
        ),
        stmt(
          c.db,
          "INSERT INTO decisions VALUES(?,?,?,?,?,?)",
          decision,
          expectation,
          accepted ? 1 : 0,
          accepted
            ? benchmark
              ? "PAPER_BENCHMARK_NOT_VALUE"
              : "UNVALIDATED_PAPER_VALUE"
            : timingReasons.join(";"),
          c.now,
          policy.version,
        ),
      );
      output.plans.push({
        ...plan,
        policyId: policy.id,
        policyLabel: policy.label,
        decisionId: decision,
        accepted,
        stakeAtoms: "20000000",
        origin: "PAPER_RESEARCH",
        isValue: !benchmark,
        ticketType: policy.legacyId === "double" ? "DOUBLE_LEG" : "SINGLE",
      });
    }
    output.evaluated = evaluated;
    output.quoteObservedAt = base.observedAt;
    output.marketProbabilities = marketBaseline(input.odds);
  }
  const json = canonical(output);
  queries.push(
    stmt(
      c.db,
      "INSERT INTO universal_observations VALUES(?,?,?,?,?,?,?,?,?)",
      observation,
      id,
      prediction,
      input.revisionId,
      b.id,
      output.state,
      json,
      await sha(json),
      c.now,
    ),
    stmt(
      c.db,
      "UPDATE jobs SET state=?,reason=?,leaseUntil=0 WHERE id=?",
      output.state,
      output.reason,
      id,
    ),
  );
  await atomic(c.db, queries, c.failAt);
  return { id: observation, predictionId: prediction, state: output.state };
}

export async function autoPaper(c: Context) {
  const installation = await one(
    c.db,
    "SELECT mode FROM installations WHERE id=?",
    c.installationId,
  );
  if (installation.mode !== "LOCAL_RESEARCH") return { placed: 0 };
  await registerUniversal(c);
  await prepareFunDouble(c);
  const candidates = await rows(
    c.db,
    "WITH latest AS MATERIALIZED(SELECT r2.fixtureId,d2.strategyVersion,MAX(d2.decidedAt) at FROM decisions d2 JOIN market_expectations e2 ON e2.id=d2.expectationId JOIN predictions p2 ON p2.id=e2.predictionId JOIN fixture_revisions r2 ON r2.id=p2.fixtureRevisionId JOIN fixtures lf ON lf.id=r2.fixtureId WHERE p2.modelId=? AND lf.status='SCHEDULED' AND r2.kickoffAt>? AND r2.kickoffAt<=? GROUP BY r2.fixtureId,d2.strategyVersion) SELECT d.id,d.strategyVersion,p.id portfolioId,p.revision,r.fixtureId,r.kickoffAt,cat.competition,e.ev FROM decisions d JOIN market_expectations e ON e.id=d.expectationId JOIN predictions pr ON pr.id=e.predictionId JOIN fixture_revisions r ON r.id=pr.fixtureRevisionId JOIN latest latest ON latest.fixtureId=r.fixtureId AND latest.strategyVersion=d.strategyVersion AND latest.at=d.decidedAt JOIN fixtures f ON f.id=r.fixtureId JOIN paper_policies pp ON pp.strategyVersion=d.strategyVersion JOIN portfolios p ON p.id=pp.portfolioId JOIN quote_selections q ON q.id=e.quoteSelectionId JOIN quote_sets qs ON qs.id=q.quoteSetId JOIN market_definitions m ON m.id=qs.marketId LEFT JOIN fixture_catalog cat ON cat.fixtureId=f.id WHERE pr.modelId=? AND d.accepted=1 AND pp.enabled=1 AND (SELECT COUNT(*) FROM tickets WHERE portfolioId=p.id AND placementDay=?)<pp.maximumPerDay AND NOT EXISTS(SELECT 1 FROM tickets t WHERE t.portfolioId=p.id AND t.businessKey IN(r.fixtureId||'|'||pr.modelId||'|'||d.strategyVersion||CASE WHEN pp.id='general-v2-forced-fun' THEN '|'||m.type ELSE '' END,r.fixtureId||'|GENERAL_FOOTBALL_RESEARCH_V2|'||d.strategyVersion||CASE WHEN pp.id='general-v2-forced-fun' THEN '|'||m.type ELSE '' END)) AND NOT EXISTS(SELECT 1 FROM tickets t JOIN ticket_legs l ON l.ticketId=t.id JOIN fixture_revisions fr ON fr.id=l.fixtureRevisionId WHERE pp.id IN('general-v2-double','general-fun-double-v1') AND t.portfolioId=p.id AND fr.fixtureId=r.fixtureId) AND f.status='SCHEDULED' AND r.kickoffAt>? AND r.kickoffAt<=? AND qs.observedAt>=? ORDER BY CASE WHEN d.reason='PAPER_BENCHMARK_NOT_VALUE' THEN 1 ELSE 0 END,e.ev DESC,r.kickoffAt LIMIT 1000",
    UNIVERSAL_ID,
    c.now + 600000,
    c.now + 86400000,
    UNIVERSAL_ID,
    accountingDay(c.now, "Europe/Berlin"),
    c.now + 600000,
    c.now + 86400000,
    c.now - 600000,
  );
  let placed = 0;
  const used = new Set<string>();
  for (const candidate of candidates) {
    if (used.has(candidate.fixtureId + "|" + candidate.strategyVersion))
      continue;
    const portfolio = await one(
      c.db,
      "SELECT revision FROM portfolios WHERE id=?",
      candidate.portfolioId,
    );
    try {
      if (
        ["GENERAL_DOUBLE_LEG_PAPER_V2", FUN_DOUBLE.version].includes(
          candidate.strategyVersion,
        )
      ) {
        const pair = candidates.find(
          (other) =>
            other.strategyVersion === candidate.strategyVersion &&
            !used.has(other.fixtureId + "|" + other.strategyVersion) &&
            other.fixtureId !== candidate.fixtureId &&
            (candidate.strategyVersion === FUN_DOUBLE.version ||
              (other.competition &&
                candidate.competition &&
                other.competition !== candidate.competition &&
                Math.abs(other.kickoffAt - candidate.kickoffAt) >=
                  12 * 3600000)),
        );
        if (!pair) continue;
        await placeDouble(c, "auto-double:" + candidate.id, {
          decisionIds: [candidate.id, pair.id],
          portfolioId: candidate.portfolioId,
          expectedRevision: portfolio.revision,
        });
        used.add(candidate.fixtureId + "|" + candidate.strategyVersion);
        used.add(pair.fixtureId + "|" + pair.strategyVersion);
      } else
        await place(c, "auto-paper:" + candidate.id, {
          decisionId: candidate.id,
          portfolioId: candidate.portfolioId,
          stakeAtoms: "20000000",
          expectedRevision: portfolio.revision,
        });
      placed++;
    } catch (e) {
      if (
        !/DUPLICATE_BUSINESS_ACTION|DAILY_LIMIT|REVISION_CONFLICT|QUOTE_STALE|KICKOFF_PASSED|POLICY_PAUSED|DOUBLE_LEGS_NOT_DIVERSIFIED|MODEL_CURRENTLY_FAILED/.test(
          String(e),
        )
      )
        throw e;
    }
  }
  return { placed };
}

export async function universalReport(
  c: Context,
  params = new URLSearchParams(),
) {
  const query = params.get("q")?.trim();
  const matchingRevisions = query
    ? (
        await rows(
          c.db,
          "SELECT r.id,f.home,f.away,cat.competition FROM fixture_revisions r JOIN fixtures f ON f.id=r.fixtureId LEFT JOIN fixture_catalog cat ON cat.fixtureId=f.id",
        )
      )
        .filter((r) =>
          matchesTeamSearch(
            query,
            [
              r.home,
              r.away,
              `${r.home} ${r.away}`,
              `${teamName(r.home, r.competition)} ${teamName(r.away, r.competition)}`,
            ],
            r.competition,
          ),
        )
        .map((r) => r.id)
    : null;
  const captured = await rows(
    c.db,
    `WITH newest AS MATERIALIZED(SELECT MAX((SELECT x.rowid FROM universal_observations x INDEXED BY universal_fixture_row JOIN jobs jx ON jx.id=x.jobId WHERE x.fixtureRevisionId=fr.id AND jx.modelId IN(?,?) ORDER BY x.rowid DESC LIMIT 1)) rowId FROM fixture_revisions fr WHERE (?='' OR fr.fixtureId=?) ${matchingRevisions ? "AND fr.id IN(SELECT value FROM json_each(?))" : ""} GROUP BY fr.fixtureId) SELECT o.*,r.fixtureId,r.kickoffAt,f.home,f.away,f.status fixtureStatus,cat.competition,b.cutoffAt,q.observedAt quoteObservedAt,q.providerId,pr.modelId FROM newest n JOIN universal_observations o ON o.rowid=n.rowId JOIN fixture_revisions r ON r.id=o.fixtureRevisionId JOIN fixtures f ON f.id=r.fixtureId JOIN input_bundles b ON b.id=o.bundleId JOIN quote_sets q ON q.id=b.quoteSetId LEFT JOIN fixture_catalog cat ON cat.fixtureId=f.id LEFT JOIN predictions pr ON pr.id=o.predictionId ORDER BY r.kickoffAt LIMIT 2000`,
    UNIVERSAL_ID,
    GENERAL_FIXED_ID,
    params.get("fixture") ?? "",
    params.get("fixture") ?? "",
    ...(matchingRevisions ? [JSON.stringify(matchingRevisions)] : []),
  );
  const records = captured.map(({ outputJson, ...r }: any) => {
    const full = JSON.parse(outputJson);
    const { grid, evaluated, goal, ...summary } = full;
    return {
      ...r,
      output: params.get("fixture")
        ? full
        : { ...summary, hasIndependent: !!grid },
      fresh: c.now - r.quoteObservedAt <= 600000 && r.quoteObservedAt <= c.now,
      actionable:
        r.fixtureStatus === "SCHEDULED" &&
        r.kickoffAt > c.now + 600000 &&
        r.kickoffAt <= c.now + 86400000,
    };
  });
  return {
    manifest: UNIVERSAL_MANIFEST,
    records,
    asOf: c.now,
    coverage: {
      totalN: records.length,
      analysedN: records.filter((r: any) => r.state === "DONE").length,
      independentN: records.filter(
        (r: any) => r.output.grid || r.output.hasIndependent,
      ).length,
      competitionN: new Set(
        records
          .filter((r: any) => r.state === "DONE")
          .map((r: any) => r.competition),
      ).size,
      discoveredCompetitionN: new Set(records.map((r: any) => r.competition))
        .size,
      valueN: records.filter(
        (r: any) =>
          r.fresh &&
          r.actionable &&
          r.output.plans?.some((p: any) => p.isValue && p.accepted),
      ).length,
    },
    limitations: [
      "通用研究方法，不是五大联赛V6的改名",
      "公开展示价按纸面假设记录；真实成交不可验证",
      "国家队友谊赛模型跨正式赛事迁移未验证；不自动晋升",
    ],
  };
}

export async function configurePaper(c: Context, key: string, p: any) {
  if (
    typeof p.id !== "string" ||
    typeof p.enabled !== "boolean" ||
    !Number.isInteger(p.maximumPerDay) ||
    p.maximumPerDay < 1 ||
    p.maximumPerDay > 100
  )
    throw Error("INVALID_FIELDS");
  const r = await receipt(c, "paper-policy", key, p);
  if (r.old) return { id: r.old.resultRef, replayed: true };
  if (
    (
      await one(
        c.db,
        "SELECT mode FROM installations WHERE id=?",
        c.installationId,
      )
    ).mode !== "LOCAL_RESEARCH"
  )
    throw Error("MODE_MISMATCH");
  const policy = await one(
    c.db,
    "SELECT * FROM paper_policies WHERE id=?",
    p.id,
  );
  if (
    p.enabled &&
    policy.id !== FUN_DOUBLE.id &&
    !PAPER_STRATEGIES.some((x) => x.id === policy.id)
  )
    throw Error("VARIANT_RETIRED");
  try {
    await atomic(
      c.db,
      [
        stmt(
          c.db,
          "INSERT INTO command_receipts VALUES(?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM paper_policies WHERE id=? AND revision=?) THEN 1 ELSE 0 END,?,?)",
          uid(),
          r.scope,
          key,
          r.hash,
          p.id,
          p.expectedRevision,
          p.id,
          c.now,
        ),
        stmt(
          c.db,
          "UPDATE paper_policies SET enabled=?,maximumPerDay=?,revision=revision+1 WHERE id=?",
          p.enabled ? 1 : 0,
          p.maximumPerDay,
          p.id,
        ),
      ],
      c.failAt,
    );
  } catch {
    const replay = await receipt(c, "paper-policy", key, p);
    if (replay.old) return { id: replay.old.resultRef, replayed: true };
    throw Error("REVISION_CONFLICT");
  }
  return { id: p.id };
}
