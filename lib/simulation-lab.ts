import { env } from "cloudflare:workers";
import {type GoalEvidence} from "@/lib/goal-model";
import { dcScoreGrid } from "./goal-model";
import {asianFactor,marketExpectation,validLine} from "../public/market-math.js";
import {strategyCanCreate,HISTORY_ONLY_STRATEGIES,REVIEW_PAUSED_STRATEGIES} from '../public/strategy-status.js';
import {FENCED_LAB_V1_INSERT_SQL,FENCED_LAB_V1_UPDATE_SQL,LAB_READ_SQL,LAB_V1_INSERT_SQL,LAB_V1_UPDATE_SQL,prepareLabShardCommit,restoreLabRows} from './lab-shards.js';

type Verification={provider:string;sourceUrl:string;capturedAt:number;score:[number,number];primarySourceUrl?:string;primaryCapturedAt?:number};
type DeepAnalysis = {summary:string;sections:{title:string;paras:string[]}[];capturedAt:number;sourceUrl:string;coverage:string};
export type Match = { id: string; leagueCode: string; date: number; status: string; home: string; away: string; hs: number; as: number; period: number; detail: string; odds: number[]; providers: string[]; oddsReason?:string;oddsPhase?:string;sourceUrl?:string;observedAt?:number; homeForm: string; awayForm: string; homeLogo?:string;awayLogo?:string;leagueLogo?:string;independentFinalVerified?:boolean;settlementEvidence?:Verification;totalOffers?:{line:number;over:number;under:number;provider:string;phase:string}[];spreadOffers?:{homeLine:number;awayLine:number;home:number;away:number;provider:string;phase:string}[];goalModel?:GoalEvidence;research?:{dqdSignals:[number,number];homeRest:number|null;awayRest:number|null;injuryAvailable:boolean;lineupConfirmed:boolean;newsMatched?:boolean;capturedAt?:number;deepAnalysis?:DeepAnalysis} };
const restText=(days:number|null)=>Number.isFinite(Number(days))&&days!=null?`${days} 天`:'缺失';
// Spoken-language analysis for every ticket leg, built only from data
// already on the match row — every ticket must read like a person's
// reasoning, not a row of numbers. Blogger shape: the model story
// first, then the price gap as the reason to act.
const attackLabel=(x:number)=>x<0.8?"进攻哑火":x<1.4?"进攻一般":x<2?"进攻有威胁":"进攻火力足";
const formLabel=(f:string)=>(f.match(/W/g)||[]).length>=3?"状态正热":(f.match(/L/g)||[]).length>=3?"状态低迷":"状态平平";
// 100-point bet quality score (user directive 2026-09-18): every leg
// gets one so boards can be ranked at a glance. Grade bands:
//   A ≥75 优先研究 · B 60–74 进一步核对 · C 45–59 观望 · D <45 回避
export const SCORE_BANDS=[{min:75,grade:"A",label:"优先研究"},{min:60,grade:"B",label:"进一步核对"},{min:45,grade:"C",label:"观望"},{min:0,grade:"D",label:"回避"}];
export function scoreBand(score:number){return SCORE_BANDS.find(b=>score>=b.min)!;}
export function scoreLegAudit(match:Pick<Match,"odds"|"research">,opts:{probability:number;edge:number;goalModel?:GoalEvidence}):{score:number;parts:string[]}{
  let blowoutCap=100;
  if(match.odds?.length===3){const inv=match.odds.map(o=>1/Number(o));const vig=inv.reduce((a,b)=>a+b,0);const fav=Math.max(...inv)/vig;if(fav>0.6&&Number(opts.probability)<0.25&&opts.edge<0.04)blowoutCap=44;}
  let s=50;const parts=['基础 50 分'];
  const edgePoints=Math.max(-25,Math.min(30,opts.edge*200));s+=edgePoints;parts.push(`估计优势 ${(opts.edge*100).toFixed(1)}% ${edgePoints>=0?'+':''}${edgePoints.toFixed(1)} 分`);
  const probabilityPoints=opts.probability>=.55?8:opts.probability>=.4?4:opts.probability>=.25?0:-6;s+=probabilityPoints;parts.push(`所选概率 ${(opts.probability*100).toFixed(1)}% ${probabilityPoints>=0?'+':''}${probabilityPoints} 分`);
  if(opts.goalModel){s+=8;parts.push('已纳入进球模型 +8 分');}else{s-=6;parts.push('缺少进球模型 -6 分');}
  const r=match.research;
  if(r){s+=4;parts.push('有研究快照 +4 分');if(r.lineupConfirmed){s+=5;parts.push('首发已确认 +5 分');}if(r.injuryAvailable){s+=3;parts.push('伤停信息可用 +3 分');}if((r.dqdSignals[0]+r.dqdSignals[1])===0){s+=2;parts.push('新闻信号未报变动 +2 分');}if(Number(r.homeRest)>=4&&Number(r.awayRest)>=4){s+=2;parts.push('双方休息至少四天 +2 分');}}
  else{s-=4;parts.push('缺少研究快照 -4 分');}
  if(blowoutCap<100)parts.push('极端热门对立方向，最高 44 分');
  return {score:Math.max(0,Math.min(blowoutCap,Math.round(s))),parts};
}
export function scoreLeg(match:Pick<Match,"odds"|"research">,opts:{probability:number;edge:number;goalModel?:GoalEvidence}):number{return scoreLegAudit(match,opts).score;}
// Experimental evidence-quality overlay. It never changes the established
// decision score, thresholds, historical grades, or previously frozen tickets.
// These deductions are rules, not backtested probability calibration.
export function scoreLegV2Audit(match:Pick<Match,"odds"|"research">,opts:{probability:number;edge:number;goalModel?:GoalEvidence;phase?:string;odds?:number}):{score:number;parts:string[]}{
  const old=scoreLegAudit(match,opts).score,parts=[`旧算法 ${old} 分`];let deduction=0;
  const signalMargin=Number(opts.goalModel?.availabilityInputs?.marginBump||0);
  const adjustedProbability=opts.odds&&signalMargin>0?Math.max(.02,opts.probability-signalMargin):opts.probability;
  const adjustedEdge=opts.odds&&signalMargin>0?adjustedProbability*opts.odds-1:opts.edge;
  const numericalScore=signalMargin>0&&opts.odds?scoreLegAudit(match,{...opts,probability:adjustedProbability,edge:adjustedEdge}).score:old;
  if(signalMargin>0&&opts.odds)parts.push(`公开出场信号实际边际 +${(signalMargin*100).toFixed(1)} 个百分点，试验概率 ${(adjustedProbability*100).toFixed(1)}%、优势 ${(adjustedEdge*100).toFixed(1)}%；数值分 ${numericalScore}`);
  const subtract=(points:number,why:string)=>{deduction+=points;parts.push(`${why} -${points} 分`);};
  const g=opts.goalModel;
  if(!g)subtract(8,'独立进球数据缺失');
  else{
    if(g.seasons?.length===1)subtract(8,'仅本赛季进球样本');
    if(Math.min(Number(g.home?.games??99),Number(g.away?.games??99))<5)subtract(4,'至少一队样本少于五场');
    if(g.availabilityInputs?.marginBump)subtract(4,'结构化缺阵/停赛提示出场不确定性');
  }
  const r=match.research;
  if(!r)subtract(6,'逐场研究缺失');
  else{
    if(!r.lineupConfirmed)subtract(4,'首发未确认');
    if(!r.injuryAvailable)subtract(3,'伤停报告不完整');
    if(!r.newsMatched)subtract(2,'球队新闻源未双边匹配');
    if(r.homeRest==null||r.awayRest==null)subtract(2,'休息天数不完整');
    if(!r.newsMatched&&(r.dqdSignals[0]+r.dqdSignals[1])===0)subtract(2,'新闻零信号不能当作安全');
  }
  if(opts.phase==='open')subtract(6,'仅开盘价，未见当前报价');
  if(opts.phase==='close'||opts.phase==='close-reference')subtract(4,'仅源 close 字段参考价，更新时间与可成交状态未知');
  return {score:Math.max(0,numericalScore-deduction),parts};
}
export function analysisText(match:Pick<Match,"home"|"away"|"homeForm"|"awayForm">,opts:{market:"1x2"|"total"|"spread";pickName:string;odds:number;probability:number;margin:number;goalModel?:GoalEvidence}):string{
  const {pickName,odds,probability,margin}=opts,g=opts.goalModel;
  const implied=(100/odds).toFixed(1),raw=((probability+margin)*100).toFixed(1),edge=(probability*odds*100-100).toFixed(1);
  let story:string;
  if(opts.market==="total"&&g){
    const sum=Number(g.expectedHome)+Number(g.expectedAway);
    story=`${match.home}主场预期进球 ${g.expectedHome.toFixed(2)}（${attackLabel(g.expectedHome)}），${match.away}客场 ${g.expectedAway.toFixed(2)}（${attackLabel(g.expectedAway)}）——两队合计 ${sum.toFixed(2)} 个预期进球`;
  }else if(opts.market==="spread"&&g){
    story=`进球模型给 ${match.home} 主场预期 ${g.expectedHome.toFixed(2)}、${match.away} 客场 ${g.expectedAway.toFixed(2)}，差距 ${(g.expectedHome-g.expectedAway).toFixed(2)} 球——让半球的胜面就从这个差距算`;
  }else{
    const homeForm=match.homeForm||"无记录",awayForm=match.awayForm||"无记录";
    story=`近期状态：${match.home} ${homeForm}（${formLabel(homeForm)}）对 ${match.away} ${awayForm}（${formLabel(awayForm)}）`;
    if(g)story+=`，进球模型预期 主 ${g.expectedHome.toFixed(2)} / 客 ${g.expectedAway.toFixed(2)}`;
  }
  const gap=probability*odds>1?`单位本金估计净收益为 ${((probability*odds-1)*100).toFixed(1)} %——仅为模型估计，未经独立回测`:`单位本金估计净损失为 ${((1-probability*odds)*100).toFixed(1)} %——价格没给够补偿，这笔是负期望（娱乐/对照记录）`;
  return `解析：${story}。${pickName} 模型概率 ${raw}%，扣掉 ${(margin*100).toFixed(1)} 个点的不确定性后按 ${(probability*100).toFixed(1)}% 算；参考价 ${odds.toFixed(2)} 只隐含 ${implied}%——${gap}（估计优势 ${edge}%）。`;
}
// Bet-time team-state lines: frozen into the ticket rationale so every
// leg answers "为什么是这项" with verified status, not just arithmetic.
const researchRationale=(m:Match):string[]=>{
  const r=m.research;if(!r)return[];
  const signals=r.dqdSignals[0]+r.dqdSignals[1];
  return [
    `资讯核对：懂球帝标题疑似出场信号 主 ${r.dqdSignals[0]} / 客 ${r.dqdSignals[1]} 条，${signals>0?'仅待人工核验，不凭关键词自动调整概率':'没有相关新闻标题不等于零伤停'}。`,
    `赛程休息：主 ${restText(r.homeRest)} / 客 ${restText(r.awayRest)}；旧概率公式未做疲劳修正，新试验评分按覆盖情况扣分。`,
    `伤停报告：${r.injuryAvailable?'双方公开报告可用；具体缺阵影响尚未量化':'公开名单缺失；未猜测具体缺阵，也未据此调整胜平负概率'}。`,
    `首发：${r.lineupConfirmed?'已确认并核验；目前未量化球员影响':'尚未确认；公布后需重新核对候选，当前概率不会自动按球员调整'}。`,
  ];
};
type Evidence = {modelVersion:string;calculatedAt:number;marketOdds:number[];marketProbabilities:number[];adjustedProbabilities:number[];homeForm:string;awayForm:string;formDelta:number;uncertaintyMargin:number;goalModelWeight?:number;evolutionMarginShift?:number};
type Leg = { matchId: string; leagueCode: string; home: string; away: string; kickoffAt: number; pick: number; odds: number; provider: string; probability: number; status: string; finalScore?: string; evidence?:Evidence;goalEvidence?:GoalEvidence;market?:"total"|"spread";side?:"over"|"under"|"home"|"away";line?:number;phase?:string;priceCapturedAt?:number;returnFactor?:number;expectedReturn?:number;decisionVersion?:string;settlementEvidence?:Verification;homeLogo?:string;awayLogo?:string;leagueLogo?:string;logosCheckedAt?:number;rationale?:string[];score?:number;newScore?:number;priceDrift?:number;lossType?:string;deepAnalysis?:DeepAnalysis;directionChanged?:boolean;alt?:{dir:string;odds:number;pick:number;side?:string;line?:number;market:string};driftNote?:string;scoreOrigin?:string;scoreComputedAt?:number;scoreDisplayVersion?:string };
type Ticket = { id: string; day: string; createdAt: number; legs: Leg[]; odds: number; stake: number; status: string; pnl: number; settledAt?: number; settledOdds?: number; estimatedEdge: number };
type Portfolio = { id: string; name: string; rule: string; legs: number; enabled: boolean; stake: number; maxTickets: number; minTickets?: number; initialBalance: number; tickets: Ticket[] };
type Review = {leg:Leg;edge:number;shift:number;value:boolean;homeLogo?:string;awayLogo?:string;leagueLogo?:string;totalOffers?:NonNullable<Match['totalOffers']>};
type SpreadAuditCandidate={side:"home"|"away";line:number;odds:number;provider:string;phase:string;probability:number;edge:number;score:number;qualifies:boolean;reasons:string[]};
type StrategyPolicy={version:string;effectiveAt:string;pausedPortfolios:string[];rules:string[];basis:string[]};
type RadarEntry={matchId:string;leagueCode:string;home:string;away:string;kickoffAt:number;stage:"calendar"|"prescreen"|"execution";priced:boolean;quotePhase?:string;odds:number[];spreadQuotes:number;totalQuotes:number;reason:string;observedAt?:number;stale?:boolean;edge?:number;probability?:number;rawProbabilities?:number[];score?:number;newScore?:number;scoreBasis?:string;newScoreBasis?:string;pick?:number;qualifies:boolean};
type Radar={capturedAt:number;horizonDays:number;total:number;priced:number;fresh:number;stale:number;coveredLeagues:number;executionWindow:number;prescreenWindow:number;byDay:{day:string;matches:number;priced:number}[];byLeague:{leagueCode:string;matches:number;priced:number}[];entries:RadarEntry[]};
type OddsCoverage={future:number;complete:number;partial:number;missing:number;executionFuture:number;executionComplete:number;executionPartial:number;executionMissing:number;researchFuture:number;researchComplete:number;researchMissing:number;capturedAt:number};
type ScanMeta={scanBatchId?:string;scannedLeagues?:number;totalLeagues?:number;selectedLeagues?:string[];freshLeagueCodes?:string[];sweepSlot?:number;sweepSlots?:number;failedLeagues?:number;failedLeagueCodes?:string[];failedLeagueErrors?:Record<string,string>;retryRecoveredCodes?:string[];oddsCoverage?:OddsCoverage};
export type Lab = { radar?:Radar;decisionAudit?:{matchId:string;reason:string;capturedAt:number;spreadLines:number[];totalLines:number[];spreadCandidates?:SpreadAuditCandidate[]}[];version: number; updatedAt: number; lastScanAt: number; portfolios: Portfolio[]; reviews?:Review[]; marketReviews?:Review[]; strategyPolicy?:StrategyPolicy; lastScan?: { scanBatchId?:string;candidates: number; valueCandidates: number; placed: number; settled: number; radarMatches?:number;pricedRadar?:number;executionWindow?:number;prescreenWindow?:number;pauseReason?: string; scannedLeagues?: number; totalLeagues?:number; selectedLeagues?:string[];freshLeagueCodes?:string[];sweepSlot?:number;sweepSlots?:number;failedLeagues?: number; failedLeagueCodes?: string[]; retryRecoveredCodes?: string[]; oddsCoverage?:OddsCoverage }; evolution?: { marginShift: number; modelW: number; notes: string[]; computedAt: number; leagueStats?: Record<string,{settled:number;clvSum:number;pnl:number}> } };
// Calibration: fit model behaviour against real settlements instead of
// trusting the heuristic margin forever. Buckets compare predicted vs
// actual win rates; the 50-70% bucket drives an auto-evolution of the
// uncertainty margin (bounded ±2pp, every change versioned in notes).
export type CalibrationBucket={range:string;predicted:number;actual:number;count:number;gap:number};
export type LabCalibration={computedAt:number;totalSettledLegs:number;brier:number|null;buckets:CalibrationBucket[];valueRoi:number|null;fillRoi:number|null;marketStats:{market:string;settled:number;roi:number|null}[];evolutionNote:string;evolutionMarginShift:number};
export function computeCalibration(lab:Lab):LabCalibration|null{
  const rows:{prob:number;win:boolean;market:string;isFill:boolean;realized:number}[]=[];
  const seen=new Set<string>();
  for(const p of lab.portfolios)for(const t of p.tickets){
    if(!settled(t)||t.status==="void")continue;
    const isFill=String(t.id).includes(":fill:");
    for(const l of t.legs){
      if(!["win","loss"].includes(l.status))continue;
      if(l.market)continue; // Asian half-win/push outcomes are not a binary 1X2 calibration sample
      // Calibrate on the RAW model probability, not the conservative one:
      // conservative = raw − margin by construction, so bucketing
      // conservative probabilities would read the deliberate margin as
      // underconfidence and mis-evolve it away. Reconstruct raw where the
      // evidence keeps it (1X2), else add the recorded margin back.
      const margin=Number(l.goalEvidence?.uncertaintyMargin??l.evidence?.uncertaintyMargin??0);
      const raw1x2=l.evidence?.adjustedProbabilities?.[Number(l.pick)];
      const key=[l.leagueCode,l.matchId,l.market||"1x2",l.side||l.pick,l.line??"",l.decisionVersion||l.evidence?.modelVersion||l.goalEvidence?.modelVersion||"legacy"].join(":");
      if(seen.has(key))continue;seen.add(key);
      const prob=l.decisionVersion==="evidence-v3"?l.probability:Number.isFinite(Number(raw1x2))?Number(raw1x2):Number(l.probability)+margin;
      const odds=Number(l.odds);
      // prob<=0 means "probability unknown" (legacy cloud-import legs carry a
      // placeholder 0 with empty adjustedProbabilities), not a real 0%
      // prediction — including them fabricated a bogus 0–10% bucket.
      if(!Number.isFinite(prob)||prob<=0||prob>=1||!Number.isFinite(odds)||odds<=1)continue;
      rows.push({prob,win:l.status==="win",market:l.market||"1x2",isFill,realized:(l.returnFactor??(l.status==="win"?odds:0))-1});
    }
  }
  if(rows.length<5)return null;
  const brier=rows.reduce((s,r)=>s+(r.prob-(r.win?1:0))**2,0)/rows.length;
  const buckets:CalibrationBucket[]=[];
  for(let index=0;index<10;index++){const sel=rows.filter(r=>Math.min(9,Math.floor(r.prob*10))===index);if(!sel.length)continue;const predicted=sel.reduce((s,r)=>s+r.prob,0)/sel.length,actual=sel.filter(r=>r.win).length/sel.length;buckets.push({range:`${index*10}–${(index+1)*10}%`,predicted,actual,count:sel.length,gap:actual-predicted});}
  const roiOf=(sel:{realized:number}[])=>sel.length?sel.reduce((s,r)=>s+r.realized,0)/sel.length:null;
  const marketMap=new Map<string,number[]>();for(const r of rows){const a=marketMap.get(r.market)||[];a.push(r.realized);marketMap.set(r.market,a);}
  return {computedAt:Date.now(),totalSettledLegs:rows.length,brier,buckets,valueRoi:roiOf(rows.filter(r=>!r.isFill)),fillRoi:roiOf(rows.filter(r=>r.isFill)),marketStats:[...marketMap.entries()].map(([market,v])=>({market,settled:v.length,roi:v.reduce((s,x)=>s+x,0)/v.length})),evolutionNote:"仅胜平负二元结果；亚洲盘半赢/走水不混入 Brier。暂停滚动自动调参；概率按比赛/方向/版本去重，须时间外验证后再调整",evolutionMarginShift:lab.evolution?.marginShift||0};
}
const DERBY_CITIES=["Madrid","Milan","London","Manchester","Liverpool","Rome","Roma","Istanbul","Buenos Aires","Sao Paulo","São Paulo","Rio","Glasgow","Moscow","Barcelona","Seville","Lisbon","Athens","Cairo","Tokyo","Osaka","Beijing","Shanghai","Guangzhou","Derby","Birmingham"];
const isDerby=(a:string,b:string)=>DERBY_CITIES.some(c=>String(a).toLowerCase().includes(c.toLowerCase())&&String(b).toLowerCase().includes(c.toLowerCase()));
let currentEvolutionShift=0;
let currentModelW=0.5;
/* Correlation discount: same-league or same-kickoff-day parlay legs share hidden factors (weather, referee, round fatigue). */
const correlated=(a:Leg,b:Leg)=>a.leagueCode===b.leagueCode||Math.abs(Number(a.kickoffAt)-Number(b.kickoffAt))<12*3600000;
const EXECUTION_WINDOW_MINUTES=24*60;
const RESEARCH_WINDOW_MINUTES=48*60;
/* League whitelist: a league with >=12 settled legs and negative CLV sum stops receiving new tickets (auto circuit at league level). */
// Streak brake: after 3 straight losses a portfolio's stake halves; after
// 5 it quarters. Win streaks never raise the stake (Kelly already scales
// up with edge; tilt protection only works one direction).
export function portfolioStreak(portfolio:Portfolio):{losses:number;wins:number;mult:number}{
  const done=portfolio.tickets.filter(t=>["win","loss"].includes(t.status)).sort((a,b)=>(b.settledAt||b.createdAt)-(a.settledAt||a.createdAt));
  let losses=0,wins=0;
  for(const t of done){if(t.status==="loss"&&wins===0)losses++;else if(t.status==="win"&&losses===0)wins++;else break;}
  return {losses,wins,mult:losses>=5?0.25:losses>=3?0.5:1};
}

