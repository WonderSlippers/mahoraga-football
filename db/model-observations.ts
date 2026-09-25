import {env} from 'cloudflare:workers';
import {observedOutcome,prospectiveForecast} from '@/lib/model-observation-policy';

type Match={id:string;leagueCode:string;date:number;status:string;observedAt?:number;sourceUrl?:string;[key:string]:unknown};
type Radar={capturedAt:number;entries?:{matchId:string;leagueCode:string;[key:string]:unknown}[]};
const db=()=>{if(!env.DB)throw new Error('前瞻模型观察库不可用');return env.DB;};

export function prepareModelObservations(matches:Match[],radar:Radar|undefined){
  const byMatch=new Map(matches.map(match=>[`${match.leagueCode}:${match.id}`,match]));
  const forecasts=(radar?.entries||[]).map(entry=>prospectiveForecast(entry,byMatch.get(`${entry.leagueCode}:${entry.matchId}`),radar!.capturedAt)).filter((row):row is NonNullable<typeof row>=>!!row);
  const outcomes=matches.map(observedOutcome).filter((row):row is NonNullable<typeof row>=>!!row);
  return {forecasts,outcomes};
}

export function prepareModelObservationStatements(database:D1Database,matches:Match[],radar:Radar|undefined){
  const {forecasts,outcomes}=prepareModelObservations(matches,radar);
  const forecastSql='INSERT INTO model_forecasts (id,league_code,match_id,kickoff_at,captured_at,source_observed_at,source_url,source_updated_at,quote_provider,quote_phase,home_odds,draw_odds,away_odds,raw_probabilities,pick,conservative_probability,old_score,new_score,model_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING';
  const outcomeSql='INSERT INTO model_outcomes (id,league_code,match_id,observed_at,state,home_score,away_score,source_url,detail) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING';
  return {
    forecastObserved:forecasts.length,
    outcomeObserved:outcomes.length,
    forecastStatements:forecasts.map(row=>database.prepare(forecastSql).bind(row.id,row.leagueCode,row.matchId,row.kickoffAt,row.capturedAt,row.sourceObservedAt,row.sourceUrl,row.sourceUpdatedAt,row.quoteProvider,row.quotePhase,row.homeOdds,row.drawOdds,row.awayOdds,row.rawProbabilities,row.pick,row.conservativeProbability,row.oldScore,row.newScore,row.modelVersion)),
    outcomeStatements:outcomes.map(row=>database.prepare(outcomeSql).bind(row.id,row.leagueCode,row.matchId,row.observedAt,row.state,row.homeScore,row.awayScore,row.sourceUrl,row.detail)),
  };
}

export async function recordModelObservations(matches:Match[],radar:Radar|undefined){
  const database=db();
  const prepared=prepareModelObservationStatements(database,matches,radar);
  let forecastInserted=0,outcomeInserted=0;
  for(let offset=0;offset<prepared.forecastStatements.length;offset+=40){
    const results=await database.batch(prepared.forecastStatements.slice(offset,offset+40));
    forecastInserted+=results.reduce((sum,result)=>sum+Number(result.meta.changes||0),0);
  }
  for(let offset=0;offset<prepared.outcomeStatements.length;offset+=40){
    const results=await database.batch(prepared.outcomeStatements.slice(offset,offset+40));
    outcomeInserted+=results.reduce((sum,result)=>sum+Number(result.meta.changes||0),0);
  }
  return {forecastObserved:prepared.forecastObserved,forecastInserted,outcomeObserved:prepared.outcomeObserved,outcomeInserted};
}

export async function readModelObservations(){
  const database=db(),asOf=Date.now();
  const forecasts=await database.prepare('SELECT league_code,match_id,kickoff_at,captured_at,source_observed_at,source_url,source_updated_at,quote_provider,quote_phase,home_odds,draw_odds,away_odds,raw_probabilities,pick,conservative_probability,old_score,new_score,model_version FROM model_forecasts WHERE kickoff_at<? ORDER BY kickoff_at DESC,captured_at DESC LIMIT 10000').bind(asOf).all();
  // Restrict outcomes to the exact forecast cohort. An unrelated flood of
  // recent results must not evict the corresponding finals from this window.
  const outcomes=await database.prepare(`WITH selected_matches AS (
    SELECT DISTINCT league_code,match_id FROM (
      SELECT league_code,match_id FROM model_forecasts WHERE kickoff_at<? ORDER BY kickoff_at DESC,captured_at DESC LIMIT 10000
    )
  ) SELECT o.league_code,o.match_id,o.observed_at,o.state,o.home_score,o.away_score,o.source_url,o.detail
    FROM model_outcomes o JOIN selected_matches m ON m.league_code=o.league_code AND m.match_id=o.match_id
    ORDER BY o.observed_at DESC LIMIT 10000`).bind(asOf).all();
  return {forecasts:forecasts.results,outcomes:outcomes.results,truncated:forecasts.results.length===10000||outcomes.results.length===10000};
}
