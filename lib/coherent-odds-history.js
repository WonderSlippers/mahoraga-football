// Keep one real bookmaker row per capture time. Never manufacture a 1X2
// triple by taking the best outcome independently from different providers.
export function coherentOddsHistory(rows) {
  const grouped = new Map();
  const coverage = row => [row.home_odds, row.draw_odds, row.away_odds]
    .filter(value => Number.isFinite(Number(value)) && Number(value) > 1).length;
  for (const row of rows) {
    const current = grouped.get(row.captured_at);
    if (!current || coverage(row) > coverage(current)) grouped.set(row.captured_at, row);
  }
  return [...grouped.values()].sort((a, b) => a.captured_at - b.captured_at).slice(-120);
}
