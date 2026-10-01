import { rows, stmt, uid } from "../repositories/db";
import type { Context } from "./commands";
import { canonical, sha } from "../../../../packages/contracts/index";

const parse = (s: any, fallback: any = null) => {
  try {
    return typeof s === "string" ? JSON.parse(s) : (s ?? fallback);
  } catch {
    return fallback;
  }
};
const stamp = (x: any): number | null => {
  const n =
    typeof x === "number" ? x : typeof x === "string" ? Date.parse(x) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const finite = (x: any): number | null =>
  typeof x === "number" && Number.isFinite(x) ? x : null;
export const localDay = (at: number) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
export function rangeStart(period: string, now: number) {
  const day = localDay(now),
    start = Date.parse(day + "T00:00:00+08:00");
  if (period === "TODAY") return start;
  if (period === "WEEK")
    return (
      start - ((new Date(start + 28800000).getUTCDay() + 6) % 7) * 86400000
    );
  if (period === "MONTH")
    return Date.parse(day.slice(0, 7) + "-01T00:00:00+08:00");
  if (period === "SEASON")
    return Date.parse(
      `${Number(day.slice(0, 4)) - (Number(day.slice(5, 7)) < 7 ? 1 : 0)}-07-01T00:00:00+08:00`,
    );
  return 0;
}
export function rowMatches(r: any, p: URLSearchParams, now: number) {
  if (
    p.get("period") &&
    p.get("period") !== "ALL" &&
    (r.at === null || r.at < rangeStart(p.get("period")!, now))
  )
    return false;
  for (const k of [
    "league",
    "model",
    "market",
    "strategy",
    "portfolio",
    "currency",
  ]) {
    const v = p.get(k);
    if (v && v !== "ALL" && !r[k + "s"]?.includes(v) && r[k] !== v)
      return false;
  }
  const day = r.at ? localDay(r.at) : null;
  if (p.get("from") && (!day || day < p.get("from")!)) return false;
  if (p.get("to") && (!day || day > p.get("to")!)) return false;
  const odds = p.get("odds");
  if (
    odds &&
    odds !== "ALL" &&
    (r.odds === null ||
      !(odds === "LOW"
        ? r.odds < 1.8
        : odds === "MID"
          ? r.odds >= 1.8 && r.odds < 2.5
          : r.odds >= 2.5))
  )
    return false;
  const score = p.get("score");
  if (
    score &&
    score !== "ALL" &&
    (r.score === null ||
      !(score === "HIGH"
        ? r.score >= 75
        : score === "MID"
          ? r.score >= 45 && r.score < 75
          : r.score < 45))
  )
    return false;
  const q = p.get("q")?.toLowerCase();
  return (
    !q || JSON.stringify([r.title, r.id, r.portfolio]).toLowerCase().includes(q)
  );
}
export function summarizeRecords(records: any[]) {
  const currencies = [...new Set(records.map((r) => r.currency))];
  let stake = 0n,
    settledStake = 0n,
    profit = 0n,
    curve = 0n,
    peak = 0n,
    drawdown = 0n;
  let missingStake = 0,
    missingProfit = 0,
    wins = 0,
    losses = 0,
    settled = 0,
    open = 0,
    unknownStatus = 0;
  const points: any[] = [];
  for (const r of [...records].sort(
    (a, b) =>
      (a.settledAt ?? a.at ?? 0) - (b.settledAt ?? b.at ?? 0) ||
      a.id.localeCompare(b.id),
  )) {
    if (r.stakeAtoms === null) missingStake++;
    else stake += BigInt(r.stakeAtoms);
    if (
      ["OPEN", "REVIEW", "REOPENED", "PENDING", "UNSETTLED"].includes(
        r.status.toUpperCase(),
      )
    ) {
      open++;
      continue;
    }
    if (
      ![
        "SETTLED",
        "REPORTED",
        "WIN",
        "LOSS",
        "WON",
        "LOST",
        "VOID",
        "PUSH",
        "CANCELLED",
      ].includes(r.status.toUpperCase())
    ) {
      unknownStatus++;
      missingProfit++;
      continue;
    }
    settled++;
    if (r.stakeAtoms !== null) settledStake += BigInt(r.stakeAtoms);
    if (r.pnlAtoms === null) {
      missingProfit++;
      continue;
    }
    const pnl = BigInt(r.pnlAtoms);
    profit += pnl;
    curve += pnl;
    if (curve > peak) peak = curve;
    if (peak - curve > drawdown) drawdown = peak - curve;
    if (pnl > 0n) wins++;
    if (pnl < 0n) losses++;
    points.push({ at: r.settledAt ?? r.at, profitAtoms: String(curve) });
  }
  const comparable = currencies.length <= 1;
  return {
    count: records.length,
    currencies,
    stakeAtoms: comparable && !missingStake ? String(stake) : null,
    settledStakeAtoms: comparable ? String(settledStake) : null,
    profitAtoms: comparable && !missingProfit ? String(profit) : null,
    roi:
      comparable && !missingStake && !missingProfit && settledStake > 0n
        ? Number(profit) / Number(settledStake)
        : null,
    maxDrawdownAtoms: comparable && !missingProfit ? String(drawdown) : null,
    wins,
    losses,
    open,
    settled,
    unknownStatus,
    missingStake,
    missingProfit,
    avgOdds: records.filter((r) => r.odds !== null).length
      ? records.filter((r) => r.odds !== null).reduce((s, r) => s + r.odds, 0) /
        records.filter((r) => r.odds !== null).length
      : null,
    curve: comparable && !missingProfit ? points : [],
    roiDenominator: "KNOWN_SETTLED_STAKE",
    incomplete: !!(missingStake || missingProfit),
    currencyMixed: !comparable,
  };
}
export async function workspaceMetadata(db: D1Database) {
  const x = await stmt(
    db,
    "SELECT * FROM workspace_imports ORDER BY importedAt DESC LIMIT 1",
  ).first<any>();
  const { savedQuoteIndex, savedFixtureIndex, ...metadata } = parse(
    x?.metadataJson,
    {},
  );
  return x
    ? {
        id: x.id,
        sourceHash: x.sourceHash,
        sourceCutoffAt: x.sourceCutoffAt,
        importedAt: x.importedAt,
        ...metadata,
      }
    : { leagues: [], strategies: [], settings: {}, sourceCutoffAt: null };
}
export async function historyRows(db: D1Database) {
  const records = await rows(
    db,
    "SELECT a.* FROM archive_records a JOIN import_batches b ON b.id=a.batchId WHERE b.state='COMMITTED' LIMIT 10001",
  );
  if (records.length > 10000) throw Error("HISTORY_CAPACITY_REQUIRES_PAGING");
  const linked = new Map<string, any[]>();
  for (const cat of await rows(
    db,
    "SELECT fixtureId,dataJson FROM fixture_catalog",
  )) {
    const f = parse(cat.dataJson, {});
    for (const id of new Set(f.archiveIds || []))
      linked.set(String(id), [
        ...(linked.get(String(id)) || []),
        { id: cat.fixtureId, home: f.home, away: f.away },
      ]);
  }
  const metadata: any = await workspaceMetadata(db);
  const observations = (metadata.savedResearchObservations || []).map(
    (a: any) => {
      const l = a.raw.leg || {};
      return {
        id: "legacy-observation:" + a.contentHash,
        fixtureLinks: [],
        kind: "RESEARCH_OBSERVATION",
        mode: "LEGACY_IMPORT",
        title: [l.home, l.away].filter(Boolean).join(" — ") || "原研究观测",
        portfolio: "旧研究观测",
        strategy: "旧研究观测",
        leagues: l.leagueCode ? [l.leagueCode] : [],
        models: l.evidence?.modelVersion ? [l.evidence.modelVersion] : [],
        markets: [l.marketType ?? l.market ?? "1X2"],
        at: stamp(l.evidence?.calculatedAt),
        settledAt: null,
        odds: finite(l.odds),
        score: finite(l.score),
        stakeAtoms: null,
        pnlAtoms: null,
        status: "NON_PROSPECTIVE",
        currency: "UNKNOWN",
        legCount: 1,
        hash: a.contentHash,
        raw: a.raw,
        collections: a.collections,
        warnings: [
          "原研究值未经前瞻验证；计算时间不是报价时间；不计入票据账本",
        ],
      };
    },
  );
  return [
    ...records.map((a) => {
      const raw = parse(a.rawJson, {}),
        legs = Array.isArray(raw.legs) ? raw.legs : [raw];
      const leagues = [
        ...new Set(
          legs
            .map((l: any) => l.leagueCode ?? l.league_code ?? raw.league_code)
            .filter(Boolean),
        ),
      ];
      const models = [
        ...new Set(
          legs
            .map(
              (l: any) =>
                l.evidence?.modelVersion ??
                l.modelVersion ??
                raw.model_version ??
                raw.modelVersion,
            )
            .filter(Boolean),
        ),
      ];
      const markets = [
        ...new Set(
          legs.map(
            (l: any) =>
              l.marketType ??
              l.market ??
              (l.handicap !== undefined || l.spread !== undefined
                ? "AH"
                : l.total !== undefined
                  ? "OU"
                  : "1X2"),
          ),
        ),
      ];
      const at = stamp(
        raw.createdAt ??
          raw.captured_at ??
          raw.observed_at ??
          raw.kickoffAt ??
          raw.date ??
          raw.day,
      );
      return {
        id: a.id,
        fixtureLinks: linked.get(a.id) || [],
        kind: a.kind,
        mode: "LEGACY_IMPORT",
        title:
          legs
            .map((l: any) => [l.home, l.away].filter(Boolean).join(" — "))
            .filter(Boolean)
            .join(" / ") ||
          raw.match_id ||
          raw.fileName ||
          a.originalId ||
          a.kind,
        portfolio: a.portfolio,
        strategy: a.portfolio,
        leagues,
        models,
        markets,
        at,
        settledAt: stamp(raw.settledAt),
        odds: finite(raw.odds),
        score: finite(raw.score ?? raw.gradeScore ?? legs[0]?.score),
        stakeAtoms: a.stakeAtoms ?? null,
        pnlAtoms: a.pnlAtoms ?? null,
        status: a.status ?? raw.status ?? "UNKNOWN",
        currency: a.currency ?? "UNKNOWN",
        legCount: a.legCount,
        hash: a.contentHash,
        raw,
        warnings: parse(a.warningsJson, []),
      };
    }),
    ...observations,
  ];
}
export async function ledgerRows(db: D1Database, mode: string) {
  if (mode === "LEGACY_IMPORT")
    return (await historyRows(db)).filter((r) => r.kind === "TICKET");
  if (mode === "USER_REPORTED") {
    const x = await rows(
      db,
      "SELECT e.* FROM reported_trade_events e WHERE e.revision=(SELECT MAX(r.revision) FROM reported_trade_events r WHERE r.account=e.account AND r.externalKey=e.externalKey) LIMIT 10001",
    );
    if (x.length > 10000) throw Error("LEDGER_CAPACITY_REQUIRES_PAGING");
    return x.map((r) => ({
      id: r.id,
      title: r.description,
      at: r.at,
      settledAt: r.at,
      mode,
      portfolio: r.account,
      strategy: r.account,
      leagues: [],
      models: [],
      markets: [],
      odds: null,
      score: null,
      stakeAtoms: r.stakeAtoms,
      pnlAtoms:
        r.grossClaimAtoms === null
          ? null
          : String(BigInt(r.grossClaimAtoms) - BigInt(r.stakeAtoms)),
      status: r.grossClaimAtoms === null ? "OPEN" : "REPORTED",
      currency: r.currency,
      raw: r,
    }));
  }
  const x = await rows(
    db,
    "SELECT t.*,s.currentStatus,s.gross,l.predictionId,l.frozenOdds,l.selection,r.fixtureId,f.home,f.away,p.modelId,c.competition,(SELECT MAX(at) FROM settlement_events se WHERE se.ticketId=t.id) settledAt FROM tickets t JOIN ticket_state s ON s.ticketId=t.id JOIN ticket_legs l ON l.ticketId=t.id JOIN fixture_revisions r ON r.id=l.fixtureRevisionId JOIN fixtures f ON f.id=r.fixtureId JOIN predictions p ON p.id=l.predictionId LEFT JOIN fixture_catalog c ON c.fixtureId=f.id ORDER BY t.createdAt LIMIT 10001",
  );
  if (x.length > 10000) throw Error("LEDGER_CAPACITY_REQUIRES_PAGING");
  return x.map((r) => ({
    id: r.id,
    title: r.home + " — " + r.away,
    at: r.createdAt,
    settledAt: r.settledAt,
    mode: "PAPER",
    portfolio: r.portfolioId,
    strategy: r.portfolioId,
    leagues: r.competition ? [r.competition] : ["DEMO"],
    models: [r.modelId],
    markets: ["1X2"],
    odds: Number(r.frozenOdds),
    score: null,
    stakeAtoms: String(r.stakeAtoms),
    pnlAtoms: ["OPEN", "REVIEW", "REOPENED"].includes(r.currentStatus)
      ? null
      : String(BigInt(r.gross) - BigInt(r.stakeAtoms)),
    status: r.currentStatus,
    currency: "PAPER",
    raw: r,
  }));
}
export async function workspaceReport(
  c: Context,
  p: URLSearchParams,
  type: "history" | "ledger",
) {
  const mode = p.get("mode") || "LEGACY_IMPORT";
  if (!["LEGACY_IMPORT", "PAPER", "USER_REPORTED"].includes(mode))
    throw Error("INVALID_FILTER");
  const all =
    type === "history" ? await historyRows(c.db) : await ledgerRows(c.db, mode);
  const filtered = all.filter((r) => rowMatches(r, p, c.now));
  const offset = Number(p.get("offset") || 0);
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw Error("INVALID_CURSOR");
  const sorted = [...filtered].sort(
    (a, b) => (b.at ?? 0) - (a.at ?? 0) || a.id.localeCompare(b.id),
  );
  const dimensions: any = {};
  for (const k of [
    "leagues",
    "models",
    "markets",
    "portfolio",
    "strategy",
    "currency",
  ])
    dimensions[k] = [
      ...new Set(
        all
          .flatMap((r: any) => (Array.isArray(r[k]) ? r[k] : [r[k]]))
          .filter(Boolean),
      ),
    ].sort();
  return {
    items: sorted.slice(offset, offset + 40),
    total: sorted.length,
    nextOffset: offset + 40 < sorted.length ? offset + 40 : null,
    summary: summarizeRecords(filtered),
    dimensions,
    asOf: c.now,
    sourceCutoffAt: (await workspaceMetadata(c.db)).sourceCutoffAt,
    scope: type === "history" ? "LEGACY_NON_PROSPECTIVE" : mode,
  };
}
export function fixtureStatus(f: any, now: number) {
  if (f.status === "FINISHED")
    return { state: "FINISHED", label: "已结束", reason: "赛前预测保持冻结" };
  if (f.kickoffAt <= now)
    return {
      state: "STARTED",
      label: "已开赛",
      reason: "停止赛前候选，不补造预测",
    };
  if (f.failedJobs > 0)
    return {
      state: "MODEL_FAILED",
      label: "模型失败",
      reason: "推断任务失败，等待重试或复核",
    };
  if (f.quoteAt && now - f.quoteAt > 600000)
    return {
      state: "STALE_QUOTE",
      label: "报价失效",
      reason: "抓取超过10分钟，原报价时间保留",
    };
  if (f.accepted > 0)
    return {
      state: "CANDIDATE",
      label: "候选",
      reason: "查看固定决策及验证状态",
    };
  if (f.predictionCount > 0)
    return {
      state: "NO_EDGE",
      label: "无优势",
      reason: "已计算；未达到策略门槛",
    };
  if (!f.quoteAt)
    return {
      state: "MISSING_DATA",
      label: "缺数据",
      reason: "完整新鲜报价或实时模型特征缺失",
    };
  return {
    state: "OBSERVING",
    label: "观察",
    reason: "已有来源观测，尚未形成有效决策",
  };
}
export async function workspaceSchedule(c: Context, p: URLSearchParams) {
  const all = await rows(
    c.db,
    "SELECT f.*,r.id revisionId,r.kickoffAt,COALESCE(cat.competition,src.competition,'DEMO') competition,COALESCE(cat.season,src.season) season,cat.dataJson,cat.lastCapturedAt,cat.sourceUrl,(SELECT COUNT(*) FROM predictions pr WHERE pr.fixtureRevisionId=r.id) predictionCount,(SELECT COUNT(*) FROM decisions d JOIN market_expectations e ON e.id=d.expectationId JOIN predictions pr ON pr.id=e.predictionId WHERE pr.fixtureRevisionId=r.id AND d.accepted=1) accepted,(SELECT MAX(q.observedAt) FROM quote_sets q JOIN market_definitions m ON m.id=q.marketId WHERE m.fixtureId=f.id) quoteAt,(SELECT COUNT(*) FROM jobs j JOIN input_bundles b ON b.id=j.bundleId JOIN observation_slots s ON s.id=b.slotId WHERE s.fixtureRevisionId=r.id AND j.state='FAILED') failedJobs FROM fixtures f JOIN fixture_revisions r ON r.fixtureId=f.id AND r.revision=f.currentRevision LEFT JOIN fixture_catalog cat ON cat.fixtureId=f.id LEFT JOIN fixture_sources src ON src.fixtureId=f.id ORDER BY r.kickoffAt,f.id LIMIT 10001",
  );
  if (all.length > 10000) throw Error("SCHEDULE_CAPACITY_REQUIRES_PAGING");
  const records: any[] = all.map((f) => ({
    ...f,
    ...fixtureStatus(f, c.now),
    publicData: parse(f.dataJson, {}),
    day: localDay(f.kickoffAt),
    validation:
      parse(f.dataJson, {}).validation ||
      (f.competition === "DEMO" ? "DEMO_ONLY" : "LIVE_FEATURES_BLOCKED"),
    strictCandidate: false,
  }));
  records.sort((a, b) => {
    const af = a.kickoffAt >= c.now,
      bf = b.kickoffAt >= c.now;
    return af !== bf
      ? af
        ? -1
        : 1
      : af
        ? a.kickoffAt - b.kickoffAt || a.id.localeCompare(b.id)
        : b.kickoffAt - a.kickoffAt || a.id.localeCompare(b.id);
  });
  const from = p.get("from"),
    to = p.get("to"),
    league = p.get("league"),
    status = p.get("status"),
    q = p.get("q")?.toLowerCase();
  const filtered = records.filter(
    (f) =>
      (!from || f.day >= from) &&
      (!to || f.day <= to) &&
      (!league || league === "ALL" || f.competition === league) &&
      (!status || status === "ALL" || f.state === status) &&
      (!q || (f.home + " " + f.away).toLowerCase().includes(q)),
  );
  const offset = Number(p.get("offset") || 0);
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw Error("INVALID_CURSOR");
  return {
    items: filtered.slice(offset, offset + 40),
    total: filtered.length,
    totalKnown: all.length,
    nextOffset: offset + 40 < filtered.length ? offset + 40 : null,
    states: filtered.reduce(
      (a: any, f: any) => ((a[f.state] = (a[f.state] || 0) + 1), a),
      {},
    ),
    leagues: [...new Set(records.map((f) => f.competition))],
    researchCandidates: filtered
      .filter((f) => f.state === "CANDIDATE")
      .slice(0, 12),
    strictCandidates: [],
    observations: filtered
      .filter((f) => !["FINISHED", "STARTED", "CANDIDATE"].includes(f.state))
      .slice(0, 8),
    metadata: await workspaceMetadata(c.db),
    asOf: c.now,
  };
}
export async function workspaceFixture(c: Context, id: string) {
  const base = await stmt(
    c.db,
    "SELECT f.*,r.id revisionId,r.kickoffAt,r.sourceSnapshotId,COALESCE(c.competition,src.competition,'DEMO') competition,COALESCE(c.season,src.season) season,c.sourceUrl,c.lastCapturedAt,c.dataJson FROM fixtures f JOIN fixture_revisions r ON r.fixtureId=f.id AND r.revision=f.currentRevision LEFT JOIN fixture_catalog c ON c.fixtureId=f.id LEFT JOIN fixture_sources src ON src.fixtureId=f.id WHERE f.id=?",
  )
    .bind(id)
    .first<any>();
  if (!base) throw Error("NOT_FOUND");
  const sourceSnapshot = await stmt(
    c.db,
    "SELECT * FROM source_snapshots WHERE id=?",
    base.sourceSnapshotId,
  ).first<any>();
  const sourceChunks = await rows(
    c.db,
    "SELECT chunkNo,content FROM source_chunks WHERE snapshotId=? ORDER BY chunkNo LIMIT 5",
    base.sourceSnapshotId,
  );
  const sourceEvidence = {
    snapshot: sourceSnapshot,
    chunks: sourceChunks.slice(0, 4),
    truncated: sourceChunks.length > 4,
  };
  const savedMetadata = await stmt(
    c.db,
    "SELECT metadataJson FROM workspace_imports ORDER BY importedAt DESC LIMIT 1",
  ).first<any>();
  const legacySource =
    parse(base.dataJson, {}).sourceEventId ?? id.split(":").at(-1);
  const savedQuotes = parse(savedMetadata?.metadataJson, {}).savedQuoteIndex?.[
    base.competition + "|" + legacySource
  ] ?? { markets: [], oneXTwo: [] };
  for (const q of savedQuotes.oneXTwo) {
    const o = [q.home_odds, q.draw_odds, q.away_odds].map(Number);
    q.marketProbabilities = o.every((n) => Number.isFinite(n) && n > 1)
      ? o.map((n) => 1 / n / o.reduce((sum, x) => sum + 1 / x, 0))
      : null;
  }
  const predictions = await rows(
    c.db,
    "SELECT p.*,b.cutoffAt,b.manifestHash,b.quoteSetId FROM predictions p JOIN fixture_revisions r ON r.id=p.fixtureRevisionId JOIN observation_slots s ON s.id=p.slotId JOIN input_bundles b ON b.slotId=s.id WHERE r.fixtureId=? ORDER BY p.calculatedAt",
    id,
  );
  for (const pr of predictions) {
    pr.central = parse(pr.centralJson);
    pr.expectations = await rows(
      c.db,
      "SELECT e.*,qs.selection,qs.decimalOdds,d.accepted,d.reason FROM market_expectations e JOIN quote_selections qs ON qs.id=e.quoteSelectionId LEFT JOIN decisions d ON d.expectationId=e.id WHERE e.predictionId=?",
      pr.id,
    );
  }
  const quoteRows = await rows(
    c.db,
    "SELECT q.*,s.selection,s.decimalOdds FROM quote_sets q JOIN market_definitions m ON m.id=q.marketId JOIN quote_selections s ON s.quoteSetId=q.id WHERE m.fixtureId=? ORDER BY q.observedAt DESC,q.id LIMIT 90",
    id,
  );
  const quotes: any[] = [];
  for (const r of quoteRows) {
    let set = quotes.find((q) => q.id === r.id);
    if (!set) {
      set = { ...r, selections: {} };
      quotes.push(set);
    }
    set.selections[r.selection] = r.decimalOdds;
  }
  for (const q of quotes) {
    const o = [q.selections.HOME, q.selections.DRAW, q.selections.AWAY].map(
      Number,
    );
    q.marketProbabilities = o.every((n) => Number.isFinite(n) && n > 1)
      ? o.map((n) => 1 / n / o.reduce((s, x) => s + 1 / x, 0))
      : null;
  }
  const observations = await rows(
    c.db,
    "SELECT * FROM result_observations WHERE fixtureId=? ORDER BY observedAt DESC LIMIT 30",
    id,
  );
  const adjudications = await rows(
    c.db,
    "SELECT * FROM result_adjudications WHERE fixtureId=? ORDER BY revision DESC",
    id,
  );
  const archives = (await historyRows(c.db))
    .filter(
      (r) =>
        parse(base.dataJson, {}).archiveIds?.includes(r.id) ||
        r.raw?.match_id === id.split(":").at(-1) ||
        r.raw?.legs?.some((l: any) => l.matchId === id.split(":").at(-1)),
    )
    .slice(0, 30);
  return {
    fixture: base,
    savedQuotes,
    sourceEvidence,
    publicData: parse(base.dataJson, {}),
    predictions,
    quotes,
    observations,
    adjudications,
    archives,
    models: [
      {
        id: "V6_C388",
        label: "V6 configuration 388",
        status: "BLOCKED",
        reason: "缺少同一实时特征构建、必要xG/历史与训练时间证据",
        probabilityKind: "逐方向压力概率，不归一化",
      },
      {
        id: "V7_RETURN_PARTIAL_QUOTE_WEIGHTED_FIXED",
        label: "V7 fixed quote-weighted candidate",
        status: "BLOCKED",
        reason: "固定融合历史研究已单独登记；缺少实时特征与训练时间证据",
        probabilityKind: "固定融合中心概率；未自动晋升",
      },
    ],
    asOf: c.now,
  };
}
export async function importWorkspace(c: Context, p: any) {
  if (
    typeof p.sourceHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(p.sourceHash) ||
    !Number.isSafeInteger(p.sourceCutoffAt) ||
    !p.metadata ||
    !Array.isArray(p.metadata.leagues) ||
    !Array.isArray(p.study?.models)
  )
    throw Error("IMPORT_FIELDS_INVALID");
  const old = await stmt(
    c.db,
    "SELECT id,metadataJson,studyJson,sourceCutoffAt FROM workspace_imports WHERE sourceHash=?",
  )
    .bind(p.sourceHash)
    .first<any>();
  const metadata = canonical(p.metadata),
    study = canonical(p.study);
  if (new TextEncoder().encode(metadata + study).length > 8 * 1024 * 1024)
    throw Error("PAYLOAD_LIMIT");
  if (old) {
    if (
      old.metadataJson !== metadata ||
      old.studyJson !== study ||
      old.sourceCutoffAt !== p.sourceCutoffAt
    )
      throw Error("IDEMPOTENCY_CONFLICT");
    await restoreLegacyFixtureCatalog(c, p.sourceHash);
    return { id: old.id, replayed: true };
  }
  const id = uid();
  await stmt(
    c.db,
    "INSERT INTO workspace_imports VALUES(?,?,?,?,?,?)",
    id,
    p.sourceHash,
    p.sourceCutoffAt,
    c.now,
    metadata,
    study,
  ).run();
  await restoreLegacyFixtureCatalog(c, p.sourceHash);
  return { id, replayed: false, manifestHash: await sha(metadata + study) };
}
export async function restoreLegacyFixtureCatalog(
  c: Context,
  sourceHash: string,
) {
  const archived = await historyRows(c.db),
    grouped = new Map<string, any>();
  for (const record of archived.filter((r) => r.kind === "TICKET"))
    for (const leg of record.raw.legs || []) {
      if (
        typeof leg.matchId !== "string" ||
        typeof leg.home !== "string" ||
        typeof leg.away !== "string" ||
        !stamp(leg.kickoffAt) ||
        leg.home === leg.away
      )
        continue;
      const competition =
          typeof leg.leagueCode === "string" ? leg.leagueCode : "legacy",
        key = competition + "|" + leg.matchId,
        id = "legacy:" + (await sha(key)).slice(0, 32);
      if (!grouped.has(id))
        grouped.set(id, {
          id,
          competition,
          season: new Date(leg.kickoffAt).getUTCFullYear(),
          home: leg.home,
          away: leg.away,
          kickoffAt: stamp(leg.kickoffAt),
          sourceEventId: leg.matchId,
          validation: "LEGACY_NON_PROSPECTIVE",
          status: ["win", "loss", "void", "push"].includes(
            String(leg.status).toLowerCase(),
          )
            ? "FINISHED"
            : "SCHEDULED",
          legacyMarkets: [],
          archiveIds: [],
        });
      const f = grouped.get(id);
      f.archiveIds.push(record.id);
      f.legacyMarkets.push({
        market: leg.marketType ?? leg.market ?? "1X2",
        pick: leg.pickName ?? leg.pick ?? null,
        odds: leg.odds ?? null,
        line: leg.line ?? leg.handicap ?? leg.total ?? null,
        provider: leg.provider ?? null,
        priceCapturedAt: leg.priceCapturedAt ?? null,
        phase: leg.phase ?? "HISTORICAL",
        marketOdds: leg.evidence?.marketOdds ?? [],
        probability: leg.probability ?? null,
        modelVersion: leg.evidence?.modelVersion ?? null,
        rationale: leg.rationale ?? [],
        evidence: leg.evidence ?? null,
        settlementEvidence: leg.settlementEvidence ?? null,
      });
    }
  const metadataRow = await stmt(
    c.db,
    "SELECT metadataJson FROM workspace_imports WHERE sourceHash=?",
    sourceHash,
  ).first<any>();
  const saved = parse(metadataRow?.metadataJson, {}).savedFixtureIndex ?? {};
  for (const f of Object.values(saved) as any[]) {
    if (
      !stamp(f.kickoffAt) ||
      typeof f.home !== "string" ||
      typeof f.away !== "string"
    )
      continue;
    const id =
      "legacy:" +
      (await sha(f.competition + "|" + f.sourceEventId)).slice(0, 32);
    if (!grouped.has(id))
      grouped.set(id, {
        ...f,
        id,
        season: new Date(f.kickoffAt).getUTCFullYear(),
        validation: "LEGACY_NON_PROSPECTIVE",
        status: "SCHEDULED",
        legacyMarkets: [],
        archiveIds: [],
      });
  }
  const pending = [];
  for (const f of grouped.values()) {
    const found = await stmt(
      c.db,
      "SELECT id FROM fixtures WHERE id=?",
      f.id,
    ).first();
    if (!found) pending.push(f);
  }
  if (!pending.length) return { fixtures: 0, replayed: true };
  const source = uid(),
    text = canonical({
      kind: "LEGACY_IMPORTED_SCHEDULE",
      sourceHash,
      importedAt: c.now,
      limitations: "历史原票衍生的只读赛程；不构建前瞻输入或新票",
      fixtures: pending.map((f) => ({ id: f.id, archiveIds: f.archiveIds })),
    });
  const installation = await stmt(
    c.db,
    "SELECT mode FROM installations WHERE id=?",
    c.installationId,
  ).first<any>();
  await c.db.batch([
    stmt(
      c.db,
      "INSERT INTO source_snapshots VALUES(?,'LEGACY_EXPORT_V1',?,?,?,NULL,?,?,'COMPLETE')",
      source,
      "legacy-import:" + sourceHash,
      c.now,
      c.now,
      await sha(text),
      installation.mode,
    ),
    stmt(c.db, "INSERT INTO source_chunks VALUES(?,0,?)", source, text),
  ]);
  for (const f of pending)
    await c.db.batch([
      stmt(
        c.db,
        "INSERT INTO fixtures VALUES(?,?,?,1,?)",
        f.id,
        f.home,
        f.away,
        f.status,
      ),
      stmt(
        c.db,
        "INSERT INTO fixture_revisions VALUES(?,?,1,?,?,?)",
        uid(),
        f.id,
        f.kickoffAt,
        c.now,
        source,
      ),
      stmt(
        c.db,
        "INSERT INTO fixture_catalog VALUES(?,?,?,?,?,?)",
        f.id,
        f.competition,
        f.season,
        c.now,
        "legacy-import:" + sourceHash,
        canonical(f),
      ),
    ]);
  return { fixtures: pending.length, replayed: false };
}
export async function modelLaboratory(c: Context, p: URLSearchParams) {
  const x = await stmt(
    c.db,
    "SELECT studyJson,sourceCutoffAt FROM workspace_imports ORDER BY importedAt DESC LIMIT 1",
  ).first<any>();
  const study = parse(x?.studyJson, {
    models: [],
    limitations: ["尚无研究档案"],
  });
  const models = study.models.map((m: any) => {
    const samples = m.samples || [],
      filtered = samples.filter(
        (r: any) =>
          (!p.get("season") ||
            p.get("season") === "ALL" ||
            String(r.season) === p.get("season")) &&
          (!p.get("league") ||
            p.get("league") === "ALL" ||
            r.competition === p.get("league")) &&
          (!p.get("odds") ||
            p.get("odds") === "ALL" ||
            (r.odds !== null &&
              (p.get("odds") === "LOW"
                ? r.odds < 1.8
                : p.get("odds") === "MID"
                  ? r.odds >= 1.8 && r.odds < 2.5
                  : r.odds >= 2.5))),
      );
    let brier = 0,
      ll = 0,
      n = 0;
    const bins = Array.from({ length: 10 }, (_, i) => ({
      lower: i / 10,
      n: 0,
      predicted: 0,
      observed: 0,
    }));
    for (const r of filtered) {
      if (!Array.isArray(r.central) || ![0, 1, 2].includes(r.outcome)) continue;
      n++;
      brier += r.central.reduce(
        (s: number, v: number, i: number) =>
          s + (v - (i === r.outcome ? 1 : 0)) ** 2,
        0,
      );
      ll -= Math.log(Math.max(r.central[r.outcome], 1e-15));
      for (let i = 0; i < 3; i++) {
        const b = bins[Math.min(9, Math.floor(r.central[i] * 10))];
        b.n++;
        b.predicted += r.central[i];
        b.observed += +(i === r.outcome);
      }
    }
    const actions = filtered
      .filter((r: any) => r.action !== "NO_ACTION")
      .map((r: any) => ({
        ...r,
        id: r.fixtureId,
        at: Date.parse(r.date),
        settledAt: Date.parse(r.date),
        status: "SETTLED",
        currency: "RESEARCH_UNIT",
        stakeAtoms: "1000000",
        pnlAtoms: String(Math.round(r.pnl * 1000000)),
      }));
    return {
      ...m,
      samples: undefined,
      samplePreview: filtered.slice(0, 20),
      sampleRange: {
        from: filtered.map((r: any) => r.date).sort()[0] ?? null,
        to:
          filtered
            .map((r: any) => r.date)
            .sort()
            .at(-1) ?? null,
      },
      metrics: {
        ...summarizeRecords(actions),
        eligibleN: filtered.length,
        probabilityN: n,
        logLoss: n ? ll / n : null,
        brier: n ? brier / n : null,
        coverage: filtered.length ? actions.length / filtered.length : null,
        calibration: bins
          .filter((b) => b.n)
          .map((b) => ({
            ...b,
            predicted: b.predicted / b.n,
            observed: b.observed / b.n,
          })),
      },
      groups: ["season", "competition", "oddsBand"].map((key) => ({
        key,
        rows: [
          ...new Set(
            filtered.map((r: any) =>
              key === "oddsBand"
                ? r.odds === null
                  ? "NO_ACTION"
                  : r.odds < 1.8
                    ? "<1.8"
                    : r.odds < 2.5
                      ? "1.8–2.5"
                      : "≥2.5"
                : r[key],
            ),
          ),
        ].map((value) => {
          const group = filtered.filter(
            (r: any) =>
              (key === "oddsBand"
                ? r.odds === null
                  ? "NO_ACTION"
                  : r.odds < 1.8
                    ? "<1.8"
                    : r.odds < 2.5
                      ? "1.8–2.5"
                      : "≥2.5"
                : r[key]) === value,
          );
          const a = group.filter((r: any) => r.action !== "NO_ACTION");
          return {
            value,
            eligibleN: group.length,
            n: a.length,
            wins: a.filter((r: any) => r.pnl > 0).length,
            losses: a.filter((r: any) => r.pnl < 0).length,
            roi: a.length
              ? a.reduce((s: number, r: any) => s + r.pnl, 0) / a.length
              : null,
          };
        }),
      })),
    };
  });
  return {
    models,
    originalSeasonReports: study.originalSeasonReports ?? [],
    asOf: c.now,
    sourceCutoffAt: x?.sourceCutoffAt ?? null,
    scope: study.scope ?? "HISTORICAL_REPLAY_NON_PROSPECTIVE",
    limitations: study.limitations ?? [],
    prospective: { n: 0, roi: null, reason: "REALTIME_V6_V7_INPUTS_BLOCKED" },
    seasons: [
      ...new Set(
        study.models.flatMap((m: any) =>
          (m.samples || []).map((r: any) => String(r.season)),
        ),
      ),
    ].sort(),
    leagues: [
      ...new Set(
        study.models.flatMap((m: any) =>
          (m.samples || []).map((r: any) => r.competition),
        ),
      ),
    ].sort(),
  };
}