const key = "simulation_lab_v1";
const day = (time = Date.now()) => new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(time));
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi,n));
const settled = (ticket: Ticket) => ["win","loss","void"].includes(ticket.status);
const PROFIT_GUARD_PAUSED=["treble","mixed-double","totals-poisson","totals-baseline"];
const roiText=(tickets:Ticket[])=>{const rows=tickets.filter(settled),stake=rows.reduce((s,t)=>s+Number(t.stake||0),0),pnl=rows.reduce((s,t)=>s+Number(t.pnl||0),0);return `${rows.length} 单，投入收益率 ${stake?`${pnl/stake*100>=0?"+":""}${(pnl/stake*100).toFixed(2)}%`:"缺失"}`;};
// The policy explanation is derived from the live ledger every time it is
// read or settled.  This prevents a newly settled round from leaving stale
// sample counts and ROI claims in the UI while keeping historical tickets
// immutable.
export function profitGuard(lab?:Lab):StrategyPolicy{
  const basis=lab?[...lab.portfolios.flatMap(p=>p.tickets.filter(t=>String(t.id).includes(":fill:")))]:[];
  const byId=(id:string)=>lab?.portfolios.find(p=>p.id===id)?.tickets||[];
  const aLegs=new Map<string,Leg>();
  if(lab)for(const p of lab.portfolios)for(const t of p.tickets){if(!settled(t)||t.status==="void")continue;for(const l of t.legs){const score=Number(l.score);if(!Number.isFinite(score)||score<75||!["win","loss"].includes(l.status))continue;const k=[l.leagueCode,l.matchId,l.market||"1x2",l.side??l.pick,l.line??"",l.decisionVersion||l.evidence?.modelVersion||l.goalEvidence?.modelVersion||"legacy"].join(":");if(!aLegs.has(k))aLegs.set(k,l);}}
  const aRows=[...aLegs.values()],aRoi=aRows.length?aRows.reduce((s,l)=>s+((l.returnFactor??(l.status==="win"?l.odds:0))-1),0)/aRows.length*100:null;
  return {version:"flat-stake-v5",effectiveAt:"2026-09-21",pausedPortfolios:[...PROFIT_GUARD_PAUSED],rules:["所有策略的新模拟单统一均注 20 元；历史票据金额保持冻结，不回写","精选与价值单只接收 A 级、保守优势至少 8%、概率至少 40%、赔率不高于 3.00 的候选","二串一只用两个 A 级胜平负方向；拒绝同联赛或 12 小时内开球的相关组合","三串一、胜负＋大小球混合串、进球分布大小球实验暂停新增；旧单继续结算且不改写","广覆盖与娱乐强制单仅作对照，不纳入盈利策略结论"],basis:lab?[`历史补位票据 ${roiText(basis)}`,`胜负＋大小球二串一 ${roiText(byId("mixed-double"))}`,`三串一 ${roiText(byId("treble"))}`,`A 级去重腿 ${aRows.length} 条，等权收益 ${aRoi==null?"缺失":`${aRoi>=0?"+":""}${aRoi.toFixed(2)}%`}；样本仍不足，不能承诺盈利`]:["结算样本尚未载入；策略依据会在读取账本后自动刷新"]};
}
const defaults = (): Lab => ({version:1,updatedAt:0,lastScanAt:0,portfolios:[
  {id:"all-singles",name:"广覆盖单场",rule:"覆盖所有有可核验 1X2 赔率的赛前比赛；新单统一均注 20 元。",legs:1,enabled:true,stake:20,maxTickets:100,minTickets:5,initialBalance:10000,tickets:[]},
  {id:"value-singles",name:"精选价值单场",rule:"2026-09-21 v5：只选 A 级、保守优势至少 8%、概率至少 40%、赔率 1.20–3.00 的候选；新单统一均注 20 元。",legs:1,enabled:true,stake:20,maxTickets:5,minTickets:0,initialBalance:10000,tickets:[]},
  {id:"double",name:"二串一研究",rule:"2026-09-21 v5：两腿均须 A 级胜平负、保守优势至少 8%、概率至少 50%、单腿赔率不高于 2.50；新单统一均注 20 元。",legs:2,enabled:true,stake:20,maxTickets:5,minTickets:0,initialBalance:10000,tickets:[]},
  {id:"treble",name:"三串一研究（暂停新增）",rule:"2026-09-21 v5：暂停新增并继续结算旧单；若恢复，新单统一均注 20 元。",legs:3,enabled:true,stake:20,maxTickets:5,minTickets:0,initialBalance:10000,tickets:[]},
  {id:"totals-baseline",name:"大小球基准单场",rule:"第一版按赛事编号分配大/小没有预测依据，已停止生成新单；若恢复，新单统一均注 20 元。",legs:1,enabled:true,stake:20,maxTickets:5,initialBalance:10000,tickets:[]},
  {id:"mixed-double",name:"胜负＋大小球二串一（暂停新增）",rule:"2026-09-21 v5：暂停新增；若恢复，新单统一均注 20 元。旧单继续结算，不删除、不重写。",legs:2,enabled:true,stake:20,maxTickets:5,minTickets:0,initialBalance:10000,tickets:[]},
  {id:"spread-singles",name:"多档让球观察单场",rule:"2026-09-21 v5：仅同源当前/收盘双边价，且须 A 级、保守优势至少 8%、概率至少 40%、赔率不高于 3.00；新单统一均注 20 元。",legs:1,enabled:true,stake:20,maxTickets:5,minTickets:0,initialBalance:10000,tickets:[]},
  {id:"totals-poisson",name:"进球分布大小球实验（暂停新增）",rule:"2026-09-21 v5：暂停新增；若恢复，新单统一均注 20 元。保留研究计算与旧单结算。",legs:1,enabled:true,stake:20,maxTickets:5,minTickets:0,initialBalance:10000,tickets:[]},
  {id:"featured-picks",name:"严格精选（最多 10 场）",rule:"只接收 A 级、保守优势至少 8%、概率至少 40%、赔率不高于 3.00 的候选；分批扫描期间仅在本批已核验比赛中排序，不能称为全联赛前十；不凑数，新单统一均注 20 元。",legs:1,enabled:true,stake:20,maxTickets:10,initialBalance:10000,tickets:[]},
  {id:"forced-fun",name:"娱乐强制基准（用户指定）",rule:"每场各玩法强制记录，不设优势门槛；新单统一均注 20 元。仅作为对照基准，不构成策略推荐。",legs:1,enabled:true,stake:20,maxTickets:60,initialBalance:10000,tickets:[]},
]});

