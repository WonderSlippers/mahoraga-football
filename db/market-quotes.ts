import {env} from 'cloudflare:workers';
import {readMarketResult} from './market-results';
import {totalResult} from '../lib/total-result';
type Observation={id:string;leagueCode:string;home:string;away:string;date:number;status:string;detail:string;sourceUrl?:string;observedAt?:number;totalOffers?:{line:number;over:number;under:number;provider:string;phase:string}[]};
function database(){if(!env.DB)throw new Error('多玩法历史数据库不可用');return env.DB;}
export function quoteRows(matches:Observation[],capturedAt:number){
  if(!Number.isSafeInteger(capturedAt)||capturedAt<=0)throw new Error('抓取时间无效');
  return matches.flatMap(m=>{
    const observedAt=m.observedAt;
    if(!Number.isSafeInteger(observedAt)||!observedAt||observedAt>capturedAt||observedAt<=0||!m.sourceUrl?.startsWith('https://cdn.espn.com/core/soccer/scoreboard?'))return [];
    if(m.status!=='soon'||!Number.isFinite(m.date)||m.date<=capturedAt||!/^\d{3,30}$/.test(m.id)||!m.leagueCode||/(cancel|abandon|postpon|suspend)/i.test(m.detail))return [];
    return(m.totalOffers||[]).filter(o=>Number.isFinite(o.line)&&o.line>0&&o.line<30&&Number.isFinite(o.over)&&o.over>1&&Number.isFinite(o.under)&&o.under>1&&['open','close','current'].includes(o.phase)&&typeof o.provider==='string'&&o.provider.length>0&&o.provider.length<=120).map(o=>({
      id:JSON.stringify([m.leagueCode,m.id,'total-ft',o.provider,o.phase,o.line,o.over,o.under,Math.floor(observedAt/300000)]),
      matchId:m.id,leagueCode:m.leagueCode,home:m.home,away:m.away,kickoffAt:m.date,capturedAt:observedAt,market:'total-ft',line:o.line,overOdds:o.over,underOdds:o.under,provider:o.provider,phase:o.phase,
      sourceUrl:m.sourceUrl!,
    }));
  });
}
export function prepareMarketQuoteStatements(db:D1Database,matches:Observation[],capturedAt:number){
  const rows=quoteRows(matches,capturedAt);
  const sql='INSERT INTO market_quotes (id,match_id,league_code,home,away,kickoff_at,captured_at,market,line,over_odds,under_odds,provider,phase,source_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING';
  return {observed:rows.length,statements:rows.map(r=>db.prepare(sql).bind(r.id,r.matchId,r.leagueCode,r.home,r.away,r.kickoffAt,r.capturedAt,r.market,r.line,r.overOdds,r.underOdds,r.provider,r.phase,r.sourceUrl))};
}
export async function recordMarketQuotes(matches:Observation[],capturedAt:number){
  const db=database(),prepared=prepareMarketQuoteStatements(db,matches,capturedAt);let inserted=0;
  for(let start=0;start<prepared.statements.length;start+=50){
    const results=await db.batch(prepared.statements.slice(start,start+50));inserted+=results.reduce((s,r)=>s+Number(r.meta.changes||0),0);
  }
  return{observed:prepared.observed,inserted};
}
export async function readMarketQuotes(league:string,matchId:string){
  const result=await database().prepare('SELECT match_id,league_code,home,away,kickoff_at,captured_at,market,line,over_odds,under_odds,provider,phase,source_url FROM market_quotes WHERE league_code=? AND match_id=? ORDER BY captured_at DESC,id DESC LIMIT 201').bind(league,matchId).all();
  const outcome=await readMarketResult(league,matchId);
  return{rows:result.results.slice(0,200).map(r=>({...r,source_updated_at:null,reference_result:totalResult(Number(r.line),outcome)})),result:outcome,truncated:result.results.length>200};
}
