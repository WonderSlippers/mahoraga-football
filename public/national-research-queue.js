export const isNationalLeague=code=>/^(?:fifa\.|uefa\.(?:w\.)?nations|uefa\.euroq|concacaf\.nations|afc\.cupq|caf\.nations_qual)/.test(String(code||''));
const uefaPreview='https://www.uefa.com/uefanationsleague/news/02a9-21a4f1803092-7aad154369dc-1000--uefa-nations-league-matchday-1-preview-england-vs-spain-neth/';
const datedSpotlights={
  'uefa.nations:401861041':{priority:3,reason:'欧足联本轮前瞻列为焦点对阵；优先核对两队首发与战术变化。',sourceUrl:uefaPreview},
  'uefa.nations:401861046':{priority:2,reason:'欧足联 A4 组首轮直接交锋；优先核对两队阵容与赛程负荷。',sourceUrl:uefaPreview},
  'uefa.nations:401861044':{priority:1,reason:'欧足联 A4 组首轮，葡萄牙开启卫冕；优先核对轮换和人员完整度。',sourceUrl:uefaPreview},
};

export function nationalResearchLeagues(radar,now=Date.now()){
  const codes=new Set(['uefa.nations']);
  for(const row of radar?.entries||[]){
    if(isNationalLeague(row.leagueCode)&&Number(row.kickoffAt)>now&&Number(row.kickoffAt)<=now+48*3600000)codes.add(row.leagueCode);
  }
  return [...codes].slice(0,6);
}

export function nationalResearchRows(feeds,radar,now=Date.now()){
  const live=new Map(),failed=new Set(feeds?.failedLeagues||[]);
  for(const feed of feeds?.leagues||[])for(const event of feed.events||[]){
    const competition=event.competitions?.[0],competitors=competition?.competitors||[],home=competitors.find(c=>c.homeAway==='home'),away=competitors.find(c=>c.homeAway==='away');
    const kickoffAt=Date.parse(event.date||competition?.date||'');
    if(!event.id||!home||!away||!Number.isFinite(kickoffAt)||kickoffAt<=now||kickoffAt>now+48*3600000||event.status?.type?.state==='post')continue;
    const key=`${feed.leagueCode}:${event.id}`;
    live.set(key,{matchId:String(event.id),leagueCode:feed.leagueCode,home:String(home.team?.displayName||home.team?.name||''),away:String(away.team?.displayName||away.team?.name||''),kickoffAt,observedAt:Number(feed.fetchedAt)||now,source:'read-only-feed',status:event.status?.type?.state||'pre'});
  }
  for(const row of radar?.entries||[]){
    const kickoffAt=Number(row.kickoffAt),key=`${row.leagueCode}:${row.matchId}`;
    if(!isNationalLeague(row.leagueCode)||live.has(key)||failed.has(row.leagueCode)===false&&(feeds?.leagues||[]).some(f=>f.leagueCode===row.leagueCode)||kickoffAt<=now||kickoffAt>now+48*3600000)continue;
    live.set(key,{matchId:String(row.matchId),leagueCode:row.leagueCode,home:row.home,away:row.away,kickoffAt,observedAt:Number(row.observedAt||radar?.capturedAt)||0,source:'old-radar',status:'unverified'});
  }
  return [...live.values()].map(row=>({...row,spotlight:datedSpotlights[`${row.leagueCode}:${row.matchId}`]||null}))
    .sort((a,b)=>(b.spotlight?.priority||0)-(a.spotlight?.priority||0)||a.kickoffAt-b.kickoffAt||a.leagueCode.localeCompare(b.leagueCode)||a.matchId.localeCompare(b.matchId));
}