export async function readLab(): Promise<Lab> {
  const db=env.DB;if(!db)throw new Error("模拟账本数据库不可用");
  const stored=restoreLabRows((await db.prepare(LAB_READ_SQL).all<{key:string;payload:string;updated_at:number}>()).results);
  if(!stored)return defaults();
  const saved=stored.lab as Lab;
  if(!Array.isArray(saved.portfolios))throw new Error("多策略账本格式错误，旧记录未覆盖");
  // The database revision, not a JSON copy, is authoritative for CAS writes.
  // Correct a stale payload timestamp without changing tickets or settings.
  if(saved.updatedAt!==stored.revision){console.error("simulation_lab_revision_mismatch",{payload:saved.updatedAt,database:stored.revision});saved.updatedAt=stored.revision;}
  // Add newly introduced comparisons without changing any existing settings or tickets.
  for(const template of defaults().portfolios)if(!saved.portfolios.some(p=>p.id===template.id))saved.portfolios.push(template);
  // Existing ticket stakes stay frozen. Portfolio stake is migrated because
  // every future strategy ticket now uses the same ¥20 flat stake.
  // Rules are explanatory copy for the current engine; frozen tickets retain
  // their original prices, probabilities and evidence.
  for(const template of defaults().portfolios){const existing=saved.portfolios.find(p=>p.id===template.id);if(existing){existing.rule=template.rule;existing.name=template.name;existing.stake=20;if(template.id!=="all-singles")existing.minTickets=0;if(template.minTickets!=null&&existing.minTickets==null)existing.minTickets=template.minTickets;if(existing.minTickets!=null&&existing.maxTickets<existing.minTickets)existing.minTickets=existing.maxTickets;}}
  saved.strategyPolicy=profitGuard(saved);
  return saved;
}
async function saveLab(lab: Lab, expected: number, leaseToken?:string) {
  const db=env.DB;if(!db)throw new Error("模拟账本数据库不可用");
  const v2=await db.prepare("SELECT updated_at FROM app_state WHERE key='simulation_lab_v2'").first<{updated_at:number}>();
  if(v2){
    if(Number(v2.updated_at)!==expected)return false;
    const commit=prepareLabShardCommit(db,lab,expected,'v2',leaseToken||null);
    try{
      await db.batch(commit.statements);
      lab.updatedAt=commit.revision;
      return true;
    }catch(error){
      // A changed revision or stolen scan lease is a normal CAS failure.
      // Other SQL faults remain visible instead of being retried as conflicts.
      const latest=await db.prepare("SELECT updated_at FROM app_state WHERE key='simulation_lab_v2'").first<{updated_at:number}>();
      if(Number(latest?.updated_at)!==expected)return false;
      if(leaseToken){
        const owner=await db.prepare("SELECT json_extract(payload,'$.token') AS token FROM app_state WHERE key='scan_lock'").first<{token:string}>();
        if(owner?.token!==leaseToken)return false;
      }
      throw error;
    }
  }
  const stamp = Math.max(Date.now(),expected+1); lab.updatedAt=stamp;
  const result = expected === 0
    ? leaseToken
      ? await db.prepare(FENCED_LAB_V1_INSERT_SQL).bind(key,JSON.stringify(lab),stamp,leaseToken).run()
      : await db.prepare(LAB_V1_INSERT_SQL).bind(key,JSON.stringify(lab),stamp).run()
    : leaseToken
      ? await db.prepare(FENCED_LAB_V1_UPDATE_SQL).bind(JSON.stringify(lab),stamp,key,expected,leaseToken).run()
      : await db.prepare(LAB_V1_UPDATE_SQL).bind(JSON.stringify(lab),stamp,key,expected).run();
  return Number(result.meta.changes)===1;
}
export type PublicPaperQuote={matchId:string;leagueCode:string;home:string;away:string;kickoffAt:number;odds:number[];provider:string;sourceUrl:string;capturedAt:number};
export function preparePublicPaperTicket(current:Lab,quote:PublicPaperQuote,now=Date.now()){
  if(!/^\d{3,30}$/.test(quote.matchId)||quote.leagueCode!=='uefa.nations'||!Number.isSafeInteger(quote.kickoffAt)||quote.kickoffAt<=now+10*60000||quote.kickoffAt>now+24*3600000)throw new Error('赛事已过模拟窗口');
  if(!Array.isArray(quote.odds)||quote.odds.length!==3||quote.odds.some(value=>!Number.isFinite(value)||value<1.01||value>1000)||!/^https:\/\//.test(quote.sourceUrl)||!Number.isSafeInteger(quote.capturedAt)||quote.capturedAt>now+1000)throw new Error('公开报价证据不完整');
  const lab=structuredClone(current),portfolio=lab.portfolios.find(p=>p.id==='forced-fun');
  if(!portfolio||!portfolio.enabled)throw new Error('娱乐对照组合未启用');
  const id=`forced-fun:public-paper:${quote.leagueCode}:${quote.matchId}`;
  if(portfolio.tickets.some(ticket=>ticket.id===id))return {lab,expected:current.updatedAt,created:false,id};
  if(portfolio.tickets.filter(ticket=>ticket.day===day(now)).length>=portfolio.maxTickets)throw new Error('娱乐对照今日票数已达上限');
  const inverse=quote.odds.map(value=>1/value),sum=inverse.reduce((a,b)=>a+b,0),probabilities=inverse.map(value=>value/sum);
  const pick=probabilities.indexOf(Math.max(...probabilities)),odds=quote.odds[pick],probability=probabilities[pick],edge=probability*odds-1;
  const stake=20,score=scoreLeg({odds:quote.odds},{probability,edge});
  const leg:Leg={matchId:quote.matchId,leagueCode:quote.leagueCode,home:quote.home,away:quote.away,kickoffAt:quote.kickoffAt,pick,odds,provider:quote.provider,phase:'public-paper-assumed',priceCapturedAt:quote.capturedAt,probability,score,decisionVersion:'public-paper-fill-v1',status:'open',rationale:[`公开网页 ${quote.provider} 胜平负 ${quote.odds.map(value=>value.toFixed(2)).join(' / ')}；按展示价假设虚拟成交，来源 ${quote.sourceUrl}，抓取 ${new Date(quote.capturedAt).toISOString()}。`,'按去水市场概率选最大概率方向，未使用独立模型；估计优势仅为盘口水位，不能视为价值推荐。','真实账户可成交性未验证；此票仅属娱乐对照，不能进入严格精选或作为盈利证据。']};
  portfolio.tickets.push({id,day:day(now),createdAt:now,legs:[leg],odds,stake,status:'open',pnl:0,estimatedEdge:edge});
  return {lab,expected:current.updatedAt,created:true,id,pick,odds,probability,edge};
}
export async function appendPublicPaperTicket(quote:PublicPaperQuote){
  for(let attempt=0;attempt<3;attempt++){
    const prepared=preparePublicPaperTicket(await readLab(),quote);
    if(!prepared.created)return prepared;
    if(await saveLab(prepared.lab,prepared.expected))return prepared;
  }
  throw new Error('虚拟账本并发更新，请重试');
}
export async function updateLabConfig(input: {id:string;enabled:boolean;stake:number;maxTickets:number}) {
  if (!defaults().portfolios.some(p=>p.id===input.id) || typeof input.enabled!=="boolean" || !Number.isInteger(input.maxTickets) || input.maxTickets<1 || input.maxTickets>100) throw new Error("设置无效：统一均注 20 元、每天 1–100 单");
  if(HISTORY_ONLY_STRATEGIES.has(input.id)||REVIEW_PAUSED_STRATEGIES.has(input.id))throw new Error('此策略已暂停新增，只读历史票据；不能用设置开关恢复');
  for(let attempt=0;attempt<3;attempt++) {
    const lab=await readLab(), expected=lab.updatedAt, portfolio=lab.portfolios.find(p=>p.id===input.id)!;
    Object.assign(portfolio,{enabled:input.enabled,stake:20,maxTickets:input.maxTickets});
    if(portfolio.minTickets!=null)portfolio.minTickets=Math.min(portfolio.minTickets,input.maxTickets);
    if(await saveLab(lab,expected))return lab;
  }
  throw new Error("账本正在更新，请重试");
}

function form(value:string) {const chars=String(value||"").toUpperCase().split("");return chars.length?chars.reduce((sum,c)=>sum+(c==="W"?3:c==="D"?1:0),0)/chars.length:1.35;}
function candidate(match:Match,valueMode=false,maxMinutes=EXECUTION_WINDOW_MINUTES): {leg:Leg;edge:number;shift:number;value:boolean} | null {
  const minutes=(match.date-Date.now())/60000;
  if(match.status!=="soon"||match.oddsPhase!=="current"||minutes<10||minutes>maxMinutes||/(cancel|abandon|postpon|suspend)/i.test(match.detail)||match.odds.length!==3||match.odds.some(n=>!Number.isFinite(n)||n<=1))return null;
  const sum=match.odds.reduce((s,o)=>s+1/o,0), market=match.odds.map(o=>(1/o)/sum);
  const delta=clamp((form(match.homeForm)-form(match.awayForm))*.025,-.08,.08);
  let raw=[market[0]+delta,market[1],market[2]-delta].map(p=>Math.max(.025,p));
  // Ensemble: blend market-form with the Poisson goal model when the
  // latter exists. currentModelW (evolved per-round from calibration)
  // is the Poisson weight — leagues where Poisson calibrates better
  // automatically lean on it more.
  if(match.goalModel&&Number.isFinite(match.goalModel.expectedHome)){
    const g=dcScoreGrid(match.goalModel.expectedHome,match.goalModel.expectedAway,match.goalModel.rho);
    let pH=0,pD=0,pA=0;
    for(let i=0;i<g.length;i++)for(let j=0;j<g[i].length;j++){if(i>j)pH+=g[i][j];else if(i===j)pD+=g[i][j];else pA+=g[i][j];}
    const pois=[pH,pD,pA],w=currentModelW;
    raw=[0,1,2].map(k=>Math.max(.025,(1-w)*raw[k]+w*pois[k]));
  }
  const total=raw.reduce((a,b)=>a+b,0),probs=raw.map(p=>p/total);
  const derby=isDerby(match.home,match.away);const shift=Math.max(...probs.map((p,i)=>Math.abs(p-market[i]))),margin=(match.homeForm||match.awayForm?44:51)/100*.055+currentEvolutionShift+(derby?0.02:0);
  const edges=probs.map((p,i)=>Math.max(.02,p-margin)*match.odds[i]-1);
  const eligible=match.odds.map((odds,index)=>({odds,index})).filter(row=>row.odds>=1.2);
  if(!eligible.length)return null;
  const pick=valueMode?eligible.reduce((best,row)=>edges[row.index]>edges[best]?row.index:best,eligible[0].index):eligible.reduce((best,row)=>probs[row.index]>probs[best]?row.index:best,eligible[0].index),probability=Math.max(.02,probs[pick]-margin),edge=edges[pick];
  const evidence:Evidence={modelVersion:"market-form-v2-gated",calculatedAt:Date.now(),marketOdds:[...match.odds],marketProbabilities:[...market],adjustedProbabilities:[...probs],homeForm:match.homeForm||"",awayForm:match.awayForm||"",formDelta:delta,uncertaintyMargin:margin,goalModelWeight:match.goalModel?currentModelW:0,evolutionMarginShift:currentEvolutionShift};
  const rationale=[analysisText(match,{market:"1x2",pickName:["主胜","平局","客胜"][pick],odds:match.odds[pick],probability,margin,goalModel:match.goalModel}),`报价状态：${match.oddsReason||"本次抓取参考价，源头更新时间未知"}`,`市场去水概率：主 ${(market[0]*100).toFixed(1)}% / 平 ${(market[1]*100).toFixed(1)}% / 客 ${(market[2]*100).toFixed(1)}%`,`近期战绩修正：主 ${match.homeForm||"缺失"} / 客 ${match.awayForm||"缺失"}，主客差修正 ${(delta*100).toFixed(1)} 个百分点`,`扣除 ${(margin*100).toFixed(1)} 个百分点数据不确定性后，所选概率 ${(probability*100).toFixed(1)}%、估计优势 ${(edge*100).toFixed(1)}%`,`首发、伤停、休息和战意若无逐场可核验记录，不被猜测为利好`,...researchRationale(match)];
  return {leg:{decisionVersion:"profit-guard-v4",matchId:match.id,leagueCode:match.leagueCode,home:match.home,away:match.away,kickoffAt:match.date,pick,score:scoreLeg(match,{probability,edge:edges[pick],goalModel:match.goalModel}),newScore:scoreLegV2Audit(match,{probability,edge:edges[pick],goalModel:match.goalModel,odds:match.odds[pick],phase:match.oddsPhase}).score,odds:match.odds[pick],provider:match.providers[pick]||"公开参考价",phase:match.oddsPhase,probability,status:"open",evidence,goalEvidence:match.goalModel,homeLogo:match.homeLogo,awayLogo:match.awayLogo,leagueLogo:match.leagueLogo,deepAnalysis:match.research?.deepAnalysis,rationale},edge,shift,value:edge>.065&&shift>=.015};
}

function buildRadar(matches:Match[],previous?:Radar,successfullyScanned?:string[]):Radar{
  const now=Date.now(),horizon=7*86400000,rows=matches.filter(m=>m.status==="soon"&&m.date-now>=10*60000&&m.date-now<=horizon&&!/(cancel|abandon|postpon|suspend)/i.test(m.detail)).sort((a,b)=>a.date-b.date||a.leagueCode.localeCompare(b.leagueCode));
  const fresh:RadarEntry[]=rows.map(m=>{
    const minutes=(m.date-now)/60000,stage:RadarEntry["stage"]=minutes<=1440?"execution":minutes<=2880?"prescreen":"calendar";
    const priced=m.oddsPhase==='current'&&m.odds.length===3&&m.odds.every(n=>Number.isFinite(n)&&n>1),spreadQuotes=(m.spreadOffers||[]).length,totalQuotes=(m.totalOffers||[]).length;
    const evaluated=priced&&minutes<=2880?candidate(m,true,2880):null;
    const failures:string[]=[];
    if(evaluated){if(evaluated.edge<.08)failures.push(`优势 ${(evaluated.edge*100).toFixed(1)}% < 8.0%`);if(Number(evaluated.leg.score)<75)failures.push(`评分 ${Number(evaluated.leg.score)} < 75`);if(evaluated.leg.probability<.4)failures.push(`概率 ${(evaluated.leg.probability*100).toFixed(1)}% < 40%`);if(evaluated.leg.odds>3)failures.push(`赔率 ${evaluated.leg.odds.toFixed(2)} > 3.00`);}
    const qualifies=stage==="execution"&&!!evaluated&&failures.length===0;
    let reason="已进入未来 7 天赛程雷达；距开赛超过 48 小时，等待赛前信息和可核验价格。";
    if(stage!=="calendar"&&!priced)reason=`已进入${stage==="execution"?"24 小时执行":"48 小时预筛"}窗口；${m.oddsReason||"缺少完整可核验的 1X2 报价"}，不生成模拟单。`;
    else if(stage==="prescreen"&&evaluated)reason=`48 小时预筛已计算；${failures.length?`当前未过门槛：${failures.join("；")}。`:"当前达到模型门槛。"}进入 24 小时执行窗后按最新赔率、阵容和伤停重算。`;
    else if(stage==="execution"&&evaluated)reason=qualifies?"已进入 24 小时执行窗并达到严格门槛；由各策略的额度、去重和风险规则决定是否生成模拟单。":`已进入 24 小时执行窗，但未过严格门槛：${failures.join("；")}。`;
    return {matchId:m.id,leagueCode:m.leagueCode,home:m.home,away:m.away,kickoffAt:m.date,stage,priced,quotePhase:m.oddsPhase||'none',odds:[...m.odds],spreadQuotes,totalQuotes,reason,observedAt:now,edge:evaluated?.edge,probability:evaluated?.leg.probability,rawProbabilities:evaluated?.leg.evidence?.adjustedProbabilities,score:evaluated?.leg.score,newScore:evaluated?.leg.newScore,scoreBasis:evaluated?scoreLegAudit(m,{probability:evaluated.leg.probability,edge:evaluated.edge,goalModel:m.goalModel}).parts.join('；'):undefined,newScoreBasis:evaluated?scoreLegV2Audit(m,{probability:evaluated.leg.probability,edge:evaluated.edge,goalModel:m.goalModel,odds:evaluated.leg.odds,phase:m.oddsPhase}).parts.join('；'):undefined,pick:evaluated?.leg.pick,qualifies};
  });
  const scanned=new Set(successfullyScanned||[]),freshIds=new Set(fresh.map(entry=>`${entry.leagueCode}:${entry.matchId}`));
  const carried=successfullyScanned?(previous?.entries||[]).filter(entry=>{
    const observed=Number(entry.observedAt||previous?.capturedAt||0);
    return !scanned.has(entry.leagueCode)&&!freshIds.has(`${entry.leagueCode}:${entry.matchId}`)
      &&observed>=now-90*60000&&entry.kickoffAt>=now+10*60000&&entry.kickoffAt<=now+horizon;
  }).map(entry=>{
    const minutes=(entry.kickoffAt-now)/60000,stage:RadarEntry['stage']=minutes<=1440?'execution':minutes<=2880?'prescreen':'calendar';
    return {...entry,stage,stale:true,qualifies:false,reason:`该联赛本批未成功重查；上次抓取 ${new Date(entry.observedAt||previous!.capturedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}。原赔率只作历史参考，不据此生成新模拟单。`};
  }):[];
  const entries=[...fresh,...carried].sort((a,b)=>a.kickoffAt-b.kickoffAt||a.leagueCode.localeCompare(b.leagueCode));
  const aggregate=(key:(entry:RadarEntry)=>string)=>[...entries.reduce((map,entry)=>{const k=key(entry),v=map.get(k)||{matches:0,priced:0};v.matches++;if(entry.priced&&!entry.stale)v.priced++;map.set(k,v);return map;},new Map<string,{matches:number;priced:number}>())].map(([key,value])=>({key,...value}));
  return {capturedAt:now,horizonDays:7,total:entries.length,priced:fresh.filter(e=>e.priced).length,fresh:fresh.length,stale:carried.length,coveredLeagues:new Set(entries.map(e=>e.leagueCode)).size,executionWindow:entries.filter(e=>e.stage==="execution").length,prescreenWindow:entries.filter(e=>e.stage==="prescreen").length,byDay:aggregate(e=>day(e.kickoffAt)).map(({key,...value})=>({day:key,...value})),byLeague:aggregate(e=>e.leagueCode).map(({key,...value})=>({leagueCode:key,...value})).sort((a,b)=>b.matches-a.matches||a.leagueCode.localeCompare(b.leagueCode)),entries:entries.slice(0,240)};
}

// Compare every observed line, never synthesize a bookmaker quote.
function asianEvaluated(match:Match,market:"total"|"spread",maxMinutes=EXECUTION_WINDOW_MINUTES) {
  const g=match.goalModel,minutes=(match.date-Date.now())/60000;
  if(!g||match.status!=="soon"||minutes<10||minutes>maxMinutes||/(cancel|abandon|postpon|suspend)/i.test(match.detail))return [];
  const grid=dcScoreGrid(g.expectedHome,g.expectedAway,g.rho);
  const options:{side:"over"|"under"|"home"|"away";line:number;odds:number;provider:string;phase:string}[]=[];
  if(market==="total")for(const o of match.totalOffers||[]){
    if(validLine(o.line)&&o.line>0&&o.over>1&&o.under>1)for(const side of ["over","under"] as const)options.push({side,line:o.line,odds:o[side],provider:o.provider,phase:o.phase});
  }
  else for(const o of match.spreadOffers||[]){
    if(validLine(o.homeLine)&&o.homeLine===-o.awayLine&&o.home>1&&o.away>1)for(const side of ["home","away"] as const)options.push({side,line:side==="home"?o.homeLine:o.awayLine,odds:o[side],provider:o.provider,phase:o.phase});
  }
  const valid=options.filter(o=>o.phase==="current"&&o.odds>=1.2);
  const preferred=valid;
  return preferred.map(o=>{
    const stats=marketExpectation(grid,market,o.side,o.line,o.odds)!;
    // Worst-case transfer of uncertainty mass from a full win to a full loss.
    const expectedReturn=Math.max(0,stats.expectedReturn-g.uncertaintyMargin*o.odds);
    return {...o,stats,expectedReturn,edge:expectedReturn-1};
  }).sort((a,b)=>b.edge-a.edge||a.provider.localeCompare(b.provider)||a.line-b.line);
}
function spreadAudit(match:Match,maxMinutes=EXECUTION_WINDOW_MINUTES):SpreadAuditCandidate[]{
  return asianEvaluated(match,"spread",maxMinutes).map(row=>{
    const probability=row.stats.profitProbability,score=scoreLeg(match,{probability,edge:row.edge,goalModel:match.goalModel});
    const reasons:string[]=[];
    if(row.edge<.08)reasons.push(`保守优势 ${(row.edge*100).toFixed(1)}% < 8.0%`);
    if(score<75)reasons.push(`评分 ${score} < 75`);
    if(probability<.4)reasons.push(`获利概率 ${(probability*100).toFixed(1)}% < 40%`);
    if(row.odds>3)reasons.push(`赔率 ${row.odds.toFixed(2)} > 3.00`);
    return {side:row.side as "home"|"away",line:row.line,odds:row.odds,provider:row.provider,phase:row.phase,probability,edge:row.edge,score,qualifies:reasons.length===0,reasons};
  });
}
function asianCandidate(match:Match,market:"total"|"spread",maxMinutes=EXECUTION_WINDOW_MINUTES): {leg:Leg;edge:number;shift:number;value:boolean}|null {
  const g=match.goalModel;
  if(!g)return null;
  const evaluated=asianEvaluated(match,market,maxMinutes);
  const best=evaluated[0];if(!best)return null;
  const {side,line,odds,provider,phase,edge,expectedReturn,stats}=best,probability=stats.profitProbability;
  const leg:Leg={matchId:match.id,leagueCode:match.leagueCode,home:match.home,away:match.away,kickoffAt:match.date,pick:-1,market,side,line,odds,provider,phase,priceCapturedAt:Date.now(),probability,expectedReturn,decisionVersion:"profit-guard-v4",status:"open",goalEvidence:g,score:scoreLeg(match,{probability,edge,goalModel:g}),newScore:scoreLegV2Audit(match,{probability,edge,goalModel:g,phase}).score,homeLogo:match.homeLogo,awayLogo:match.awayLogo,leagueLogo:match.leagueLogo,deepAnalysis:match.research?.deepAnalysis,rationale:[
    `比较 ${evaluated.length} 个已报价方向；选择 ${market==="total"?(side==="over"?"大":"小"):(side==="home"?match.home:match.away)} ${line} @ ${odds.toFixed(2)}（${provider} / ${phase}）`,
    `进球模型主 ${g.expectedHome.toFixed(2)} / 客 ${g.expectedAway.toFixed(2)}；按完整比分分布计算赢半、输半与走盘，不用胜率×赔率替代。`,
    `获利概率 ${(probability*100).toFixed(1)}%，全走概率 ${(stats.pushProbability*100).toFixed(1)}%，亏损概率 ${(stats.lossProbability*100).toFixed(1)}%；这是未校准的模型估计。`,
    `每单位原始期望返还 ${stats.expectedReturn.toFixed(3)}，不确定性扣减 ${(g.uncertaintyMargin*odds).toFixed(3)}，保守优势 ${(edge*100).toFixed(1)}%。`,
    "仅当前/收盘同源双边参考价；没有报价的档位仅研究，不生成单据。新精选不补位。",...researchRationale(match)]};
  return {leg,edge,shift:0,value:edge>.04};
}
function totalsPoissonCandidate(match:Match,maxMinutes=EXECUTION_WINDOW_MINUTES){return asianCandidate(match,"total",maxMinutes);}
function spreadCandidate(match:Match,maxMinutes=EXECUTION_WINDOW_MINUTES){return asianCandidate(match,"spread",maxMinutes);}

// Audit detail for tickets that transitioned to a settled/review state in
// the current run. Read-only observability: nothing here rewrites ticket
// evidence — it only reports what settlePortfolio already did.
export type SettledTicketDetail={portfolioId:string;ticketId:string;day:string;status:string;stake:number;pnl:number;legs:number};

export function settlePortfolio(portfolio: Portfolio, matches: Match[], settledOut?:SettledTicketDetail[]) {
  const byId=new Map(matches.map(m=>[m.id,m]));let count=0;
  for(const ticket of portfolio.tickets) {
    for(const leg of ticket.legs){const match=byId.get(leg.matchId);if(match&&match.leagueCode===leg.leagueCode){leg.homeLogo=match.homeLogo||leg.homeLogo;leg.awayLogo=match.awayLogo||leg.awayLogo;leg.leagueLogo=match.leagueLogo||leg.leagueLogo;leg.logosCheckedAt=Date.now();}}
    if(settled(ticket)&&ticket.legs.every(leg=>leg.status!=="open"))continue;
    const wasSettled=settled(ticket);
    for(const leg of ticket.legs) {
      if(leg.status!=="open")continue;
      const match=byId.get(leg.matchId);
      // Cloud-legacy import tickets carry placeholder match ids (e.g.
      // "cloud-all-singles-...-Port FC") that can never be reconciled
      // against a real scoreboard. Once kickoff has long passed, flag
      // them for review instead of leaving them posing as actionable
      // open bets forever. No odds/stake/evidence fields are rewritten.
      if((!match||match.leagueCode!==leg.leagueCode)&&!/^\d{3,30}$/.test(leg.matchId)&&Number(leg.kickoffAt)<Date.now()-86400000){
        ticket.status="review";leg.finalScore="云端迁移票据缺少可核验的比赛标识，无法核验";continue;
      }
      if(!match||match.leagueCode!==leg.leagueCode)continue;
      if(match.status==="unverified")continue;
      // v3 settlement policy: a public full-time score settles immediately.
      // Independent agreement remains evidence quality, not a gate that leaves
      // a visibly finished match indefinitely open.
      if((match.status==="finished"||/(cancel|abandon)/i.test(match.detail))&&!match.independentFinalVerified){leg.settlementEvidence=match.settlementEvidence||{provider:"公开单源完场比分（待后续交叉核验）",sourceUrl:match.sourceUrl||"",capturedAt:Number.isSafeInteger(match.observedAt)&&Number(match.observedAt)>0?Number(match.observedAt):Date.now(),score:[match.hs,match.as]};}
      if(/(cancel|abandon)/i.test(match.detail)){leg.status="void";leg.finalScore="作废";continue;}
      if(match.status!=="finished"||/(postpon|suspend)/i.test(match.detail))continue;
      leg.settlementEvidence=leg.settlementEvidence||match.settlementEvidence||{provider:"公开完场比分",sourceUrl:match.sourceUrl||"",capturedAt:Number.isSafeInteger(match.observedAt)&&Number(match.observedAt)>0?Number(match.observedAt):Date.now(),score:[match.hs,match.as]};
      if(match.period>2||/(AET|after extra time|penalt|shootout)/i.test(match.detail)){leg.status="review";leg.finalScore=`${match.hs}—${match.as}（需核对常规时间）`;continue;}
      if(leg.market==="total"||leg.market==="spread"){
        const factor=leg.line==null?null:asianFactor(leg.market,String(leg.side),Number(leg.line),leg.odds,match.hs,match.as);
        if(factor===null){ticket.status="review";leg.finalScore="原始方向、盘口或比分缺失";continue;}
        leg.returnFactor=factor;leg.status=factor>1?"win":factor===1?"void":"loss";
      }else{
        const actual=match.hs>match.as?0:match.hs===match.as?1:2;leg.status=actual===leg.pick?"win":"loss";leg.returnFactor=leg.status==="win"?leg.odds:0;
      }
      leg.finalScore=`${match.hs}—${match.as}`;
      if(leg.status==="loss")leg.lossType="赛果未覆盖所选方向；原因须结合冻结证据及比赛过程核验，不能仅凭输赢归为运气";
    }
    if(ticket.legs.some(leg=>leg.status==="loss"&&(leg.returnFactor??0)===0)){ticket.status="loss";ticket.pnl=-ticket.stake;}
    else if(ticket.legs.some(leg=>leg.status==="review")){ticket.status="review";}
    else if(ticket.legs.every(leg=>["win","loss","void"].includes(leg.status))) {
      ticket.status=ticket.legs.every(leg=>leg.status==="void")?"void":"win";
      ticket.settledOdds=ticket.legs.reduce((product,leg)=>product*(leg.status==="void"?1:leg.returnFactor??leg.odds),1);
      ticket.pnl=round(ticket.stake*(ticket.settledOdds-1));
      ticket.status=ticket.pnl>0?"win":ticket.pnl<0?"loss":"void";
    }
    if(!wasSettled&&settled(ticket)){ticket.settledAt=Date.now();count++;settledOut?.push({portfolioId:portfolio.id,ticketId:ticket.id,day:ticket.day,status:ticket.status,stake:ticket.stake,pnl:ticket.pnl,legs:ticket.legs.length});}
  }
  return count;
}

// Keep the earliest single and retain every later duplicate as an explicit
// void record. No original stake, quote, pick, or ticket ID is rewritten.
export function voidDuplicateOpenSingles(lab:Lab):number {
  let voided=0;
  for(const portfolio of lab.portfolios){
    const seen=new Set<string>();
    const ordered=portfolio.tickets.filter(t=>t.status==="open"&&t.legs.length===1)
      .sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
    for(const ticket of ordered){
      const leg=ticket.legs[0];
      const key=JSON.stringify([leg.matchId,leg.market||"1x2",leg.pick,leg.side,leg.line]);
      if(!seen.has(key)){seen.add(key);continue;}
      ticket.status="void";ticket.pnl=0;ticket.settledAt=Date.now();ticket.settledOdds=1;
      leg.status="void";leg.returnFactor=1;
      leg.finalScore="策略内同场同方向重复单；原单保留，本单作废";
      leg.rationale=[...(leg.rationale||[]),"重复开放票纠正：保留最早一张，本单作废且盈亏为零。"];
      voided++;
    }
  }
  return voided;
}

export function processLab(lab:Lab,matches:Match[],pauseReason = "",settlementOnly = false,scanMeta?:ScanMeta) {
  const deduplicated=voidDuplicateOpenSingles(lab);
  lab.strategyPolicy=profitGuard(lab);
  currentEvolutionShift=lab.evolution?.marginShift||0;
  currentModelW=lab.evolution?.modelW??0.5;
  if(!settlementOnly)lab.radar=buildRadar(matches,lab.radar,scanMeta?.freshLeagueCodes);
  // Price-drift tracker: for every open leg, compare the captured price with
  // the current market price for the SAME direction. Positive drift = the
  // market moved our way (closing-line win in the making).
  const matchById=new Map(matches.map(m=>[String(m.id),m]));
  for(const pf of lab.portfolios)for(const t of pf.tickets){if(settled(t))continue;for(const l of t.legs){if(l.status!=="open")continue;const m=matchById.get(String(l.matchId));if(!m)continue;let cur=NaN;if(l.market==="total"){const o=(m.totalOffers||[]).filter(x=>x.provider===l.provider&&Number(x.line)===Number(l.line)&&["current","close"].includes(x.phase)).sort((a,b)=>b.phase.localeCompare(a.phase))[0];cur=o?Number(o[l.side==="over"?"over":"under"]):NaN;}else if(l.market==="spread"){const o=(m.spreadOffers||[]).find(x=>x.provider===l.provider&&Number(l.side==="home"?x.homeLine:x.awayLine)===Number(l.line)&&["current","close"].includes(x.phase));cur=o?Number(o[l.side==="home"?"home":"away"]):NaN;}else if(!l.market&&m.providers[Number(l.pick)]===l.provider){cur=Number(m.odds[Number(l.pick)]);}if(Number.isFinite(cur)&&cur>1){l.priceDrift=Math.round((cur/Number(l.odds)-1)*1000)/10;}}}
  const candidates=settlementOnly?[]:matches.map(m=>candidate(m)).filter((x):x is NonNullable<typeof x>=>!!x).sort((a,b)=>b.leg.probability-a.leg.probability||a.leg.kickoffAt-b.leg.kickoffAt||a.leg.matchId.localeCompare(b.leg.matchId));
  const reviewed=settlementOnly?[]:matches.map(m=>{const c=candidate(m,true);return c?{...c,homeLogo:m.homeLogo,awayLogo:m.awayLogo,leagueLogo:m.leagueLogo,totalOffers:m.totalOffers||[]}:null;}).filter((x):x is NonNullable<typeof x>=>!!x).sort((a,b)=>b.edge-a.edge);
  const values=reviewed.filter(x=>x.value);
  const researchReviewed=settlementOnly?[]:matches.map(m=>{const c=candidate(m,true,RESEARCH_WINDOW_MINUTES);return c?{...c,homeLogo:m.homeLogo,awayLogo:m.awayLogo,leagueLogo:m.leagueLogo,totalOffers:m.totalOffers||[]}:null;}).filter((x):x is NonNullable<typeof x>=>!!x).sort((a,b)=>b.edge-a.edge||a.leg.kickoffAt-b.leg.kickoffAt);
  const poissonReviewed=settlementOnly?[]:matches.map(m=>totalsPoissonCandidate(m)).filter((x):x is NonNullable<typeof x>=>!!x).sort((a,b)=>b.edge-a.edge||a.leg.kickoffAt-b.leg.kickoffAt||a.leg.matchId.localeCompare(b.leg.matchId));
  const spreadReviewed=settlementOnly?[]:matches.map(m=>spreadCandidate(m)).filter((x):x is NonNullable<typeof x>=>!!x).sort((a,b)=>b.edge-a.edge||a.leg.kickoffAt-b.leg.kickoffAt||a.leg.matchId.localeCompare(b.leg.matchId));
  const researchPoissonReviewed=settlementOnly?[]:matches.map(m=>totalsPoissonCandidate(m,RESEARCH_WINDOW_MINUTES)).filter((x):x is NonNullable<typeof x>=>!!x).sort((a,b)=>b.edge-a.edge||a.leg.kickoffAt-b.leg.kickoffAt||a.leg.matchId.localeCompare(b.leg.matchId));
  const researchSpreadReviewed=settlementOnly?[]:matches.map(m=>spreadCandidate(m,RESEARCH_WINDOW_MINUTES)).filter((x):x is NonNullable<typeof x>=>!!x).sort((a,b)=>b.edge-a.edge||a.leg.kickoffAt-b.leg.kickoffAt||a.leg.matchId.localeCompare(b.leg.matchId));
  const poissonTotals=poissonReviewed.filter(row=>row.value),spreads=spreadReviewed.filter(row=>row.value);
  const strictSingle=(row:Review)=>row.edge>=.08&&Number(row.leg.score)>=75&&row.leg.probability>=.4&&row.leg.odds<=3;
  const strictValues=reviewed.filter(strictSingle),strictSpreads=spreads.filter(strictSingle);
  const strictCombo=reviewed.filter(row=>row.edge>=.08&&Number(row.leg.score)>=75&&row.leg.probability>=.5&&row.leg.odds<=2.5);
  // Parlay legs must not be 1X2-only: when every 1X2 edge is negative
  // but value totals/spread candidates exist (today: +24% and +21%
  // totals), the double/treble portfolios should still be able to
  // combine them. Same 4% edge bar as before, any market type.
  const comboAny:Review[]=[...reviewed.filter(x=>x.edge>.04&&x.shift>=.015),...poissonTotals.filter(x=>x.edge>.04),...spreads.filter(x=>x.edge>.04)].sort((a,b)=>b.edge-a.edge);
  // Latest observations are separate from immutable historical ticket evidence.
  if(!settlementOnly){lab.decisionAudit=matches.filter(m=>m.status==="soon"&&((m.date-Date.now())/60000)<=RESEARCH_WINDOW_MINUTES).map(m=>{const spreadCandidates=spreadAudit(m,RESEARCH_WINDOW_MINUTES),quoted=(m.spreadOffers||[]).length,qualified=spreadCandidates.filter(row=>row.qualifies).length;return {matchId:m.id,capturedAt:Date.now(),spreadLines:(m.spreadOffers||[]).map(o=>o.homeLine),totalLines:(m.totalOffers||[]).map(o=>o.line),spreadCandidates,reason:`让球双边报价 ${quoted} 档${quoted===1?'（公开源当前只给主盘口一档，不代表系统只支持半球）':''}；已评估 ${spreadCandidates.length} 个方向，严格门槛通过 ${qualified} 个。大小球 ${(m.totalOffers||[]).length} 档；独立进球模型 ${m.goalModel?"可用":"缺失"}；未来 48 小时进入研究快照，开赛前 10 分钟至 24 小时才进入执行窗口；当前/收盘价须同源双边有效，开盘旧价不用于新亚洲盘单。`};});lab.reviews=researchReviewed.slice(0,100);lab.marketReviews=[...researchReviewed,...researchSpreadReviewed,...researchPoissonReviewed].sort((a,b)=>b.edge-a.edge||a.leg.kickoffAt-b.leg.kickoffAt);}
  let placed=0,settledCount=0;const settledTickets:SettledTicketDetail[]=[];
  for(const portfolio of lab.portfolios) {
    settledCount+=settlePortfolio(portfolio,matches,settledTickets);
    if(!strategyCanCreate(portfolio)||pauseReason||settlementOnly)continue;
    const todayTickets=portfolio.tickets.filter(t=>t.day===day());
    const todayPnl=portfolio.tickets.filter(t=>settled(t)&&day(t.settledAt||t.createdAt)===day()).reduce((s,t)=>s+t.pnl,0);
    const balance=round(portfolio.initialBalance+portfolio.tickets.filter(settled).reduce((s,t)=>s+t.pnl,0));
    const dayStart=balance-todayPnl;
    const coverageMode=portfolio.id==="all-singles",exposureCap=coverageMode?balance*.5:balance*.1;
    if(todayPnl<=-dayStart*.03&&!coverageMode)continue;
    let exposure=portfolio.tickets.filter(t=>!settled(t)).reduce((s,t)=>s+t.stake,0),daily=todayTickets.length;
    const used=new Set(portfolio.tickets.flatMap(t=>t.legs.map(l=>l.matchId)));
    if(portfolio.id==="featured-picks"){
      // Featured selection is limited to this bounded batch's fresh matches,
      // not a claim that all 65 leagues were ranked at one instant.
      // Choose the best market direction per fresh match,
      // ranked by conservative edge — edges may be negative and are
      // recorded honestly. This is the "self-recommended" list, separate
      // from forced-fun (which bets every match) and from the edge-gated
      // strategy portfolios.
      type Cand=NonNullable<ReturnType<typeof candidate>>;
      const all=([] as Cand[]).concat(reviewed as Cand[],poissonReviewed as Cand[],spreadReviewed as Cand[]);
      const bestPerMatch=new Map<string,Cand>();
      for(const c of all){if(used.has(c.leg.matchId))continue;const cur=bestPerMatch.get(c.leg.matchId);if(!cur||c.edge>cur.edge)bestPerMatch.set(c.leg.matchId,c);}
      // Featured = model's recommendation: a 9.00 longshot with +0.5% edge
      // is honest arithmetic but a terrible recommendation (huge variance,
      // probability ~11%). Prefer the highest-probability direction when
      // the best-edge one is a sub-20% longshot, and say why on the leg.
      const anyPositive=bestPerMatch.size>0&&[...bestPerMatch.values()].some(c=>c.edge>0);
      const sane=new Map<string,{c:Cand;why?:string}>();
      for(const [matchId,c] of bestPerMatch){
        const cands=all.filter(x=>x.leg.matchId===matchId);
        if(!anyPositive){const safest=cands.filter(x=>x.leg.probability>=.4).sort((a,b)=>b.leg.probability-a.leg.probability)[0];if(safest){sane.set(matchId,{c:safest,why:"全场无正优势方向：改选本场概率最高的方向，把方差压到最小（负期望下的防守选择）。"});continue;}}
        if(c.leg.probability<.2){
          const safer=cands.filter(x=>x.leg.probability>=.4&&x.leg.odds>=1.2).sort((a,b)=>b.leg.probability-a.leg.probability)[0];
          if(safer&&safer.leg.matchId===matchId){
            sane.set(matchId,{c:safer,why:`为什么不选优势最高的方向 @${c.leg.odds.toFixed(2)}：模型概率仅 ${(c.leg.probability*100).toFixed(0)}%——优势虽略正，低概率高赔率方差太大，不适合当推荐代表；改选模型概率 ${(safer.leg.probability*100).toFixed(0)}% 的方向。`});
            continue;
          }
        }
        sane.set(matchId,{c});
      }
      const allRanked=[...sane.values()].map(entry=>entry.c).sort((a,b)=>b.edge-a.edge);
      const ranked=allRanked.filter(strictSingle).slice(0,10);
      // 用户要求 J1 不能因为综合排名靠后而整天没有模拟单：只要
      // 存在可核验的赛前候选，就保留至少一场 J1；赔率/优势仍原样
      // 记录，不能把缺少价格的比赛硬凑成下注。
      const j1=allRanked.find(c=>strictSingle(c)&&c.leg.leagueCode==='jpn.1');
      if(j1&&!ranked.some(c=>c.leg.matchId===j1.leg.matchId)){if(ranked.length>=10)ranked[ranked.length-1]=j1;else ranked.push(j1);}
      const whyText=new Map<string,string|undefined>();for(const [mid,entry] of sane)whyText.set(mid,entry.why);
      for(const c of ranked){
        if(daily>=portfolio.maxTickets||exposure+portfolio.stake>exposureCap||portfolio.stake>balance-exposure)break;
        const leg={...c.leg},why=whyText.get(c.leg.matchId),now=Date.now();
        leg.rationale=[...(leg.rationale||[]),...(why?[why]:[]),...(scanMeta?.totalLeagues?[`本批只成功重查 ${scanMeta.scannedLeagues||0}/${scanMeta.totalLeagues} 联赛；此为本批精选，不代表全联赛同一时点前十。`]:[])];
        const stake=portfolio.stake;
        portfolio.tickets.push({id:`featured-picks:${c.leg.matchId}:${leg.market||"1x2"}`,day:day(now),createdAt:now,legs:[leg],odds:leg.odds,stake,status:"open",pnl:0,estimatedEdge:(leg.expectedReturn??leg.probability*leg.odds)-1});
        used.add(c.leg.matchId);exposure+=stake;daily++;placed++;
      }
      continue;
    }
    if(PROFIT_GUARD_PAUSED.includes(portfolio.id))continue;
    if(portfolio.id==="forced-fun"){
      // User-directed entertainment baseline (2026-09-17): one ticket per
      // match per market type (1X2 / totals / spread), always the
      // highest-edge direction for that market, no edge threshold. Edges
      // may be negative and that is recorded honestly on the ticket.
      type Cand=NonNullable<ReturnType<typeof candidate>>;
      for(const list of [reviewed as Cand[],poissonReviewed as Cand[],spreadReviewed as Cand[]]){
        const best=new Map<string,Cand>();
        for(const c of list){if(used.has(c.leg.matchId))continue;const cur=best.get(c.leg.matchId);if(!cur||c.edge>cur.edge)best.set(c.leg.matchId,c);}
        for(const [matchId,c] of best){
          if(daily>=portfolio.maxTickets||exposure+portfolio.stake>exposureCap||portfolio.stake>balance-exposure)break;
          const leg={...c.leg},now=Date.now();
          portfolio.tickets.push({id:`forced-fun:${matchId}:${leg.market||"1x2"}`,day:day(now),createdAt:now,legs:[leg],odds:leg.odds,stake:portfolio.stake,status:"open",pnl:0,estimatedEdge:(leg.expectedReturn??leg.probability*leg.odds)-1});
          used.add(matchId);exposure+=portfolio.stake;daily++;placed++;
        }
      }
      continue;
    }
    // 广覆盖单场是“全量记录”对照组：不使用价值门槛，保留所有
    // 有效 1X2 赔率的赛前候选；低评分/负优势只影响标签和复盘，不影响入组。
    const broadPool=reviewed.map(c=>({...c,leg:{...c.leg,rationale:[...(c.leg.rationale||[]),`广覆盖记录：本策略不筛除低评分或负优势；本单估计优势 ${(c.edge*100).toFixed(1)}%，仅用于全量模拟与复盘，不代表推荐。`]}}));
    const pool=(portfolio.id==="value-singles"?strictValues:portfolio.id==="all-singles"?broadPool:portfolio.id==="totals-baseline"?[]:portfolio.id==="totals-poisson"?[]:portfolio.id==="spread-singles"?strictSpreads:portfolio.id==="double"?strictCombo:comboAny).filter(c=>!used.has(c.leg.matchId)&&(portfolio.legs===1||c.leg.probability>=.5&&c.leg.odds>=1.2&&c.leg.odds<=3));
    if(portfolio.id==="mixed-double"){
      const eligibleTotals=poissonTotals.filter(c=>!used.has(c.leg.matchId)&&c.leg.odds>=1.2&&c.leg.odds<=3);
      for(const base of pool){
        const extra=eligibleTotals.find(c=>c.leg.matchId!==base.leg.matchId&&!used.has(c.leg.matchId));
        if(!extra||daily>=portfolio.maxTickets||exposure+portfolio.stake>exposureCap||portfolio.stake>balance-exposure)break;
        const legs=[{...base.leg},{...extra.leg}],odds=legs[0].odds*legs[1].odds,now=Date.now();
        if(correlated(base.leg,extra.leg)){legs[1].rationale=[...(legs[1].rationale||[]),"相关性折扣：两腿同联赛或同日开球，隐藏因子（天气/裁判/轮次疲劳）相关，组合优势按 0.85 折算。"];}
        portfolio.tickets.push({id:`${portfolio.id}:${base.leg.matchId}+${extra.leg.matchId}`,day:day(now),createdAt:now,legs,odds,stake:portfolio.stake,status:"open",pnl:0,estimatedEdge:legs.reduce((p,l)=>p*(l.expectedReturn??l.probability*l.odds),1)-1});
        used.add(base.leg.matchId);used.add(extra.leg.matchId);exposure+=portfolio.stake;daily++;placed++;
      }
    }else{
      for(let i=0;i+portfolio.legs<=pool.length;i+=portfolio.legs) {
        if(daily>=portfolio.maxTickets||exposure+portfolio.stake>exposureCap||portfolio.stake>balance-exposure)break;
        const picks=pool.slice(i,i+portfolio.legs),legs=picks.map(c=>({...c.leg})),odds=legs.reduce((p,l)=>p*l.odds,1);
        if(picks.some(c=>used.has(c.leg.matchId)))continue;
        if(picks.some((pick,index)=>picks.slice(index+1).some(other=>correlated(pick.leg,other.leg))))continue;
        const stake=portfolio.stake;
        const now=Date.now();portfolio.tickets.push({id:`${portfolio.id}:${legs.map(l=>l.matchId).sort().join("+")}`,day:day(now),createdAt:now,legs,odds,stake,status:"open",pnl:0,estimatedEdge:legs.reduce((p,l)=>p*(l.expectedReturn??l.probability*l.odds),1)-1});
        for(const c of picks)used.add(c.leg.matchId);
        exposure+=stake;daily++;placed++;
      }
    }
    // 保底补位（用户 2026-09-18 指定）：价值规则下完不足 minTickets
    // 时，按优势排序补齐，补位单注明"未过价值门槛"，优势如实可为负。
    if(["all-singles"].includes(portfolio.id)&&!settlementOnly&&!pauseReason&&portfolio.minTickets&&daily<portfolio.minTickets&&daily<portfolio.maxTickets){
      const fillNote=(c:{edge:number})=>`保底补位：本场未过价值门槛，按优势排序入选（估计优势 ${(c.edge*100).toFixed(1)}%，如实标注）`;
      const canFill=()=>!(daily>=(portfolio.minTickets??0)||daily>=portfolio.maxTickets||exposure+portfolio.stake>exposureCap||portfolio.stake>balance-exposure);
      const pushSingle=(c:NonNullable<ReturnType<typeof candidate>>)=>{
        const leg={...c.leg};leg.rationale=[...(leg.rationale||[]),fillNote(c)];
        const now=Date.now();
        portfolio.tickets.push({id:`${portfolio.id}:fill:${c.leg.matchId}:${leg.market||"1x2"}`,day:day(now),createdAt:now,legs:[leg],odds:leg.odds,stake:portfolio.stake,status:"open",pnl:0,estimatedEdge:(leg.expectedReturn??leg.probability*leg.odds)-1});
        used.add(c.leg.matchId);exposure+=portfolio.stake;daily++;placed++;
      };
      if(portfolio.legs===1){
        const source=portfolio.id==="totals-poisson"?poissonReviewed:portfolio.id==="spread-singles"?spreadReviewed:reviewed;
        for(const c of source){if(!canFill())break;if(used.has(c.leg.matchId))continue;pushSingle(c);}
      }else if(portfolio.id==="mixed-double"){
        // The totals side is structurally scarce (today: 2 candidates).
        // Reusing a totals leg across DIFFERENT mixed tickets is fine —
        // only the same match within one ticket is forbidden; the ticket
        // id guard below prevents exact duplicates.
        const firsts=reviewed.filter(c=>!used.has(c.leg.matchId)&&c.leg.odds>=1.2&&c.leg.odds<=3),seconds=poissonReviewed.filter(c=>c.leg.odds>=1.2&&c.leg.odds<=3);
        for(const a of firsts){
          if(!canFill())break;
          const b=seconds.find(c=>c.leg.matchId!==a.leg.matchId);if(!b)break;
          const ticketId=`${portfolio.id}:fill:${a.leg.matchId}+${b.leg.matchId}`;
          if(portfolio.tickets.some(t=>t.id===ticketId))continue;
          const legs=[{...a.leg},{...b.leg}].map((leg,idx)=>{leg.rationale=[...(leg.rationale||[]),fillNote(idx===0?a:b)];return leg}),odds=legs[0].odds*legs[1].odds,now=Date.now();
          portfolio.tickets.push({id:ticketId,day:day(now),createdAt:now,legs,odds,stake:portfolio.stake,status:"open",pnl:0,estimatedEdge:legs.reduce((p,l)=>p*(l.expectedReturn??l.probability*l.odds),1)-1});
          used.add(a.leg.matchId);exposure+=portfolio.stake;daily++;placed++;
        }
      }else{
        // Fill pool = all market candidates (any market, any edge — fills
        // are explicitly labelled as below-threshold), ranked by edge.
        const legPool=[...reviewed,...poissonReviewed,...spreadReviewed].sort((a,b)=>b.edge-a.edge).filter(c=>!used.has(c.leg.matchId)&&c.leg.probability>=.4&&c.leg.odds>=1.2&&c.leg.odds<=3);
        for(let i=0;i+portfolio.legs<=legPool.length;i+=portfolio.legs){
          if(!canFill())break;
          const picks=legPool.slice(i,i+portfolio.legs),legs=picks.map(c=>({...c.leg,rationale:[...(c.leg.rationale||[]),fillNote(c)]})),odds=legs.reduce((p,l)=>p*l.odds,1);
          const now=Date.now();
          portfolio.tickets.push({id:`${portfolio.id}:fill:${legs.map(l=>l.matchId).sort().join("+")}`,day:day(now),createdAt:now,legs,odds,stake:portfolio.stake,status:"open",pnl:0,estimatedEdge:legs.reduce((p,l)=>p*(l.expectedReturn??l.probability*l.odds),1)-1});
          for(const c of picks)used.add(c.leg.matchId);
          exposure+=portfolio.stake;daily++;placed++;
        }
      }
    }
  }
  lab.strategyPolicy=profitGuard(lab);
  const result={candidates:candidates.length,valueCandidates:values.length,placed,settled:settledCount,deduplicated,settledTickets,radarMatches:lab.radar?.total||0,pricedRadar:lab.radar?.priced||0,executionWindow:lab.radar?.executionWindow||0,prescreenWindow:lab.radar?.prescreenWindow||0,...(scanMeta||{}),...(pauseReason?{pauseReason}:{})};
  // Auto-evolve the model from the newest settlement data on every
  // non-settlement run; the shift feeds the margin on the next rounds.
  if(!settlementOnly){const cal=computeCalibration(lab);if(cal){/* v3 freezes automatic tuning pending chronological holdout validation. */}}
  // A focused old-ticket reconciliation must not masquerade as a fresh
  // full-league selection scan or replace the current research board.
  if(!settlementOnly){lab.lastScanAt=Date.now();lab.lastScan=result;}
  return result;
}
export function prepareSimulationLab(current:Lab,matches:Match[],pauseReason = "",settlementOnly = false,scanMeta?:ScanMeta){
  const lab=structuredClone(current),expected=current.updatedAt;
  const result=processLab(lab,matches,pauseReason,settlementOnly,scanMeta);
  return {lab,expected,result};
}
export async function runSimulationLab(matches:Match[],pauseReason = "",settlementOnly = false,scanMeta?:ScanMeta,leaseToken?:string) {
  for(let attempt=0;attempt<3;attempt++){const prepared=prepareSimulationLab(await readLab(),matches,pauseReason,settlementOnly,scanMeta);if(await saveLab(prepared.lab,prepared.expected,leaseToken))return prepared.result;}
  throw new Error("多策略账本并发更新，请稍后重试");
}
export async function pendingLabLegs() {
  const lab=await readLab();return lab.portfolios.flatMap(p=>p.tickets.flatMap(t=>t.legs.filter(l=>l.status==="open")));
}
export async function pendingFeaturedLegs() {
  return featuredOpenLegs(await readLab());
}
export function featuredOpenLegs(lab:Lab){
  const featured=lab.portfolios.find(p=>p.id==="featured-picks");
  return (featured?.tickets||[]).flatMap(ticket=>ticket.legs.filter(leg=>leg.status==="open"));
}
// Featured tickets are the user-facing shortlist.  Their report is saved with
// the ticket snapshot so the explanation remains readable even when the live
// match page later refreshes with new prices or team news.
export async function attachFeaturedAnalyses(rows:{matchId:string;leagueCode:string;analysis:DeepAnalysis}[],leaseToken?:string) {
  if(!rows.length)return 0;
  for(let attempt=0;attempt<3;attempt++){
    const lab=await readLab(),expected=lab.updatedAt;
    const changed=applyFeaturedAnalyses(lab,rows);
    if(!changed)return 0;
    if(await saveLab(lab,expected,leaseToken))return changed;
  }
  if(leaseToken)throw new Error('扫描租约已失效或精选分析并发更新');
  return 0;
}
export function applyFeaturedAnalyses(lab:Lab,rows:{matchId:string;leagueCode:string;analysis:DeepAnalysis}[]){
  if(!rows.length)return 0;
  const featured=lab.portfolios.find(p=>p.id==="featured-picks");
  if(!featured)return 0;
  const byKey=new Map(rows.map(row=>[`${row.leagueCode}:${row.matchId}`,row.analysis]));
  let changed=0;
  for(const ticket of featured.tickets)for(const leg of ticket.legs){
    if(leg.status!=="open")continue;
    const analysis=byKey.get(`${leg.leagueCode}:${leg.matchId}`);
    if(analysis&&(!leg.deepAnalysis||Number(analysis.capturedAt)>Number(leg.deepAnalysis.capturedAt))){leg.deepAnalysis=analysis;changed++;}
  }
  return changed;
}
export async function reconcilableLabLegs() {
  const lab=await readLab();
  return lab.portfolios.flatMap(p=>p.tickets.flatMap(t=>t.legs.filter(l=>l.status==="open"||((!l.homeLogo||!l.awayLogo)&&!l.logosCheckedAt))));
}
