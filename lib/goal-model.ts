// Prospective research only: standings snapshots are not retroactive backtest inputs.
import {readJsonLimited} from "./limited-response";

export type GoalStats={games:number;for:number;against:number;hg?:number;hgf?:number;hga?:number;ag?:number;agf?:number;aga?:number};
export type GoalEvidence={
  modelVersion:"poisson-standings-v2"|"poisson-standings-current-v2"|"poisson-standings-v3"|"poisson-standings-current-v3"|"poisson-standings-availability-v1"|"poisson-standings-availability-v2";calculatedAt:number;capturedAt:number;
  sourceUrls:string[];sourceCapturedAt?:number[];sourceUpdatedAt:null;seasons:number[];
  home:GoalStats;away:GoalStats;leagueMean:number;
  expectedHome:number;expectedAway:number;uncertaintyMargin:number;
  assumptions:string[];rho:number;
  availabilityInputs?:{dongqiudiAvailabilitySignals:number;availabilityNews:number;structuredAbsences?:number;marginBump:number};
};
export type GoalMatch={id:string;leagueCode:string;status:string;homeId?:string;awayId?:string;totalOffers?:unknown[];spreadOffers?:unknown[]};
type Season={teams:Map<string,GoalStats>;mean:number;sourceUrl:string;capturedAt:number};
type StandingStat={name?:string;value?:unknown};
type StandingEntry={team?:{id?:string|number};stats?:StandingStat[];homeAwaySplits?:({homeAway?:string;stats?:StandingStat[]})[]};
type StandingsPayload={children?:{standings?:{entries?:StandingEntry[]}}[]};
export const GOAL_LEAGUES=new Set(["eng.1","esp.1","ita.1","ger.1","fra.1","ned.1","por.1","mex.1","jpn.1"]);
const stat=(entry:{stats?:StandingStat[]}|undefined,name:string)=>Number(entry?.stats?.find(s=>s.name===name)?.value);
const safe=(n:number)=>Number.isFinite(n)&&n>=0;
// Dixon-Coles low-score dependence: classic rho<0 lifts 0-0/1-1 and
// suppresses 1-0/0-1 slightly. -0.08 is the literature default ballpark.
export const DC_RHO=-0.08;
export function dcTau(x:number,y:number,lh:number,la:number,rho:number):number{
  if(x===0&&y===0)return 1-lh*la*rho;
  if(x===0&&y===1)return 1+lh*rho;
  if(x===1&&y===0)return 1+la*rho;
  if(x===1&&y===1)return 1-rho;
  return 1;
}
// Full score grid 0..10 with Dixon-Coles adjustment, row-normalised.
export function dcScoreGrid(homeLambda:number,awayLambda:number,rho:number=DC_RHO):number[][]{
  const mass=(l:number)=>{const a=[Math.exp(-l)];for(let n=1;n<=10;n++)a.push(a.at(-1)!*l/n);return a;};
  const h=mass(homeLambda),a=mass(awayLambda);
  const g:number[][]=[];let sum=0;
  for(let i=0;i<=10;i++){g.push([]);for(let j=0;j<=10;j++){const p=h[i]*a[j]*dcTau(i,j,homeLambda,awayLambda,rho);g[i].push(p);sum+=p;}}
  for(let i=0;i<=10;i++)for(let j=0;j<=10;j++)g[i][j]/=sum;
  return g;
}
// Standings feed the goal model on every research/scan call; without a
// cache each one refetches two seasons per league and the endpoint
// adds ~10s to every match detail open.
const standingsCache=new Map<string,{at:number;season:Season|null}>();
function putStandings(key:string,season:Season|null){
  const at=Date.now();
  for(const [oldKey,old] of standingsCache)if(at-old.at>=60*60*1000)standingsCache.delete(oldKey);
  standingsCache.delete(key);
  standingsCache.set(key,{at,season});
  while(standingsCache.size>128)standingsCache.delete(standingsCache.keys().next().value!);
}
async function standings(code:string,year:number):Promise<Season|null>{
  const key=`${code}:${year}`,cached=standingsCache.get(key);
  if(cached){
    const ttl=cached.season?60*60*1000:10*60*1000;
    if(Date.now()-cached.at<ttl)return cached.season;
  }
  const sourceUrl=`https://site.web.api.espn.com/apis/v2/sports/soccer/${encodeURIComponent(code)}/standings?season=${year}`;
  try{
    const response=await fetch(sourceUrl,{headers:{accept:"application/json"},signal:AbortSignal.timeout(8000)});
    if (!response.ok) {
      const status = response.status;
      try {
        await response.body?.cancel();
      } catch {
        // Releasing the connection is best-effort; keep the original HTTP failure.
      }
      throw new Error(`HTTP ${status}`);
    }
    const json=await readJsonLimited(response,4_000_000) as StandingsPayload,entries=(json.children||[]).flatMap(c=>c.standings?.entries||[]);
    const teams=new Map<string,GoalStats>();
    for(const e of entries){
      const games=stat(e,"gamesPlayed"),scored=stat(e,"pointsFor"),conceded=stat(e,"pointsAgainst");
      if(!e.team?.id||!safe(games)||games<1||!safe(scored)||!safe(conceded))continue;
      // Home/away splits: ESPN carries these under homeAwaySplits in some
      // leagues; fall back gracefully when absent.
      let split:Partial<GoalStats>={};
      const hs=e.homeAwaySplits?.find(s=>s.homeAway==="home"),as=e.homeAwaySplits?.find(s=>s.homeAway==="away");
      if(hs&&safe(stat(hs,"gamesPlayed"))&&stat(hs,"gamesPlayed")>0)split={hg:stat(hs,"gamesPlayed"),hgf:stat(hs,"pointsFor"),hga:stat(hs,"pointsAgainst")};
      if(as&&safe(stat(as,"gamesPlayed"))&&stat(as,"gamesPlayed")>0)split={...split,ag:stat(as,"gamesPlayed"),agf:stat(as,"pointsFor"),aga:stat(as,"pointsAgainst")};
      teams.set(String(e.team.id),{games,for:scored,against:conceded,...split});
    }
    const all=[...teams.values()],played=all.reduce((s,t)=>s+t.games,0),goals=all.reduce((s,t)=>s+t.for,0);
    const season=teams.size>=10&&played>0?{teams,mean:goals/played,sourceUrl,capturedAt:Date.now()}:null;
    putStandings(key,season);
    return season;
  }catch(error){
    console.error("goal_standings_unavailable",{code,year,error:String(error)});
    if(cached?.season){putStandings(key,cached.season);return cached.season;}
    putStandings(key,null);
    return null;
  }
}
const clamp=(n:number)=>Math.max(.25,Math.min(4,n));
// Empirical-Bayes shrinkage of a rate toward the league prior: early
// season (tiny n) estimates collapse to league average instead of
// dominating the model. k = games-equivalent of prior strength.
const shrink=(obs:number,n:number,prior:number,k=6)=>(n*obs+k*prior)/(n+k);
// Time-decayed previous-season weight: the more current-season games
// on record, the less last season matters (half-life ~ one season).
const prevWeight=(nowGames:number)=>Math.max(.15,Math.min(.40,.40-.022*nowGames));
export function makeGoalEvidence(homeNow:GoalStats,awayNow:GoalStats,homePrev:GoalStats,awayPrev:GoalStats,meanNow:number,meanPrev:number,sourceUrls:[string,string],seasons:[number,number],capturedAt:number,sourceCapturedAt:[number,number]=[capturedAt,capturedAt]):GoalEvidence|null{
  const all=[homeNow,awayNow,homePrev,awayPrev];
  if(all.some(t=>t.games<1||t.for<0||t.against<0)||homePrev.games<15||awayPrev.games<15||!Number.isFinite(meanNow)||!Number.isFinite(meanPrev)||meanNow<=.3||meanPrev<=.3)return null;
  const w=prevWeight(homeNow.games);
  // Home/away split with league-average home advantage prior when the
  // feed omits splits (home teams score ~15% more league-wide).
  const HOME_ADV=1.15;
  const rates=(t:GoalStats,prev:GoalStats,venue:"h"|"a")=>{
    const wPrev=w;
    const splitRate=t.games>=3&&((venue==="h"&&t.hg&&t.hgf!==undefined)||(venue==="a"&&t.ag&&t.agf!==undefined));
    let nowRate:number,nowN:number;
    if(venue==="h"&&splitRate){nowRate=(t.hgf!/(t.hg!||1));nowN=t.hg!;}
    else if(venue==="a"&&splitRate){nowRate=(t.agf!/(t.ag!||1));nowN=t.ag!;}
    else{nowRate=(t.for/t.games)*(venue==="h"?HOME_ADV:2-HOME_ADV);nowN=t.games;}
    const prevRate=(prev.for/prev.games)*(venue==="h"?HOME_ADV:2-HOME_ADV);
    const merged=shrink((nowRate*nowN+prevRate*wPrev*prev.games)/(nowN+wPrev*prev.games)||0,nowN+wPrev*prev.games,meanNow*(venue==="h"?HOME_ADV:2-HOME_ADV));
    return merged;
  };
  const concededRates=(t:GoalStats,prev:GoalStats,venue:"h"|"a")=>{
    const wPrev=w;
    const splitRate=t.games>=3&&((venue==="h"&&t.hg&&t.hga!==undefined)||(venue==="a"&&t.ag&&t.aga!==undefined));
    let nowRate:number,nowN:number;
    if(venue==="h"&&splitRate){nowRate=(t.hga!/(t.hg!||1));nowN=t.hg!;}
    else if(venue==="a"&&splitRate){nowRate=(t.aga!/(t.ag!||1));nowN=t.ag!;}
    else{nowRate=(t.against/t.games)*(venue==="h"?2-HOME_ADV:HOME_ADV);nowN=t.games;}
    const prevRate=(prev.against/prev.games)*(venue==="h"?2-HOME_ADV:HOME_ADV);
    return shrink((nowRate*nowN+prevRate*wPrev*prev.games)/(nowN+wPrev*prev.games)||0,nowN+wPrev*prev.games,meanNow*(venue==="h"?2-HOME_ADV:HOME_ADV));
  };
  const leagueMean=(meanNow+w*meanPrev)/(1+w);
  // Both attack and concession rates already contain the venue prior. Divide
  // by that venue's league mean so the 1.15/0.85 prior is applied only once.
  const expectedHome=clamp(rates(homeNow,homePrev,"h")*concededRates(awayNow,awayPrev,"a")/(leagueMean*HOME_ADV));
  const expectedAway=clamp(rates(awayNow,awayPrev,"a")*concededRates(homeNow,homePrev,"h")/(leagueMean*(2-HOME_ADV)));
  if(!Number.isFinite(expectedHome)||!Number.isFinite(expectedAway))return null;
  return {modelVersion:"poisson-standings-v3",calculatedAt:Date.now(),capturedAt:Math.min(...sourceCapturedAt),sourceUrls,sourceCapturedAt,sourceUpdatedAt:null,seasons,home:homeNow,away:awayNow,leagueMean,expectedHome,expectedAway,uncertaintyMargin:homeNow.games<5||awayNow.games<5 ? .10 : .08,assumptions:["主客场拆分：数据源提供 split 时用真实主客场进失球，缺失时用联赛均值主客场先验（主场 ×1.15）；按主客场联赛均值归一化","时间衰减：上季权重随现季已赛场数从 0.40 衰减到 0.15","经验贝叶斯收缩：小样本队攻防率向联赛均值收缩（先验强度 k=6 场）","Dixon-Coles 低比分修正（rho=-0.08），修正 0-0/1-0/0-1/1-1 四个格子","首发、伤停、新闻、疲劳未参与"],rho:DC_RHO};
}
// Fallback for teams without prior-season same-league standings (e.g.
// newly promoted clubs): current season only with EB shrinkage.
export function makeCurrentOnlyGoalEvidence(homeNow:GoalStats,awayNow:GoalStats,meanNow:number,sourceUrl:string,season:number,capturedAt:number):GoalEvidence|null{
  if(homeNow.games<1||awayNow.games<1||homeNow.for<0||awayNow.for<0||homeNow.against<0||awayNow.against<0||!Number.isFinite(meanNow)||meanNow<=.3)return null;
  const HOME_ADV=1.15;
  const hg=homeNow.hg&&homeNow.hgf!==undefined&&homeNow.hg>=2?(homeNow.hgf/homeNow.hg):(homeNow.for/homeNow.games)*HOME_ADV;
  const ag=awayNow.ag&&awayNow.agf!==undefined&&awayNow.ag>=2?(awayNow.agf/awayNow.ag):(awayNow.for/awayNow.games)*(2-HOME_ADV);
  const hgc=homeNow.hg&&homeNow.hga!==undefined&&homeNow.hg>=2?(homeNow.hga/homeNow.hg):(homeNow.against/homeNow.games)*(2-HOME_ADV);
  const agc=awayNow.ag&&awayNow.aga!==undefined&&awayNow.ag>=2?(awayNow.aga/awayNow.ag):(awayNow.against/awayNow.games)*HOME_ADV;
  const eH=clamp(shrink(hg,homeNow.hg||homeNow.games,meanNow*HOME_ADV)*shrink(agc,awayNow.ag||awayNow.games,meanNow*HOME_ADV)/(meanNow*HOME_ADV));
  const eA=clamp(shrink(ag,awayNow.ag||awayNow.games,meanNow*(2-HOME_ADV))*shrink(hgc,homeNow.hg||homeNow.games,meanNow*(2-HOME_ADV))/(meanNow*(2-HOME_ADV)));
  if(!Number.isFinite(eH)||!Number.isFinite(eA))return null;
  return {modelVersion:"poisson-standings-current-v3",calculatedAt:Date.now(),capturedAt,sourceUrls:[sourceUrl],sourceCapturedAt:[capturedAt],sourceUpdatedAt:null,seasons:[season],home:homeNow,away:awayNow,leagueMean:meanNow,expectedHome:eH,expectedAway:eA,uncertaintyMargin:.14,assumptions:["至少一方缺少上季同级别积分榜数据（如升班马），仅用现季数据","主客场拆分：有 split 用真实值，缺失用联赛主客场先验；按主客场联赛均值归一化","经验贝叶斯收缩：小样本向联赛均值收缩（k=6 场）","Dixon-Coles 低比分修正（rho=-0.08）","现季样本小，不确定性边际取最大值 0.14","首发、伤停、新闻、疲劳未参与"],rho:DC_RHO};
}
export async function goalEvidenceForMatches(matches:GoalMatch[]):Promise<Map<string,GoalEvidence>>{
  const wanted=matches.filter(m=>m.status==="soon"&&m.homeId&&m.awayId&&(m.totalOffers?.length||m.spreadOffers?.length)&&GOAL_LEAGUES.has(m.leagueCode));
  const codes=[...new Set(wanted.map(m=>m.leagueCode))],year=new Date().getUTCFullYear(),results=new Map<string,GoalEvidence>();
  const seasons:{code:string;current:Season|null;previous:Season|null}[]=[];
  for(let offset=0;offset<codes.length;offset+=2){
    seasons.push(...await Promise.all(codes.slice(offset,offset+2).map(async code=>{const [current,previous]=await Promise.all([standings(code,year),standings(code,year-1)]);return {code,current,previous};})));
  }
  for(const row of seasons){
    if(!row.current||Date.now()-row.current.capturedAt>2*3600000)continue;
    for(const m of wanted.filter(m=>m.leagueCode===row.code)){
      const a=row.current.teams.get(String(m.homeId)),bb=row.current.teams.get(String(m.awayId));
      if(!a||!bb)continue;
      const c=row.previous?.teams.get(String(m.homeId)),d=row.previous?.teams.get(String(m.awayId));
      if(c&&d&&row.previous&&Date.now()-row.previous.capturedAt<=2*3600000){
        const e=makeGoalEvidence(a,bb,c,d,row.current.mean,row.previous.mean,[row.current.sourceUrl,row.previous.sourceUrl],[year,year-1],Math.min(row.current.capturedAt,row.previous.capturedAt),[row.current.capturedAt,row.previous.capturedAt]);
        if(e)results.set(m.id,e);
      }else{
        const e=makeCurrentOnlyGoalEvidence(a,bb,row.current.mean,row.current.sourceUrl,year,row.current.capturedAt);
        if(e)results.set(m.id,e);
      }
    }
  }
  return results;
}
export function poissonAtLeast(lambda:number,n:number):number{
  if(!Number.isFinite(lambda)||lambda<=0||!Number.isInteger(n)||n<0)return NaN;
  let mass=Math.exp(-lambda),below=0;
  for(let k=0;k<n;k++){below+=mass;mass*=lambda/(k+1);}
  return Math.max(0,Math.min(1,1-below));
}
export function poissonSpread(homeLambda:number,awayLambda:number,side:"home"|"away",line:-.5|.5):number{
  if(!Number.isFinite(homeLambda)||!Number.isFinite(awayLambda)||homeLambda<=0||awayLambda<=0)return NaN;
  const g=dcScoreGrid(homeLambda,awayLambda);let probability=0;
  for(let i=0;i<g.length;i++)for(let j=0;j<g[i].length;j++)if((side==="home"?i-j:j-i)+line>0)probability+=g[i][j];
  return Math.max(0,Math.min(1,probability));
}
