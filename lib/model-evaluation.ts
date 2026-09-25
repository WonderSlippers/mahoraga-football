// Read-only chronological evaluation of forecasts frozen before kickoff.
// No same-sample tuning or automatic score promotion occurs here.
type Row=Record<string,unknown>;
type Evaluated={key:string;league:string;kickoff:number;captured:number;leadHours:number;pick:number;odds:number[];raw:number[];market:number[];oldScore:number;newScore:number;actual:number;quotePhase:string;quoteProvider:string;sourceTimeKnown:boolean;modelVersion:string};
const HOLDOUT_FROM=Date.parse('2026-10-24T00:00:00Z');
// A frozen protocol for future observations. Existing settled history is
// descriptive; changing any rule requires a new protocol ID and holdout.
export const PROSPECTIVE_STUDY_PROTOCOL=Object.freeze({
  id:'football-1x2-asof-2026-09-24-v1',registeredAt:'2026-09-24T05:24:23Z',confirmatoryFrom:'2026-10-24T00:00:00Z',
  unit:'one match, earliest eligible pre-kickoff snapshot within 24 hours',market:'regular-time 1X2',stakeYuan:20,
  primaryMetrics:['multiclass Brier versus same-quote de-vig market','log loss versus same-quote de-vig market'],
  secondaryMetrics:['hypothetical fixed-stake ROI','observed price-haircut scenarios','old versus new score selection on the same match'],
  exclusions:['no trustworthy regular-time final','conflicting or review outcome','less than 10 minutes or more than 24 hours before kickoff','incomplete same-provider price'],
  minimumObservation:'200 unique settled matches over 30 days, at least 50 after fixed holdout start; minimum is not proof',
  promotion:'manual review only; automatic promotion forbidden',
  changeRule:'new threshold, market, model, source, or sampling rule starts a separately named protocol; retain failed versions',
});
const key=(row:Row)=>`${String(row.league_code||'')}:${String(row.match_id||'')}`;
const num=(value:unknown)=>Number(value);
const valid3=(rows:unknown[]):rows is number[]=>rows.length===3&&rows.every(value=>typeof value==='number'&&Number.isFinite(value));
const round=(n:number,digits=4)=>Math.round(n*10**digits)/10**digits;

function summary(rows:Evaluated[]){
  const ordered=[...rows].sort((a,b)=>a.kickoff-b.kickoff||a.key.localeCompare(b.key));
  let pnl=0,peak=0,maxDrawdown=0,wins=0,brier=0,marketBrier=0,logLoss=0,marketLogLoss=0;
  const epsilon=1e-6;
  for(const row of ordered){
    const won=row.pick===row.actual;if(won)wins++;
    pnl+=20*(won?row.odds[row.pick]-1:-1);peak=Math.max(peak,pnl);maxDrawdown=Math.max(maxDrawdown,peak-pnl);
    for(let i=0;i<3;i++){const target=i===row.actual?1:0;brier+=(row.raw[i]-target)**2;marketBrier+=(row.market[i]-target)**2;}
    logLoss-=Math.log(Math.max(epsilon,row.raw[row.actual]));marketLogLoss-=Math.log(Math.max(epsilon,row.market[row.actual]));
  }
  return {matches:ordered.length,wins,hitRate:ordered.length?round(wins/ordered.length):null,stake:20*ordered.length,pnl:round(pnl,2),roi:ordered.length?round(pnl/(20*ordered.length)):null,maxDrawdown:round(maxDrawdown,2),
    brier:ordered.length?round(brier/ordered.length):null,marketBrier:ordered.length?round(marketBrier/ordered.length):null,logLoss:ordered.length?round(logLoss/ordered.length):null,marketLogLoss:ordered.length?round(marketLogLoss/ordered.length):null};
}

function priceStress(rows:Evaluated[]){
  const current=rows.filter(row=>row.quotePhase==='current');
  const roiAtHaircut=(haircut:number)=>{
    if(!current.length)return null;
    const pnl=current.reduce((sum,row)=>sum+20*(row.pick===row.actual?Math.max(1.01,row.odds[row.pick]*(1-haircut))-1:-1),0);
    return round(pnl/(20*current.length));
  };
  let fragile=0,baseEdge=0,stressedEdge=0;
  for(const row of current){
    const probability=row.raw[row.pick],odds=row.odds[row.pick];
    const normal=probability*odds-1,stressed=Math.max(0,probability-.03)*Math.max(1.01,odds*.98)-1;
    baseEdge+=normal;stressedEdge+=stressed;if(normal>0&&stressed<=0)fragile++;
  }
  return {matches:current.length,observedRoi:summary(current).roi,priceMinus2PctRoi:roiAtHaircut(.02),priceMinus5PctRoi:roiAtHaircut(.05),
    meanRawEdge:current.length?round(baseEdge/current.length):null,meanEdgeIfProbabilityMinus3ppAndPriceMinus2Pct:current.length?round(stressedEdge/current.length):null,
    positiveEdgeFlips:fragile,sourceUpdatedTimeKnown:current.filter(row=>row.sourceTimeKnown).length,
    note:'仅对有 current 参考价的相同已结算比赛重算；假设每场仍能取得折减后的赔率。概率低 3 个百分点是情景假设，不是统计置信区间。无法证明当时可成交，也未模拟不可用比赛。'};
}

