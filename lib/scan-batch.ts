// Bound each workerd request. A former 65-league request exhausted its V8
// heap; the rotating slice still visits every league, including women and
// national teams, while imminent/open-ticket leagues get extra checks.
export const ROTATING_LEAGUES_PER_SCAN = 8;
export const URGENT_LEAGUES_PER_SCAN = 8;
export const MAX_LEAGUES_PER_SCAN = ROTATING_LEAGUES_PER_SCAN + URGENT_LEAGUES_PER_SCAN;

type Pending = { leagueCode: string; kickoffAt: number };
type RadarLike = { entries?: { leagueCode: string; kickoffAt: number }[] };

export function planScanBatch(leagues: readonly string[], now: number, pending: Pending[] = [], radar?: RadarLike, previousSlot?:number) {
  const slots = Math.ceil(leagues.length / ROTATING_LEAGUES_PER_SCAN);
  // Persisted cursor takes precedence over wall-clock slots: if an upstream
  // timeout makes a run exceed five minutes, no rotating slice is skipped.
  const cursor=Number(previousSlot);
  const slot = Number.isInteger(cursor)&&cursor>=1&&cursor<=slots
    ? cursor % slots : Math.floor(now / 300_000) % slots;
  const rotating = leagues.slice(slot * ROTATING_LEAGUES_PER_SCAN, (slot + 1) * ROTATING_LEAGUES_PER_SCAN);
  const known = new Set(leagues);
  const upcoming = (radar?.entries || [])
    .filter(row => row.kickoffAt >= now - 3_600_000 && row.kickoffAt <= now + 48 * 3_600_000)
    .map(row => ({ leagueCode: row.leagueCode, kickoffAt: row.kickoffAt }));
  const urgent = [...pending, ...upcoming]
    .filter(row => known.has(row.leagueCode) && Number.isFinite(row.kickoffAt))
    .sort((a, b) => a.kickoffAt - b.kickoffAt || a.leagueCode.localeCompare(b.leagueCode));
  const urgentCodes = [...new Set(urgent.map(row => row.leagueCode))].slice(0, URGENT_LEAGUES_PER_SCAN);
  const selected = [...new Set([...rotating, ...urgentCodes])];
  return { selected, slot: slot + 1, slots, totalLeagues: leagues.length, maximum: MAX_LEAGUES_PER_SCAN };
}
