import {dcScoreGrid} from "./goal-model";
import {marketExpectation} from "../public/market-math.js";
export type DeepDiveInput = {
  home:string;away:string;homeZh?:string;awayZh?:string;homeForm?:string;awayForm?:string;
  expectedHome?:number;expectedAway?:number;dqdSignals?:number[];homeRest?:number|null;awayRest?:number|null;
  lineupConfirmed?:boolean;injuryAvailable?:boolean;newsTop?:string[];odds?:number[];leagueCode?:string;
  lastFive?:{team:string;games?:{date?:string;opponent?:string;score?:string;result?:string;competition?:string}[]}[];
  injuries?:{team:string;list?:{player?:string;position?:string;status?:string;detail?:string}[]}[];
  teams?:{name:string;starters?:{name?:string;position?:string}[];formation?:string}[];
  standings?:({team:string;rank?:number;points?:number;gamesPlayed?:number}|null)[];
  goalEvidence?:{rho?:number;sourceUrls?:string[];home?:{hg?:number;hgf?:number;hga?:number};away?:{ag?:number;agf?:number;aga?:number}}|null;
  sourceUrl?:string;
};
export type DeepDiveSection={title:string;paras:string[]};
const f=(n:number)=>n.toFixed(2),pct=(n:number)=>(n*100).toFixed(1)+"%";
export function buildDeepDive(d:DeepDiveInput):{sections:DeepDiveSection[];summary:string}{
  const H=d.homeZh||d.home,A=d.awayZh||d.away,eh=Number(d.expectedHome),ea=Number(d.expectedAway);
  const has=Number.isFinite(eh)&&Number.isFinite(ea)&&eh>0&&ea>0;
  const sections:DeepDiveSection[]=[];
  const summary=has?`${H}对${A}：模型预期进球 ${f(eh)}:${f(ea)}；这不是预测最终比分。阵容${d.lineupConfirmed?"已有首发名单":"尚未确认"}，价格未齐时只研究，不给出可执行推荐。`:`${H}对${A}：缺少独立进球模型，暂不排名比分或推导深盘。`;
  sections.push({title:"结论与证据状态",paras:[summary,"胜负方向、赢盘和价格价值是三件事。赢球不保证赢深盘，猜中比分也不能反向证明赛前决策有优势。"]});
  for(const [index,name] of [d.home,d.away].entries()){
    const form=d.lastFive?.find(r=>r.team===name),inj=d.injuries?.find(r=>r.team===name),team=d.teams?.find(r=>r.name===name),rank=d.standings?.find(r=>r?.team===name);
    const rest=index===0?d.homeRest:d.awayRest,homeStats=d.goalEvidence?.home,awayStats=d.goalEvidence?.away,stats=index===0?homeStats:awayStats;
    const paras:string[]=[];
    paras.push(rank?`排名 ${rank.rank??"缺失"}，积分 ${rank.points??"缺失"}，场次 ${rank.gamesPlayed??"缺失"}；需结合对手强弱，不能仅用排名当胜率。`:"本场排名数据缺失，不猜测保级、争冠或轮换动机。");
    paras.push(...(form?.games?.length?form.games.map(g=>`${g.date} · 对手 ${g.opponent} · ${g.score} · 结果 ${g.result} · ${g.competition||"赛事未标注"}`):["近期逐场赛果缺失。"]));
    if(stats){const n=index===0?homeStats!.hg:awayStats!.ag,gf=index===0?homeStats!.hgf:awayStats!.agf,ga=index===0?homeStats!.hga:awayStats!.aga;
      paras.push(Number.isFinite(n)&&Number(n)>0&&Number.isFinite(gf)&&Number.isFinite(ga)?`${index===0?"主场":"客场"}样本 ${n} 场，场均进球 ${f(Number(gf)/Number(n))} / 失球 ${f(Number(ga)/Number(n))}。样本来自模型记录赛季，不能当作最近五场。`:"主客场分拆样本不足，不能用总战绩替代主客场结论。");}
    paras.push(rest!=null&&Number.isFinite(rest)?`可见赛程间隔 ${rest} 天；未覆盖全部杯赛及旅途，不据此断言疲劳程度。`:"休息天数未知。");
    paras.push(team?.starters?.length?`${d.lineupConfirmed?"首发":"候选名单（未确认）"}：${team.starters.map(p=>p.name+" "+p.position).join("、")}。阵型：${team.formation||"未提供"}。`:"没有可核验首发名单。");
    if(inj?.list?.length)paras.push(...inj.list.map(p=>`${p.player}（${p.position||"位置未标明"}）：${p.status}；${p.detail||"未提供原因"}。状态原文不等于确认缺阵；缺少替补能力数据，不量化个人进球损失。`));
    else paras.push("伤停名单缺失，不等于全员健康。新闻命中数只代表待核实事项，不是伤停概率。");
    sections.push({title:`${index===0?"主队":"客队"} · ${index===0?H:A}`,paras});
  }
  sections.push({title:"战术对位 · 事实与待验证假设",paras:[
    "目前没有逐场压迫、射门位置、控球推进及定位球质量数据，不能仅凭预期进球差把强队写成高位围攻、弱队写成五后卫。",
    `若确认 ${H}后场出球点受限，需要检查${A}实际压迫与抢断位置；若相反，交换双方观察。只有首发阵型不能证明防守高度。`,
    "首球早晚可能改变双方风险偏好，但落后不必然压出。须观察阵型、换人与射门质量；静态赛前模型不会自动变成滚盘模型。"]});
  if(has){
    const grid=dcScoreGrid(eh,ea,d.goalEvidence?.rho),scores=grid.flatMap((row,h)=>row.map((p,a)=>({h,a,p}))).sort((a,b)=>b.p-a.p).slice(0,3);
    sections.push({title:"三个高权重比分 · 模型情景而非剧本",paras:scores.map((s,i)=>`${i+1}. ${H} ${s.h}:${s.a} ${A}，模型概率 ${pct(s.p)}。${s.h===s.a?"平局情景：双方进球恰好相等，不代表场面均衡。":Math.abs(s.h-s.a)===1?"一球分差：半球与一球/球半的结算差异很大。":"多球分差：深盘仍需逐档看净胜球与价格。"}没有证据预言进球球员或分钟。`).concat([`前三比分合计 ${pct(scores.reduce((n,s)=>n+s.p,0))}；其余结果仍占多数或显著比例，不可视为三选一保证。`])});
    const fav=eh>=ea?"home":"away",favName=fav==="home"?H:A;
    const lines=[0,-.25,-.5,-.75,-1,-1.25,-1.5,-2,-2.5];
    const paras=lines.map(line=>{const s=marketExpectation(grid,"spread",fav,line,2)!;
      // expected return = 1 + winning stake * (odds-1) - losing stake.
      const t=marketExpectation(grid,"spread",fav,line,3)!;
      const w=t.expectedReturn-s.expectedReturn,l=1+w-s.expectedReturn;
      return `${favName} ${line>0?"+":""}${line}：获利 ${pct(s.profitProbability)} / 全走 ${pct(s.pushProbability)} / 亏损 ${pct(s.lossProbability)}；模型公平价 ${w>0?f(1+l/w):"不可算"}，不含水位与不确定性，不是现有报价。`;});
    let btts=0,home=0,draw=0,away=0;
    grid.forEach((row,h)=>row.forEach((p,a)=>{if(h&&a)btts+=p;if(h>a)home+=p;else if(h===a)draw+=p;else away+=p;}));
    paras.push(`双方进球：是 ${pct(btts)} / 否 ${pct(1-btts)}；双重机会：主不败 ${pct(home+draw)} / 客不败 ${pct(away+draw)} / 分胜负 ${pct(home+away)}。缺少对应双边报价，只做研究，不生成模拟单。`);
    for(const line of [1.5,2,2.25,2.5,2.75,3,3.5]){const s=marketExpectation(grid,"total","over",line,2)!;paras.push(`大 ${line}：获利 ${pct(s.profitProbability)} / 全走 ${pct(s.pushProbability)} / 亏损 ${pct(s.lossProbability)}（四分之一盘包含半输半赢）。`);}
    sections.push({title:"多玩法比较 · 深盘、大小球、双方进球、双重机会",paras});
    sections.push({title:"敏感性与推翻条件",paras:[`若主队预期进球上下变化 0.25，则从 ${f(Math.max(.05,eh-.25))} 到 ${f(eh+.25)}；客队同理 ${f(Math.max(.05,ea-.25))} 到 ${f(ea+.25)}。这是压力测试区间，不是已确认的伤停影响。`,"赛前核对：命名伤停是否真的缺阵、替补位置与角色、首发是否确认、报价时间和盘口是否变化。任一关键证据失效，重新计算，而不是凭原叙事加仓。","赛中红牌、点球、伤退可能使静态模型失效；没有事件数据与实时模型时停止沿用赛前概率，不宣称自动重估。"]});
  }
  sections.push({title:"来源与缺口",paras:[`本场摘要：${d.sourceUrl||"来源未提供"}`,...(d.goalEvidence?.sourceUrls||[]).map((s:string)=>"进球数据："+s),...(d.newsTop?.filter(Boolean)||[]).map(s=>"新闻线索（不是事实核验）："+s),"报告使用本次抓取快照；历史回测不能使用赛后更新数据。缺少事件级数据时，复盘只定位结算边界、价格与模型偏差，不捏造丢球原因。"]});
  return {sections,summary};
}
