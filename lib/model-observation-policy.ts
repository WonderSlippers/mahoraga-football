// Freeze only genuine pre-kickoff forecasts. Upstream refresh time is unknown:
// sourceObservedAt is OUR fetch time and sourceUpdatedAt remains NULL.
const trustedSource=(value:string)=>{
  try{
    const url=new URL(value);
    return (url.protocol==='http:'&&url.hostname==='localhost'&&url.pathname==='/api/feed')
      ||(url.protocol==='https:'&&['cdn.espn.com','site.web.api.espn.com'].includes(url.hostname)&&url.pathname.includes('/soccer/'))
      ||(url.protocol==='https:'&&['www.jleague.jp','www.the-afc.com'].includes(url.hostname));
  }catch{return false;}
};
const three=(value:unknown):value is number[]=>Array.isArray(value)&&value.length===3&&value.every(v=>typeof v==='number'&&Number.isFinite(v));
type ForecastEntry={matchId?:string|number;leagueCode?:string;odds?:unknown;rawProbabilities?:unknown;pick?:number;probability?:number;score?:number;newScore?:number};
type ObservedMatch={id?:string|number;leagueCode?:string;status?:string;date?:number;observedAt?:number;sourceUrl?:string;odds?:unknown;oddsPhase?:string;providers?:string[];goalModel?:{modelVersion?:string};detail?:string;hs?:number|null;as?:number|null;scoreConflict?:boolean;period?:number};

export function prospectiveForecast(entry:ForecastEntry|null|undefined,match:ObservedMatch|null|undefined,capturedAt:number){
  if(!Number.isSafeInteger(capturedAt)||!match||!entry||!match.leagueCode||String(entry.matchId)!==String(match.id)||entry.leagueCode!==match.leagueCode||match.status!=='soon')return null;
  const kickoffAt=Number(match.date),sourceObservedAt=Number(match.observedAt);
  if(!Number.isSafeInteger(kickoffAt)||kickoffAt-capturedAt<10*60000||kickoffAt-capturedAt>48*3600000)return null;
  if(!Number.isSafeInteger(sourceObservedAt)||sourceObservedAt>capturedAt+1000||capturedAt-sourceObservedAt>30*60000||!trustedSource(String(match.sourceUrl||'')))return null;
  const matchOdds=match.odds;
  if(!three(entry.odds)||!entry.odds.every((v:number)=>v>1&&v<1000)||!three(matchOdds)||!entry.odds.every((v:number,i:number)=>v===matchOdds[i]))return null;
  if(!three(entry.rawProbabilities)||!entry.rawProbabilities.every((v:number)=>v>0&&v<1)||Math.abs(entry.rawProbabilities.reduce((a:number,b:number)=>a+b,0)-1)>.002)return null;
  const pick=Number(entry.pick),probability=Number(entry.probability),oldScore=Number(entry.score),newScore=Number(entry.newScore);
  if(!Number.isInteger(pick)||pick<0||pick>2||!Number.isFinite(probability)||probability<=0||probability>entry.rawProbabilities[pick]||![oldScore,newScore].every(v=>Number.isInteger(v)&&v>=0&&v<=100))return null;
  if(!['current','close-reference'].includes(String(match.oddsPhase||''))||!Array.isArray(match.providers)||new Set(match.providers).size!==1)return null;
  const quoteProvider=String(match.providers[0]||'');if(!quoteProvider||quoteProvider.length>120)return null;
  const lead=kickoffAt-capturedAt,bucketMs=lead>6*3600000?6*3600000:lead>3600000?3600000:15*60000;
  const modelVersion=`market-form-v2-gated/${match.goalModel?.modelVersion||'no-goal-model'}`;
  return {id:JSON.stringify([match.leagueCode,match.id,bucketMs,Math.floor(capturedAt/bucketMs),modelVersion]),leagueCode:match.leagueCode,matchId:String(match.id),kickoffAt,capturedAt,sourceObservedAt,sourceUrl:String(match.sourceUrl),sourceUpdatedAt:null,
    quoteProvider,quotePhase:String(match.oddsPhase),homeOdds:entry.odds[0],drawOdds:entry.odds[1],awayOdds:entry.odds[2],rawProbabilities:JSON.stringify(entry.rawProbabilities),pick,conservativeProbability:probability,oldScore,newScore,modelVersion};
}

export function observedOutcome(match:ObservedMatch|null|undefined){
  if(!match||!/^\d{3,30}$/.test(String(match.id||''))||!match.leagueCode||!Number.isSafeInteger(match.observedAt)||!trustedSource(String(match.sourceUrl||'')))return null;
  const observedAt=Number(match.observedAt),detail=String(match.detail||'');
  const halted=/(cancel|abandon|postpon|suspend)/i.test(detail);
  const matchDate=match.date;
  if(matchDate==null||!Number.isSafeInteger(matchDate)||(!halted&&matchDate>observedAt)||observedAt>Date.now()+60000)return null;
  if(!halted&&match.status!=='finished')return null;
  // Number(null) is zero: a missing score must never become a fabricated 0-0.
  const hs=halted||match.hs==null?null:Number(match.hs),as=halted||match.as==null?null:Number(match.as);
  if(!halted&&(hs==null||as==null||!Number.isInteger(hs)||!Number.isInteger(as)||hs<0||as<0))return null;
  const ambiguous=halted||!!match.scoreConflict||/(AET|extra time|penalt|shootout)/i.test(detail)||(Number(match.period)!==2&&!/(full.?time|FULL_TIME)/i.test(detail));
  const state=ambiguous?'review':'final';
  return {id:JSON.stringify([match.leagueCode,match.id,state,hs,as]),leagueCode:String(match.leagueCode),matchId:String(match.id),observedAt,state,homeScore:hs,awayScore:as,sourceUrl:String(match.sourceUrl),detail:detail.slice(0,300)};
}
