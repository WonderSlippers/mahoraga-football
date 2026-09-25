import { env } from "cloudflare:workers";

type Snapshot = {
  matchId: string;
  leagueCode: string;
  capturedAt: number;
  homeOdds: number | null;
  drawOdds: number | null;
  awayOdds: number | null;
  provider: string;
};

function database() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

export function prepareOddsSnapshotStatements(db:D1Database,rows:Snapshot[]) {
  const sql = `INSERT INTO odds_snapshots
    (match_id, league_code, captured_at, home_odds, draw_odds, away_odds, provider)
    SELECT ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM odds_snapshots
      WHERE league_code = ? AND match_id = ? AND captured_at > ?
        AND COALESCE(home_odds, -1) = COALESCE(?, -1)
        AND COALESCE(draw_odds, -1) = COALESCE(?, -1)
        AND COALESCE(away_odds, -1) = COALESCE(?, -1)
        AND provider = ?
    )`;
  return rows.map((row) => db.prepare(sql).bind(
      row.matchId, row.leagueCode, row.capturedAt, row.homeOdds, row.drawOdds, row.awayOdds, row.provider,
      row.leagueCode, row.matchId, row.capturedAt - 10 * 60_000, row.homeOdds, row.drawOdds, row.awayOdds, row.provider,
    ));
}

export async function recordOddsSnapshots(rows: Snapshot[]) {
  if (!rows.length) return 0;
  const db = database(),statements=prepareOddsSnapshotStatements(db,rows);
  let inserted = 0;
  for (let offset = 0; offset < statements.length; offset += 80) {
    const results = await db.batch(statements.slice(offset, offset + 80));
    inserted += results.reduce((total, result) => total + Number(result.meta.changes || 0), 0);
  }
  return inserted;
}

export async function readOddsHistory(leagueCode: string, matchId: string) {
  const result = await database()
    .prepare("SELECT captured_at, home_odds, draw_odds, away_odds, provider FROM odds_snapshots WHERE league_code = ? AND match_id = ? ORDER BY captured_at DESC, id DESC LIMIT 360")
    .bind(leagueCode, matchId)
    .all<{ captured_at: number; home_odds: number | null; draw_odds: number | null; away_odds: number | null; provider: string }>();
  // Preserve each bookmaker's intact row. The client selects one provider
  // before drawing a line, so equal capture times never erase alternatives.
  return result.results.reverse();
}

export async function readLatestOdds(leagueCode: string, matchId: string, kickoffAt: number, provider?: string) {
  if (!Number.isFinite(kickoffAt) || kickoffAt <= 0) return null;
  return database()
    .prepare("SELECT captured_at, home_odds, draw_odds, away_odds, provider FROM odds_snapshots WHERE league_code = ? AND match_id = ? AND captured_at >= ? AND captured_at < ? AND (? IS NULL OR provider = ?) AND home_odds > 1 AND draw_odds > 1 AND away_odds > 1 ORDER BY captured_at DESC, id DESC LIMIT 1")
    .bind(leagueCode, matchId, kickoffAt - 30 * 60_000, kickoffAt, provider || null, provider || null)
    .first<{ captured_at: number; home_odds: number | null; draw_odds: number | null; away_odds: number | null; provider: string }>();
}
