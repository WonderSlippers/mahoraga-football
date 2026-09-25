import { teamZh, matchTeamZh, teamOriginal } from './names-zh.js?rev=league-svg-v3';
import {researchBoard,ticketCard} from './research-ui.js?rev=external-quotes-v1';
import {dailyStats as settledDayStats,dayAt} from './ledger-metrics.js?rev=evidence-v3';
import {strategyStatus} from './strategy-status.js?rev=strategy-state-v1';
import {nationalResearchLeagues} from './national-research-queue.js';
(() => {
  const host=document.querySelector('#simulation-dashboard');if(!host)return;
  host.dataset.labBoot='starting';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=n=>Number(n||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const time=n=>n?new Date(n).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'尚未扫描';
  const done=t=>['win','loss','void'].includes(t.status);
  const names={open:'◷ 待结算',win:'✓ 赢',loss:'✕ 输',void:'— 作废',review:'⚠ 待核验'};
  let current=null,legacy=[],selected='all-singles',loading=false,legacyLoading=false,message='',lastReceipt='',scanning=false,reconciling=false,scanAvailable=false,lastScanAttemptAt=0,lastReconcileAttemptAt=0,ticketPage=1,radarPage=1,lastRenderedDay='',chartRange='all',chartModel=null,mobileChartSeries='all-singles',snapshotState='loading',snapshotSavedAt=0;
  let nationalFeeds=null,nationalFeedLoading=false,lastNationalFeedAttemptAt=0,externalQuoteReferences={},externalQuoteLoading=false,lastExternalQuoteAttemptAt=0;
  let prospectiveText='前瞻验证尚未载入；历史票据不能事后补造赛前预测。',prospectiveDetailText='',prospectiveLoading=false,lastProspectiveAttemptAt=0;
  const hiddenChartSeries=new Set();
  const labCacheKey='edge:simulation-lab:snapshot:v1';
  function saveCachedLab(){try{const value=JSON.stringify({savedAt:Date.now(),lab:current,legacy});if(value.length<4_000_000)localStorage.setItem(labCacheKey,value);}catch{}}
  function restoreCachedLab(){try{const saved=JSON.parse(localStorage.getItem(labCacheKey)||'null');if(!saved?.lab||!Array.isArray(saved.lab.portfolios))return false;current=saved.lab;legacy=Array.isArray(saved.legacy)?saved.legacy:[];snapshotState='cached';snapshotSavedAt=Number(saved.savedAt)||0;message=`已秒开本机快照（保存于 ${time(snapshotSavedAt)}），正在后台核对最新账本…`;safeRender();return true;}catch{return false;}}
  function decorateLab(){
    const heading=host.querySelector('.lab-heading');if(!heading)return;
    const research=host.querySelector('.research-board'),researchHost=document.querySelector('#research-dashboard');if(research&&researchHost)researchHost.replaceChildren(research);
    const emptyResearch=researchHost?.querySelector('[aria-label="已有赔率的重点研究候选"] .research-candidate-list .lab-empty');if(emptyResearch)emptyResearch.textContent='目前没有 90 分钟内核验、并明确标为当前报价的完整 1X2。旧快照和 close 参考价不能代替新价；等待安全扫描恢复后再审查。';
    for(const card of host.querySelectorAll('.lab-card')){
      const button=card.querySelector('[data-select]'),portfolio=current.portfolios.find(p=>p.id===button?.dataset.select);if(!portfolio)continue;
      const state=strategyStatus(portfolio),label=button.querySelector('span');if(label)label.textContent=state;
      if(state==='只读历史'||state==='暂停待复核'){
        const settings=card.querySelector('details');settings?.querySelector('form')?.remove();
        const summary=settings?.querySelector('summary');if(summary)summary.textContent='历史票据与策略规则';
      }
    }
    const coverage=current.lastScan?.oddsCoverage,coveragePanel=[...host.querySelectorAll('.lab-scan-health')].find(node=>node.querySelector('strong')?.textContent==='赔率覆盖诊断');
    if(coveragePanel&&coverage){const detail=coveragePanel.querySelector('span');if(detail)detail.textContent=coverage.executionReferenceComplete==null
      ?`最近一次扫描写于 ${time(coverage.capturedAt)}，旧记录没有把 close 参考价与当前报价分开；旧“完整”计数不可当成当前可用价。重新安全扫描后才会出现五类明细。`
      :`最近一批未来 24 小时 ${coverage.executionFuture} 场：当前同源完整 1X2 ${coverage.executionComplete}，仅 close 历史参考价 ${coverage.executionReferenceComplete}，部分价格 ${coverage.executionPartial}，明确未开盘 ${coverage.executionUnopened}，源头未返回 ${coverage.executionSourceMissing}；另有抓取失败联赛 ${current.lastScan?.failedLeagues??0}。只用当前完整价判断数值优势。抓取 ${time(coverage.capturedAt)}。`;}
    const radar=current.radar,radarPanel=host.querySelector('.lab-radar');if(radar&&radarPanel&&Number(radar.capturedAt)<=Date.now()-90*60000){const note=document.createElement('p');note.className='lab-message';note.setAttribute('role','status');note.textContent='赛程雷达超过 90 分钟未扫描：以下旧快照只供历史查看，赔率、评分和候选均不是当前结论。';radarPanel.querySelector('header')?.after(note);}
    const note=document.createElement('div');note.className='lab-message';note.textContent=scanAvailable?'扫描保护版本已就绪；新单只在手动启动并通过服务端校验后生成。赛事实时读取与历史账本保持可用，上次扫描时间不代表当前赔率。':'扫描保护：此前全量扫描曾耗尽本地服务内存，当前暂停自动及手动新单扫描。赛事实时读取与历史账本保持可用；后台任务仍安装，但只有经验证的限内存版本才会恢复扫描。上次扫描时间不是新鲜数据承诺。';
    const prospective=document.createElement('div');prospective.className='lab-message';prospective.id='lab-prospective-evaluation';prospective.innerHTML=`<strong>新旧评分 · 前瞻观察</strong><span>${esc(prospectiveText)}</span>${prospectiveDetailText?`<details><summary>查看样本、版本与价格压力情景</summary><p>${esc(prospectiveDetailText)}</p></details>`:''}`;
    heading.after(note,prospective);
    const chart=host.querySelector('.lab-performance-chart'),cards=host.querySelector('.lab-cards');if(chart&&cards)cards.before(chart);
    if(cards){const archived=['totals-baseline','totals-poisson'].map(id=>cards.querySelector(`[data-select="${id}"]`)?.closest('.lab-card')).filter(Boolean);if(archived.length){const wrapper=document.createElement('details');wrapper.className='lab-archived';wrapper.innerHTML='<summary>大小球历史实验 · 两套已停新单的旧账本</summary><p>旧基准盘按赛事编号分配大小方向，没有预测依据，代码已停止新增；进球分布实验也暂停新增。两套旧票据继续保留、结算和复盘，不合并或改写历史金额与赔率。新的大小球研究只在重点研究里看，不把它们当成两套活跃策略。</p><div class="lab-archive-cards"></div>';for(const card of archived){const label=card.querySelector('.lab-title span');if(label)label.textContent='历史只读 · 停止新增';wrapper.querySelector('.lab-archive-cards').append(card);}cards.after(wrapper);}}
  }
  function goalAudit(l){const g=l.goalEvidence;if(!g)return '';const sources=(g.sourceUrls||[]).map((u,i)=>{try{const url=new URL(u);return url.hostname==='site.web.api.espn.com'?'<a href="'+esc(url.href)+'" target="_blank" rel="noopener noreferrer">'+esc(String(g.seasons?.[i]||'?'))+' 赛季积分榜</a>':'';}catch{return '';}}).filter(Boolean).join(' / ');return `<details class="lab-leg-audit"><summary>查看本场计算依据</summary><p>模型版本：${esc(l.evidence?.modelVersion||g.modelVersion)}；${l.market==='spread'?'多档让球 '+(l.side==='home'?'主队':'客队')+' '+(Number(l.line)>0?'+':'')+String(Number(l.line)):'全场 '+(l.side==='over'?'大':'小')+' '+String(Number(l.line))+' 球'} @ ${Number(l.odds).toFixed(3)}（${esc(l.provider)} / ${esc(l.phase||'阶段未保存')}）。参考赔率抓取 ${time(l.priceCapturedAt)}；赔率源头更新时间未知。</p><p>赛前冻结的进球期望：主 ${Number(g.expectedHome).toFixed(2)}、客 ${Number(g.expectedAway).toFixed(2)}；本季＋上季加权进失球样本：主 ${Number(g.home?.games).toFixed(1)}、客 ${Number(g.away?.games).toFixed(1)} 场；记录概率 ${(Number(l.probability)*100).toFixed(1)}%；v3 亚洲盘为获利概率，期望返还另按完整结算分布计算；不确定性参数 ${(Number(g.uncertaintyMargin)*100).toFixed(1)}%。</p><p>积分榜采集：${time(g.capturedAt)}；${sources||'源链接未留存'}。来源实际更新时刻未提供，模型未经回测或概率校准。</p><p>${esc((g.assumptions||[]).join('；'))}。</p></details>`;}
  function spreadAudit(l){if(l.goalEvidence)return goalAudit(l);const e=l.evidence;return `<details class="lab-leg-audit"><summary>查看本场计算依据</summary><p>多档让球 ${l.side==='home'?'主队':'客队'} ${Number(l.line)>0?'+':''}${String(Number(l.line))} @ ${Number(l.odds).toFixed(3)}（${esc(l.provider)} / ${esc(l.phase||'阶段未保存')}）；抓取 ${time(l.priceCapturedAt)}，源头赔率更新时间未提供。</p><p>模型版本：${esc(e?.modelVersion||'早期版本未保存')}；1X2近期战绩概率推导半球结果后另扣不确定性，保守估计概率 ${(l.probability*100).toFixed(1)}%。这不是独立校准的让球模型或已验证的盈利优势。</p><p>盘口双边去水市场概率：${e?.marketProbabilities?.map(p=>(p*100).toFixed(1)+'%').join(' / ')||'缺失'}；主客近期战绩：${esc(e?.homeForm||'未提供')} / ${esc(e?.awayForm||'未提供')}。首发、伤停、疲劳未参与；此单仅为可审计对比实验。</p></details>`;}
  function legAudit(l){if(l.market==='spread')return spreadAudit(l);if(l.market==='total'&&l.goalEvidence)return goalAudit(l);if(l.market==='total')return `<details class="lab-leg-audit"><summary>查看本场计算依据</summary><p>全场 ${l.side==='over'?'大':'小'} ${String(Number(l.line))} 球 @ ${Number(l.odds).toFixed(3)}（${esc(l.provider)} / ${esc(l.phase||'字段未保存')}）；抓取 ${time(l.priceCapturedAt)}。来源独立更新时间未提供。</p><p>模型版本 market-totals-baseline-v1：大/小由赛事编号固定分配，${Number(l.probability*100).toFixed(1)}% 仅为双边参考价去水后的市场基准，不是预测胜率，也不证明价格优势。</p><p>历史进失球、首发、伤停与疲劳尚未进入基准；未建立独立进球分布与概率校准。</p></details>`;const e=l.evidence;return `<details class="lab-leg-audit"><summary>查看本场计算依据</summary><p>下单时扣减后估计概率：${(l.probability*100).toFixed(1)}%；参考赔率对应的盈亏平衡概率：${(100/l.odds).toFixed(1)}%。不是已验证胜率。</p>${e?`<p>模型版本：${esc(e.modelVersion)} · 计算时间：${time(e.calculatedAt)}</p><p>市场概率（主 / 平 / 客）：${e.marketProbabilities.map(p=>(p*100).toFixed(1)+'%').join(' / ')}；不确定性扣减 ${(e.uncertaintyMargin*100).toFixed(2)} 个百分点。</p><p>近期战绩：主队 ${esc(e.homeForm||'未提供')}；客队 ${esc(e.awayForm||'未提供')}。W=胜，D=平，L=负。</p>`:'<p>早期单据未留存完整输入和版本，不事后补造。</p>'}<p>该版本只使用公开赔率与近期战绩，未纳入已确认首发、伤停。历史进失球研究模型尚未用于此单。</p></details>`;}
  function dailyStats(p,date){const d=settledDayStats(p.tickets,date);return {...d,count:d.placedCount,settledCount:d.count};}
  function portfolioDailyChart(p){const days=[...Array(7)].map((_,i)=>dayAt(Date.now()-(6-i)*86400000)),rows=days.map(date=>{const tickets=p.tickets.filter(t=>done(t)&&t.settledAt&&dayAt(t.settledAt)===date);return{date,pnl:tickets.reduce((sum,t)=>sum+Number(t.pnl||0),0),count:tickets.length}}),max=Math.max(1,...rows.map(row=>Math.abs(row.pnl))),total=rows.reduce((sum,row)=>sum+row.pnl,0);return `<div class="portfolio-daily" role="img" aria-label="${esc(p.name)}最近七个早八点账单日的已实现盈亏"><div class="portfolio-daily-head"><span>近 7 个账单日 · 08:00 切账</span><b class="${total<0?'negative':total>0?'positive':'neutral'}">${total>=0?'+':''}¥${money(total)}</b></div><div class="portfolio-bars">${rows.map(row=>{const height=row.count?Math.max(5,Math.round(Math.abs(row.pnl)/max*46)):2,tone=row.pnl>0?'up':row.pnl<0?'down':'flat',short=Math.abs(row.pnl)>=1000?(row.pnl/1000).toFixed(1)+'k':Math.round(row.pnl).toString();return `<span class="portfolio-bar-col" title="${esc(row.date)} 08:00 账单：${row.count} 单，${row.pnl>=0?'+':''}¥${money(row.pnl)}"><em class="${row.pnl<0?'negative':row.pnl>0?'positive':'neutral'}">${row.pnl>0?'+':''}${esc(short)}</em><span class="portfolio-bar-track"><i class="portfolio-bar ${tone}" style="height:${height}%"></i></span><small>${esc(row.date.slice(5))}</small></span>`}).join('')}</div></div>`;}
  function postmortem(){return '<p class="lab-rule"><a href="/review.html" target="_top">打开复盘台 → 查看每日对账、完整串关结果及逐场败因</a></p>';}
  function stats(p){const resolved=p.tickets.filter(done),pnl=resolved.reduce((s,t)=>s+t.pnl,0),stake=resolved.filter(t=>t.status!=='void').reduce((s,t)=>s+t.stake,0),exposure=p.tickets.filter(t=>!done(t)).reduce((s,t)=>s+t.stake,0);let equity=p.initialBalance,peak=equity,drawdown=0;for(const t of resolved.slice().sort((a,b)=>a.settledAt-b.settledAt)){equity+=t.pnl;peak=Math.max(peak,equity);drawdown=Math.max(drawdown,(peak-equity)/peak);}return{resolved,pnl,stake,exposure,balance:p.initialBalance+pnl,available:Math.max(0,p.initialBalance+pnl-exposure),gains:resolved.reduce((s,t)=>s+Math.max(0,t.pnl),0),losses:resolved.reduce((s,t)=>s+Math.max(0,-t.pnl),0),today:dailyStats(p,dayAt(Date.now())),roi:stake?100*pnl/stake:null,drawdown};}
  function dailyTable(){const dates=[...new Set([dayAt(Date.now()),...current.portfolios.flatMap(p=>p.tickets.flatMap(t=>[dayAt(t.createdAt),...(t.settledAt?[dayAt(t.settledAt)]:[])]))])].sort().slice(-14).reverse();return `<details class="lab-daily"><summary>每日账单明细（北京时间 08:00 切账）</summary><div class="lab-scroll"><table><thead><tr><th>账单日</th><th>策略</th><th>新单数</th><th>账单投入</th><th>结算数</th><th>已实现盈亏</th></tr></thead><tbody>${dates.map(date=>current.portfolios.map(p=>{const d=dailyStats(p,date);return `<tr><td>${date} 08:00</td><td>${esc(p.name)}</td><td>${d.count}</td><td>¥${money(d.placedStake)}</td><td>${d.settledCount}</td><td class="${d.pnl<0?'negative':d.pnl>0?'positive':'neutral'}">${d.pnl>=0?'+':''}¥${money(d.pnl)}</td></tr>`;}).join('')).join('')}</tbody></table></div><p class="lab-rule">每个账单日从北京时间当天 08:00 到次日 07:59:59；凌晨结算归入前一个账单日。原始下单与结算时间保持不变。</p></details>`;}
  function chart(){
    const colors=['#b8f36b','#54d8e8','#b8a6ff','#ffc760','#ff8298','#72e0ad','#ed91df','#76c9ff','#e8b27e','#b5c9a5'];
    const all=current.portfolios.flatMap(p=>p.tickets.filter(done).filter(t=>Number(t.settledAt)));
    if(!all.length){chartModel=null;return '<div class="lab-empty">每日盈亏图等待首笔结算。当前各策略尚无已实现盈亏。</div>';}
    const settledDays=[...new Set(all.map(t=>dayAt(t.settledAt)).filter(Boolean))].sort(),firstDay=settledDays[0],lastDay=dayAt(Date.now()),days=[];
    for(let at=Date.parse(firstDay+'T00:00:00Z'),end=Date.parse(lastDay+'T00:00:00Z');at<=end;at+=86400000)days.push(new Date(at).toISOString().slice(0,10));
    const windowDays=chartRange==='7d'?7:chartRange==='14d'?14:Infinity,shownDays=Number.isFinite(windowDays)?days.slice(-windowDays):days,times=shownDays.map(date=>Date.parse(date+'T00:00:00Z'));
    const periodTickets=all.filter(t=>shownDays.includes(dayAt(t.settledAt))),distinctMatches=new Set(periodTickets.flatMap(t=>(t.legs||[]).map(l=>`${l.leagueCode||''}:${l.matchId||''}`))).size;
    const series=current.portfolios.map((p,index)=>({
      id:p.id,name:p.name,color:colors[index%colors.length],
      points:shownDays.map((date,index)=>{const settled=p.tickets.filter(t=>done(t)&&dayAt(t.settledAt)===date);return{at:times[index],date,value:settled.reduce((sum,t)=>sum+Number(t.pnl||0),0),count:settled.length};})
    }));
    const visible=series.filter(s=>!hiddenChartSeries.has(s.id));
    const vals=(visible.length?visible:series).flatMap(s=>s.points.map(p=>p.value));
    let low=Math.min(0,...vals),high=Math.max(0,...vals);if(low===high){low-=1;high+=1;}
    const padding=(high-low)*.1;low-=padding;high+=padding;
    const W=960,H=350,left=88,right=28,top=28,bottom=64,plotW=W-left-right,plotH=H-top-bottom,span=Math.max(1,high-low),timeSpan=Math.max(1,times.at(-1)-times[0]);
    const x=at=>times.length===1?left+plotW/2:left+(at-times[0])*plotW/timeSpan,y=value=>top+(high-value)*plotH/span;
    const linePath=points=>points.map((point,index)=>`${index?'L':'M'}${x(point.at).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ');
    const yTicks=[0,1,2,3,4].map(i=>high-(high-low)*i/4),tickIndexes=[...new Set([0,Math.floor((times.length-1)*.25),Math.floor((times.length-1)*.5),Math.floor((times.length-1)*.75),times.length-1])],xTicks=tickIndexes.map(index=>times[index]);
    const totals=series.map(s=>({...s,periodValue:s.points.reduce((sum,p)=>sum+p.value,0),latest:s.points.at(-1)})),mobileSeries=totals.find(s=>s.id===mobileChartSeries)||totals[0];
    chartModel={W,H,left,right,top,bottom,plotW,plotH,low,high,times,series,x,y};
    return `<section class="lab-performance-chart" aria-labelledby="labChartTitle">
      <header class="lab-chart-head"><div><p class="eyebrow">策略每日盈亏</p><h3 id="labChartTitle">各策略每日已实现盈亏</h3><p>横坐标：北京时间 08:00 账单日 · 纵坐标：当日盈亏（人民币）· 悬停或轻触查看每个模块的单数和金额</p></div><div class="lab-chart-ranges" aria-label="图表时间范围">${[['7d','近 7 日'],['14d','近 14 日'],['all','全部']].map(([id,label])=>`<button type="button" data-chart-range="${id}" aria-pressed="${chartRange===id}">${label}</button>`).join('')}</div></header>
      <div class="lab-chart-kpis"><span><small>所选周期已结算票</small><b>${periodTickets.length} 张 · 跨策略可重复</b></span><span><small>覆盖不同比赛</small><b>${distinctMatches} 场 · 不代表独立样本充分</b></span><span><small>最新账单日</small><b>${esc(lastDay)} 08:00</b></span></div>
      <div class="lab-chart-mobile"><label for="labChartMobileSeries">选择策略查看每日盈亏</label><select id="labChartMobileSeries">${totals.map(s=>`<option value="${esc(s.id)}" ${s.id===mobileSeries.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select><table><thead><tr><th scope="col">账单日</th><th scope="col">已实现盈亏</th><th scope="col">结算票</th></tr></thead><tbody>${mobileSeries.points.slice().reverse().map(p=>`<tr><td>${esc(p.date.slice(5))}</td><td class="${p.value<0?'negative':p.value>0?'positive':'neutral'}">${p.value>=0?'+':''}¥${money(p.value)}</td><td>${p.count}</td></tr>`).join('')}</tbody></table><p>北京时间 08:00 切账；零值表示当天没有已结算盈亏。不同策略可能记录同一场比赛。</p></div>
      <div class="lab-chart-stage"><svg viewBox="0 0 ${W} ${H}" class="lab-chart" role="img" tabindex="0" aria-describedby="labChartHelp" aria-label="各策略每日已实现盈亏交互对比图">
        <g class="lab-chart-grid">${yTicks.map(value=>`<line x1="${left}" x2="${W-right}" y1="${y(value)}" y2="${y(value)}"/><text x="${left-12}" y="${y(value)+4}" text-anchor="end">${value>=0?'+':''}¥${Math.round(value).toLocaleString('zh-CN')}</text>`).join('')}${xTicks.map((at,index)=>`<line x1="${x(at)}" x2="${x(at)}" y1="${top}" y2="${H-bottom}"/><text x="${x(at)}" y="${H-27}" text-anchor="${index===0?'start':index===xTicks.length-1?'end':'middle'}">${new Date(at).toISOString().slice(5,10)}</text>`).join('')}<text class="lab-chart-axis-title" x="${left+plotW/2}" y="${H-7}" text-anchor="middle">账单日（北京时间 08:00 切账）</text><text class="lab-chart-axis-title" transform="translate(15 ${top+plotH/2}) rotate(-90)" text-anchor="middle">当日已实现盈亏（¥）</text></g>
        <line class="lab-chart-baseline" x1="${left}" x2="${W-right}" y1="${y(0)}" y2="${y(0)}"/>
        <g class="lab-chart-series">${series.map(s=>`<path data-chart-path="${esc(s.id)}" d="${linePath(s.points)}" stroke="${s.color}" class="${hiddenChartSeries.has(s.id)?'is-hidden':''}"/><circle data-chart-marker="${esc(s.id)}" r="5" fill="${s.color}" hidden/>`).join('')}</g>
        <g class="lab-chart-cursor" hidden><line y1="${top}" y2="${H-bottom}"/><text x="${left+8}" y="${top+18}"></text></g>
        <rect class="lab-chart-overlay" data-chart-overlay x="${left}" y="${top}" width="${plotW}" height="${plotH}"/>
      </svg><div class="lab-chart-tooltip" role="status" aria-live="polite" hidden></div></div>
      <p class="lab-chart-help" id="labChartHelp">图例可单独开关策略；键盘聚焦图表后可用左右方向键逐日查看。零值表示该策略当天没有已结算盈亏。</p>
      <div class="lab-legend" aria-label="显示或隐藏策略">${totals.map(s=>`<button type="button" data-chart-series="${esc(s.id)}" aria-pressed="${!hiddenChartSeries.has(s.id)}" style="--series:${s.color}"><i></i><span>${esc(s.name)}</span><b>${s.periodValue>=0?'+':''}¥${money(s.periodValue)}</b></button>`).join('')}</div>
    </section>`;
  }
  function showChartPoint(index,clientX=null,clientY=null){
    if(!chartModel)return;const stage=host.querySelector('.lab-chart-stage'),svg=stage?.querySelector('.lab-chart'),tooltip=stage?.querySelector('.lab-chart-tooltip'),cursor=svg?.querySelector('.lab-chart-cursor');if(!stage||!svg||!tooltip||!cursor)return;
    index=Math.max(0,Math.min(chartModel.times.length-1,index));const at=chartModel.times[index],cx=chartModel.x(at),rows=chartModel.series.filter(s=>!hiddenChartSeries.has(s.id)).map(s=>({s,p:s.points[index]})).sort((a,b)=>b.p.value-a.p.value);
    cursor.hidden=false;const line=cursor.querySelector('line'),label=cursor.querySelector('text');line.setAttribute('x1',cx);line.setAttribute('x2',cx);label.textContent=time(at);label.setAttribute('x',Math.min(chartModel.W-180,Math.max(chartModel.left+8,cx+8)));
    for(const marker of svg.querySelectorAll('[data-chart-marker]')){const row=rows.find(item=>item.s.id===marker.dataset.chartMarker);marker.hidden=!row;if(row){marker.setAttribute('cx',cx);marker.setAttribute('cy',chartModel.y(row.p.value));}}
    tooltip.innerHTML=`<strong>${time(at)}（北京时间）</strong>${rows.map(({s,p})=>`<span><i style="--series:${s.color}"></i><em>${esc(s.name)}</em><b class="${p.value<0?'negative':p.value>0?'positive':'neutral'}">${p.value>=0?'+':''}¥${money(p.value)}</b><small>${p.count} 单已结算</small></span>`).join('')}`;tooltip.hidden=false;
    const box=stage.getBoundingClientRect(),tipW=Math.min(360,box.width-24),left=clientX==null?box.width/2:clientX-box.left,top=clientY==null?40:clientY-box.top;tooltip.style.width=`${tipW}px`;tooltip.style.left=`${Math.min(box.width-tipW-8,Math.max(8,left+16))}px`;tooltip.style.top=`${Math.max(8,Math.min(box.height-tooltip.offsetHeight-8,top-12))}px`;svg.dataset.chartIndex=String(index);
  }
  function hideChartPoint(){const svg=host.querySelector('.lab-chart'),tooltip=host.querySelector('.lab-chart-tooltip'),cursor=svg?.querySelector('.lab-chart-cursor');if(cursor)cursor.hidden=true;if(tooltip)tooltip.hidden=true;svg?.querySelectorAll('[data-chart-marker]').forEach(marker=>marker.hidden=true);}
  function bindChartInteractions(){
    const svg=host.querySelector('.lab-chart'),overlay=host.querySelector('[data-chart-overlay]');if(!svg||!overlay||!chartModel)return;
    const nearestIndex=clientX=>{const rect=svg.getBoundingClientRect(),viewX=(clientX-rect.left)*chartModel.W/Math.max(1,rect.width),target=chartModel.times[0]+(viewX-chartModel.left)*Math.max(1,chartModel.times.at(-1)-chartModel.times[0])/chartModel.plotW;let best=0;for(let i=1;i<chartModel.times.length;i++)if(Math.abs(chartModel.times[i]-target)<Math.abs(chartModel.times[best]-target))best=i;return best;};
    overlay.addEventListener('pointermove',event=>showChartPoint(nearestIndex(event.clientX),event.clientX,event.clientY));
    overlay.addEventListener('pointerdown',event=>showChartPoint(nearestIndex(event.clientX),event.clientX,event.clientY));
    overlay.addEventListener('pointerleave',hideChartPoint);
    svg.addEventListener('focus',()=>showChartPoint(Number(svg.dataset.chartIndex||chartModel.times.length-1)));
    svg.addEventListener('blur',hideChartPoint);
    svg.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const currentIndex=Number(svg.dataset.chartIndex||chartModel.times.length-1),index=event.key==='Home'?0:event.key==='End'?chartModel.times.length-1:currentIndex+(event.key==='ArrowLeft'?-1:1);showChartPoint(index);});
  }
  function radarPanel(){
    const radar=current?.radar;if(!radar)return '<section class="lab-radar"><header><div><p class="eyebrow">7 天赛程</p><h2>未来 7 天赛程雷达</h2></div></header><div class="lab-empty">等待下一轮真实扫描生成未来赛程雷达。</div></section>';
    const entries=radar.entries||[],expired=!Number(radar.capturedAt)||Number(radar.capturedAt)<=Date.now()-90*60000;
    const pageSize=25,pageCount=Math.max(1,Math.ceil(entries.length/pageSize));radarPage=Math.min(Math.max(1,radarPage),pageCount);
    const verified=expired?0:entries.filter(row=>row.priced&&row.quotePhase==='current'&&!row.stale&&Number(row.observedAt||radar.capturedAt)>Date.now()-90*60000).length;
    const stageName={execution:'24 小时执行窗',prescreen:'48 小时预筛',calendar:'7 天赛程池'};
    const radarTeam=(name,league)=>matchTeamZh(name,league);
    const days=(radar.byDay||[]).map(row=>`<span><b>${esc(String(row.day).slice(5))}</b><em>${row.matches} 场</em><small>${expired?'旧快照价格，待核验':`${row.priced} 场扫描时有价`}</small></span>`).join('');
    const rows=entries.slice((radarPage-1)*pageSize,radarPage*pageSize).map(row=>`<tr><td>${time(row.kickoffAt)}</td><td><small>${esc(row.leagueCode)}${row.stale||expired?' · 旧快照':''}</small><strong>${esc(radarTeam(row.home,row.leagueCode))} vs ${esc(radarTeam(row.away,row.leagueCode))}</strong></td><td><span class="radar-stage ${esc(row.stage)}">${stageName[row.stage]||esc(row.stage)}</span></td><td>${row.priced?row.odds.map(n=>Number(n).toFixed(2)).join(' / '):'<span class="negative">缺失</span>'}<small>${row.stale||expired?'历史参考，不可用于新单 · ':''}让球 ${row.spreadQuotes||0} · 大小 ${row.totalQuotes||0}</small></td><td class="radar-reason">${esc(row.reason)}</td></tr>`).join('');
    return `<section class="lab-radar"><header><div><p class="eyebrow">7 天赛程</p><h2>未来 7 天赛程雷达</h2><p>65 联赛分批轮转，含国家队和女足；48 小时预筛，24 小时才允许生成新模拟单。旧快照仅供历史查看。</p></div><small>快照生成于 ${time(radar.capturedAt)} · ${expired?'当前已过期；须重新核验':`扫描当批 ${radar.fresh??'—'} 场 / 当批未重查 ${radar.stale??'—'} 场`}</small></header><div class="lab-radar-kpis"><span><small>快照赛程（非当前覆盖）</small><b>${radar.total||0}</b></span><span><small>近 90 分钟核验的完整当前 1X2</small><b>${verified}</b></span><span><small>扫描时 48 小时预筛</small><b>${radar.prescreenWindow||0}</b></span><span><small>扫描时 24 小时执行</small><b>${radar.executionWindow||0}</b></span></div><div class="lab-radar-days">${days||'<span>暂无分日统计</span>'}</div><div class="lab-scroll"><table class="lab-radar-table"><thead><tr><th>开赛时间</th><th>赛事</th><th>阶段</th><th>赔率快照</th><th>扫描时处理结论</th></tr></thead><tbody>${rows||'<tr><td colspan="5">当前扫描没有读取到未来比赛。</td></tr>'}</tbody></table></div><div class="lab-page-controls"><button type="button" data-radar-page="-1" ${radarPage<=1?'disabled':''}>上一页</button><span>第 ${radarPage} / ${pageCount} 页 · 已显示 ${(radarPage-1)*pageSize+Math.min(pageSize,Math.max(0,entries.length-(radarPage-1)*pageSize))} / ${entries.length} 场</span><button type="button" data-radar-page="1" ${radarPage>=pageCount?'disabled':''}>下一页</button></div></section>`;
  }
  function orderedTickets(portfolio){
    const today=dayAt(Date.now());
    return portfolio.tickets.slice().sort((a,b)=>{
      const aToday=dayAt(a.createdAt)===today,bToday=dayAt(b.createdAt)===today;
      if(aToday!==bToday)return aToday?-1:1;
      const aDone=done(a),bDone=done(b);
      if(aDone!==bDone)return aDone?1:-1;
      return Number(b.createdAt||0)-Number(a.createdAt||0);
    });
  }
  function render(){if(!current)return;lastRenderedDay=dayAt(Date.now());const expanded=new Map([...host.querySelectorAll('details')].map(el=>[el.querySelector(':scope > summary')?.textContent,el.open]));const drafts=[...host.querySelectorAll('form[data-dirty="true"]')].map(f=>{const stake=f.elements.namedItem('stake'),maxTickets=f.elements.namedItem('maxTickets'),enabled=f.elements.namedItem('enabled');return stake&&maxTickets&&enabled?{id:f.dataset.config,stake:stake.value,maxTickets:maxTickets.value,enabled:enabled.checked}:null}).filter(Boolean);const total=current.portfolios.reduce((s,p)=>s+p.tickets.length,0),portfolio=current.portfolios.find(p=>p.id===selected)||current.portfolios[0],scan=current.lastScan||{},reviewCount=current.portfolios.reduce((s,p)=>s+p.tickets.filter(t=>t.status==='review').length,0),openCount=current.portfolios.reduce((s,p)=>s+p.tickets.filter(t=>t.status==='open').length,0);host.innerHTML=`
    <div class="lab-heading"><div><div class="eyebrow">策略研究 · 仅虚拟资金</div><h1>模拟下注与策略对比</h1><p>${current.portfolios.length} 种方式独立记账 · 累计记录 ${total} 笔 · 最近扫描 ${time(current.lastScanAt)}</p></div><div><button class="secondary" id="labReconcile">核对已完场单</button><button class="primary" id="labScan" ${scanAvailable&&snapshotState==='verified'?'':'disabled title="账本尚未核对或安全扫描未恢复"'}>${snapshotState!=='verified'?'等待账本核对':scanAvailable?'立即选赛并模拟':'新单扫描已暂停'}</button></div></div>
    ${snapshotState==='verified'?'':`<div class="lab-snapshot-warning" role="alert"><strong>${snapshotState==='cached'?'正在核对本机快照':'离线或读取失败 · 当前仅为旧快照'}</strong><span>保存于 ${time(snapshotSavedAt)}。票据和统计尚未与活动账本核对，赔率、评分与候选不能据此做当前判断；新单扫描已禁用。</span></div>`}
    <div class="lab-message lab-scan-health" role="status"><strong>当前运行状态</strong><span>新模拟单扫描：${scanAvailable?'可手动启动':'因内存保护暂停'}；旧票据完场补查：页面打开约 5 秒后自动执行，前台在线时每 5 分钟检查一次，核实后可能更新结算状态。两种操作互不等同。</span></div>
    <div class="lab-message" role="status">${esc(message||current.lastScan?.pauseReason||'所有板块的新单统一均注 20 元；这里只调整每日上限与开关。历史票据金额保持原样。')}</div>
    ${lastReceipt?`<div class="lab-message" role="status"><strong>最近操作回执</strong><span>${esc(lastReceipt)}</span></div>`:''}
    <div class="lab-message lab-scan-health" role="note"><strong>时间与风险口径</strong><span>新单每日上限和停止新增条件按北京时间 00:00 重置；下方账单按 08:00 切换。停止新增不限制已开放票据后续亏损；“待结算占用”是这些票据可能损失的本金。十策略各自使用虚拟本金，跨策略重复比赛不能合成一个实盘组合。</span></div>
    <div class="lab-message lab-scan-health" role="note"><strong>${current.scanProgress?.status==='partial'?'⚠ 最近扫描部分提交':current.scanProgress?.status==='running'?'⚠ 扫描尚未完成':!current.lastScanAt?'⚠ 尚无服务端扫描':Date.now()-current.lastScanAt>10*60000?'⚠ 超过 10 分钟未扫描':'✓ 最近扫描已记录'}</strong><span>上次账本扫描：${time(current.lastScanAt)}。${current.scanProgress?.status==='partial'?`批次 ${esc(current.scanProgress.id)} 在 ${esc(current.scanProgress.stage)} 阶段结束，失败：${esc((current.scanProgress.errors||[]).join('；')||'详见本机扫描记录')}。部分表可能已写入，先核对账本。`:current.scanProgress?.status==='running'?`批次 ${esc(current.scanProgress.id)} 最近阶段 ${esc(current.scanProgress.stage)}，尚不能视为整轮完成。`:''}此前 65 联赛单次扫描耗尽本地服务内存，自动写扫描暂时停用；分批限内存版本通过实机多轮验收后才恢复。${scan.totalLeagues?`最近一批成功 ${scan.scannedLeagues??0}/${scan.totalLeagues} 联赛，轮转 ${scan.sweepSlot??'—'}/${scan.sweepSlots??'—'}；赔率和候选数仅代表本批，不是全部联赛。`:''}</span></div>
    <div class="lab-message lab-scan-health" role="status"><strong>本轮扫描与结算</strong><span>候选 ${scan.candidates??'—'} 场 · 新模拟单 ${scan.placed??'—'} 笔 · 完成结算 ${scan.settled??'—'} 笔；当前 ${reviewCount} 笔完场赛果待复核，${openCount} 笔仍待赛果。赛果可由单个 ESPN 完场源初结；同供应商两端点一致属于复核，独立官方来源另行标记。结算依据以每单保存的证据为准。</span></div>
    <div class="lab-message lab-scan-health" role="note"><strong>赔率覆盖诊断</strong><span>${scan.oddsCoverage?`未来 48 小时 ${scan.oddsCoverage.researchFuture} 场：${scan.oddsCoverage.researchComplete} 场三项完整，${scan.oddsCoverage.researchMissing} 场不完整；执行窗口 ${scan.oddsCoverage.executionFuture} 场：${scan.oddsCoverage.executionComplete} 场完整、${scan.oddsCoverage.executionPartial} 场只有部分价格、${scan.oddsCoverage.executionMissing} 场源头未返回可用 1X2。最后检查 ${time(scan.oddsCoverage.capturedAt)}。`:'等待下一次成功扫描写入 24/48 小时赔率覆盖分类。'}</span></div>
    ${radarPanel()}
    ${legacy.length?`<div class="lab-legacy"><strong>保留的早期研究单 · ${legacy.length} 笔</strong><div>${legacy.map(r=>`<span>${esc(teamZh(r.home))} 对阵 ${esc(teamZh(r.away))}（${esc(teamOriginal(r.home))} vs ${esc(teamOriginal(r.away))}）：${esc(r.pickLabel)} @ ${Number(r.odds).toFixed(3)} · ¥${money(r.stake)} · ${names[r.status]||esc(r.status)}</span>`).join('')}</div></div>`:''}
    <div class="lab-cards">${current.portfolios.map(p=>{const s=stats(p);return `<article class="lab-card ${selected===p.id?'selected':''}"><button class="lab-title" data-select="${p.id}">${esc(p.name)} <span>${p.enabled?'新单已启用':'新单已暂停'}</span></button><strong class="lab-profit ${s.pnl<0?'negative':s.pnl>0?'positive':'neutral'}">${s.pnl>=0?'+':''}¥${money(s.pnl)}</strong><div class="lab-numbers"><span>初始本金 ¥${money(p.initialBalance)}</span><span>余额 ¥${money(s.balance)} · 可用 ¥${money(s.available)}</span><span>待结算占用 ¥${money(s.exposure)}</span><span>本账单日投入 ¥${money(s.today.placedStake)} · 盈亏 <b class="${s.today.pnl<0?'negative':s.today.pnl>0?'positive':'neutral'}">${s.today.pnl>=0?'+':''}¥${money(s.today.pnl)}</b></span><span>累计赢额 ¥${money(s.gains)} · 亏额 ¥${money(s.losses)}</span><span>${p.tickets.length} 单 · 已结算 ${s.resolved.length} 单</span><span>已结算投入收益率 ${s.roi==null?'—':s.roi.toFixed(2)+'%'}</span></div>${portfolioDailyChart(p)}<details><summary>调整金额 / 上限 / 开关</summary><form data-config="${p.id}"><label><input type="checkbox" name="enabled" ${p.enabled?'checked':''}> 启用新模拟单</label><label>每单虚拟金额 <input name="stake" type="number" min="1" max="500" step="1" value="${p.stake}" required></label><label>自然日最多单数 <input name="maxTickets" type="number" min="1" max="100" value="${p.maxTickets}" required></label><button class="secondary" type="submit">保存设置</button></form><p>${esc(p.rule)}</p></details></article>`;}).join('')}</div>
    ${postmortem()}
    <details class="lab-compare"><summary>资金曲线与效果对比</summary><div class="lab-scroll"><table><thead><tr><th>策略</th><th>总单数</th><th>赢 / 输</th><th>已结算投入</th><th>累计盈亏</th><th>投入收益率</th><th>已实现净值最大回撤</th><th>判断</th></tr></thead><tbody>${current.portfolios.map(p=>{const s=stats(p);return `<tr><td>${esc(p.name)}</td><td>${p.tickets.length}</td><td>${s.resolved.filter(t=>t.status==='win').length} / ${s.resolved.filter(t=>t.status==='loss').length}</td><td>¥${money(s.stake)}</td><td class="${s.pnl<0?'negative':s.pnl>0?'positive':'neutral'}">¥${money(s.pnl)}</td><td>${s.roi==null?'—':s.roi.toFixed(2)+'%'}</td><td>${(s.drawdown*100).toFixed(2)}%</td><td>${s.resolved.length<20?'样本不足':'仅作历史比较'}</td></tr>`;}).join('')}</tbody></table></div>${chart()}${dailyTable()}</details>${current.calibration?`<details class="lab-compare"><summary>胜平负概率校准与参数观察</summary><p>去重、有效且二元结算的胜平负样本 ${current.calibration.totalSettledLegs} 条腿 · Brier ${current.calibration.brier==null?"—":current.calibration.brier.toFixed(3)}（越低越好；恒定预测 50% 的二元基准为 0.25） · 非补位腿等权收益 ${current.calibration.valueRoi==null?"—":(current.calibration.valueRoi*100).toFixed(1)+"%"} · 补位腿等权收益 ${current.calibration.fillRoi==null?"—":(current.calibration.fillRoi*100).toFixed(1)+"%"} · 当前不确定性边际偏移 ${(current.calibration.evolutionMarginShift*100).toFixed(1)}pp</p><div class="lab-scroll"><table><thead><tr><th>预测概率桶</th><th>预测均值</th><th>实际命中率</th><th>样本</th><th>偏差（实际-预测）</th></tr></thead><tbody>${current.calibration.buckets.map(b=>`<tr><td>${b.range}</td><td>${(b.predicted*100).toFixed(1)}%</td><td>${(b.actual*100).toFixed(1)}%</td><td>${b.count}</td><td class="${b.gap<0?'negative':'positive'}">${b.gap>=0?'+':''}${(b.gap*100).toFixed(1)}pp</td></tr>`).join('')}</tbody></table></div><div class="lab-scroll"><table><thead><tr><th>玩法</th><th>已结算</th><th>已实现收益率</th></tr></thead><tbody>${current.calibration.marketStats.map(m=>`<tr><td>${m.market==='total'?'大小球':m.market==='spread'?'多档让球':'胜平负'}</td><td>${m.settled}</td><td class="${m.roi<0?'negative':'positive'}">${(m.roi*100).toFixed(1)}%</td></tr>`).join('')}</tbody></table></div><p class="lab-rule">参数观察：暂停滚动自动调参，先做时间外验证。去重腿收益不等于策略账本收益。当前：${esc(current.calibration.evolutionNote||'样本或偏差不足以触发调整。')}</p></details>`:''}
    <div class="lab-ticket-head"><h2>${esc(portfolio.name)} · 具体模拟单</h2><select id="labPortfolio" aria-label="查看策略单据">${current.portfolios.map(p=>`<option value="${p.id}" ${p.id===portfolio.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div><p class="lab-rule">${esc(portfolio.rule)} ${portfolio.id==='all-singles'?'广覆盖为全量对照组：允许最多 50% 未结算敞口，且不会因 3% 单日亏损暂停记录；这不代表推荐。':'该策略受 10% 未结算敞口和 3% 单日止损约束。'}设置只影响新单。列表排序：今天新推 → 待核验/未结算 → 历史已结算。</p>
    <div class="lab-tickets">${portfolio.tickets.length?orderedTickets(portfolio).slice((ticketPage-1)*20,ticketPage*20).map(t=>ticketCard(t,portfolio,current,time,legAudit)).join(''):'<div class="lab-empty">此策略尚无模拟单。请看上方筛选审查中的具体原因。</div>'}</div>
    <div class="lab-page-controls"><button type="button" data-ticket-page="-1" ${ticketPage<=1?'disabled':''}>上一页</button><span>第 ${ticketPage} / ${Math.max(1,Math.ceil(portfolio.tickets.length/20))} 页 · 共 ${portfolio.tickets.length} 单</span><button type="button" data-ticket-page="1" ${ticketPage*20>=portfolio.tickets.length?'disabled':''}>下一页</button></div>
    ${researchBoard(current,{scanAvailable,nationalFeeds,externalQuoteReferences})}
  `;decorateLab();host.querySelectorAll('input[name="stake"]').forEach(input=>{input.value='20';input.readOnly=true;input.setAttribute('aria-label','统一均注 20 元');});host.querySelectorAll('details').forEach(el=>{const key=el.querySelector(':scope > summary')?.textContent;if(expanded.has(key))el.open=expanded.get(key);});for(const draft of drafts){const form=host.querySelector('form[data-config="'+draft.id+'"]'),stake=form?.elements.namedItem('stake'),maxTickets=form?.elements.namedItem('maxTickets'),enabled=form?.elements.namedItem('enabled');if(form&&stake&&maxTickets&&enabled){form.dataset.dirty='true';stake.value='20';maxTickets.value=draft.maxTickets;enabled.checked=draft.enabled;}}bindChartInteractions();}
  function renderFallback(error){
    const portfolios=Array.isArray(current?.portfolios)?current.portfolios:[];
    const rows=portfolios.map(p=>{const tickets=Array.isArray(p?.tickets)?p.tickets:[],settled=tickets.filter(done),pnl=settled.reduce((sum,t)=>sum+Number(t?.pnl||0),0);return `<tr><td>${esc(p?.name||p?.id||'未命名策略')}</td><td>${tickets.length}</td><td>${settled.length}</td><td class="${pnl<0?'negative':pnl>0?'positive':'neutral'}">${pnl>=0?'+':''}¥${money(pnl)}</td></tr>`}).join('');
    host.innerHTML=`<div class="lab-heading"><div><div class="eyebrow">策略研究 · 安全模式</div><h1>策略独立账本</h1><p>${snapshotState==='verified'?'活动账本已读取':'当前仅有未核对的本机旧快照'}；一条异常展示数据被隔离，没有继续阻塞整页。</p></div><button class="secondary" id="labRetry" type="button">重试完整视图</button></div><div class="lab-message" role="alert">完整视图渲染失败：${esc(error?.message||'未知前端错误')}。下表仍按已读取账本汇总，模拟票据没有丢失。</div><div class="lab-scroll"><table><thead><tr><th>策略</th><th>总单数</th><th>已结算</th><th>累计盈亏</th></tr></thead><tbody>${rows||'<tr><td colspan="4">账本结构为空</td></tr>'}</tbody></table></div>`;
    host.dataset.labBoot='fallback';
  }
  function safeRender(){try{render();host.dataset.labBoot='ready';return true;}catch(error){console.error('simulation_ledger_render_failed',error);renderFallback(error);return false;}}
  async function loadLegacyInBackground(){
    if(legacyLoading)return;legacyLoading=true;
    try{const response=await fetch('/api/ledger',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok||!String(response.headers.get('content-type')||'').includes('application/json'))return;const payload=await response.json();if(payload?.ok){legacy=payload.ledger?.state?.records||[];if(snapshotState==='verified')saveCachedLab();if(current)safeRender();}}
    catch{}finally{legacyLoading=false;}
  }
  async function load(force=false){
    if(loading||(!force&&(document.hidden||host.contains(document.activeElement)&&document.activeElement?.matches('input,select'))))return;
    loading=true;
    try{
      if(!force&&current){
        try{
          const metaResponse=await fetch('/api/lab?meta=1',{cache:'no-store',signal:AbortSignal.timeout(5000)}),meta=await metaResponse.json();
          if(metaResponse.ok&&meta.ok&&Number(meta.updatedAt)===Number(current.updatedAt)&&lastRenderedDay===dayAt(Date.now())){snapshotState='verified';message='活动策略账本已核对；赔率与研究快照仍按各自采集时间判断。';safeRender();loadLegacyInBackground();return;}
        }catch{}
      }
      const labResponse=await fetch('/api/lab',{cache:'no-store',signal:AbortSignal.timeout(8000)});
      if(!String(labResponse.headers.get('content-type')||'').includes('application/json'))throw new Error('策略账本返回了登录页或无效响应');
      const labPayload=await labResponse.json();
      if(!labPayload?.ok){
        if(!current)throw new Error('模拟账本接口暂时不可用');
        snapshotState='stale';message='模拟账本接口暂时不可用，继续显示上次研究结果';
      }else{
        current=labPayload.lab;
        snapshotState='verified';snapshotSavedAt=Date.now();
        message='最新策略账本已同步；旧账本正在后台补齐，不再阻塞本页。';
      }
      if(current)window.dispatchEvent(new CustomEvent('edge:simulation-ledger',{detail:current}));
      if(current){safeRender();if(snapshotState==='verified')saveCachedLab();loadLegacyInBackground();}
    }catch(error){
      snapshotState='stale';message=String(error?.message||'数据接口暂时不可用');
      if(current)safeRender();else host.innerHTML=`<h1>模拟下注与策略对比</h1><p role="status">${esc(message)}。<button id="labRetry" type="button">重新读取</button></p>`;
    }finally{loading=false;}
  }
  async function loadNationalFeeds(){
    if(nationalFeedLoading||!current||document.hidden||Date.now()-lastNationalFeedAttemptAt<10*60000)return;
    nationalFeedLoading=true;lastNationalFeedAttemptAt=Date.now();
    const now=Date.now(),day=ms=>new Date(ms).toISOString().slice(0,10).replaceAll('-',''),dates=`${day(now-86400000)}-${day(now+2*86400000)}`;
    const leagues=[],failedLeagues=[];
    for(const leagueCode of nationalResearchLeagues(current.radar,now)){
      try{
        const response=await fetch(`/api/feed?league=${encodeURIComponent(leagueCode)}&dates=${dates}`,{cache:'no-store',signal:AbortSignal.timeout(12000)});
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const payload=await response.json(),events=Array.isArray(payload.events)?payload.events:[];
        leagues.push({leagueCode,fetchedAt:Date.now(),events:events.filter(event=>Date.parse(event.date)>now&&Date.parse(event.date)<=now+48*3600000).map(event=>({id:event.id,date:event.date,status:{type:{state:event.status?.type?.state}},competitions:[{competitors:(event.competitions?.[0]?.competitors||[]).map(c=>({homeAway:c.homeAway,team:{displayName:c.team?.displayName,name:c.team?.name}}))}]}))});
      }catch{failedLeagues.push(leagueCode);}
    }
    nationalFeeds={capturedAt:Date.now(),leagues,failedLeagues};nationalFeedLoading=false;
    if(current)safeRender();
  }
  async function loadExternalQuoteReferences(){
    if(externalQuoteLoading||!current||document.hidden||Date.now()-lastExternalQuoteAttemptAt<5*60000)return;
    externalQuoteLoading=true;lastExternalQuoteAttemptAt=Date.now();
    const rows=await Promise.all(['401861047','401861048','401861045','401861043','401861041','401861046','401861044','401861042'].map(async id=>{
      try{const response=await fetch(`/api/external-quote-reference?id=${id}`,{cache:'no-store',signal:AbortSignal.timeout(11000)});return [id,await response.json()];}
      catch(error){return [id,{ok:false,error:String(error),sourceUrl:'',bookUrl:''}];}
    }));
    externalQuoteReferences=Object.fromEntries(rows);externalQuoteLoading=false;
    if(current)safeRender();
  }
  async function loadProspective(){
    if(prospectiveLoading||document.hidden||Date.now()-lastProspectiveAttemptAt<600000)return;
    prospectiveLoading=true;lastProspectiveAttemptAt=Date.now();
    try{
      const response=await fetch('/api/model-evaluation',{cache:'no-store',signal:AbortSignal.timeout(8000)});
      const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'本地前瞻验证接口不可用');
      const e=data.evaluation;
      const fmt=s=>s.matches?`${s.matches} 场、假设 ROI ${(s.roi*100).toFixed(1)}%、Brier ${s.brier.toFixed(3)}`:'尚无已结算的独立比赛';
      const versions=Object.entries(e.modelVersions||{}).map(([version,count])=>`${version} ${count} 场`).join('；')||'暂无';
      const stress=e.priceStress,stressText=stress?.matches?`同一批当前价比赛的参考假设 ROI ${(100*stress.observedRoi).toFixed(1)}%；若所有价格均恶化 2% / 5%，分别为 ${(100*stress.priceMinus2PctRoi).toFixed(1)}% / ${(100*stress.priceMinus5PctRoi).toFixed(1)}%。这是假设全数可取得更差赔率的情景，不是真实成交。`:'尚无可作价格压力情景的已结算当前价比赛。';
prospectiveDetailText=`已冻结并结算 ${e.selectedMatches} 场唯一比赛；旧 A：${fmt(e.oldA)}；新 A：${fmt(e.newA)}。这只是评分筛选对照，不是完整策略或两套概率模型的胜负。模型版本：${versions}；同场跨版本 ${e.multiVersionMatches||0} 场，其中同供应商同价格且采集相差不超过五分钟 ${e.samePricePairedMatches||0} 场。固定试验登记 ${e.protocol?.id||'未提供'}，留出窗 2026-10-24 起 ${e.holdout?.matches||0} 场。已冻结预测覆盖 ${e.coverage?.eligibleForecastMatches??'—'} 场，计划但未采到的赛事总数未知；已结算当前价 ${e.quotePhases?.current||0} 场、close 参考价 ${e.quotePhases?.['close-reference']||0} 场。${stressText}${e.provisional?'样本不足，仅为观察。':'仍须人工评估，未自动更换评分。'} 待赛果 ${e.skipped.pendingMatches} 场、冲突/待复核 ${e.skipped.conflictMatches+e.skipped.reviewMatches} 场。`;
      prospectiveText=e.selectedMatches?`前瞻已结算 ${e.selectedMatches} 场唯一比赛；仅供观察，模型和筛选规则尚未获得收益证明。新模拟单仍按独立安全门禁控制。`:'尚无已结算的前瞻独立比赛；目前不能判断新评分或模型能否改善收益。';
    }catch(error){prospectiveText=`${error.message||'前瞻验证暂不可用'}；不会拿历史票据伪装前瞻回测。`;prospectiveDetailText='';}
    finally{prospectiveLoading=false;const box=host.querySelector('#lab-prospective-evaluation');if(box)box.innerHTML=`<strong>新旧评分 · 前瞻观察</strong><span>${esc(prospectiveText)}</span>${prospectiveDetailText?`<details><summary>查看样本、版本与价格压力情景</summary><p>${esc(prospectiveDetailText)}</p></details>`:''}`;}
  }
  host.addEventListener('change',e=>{if(e.target.id==='labPortfolio'){selected=e.target.value;ticketPage=1;render();}else if(e.target.id==='labChartMobileSeries'){mobileChartSeries=e.target.value;render();host.querySelector('#labChartMobileSeries')?.focus({preventScroll:true});}});
  async function scan(manual=false){
    if(scanning||reconciling||(!manual&&(document.hidden||!navigator.onLine)))return;
    if(snapshotState!=='verified'){message='账本尚未与活动服务核对，不能根据旧快照生成新模拟单。';if(current)render();return;}
    try{
      const ready=await fetch('/api/local-runner-ready',{cache:'no-store',signal:AbortSignal.timeout(5000)}).then(r=>r.json());
      if(ready.runnerProtocol!=='prospective-scan-v5'){
        message='为避免全量扫描再次耗尽本地服务内存，扫描暂时停用；历史票据和已有预测仍保留。';
        if(current)render();
        return;
      }
    }catch{message='扫描安全状态不可核验，本轮未执行。';if(current)render();return;}
    const now=Date.now();
    if(!manual&&(now-lastScanAttemptAt<300000||current?.lastScanAt&&now-current.lastScanAt<300000))return;
    lastScanAttemptAt=now;scanning=true;
    const button=host.querySelector('#labScan');if(button){button.disabled=true;button.textContent='扫描与模拟中…';}
    try{
      const r=await fetch('/api/scan',{method:'POST',cache:'no-store',signal:AbortSignal.timeout(360000)}),data=await r.json();
      if(!r.ok||!data.ok||data.lab?.error){
        const outage=data.outageErrors&&typeof data.outageErrors==='object'?Object.entries(data.outageErrors).map(([reason,count])=>`${reason}×${count}`).join('、'):'';
        throw new Error(`${data.lab?.error||data.error||'扫描失败'}${outage?`（错误分布：${outage}）`:''}`);
      }
      const recovered=Array.isArray(data.retryRecoveredCodes)?data.retryRecoveredCodes.filter(Boolean):[];
      const receipt=`${manual?'本轮':'自动'}扫描 ${data.monitored} 场；多策略新增 ${data.lab?.placed||0} 单，结算 ${data.lab?.settled||0} 单。${data.lab?.pauseReason?` ${data.lab.pauseReason}`:''}${data.failedLeagues>0?` ${data.failedLeagues} 个联赛数据源失败：${(data.failedLeagueCodes||[]).join('、')}。`:''}${recovered.length>0?` ${recovered.length} 个联赛重试后恢复：${recovered.join('、')}。`:''}`;
      await load(true);if(snapshotState==='verified'){lastReceipt=receipt;if(current)render();}
    }catch(error){message=`${manual?'扫描':'自动扫描'}失败：${error.message}`;lastReceipt=message;if(current)render();}
    finally{scanning=false;const retry=host.querySelector('#labScan');if(retry){retry.disabled=!scanAvailable||snapshotState!=='verified';retry.textContent=snapshotState!=='verified'?'等待账本核对':scanAvailable?'立即选赛并模拟':'新单扫描已暂停';}}
  }
  async function refreshRunnerState(){
    const previous=scanAvailable;
    try{const response=await fetch('/api/local-runner-ready',{cache:'no-store',signal:AbortSignal.timeout(5000)}),ready=await response.json();scanAvailable=response.ok&&ready?.runnerProtocol==='prospective-scan-v5';}
    catch{scanAvailable=false;}
    if(current&&previous!==scanAvailable)safeRender();
  }
  async function reconcile(manual=false){
    if(reconciling||scanning||!navigator.onLine||(!manual&&document.hidden))return;
    const now=Date.now();if(!manual&&now-lastReconcileAttemptAt<300000)return;
    lastReconcileAttemptAt=now;reconciling=true;
    const button=host.querySelector('#labReconcile');if(button){button.disabled=true;button.textContent='核对中…';}
    try{
      const response=await fetch('/api/reconcile',{method:'POST',cache:'no-store',signal:AbortSignal.timeout(120000)}),data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||'完场补查失败');
      const receipt=`已补查 ${data.matched} 场旧单赛事；复核通过 ${data.verifiedFinals??data.independentlyVerifiedFinals??0} 场、完成结算 ${data.settled} 笔。未核实单不计入盈利。`;
      await load(true);if(snapshotState==='verified'){lastReceipt=receipt;if(current)render();}
    }catch(error){message=`完场补查失败：${error.message}`;lastReceipt=message;if(current)render();}
    finally{reconciling=false;const retry=host.querySelector('#labReconcile');if(retry){retry.disabled=false;retry.textContent='核对已完场单';}}
  }
  host.addEventListener('input',e=>{const form=e.target.closest('form[data-config]');if(form)form.dataset.dirty='true';});
  host.addEventListener('click',async e=>{
    const button=e.target.closest('[data-paper-scan]');if(!button)return;
    button.disabled=true;button.textContent='虚拟记账中…';
    try{
      const response=await fetch('/api/public-paper-scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:button.dataset.paperScan}),cache:'no-store',signal:AbortSignal.timeout(30000)});
      const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'虚拟记账失败');
      await load(true);message=result.created?`已按 ${result.provider} 展示价记录一张 ¥20 娱乐对照模拟单；不是严格精选。`:'这场已在娱乐对照账本中，未重复记账。';
      if(current)render();
    }catch(error){message=`公开价虚拟记账失败：${error.message}`;button.disabled=false;button.textContent='按此价记入娱乐对照模拟账本';if(current)render();}
  });
  host.addEventListener('click',e=>{const range=e.target.closest('[data-chart-range]');if(range){chartRange=range.dataset.chartRange;render();return;}const chartSeries=e.target.closest('[data-chart-series]');if(chartSeries){const id=chartSeries.dataset.chartSeries,visible=current.portfolios.filter(p=>!hiddenChartSeries.has(p.id));if(hiddenChartSeries.has(id))hiddenChartSeries.delete(id);else if(visible.length>1)hiddenChartSeries.add(id);render();return;}const radarPager=e.target.closest('[data-radar-page]');if(radarPager){radarPage=Math.max(1,radarPage+Number(radarPager.dataset.radarPage));render();host.querySelector('.lab-radar')?.scrollIntoView({block:'start'});return;}const pager=e.target.closest('[data-ticket-page]');if(pager){ticketPage=Math.max(1,ticketPage+Number(pager.dataset.ticketPage));render();host.querySelector('.lab-ticket-head')?.scrollIntoView({block:'start'});return;}if(e.target.id==='labRetry'){load(true);return;}const selectedButton=e.target.closest('[data-select]');if(selectedButton){selected=selectedButton.dataset.select;ticketPage=1;render();return;}if(e.target.id==='labScan'&&scanAvailable)scan(true);if(e.target.id==='labReconcile')reconcile(true);});
  host.addEventListener('submit',async e=>{const form=e.target.closest('form[data-config]');if(!form)return;e.preventDefault();const button=form.querySelector('button');button.disabled=true;try{const r=await fetch('/api/lab',{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify({id:form.dataset.config,enabled:form.elements.enabled.checked,stake:Number(form.elements.stake.value),maxTickets:Number(form.elements.maxTickets.value)})}),data=await r.json();if(!r.ok||!data.ok)throw new Error(data.error||'保存失败');delete form.dataset.dirty;current=data.lab;window.dispatchEvent(new CustomEvent('edge:simulation-ledger',{detail:current}));message='已保存，只影响之后生成的模拟单。';render();}catch(error){message=error.message;button.disabled=false;const status=host.querySelector('.lab-message[role="status"]');if(status)status.textContent='保存失败：'+message+'。填写内容已保留，可重试。';}});
  restoreCachedLab();
  load(true).then(()=>{loadProspective();loadNationalFeeds();loadExternalQuoteReferences();setTimeout(()=>reconcile(false),5000);});
  refreshRunnerState();
  setInterval(()=>load(),60000);
  setInterval(()=>refreshRunnerState(),60000);
  setInterval(()=>loadProspective(),600000);
  setInterval(()=>loadNationalFeeds(),600000);
  setInterval(()=>loadExternalQuoteReferences(),300000);
  setInterval(()=>reconcile(false),300000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)reconcile(false);});
})();
