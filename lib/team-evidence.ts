import snapshot from './official-team-evidence.json';

// Separate observation time from source publication time and model decision time.
// Never convert a late discovery into evidence that an old ticket had available.
export function teamEvidence(now = Date.now()) {
  const observedAt = Date.parse(snapshot.observedAt);
  const lineup = snapshot.lineupObservation;
  const kickoffAt = Date.parse(lineup.kickoff);
  const usableObservation = Number.isFinite(now) && now >= observedAt;
  const stale = !usableObservation || now - observedAt > 86400000;
  return {
    snapshotVersion: snapshot.schemaVersion,
    observedAt, sourcePublishedAt: null, stale,
    collection: '人工核查官方来源；尚非自动新闻流',
    modelUse: false,
    match: {home:lineup.home,away:lineup.away,kickoffAt},
    status: !usableObservation ? '观察时间异常' : now >= kickoffAt ? '历史比赛资料，不能当作下一场首发' : stale ? '超过24小时未复核' : '本场已核查资料',
    lineup: {homeFormation:lineup.homeFormation,awayFormation:lineup.awayFormation,homeStarters:lineup.homeStarters,awayStarters:lineup.awayStarters},
    availability: snapshot.availabilityObservations.map(row=>({player:row.player,summary:row.summaryZh,scope:row.scope})),
    sources: snapshot.sources,
    missing: ['下一场确认首发','对手伤停','完整球员负荷','全赛事与国家队赛程覆盖'],
  };
}

export function matchTeamEvidence(home:string,away:string,kickoffAt:number,now=Date.now()) {
  const evidence=teamEvidence(now);
  // Exact fixture binding: no fuzzy-name match, reverse fixture or date-only match.
  if(evidence.observedAt>now || evidence.match.home!==home || evidence.match.away!==away || evidence.match.kickoffAt!==kickoffAt)return null;
  return evidence;
}