export function evaluateProspective(forecasts:Row[],outcomes:Row[],truncated=false,now=Date.now()){
  const resultMap=new Map<string,Row[]>();
  for(const row of outcomes){const id=key(row),existing=resultMap.get(id)||[];existing.push(row);resultMap.set(id,existing);}
  const byMatch=new Map<string,Evaluated[]>();const conflicts=new Set<string>(),pending=new Set<string>(),review=new Set<string>(),eligibleMatches=new Set<string>();let invalid=0,timingSkipped=0;
  for(const row of forecasts){
    const id=key(row),kickoff=num(row.kickoff_at),captured=num(row.captured_at),lead=kickoff-captured;
    if(!Number.isSafeInteger(kickoff)||!Number.isSafeInteger(captured)||kickoff>=now||lead<10*60000||lead>24*3600000){timingSkipped++;continue;}
    let raw:number[];try{raw=JSON.parse(String(row.raw_probabilities||''));}catch{invalid++;continue;}
    const odds=[num(row.home_odds),num(row.draw_odds),num(row.away_odds)];
    if(!valid3(raw)||!raw.every(v=>v>0&&v<1)||Math.abs(raw.reduce((a,b)=>a+b,0)-1)>.002||!valid3(odds)||odds.some(v=>v<=1||v>1000)){invalid++;continue;}
    const pick=num(row.pick),oldScore=num(row.old_score),newScore=num(row.new_score);
    if(!Number.isInteger(pick)||pick<0||pick>2||![oldScore,newScore].every(v=>Number.isInteger(v)&&v>=0&&v<=100)){invalid++;continue;}
    eligibleMatches.add(id);
    const reports=resultMap.get(id)||[],finals=reports.filter(r=>r.state==='final');
    if(reports.some(r=>r.state==='void'||r.state==='review')){review.add(id);continue;}
    if(!finals.length){pending.add(id);continue;}
    const scoreSet=new Set(finals.map(r=>`${r.home_score}:${r.away_score}`));
    if(scoreSet.size!==1){conflicts.add(id);continue;}
    if(finals[0].home_score==null||finals[0].away_score==null){invalid++;continue;}
    const home=num(finals[0].home_score),away=num(finals[0].away_score);
    if(!Number.isInteger(home)||!Number.isInteger(away)||home<0||away<0){invalid++;continue;}
    const inv=odds.map(o=>1/o),sum=inv.reduce((a,b)=>a+b,0),market=inv.map(v=>v/sum),actual=home>away?0:home===away?1:2;
    const sourceUpdatedAt=num(row.source_updated_at);
    const entry:Evaluated={key:id,league:String(row.league_code),kickoff,captured,leadHours:lead/3600000,pick,odds,raw,market,oldScore,newScore,actual,quotePhase:String(row.quote_phase||'unknown'),quoteProvider:String(row.quote_provider||'unrecorded'),sourceTimeKnown:Number.isSafeInteger(sourceUpdatedAt)&&sourceUpdatedAt>0,modelVersion:String(row.model_version||'unrecorded')};
    const existing=byMatch.get(id)||[];existing.push(entry);byMatch.set(id,existing);
  }
  // One predefined as-of selection per match: earliest snapshot inside the
  // last 24h. Never choose a later or better-looking forecast after result.
  const rows=[...byMatch.values()].map(group=>group.sort((a,b)=>a.captured-b.captured)[0]).sort((a,b)=>a.kickoff-b.kickoff||a.key.localeCompare(b.key));
  // Version cohorts use the earliest eligible snapshot of each version for
  // the same match. The pooled series above still counts a match only once.
  const versionRows=[...byMatch.values()].flatMap(group=>[...group.reduce((map,row)=>{const prior=map.get(row.modelVersion);if(!prior||row.captured<prior.captured)map.set(row.modelVersion,row);return map;},new Map<string,Evaluated>()).values()]);
  const multiVersionMatches=[...byMatch.values()].filter(group=>new Set(group.map(row=>row.modelVersion)).size>1).length;
  const pairGroups=new Map<string,{left:Evaluated;right:Evaluated}[]>();
  for(const group of byMatch.values()){
    const versions=[...new Set(group.map(row=>row.modelVersion))].sort();
    for(let i=0;i<versions.length;i++)for(let j=i+1;j<versions.length;j++){
      const candidates=group.filter(row=>row.modelVersion===versions[i]).flatMap(left=>group.filter(right=>right.modelVersion===versions[j]&&left.quoteProvider===right.quoteProvider&&left.quotePhase===right.quotePhase&&Math.abs(left.captured-right.captured)<=5*60000&&left.odds.every((price,k)=>price===right.odds[k])).map(right=>({left,right})));
      if(!candidates.length)continue;
      const best=candidates.sort((a,b)=>Math.abs(a.left.captured-a.right.captured)-Math.abs(b.left.captured-b.right.captured)||a.left.captured-b.left.captured)[0];
      const pairKey=JSON.stringify([versions[i],versions[j]]),previous=pairGroups.get(pairKey)||[];previous.push(best);pairGroups.set(pairKey,previous);
    }
  }
  const pairedVersionComparisons=[...pairGroups].sort(([a],[b])=>a.localeCompare(b)).map(([pairKey,pairs])=>({versions:JSON.parse(pairKey) as string[],matches:pairs.length,first:summary(pairs.map(pair=>pair.left)),second:summary(pairs.map(pair=>pair.right))}));
  const samePricePairedMatches=new Set([...pairGroups.values()].flatMap(pairs=>pairs.map(pair=>pair.left.key))).size;
  const oldA=rows.filter(r=>r.oldScore>=75),newA=rows.filter(r=>r.newScore>=75);
  const first=rows[0]?.kickoff??null,last=rows.at(-1)?.kickoff??null;
  const holdout=rows.filter(row=>row.kickoff>=HOLDOUT_FROM);
  const modelVersions=versionRows.reduce((map,row)=>(map[row.modelVersion]=(map[row.modelVersion]||0)+1,map),{} as Record<string,number>);
  const byModelVersion=Object.fromEntries(Object.keys(modelVersions).sort().map(version=>{const cohort=versionRows.filter(row=>row.modelVersion===version);return [version,{all:summary(cohort),oldA:summary(cohort.filter(row=>row.oldScore>=75)),newA:summary(cohort.filter(row=>row.newScore>=75)),currentQuoteOnly:summary(cohort.filter(row=>row.quotePhase==='current'))}];}));
  const enough=rows.length>=200&&holdout.length>=50&&first!=null&&last!=null&&last-first>=30*86400000&&Object.keys(modelVersions).length===1&&!truncated;
  const phaseCount=rows.reduce((map,row)=>(map[row.quotePhase]=(map[row.quotePhase]||0)+1,map),{} as Record<string,number>);
  return {version:'prospective-asof-24h-v3',protocol:PROSPECTIVE_STUDY_PROTOCOL,asOf:now,selectedMatches:rows.length,firstKickoff:first,lastKickoff:last,quotePhases:phaseCount,modelVersions,byModelVersion,multiVersionMatches,samePricePairedMatches,pairedVersionComparisons,holdoutFrom:HOLDOUT_FROM,
    coverage:{loadedForecastRows:forecasts.length,eligibleForecastMatches:eligibleMatches.size,settledUniqueMatches:rows.length,plannedFixtures:null,sourceUpdatedTimeKnown:rows.filter(row=>row.sourceTimeKnown).length,
      note:'这里只审计已冻结的预测；计划窗口内未采到的赛程尚无完整分母，不能据此计算全联赛捕获率。重复快照不算独立比赛。'},
    priceStress:priceStress(rows),
    skipped:{pendingMatches:pending.size,reviewMatches:review.size,conflictMatches:conflicts.size,invalidSnapshots:invalid,timingOrFutureSnapshots:timingSkipped},truncated,provisional:!enough,promotionAllowed:false,
    all:summary(rows),oldA:summary(oldA),newA:summary(newA),bothA:summary(rows.filter(r=>r.oldScore>=75&&r.newScore>=75)),oldOnlyA:summary(rows.filter(r=>r.oldScore>=75&&r.newScore<75)),newOnlyA:summary(rows.filter(r=>r.oldScore<75&&r.newScore>=75)),
    currentQuoteOnly:{all:summary(rows.filter(r=>r.quotePhase==='current')),oldA:summary(oldA.filter(r=>r.quotePhase==='current')),newA:summary(newA.filter(r=>r.quotePhase==='current'))},
    closeReferenceOnly:{all:summary(rows.filter(r=>r.quotePhase==='close-reference')),oldA:summary(oldA.filter(r=>r.quotePhase==='close-reference')),newA:summary(newA.filter(r=>r.quotePhase==='close-reference'))},
    holdout:{matches:holdout.length,all:summary(holdout),oldA:summary(holdout.filter(r=>r.oldScore>=75)),newA:summary(holdout.filter(r=>r.newScore>=75))},
    note:'总览每场只取最早合格预测；版本分组每场每版本各取最早预测，不能把分组样本数相加。仅同场、同供应商同价格且采集相差不超过五分钟才计入近似配对，仍不能单凭样本数宣称模型更优。holdout 按事先固定日期划分，不随新增样本移动。旧/新 A 级只是评分筛选对照，不是完整策略门槛或新旧概率模型比较。close-reference 不代表可成交；ROI 为假设收益；新评分未自动接管推单。'};
}
