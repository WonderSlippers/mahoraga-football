import {env} from 'cloudflare:workers';
type Match={id:string;leagueCode:string;status:string;date:number;hs:number;as:number;period:number;detail:string;observedAt?:number;sourceUrl?:string};
function database(){if(!env.DB)throw new Error('参考赛果数据库不可用');return env.DB;}
export function observation(m:Match){
  if(!Number.isSafeInteger(m.observedAt)||!m.observedAt||m.observedAt>Date.now()+1000||!m.sourceUrl?.startsWith('https://cdn.espn.com/core/soccer/scoreboard?'))return null;
  const canceled=/(cancel|abandon)/i.test(m.detail);
  if(!canceled&&(m.status!=='finished'||m.date>m.observedAt||/(postpon|suspend)/i.test(m.detail)||![m.hs,m.as].every(n=>Number.isInteger(n)&&n>=0)))return null;
  const state=canceled?'void':m.period>2||/(AET|extra time|penalt|shootout|_PEN(?:_|$))/i.test(m.detail)||(m.period!==2&&!/(FULL_TIME|full time)/i.test(m.detail))?'review':'final';
  const hs=canceled?null:m.hs,as=canceled?null:m.as;
  return{...m,matchId:m.id,state,hs,as,fingerprint:JSON.stringify([state,hs,as,m.detail]),id:JSON.stringify([m.leagueCode,m.id,m.observedAt,state,hs,as])};
}
export function prepareMarketResultStatements(db:D1Database,matches:Match[]){
  const rows=matches.map(observation).filter((r):r is NonNullable<typeof r>=>!!r);
  const sql=`INSERT INTO market_results (id,match_id,league_code,observed_at,state,home_score,away_score,detail,source_url,fingerprint)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM market_quotes WHERE match_id=? AND league_code=?)
    AND COALESCE((SELECT fingerprint FROM market_results WHERE match_id=? AND league_code=? ORDER BY observed_at DESC,id DESC LIMIT 1),'')<>?
    AND COALESCE((SELECT MAX(observed_at) FROM market_results WHERE match_id=? AND league_code=?),0)<=?
    ON CONFLICT(id) DO NOTHING`;
  return rows.map(r=>db.prepare(sql).bind(r.id,r.matchId,r.leagueCode,r.observedAt!,r.state,r.hs,r.as,r.detail,r.sourceUrl!,r.fingerprint,r.matchId,r.leagueCode,r.matchId,r.leagueCode,r.fingerprint,r.matchId,r.leagueCode,r.observedAt!));
}
export async function recordMarketResults(matches:Match[]){
  const db=database(),statements=prepareMarketResultStatements(db,matches);let inserted=0;
  for(let start=0;start<statements.length;start+=50){
    const results=await db.batch(statements.slice(start,start+50));inserted+=results.reduce((s,r)=>s+Number(r.meta.changes||0),0);}
  return inserted;
}
export async function readMarketResult(league:string,id:string){return database().prepare('SELECT state,home_score,away_score,observed_at,source_url,detail FROM market_results WHERE league_code=? AND match_id=? ORDER BY observed_at DESC,id DESC LIMIT 1').bind(league,id).first<{state:string;home_score:number|null;away_score:number|null;observed_at:number;source_url:string;detail:string}>();}
export async function pendingMarketResults(){
  const rows=await database().prepare(`SELECT q.match_id AS matchId,q.league_code AS leagueCode,MIN(q.kickoff_at) AS kickoffAt FROM market_quotes q WHERE q.kickoff_at<? AND COALESCE((SELECT r.state FROM market_results r WHERE r.match_id=q.match_id AND r.league_code=q.league_code ORDER BY r.observed_at DESC,r.id DESC LIMIT 1),'') NOT IN ('final','void') GROUP BY q.league_code,q.match_id`).bind(Date.now()).all();
  return rows.results.map(r=>({...r,status:'open'}));
}
