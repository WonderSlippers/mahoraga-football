import { canonical, sha, input } from "../../../../packages/contracts";
import { modelTeamName } from "../../../../packages/sources/team-identity";
import { atomic, stmt, uid, rows } from "../repositories/db";
import type { Context } from "./commands";
import { boundedBody, evidenceChunks } from "../../../../packages/sources";
import { odds as normalizeOdds } from "../../../../packages/domain";
import { registerComparison } from "./comparison";
import { legacyGoalInputs } from "./legacy-inputs";
import { COMPARISON_METHODS } from "../../../../packages/domain/comparison";
import { registerUniversal } from "./universal";
import { UNIVERSAL_ID } from "../../../../packages/domain/universal";

export function decimalAmerican(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(String(raw))) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || Math.abs(n) < 100) return null;
  return normalizeOdds(String(raw), "american");
}
export function publicMarkets(odds: any[]) {
  return (odds || [])
    .filter((o) => o && typeof o === "object")
    .map((o) => {
      const ml = o.moneyline;
      const value = (side: string, fallback: any) =>
        decimalAmerican(ml?.[side]?.close?.odds ?? fallback);
      const prices = [
        value("home", o.homeTeamOdds?.moneyLine),
        value("draw", o.drawOdds?.moneyLine),
        value("away", o.awayTeamOdds?.moneyLine),
      ];
      const total = (side: string) => ({
        line: totalLine(o.total?.[side]?.close?.line, side),
        odds: decimalAmerican(o.total?.[side]?.close?.odds),
      });
      const spread = (side: string) => ({
        line: o.pointSpread?.[side]?.close?.line ?? null,
        odds: decimalAmerican(o.pointSpread?.[side]?.close?.odds),
      });
      const inv = prices.every((p) => p !== null)
        ? prices.map((p) => 1 / Number(p))
        : null;
      return {
        provider: o.provider?.name ?? "ESPN公开参考",
        prices,
        probabilities:
          inv?.map((p) => p / inv.reduce((a, b) => a + b, 0)) ?? null,
        overround: inv ? inv.reduce((a, b) => a + b, 0) - 1 : null,
        asian: { home: spread("home"), away: spread("away") },
        total: { over: total("over"), under: total("under") },
        raw: o,
      };
    });
}
export function totalLine(raw: unknown, side: string): string | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const prefix = side === "over" ? "o" : "u";
  const match = String(raw).match(
    new RegExp("^(?:" + prefix + ")?([0-9]+(?:\\.[0-9]+)?)$"),
  );
  if (!match || !Number.isInteger(Number(match[1]) * 4)) return null;
  return String(Number(match[1]));
}
export function recentGames(summary: any, teamId: string, cutoff: number) {
  const team = (summary.lastFiveGames || []).find(
    (t: any) => String(t.team?.id) === teamId,
  );
  return (team?.events || [])
    .filter(
      (e: any) =>
        Number.isFinite(Date.parse(e.gameDate)) &&
        Date.parse(e.gameDate) < cutoff &&
        /^\d{1,2}$/.test(String(e.homeTeamScore)) &&
        /^\d{1,2}$/.test(String(e.awayTeamScore)) &&
        !Number(e.homeShootoutScore) &&
        !Number(e.awayShootoutScore) &&
        !Number(e.homeAggregateScore) &&
        !Number(e.awayAggregateScore),
    )
    .map((e: any) => {
      const home = String(e.homeTeamId) === teamId;
      return {
        id: String(e.id),
        at: new Date(e.gameDate).toISOString(),
        gf: Number(home ? e.homeTeamScore : e.awayTeamScore),
        ga: Number(home ? e.awayTeamScore : e.homeTeamScore),
        opponent: String(e.opponent?.displayName ?? "未记录"),
        competition: String(e.competitionName ?? "未记录"),
      };
    })
    .sort((a: any, b: any) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 5);
}
export async function captureSummary(
  c: Context,
  f: any,
  fetcher: typeof fetch,
) {
  const source = `https://site.api.espn.com/apis/site/v2/sports/soccer/${f.competition}/summary?event=${f.sourceEventId}`;
  const bytes = await boundedBody(
    await fetcher(source, {
      signal: AbortSignal.timeout(12000),
      redirect: "manual",
    }),
  );
  const chunks = evidenceChunks(bytes),
    raw = chunks.join(""),
    j = JSON.parse(raw),
    snapshot = uid(),
    at = Date.now();
  const event = j.header?.competitions?.[0];
  if (
    String(j.header?.id) !== f.sourceEventId ||
    !event?.competitors?.some(
      (t: any) => String(t.team?.id) === f.homeId && t.homeAway === "home",
    ) ||
    !event.competitors.some(
      (t: any) => String(t.team?.id) === f.awayId && t.homeAway === "away",
    )
  )
    throw Error("SOURCE_IDENTITY_REVIEW");
  await atomic(c.db, [
    stmt(
      c.db,
      "INSERT INTO source_snapshots VALUES(?,'ESPN_SUMMARY_V1',?,?,?,NULL,?,'LOCAL_RESEARCH','COMPLETE')",
      snapshot,
      source,
      at,
      at,
      await sha(raw),
    ),
    ...chunks.map((v, i) =>
      stmt(c.db, "INSERT INTO source_chunks VALUES(?,?,?)", snapshot, i, v),
    ),
  ]);
  return {
    snapshotId: snapshot,
    sourceUrl: source,
    observedAt: at,
    homeRecent: recentGames(j, f.homeId, Math.min(at, f.kickoffAt)),
    awayRecent: recentGames(j, f.awayId, Math.min(at, f.kickoffAt)),
    venue: j.gameInfo?.venue ?? f.venue ?? null,
    neutralSite:
      typeof event.neutralSite === "boolean" ? event.neutralSite : null,
    rosters: j.rosters ?? [],
    standings: j.standings ?? [],
    news: Array.isArray(j.news) ? j.news : (j.news?.articles ?? []),
    formations: j.boxscore?.players ?? [],
    summaryOdds: (j.pickcenter || []).filter(Boolean),
  };
}
// Frozen research jobs and separate reference-price paper policies.
export async function freezePublicResearch(
  c: Context,
  f: any,
  sourceSnapshotId: string,
  observedAt: number,
  fetcher: typeof fetch = fetch,
) {
  sourceSnapshotId = f.quoteEvidence?.snapshotId ?? sourceSnapshotId;
  observedAt = f.quoteEvidence?.observedAt ?? observedAt;
  if (f.status !== "SCHEDULED" || f.kickoffAt <= observedAt) return;
  const quote = publicMarkets(f.providerOdds).find((q) =>
    q.prices.every(Boolean),
  );
  if (!quote) return;
  const featureRow = await stmt(
    c.db,
    "SELECT * FROM comparison_features WHERE fixtureId=? ORDER BY observedAt DESC LIMIT 1",
    f.id,
  ).first<any>();
  const previous = await stmt(
    c.db,
    "SELECT MAX(observedAt) at FROM quote_sets q JOIN market_definitions m ON m.id=q.marketId WHERE m.fixtureId=?",
    f.id,
  ).first<any>();
  if (previous?.at && observedAt - previous.at < 300000) {
    const last = await stmt(
      c.db,
      "SELECT b.id,b.canonical FROM input_bundles b JOIN observation_slots s ON s.id=b.slotId JOIN fixture_revisions r ON r.id=s.fixtureRevisionId WHERE r.fixtureId=? ORDER BY b.cutoffAt DESC LIMIT 1",
      f.id,
    ).first<any>();
    if (
      (JSON.parse(last?.canonical ?? "{}").comparisonFeatures?.featureHash ??
        null) === (featureRow?.featureHash ?? null) &&
      (await stmt(
        c.db,
        "SELECT id FROM jobs WHERE bundleId=? AND modelId=?",
        last?.id ?? "",
        UNIVERSAL_ID,
      ).first())
    )
      return;
  }
  await registerComparison(c);
  await registerUniversal(c);
  const goalStats = await legacyGoalInputs(c, f, fetcher);
  const revision = await stmt(
    c.db,
    "SELECT r.id FROM fixture_revisions r JOIN fixtures f ON f.id=r.fixtureId AND f.currentRevision=r.revision WHERE f.id=?",
    f.id,
  ).first<any>();
  const spec = await sha(f.id + ":REGULATION_90:1X2");
  const existing = await stmt(
    c.db,
    "SELECT id FROM market_definitions WHERE specHash=?",
    spec,
  ).first<any>();
  const market = existing?.id ?? uid(),
    qs = uid(),
    slot = uid(),
    bundle = uid(),
    cutoff = Math.max(
      observedAt,
      f.detail?.observedAt ?? observedAt,
      goalStats?.observedAt ?? 0,
      featureRow?.observedAt ?? 0,
    );
  if (cutoff >= f.kickoffAt) return;
  const features =
    f.detail?.homeRecent && f.detail?.awayRecent
      ? {
          homeRecent: f.detail.homeRecent.map((g: any) => ({
            ...g,
            at: new Date(g.at).toISOString(),
          })),
          awayRecent: f.detail.awayRecent.map((g: any) => ({
            ...g,
            at: new Date(g.at).toISOString(),
          })),
          neutralSite: f.detail.neutralSite,
          sourceSnapshotId: f.detail.snapshotId,
          observedAt: f.detail.observedAt,
        }
      : undefined;
  const frozen = input({
    mode: "LOCAL_RESEARCH",
    fixtureId: f.id,
    revisionId: revision.id,
    observedAt: new Date(observedAt).toISOString(),
    ingestedAt: new Date(cutoff).toISOString(),
    cutoffAt: new Date(cutoff).toISOString(),
    kickoffAt: new Date(f.kickoffAt).toISOString(),
    odds: quote.prices,
    missingMask: [
      "PROVIDER_UPDATE_TIME_UNKNOWN",
      "PUBLIC_REFERENCE_NOT_EXECUTABLE",
    ],
    ...(features ? { researchFeatures: features } : {}),
    comparisonFeatures: {
      competition: f.competition,
      home: modelTeamName(f.home, f.competition),
      away: modelTeamName(f.away, f.competition),
      goalStats,
      featureRow: featureRow ? JSON.parse(featureRow.payloadJson) : null,
      featureSources: featureRow
        ? JSON.parse(featureRow.sourceManifestJson)
        : [],
      featureHash: featureRow?.featureHash ?? null,
      offers: [
        ...["HOME", "DRAW", "AWAY"].map((selection, i) => ({
          market: "1X2",
          selection,
          lineQ: null,
          odds: quote.prices[i],
        })),
        ...[
          ["ASIAN_HANDICAP", "HOME", quote.asian.home],
          ["ASIAN_HANDICAP", "AWAY", quote.asian.away],
          ["TOTAL_GOALS", "OVER", quote.total.over],
          ["TOTAL_GOALS", "UNDER", quote.total.under],
        ]
          .filter(
            ([, , v]: any) =>
              v.line !== null &&
              v.odds !== null &&
              /^[-+]?\d+(?:\.\d+)?$/.test(String(v.line)) &&
              Number.isInteger(Number(v.line) * 4),
          )
          .map(([market, selection, v]: any) => ({
            market,
            selection,
            lineQ: Number(v.line) * 4,
            odds: v.odds,
          })),
      ],
    },
  });
  const manifest = canonical({
    id: "RECENT_FORM_MARKET80_RESEARCH_V1",
    variant: "RECENT_FORM_MARKET80_RESEARCH_V1",
    status: "UNVALIDATED_RESEARCH",
    researchOnly: true,
    marketWeight: 0.8,
    priorMean: 1.3,
    priorGames: 3,
    homeFactor: 1.06,
    minimumGames: 3,
    maximumAgeDays: 180,
    training: "NONE",
    limitations: [
      "近期比分启发式；未调整对手强度",
      "未通过历史/前瞻收益验证",
      "不等同于V6或V7",
    ],
  });
  const commands = [
    stmt(
      c.db,
      "INSERT OR IGNORE INTO model_manifests VALUES(?,?,?,'CENTRAL_1X2','UNVALIDATED_RESEARCH')",
      "RECENT_FORM_MARKET80_RESEARCH_V1",
      manifest,
      await sha(manifest),
    ),
  ];
  if (!existing)
    commands.push(
      stmt(
        c.db,
        "INSERT INTO market_definitions VALUES(?,?,?,'REGULATION_90','1X2')",
        market,
        f.id,
        spec,
      ),
    );
  commands.push(
    stmt(
      c.db,
      "INSERT INTO quote_sets VALUES(?,?,?,?,?,NULL,'PREMATCH_PUBLIC_REFERENCE',0,?)",
      qs,
      market,
      sourceSnapshotId,
      "ESPN_" + quote.provider,
      observedAt,
      await sha(canonical(quote.raw)),
    ),
    ...["HOME", "DRAW", "AWAY"].map((side, i) =>
      stmt(
        c.db,
        "INSERT INTO quote_selections VALUES(?,?,?,?,?,'decimal')",
        uid(),
        qs,
        side,
        quote.prices[i],
        quote.prices[i],
      ),
    ),
    stmt(
      c.db,
      "INSERT INTO observation_slots VALUES(?,?,'PUBLIC_RESEARCH_V1',?,?,'QUEUED',NULL)",
      slot,
      revision.id,
      cutoff,
      Math.min(f.kickoffAt, cutoff + 300000),
    ),
    stmt(
      c.db,
      "INSERT INTO input_bundles VALUES(?,?,?,?,?,?,'READY')",
      bundle,
      slot,
      qs,
      cutoff,
      await sha(canonical(frozen)),
      canonical(frozen),
    ),
    ...[
      "MARKET_PROPORTIONAL_V1",
      UNIVERSAL_ID,
      ...COMPARISON_METHODS.map((m) => m.id),
      ...(features &&
      typeof features.neutralSite === "boolean" &&
      features.homeRecent.length >= 3 &&
      features.awayRecent.length >= 3 &&
      [features.homeRecent, features.awayRecent].every(
        (g) => cutoff - Date.parse(g[0].at) <= 180 * 86400000,
      )
        ? ["RECENT_FORM_MARKET80_RESEARCH_V1"]
        : []),
    ].map((model) =>
      stmt(
        c.db,
        "INSERT INTO jobs(id,bundleId,modelId,state,deadlineAt) VALUES(?,?,?,'QUEUED',?)",
        uid(),
        bundle,
        model,
        Math.min(f.kickoffAt, cutoff + 300000),
      ),
    ),
  );
  await atomic(c.db, commands);
}
