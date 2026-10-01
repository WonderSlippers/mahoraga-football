import { boundedBody, evidenceChunks } from "../../../../packages/sources";
import { sha } from "../../../../packages/contracts";
import { atomic, rows, stmt, uid } from "../repositories/db";
import type { Context } from "./commands";
export const LEGACY_GOAL_LEAGUES = [
  "eng.1",
  "esp.1",
  "ita.1",
  "ger.1",
  "fra.1",
  "ned.1",
  "por.1",
  "mex.1",
  "jpn.1",
];
export function normalizeStandings(j: any) {
  const entries = (j.children ?? []).flatMap(
      (c: any) => c.standings?.entries ?? [],
    ),
    teams: Record<string, any> = {};
  const stat = (e: any, k: string) => {
    const v = e?.stats?.find((s: any) => s.name === k)?.value;
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  };
  for (const e of entries) {
    const games = stat(e, "gamesPlayed"),
      gf = stat(e, "pointsFor"),
      ga = stat(e, "pointsAgainst");
    if (
      !e.team?.id ||
      games === null ||
      games < 1 ||
      gf === null ||
      ga === null
    )
      continue;
    const t: any = { games, for: gf, against: ga };
    for (const [side, key] of [
      ["home", "h"],
      ["away", "a"],
    ]) {
      const s = e.homeAwaySplits?.find((s: any) => s.homeAway === side),
        n = stat(s, "gamesPlayed"),
        f = stat(s, "pointsFor"),
        a = stat(s, "pointsAgainst");
      if (n !== null && n > 0 && f !== null && a !== null)
        Object.assign(t, { [key + "g"]: n, [key + "gf"]: f, [key + "ga"]: a });
    }
    teams[String(e.team.id)] = t;
  }
  const all = Object.values(teams),
    played = all.reduce((s: number, t: any) => s + t.games, 0),
    goals = all.reduce((s: number, t: any) => s + t.for, 0);
  return { teams, mean: played ? goals / played : null };
}
async function standings(
  c: Context,
  league: string,
  season: number,
  fetcher: typeof fetch,
) {
  const url = `https://site.web.api.espn.com/apis/v2/sports/soccer/${league}/standings?season=${season}`;
  const cached = await stmt(
    c.db,
    "SELECT * FROM source_snapshots WHERE providerId='ESPN_STANDINGS_V1' AND resourceKey=? AND observedAt>? ORDER BY observedAt DESC LIMIT 1",
    url,
    c.now - 3600000,
  ).first<any>();
  if (cached) {
    const chunks = await rows(
      c.db,
      "SELECT content FROM source_chunks WHERE snapshotId=? ORDER BY chunkNo",
      cached.id,
    );
    return {
      ...normalizeStandings(JSON.parse(chunks.map((x) => x.content).join(""))),
      snapshotId: cached.id,
      observedAt: cached.observedAt,
      sourceUrl: url,
    };
  }
  const failure = await stmt(
    c.db,
    "SELECT nextAttemptAt FROM source_runs WHERE providerId='ESPN_STANDINGS_V1' AND sourceUrl=? AND state='FAILED' ORDER BY startedAt DESC LIMIT 1",
    url,
  ).first<any>();
  if (failure?.nextAttemptAt > c.now) return null;
  try {
    const raw = evidenceChunks(
      await boundedBody(
        await fetcher(url, {
          redirect: "manual",
          signal: AbortSignal.timeout(10000),
        }),
      ),
    ).join("");
    const j = JSON.parse(raw);
    if (j.season?.year !== season) throw Error("SOURCE_SEASON_MISMATCH");
    const normalized = normalizeStandings(j),
      id = uid(),
      at = Date.now();
    if (normalized.mean === null) throw Error("SOURCE_EMPTY_STANDINGS");
    await atomic(c.db, [
      stmt(
        c.db,
        "INSERT INTO source_snapshots VALUES(?,'ESPN_STANDINGS_V1',?,?,?,NULL,?,'LOCAL_RESEARCH','COMPLETE')",
        id,
        url,
        at,
        at,
        await sha(raw),
      ),
      ...evidenceChunks(new TextEncoder().encode(raw)).map((chunk, i) =>
        stmt(c.db, "INSERT INTO source_chunks VALUES(?,?,?)", id, i, chunk),
      ),
    ]);
    return { ...normalized, snapshotId: id, observedAt: at, sourceUrl: url };
  } catch (e) {
    await stmt(
      c.db,
      "INSERT INTO source_runs VALUES(?,'ESPN_STANDINGS_V1',?,?,?,?,?,'FAILED',?,NULL,0,?)",
      uid(),
      league,
      season,
      url,
      c.now,
      Date.now(),
      String(e).slice(0, 250),
      Date.now() + 600000,
    ).run();
    return null;
  }
}
export async function legacyGoalInputs(
  c: Context,
  f: any,
  fetcher: typeof fetch = fetch,
) {
  if (!LEGACY_GOAL_LEAGUES.includes(f.competition)) return null;
  const season = new Date(f.kickoffAt).getUTCFullYear();
  const current = await standings(c, f.competition, season, fetcher),
    previous = await standings(c, f.competition, season - 1, fetcher);
  if (!current?.teams[f.homeId] || !current.teams[f.awayId]) return null;
  return {
    season,
    home: current.teams[f.homeId],
    away: current.teams[f.awayId],
    mean: current.mean,
    homePrev: previous?.teams[f.homeId] ?? null,
    awayPrev: previous?.teams[f.awayId] ?? null,
    meanPrev: previous?.mean ?? null,
    sourceRefs: [current, ...(previous ? [previous] : [])].map((s) => ({
      snapshotId: s.snapshotId,
      observedAt: s.observedAt,
      url: s.sourceUrl,
    })),
    observedAt: Math.max(current.observedAt, previous?.observedAt ?? 0),
  };
}
