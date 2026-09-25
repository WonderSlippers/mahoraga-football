import {teamZh, matchTeamZh, teamOriginal, leagueZh, leagueFlagAsset, countryFlag} from './names-zh.js?rev=league-svg-v3';
import {crest, selection} from './research-ui.js?rev=evidence-v4';
import {closed, numeric, tone, dayAt, recentDays, summarize, dailyStats, ticketBand, ticketMarket, parseScore, hypotheticalPnl} from './ledger-metrics.js?rev=evidence-v3';
import {exportReviewCsv} from './review-export.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>'¥'+Number(v||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const signed=v=>(v>0?'+':'')+money(v);
const percent=v=>numeric(v)?Number(v).toFixed(1)+'%':'—';
const at=v=>dayAt(v)?new Date(Number(v)).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'时间未记录';
const markets={'1x2':'胜平负',total:'大小球',spread:'让球',mixed:'混合玩法串关',unknown:'玩法未记录'};
const status={win:'赢',loss:'输',void:'作废',open:'待结算',review:'待核验'};
const historicalReviewEvidence={
 'cloud-import:all-singles:8338537c':'已找到 2026-09-15 英联杯彼得堡联 3–3 巴恩斯利，点球 7–6；ESPN 赛事 401914284。原票是主胜 1X2，点球胜出不能当作常规时间主胜。',
 'cloud-import:totals-baseline:ae1929ae':'同场常规时间 3–3；原票为全场大 2.5 球。赛事身份已核对，但原始 review 状态暂不直接改写。',
};
const historicalReviewSource='https://www.barnsleyfc.co.uk/news/2026/september/15/reds-knocked-out-of-carabao-cup-on-penalties/';
let current=null,host=null,activeView='overview',selectedPortfolio='all',ticketQuery='',ticketStatus='all',reviewPage=1,loading=false,lastRead=0,readError='';
const views={overview:'总览与趋势',results:'查找票据',analysis:'复盘分析',model:'模型与联赛'};
const rows=()=> (current?.portfolios||[]).filter(p=>selectedPortfolio==='all'||p.id===selectedPortfolio).flatMap(p=>p.tickets.map(t=>({p,t})));
const settledRows=()=>rows().filter(r=>closed(r.t)).sort((a,b)=>Number(b.t.settledAt||0)-Number(a.t.settledAt||0));
const empty=text=>'<p class="rv-empty">'+esc(text)+'</p>';
const box=(title,body,note='')=>'<section class="rv-box"><h3>'+title+'</h3>'+(note?'<p class="rv-note">'+note+'</p>':'')+body+'</section>';
const table=(heads,body)=>'<div class="lab-scroll" tabindex="0" aria-label="可横向滚动的数据表"><table class="rv-table"><thead><tr>'+heads.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></div>';
const statHeads=['已结单','赢 / 输 / 作废','净盈亏','投入收益率','命中率'];
function resultCells(s){return '<td>'+s.count+'</td><td>'+s.wins+' / '+s.losses+' / '+s.voids+'</td><td class="'+tone(s.pnl)+'">'+signed(s.pnl)+'</td><td>'+percent(s.roi)+'</td><td>'+percent(s.hitRate)+'</td>';}
function teamLine(l){const national=/^(?:fifa\.|uefa\.nations|uefa\.euroq|concacaf\.nations|afc\.cupq|caf\.nations_qual)/.test(String(l.leagueCode||'')),icon=(side,logo)=>national?'<span class="country-flag" role="img" aria-label="'+esc(matchTeamZh(l[side],l.leagueCode))+'国旗">'+(countryFlag(l[side])||'🏳️')+'</span>':crest(logo,matchTeamZh(l[side],l.leagueCode));return '<span class="rv-team">'+icon('home',l.homeLogo)+esc(matchTeamZh(l.home,l.leagueCode))+'<em>对</em>'+icon('away',l.awayLogo)+esc(matchTeamZh(l.away,l.leagueCode))+'</span>';}
function overview(){
 const tickets=rows().map(r=>r.t),today=dailyStats(tickets,dayAt(Date.now())),all=summarize(tickets);
 const resolved=tickets.filter(t=>closed(t)&&t.status!=='void'&&Number(t.stake)>0),equalRoi=resolved.length?resolved.reduce((sum,t)=>sum+Number(t.pnl||0)/Number(t.stake),0)/resolved.length*100:null;
 const distinctMatches=new Set(tickets.filter(closed).flatMap(t=>(t.legs||[]).map(l=>`${l.leagueCode||''}:${l.matchId||''}`))).size;
 const kv=(label,value,detail,cls='')=>'<article class="rv-kv"><small>'+label+'</small><strong class="'+cls+'">'+value+'</strong><span>'+detail+'</span></article>';
 return '<div class="rv-strip">'+kv('本账单日已实现盈亏',signed(today.pnl),'08:00 起已结算 '+today.count+' 单 · 含作废 '+today.voids+' 单',tone(today.pnl))+kv('累计已实现盈亏',signed(all.pnl),'历史投入加权收益率 '+percent(all.roi)+'；跨策略重复比赛',tone(all.pnl))+kv('每票等权收益率',percent(equalRoi),'仅描述历史判断，不是实际资金收益')+kv('已结票覆盖比赛',distinctMatches,'票据 '+all.count+' 张；同一场可跨策略重复')+kv('本账单日新模拟单',today.placedCount,'虚拟投入 '+money(today.placedStake))+kv('等待结算',tickets.filter(t=>!closed(t)).length,'其中 '+tickets.filter(t=>t.status==='review').length+' 单待核验')+'</div>';
}
function trend(){
 const tickets=rows().map(r=>r.t),days=recentDays().map(date=>({date,...dailyStats(tickets,date)})),max=Math.max(1,...days.map(d=>Math.abs(d.pnl)));
 const bars=days.map(d=>'<div class="rv-trend-day"><strong class="'+tone(d.pnl)+'">'+signed(d.pnl)+'</strong><div class="rv-trend-track"><i class="'+tone(d.pnl)+'" style="--bar-height:'+Math.max(1,Math.abs(d.pnl)/max*47)+'%"></i></div><span>'+d.date.slice(5)+'</span><small>'+d.count+' 单结算</small></div>').join('');
 const missing=tickets.filter(t=>closed(t)&&!dayAt(t.settledAt)).length;
 return box('每日盈亏','<div class="rv-trend" aria-label="近七个早八点账单日盈亏，绿色盈利红色亏损">'+bars+'</div><p class="rv-note">北京时间每天 08:00 切账；当天 08:00 至次日 07:59:59 属于同一账单日。零轴上方为盈利，下方为亏损。'+(missing?missing+' 单缺少结算时间，只计累计，不归入任意账单日。':'')+'</p>');
}
function dailyTable(){
 const tickets=rows().map(r=>r.t);
 return box('每日对账',table(['账单日（08:00）',...statHeads],recentDays(14).reverse().map(d=>'<tr><td>'+d+' 08:00</td>'+resultCells(dailyStats(tickets,d))+'</tr>').join('')),'作废单不计入命中率及收益率分母。凌晨 00:00–07:59 的下单和结算归入前一个账单日。');
}
function groupsPanel(){
 const done=settledRows(),groups=Object.entries(markets).map(([key,label])=>({label,tickets:done.filter(r=>ticketMarket(r.t)===key).map(r=>r.t)})).filter(g=>g.tickets.length);
 return box('玩法表现',groups.length?table(['玩法',...statHeads],groups.map(g=>'<tr><td>'+g.label+'</td>'+resultCells(summarize(g.tickets))+'</tr>').join('')):empty('暂无结算数据'),'整张串关只统计一次。含多个玩法的串关单列，不把全单盈亏归给第一条腿。');
}
function reviewQueue(){
 const pending=rows().filter(({t})=>t.status==='review');
 return pending.length?box('待核验票据 · '+pending.length+' 单','<p class="rv-note">这些原始票据仍为 review，不计入已实现盈亏；核实到赛果也不会直接改写冻结票据，需单独记录更正依据。</p><ul class="rv-notes">'+pending.slice(0,10).map(({p,t})=>'<li><strong>'+esc(p.name)+'</strong> · '+esc(t.id)+' · '+(t.legs||[]).map(l=>esc(matchTeamZh(l.home,l.leagueCode))+' 对 '+esc(matchTeamZh(l.away,l.leagueCode))).join('、')+(historicalReviewEvidence[t.id]?'<br>'+esc(historicalReviewEvidence[t.id])+' <a href="'+historicalReviewSource+'" target="_blank" rel="noopener noreferrer">俱乐部官方赛报</a>':'')+'</li>').join('')+'</ul><button type="button" data-show-review>查看待核验票据</button>'):'';
}
function results(){
 const query=ticketQuery.trim().toLocaleLowerCase('zh-CN');
 const filtered=rows().filter(({p,t})=>{
  if(ticketStatus!=='all'&&t.status!==ticketStatus)return false;
  if(!query)return true;
  const words=[t.id,p.name,dayAt(t.createdAt),dayAt(t.settledAt),at(t.createdAt),at(t.settledAt),...(t.legs||[]).flatMap(l=>[l.home,l.away,matchTeamZh(l.home,l.leagueCode),matchTeamZh(l.away,l.leagueCode)])];
  return words.some(word=>String(word||'').toLocaleLowerCase('zh-CN').includes(query));
 }).sort((a,b)=>Number(b.t.settledAt||b.t.createdAt||0)-Number(a.t.settledAt||a.t.createdAt||0));
 const pageCount=Math.max(1,Math.ceil(filtered.length/20));reviewPage=Math.min(reviewPage,pageCount);
 const visible=filtered.slice((reviewPage-1)*20,reviewPage*20);
 const cards=visible.map(({p,t})=>'<article class="rv-result"><header><div><b>'+esc(p.name)+'</b><small>'+at(closed(t)?t.settledAt:t.createdAt)+' · '+(t.legs.length>1?t.legs.length+' 串 1':'单场')+' · '+status[t.status]+'</small></div><strong class="'+(closed(t)?tone(t.status==='void'?0:t.pnl):'neutral')+'">'+(closed(t)?signed(t.status==='void'?0:t.pnl):status[t.status])+'</strong></header>'+(t.legs||[]).map(l=>'<div class="rv-result-leg"><div>'+teamLine(l)+'<small>'+esc(teamOriginal(l.home))+' · '+esc(teamOriginal(l.away))+'</small><span>'+esc(selection(l))+' @ '+Number(l.odds).toFixed(2)+'</span></div><div><b class="rv-score">'+esc(l.finalScore||'—')+'</b><small>'+ (status[l.status]||'待核验')+'</small></div></div>').join('')+'<footer>全单投入 '+money(t.stake)+' · '+(closed(t)?'全单盈亏只计一次':'尚未核实结算，不计盈亏')+' <small>票据 '+esc(t.id)+'</small></footer></article>');
 const filters='<form id="reviewTicketSearch" class="rv-ticket-search" role="search"><label>球队、日期或票据 ID <input name="query" type="search" value="'+esc(ticketQuery)+'"></label><label>状态 <select name="status">'+Object.entries({all:'全部',review:'待核验',open:'待结算',win:'赢',loss:'输',void:'作废'}).map(([key,label])=>'<option value="'+key+'" '+(ticketStatus===key?'selected':'')+'>'+label+'</option>').join('')+'</select></label><button type="submit">查找</button></form>';
 const pager='<div class="lab-page-controls"><button type="button" data-review-page="-1" '+(reviewPage<=1?'disabled':'')+'>上一页</button><span>第 '+reviewPage+' / '+pageCount+' 页 · 共 '+filtered.length+' 单</span><button type="button" data-review-page="1" '+(reviewPage>=pageCount?'disabled':'')+'>下一页</button></div>';
 return box('模拟票据 · '+filtered.length+' 单',filters+'<div class="rv-export"><button type="button" data-export-review>导出十策略全量票据 CSV</button><small>包含所有策略、所有状态与每条串关腿；不受当前筛选影响。旧版单场账本另行导出。</small></div>'+(cards.length?'<div class="rv-results">'+cards.join('')+'</div>'+pager:empty('没有符合条件的票据；可调整球队、日期或状态。')));
}
function yesterday(){
 const date=recentDays(2)[0],cohort=rows().filter(r=>dayAt(r.t.createdAt)===date),stats=summarize(cohort.map(r=>r.t));
 return box('上一账单日新单复盘 · '+date+' 08:00',table(['范围',...statHeads],'<tr><td>'+cohort.length+' 张新单</td>'+resultCells(stats)+'</tr>')+'<p class="rv-note">还有 '+cohort.filter(r=>!closed(r.t)).length+' 张待结算。每张票据只计一次，串关的多场比赛不重复计数。</p>','本区按上一账单日 08:00 至次日 07:59:59 创建的批次观察，包括后来才结算的结果。');
}
function selectionAudit(){
 const done=settledRows();
 const buckets=[
  ['v4 盈利保护新单（前瞻观察）',r=>r.t.legs?.every(l=>l.decisionVersion==='profit-guard-v4')&&!['forced-fun','all-singles'].includes(r.p.id)],
  ['v3 严格筛选历史单',r=>r.t.legs?.every(l=>l.decisionVersion==='evidence-v3')&&!['forced-fun','all-singles'].includes(r.p.id)],
  ['历史补位（含未过门槛）',r=>String(r.t.id).includes(':fill:')||r.t.legs?.some(l=>(l.rationale||[]).some(x=>x.includes('保底补位')))],
  ['负估计优势（可能与补位重叠）',r=>numeric(r.t.estimatedEdge)&&r.t.estimatedEdge<0],
  ['非负估计优势（不代表已验证）',r=>numeric(r.t.estimatedEdge)&&r.t.estimatedEdge>=0]
 ];
 return box('筛选规则审计',table(['证据分组',...statHeads],buckets.map(([label,fn])=>'<tr><td>'+label+'</td>'+resultCells(summarize(done.filter(fn).map(r=>r.t)))+'</tr>').join('')),'按整单实际投入比较，不拿不同本金的绝对盈利直接排名。各组可能重叠；历史精选含配额单，不等于严格筛选效果。v4 只影响新单，不修改旧账。');
}
function lossDrivers(){
 const done=settledRows(),band=t=>Number(t.odds)<1.6?'<1.60':Number(t.odds)<2?'1.60–1.99':Number(t.odds)<3?'2.00–2.99':Number(t.odds)<5?'3.00–4.99':'≥5.00';
 const selectionType=r=>String(r.t.id).includes(':fill:')?'历史补位':r.p.id==='all-singles'?'广覆盖对照':r.p.id==='forced-fun'?'娱乐强制对照':r.t.legs?.every(l=>l.decisionVersion==='profit-guard-v4'||l.decisionVersion==='evidence-v3')?'新规筛选':'历史规则不明';
 const dimensions=[['策略',r=>r.p.name],['玩法',r=>markets[ticketMarket(r.t)]||'未知玩法'],['赔率段',r=>band(r.t)],['筛选类型',selectionType]];
 const losses=[];
 for(const [dimension,keyOf] of dimensions){const groups=new Map();for(const row of done){const key=keyOf(row);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row.t);}for(const [key,tickets] of groups){const s=summarize(tickets);if(s.pnl<0)losses.push({dimension,key,s});}}
 losses.sort((a,b)=>a.s.pnl-b.s.pnl||b.s.count-a.s.count);
 const body=losses.slice(0,10).map(row=>'<tr><td>'+esc(row.dimension)+'</td><td>'+esc(row.key)+'</td>'+resultCells(row.s)+'</tr>').join('');
 const policy=current.strategyPolicy,policyHtml=policy?'<div class="rv-guard"><header><div><small>当前执行版本</small><strong>'+esc(policy.version)+'</strong></div><span>生效 '+esc(policy.effectiveAt)+'</span></header><ul>'+policy.rules.map(rule=>'<li>'+esc(rule)+'</li>').join('')+'</ul><p>依据：'+policy.basis.map(esc).join('；')+'。</p></div>':'';
 return box('亏损集中区与 v4 改进',body?table(['维度','亏损板块',...statHeads],body):empty('当前筛选范围没有已实现亏损板块'),policyHtml+'<p class="rv-note">同一张票会同时出现在“策略、玩法、赔率段、筛选类型”中，因此各行不可相加。暂停的是新增模拟单，历史票据继续结算。样本不足时只做风险收缩，不把短期盈利当作已验证优势。</p>');
}
function lossAnalysis(){
 const legs=settledRows().flatMap(({p,t})=>(t.legs||[]).filter(l=>l.status==='loss'&&parseScore(l.finalScore)).map(l=>({p,t,l})));
 const items=legs.slice(0,20).map(({p,t,l})=>{
  const [home,away]=parseScore(l.finalScore),why=[],g=l.goalEvidence;
  if(g&&numeric(g.expectedHome)&&numeric(g.expectedAway)){
   const total=Number(g.expectedHome)+Number(g.expectedAway),margin=Number(g.expectedHome)-Number(g.expectedAway);
   why.push(l.market==='total'?'赛前预期总进球 '+total.toFixed(2)+'，实际 '+(home+away)+'。总进球偏差 '+((home+away)-total).toFixed(2)+' 球。':'赛前预期 '+Number(g.expectedHome).toFixed(2)+':'+Number(g.expectedAway).toFixed(2)+'，实际 '+home+':'+away+'，主队净胜球偏差 '+(home-away-margin).toFixed(2)+' 球。');
  }
  if(l.market==='total')why.push('本单选择'+(l.side==='over'?'大':'小')+' '+l.line+' 球；实际总进球 '+(home+away)+'。');
  else if(l.market==='spread')why.push('让球后选中球队的净胜球为 '+((l.side==='home'?home-away:away-home)+Number(l.line))+'，未达到赢盘条件。');
  else why.push('选择'+['主胜','平局','客胜'][Number(l.pick)]+'，实际为'+(home>away?'主胜':home===away?'平局':'客胜')+'。');
  if(numeric(t.estimatedEdge))why.push('下单时全单估计优势 '+percent(t.estimatedEdge*100)+(t.estimatedEdge<0?'：本来就是负期望实验，不能归咎于赛果意外。':'：正估计优势只是模型判断，单次失败不能证伪，单次盈利也不能验证。'));
  if(String(t.id).includes(':fill:')||(l.rationale||[]).some(x=>x.includes('补位')))why.push('筛选失效点：本单属于历史配额补位，未必通过原策略门槛；v3 不再在精选里补位。');
  if(numeric(l.returnFactor))why.push('本腿实际每单位返还 '+Number(l.returnFactor).toFixed(3)+'；低于 1 是亏损，0.5 是输半，不应按全输计。');
  if(numeric(l.priceDrift))why.push('后续赔率相对原价变化 '+percent(l.priceDrift)+'；同源同盘时下降意味着原价更高，上升则相反。该记录不保证是真正收盘价，不能据此判定败因。');
  why.push('过程证据缺口：当前没有完整射门质量、红牌时间和换人事件链，不能确认是终结效率、战术或伤退导致。下一步须核对事件及阵容，而不是补写故事。');
  if(l.lossType)why.push('原记录分类：'+l.lossType+'。这是系统标签，单场结果不足以确认因果。');
  return '<article class="rv-autopsy">'+teamLine(l)+'<b class="rv-score">'+esc(l.finalScore)+'</b><p>'+esc(p.name)+' · '+esc(selection(l))+' @ '+Number(l.odds).toFixed(2)+(t.legs.length>1?' · 串关的一条败腿，金额见全单结算':'')+'</p><ul>'+why.map(w=>'<li>'+esc(w)+'</li>').join('')+'</ul><p class="rv-note">这说明预测与赛果的差距；判定模型偏差需要更多独立比赛样本。</p></article>';
 }).join('');
 return box('败腿核对',items||empty('暂无已核验的败腿'),'只展示有完场比分的败腿，最近 '+Math.min(20,legs.length)+' 条。同一比赛可能出现在不同策略中。');
}
function bandsPanel(){
 const labels={A:'A · ≥75',B:'B · 60–74',C:'C · 45–59',D:'D · <45',unknown:'出票时评分未记录或无法还原'};
 return box('评分分组',table(['评分带',...statHeads],Object.entries(labels).map(([k,label])=>'<tr><td>'+label+'</td>'+resultCells(summarize(settledRows().filter(r=>ticketBand(r.t)===k).map(r=>r.t)))+'</tr>').join('')),'只按出票时保存的评分分组；读取时重算的分数不用于历史分组。串关按最低一腿评分分组，任一腿无法还原则归入末组。作废不计入命中率。');
}
function counterfactual(){
 const changed=settledRows().flatMap(({p,t})=>(t.legs||[]).map((l,i)=>({p,t,l,i})).filter(r=>r.l.directionChanged&&r.l.alt));
 if(!changed.length)return box('方向变化对照',empty('暂无保留替代方向的已结算票据'));
 const body=changed.slice(0,12).map(({p,t,l,i})=>{
  const pnl=hypotheticalPnl(t,i,l.alt);
  return '<tr><td>'+esc(p.name)+'<br>'+esc(teamZh(l.home))+' 对 '+esc(teamZh(l.away))+'</td><td>'+esc(selection({...l,...l.alt}))+'</td><td class="'+tone(t.pnl)+'">'+signed(t.pnl)+'</td><td class="'+tone(pnl)+'">'+(pnl===null?'全腿赛果或支持的盘口不足':signed(pnl))+'</td></tr>';
 }).join('');
 return box('方向变化对照',table(['票据 / 改变的比赛','替代选项','实际全单盈亏','替换该腿后的全单盈亏'],body),'每次只替换一腿，其他腿保持原样；需全腿赛果齐全。整数盘走水返本，四分之一盘暂不反推。替代方向记录时间可能较晚，此表仅为事后对照，不证明赛前优势。');
}
function monthly(){
 const groups=new Map();for(const {t} of settledRows()){const month=dayAt(t.settledAt).slice(0,7)||'时间未记录';if(!groups.has(month))groups.set(month,[]);groups.get(month).push(t);}
 return box('月度报告',groups.size?table(['结算月份',...statHeads],[...groups].sort((a,b)=>b[0].localeCompare(a[0])).map(([key,ts])=>'<tr><td>'+key+'</td>'+resultCells(summarize(ts))+'</tr>').join('')):empty('暂无已结算记录'));
}
function modelPanel(){
 const cal=current.calibration,notes=(current.evolution?.notes||[]).slice(-10).reverse(),buckets=cal?.buckets||[];
 return box('概率校准',buckets.length?table(['预测概率桶','预测均值','实际命中','样本数'],buckets.map(b=>'<tr><td>'+esc(b.range)+'</td><td>'+percent(b.predicted*100)+'</td><td>'+percent(b.actual*100)+'</td><td>'+b.count+'</td></tr>').join('')):empty('暂无校准数据'),'全局模型数据，不随策略筛选。Brier '+(numeric(cal?.brier)?Number(cal.brier).toFixed(3):'—')+'；重复赛事会降低样本独立性。')+box('最近模型调整',notes.length?'<ol class="rv-notes">'+notes.map(n=>'<li>'+esc(n)+'</li>').join('')+'</ol>':empty('暂无调整记录'),'调整后的收益变化只是观察，不能据此认定调参有效；需要前瞻独立样本验证。');
}
function leaguePanel(){
 const groups=new Map();for(const {t} of settledRows()){const codes=[...new Set((t.legs||[]).map(l=>l.leagueCode))],key=codes.length===1?codes[0]:'mixed';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(t);}
 const body=[...groups].sort((a,b)=>String(a[0]).localeCompare(String(b[0]))).map(([k,ts])=>{const flag=leagueFlagAsset(k),icon=flag?'<img class="rv-league-flag" src="'+flag+'" alt="" width="24" height="18">':'<span class="rv-region">'+(k==='mixed'?'MIX':k==='legacy'?'历史':/^uefa\./.test(k)?'UEFA':/^(?:afc\.)/.test(k)?'AFC':/^conmebol\./.test(k)?'CONMEBOL':'国际')+'</span>';return '<tr><td><span class="rv-league-label">'+icon+'<span>'+esc(k==='mixed'?'跨联赛串关':leagueZh(k))+'</span></span></td>'+resultCells(summarize(ts))+'</tr>';}).join('');
 return box('联赛表现',body?table(['国家 / 联赛',...statHeads],body):empty('暂无结算记录'),'跨联赛串关单列，避免将整张票据盈亏重复归属到多个联赛。');
}
export function render(){
 if(!host||!current)return;
 const opened=new Set([...host.querySelectorAll('details[open]')].map(el=>el.querySelector('summary')?.textContent));
 const content=activeView==='results'?results():activeView==='analysis'?lossDrivers()+yesterday()+selectionAudit()+lossAnalysis()+counterfactual()+bandsPanel()+monthly():activeView==='model'?modelPanel()+leaguePanel():reviewQueue()+trend()+groupsPanel()+dailyTable();
 host.innerHTML='<div class="rv-board"><div class="rv-heading"><div><p class="eyebrow">虚拟资金 · 结算复盘</p><h2>把每一笔结果看清楚</h2><p class="rv-note" role="status">'+(readError?'⚠ '+esc(readError)+'；以下为 '+at(lastRead)+' 的旧账本快照 <button type="button" data-review-retry>重新读取</button>':'账本读取 '+at(lastRead)+' · 每分钟检查更新')+'</p></div><label>查看策略<select id="reviewPortfolio"><option value="all">全部策略</option>'+current.portfolios.map(p=>'<option value="'+esc(p.id)+'" '+(selectedPortfolio===p.id?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label></div>'+overview()+'<nav class="rv-tabs" aria-label="复盘内容">'+Object.entries(views).map(([id,label])=>'<button type="button" data-review-view="'+id+'" aria-current="'+(id===activeView?'page':'false')+'">'+label+'</button>').join('')+'</nav><div class="rv-content">'+content+'</div></div>';
 for(const el of host.querySelectorAll('details'))if(opened.has(el.querySelector('summary')?.textContent))el.open=true;
}
async function load(){
 if(!host||loading||document.hidden||host.contains(document.activeElement)&&document.activeElement?.matches('input,select'))return;loading=true;
 try{if(current){const metaResponse=await fetch('/api/lab?meta=1',{cache:'no-store',signal:AbortSignal.timeout(5000)}),meta=await metaResponse.json();if(!metaResponse.ok||!meta.ok)throw new Error('账本暂时不可达');if(Number(meta.updatedAt)===Number(current.updatedAt)&&dayAt(lastRead)===dayAt(Date.now())){if(readError){readError='';render();}return;}}const response=await fetch('/api/lab',{cache:'no-store',signal:AbortSignal.timeout(20000)}),data=await response.json();if(!response.ok||!data.ok||!Array.isArray(data.lab?.portfolios))throw new Error('账本暂时不可达');current=data.lab;lastRead=Date.now();readError='';render();}
 catch{readError='账本刷新失败';if(current)render();else host.innerHTML='<div class="rv-empty" role="status">暂时无法读取账本。<button type="button" data-review-retry>重新读取</button></div>';}
 finally{loading=false;}
}
export function mountReviewBoard(el){
 host=el;
 host.addEventListener('click',event=>{const tab=event.target.closest('[data-review-view]');if(tab){activeView=tab.dataset.reviewView;render();host.querySelector('[data-review-view="'+activeView+'"]')?.focus({preventScroll:true});return;}if(event.target.closest('[data-show-review]')){activeView='results';ticketStatus='review';reviewPage=1;render();return;}if(event.target.closest('[data-export-review]')&&current){const csv=exportReviewCsv(current.portfolios||[]),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='魔虚罗-十策略全量票据-'+new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})+'.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);return;}const pager=event.target.closest('[data-review-page]');if(pager){reviewPage=Math.max(1,reviewPage+Number(pager.dataset.reviewPage));render();host.querySelector('.rv-ticket-search')?.scrollIntoView({block:'start'});return;}if(event.target.closest('[data-review-retry]'))load();});
 host.addEventListener('change',event=>{if(event.target.id==='reviewPortfolio'){selectedPortfolio=event.target.value;reviewPage=1;render();host.querySelector('#reviewPortfolio')?.focus({preventScroll:true});}});
 host.addEventListener('submit',event=>{if(event.target.id!=='reviewTicketSearch')return;event.preventDefault();ticketQuery=String(event.target.elements.query.value||'');ticketStatus=String(event.target.elements.status.value||'all');reviewPage=1;render();host.querySelector('#reviewTicketSearch input')?.focus({preventScroll:true});});
 window.addEventListener('edge:simulation-ledger',event=>{if(event.detail?.portfolios){current=event.detail;lastRead=Date.now();render();}});
 setTimeout(()=>{if(!current)load();},2000);
 setInterval(()=>load(),60000);
}
if(typeof document!=='undefined'){const el=document.getElementById('review-board');if(el)mountReviewBoard(el);}
