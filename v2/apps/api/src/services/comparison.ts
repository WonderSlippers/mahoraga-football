import { canonical, sha, central } from "../../../../packages/contracts";
import {
  COMPARISON_METHODS,
  FROZEN_V7,
} from "../../../../packages/domain/comparison";
import { multiplier } from "../../../../packages/domain";
import { atomic, one, rows, stmt, uid } from "../repositories/db";
import type { Context } from "./commands";

export async function registerComparison(c: Context) {
  for (const method of COMPARISON_METHODS) {
    const json = canonical({
      ...method,
      protocol: "FIRST_SUCCESSFUL_SAME_BUNDLE_V1",
      researchOnly: true,
      automaticPromotion: false,
    });
    const hash = await sha(json);
    await atomic(c.db, [
      stmt(
        c.db,
        "INSERT OR IGNORE INTO comparison_methods VALUES(?,?,?,?,?)",
        method.id,
        method.label,
        json,
        hash,
        c.now,
      ),
      stmt(
        c.db,
        "INSERT OR IGNORE INTO model_manifests VALUES(?,?,?,?,?)",
        method.id,
        json,
        hash,
        method.outputKind,
        "SHADOW_RESEARCH",
      ),
    ]);
    const existing = await one(
      c.db,
      "SELECT manifestHash FROM comparison_methods WHERE id=?",
      method.id,
    );
    if (existing.manifestHash !== hash) throw Error("MODEL_HASH_MISMATCH");
  }
}
export async function comparisonFeatures(c: Context, p: any) {
  if (typeof p.fixtureId !== "string" || !p.payload || !p.sources)
    throw Error("INVALID_FIELDS");
  const f = await one(
    c.db,
    "SELECT f.*,cat.competition,r.kickoffAt FROM fixtures f JOIN fixture_revisions r ON r.fixtureId=f.id AND f.currentRevision=r.revision JOIN fixture_catalog cat ON cat.fixtureId=f.id WHERE f.id=?",
    p.fixtureId,
  );
  if (
    f.status !== "SCHEDULED" ||
    f.kickoffAt <= c.now ||
    !["eng.1", "ger.1", "ita.1", "esp.1", "fra.1"].includes(f.competition)
  )
    throw Error("UNSUPPORTED_COMPETITION");
  if (
    p.payload.fixtureId !== f.id ||
    p.payload.competition !== f.competition ||
    !Number.isFinite(Date.parse(p.payload.historyLastDate)) ||
    Date.parse(p.payload.historyLastDate) >=
      Date.parse(
        new Date(Math.min(f.kickoffAt, c.now)).toISOString().slice(0, 10) +
          "T00:00:00Z",
      ) -
        2 * 86400000
  )
    throw Error("HISTORY_EMBARGO");
  if (
    p.payload.recipe !== "ORIGINAL_V6_LAGGED_RECIPE_V1" ||
    !p.payload.features ||
    Object.values(p.payload.features).some(
      (v) => typeof v !== "number" || !Number.isFinite(v),
    )
  )
    throw Error("FEATURE_MISSING");
  if (
    !Array.isArray(p.sources) ||
    !p.sources.length ||
    p.sources.some(
      (s: any) =>
        !/^[a-f0-9]{64}$/.test(s.sha256) ||
        !Number.isFinite(s.observedAt) ||
        s.observedAt > c.now ||
        typeof s.url !== "string",
    )
  )
    throw Error("SOURCE_REQUIRED");
  const payload = canonical(p.payload),
    sourceJson = canonical(p.sources),
    hash = await sha(payload + sourceJson);
  await stmt(
    c.db,
    "INSERT OR IGNORE INTO comparison_features VALUES(?,?,?,?,?)",
    f.id,
    hash,
    payload,
    sourceJson,
    c.now,
  ).run();
  return { fixtureId: f.id, featureHash: hash };
}
export async function completeComparison(c: Context, id: string, p: any) {
  const j = await one(c.db, "SELECT * FROM jobs WHERE id=?", id);
  const method = await one(
    c.db,
    "SELECT * FROM comparison_methods WHERE id=?",
    j.modelId,
  );
  const b = await one(
    c.db,
    "SELECT * FROM input_bundles WHERE id=?",
    j.bundleId,
  );
  if (
    p.bundleHash !== b.manifestHash ||
    p.modelHash !== method.manifestHash ||
    p.featureCanonical !== b.canonical ||
    (await sha(b.canonical)) !== b.manifestHash
  )
    throw Error("MODEL_HASH_MISMATCH");
  const output = p.output,
    input = JSON.parse(b.canonical);
  if (
    output?.variant !== method.id ||
    !["DONE", "BLOCKED"].includes(output.state) ||
    !Array.isArray(output.actions) ||
    output.actions.length > 2 ||
    typeof output.reason !== "string" ||
    output.researchOnly !== true
  )
    throw Error("MODEL_OUTPUT_INVALID");
  if (output.state === "BLOCKED" && output.actions.length)
    throw Error("MODEL_OUTPUT_INVALID");
  if (output.central !== null) central(output.central);
  if (method.id.startsWith("V6") && output.central !== null)
    throw Error("STRESS_NORMALIZATION_FORBIDDEN");
  if (
    output.stressBySelection &&
    Object.values(output.stressBySelection).some(
      (v) =>
        v !== null &&
        (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1),
    )
  )
    throw Error("MODEL_OUTPUT_INVALID");
  for (const a of output.actions) {
    if (
      !["BROAD_1X2", "FEATURED_BEST_MARKET", "V6_NATIVE"].includes(
        a.strategy,
      ) ||
      typeof a.probability !== "number" ||
      !Number.isFinite(a.probability) ||
      a.probability < 0 ||
      a.probability > 1 ||
      !Number.isFinite(a.estimatedEV)
    )
      throw Error("MODEL_OUTPUT_INVALID");
    const offered = input.comparisonFeatures?.offers?.find(
      (o: any) =>
        o.market === a.market &&
        o.selection === a.selection &&
        o.lineQ === a.lineQ &&
        o.odds === a.odds,
    );
    if (!offered) throw Error("QUOTE_MISMATCH");
    if (
      method.id.startsWith("V6") &&
      (a.strategy !== "V6_NATIVE" ||
        a.market !== "1X2" ||
        a.probability !== output.stressBySelection?.[a.selection])
    )
      throw Error("MODEL_OUTPUT_INVALID");
    if (!method.id.startsWith("V6") && a.strategy === "V6_NATIVE")
      throw Error("MODEL_OUTPUT_INVALID");
    if (Math.abs(a.probability * Number(a.odds) - 1 - a.estimatedEV) > 1e-10)
      throw Error("MODEL_OUTPUT_INVALID");
    multiplier(a, { home: 0, away: 0 }, a.odds); // Validate the frozen market with the existing settlement mathematics.
  }
  const json = canonical(output),
    hash = await sha(json);
  const old = await stmt(
    c.db,
    "SELECT * FROM comparison_observations WHERE jobId=?",
    id,
  ).first<any>();
  if (old) {
    if (
      j.leaseOwner !== p.owner ||
      j.fencingToken !== p.fencingToken ||
      old.outputHash !== hash
    )
      throw Error("IDEMPOTENCY_CONFLICT");
    return { id: old.id, state: old.state };
  }
  if (c.now < b.cutoffAt || c.now >= Date.parse(input.kickoffAt))
    throw Error("FEATURE_LATE");
  const record = uid();
  await atomic(c.db, [
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
    stmt(
      c.db,
      "INSERT INTO comparison_observations VALUES(?,?,?,?,?,?,?,?,?)",
      record,
      id,
      method.id,
      input.revisionId,
      b.id,
      output.state,
      json,
      hash,
      c.now,
    ),
    stmt(
      c.db,
      "UPDATE jobs SET state=?,reason=?,leaseUntil=0 WHERE id=?",
      output.state,
      output.reason ?? null,
      id,
    ),
  ]);
  return { id: record, state: output.state };
}
export async function comparisonReport(
  c: Context,
  params = new URLSearchParams(),
) {
  const methods = await rows(
    c.db,
    "SELECT * FROM comparison_methods ORDER BY frozenAt,id",
  );
  methods.sort(
    (a: any, b: any) => +b.id.startsWith("V6") - +a.id.startsWith("V6"),
  );
  const captureBefore = params.has("before")
    ? Number(params.get("before"))
    : c.now;
  const exportOffset = Number(params.get("offset") || 0);
  const limits = await one(
    c.db,
    "SELECT COALESCE((SELECT MAX(rowid) FROM comparison_observations),0) observationSequence,COALESCE((SELECT MAX(rowid) FROM result_adjudications),0) adjudicationSequence",
  );
  const observationSequence = params.has("sequence")
    ? Number(params.get("sequence"))
    : limits.observationSequence;
  const adjudicationSequence = params.has("adjudicationSequence")
    ? Number(params.get("adjudicationSequence"))
    : limits.adjudicationSequence;
  if (
    !Number.isSafeInteger(observationSequence) ||
    observationSequence < 0 ||
    observationSequence > limits.observationSequence ||
    !Number.isSafeInteger(adjudicationSequence) ||
    adjudicationSequence < 0 ||
    adjudicationSequence > limits.adjudicationSequence
  )
    throw Error("INVALID_FIELDS");
  if (
    !Number.isSafeInteger(captureBefore) ||
    captureBefore < 0 ||
    captureBefore > c.now ||
    !Number.isSafeInteger(exportOffset) ||
    exportOffset < 0
  )
    throw Error("INVALID_FIELDS");
  const records: any[] = [];
  for (let cursor = 0; ; ) {
    const page = await rows(
      c.db,
      "SELECT o.*,o.rowid reportRowId,b.cutoffAt,b.quoteSetId,q.observedAt quoteObservedAt,q.providerUpdatedAt quoteProviderUpdatedAt,q.providerId quoteProviderId,r.fixtureId,r.kickoffAt,f.home,f.away,f.status fixtureStatus,cat.competition,(SELECT a.state FROM result_adjudications a WHERE a.fixtureId=r.fixtureId AND a.rowid<=? ORDER BY a.revision DESC LIMIT 1) resultState,(SELECT a.regulationJson FROM result_adjudications a WHERE a.fixtureId=r.fixtureId AND a.rowid<=? ORDER BY a.revision DESC LIMIT 1) regulationJson,(SELECT a.id FROM result_adjudications a WHERE a.fixtureId=r.fixtureId AND a.rowid<=? ORDER BY a.revision DESC LIMIT 1) adjudicationId FROM comparison_observations o JOIN input_bundles b ON b.id=o.bundleId JOIN quote_sets q ON q.id=b.quoteSetId JOIN fixture_revisions r ON r.id=o.fixtureRevisionId JOIN fixtures f ON f.id=r.fixtureId LEFT JOIN fixture_catalog cat ON cat.fixtureId=f.id WHERE o.calculatedAt<=? AND o.rowid<=? AND o.rowid>? AND (?='' OR r.fixtureId=?) ORDER BY o.rowid LIMIT 1000",
      adjudicationSequence,
      adjudicationSequence,
      adjudicationSequence,
      captureBefore,
      observationSequence,
      cursor,
      params.get("fixture") ?? "",
      params.get("fixture") ?? "",
    );
    records.push(...page);
    if (page.length < 1000) break;
    cursor = page[page.length - 1].reportRowId;
  }
  records.sort(
    (a, b) =>
      a.cutoffAt - b.cutoffAt ||
      a.calculatedAt - b.calculatedAt ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const filtered: any[] = records
    .filter(
      (r) =>
        (!params.get("league") ||
          params.get("league") === "ALL" ||
          params.get("league") === r.competition) &&
        (!params.get("fixture") || params.get("fixture") === r.fixtureId),
    )
    .map((r) => ({ ...r, output: JSON.parse(r.outputJson) }));
  const first = new Map<string, any>();
  const latest = new Map<string, any>();
  const trackedDirections = new Map<string, any>();
  for (const r of filtered) latest.set(r.fixtureId + "|" + r.methodId, r);
  for (const r of filtered.filter(
    (r) => r.state === "DONE" && r.output.actions.length,
  ))
    trackedDirections.set(r.fixtureId + "|" + r.methodId, r);
  for (const r of filtered.filter((r) => r.state === "DONE")) {
    const k = r.fixtureId + "|" + r.methodId;
    if (!first.has(k)) first.set(k, r);
  }
  const pairedBundles = new Set<string>();
  const paired = new Map<string, Set<string>>();
  for (const r of filtered.filter((r) => r.state === "DONE")) {
    const set = paired.get(r.bundleId) ?? new Set<string>();
    set.add(r.methodId);
    paired.set(r.bundleId, set);
  }
  for (const [bundle, set] of paired)
    if (COMPARISON_METHODS.every((m) => set.has(m.id)))
      pairedBundles.add(bundle);
  const commonFirst = new Map<string, any>(),
    selectedBundle = new Map<string, string>();
  for (const r of filtered.filter(
    (r) => r.state === "DONE" && pairedBundles.has(r.bundleId),
  )) {
    if (!selectedBundle.has(r.fixtureId))
      selectedBundle.set(r.fixtureId, r.bundleId);
    if (selectedBundle.get(r.fixtureId) !== r.bundleId) continue;
    const k = r.fixtureId + "|" + r.methodId;
    if (!commonFirst.has(k)) commonFirst.set(k, r);
  }
  const metrics = (
    sample: any[],
    strategy: string,
    oddsRange?: [number, number],
  ) => {
    const actions = sample.flatMap((r) =>
      r.output.actions
        .filter(
          (a: any) =>
            a.strategy === strategy &&
            (!oddsRange ||
              (Number(a.odds) >= oddsRange[0] &&
                Number(a.odds) < oddsRange[1])),
        )
        .map((a: any) => ({
          ...a,
          fixtureId: r.fixtureId,
          cutoffAt: r.cutoffAt,
          kickoffAt: r.kickoffAt,
          adjudicationId: r.adjudicationId,
          pnl:
            r.resultState === "ACCEPTED_REGULATION" && r.regulationJson
              ? multiplier(a, JSON.parse(r.regulationJson), a.odds)
                  .minus(1)
                  .toNumber()
              : null,
        })),
    );
    const settled = actions.filter((a) => a.pnl !== null),
      n = settled.length;
    let net = 0,
      peak = 0,
      drawdown = 0;
    for (const a of settled.sort(
      (a, b) =>
        a.kickoffAt - b.kickoffAt || a.fixtureId.localeCompare(b.fixtureId),
    )) {
      net += a.pnl;
      peak = Math.max(peak, net);
      drawdown = Math.max(drawdown, peak - net);
    }
    const centralRows = sample.filter(
      (r) =>
        r.resultState === "ACCEPTED_REGULATION" &&
        r.regulationJson &&
        r.output.central,
    );
    let ll = 0,
      bs = 0;
    const bins = Array.from({ length: 10 }, (_, i) => ({
      lower: i / 10,
      n: 0,
      predicted: 0,
      observed: 0,
    }));
    for (const r of centralRows) {
      const s = JSON.parse(r.regulationJson),
        outcome = s.home > s.away ? 0 : s.home === s.away ? 1 : 2;
      ll -= Math.log(Math.max(1e-15, r.output.central[outcome]));
      r.output.central.forEach((p: number, i: number) => {
        bs += (p - +(i === outcome)) ** 2;
        const b = bins[Math.min(9, Math.floor(p * 10))];
        b.n++;
        b.predicted += p;
        b.observed += +(i === outcome);
      });
    }
    return {
      predictionN: sample.length,
      actionN: actions.length,
      settledN: n,
      openN: actions.length - n,
      wins: settled.filter((a) => a.pnl > 0).length,
      losses: settled.filter((a) => a.pnl < 0).length,
      pushes: settled.filter((a) => a.pnl === 0).length,
      stakeUnits: n,
      netUnits: n ? net : null,
      roi: n ? net / n : null,
      averageOdds: actions.length
        ? actions.reduce((s, a) => s + Number(a.odds), 0) / actions.length
        : null,
      drawdown: n ? drawdown : null,
      probabilityN: centralRows.length,
      logLoss: centralRows.length ? ll / centralRows.length : null,
      brier: centralRows.length ? bs / centralRows.length : null,
      calibration: bins
        .filter((b) => b.n)
        .map((b) => ({
          ...b,
          predicted: b.predicted / b.n,
          observed: b.observed / b.n,
        })),
    };
  };
  return {
    asOf: c.now,
    scope: "FORWARD_CAPTURED_PUBLIC_REFERENCE_SHADOW",
    protocol: "FIRST_SUCCESSFUL_SAME_BUNDLE_V1",
    unitStake: 1,
    savedV7: FROZEN_V7,
    commonFixtureN: new Set([...commonFirst.values()].map((r) => r.fixtureId))
      .size,
    methods: methods.map((m: any) => {
      const methodRows = filtered.filter((r) => r.methodId === m.id),
        samples = [...first.values()].filter((r) => r.methodId === m.id),
        common = [...commonFirst.values()].filter((r) => r.methodId === m.id),
        strategies = m.id.startsWith("V6")
          ? ["V6_NATIVE"]
          : ["BROAD_1X2", "FEATURED_BEST_MARKET"];
      const reasons: Record<string, number> = {};
      for (const r of methodRows.filter((r) => r.state === "BLOCKED"))
        reasons[r.output.reason] = (reasons[r.output.reason] ?? 0) + 1;
      return {
        ...m,
        manifest: JSON.parse(m.manifestJson),
        capturedFixtureN: new Set(methodRows.map((r) => r.fixtureId)).size,
        successfulFixtureN: samples.length,
        blockedReasons: reasons,
        metrics: strategies.map((strategy) => ({
          strategy,
          all: metrics(samples, strategy),
          common: metrics(common, strategy),
          breakdown: {
            leagues: [...new Set(samples.map((r) => r.competition))].map(
              (league) => ({
                label: league,
                all: metrics(
                  samples.filter((r) => r.competition === league),
                  strategy,
                ),
                common: metrics(
                  common.filter((r) => r.competition === league),
                  strategy,
                ),
              }),
            ),
            seasons: [
              ...new Set(
                samples.map((r) => {
                  const d = new Date(r.kickoffAt);
                  return d.getUTCFullYear() - +(d.getUTCMonth() < 6);
                }),
              ),
            ].map((season) => ({
              label: `${season}/${season + 1}`,
              all: metrics(
                samples.filter((r) => {
                  const d = new Date(r.kickoffAt);
                  return d.getUTCFullYear() - +(d.getUTCMonth() < 6) === season;
                }),
                strategy,
              ),
              common: metrics(
                common.filter((r) => {
                  const d = new Date(r.kickoffAt);
                  return d.getUTCFullYear() - +(d.getUTCMonth() < 6) === season;
                }),
                strategy,
              ),
            })),
            odds: (
              [
                [1, 1.8],
                [1.8, 2.5],
                [2.5, 4],
                [4, Infinity],
              ] as [number, number][]
            ).map((range) => ({
              label: `${range[0]}–${range[1] === Infinity ? "∞" : range[1]}`,
              all: metrics(
                samples.filter((r) =>
                  r.output.actions.some(
                    (a: any) =>
                      a.strategy === strategy &&
                      Number(a.odds) >= range[0] &&
                      Number(a.odds) < range[1],
                  ),
                ),
                strategy,
                range,
              ),
              common: metrics(
                common.filter((r) =>
                  r.output.actions.some(
                    (a: any) =>
                      a.strategy === strategy &&
                      Number(a.odds) >= range[0] &&
                      Number(a.odds) < range[1],
                  ),
                ),
                strategy,
                range,
              ),
            })),
          },
        })),
      };
    }),
    records:
      params.get("export") === "1"
        ? filtered.slice(exportOffset, exportOffset + 200)
        : filtered.slice(-40).reverse(),
    recordCaptureBeforeAt: captureBefore,
    observationSequence,
    adjudicationSequence,
    exportNextOffset:
      params.get("export") === "1" && exportOffset + 200 < filtered.length
        ? exportOffset + 200
        : null,
    successfulRecords: [...first.values()]
      .sort((a, b) => b.cutoffAt - a.cutoffAt)
      .slice(0, 40),
    latestRecords: [...latest.values()]
      .sort((a, b) => b.cutoffAt - a.cutoffAt)
      .slice(0, 100),
    currentDirections: [...latest.values()]
      .filter(
        (r) =>
          r.kickoffAt > c.now &&
          r.fixtureStatus === "SCHEDULED" &&
          r.state === "DONE" &&
          r.output.actions.length,
      )
      .sort(
        (a, b) =>
          +b.output.actions.some((v: any) => v.estimatedEV > 0) -
            +a.output.actions.some((v: any) => v.estimatedEV > 0) ||
          +b.methodId.startsWith("V6") - +a.methodId.startsWith("V6") ||
          b.cutoffAt - a.cutoffAt,
      ),
    trackedDirections: [...trackedDirections.values()].sort(
      (a, b) => b.kickoffAt - a.kickoffAt,
    ),
    totalRecords: filtered.length,
    limitations: [
      "公开参考报价；未计手续费和滑点",
      "记录发生在赛前，但不是严格报价资格验证",
      "共同样本与各自覆盖分开；重复刷新不增加比赛N",
      "结果只取最新裁定；冲突进入复核，更正不改原预测",
      "旧版默认参数快照不能证明当晚未提交运行代码完全相同",
      "V6压力值不归一化；无行动或未结ROI为空",
      "没有足够已结共同样本时不宣布优胜或自动晋升",
    ],
  };
}
