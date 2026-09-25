type Match={id:string;leagueCode:string;date:number;status:string;oddsPhase?:string;odds?:number[]};
type Observations={forecastObserved?:number;forecastInserted?:number|null;outcomeObserved?:number;outcomeInserted?:number|null;error?:string};

// Counts what the selected source returned. It cannot infer fixtures omitted
// upstream or while the machine was offline; those remain unknown.
export function summarizeSamplingRun(id:string,capturedAt:number,selectedLeagues:string[],failedLeagues:string[],matches:Match[],observations:Observations){
  if(!id||!Number.isSafeInteger(capturedAt))throw new Error('invalid sampling run identity');
  const seen=new Map(matches.filter(row=>row?.id&&row?.leagueCode).map(row=>[`${row.leagueCode}:${row.id}`,row]));
  const future=[...seen.values()].filter(row=>row.status==='soon'&&Number.isSafeInteger(row.date)&&row.date>capturedAt&&row.date<=capturedAt+24*3600000);
  const complete=(row:Match)=>Array.isArray(row.odds)&&row.odds.length===3&&row.odds.every(value=>Number.isFinite(value)&&value>1);
  const currentComplete=future.filter(row=>row.oddsPhase==='current'&&complete(row)).length;
  const closeReference=future.filter(row=>row.oddsPhase==='close-reference'&&complete(row)).length;
  return {id,capturedAt,windowHours:24,selectedLeagues:[...new Set(selectedLeagues)].sort(),failedLeagues:[...new Set(failedLeagues)].sort(),
    returnedUniqueFixtures:seen.size,futureFixturesSeen:future.length,currentComplete,closeReference,
    incompleteOrUnavailable:future.length-currentComplete-closeReference,
    forecastObserved:Number(observations.forecastObserved)||0,forecastInserted:observations.forecastInserted==null?null:Number(observations.forecastInserted)||0,
    outcomeObserved:Number(observations.outcomeObserved)||0,outcomeInserted:observations.outcomeInserted==null?null:Number(observations.outcomeInserted)||0,
    forecastWriteError:Boolean(observations.error),plannedFixtureTotal:null,
    note:'只统计本轮已选联赛中公开源实际返回的比赛；失败联赛、停机时段和源头漏报无法补成赛前预测。close 是历史参考价，源头赔率更新时间未知。'};
}
