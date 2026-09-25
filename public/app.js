import { teamZh, teamOriginal, matchTeamZh, countryFlag } from './names-zh.js?rev=global-football-v123';
import {crest} from './research-ui.js?rev=global-football-v123';
import {classifyOddsAvailability,oddsAvailabilityText} from './odds-health.js?rev=odds-diagnostics-v129';
import {selectCurrentMoneyline,selectCurrentPairedMarkets} from './odds-policy.js?rev=coherent-current-v2';
import {planRotatingLeagueBatch,shouldFetchLocalFeed} from './feed-refresh-policy.js?rev=bounded-ui-v3';
import {decisionEvidenceFresh,candidateQuoteMatches} from './decision-evidence.js';
const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
const leagues=[
  ['eng.1','英格兰 · 英超'],['eng.2','英格兰 · 英冠'],['esp.1','西班牙 · 西甲'],['ita.1','意大利 · 意甲'],
  ['ger.1','德国 · 德甲'],['fra.1','法国 · 法甲'],['uefa.champions','欧洲 · 欧冠'],['uefa.europa','欧洲 · 欧联'],
  ['uefa.europa.conf','欧洲 · 欧协联'],['usa.1','美国 · MLS'],['mex.1','墨西哥 · 联赛'],['bra.1','巴西 · 甲级联赛'],
  ['arg.1','阿根廷 · 甲级联赛'],['chn.1','中国 · 中超'],['fifa.world','国际 · 国家队赛事'],
  ['ned.1','荷兰 · 荷甲'],['por.1','葡萄牙 · 葡超'],['bel.1','比利时 · 比甲'],['tur.1','土耳其 · 超级联赛'],
  ['sco.1','苏格兰 · 超级联赛'],['jpn.1','日本 · J1联赛'],['ksa.1','沙特 · 职业联赛'],
  ['conmebol.libertadores','南美 · 解放者杯'],['conmebol.sudamericana','南美 · 南球杯'],['usa.nwsl','美国 · 女足联赛'],
  ['fifa.friendly','国际 · 男足友谊赛'],['fifa.friendly.w','国际 · 女足友谊赛'],
  ['eng.w.1','英格兰 · 女超'],['esp.w.1','西班牙 · 女甲'],['fra.w.1','法国 · 女甲'],['aus.w.1','澳大利亚 · 女足联赛'],
  ['uefa.wchampions','欧洲 · 女足欧冠'],['uefa.wchampions_qual','欧洲 · 女足欧冠资格赛'],['uefa.w.europa','欧洲 · 女足欧联'],
  ['uefa.w.nations','欧洲 · 女足国家联赛'],['concacaf.w.champions_cup','中北美 · 女足冠军杯'],
  ['fifa.worldq.uefa','国家队 · 欧洲世预赛'],['fifa.worldq.afc','国家队 · 亚洲世预赛'],['fifa.worldq.caf','国家队 · 非洲世预赛'],
  ['fifa.worldq.concacaf','国家队 · 中北美世预赛'],['fifa.worldq.conmebol','国家队 · 南美世预赛'],['fifa.worldq.ofc','国家队 · 大洋洲世预赛'],
  ['concacaf.nations.league','国家队 · 中北美国家联赛'],['uefa.euroq','国家队 · 欧洲杯预选赛'],['afc.cupq','国家队 · 亚洲杯预选赛'],['caf.nations_qual','国家队 · 非洲杯预选赛'],
  ['ger.2','德国 · 德乙'],['esp.2','西班牙 · 西乙'],['fra.2','法国 · 法乙'],['eng.3','英格兰 · 英甲'],
  ['aus.1','澳大利亚 · 澳超'],['sui.1','瑞士 · 超级联赛'],['aut.1','奥地利 · 甲级联赛'],['eng.league_cup','英格兰 · 英联杯'],
  ['eng.fa','英格兰 · 足总杯'],['ger.dfb_pokal','德国 · 德国杯'],['esp.copa_del_rey','西班牙 · 国王杯'],['ita.coppa_italia','意大利 · 意大利杯'],['fra.coupe_de_france','法国 · 法国杯'],
  ['afc.champions','亚洲 · 亚冠精英'],['afc.cup','亚洲 · 亚冠二级'],['concacaf.champions','中北美 · 冠军杯'],['uefa.nations','欧洲 · 欧国联'],['bra.copa_do_brazil','巴西 · 巴西杯'],['arg.copa','阿根廷 · 阿根廷杯']
].map(([code,name])=>({code,name}));
const firstRefreshCodes=['fifa.friendly','fifa.friendly.w','uefa.wchampions','uefa.wchampions_qual','uefa.nations','eng.1','esp.1','jpn.1'];
const rotatingLeagues=[...leagues].sort((a,b)=>{
  const ai=firstRefreshCodes.indexOf(a.code),bi=firstRefreshCodes.indexOf(b.code);
  return (ai<0?firstRefreshCodes.length:ai)-(bi<0?firstRefreshCodes.length:bi);
});
let allRefreshCursor=(()=>{try{return Number(sessionStorage.getItem('edge-feed-cursor-v1')||0)}catch{return 0}})(),liveRefreshCursor=0;
let matches=[],selected=null,activeFilter='all',activeLeague='all',refreshing=false,lastSyncAt=0,nextLiveAt=0,nextAllAt=0,refreshQueued=false;
let deepLinkMatch=new URLSearchParams(location.search).get('match');
let deepLinkLeague=deepLinkMatch?.split(':',1)[0]||'';
function applyDeepLinkSelection(){
  if(!deepLinkMatch)return false;
  const cut=deepLinkMatch.indexOf(':');if(cut<1)return false;
  const league=deepLinkMatch.slice(0,cut),id=deepLinkMatch.slice(cut+1);
  const match=matches.find(row=>String(row.id)===id&&String(row.leagueCode)===league);
  if(!match)return false;
  selected=match;deepLinkMatch=null;return true;
}

const CACHE_KEY='edge-global-cache-v6';
const SIM_KEY='edge-sim-bet-log-v1';
const SIM_SETTINGS_KEY='edge-sim-settings-v1';
const LEDGER_UPDATED_KEY='edge-ledger-updated-v1';
const SIM_STAKE_DEFAULT=20;

let simState={initialBalance:10000,balance:10000,day:todayKey(),dayStartBalance:10000,portfolioStartAt:0,periodHistory:[],records:[],scanJournal:[]};
let simSettings={autoEnabled:false,autoStake:20,autoMinEdge:0.05,autoStakePct:1,autoRunLiveOnly:true,mode:'fixed',autoMaxBets:8,dailyStopLossPct:3,maxExposurePct:10};
let remoteLedgerReady=false,remoteSaveTimer=null,remoteUpdatedAt=0,ledgerBooting=true;
let ledgerPolling=false,lastLedgerPollAt=0;
let oddsHistoryMatchId='',oddsHistoryLeagueCode='',oddsHistoryFetchedAt=0,oddsHistoryRows=[];
let reconcilingResults=false,lastResultReconcileAt=0;
const feedHealth=new Map();

function initials(name){return String(name||'').replace(/[^A-Za-z\u00c0-\u024f\u4e00-\u9fa5]/g,'').slice(0,3).toUpperCase()||'FC'}
function esc(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
function clamp(n,min,max){return Math.max(min,Math.min(max,n))}
function normalizeProb(values){const safe=values.map(v=>Math.max(.025,Number(v)||0));const sum=safe.reduce((a,b)=>a+b,0);return safe.map(v=>v/sum)}
function stat(team,name){const item=(team?.statistics||[]).find(s=>s.name===name);if(item?.displayValue==null||item.displayValue==='')return null;const n=Number(item.displayValue);return Number.isFinite(n)?n:null}
function formPoints(form){const chars=String(form||'').toUpperCase().split('');if(!chars.length)return 1.35;return chars.reduce((n,x)=>n+(x==='W'?3:x==='D'?1:0),0)/chars.length}
function dateKey(date){return date.toISOString().slice(0,10).replaceAll('-','')}
function todayKey(){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
// The visible bill closes at 08:00 Asia/Shanghai. UTC midnight is exactly
// 08:00 in Shanghai, so the UTC date is the accounting-day label.
function billingDayKey(value=Date.now()){
  const ts=Number(value);return Number.isFinite(ts)&&ts>0?new Date(ts).toISOString().slice(0,10):'';
}
function dateWindow(){const now=new Date(),from=new Date(now.getTime()-2*86400000),to=new Date(now.getTime()+7*86400000);return dateKey(from)+'-'+dateKey(to)}
function extendedDateWindow(){const now=new Date(),from=new Date(now.getTime()-2*86400000),to=new Date(now.getTime()+22*86400000);return dateKey(from)+'-'+dateKey(to)}
function withinDisplayWindow(m){const start=Number(new Date(m.date));const now=Date.now();return Number.isFinite(start)&&start>=now-2.5*86400000&&start<=now+21.5*86400000}
const extendedCalendarLeagues=new Set(['fifa.friendly','fifa.friendly.w','eng.w.1','esp.w.1','fra.w.1','aus.w.1','usa.nwsl','uefa.wchampions','uefa.wchampions_qual','uefa.w.europa','uefa.w.nations','concacaf.w.champions_cup','fifa.worldq.uefa','fifa.worldq.afc','fifa.worldq.caf','fifa.worldq.concacaf','fifa.worldq.conmebol','fifa.worldq.ofc','concacaf.nations.league','uefa.nations','uefa.euroq','afc.cupq','caf.nations_qual']);
const seasonFeedCache=new Map();
const localFeedVerificationAt=new Map();
function safeSettings(input){const raw=Number(input);return Number.isFinite(raw)?raw:0}
function clamp01(v,min=0,max=1){return Math.max(min,Math.min(max,v));}
function parseFloatInput(v,fallback){const n=Number(v);return Number.isFinite(n)?n:fallback;}
function formatMoney(v){const n=Number(v||0);return n.toFixed(2)}
function toPercent(v){return `${Math.round((Number(v)||0)*100)}%`}
function asMoney(n){return Math.max(0,Number.isFinite(Number(n))?Number(n):0)}

function loadSimSettings(){
  const fallback={autoEnabled:false,autoStake:20,autoMinEdge:0.05,autoStakePct:1.0,autoRunLiveOnly:true,mode:'fixed',autoMaxBets:8,dailyStopLossPct:3,maxExposurePct:10};
  try{
    const parsed=JSON.parse(localStorage.getItem(SIM_SETTINGS_KEY)||'{}');
    if(!parsed||typeof parsed!=='object') return fallback;
    return {
      autoEnabled:!!parsed.autoEnabled,
      autoStake:SIM_STAKE_DEFAULT,
      autoMinEdge:clamp01(safeSettings(parsed.autoMinEdge)||fallback.autoMinEdge,0,1),
      autoStakePct:clamp01(safeSettings(parsed.autoStakePct)||fallback.autoStakePct,0.1,100),
      autoRunLiveOnly:parsed.autoRunLiveOnly!==false,
      mode:'fixed',
      autoMaxBets:Math.round(clamp01(safeSettings(parsed.autoMaxBets)||fallback.autoMaxBets,1,50)),
      dailyStopLossPct:clamp01(safeSettings(parsed.dailyStopLossPct)||fallback.dailyStopLossPct,.5,20),
      maxExposurePct:clamp01(safeSettings(parsed.maxExposurePct)||fallback.maxExposurePct,1,30)
    };
  }catch{return fallback}
}
function markLedgerChanged(){
  if(ledgerBooting)return Number(localStorage.getItem(LEDGER_UPDATED_KEY))||0;
  const ts=Date.now();localStorage.setItem(LEDGER_UPDATED_KEY,String(ts));
  if(remoteLedgerReady) scheduleRemoteSave();
  return ts;
}
function saveSimSettings(){localStorage.setItem(SIM_SETTINGS_KEY,JSON.stringify(simSettings));markLedgerChanged()}
function mergeScanJournals(remoteRows,localRows){
  const rows=new Map();
  for(const item of [...(Array.isArray(remoteRows)?remoteRows:[]),...(Array.isArray(localRows)?localRows:[])]){
    if(item?.day&&/^\d{4}-\d{2}-\d{2}$/.test(item.day)&&(!rows.has(item.day)||Number(item.lastAt)>Number(rows.get(item.day).lastAt)))rows.set(item.day,item);
  }
  return [...rows.values()].sort((a,b)=>a.day.localeCompare(b.day)).slice(-30);
}

function loadSimState(){
  const fallback={initialBalance:10000,balance:10000,day:todayKey(),dayStartBalance:10000,portfolioStartAt:0,periodHistory:[],records:[],scanJournal:[]};
  try{
    const parsed=JSON.parse(localStorage.getItem(SIM_KEY)||'{}');
    if(!parsed||typeof parsed!=='object') return fallback;
    const parsedBalance=parsed.balance==null?NaN:Number(parsed.balance);
    const rawBalance=Number.isFinite(parsedBalance)?Math.max(0,parsedBalance):null;
    const rawInitial=asMoney(parsed.initialBalance);
    const records=Array.isArray(parsed.records)?parsed.records:[];
    return {
      initialBalance:rawInitial||fallback.initialBalance,
      balance:rawBalance ?? (rawInitial||fallback.balance),
      day:typeof parsed.day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(parsed.day)?parsed.day:fallback.day,
      dayStartBalance:parsed.dayStartBalance!=null&&Number.isFinite(Number(parsed.dayStartBalance))?asMoney(parsed.dayStartBalance):(rawBalance??fallback.dayStartBalance),
      portfolioStartAt:Number.isSafeInteger(Number(parsed.portfolioStartAt))&&Number(parsed.portfolioStartAt)>=0?Number(parsed.portfolioStartAt):0,
      periodHistory:Array.isArray(parsed.periodHistory)?parsed.periodHistory:[],
      scanJournal:Array.isArray(parsed.scanJournal)?parsed.scanJournal.filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(String(r?.day||''))).slice(-30):[],
      records:records.map(r=>({
        ...r,
        id:String(r.id||Date.now()+Math.random()),
        day:String(r.day||todayKey()),
        ts:asMoney(r.ts)||Date.now(),
        status:r.status||'open',
        odds:asMoney(r.odds)||0,
        stake:asMoney(r.stake)||0,
        pnl:Number.isFinite(Number(r.pnl))?Number(r.pnl):0,
        source:r.source||'manual'
      }))
    };
  }catch{return fallback}
}
function saveSimState(){localStorage.setItem(SIM_KEY,JSON.stringify(simState));markLedgerChanged()}
function setLedgerStatus(text,good=false){const el=$('#ledgerStatus');if(el){el.textContent=text;el.style.color=good?'var(--mint)':''}}
function scheduleRemoteSave(delay=700){clearTimeout(remoteSaveTimer);remoteSaveTimer=setTimeout(()=>flushRemoteLedger(),delay)}
async function flushRemoteLedger(){
  if(!remoteLedgerReady) return false;
  const updatedAt=Number(localStorage.getItem(LEDGER_UPDATED_KEY))||Date.now();
  try{
    const res=await fetch('/api/ledger',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({state:simState,settings:simSettings,updatedAt,baseUpdatedAt:remoteUpdatedAt}),cache:'no-store'});
    if(res.status===403){
      remoteLedgerReady=false;
      setLedgerStatus('本机账本只读访问 · 当前请求不能保存');
      return false;
    }
    if(res.status===409){
      const data=await res.json(),remote=data?.ledger;
      if(remote?.state){
        const localRecords=Array.isArray(simState.records)?simState.records:[],remoteRecords=Array.isArray(remote.state.records)?remote.state.records:[];
        const localJournal=Array.isArray(simState.scanJournal)?simState.scanJournal:[];
        const remoteIds=new Set(remoteRecords.map(r=>r.id)),localOnly=localRecords.filter(r=>!remoteIds.has(r.id));
        ledgerBooting=true;simState={...remote.state,records:[...remoteRecords,...localOnly]};
        simState.scanJournal=mergeScanJournals(remote.state.scanJournal,localJournal);
        simState.balance=Number(remote.state.balance)||0;simState.balance+=localOnly.filter(r=>r.status!=='open').reduce((s,r)=>s+(Number(r.pnl)||0),0);
        simSettings=remote.settings||simSettings;cleanSimState();renderSimConfig();renderSimSummary();ledgerBooting=false;
        remoteUpdatedAt=Number(remote.updatedAt)||0;localStorage.setItem(LEDGER_UPDATED_KEY,String(Date.now()));scheduleRemoteSave(80);return false;
      }
    }
    if(!res.ok) throw new Error('save');
    remoteUpdatedAt=updatedAt;setLedgerStatus(`本机账本已同步 · ${new Date().toLocaleTimeString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'})}`,true);return true;
  }catch{setLedgerStatus('本机账本暂时不可用 · 已保存在浏览器缓存');return false}
}
async function syncRemoteLedger(){
  if(ledgerPolling)return;
  ledgerPolling=true;lastLedgerPollAt=Date.now();
  const localUpdatedAt=Number(localStorage.getItem(LEDGER_UPDATED_KEY))||0;
  let mergedDuringLoad=false;
  try{
    const res=await fetch('/api/ledger',{cache:'no-store'});if(!res.ok) throw new Error('load');
    const data=await res.json(),ledger=data?.ledger;
    if(ledger?.state&&Number(ledger.updatedAt||0)>localUpdatedAt){
      const localRecords=Array.isArray(simState.records)?simState.records:[],remoteRecords=Array.isArray(ledger.state.records)?ledger.state.records:[];
      const remoteIds=new Set(remoteRecords.map(r=>r.id)),localOnly=localRecords.filter(r=>!remoteIds.has(r.id));
      const journal=mergeScanJournals(ledger.state.scanJournal,simState.scanJournal);
      const remoteJournal=Array.isArray(ledger.state.scanJournal)?ledger.state.scanJournal:[];
      mergedDuringLoad=!!localOnly.length||journal.some(r=>Number(r.lastAt)>Number(remoteJournal.find(x=>x.day===r.day)?.lastAt||0));
      const mergedState={...ledger.state,records:[...remoteRecords,...localOnly],scanJournal:journal};
      mergedState.balance=Number(ledger.state.balance)||0;
      mergedState.balance+=localOnly.filter(r=>r.status!=='open').reduce((s,r)=>s+(Number(r.pnl)||0),0);
      ledgerBooting=true;
      localStorage.setItem(SIM_KEY,JSON.stringify(mergedState));
      if(ledger.settings)localStorage.setItem(SIM_SETTINGS_KEY,JSON.stringify(ledger.settings));
      localStorage.setItem(LEDGER_UPDATED_KEY,String(ledger.updatedAt));
      simSettings=loadSimSettings();simState=loadSimState();cleanSimState();renderSimConfig();renderSimSummary();ledgerBooting=false;
      if(mergedDuringLoad)localStorage.setItem(LEDGER_UPDATED_KEY,String(Date.now()));
    }
    remoteUpdatedAt=Number(ledger?.updatedAt||0);remoteLedgerReady=true;
    setLedgerStatus(ledger?'本机账本已连接':'本机账本已创建',true);
    if(!ledger||localUpdatedAt>remoteUpdatedAt||mergedDuringLoad)scheduleRemoteSave(50);
    reconcileOpenBets(true);
  }catch{remoteLedgerReady=false;setLedgerStatus('本机账本暂时不可用 · 使用浏览器缓存')}
  finally{ledgerPolling=false}
}
function cleanSimState(){
  if(!Array.isArray(simState.records)) simState.records=[];
  if(!Array.isArray(simState.scanJournal))simState.scanJournal=[];
  simState.scanJournal=simState.scanJournal.filter(r=>r?.day&&/^\d{4}-\d{2}-\d{2}$/.test(r.day)).slice(-30);
  simState.records=simState.records
    .map(r=>({...r,status:r.status||'open'}))
    .filter(r=>r.day && r.matchId);
  if(simState.records.length>3000) simState.records=simState.records.slice(-3000);
  if(!Number.isFinite(simState.balance)||simState.balance===null) simState.balance=simState.initialBalance;
  if(!Number.isFinite(simState.initialBalance)||simState.initialBalance===null) simState.initialBalance=10000;
  const day=todayKey();
  if(simState.day!==day){
    simState.day=day;
    simState.dayStartBalance=simState.balance;
  }
  if(!Number.isFinite(simState.dayStartBalance)||simState.dayStartBalance===null) simState.dayStartBalance=simState.balance;
  if(!Number.isFinite(Number(simState.portfolioStartAt)))simState.portfolioStartAt=0;
  if(!Array.isArray(simState.periodHistory))simState.periodHistory=[];
  saveSimState();
}
function currentPortfolioRecords(){return simState.records.filter(r=>Number(r.ts)>=Number(simState.portfolioStartAt||0))}
function simRecordsForDay(day){return currentPortfolioRecords().filter(r=>r.day===day)}
function simRecordsForBillingDay(day){return currentPortfolioRecords().filter(r=>billingDayKey(r.ts)===day)}
function settlementDay(r){return billingDayKey(r.settledAt||r.ts)}
function simSettledForDay(day){return currentPortfolioRecords().filter(r=>isSettledBet(r)&&settlementDay(r)===day)}
function openExposure(){return simState.records.filter(r=>r.status==='open'||r.status==='review').reduce((s,r)=>s+(Number(r.stake)||0),0)}
function availableBankroll(){return Math.max(0,simState.balance-openExposure())}
function hasBetForMatch(matchId){
  return simState.records.some(r=>String(r.matchId)===String(matchId));
}
function outcomeIndex(m){return m.hs>m.as?0:m.hs===m.as?1:2}
function outcomeLabel(idx){return idx===0?'主胜':idx===1?'平局':'客胜'}
function isSettledBet(r){return r?.status==='win'||r?.status==='loss'}
function bootstrapRoiBand(rows){
  if(rows.length<20)return null;
  let seed=(rows.length*2654435761+Math.round(rows.reduce((s,r)=>s+(Number(r.pnl)||0)*100,0)))>>>0;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
  const samples=[];
  for(let run=0;run<600;run++){let pnl=0,stake=0;for(let i=0;i<rows.length;i++){const r=rows[Math.floor(random()*rows.length)];pnl+=Number(r.pnl)||0;stake+=Number(r.stake)||0}samples.push(stake?pnl/stake:0)}
  samples.sort((a,b)=>a-b);return{low:samples[Math.floor(samples.length*.05)],median:samples[Math.floor(samples.length*.5)],high:samples[Math.floor(samples.length*.95)]};
}

function settleOpenBets(){
  if(simState.day!==todayKey()){simState.day=todayKey();simState.dayStartBalance=simState.balance}
  let changed=false;
  for(const rec of simState.records){
    if(rec.status!=='open') continue;
    const m=matches.find(x=>x.id===rec.matchId);
    if(!m || m.status!=='finished' || m.scoreConflict) continue;
    if(/(cancel|abandon)/i.test(m.statusDetail||'')){rec.status='void';rec.settledAt=Date.now();rec.finalScore='作废';rec.pnl=0;rec.note='模拟规则：赛事取消或终止，本笔作废，盈亏为零';changed=true;continue}
    if(/(postpon|suspend)/i.test(m.statusDetail||'')||m.scoreKnown===false){rec.note='比赛延期、暂停或比分缺失，等待赛果核验';changed=true;continue}
    if(Number(m.period||0)>2||/(AET|after extra time|penalt|shootout)/i.test(m.statusDetail||'')){rec.status='review';rec.finalScore=`${m.hs}—${m.as}`;rec.note='加时/点球后的公开比分不能直接用于常规时间 1X2 结算';changed=true;continue}
    const actual=outcomeIndex(m);
    const won=rec.pick===actual;
    rec.settledAt=Date.now();
    rec.status=won?'win':'loss';
    rec.finalScore=`${m.hs}—${m.as}`;
    rec.pnl=won?rec.stake*(rec.odds-1):-rec.stake;
    rec.brier=Math.pow((Number(rec.modelProbability)||0)-(won?1:0),2);
    simState.balance+=rec.pnl;
    changed=true;
  }
  if(changed) saveSimState();
}

async function reconcileOpenBets(force=false){
  const now=Date.now();
  if(reconcilingResults||(!force&&now-lastResultReconcileAt<300000)) return;
  lastResultReconcileAt=now;
  const items=simState.records.filter(r=>r.status==='open'&&r.matchId&&r.leagueCode).slice(0,30).map(r=>({id:r.matchId,league:r.leagueCode,kickoffAt:r.kickoffAt}));
  if(!items.length) return;
  reconcilingResults=true;
  try{
    const res=await fetch('/api/results',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items}),cache:'no-store'});
    if(!res.ok) throw new Error('results');
    const data=await res.json();let changed=0;
    if(simState.day!==todayKey()){simState.day=todayKey();simState.dayStartBalance=simState.balance}
    for(const result of data.results||[]){
      if(!result?.completed&&!result?.voided) continue;
      const actual=result.homeScore>result.awayScore?0:result.homeScore===result.awayScore?1:2;
      for(const rec of simState.records){
        if(rec.status!=='open'||String(rec.matchId)!==String(result.id)||rec.leagueCode!==result.league) continue;
        if(result.voided){rec.settledAt=Date.now();rec.status='void';rec.finalScore='作废';rec.pnl=0;changed++;continue}
        if(result.needsReview){rec.status='review';rec.finalScore=`${result.homeScore}—${result.awayScore}`;rec.note='加时/点球后的公开比分不能直接用于常规时间 1X2 结算';changed++;continue}
        const won=Number(rec.pick)===actual;
        rec.settledAt=Date.now();rec.status=won?'win':'loss';rec.finalScore=`${result.homeScore}—${result.awayScore}`;
        rec.pnl=won?Number(rec.stake)*(Number(rec.odds)-1):-Number(rec.stake);
        rec.brier=Math.pow((Number(rec.modelProbability)||0)-(won?1:0),2);
        const close=Number(result.closingOdds?.[rec.pick]);
        if(close>1&&rec.marketPhase!=='滚球'&&Number(result.closingCapturedAt)>0){rec.closingOdds=close;rec.closingProvider=result.closingProvider||'';rec.closingCapturedAt=result.closingCapturedAt;rec.closingPriceKind=result.closingPriceKind;if(rec.priceProvider&&rec.priceProvider===result.closingProvider)rec.clv=Number(rec.odds)/close-1}
        simState.balance+=rec.pnl;changed++;
      }
    }
    if(changed){saveSimState();renderSimSummary();toast(`已回查并补结算 ${changed} 笔模拟记录`)}
  }catch{/* 网络失败时保留待结算状态，下一轮再回查 */}
  finally{reconcilingResults=false}
}

function buildBetRecord({match,pick,odds,stake,mode='manual',source='manual',note=''}){
  const labels=['主胜','平局','客胜'];
  return{
    id:String(Date.now())+'-'+Math.random().toString(36).slice(2,7),
    day:todayKey(),
    ts:Date.now(),
    matchId:match.id,
    leagueCode:match.leagueCode,
    league:match.league,
    home:match.home.name,
    away:match.away.name,
    pick,
    pickLabel:labels[pick]||'未知',
    odds,
    stake,
    status:'open',
    sourceScore:`${match.hs}—${match.as}`,
    scoreAtBet:`${match.hs}—${match.as}`,
    pnl:0,
    source,
    priceProvider:match.odds?.provider||'',
    mode,
    strategy:note,
    strategyEdge:match.strategy?.edge||0,
    evidenceShift:match.model?.evidenceShift||0,
    marketPhase:match.status==='live'?'滚球':'赛前',
    priceKind:match.status==='live'?(match.odds?.liveVerified?'current':'未核验'):'公开赛前价',
    confidence:match.model?.confidence||0,
    modelProbability:match.strategy?.decisionProbability||[match.model?.home,match.model?.draw,match.model?.away][pick]||0,
    strategyVersion:'edge-v2.3-evidence-gated'
  };
}
function placeSimBet(){
  if(!selected){toast('先选择一场比赛');return}
  if(!simState.day||simState.day!==todayKey()) cleanSimState();
  const m=selected;
  if(m.status==='finished'){toast('完场比赛不能补录为模拟下注，避免污染统计');return}
  if(m.strategy?.signal!=='可以考虑'){toast('当前策略结论是不下注，不能写入模拟账本');return}
  if(hasBetForMatch(m.id)){toast('这场比赛已经记录过，不能重复下注');return}
  const pick=m.strategy?.best||0;
  const odds=Number(m.strategy?.marketOdds || m.odds?.decimals?.[pick] || 0);
  const stake=SIM_STAKE_DEFAULT;
  if(!Number.isFinite(odds)||odds<=1){toast('当前场次没有可用于模拟的有效赔率');return}
  if(!Number.isFinite(stake)||stake<=0){toast('请输入大于 0 的模拟金额');return}
  if(stake>availableBankroll()){toast(`可用模拟资金不足，当前最多 ${formatMoney(availableBankroll())} 元`);return}
  const quoteAt=Number(m.odds?.capturedAt||m.capturedAt||0);
  const quoteTime=Number.isFinite(quoteAt)&&quoteAt>0?new Date(quoteAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'来源未给出';
  const summary=`请核对虚拟记录：\n${m.home.name} 对 ${m.away.name}\n方向：${['主胜','平局','客胜'][pick]}；公开参考赔率：${odds.toFixed(2)}；金额：¥${stake}\n价格抓取：${quoteTime}；提供方：${m.odds?.bestProviders?.[pick]||m.odds?.provider||'未记录'}\n写入：旧版单场模拟账本。价格不保证可成交，提交后历史票据会保留。`;
  if(!window.confirm(summary))return;
  const rec=buildBetRecord({match:m,pick,odds,stake,mode:'manual',source:'manual',note:'手动按钮下单'});
  simState.records.push(rec);
  cleanSimState();
  settleOpenBets();
  renderSimSummary();
  toast(rec.status==='open'?`已记录模拟下注：${m.home.name} ${rec.pickLabel} @ ${odds.toFixed(2)}，金额 ${stake} 元`:`已模拟结算：${rec.pnl>=0?'+':''}${rec.pnl.toFixed(2)} 元`);
}

function assessAutoCandidate(m){
  const reject=reason=>({decision:null,reason});
  if(!m)return reject('赛事记录缺失');
  if(m.status==='finished')return reject('已完场，不能追溯下注');
  if(m.status==='unverified')return reject('源头直播状态与开赛时间矛盾');
  const health=feedHealth.get(m.leagueCode);
  if(quoteNeedsRefresh(m)||health?.status==='error')return reject('来源失联或报价超过 5 分钟未刷新');
  if(m.scoreConflict||Number(health?.conflicts)>0)return reject('比分源冲突');
  if(simSettings.autoRunLiveOnly && m.status!=='live')return reject('设置为仅直播模拟');
  if(!m.odds?.decimals?.some(Boolean))return reject('没有可验证的公开赔率');
  const age=dataAgeSeconds(m);
  if(m.status==='live'){
    const elapsed=(Date.now()-Number(new Date(m.date)))/60000;
    if(age>95)return reject('直播抓取超过 95 秒');
    if(Date.now()-Number(m.lastProgressAt||m.capturedAt||0)>180000)return reject('直播比分与时钟超过 3 分钟未推进');
    if(Number(m.sourceCount||0)<2)return reject('直播仅有一个 ESPN 端点');
    if(!m.odds?.liveVerified)return reject('没有明确 current 滚球赔率');
    if(!Number.isFinite(elapsed)||elapsed<-20||elapsed>Number(m.minute||0)+90)return reject('直播开赛时间与源头分钟不一致');
  }else{
    const until=(Number(new Date(m.date))-Date.now())/60000;
    if(age>300)return reject('赛前抓取超过 5 分钟');
    if(!Number.isFinite(until)||until<10||until>24*60)return reject('不在赛前 10 分钟至 24 小时窗口');
  }
  if(m.strategy?.signal!=='可以考虑')return reject(`策略未通过：${m.strategy?.signal||'尚无判断'}`);
  const edge=Math.max(-99,Number(m.strategy?.edge||-99));
  if(!Number.isFinite(edge) || edge < effectiveMinEdge())return reject('优势低于设定门槛');
  const pick=Number(m.strategy.best||0);
  const odds=Number(m.strategy?.marketOdds ?? m.odds?.decimals?.[pick] ?? 0);
  if(!Number.isFinite(odds)||odds<=1)return reject('没有有效的可计算赔率');
  return {decision:{pick,odds,edge,label:outcomeLabel(pick),marketLabel:(m.status==='live'?m.odds?.currentProviders?.[pick]:m.odds?.bestProviders?.[pick])||m.odds?.provider||'公开赔率',strategy:m.strategy?.action},reason:'通过数据与价格门槛'};
}
function effectiveMinEdge(){
  const settled=simState.records.filter(r=>r.source==='auto'&&isSettledBet(r)&&Number.isFinite(Number(r.strategyEdge))).slice(-200);
  if(settled.length<60) return simSettings.autoMinEdge;
  const split=Math.floor(settled.length/2),test=settled.slice(split);
  const testRoi=test.reduce((s,r)=>s+(Number(r.pnl)||0),0)/Math.max(1,test.reduce((s,r)=>s+(Number(r.stake)||0),0));
  const clvRows=test.filter(r=>Number.isFinite(Number(r.clv))),avgClv=clvRows.length>=20?clvRows.reduce((s,r)=>s+Number(r.clv),0)/clvRows.length:null;
  const scored=test.filter(r=>Number.isFinite(Number(r.brier))),avgBrier=scored.length?scored.reduce((s,r)=>s+Number(r.brier),0)/scored.length:null;
  const penalty=(testRoi < 0 ? .03 : testRoi < .02 ? .015 : 0)+(avgClv!==null&&avgClv < 0 ? .01 : 0)+(avgBrier!==null&&avgBrier > .25 ? .01 : 0);
  return clamp(simSettings.autoMinEdge+penalty,simSettings.autoMinEdge,0.25);
}
function calcAutoStake(){
  const free=availableBankroll();
  let stake=SIM_STAKE_DEFAULT;
  stake=Math.max(1,Math.floor(stake));
  const exposureRemaining=Math.max(0,simState.balance*(simSettings.maxExposurePct/100)-openExposure());
  const cap=Math.min(free*0.25,exposureRemaining);
  if(free<1||cap<1) return 0;
  if(stake>cap) stake=cap;
  return clamp(stake,1,cap);
}
function renderSimSummary(){
  const day=billingDayKey(),today=simRecordsForBillingDay(day);
  const visible=currentPortfolioRecords().filter(r=>billingDayKey(r.ts)===day||r.status==='open'||r.status==='review'||settlementDay(r)===day);
  const settled=simSettledForDay(day),voided=visible.filter(r=>r.status==='void'&&settlementDay(r)===day);
  const pnl=settled.reduce((s,r)=>s+(Number(r.pnl)||0),0);
  const wins=settled.filter(r=>r.pnl>0).length;
  const stakeUsed=today.reduce((s,r)=>s+(Number(r.stake)||0),0);
  const winRate=settled.length?Math.round(wins/settled.length*100):0;
  const currentRecords=currentPortfolioRecords(),allSettled=currentRecords.filter(isSettledBet);
  const allPnl=allSettled.reduce((s,r)=>s+(Number(r.pnl)||0),0);
  const historyDays=new Set(currentRecords.map(r=>billingDayKey(r.ts)).filter(Boolean)).size;
  const billStartBalance=simState.balance-pnl;
  if($('#simBalance')) $('#simBalance').textContent=`¥${formatMoney(simState.balance)}`;
  if($('#simAvailable')) $('#simAvailable').textContent=`¥${formatMoney(availableBankroll())}`;
  if($('#simExposure')) $('#simExposure').textContent=`¥${formatMoney(openExposure())}`;
  if($('#simTodayPnl')) $('#simTodayPnl').textContent=`${pnl>=0?'+':''}${formatMoney(pnl)} 元`;
  if($('#simWinRate')) $('#simWinRate').textContent=settled.length?`${winRate}%`:'—';
  const todayScan=simState.scanJournal?.find(r=>r.day===todayKey());
  if($('#simSummary')) $('#simSummary').textContent=visible.length?`本账单日新单 ${today.length} 场｜结算 ${settled.length} 场｜作废 ${voided.length} 场｜待核对 ${visible.filter(r=>r.status==='review').length} 场｜待结算 ${visible.filter(r=>r.status==='open').length} 场`:todayScan?`本日已扫描 ${todayScan.scans||1} 轮，本账单日尚无模拟单；原因见选赛审计`:'本账单日尚无模拟记录';
  if($('#simInitialBalanceText')) $('#simInitialBalanceText').textContent=`¥${formatMoney(simState.initialBalance)}`;
  if($('#simDayStartBalance')) $('#simDayStartBalance').textContent=`¥${formatMoney(billStartBalance)}`;
  if($('#simTodayStake')) $('#simTodayStake').textContent=`¥${formatMoney(stakeUsed)}`;
  if($('#simDayReturnRate')) $('#simDayReturnRate').textContent=billStartBalance?`${Math.round((pnl/billStartBalance)*10000)/100}%`:'—';
  if($('#simAllPnl')) $('#simAllPnl').textContent=`${allPnl>=0?'+':''}${formatMoney(allPnl)} 元`;
  if($('#simAllRoi')) $('#simAllRoi').textContent=simState.initialBalance?`${Math.round((allPnl/simState.initialBalance)*10000)/100}%`:'—';
  if($('#simHistoryDays')) $('#simHistoryDays').textContent=`${historyDays} 天`;
  renderProfitChart();
  renderStrategyAudit();
  if($('#simRecords')) $('#simRecords').innerHTML=visible.length?visible.slice().reverse().map(r=>{
    const mLabel=(r.source==='auto'?'[自动]':'[手动]')+(r.day!==day?`[${r.day} 下单]`:'');
    const stateText=r.status==='open'?'待结算':r.status==='review'?'待核对常规时间比分':r.status==='void'?'作废':(r.status==='win'?'命中':'未中');
    const pnlText=r.status==='open'||r.status==='review'?'—':`${r.pnl>=0?'+':''}${formatMoney(r.pnl)} 元`;
    const strategy=r.strategy||r.note||'按页面当时的模型与价格信号记录';
    return `<div class="event"><time>${new Date(r.ts).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Asia/Shanghai'})}</time><span><b>${mLabel} ${esc(r.home)} v ${esc(r.away)}</b><br>${esc(r.pickLabel)} @ ${Number(r.odds).toFixed(2)} ｜ 金额 ¥${formatMoney(r.stake)} ｜ 下单比分 ${esc(r.scoreAtBet||'—')}<br><small>策略：${esc(strategy)}</small>${r.status==='review'?`<br><small>${esc(r.note||'结算规则待核对')}</small>`:''}<br>${stateText} ｜ ${pnlText}</span><em>${esc(r.status)}</em></div>`;
  }).join(''):'<div class="panel-copy">今日暂无模拟记录</div>';
  if($('#scanJournal'))$('#scanJournal').innerHTML=simState.scanJournal?.length?simState.scanJournal.slice(-14).reverse().map(r=>`<div class="daily-row"><span>${esc(r.day.slice(5))} · ${Number(r.scans)||0} 轮</span><span>最多 ${Number(r.maxEligible)||0} 场候选 · ${Number(r.bets)||0} 注模拟<br><small>最近来源：${r.lastSource==='server'?'后台服务端':r.lastSource==='browser'?'当前页面':'早期记录'} · ${Number(r.lastAt)?new Date(Number(r.lastAt)).toLocaleString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'}):'时间未知'}<br>${esc(r.lastReason||'暂无可执行候选')}</small></span><b>${Number(r.bets)||0} 注</b></div>`).join(''):'<div class="panel-copy">尚无每日选赛审计记录</div>';
  if($('#simStakeLabel')) $('#simStakeLabel').textContent=$('#simStake')?.value||'0';
  if($('#simInitialBalanceLabel')) $('#simInitialBalanceLabel').textContent=formatMoney(simState.initialBalance);
}
function renderStrategyAudit(){
  const settled=currentPortfolioRecords().filter(isSettledBet).slice().sort((a,b)=>Number(a.settledAt||a.ts)-Number(b.settledAt||b.ts));
  const gains=settled.filter(r=>Number(r.pnl)>0).reduce((s,r)=>s+Number(r.pnl),0),losses=Math.abs(settled.filter(r=>Number(r.pnl)<0).reduce((s,r)=>s+Number(r.pnl),0));
  let equity=simState.initialBalance,peak=equity,maxDrawdown=0;
  for(const r of settled){equity+=Number(r.pnl)||0;peak=Math.max(peak,equity);if(peak>0)maxDrawdown=Math.max(maxDrawdown,(peak-equity)/peak)}
  const scored=settled.filter(r=>Number.isFinite(Number(r.brier))),brier=scored.length?scored.reduce((s,r)=>s+Number(r.brier),0)/scored.length:null;
  const clvRows=settled.filter(r=>Number.isFinite(Number(r.clv))),avgClv=clvRows.length?clvRows.reduce((s,r)=>s+Number(r.clv),0)/clvRows.length:null;
  const roiBand=bootstrapRoiBand(settled);
  if($('#auditSample'))$('#auditSample').textContent=`${settled.length} 注`;
  if($('#auditProfitFactor'))$('#auditProfitFactor').textContent=losses?`${(gains/losses).toFixed(2)}`:(gains?'∞':'—');
  if($('#auditDrawdown'))$('#auditDrawdown').textContent=`${(maxDrawdown*100).toFixed(1)}%`;
  if($('#auditBrier'))$('#auditBrier').textContent=brier===null?'—':brier.toFixed(3);
  if($('#auditClv'))$('#auditClv').textContent=avgClv===null?'—':`${avgClv>=0?'+':''}${(avgClv*100).toFixed(2)}%`;
  if($('#auditRoiBand'))$('#auditRoiBand').textContent=roiBand?`${(roiBand.low*100).toFixed(1)}% ～ ${(roiBand.high*100).toFixed(1)}%`:'至少 20 注';
  if($('#auditThreshold'))$('#auditThreshold').textContent=toPercent(effectiveMinEdge());
  const recent=settled.slice(-200),split=Math.floor(recent.length/2),train=recent.slice(0,split),test=recent.slice(split);
  const roiOf=rows=>rows.length?rows.reduce((s,r)=>s+(Number(r.pnl)||0),0)/Math.max(1,rows.reduce((s,r)=>s+(Number(r.stake)||0),0)):null;
  const trainRoi=roiOf(train),testRoi=roiOf(test);
  const validation=recent.length<60?'样本不足':(trainRoi>0&&testRoi>0&&roiBand?.low>0?'双阶段较稳':trainRoi>0&&testRoi>0?'双阶段为正':testRoi>0?'仅近期为正':'未通过');
  if($('#auditTrainRoi'))$('#auditTrainRoi').textContent=trainRoi===null?'—':`${(trainRoi*100).toFixed(1)}%`;
  if($('#auditTestRoi'))$('#auditTestRoi').textContent=testRoi===null?'—':`${(testRoi*100).toFixed(1)}%`;
  if($('#auditConfidence'))$('#auditConfidence').textContent=validation;
  const defs=[['优势 5–8%',r=>r.strategyEdge>=.05&&r.strategyEdge<.08],['优势 8–12%',r=>r.strategyEdge>=.08&&r.strategyEdge<.12],['优势 ≥12%',r=>r.strategyEdge>=.12],['滚球 current',r=>r.marketPhase==='滚球'&&r.priceKind==='current'],['赛前公开价',r=>r.marketPhase==='赛前'],['主胜',r=>r.pick===0],['平局',r=>r.pick===1],['客胜',r=>r.pick===2]];
  if($('#strategyBuckets'))$('#strategyBuckets').innerHTML=defs.map(([label,test])=>{
    const rows=settled.filter(test),stake=rows.reduce((s,r)=>s+(Number(r.stake)||0),0),pnl=rows.reduce((s,r)=>s+(Number(r.pnl)||0),0),roi=stake?pnl/stake:0;
    return `<div class="daily-row"><span>${label}</span><span>${rows.length} 注 · ROI ${(roi*100).toFixed(1)}%</span><b class="${pnl>=0?'positive':'negative'}">${pnl>=0?'+':''}${formatMoney(pnl)}</b></div>`;
  }).join('');
  const versions=[...new Set(settled.map(r=>r.strategyVersion||'早期未标记'))].slice(-8);
  if($('#strategyVersions'))$('#strategyVersions').innerHTML=versions.map(version=>{
    const rows=settled.filter(r=>(r.strategyVersion||'早期未标记')===version),stake=rows.reduce((s,r)=>s+(Number(r.stake)||0),0),pnl=rows.reduce((s,r)=>s+(Number(r.pnl)||0),0),roi=stake?pnl/stake:0;
    const scoredRows=rows.filter(r=>Number.isFinite(Number(r.brier))),versionBrier=scoredRows.length?scoredRows.reduce((s,r)=>s+Number(r.brier),0)/scoredRows.length:null;
    const priced=rows.filter(r=>Number.isFinite(Number(r.clv))),versionClv=priced.length?priced.reduce((s,r)=>s+Number(r.clv),0)/priced.length:null;
    return `<div class="daily-row"><span>${esc(version)}</span><span>${rows.length} 注 · ROI ${(roi*100).toFixed(1)}%${versionBrier===null?'':` · Brier ${versionBrier.toFixed(3)}`}${versionClv===null?'':` · CLV ${versionClv>=0?'+':''}${(versionClv*100).toFixed(2)}%`}</span><b class="${pnl>=0?'positive':'negative'}">${pnl>=0?'+':''}${formatMoney(pnl)}</b></div>`;
  }).join('');
  if($('#auditConclusion'))$('#auditConclusion').textContent=settled.length<60?`当前 ${settled.length}/60 注：样本不足，维持人工设定门槛，不做参数放宽。`:(validation==='双阶段较稳'?'前后两段为正且重采样区间下沿高于 0；仍不代表未来盈利，继续监控 CLV 与回撤。':`样本外或置信区间尚未稳定通过，自动门槛已收紧至 ${toPercent(effectiveMinEdge())}。`);
}
function exportLedgerCsv(){
  const header=['日期','时间','联赛','主队','客队','下注','下注赔率','收盘赔率','CLV','金额','下注比分','完场比分','市场阶段','价格类型','模型-盘口概率差异','状态','盈亏','策略优势','模型概率','数据覆盖评分','策略版本','策略说明'];
  const esc=v=>`"${String(v??'').replaceAll('"','""')}"`;
  const rows=simState.records.map(r=>[r.day,new Date(r.ts).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),r.league,r.home,r.away,r.pickLabel,r.odds,r.closingOdds,r.clv,r.stake,r.scoreAtBet,r.finalScore,r.marketPhase,r.priceKind,r.evidenceShift,r.status,r.pnl,r.strategyEdge,r.modelProbability,r.confidence,r.strategyVersion,r.strategy].map(esc).join(','));
  const blob=new Blob(['\ufeff'+[header.map(esc).join(','),...rows].join('\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`edge-sim-ledger-${todayKey()}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function renderProfitChart(){
  const svg=$('#profitChart'),line=$('#profitLine'),area=$('#profitArea'),grid=$('#profitGrid'),labels=$('#profitLabels'),note=$('#profitChartNote'),table=$('#dailyPerformance');
  if(!svg||!line||!area||!grid||!labels||!note||!table) return;
  const settled=currentPortfolioRecords().filter(isSettledBet).slice().sort((a,b)=>Number(a.settledAt||a.ts)-Number(b.settledAt||b.ts));
  const byDay=new Map();
  for(const r of settled){
    const d=settlementDay(r)||todayKey(),v=byDay.get(d)||{day:d,pnl:0,stake:0,wins:0,losses:0,count:0};
    v.pnl+=Number(r.pnl)||0;v.stake+=Number(r.stake)||0;v.count++;if(r.status==='win')v.wins++;else v.losses++;byDay.set(d,v);
  }
  const allDays=[...byDay.values()].sort((a,b)=>a.day.localeCompare(b.day)),days=allDays.slice(-14);
  if(!days.length){line.setAttribute('d','');area.setAttribute('d','');grid.innerHTML='';labels.innerHTML='';table.innerHTML='';note.textContent='等待已结算记录生成曲线';return}
  let cumulative=simState.initialBalance+allDays.slice(0,Math.max(0,allDays.length-14)).reduce((sum,day)=>sum+day.pnl,0);
  const values=[cumulative,...days.map(d=>(cumulative+=d.pnl))];
  let min=Math.min(...values),max=Math.max(...values);const spread=Math.max(1,max-min);min-=spread*.18;max+=spread*.18;
  const W=600,H=190,L=34,R=14,T=18,B=30,x=i=>L+i*(W-L-R)/Math.max(1,values.length-1),y=v=>T+(max-v)*(H-T-B)/(max-min);
  const pts=values.map((v,i)=>[x(i),y(v)]),path=pts.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  line.setAttribute('d',path);area.setAttribute('d',`${path} L${pts.at(-1)[0].toFixed(1)},${H-B} L${pts[0][0].toFixed(1)},${H-B} Z`);
  const ticks=[min,(min+max)/2,max];
  grid.innerHTML=ticks.map(v=>`<line class="profit-grid" x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}"></line>`).join('');
  labels.innerHTML=ticks.map(v=>`<text class="profit-label" x="4" y="${y(v)+4}">${Math.round(v)}</text>`).join('')+days.map((d,i)=>i===0||i===days.length-1?`<text class="profit-label" x="${x(i+1)}" y="${H-8}" text-anchor="${i===0?'start':'end'}">${d.day.slice(5)}</text>`:'').join('');
  const totalPnl=days.reduce((s,d)=>s+d.pnl,0),peak=Math.max(...values),last=values.at(-1),drawdown=peak?Math.max(0,(peak-last)/peak):0;
  const scored=settled.filter(r=>Number.isFinite(Number(r.brier))),brier=scored.length?scored.reduce((s,r)=>s+Number(r.brier),0)/scored.length:null;
  note.textContent=`最近 ${days.length} 个账单日（每天 08:00 切账）｜区间盈亏 ${totalPnl>=0?'+':''}${formatMoney(totalPnl)} 元｜当前回撤 ${(drawdown*100).toFixed(1)}%${brier===null?'':`｜Brier ${brier.toFixed(3)}`}`;
  table.innerHTML=days.slice().reverse().map(d=>`<div class="daily-row"><span>${d.day.slice(5)}</span><span>${d.count} 注 · ${d.wins}胜${d.losses}负 · 投入 ¥${formatMoney(d.stake)}</span><b class="${d.pnl>=0?'positive':'negative'}">${d.pnl>=0?'+':''}${formatMoney(d.pnl)}</b></div>`).join('');
}
function renderSimConfig(){
  if(!$('#simAutoEnabled')) return;
  $('#simAutoEnabled').checked=!!simSettings.autoEnabled;
  $('#simAutoEnabled').disabled=true;
  $('#simAutoMode').value=simSettings.mode;
  $('#simAutoStake').value=String(simSettings.autoStake);
  $('#simAutoStakePct').value=String(simSettings.autoStakePct);
  $('#simAutoMinEdge').value=String(simSettings.autoMinEdge*100);
  $('#simAutoMaxBets').value=String(simSettings.autoMaxBets);
  $('#simDailyStopLoss').value=String(simSettings.dailyStopLossPct);
  $('#simMaxExposure').value=String(simSettings.maxExposurePct);
  $('#simAutoLiveOnly').checked=simSettings.autoRunLiveOnly!==false;
  $('#simAutoStakeLabel').textContent=String(simSettings.autoStake);
  $('#simAutoStakePctLabel').textContent=String(simSettings.autoStakePct);
  $('#simAutoMinEdgeLabel').textContent=String(simSettings.autoMinEdge*100);
  $('#simInitialBalance').value=String(simState.initialBalance);
  $('#simInitialBalanceLabel').textContent=formatMoney(simState.initialBalance);
  const history=$('#simPeriodHistory');
  if(history){
    const periods=Array.isArray(simState.periodHistory)?simState.periodHistory:[];
    history.textContent=periods.length?periods.map(item=>{
      const started=Number(item?.startedAt),stamp=Number.isFinite(started)&&started>0?new Date(started).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'时间未知';
      return `${String(item?.id||'编号缺失')} · ${stamp} · 起始 ¥${formatMoney(item?.initialBalance)} · 前周期结束 ¥${formatMoney(item?.previousBalance)} · 前周期 ${Number(item?.previousTicketCount)||0} 张票`;
    }).join('\n'):Number(simState.portfolioStartAt)>0?'现有周期起点已保存；更早的重置记录不存在，不能补造周期编号。':'尚未开始新资金周期。';
  }
  if($('#simAutoSummary')){
    $('#simAutoSummary').textContent='旧版单场自动出票暂停；此处仅保留历史设置和只读候选观察。十策略状态请到“模拟与统计”核对。';
  }
  renderAutoScan();
}
function renderAutoScan(){
  const out=$('#simAutoScan');if(!out)return;
  const active=matches.filter(m=>m.status!=='finished');
  const reasons=new Map(),eligible=[];
  const today=simRecordsForDay(todayKey()),todayAuto=today.filter(r=>r.source==='auto');
  const todayPnl=simSettledForDay(todayKey()).reduce((s,r)=>s+(Number(r.pnl)||0),0);
  const riskStop=todayAuto.length>=Math.min(3,simSettings.autoMaxBets)?'已达每日模拟上限':todayPnl<=-simState.dayStartBalance*(simSettings.dailyStopLossPct/100)?'已触发单日止损':availableBankroll()<1||calcAutoStake()<1?'资金或敞口上限不足':'';
  for(const m of active){
    const result=assessAutoCandidate(m);
    const reason=hasBetForMatch(m.id)?'该赛事已经模拟下注':result.decision&&riskStop?riskStop:result.reason;
    if(result.decision&&!hasBetForMatch(m.id)&&!riskStop)eligible.push({match:m,decision:result.decision});
    else reasons.set(reason,(reasons.get(reason)||0)+1);
  }
  const top=[...reasons.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([reason,count])=>`${reason} ${count} 场`).join(' · ');
  const picks=eligible.sort((a,b)=>b.decision.edge-a.decision.edge).slice(0,3).map(({match,decision})=>`${match.home.name}–${match.away.name} ${decision.label} @${decision.odds.toFixed(2)}（优势 ${(decision.edge*100).toFixed(1)}%）`).join('；');
  out.textContent=`当前页面已载入 ${matches.length} 场、未完赛 ${active.length} 场；其中 ${eligible.length} 场满足旧版只读观察条件，自动写入暂停。${picks?`观察候选：${picks}。`:''}${top?`其他未入组原因：${top}。`:''}`;
}
function recordScanJournal(placed){
  const day=todayKey(),now=Date.now(),active=matches.filter(m=>m.status!=='finished');
  const tallies=new Map();let eligible=0;
  for(const m of active){
    const result=assessAutoCandidate(m);
    if(result.decision&&!hasBetForMatch(m.id))eligible++;
    else{
      const reason=hasBetForMatch(m.id)?'该赛事已模拟下注':result.reason;
      tallies.set(reason,(tallies.get(reason)||0)+1);
    }
  }
  const reason=[...tallies.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([label,count])=>`${label} ${count} 场`).join(' · ')||'暂无暂停原因';
  const prior=simState.scanJournal.find(r=>r.day===day);
  const entry=prior||{day,scans:0,bets:0,maxEligible:0,persistedAt:0};
  entry.scans++;entry.bets+=placed;entry.lastAt=now;entry.monitored=matches.length;entry.live=matches.filter(m=>m.status==='live').length;
  entry.maxEligible=Math.max(Number(entry.maxEligible)||0,eligible+placed);entry.lastReason=reason;entry.lastSource='browser';
  if(!prior)simState.scanJournal.push(entry);
  simState.scanJournal=simState.scanJournal.slice(-30);
  if(!prior||placed||now-Number(entry.persistedAt||0)>=15*60_000){entry.persistedAt=now;saveSimState()}
  renderSimSummary();
}
function updateSimConfigFromUI(){
  simSettings.autoEnabled=$('#simAutoEnabled')?.checked||false;
  simSettings.autoStake=SIM_STAKE_DEFAULT;
  simSettings.autoMinEdge=clamp01(parseFloatInput($('#simAutoMinEdge')?.value,simSettings.autoMinEdge*100)/100,0,1);
  simSettings.autoStakePct=clamp01(parseFloatInput($('#simAutoStakePct')?.value,simSettings.autoStakePct),0.1,100);
  simSettings.autoRunLiveOnly=$('#simAutoLiveOnly')?.checked!==false;
  simSettings.mode='fixed';
  simSettings.autoMaxBets=Math.round(clamp01(parseFloatInput($('#simAutoMaxBets')?.value,simSettings.autoMaxBets),1,50));
  simSettings.dailyStopLossPct=clamp01(parseFloatInput($('#simDailyStopLoss')?.value,simSettings.dailyStopLossPct),.5,20);
  simSettings.maxExposurePct=clamp01(parseFloatInput($('#simMaxExposure')?.value,simSettings.maxExposurePct),1,30);
  saveSimSettings();
  renderSimConfig();
  renderSimSummary();
}

function extractMinute(value){
  const matched=String(value||'').match(/(\d{1,3})(?:\+(\d{1,2}))?/);
  if(!matched) return 0;
  return Number(matched[1])+Number(matched[2]||0);
}
function extractClockSeconds(clockText,minute){
  const matched=String(clockText||'').match(/(\d{1,3})(?:\+(\d{1,2}))?/);
  if(!matched) return Number(minute||0)*60;
  return Number(matched[1])*60+Number(matched[2]||0)*60;
}
function detectStatus(state,clockText,detail,completed){
  if(completed) return 'finished';
  if(state==='in') return 'live';
  if(state==='post') return 'finished';
  if(state==='pre') return 'soon';
  if(/(FT|AET|PEN|HT|结束|结束中|完场|已结束|终场)/i.test(String(detail||'')+String(clockText||''))) return 'finished';
  if(/\d/.test(clockText||'')) return 'live';
  return 'soon';
}

function modelFor(m){
  const modelPrices=m.status==='live'?m.odds?.currentDecimals:m.odds?.decimals;
  const hasMarketOdds=!!modelPrices?.every(value=>Number.isFinite(value)&&value>1);
  const marketProbs=hasMarketOdds?normalizeProb(modelPrices.map(x=>1/x)):[.41,.28,.31];
  let probs=marketProbs.slice();
  let [home,draw,away]=probs;const formDelta=clamp((m.home.formPoints-m.away.formPoints)*.025,-.08,.08);home+=formDelta;away-=formDelta;
  if(m.status==='live'){
    const timeWeight=clamp(m.minute/90,.08,1);const scoreDelta=m.hs-m.as;const paired=(key,weight)=>Number.isFinite(m.home[key])&&Number.isFinite(m.away[key])?(m.home[key]-m.away[key])*weight:0;const shotDelta=paired('sot',.022)+paired('shots',.006)+paired('possession',.0015);
    const liveDelta=clamp(scoreDelta*(.10+.25*timeWeight)+shotDelta,-.42,.42);home+=liveDelta;away-=liveDelta;draw-=Math.abs(scoreDelta)*(.04+.11*timeWeight);
  }
  if(m.status==='finished'){home=m.hs>m.as?1:0;draw=m.hs===m.as?1:0;away=m.hs<m.as?1:0}
  const normalized=normalizeProb([home,draw,away]);
  const evidenceShift=Math.max(...normalized.map((p,index)=>Math.abs(p-marketProbs[index])));
  const covered=['shots','sot','possession'].reduce((sum,key)=>sum+Number(Number.isFinite(m.home[key])&&Number.isFinite(m.away[key])),0)+Number(!!modelPrices?.every(v=>Number.isFinite(v)&&v>1))+Number(!!(m.home.form&&m.away.form));
  const confidence=Math.round(covered/5*100);
  return{home:normalized[0],draw:normalized[1],away:normalized[2],marketHome:marketProbs[0],marketDraw:marketProbs[1],marketAway:marketProbs[2],evidenceShift,confidence,hasMarketOdds};
}
function dataAgeSeconds(m){return Math.max(0,Math.floor((Date.now()-Number(m.capturedAt||0))/1000))}
function quoteNeedsRefresh(m){return !!m.feedStale||m.status==='soon'&&dataAgeSeconds(m)>300}
function normalHalftime(m,now=Date.now()){
  const elapsed=(now-Number(new Date(m.date)))/60000;
  return m.status==='live'&&/^(?:HT|Half[- ]?Time|Halftime)$/i.test(String(m.statusDetail||'').trim())
    &&Number.isFinite(elapsed)&&elapsed>=35&&elapsed<=85&&dataAgeSeconds(m)<=90
    &&now-Number(m.lastProgressAt||m.capturedAt||0)<=25*60000;
}
function kickoffUnconfirmed(m,now=Date.now()){
  return m.status==='soon'&&Number.isFinite(Number(new Date(m.date)))&&now>=Number(new Date(m.date))&&!/(cancel|abandon|postpon|suspend)/i.test(m.statusDetail||'');
}
function needsLiveScan(m,now=Date.now()){
  const elapsed=now-Number(new Date(m.date));
  return m.status==='live'||m.status==='unverified'||(m.status==='soon'&&elapsed>=-15*60000&&elapsed<6*3600000);
}
function displayedScore(m,side){
  if(m.officialOnlyFinal||m.official?.state==='live'&&Date.now()-Number(m.official.capturedAt)<90000){
    const officialValue=Number(m[side]);return Number.isInteger(officialValue)&&officialValue>=0?officialValue:'—';
  }
  if(m.provisionalLead&&!m.feedStale&&m.status!=='unverified'&&m.scoreKnown&&dataAgeSeconds(m)<=90&&(Date.now()-Number(m.lastProgressAt||m.capturedAt||0)<=180000||normalHalftime(m))){
    const provisional=Number(m[side]);return Number.isInteger(provisional)&&provisional>=0?provisional:'—';
  }
  // A finished score is a fact, not a live observation: staleness must
  // never hide it. Only conflicting/unknown finals stay hidden.
  if(m.status==='finished'&&m.scoreKnown&&!m.scoreConflict){const final=Number(m[side]);return Number.isInteger(final)&&final>=0?final:'—';}
  // Unknown, stale, contradictory and regressed observations are not live scores.
  if(m.status==='soon'||m.scoreKnown===false||m.feedStale||m.scoreConflict||m.status==='unverified'||m.status==='live'&&Date.now()-Number(m.lastProgressAt||m.capturedAt||0)>180000&&!normalHalftime(m))return '—';
  const value=Number(m[side]);return Number.isInteger(value)&&value>=0?value:'—';
}
function officialLabel(m){return m.official?.provider==='AFC official match report'?'亚足联官方赛报':'J.LEAGUE 官方'}
function scoreObservationWarning(m){
  if(m.status==='soon'||m.scoreKnown===false)return kickoffUnconfirmed(m)?'来源仍报未开赛；不显示预设 0:0':'来源尚无可显示比分';
  const asOf=Number(m.capturedAt)?new Date(m.capturedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'时间未知';
  if(m.officialOnlyFinal)return `${officialLabel(m)}完场 ${asOf} · ESPN 待核验，未计入盈亏`;
  if(m.feedStale)return `上次记录 ${asOf} · 非实时比分（${m.hs}—${m.as} 仅供回溯）`;
 if(m.scoreConflict)return m.provisionalLead?`两 ESPN 端点不同：显示推进较前的临时记录 ${m.hs}—${m.as}；非独立核实，暂停模拟`:`两源或新旧记录冲突 · ${asOf} 抓取，比分待核验`;
  if(m.clockConflict)return `两条 ESPN 通道比分相同、比赛分钟不同 · 显示较新记录 ${m.hs}—${m.as} 为临时参考，暂停滚球模拟`;
  if(m.status==='unverified')return `上次记录 ${asOf} · 比赛状态待核验`;
  if(normalHalftime(m))return `中场时钟正常暂停 · ESPN 最近比分 ${m.hs}—${m.as}，源头更新时间未知`;
 if(m.status==='live'&&!m.official&&Date.now()-Number(m.lastProgressAt||m.capturedAt||0)>180000)return `源头比分/分钟超过3分钟未推进 · 最后记录 ${m.hs}—${m.as}，非实时`;
  if(m.status==='live'&&!m.official&&Number(m.sourceCount||0)<2)return `仅一个 ESPN 通道报 ${m.hs}—${m.as} · 未独立核实`;
  return '';
}
function strategyFor(m){
  if(normalHalftime(m))return{signal:'中场暂停',headline:'中场比分可看，暂不生成滚球模拟下注',reason:'ESPN 中场时钟正常停在 45 分钟；页面展示最近比分但没有可核实的当下滚球价格，等待下半场状态与价格同步。',best:0,fair:0,edge:0,action:'暂停模拟',minOdds:'—',stakePct:'0%',cancel:'下半场时钟与赔率核实后再评估',marketOdds:null};
  if(kickoffUnconfirmed(m))return{signal:'开赛状态待核验',headline:'暂停模拟｜已到开球时间，来源仍显示未开赛',reason:'接口连接成功，但来源尚未确认现场状态。可能存在数据延迟或赛程变更；不把预设 0 比 0 当成现场比分，不按经过时间编造分钟。',best:0,fair:0,edge:0,action:'暂停模拟',minOdds:'—',stakePct:'0%',cancel:'取得有效现场状态后重新评估',marketOdds:null};
  if(/(cancel|abandon|postpon|suspend)/i.test(m.statusDetail||'')||((m.status==='live'||m.status==='finished')&&m.scoreKnown===false))return{signal:'赛果待核验',headline:'暂停模拟｜赛程异常或比分缺失',reason:'赛事取消、终止、延期、暂停或缺少明确比分，等待有效赛事数据。',best:0,fair:0,edge:0,action:'暂停模拟',minOdds:'—',stakePct:'0%',cancel:'赛事状态与比分恢复有效前不模拟',marketOdds:null};
  const labels=['主胜','平局','客胜'],teams=[m.home.name,'平局',m.away.name],probs=[m.model.home,m.model.draw,m.model.away];
  const bestPrediction=probs.indexOf(Math.max(...probs));const fair=1/probs[bestPrediction];
  if(quoteNeedsRefresh(m)){
    return{signal:'来源失联',headline:'暂停模拟｜该联赛报价待刷新',reason:'该联赛抓取失败或上次同步已超过 5 分钟，显示的比分、时间及赔率可能已变化；恢复同步前不产生模拟单。',best:bestPrediction,fair,edge:0,action:'暂停模拟',minOdds:'—',stakePct:'0%',cancel:'联赛端点恢复成功同步前，不下注',marketOdds:null};
  }
  if(m.status==='finished'){
    return{signal:'完场复盘',headline:'不下注｜比赛已经结束',reason:`模型只用于复盘：${m.home.name} ${m.hs}—${m.as} ${m.away.name}。`,best:bestPrediction,fair,edge:0,action:'不下注',minOdds:'—',stakePct:'0%',cancel:'比赛已结束',marketOdds:null};
  }
  if(m.status==='unverified'){
    return{signal:'时间源异常',headline:'暂停模拟｜直播状态与源头开赛时间矛盾',reason:`ESPN 仍返回“${m.clock||m.statusDetail||'进行中'}”，但按公开开赛时间推算比赛已经进行了远超过该分钟所允许的时长；不把这条旧状态算作实时直播，也不补记模拟单。`,best:bestPrediction,fair,edge:0,action:'暂停模拟',minOdds:'—',stakePct:'0%',cancel:'源头状态与开赛时间重新一致前不模拟',marketOdds:null};
  }
  if(m.scoreConflict||m.clockConflict){
    const onlyClock=m.clockConflict&&!m.scoreConflict;
    const observations=(m.sourceObservations||[]).map(item=>`${item.endpoint||'ESPN 通道'}：${item.state==='pre'?'未开赛':item.state==='in'?'进行中':item.state==='post'?'完场':'状态未知'} ${item.home??'—'}—${item.away??'—'}，${Number.isFinite(Number(item.clock))?Math.floor(Number(item.clock)/60)+'′':'分钟未知'}`).join('；');
    return{signal:onlyClock?'分钟源差异':'比赛状态/比分冲突',headline:onlyClock?'暂停模拟｜ESPN 比赛分钟有差异':'暂停模拟｜ESPN 比分或状态尚未同步',reason:`${observations||'两条 ESPN 通道给出的比赛状态或比分不同'}。${onlyClock?'两条比分相同，差异是比赛分钟；':''}两条通道来自同一供稿商，并非两个独立比分员；${m.provisionalLead?'页面会标注较新记录为临时参考，但':''}冲突期间不把比分和赔率当成已核实数据。`,best:bestPrediction,fair,edge:0,action:'暂停模拟',minOdds:'—',stakePct:'0%',cancel:'现场状态、比分与可用价格核实后再评估',marketOdds:null};
  }
  if(m.status==='live'&&Number(m.sourceCount||0)<2){
    return{signal:'单源直播',headline:'暂停模拟｜直播只有一个比分通道',reason:'目前只有一个 ESPN 公开端点返回这场现场比分；尚无法交叉核对比分与分钟。即使两个 ESPN 端点都返回，它们也不是两个独立供稿商。',best:bestPrediction,fair,edge:0,action:'暂停模拟',minOdds:'—',stakePct:'0%',cancel:'取得可核对的第二通道前不下注',marketOdds:null};
  }
  if(m.status==='live'){
    const elapsed=(Date.now()-Number(new Date(m.date)))/60000;
    if(!m.clock&&!Number(m.minute||0)){
      return{signal:'分钟未提供',headline:'暂停模拟｜比分源未给比赛分钟',reason:'不能仅凭开赛时间推算现场分钟；等待源头返回可核验的比赛时钟。',best:bestPrediction,fair,edge:0,action:'暂停模拟',minOdds:'—',stakePct:'0%',cancel:'取得比赛时钟后再判断',marketOdds:null};
    }
    if(!Number.isFinite(elapsed)||elapsed<-20||elapsed>Number(m.minute||0)+90){
      return{signal:'时间源异常',headline:'暂停模拟｜开赛时间与直播分钟不一致',reason:'公开开赛时间推算出的经过时间与比分端点显示的分钟相差过大；先核验时间源，不按疑似错误的现场直播下注。',best:bestPrediction,fair,edge:0,action:'暂停模拟',minOdds:'—',stakePct:'0%',cancel:'时间源恢复一致前不下注',marketOdds:null};
    }
  }
  if(m.status==='live'&&dataAgeSeconds(m)>90){
    return{signal:'数据过期',headline:'暂停下注｜等待分数重新同步',reason:`这场直播数据已超过 90 秒没有成功更新，不能据此作决定。`,best:bestPrediction,fair,edge:0,action:'暂停下注',minOdds:'—',stakePct:'0%',cancel:'刷新成功且时间戳恢复正常前，不下注',marketOdds:null};
  }
  if(m.status==='live'&&Date.now()-Number(m.lastProgressAt||m.capturedAt||0)>180000){
    return{signal:'直播未推进',headline:'暂停模拟｜比分源时钟超过 3 分钟未推进',reason:'端点持续返回成功，但这场比赛的比分、分钟与状态一直不变；新的抓取时间不能证明现场数据已经更新。',best:bestPrediction,fair,edge:0,action:'暂停模拟',minOdds:'—',stakePct:'0%',cancel:'源头比赛分钟或状态恢复推进前不下注',marketOdds:null};
  }
  if(m.status==='live'&&m.odds?.decimals?.some(Boolean)&&!m.odds.liveVerified){
    return{signal:'非滚球价格',headline:'暂停模拟｜该价格未证实为实时滚球',reason:'提供方只返回 open/close 最近公开价，没有返回明确的 current 滚球字段。比分是直播的，但不能把赛前或收盘价当成当前可成交价格。',best:bestPrediction,fair,edge:0,action:'暂停模拟',minOdds:'—',stakePct:'0%',cancel:'取得明确 current 滚球价格后重新判断',marketOdds:null};
  }
  if(m.status==='live'&&m.odds?.decimals?.some(Boolean)&&m.oddsLastChangedAt&&Date.now()-m.oddsLastChangedAt>30*60_000){
    return{signal:'赔率疑似陈旧',headline:'暂停模拟｜公开价格超过 30 分钟未变化',reason:'比分仍在推进，但保存的公开盘口长期完全不变。提供方没有给出独立更新时间，系统不会把抓取成功误当成价格实时。',best:bestPrediction,fair,edge:0,action:'暂停模拟',minOdds:'—',stakePct:'0%',cancel:'公开赔率出现新变化后重新判断',marketOdds:null};
  }
  const dec=(m.status==='live'?m.odds?.currentDecimals:m.odds?.decimals)||[];
  if(![0,1,2].every(index=>Number(dec[index])>1)){
    const reason=oddsAvailabilityText(m.oddsAvailability);
    return{signal:m.oddsAvailability?.code==='partial'||m.oddsAvailability?.code==='live-partial'?'赔率不完整':'无可验证赔率',headline:'不下注｜三项价格不完整，只保留比赛分析',reason:`模型倾向 ${teams[bestPrediction]}（${(probs[bestPrediction]*100).toFixed(0)}%），但${reason}。没有完整的主胜、平局、客胜价格就无法计算统一口径的市场概率和价值。`,best:bestPrediction,fair:1/probs[bestPrediction],edge:0,action:'不下注',minOdds:(1.05/probs[bestPrediction]).toFixed(2),stakePct:'0%',cancel:'取得同次抓取的完整三项公开价格后重新评估',marketOdds:null};
  }
  const uncertaintyMargin=(100-Number(m.model.confidence||42))/100*.055;
  const decisionProbs=probs.map(p=>clamp(p-uncertaintyMargin,.02,.96));
  const edges=dec.map((o,i)=>o>=1.20?decisionProbs[i]*o-1:-99);
  const valueIndex=edges.indexOf(Math.max(...edges));
  const bestEdge=edges[valueIndex];
  const evidenceFloor=m.status==='live' ? .025 : .015;
  if(bestEdge===-99&&dec.some(Boolean)){
    return{signal:'最低赔率过滤',headline:'不下注｜当前参考赔率均低于 1.20',reason:'低于你设定的 1.20 最低线；1.20 至 1.70 不会仅因价格低而排除，仍按模型优势和证据完整性评估。',best:bestPrediction,fair:1/decisionProbs[bestPrediction],edge:0,decisionProbability:decisionProbs[bestPrediction],action:'不下注 · 低于 1.20',minOdds:'1.20',stakePct:'0%',cancel:'价格达到 1.20 且重新核验模型与比赛信息',marketOdds:dec[bestPrediction]};
  }
  if(bestEdge>0.065&&Number(m.model.evidenceShift||0)>=evidenceFloor){
    const minLine=(1.04/decisionProbs[valueIndex]).toFixed(2);
    const stakePct=bestEdge>=.12?'1.0%':'0.5%';
    return{signal:'可以考虑',headline:`模拟：${labels[valueIndex]}（${teams[valueIndex]}）｜参考赔率不得低于 ${minLine}`,reason:`启发式模型概率 ${(probs[valueIndex]*100).toFixed(0)}%，扣除数据不确定性后按 ${(decisionProbs[valueIndex]*100).toFixed(1)}% 计算；模型与盘口概率差异 ${(m.model.evidenceShift*100).toFixed(1)}%，${m.status==='live'?'current 滚球':'赛前公开'}参考赔率 ${dec[valueIndex].toFixed(2)}（${m.status==='live'?m.odds?.currentProviders?.[valueIndex]:m.odds?.bestProviders?.[valueIndex]}），估计优势 ${(bestEdge*100).toFixed(1)}%。此差异不是独立比分源验证，也未经充分回测。`,best:valueIndex,fair:1/decisionProbs[valueIndex],edge:bestEdge,decisionProbability:decisionProbs[valueIndex],action:`${labels[valueIndex]} · ${teams[valueIndex]}`,minOdds:minLine,stakePct,cancel:`参考盘口低于 ${minLine}、比分变化或数据超过 90 秒未更新`,marketOdds:dec[valueIndex]};
  }
  if(dec.some(Boolean)) return{signal:'不买',headline:'不下注｜估计价格优势或模型偏移不足',reason:`启发式模型最倾向 ${teams[bestPrediction]}（${(probs[bestPrediction]*100).toFixed(0)}%）；估计保守优势 ${(Math.max(0,bestEdge)*100).toFixed(1)}%，模型与盘口概率差异 ${(Number(m.model.evidenceShift||0)*100).toFixed(1)}%，未同时通过门槛。该差异不是独立比分源验证。`,best:bestPrediction,fair:1/probs[bestPrediction],edge:Math.max(0,bestEdge),action:'不下注',minOdds:(1.05/probs[bestPrediction]).toFixed(2),stakePct:'0%',cancel:'价格和模型与盘口差异同时达到门槛后才考虑',marketOdds:dec[bestPrediction]};
  return{signal:'无可验证赔率',headline:'不下注｜只给比赛方向，不用预测代替价格',reason:`模型倾向 ${teams[bestPrediction]}（${(probs[bestPrediction]*100).toFixed(0)}%），但当前没有可验证的公开赔率。没有价格就无法证明有投注价值。`,best:bestPrediction,fair:1/probs[bestPrediction],edge:0,action:'不下注',minOdds:(1.05/probs[bestPrediction]).toFixed(2),stakePct:'0%',cancel:'取得实时赔率并确认数据时间戳前，不下注',marketOdds:null};
}
function parseOddsNode(competition,allowCloseReference=false){
  const items=Array.isArray(competition?.odds)?competition.odds:(Array.isArray(competition?.odds?.items)?competition.odds.items:[competition?.odds]).filter(Boolean);
  const offers=items.map((sourceRaw,index)=>{
    const moneyLine=sourceRaw?.moneyline||sourceRaw?.moneyLine||sourceRaw?.moneyline?.moneyline;
    if(!moneyLine||typeof moneyLine!=='object') return null;
    const coherent=selectCurrentMoneyline({odds:[sourceRaw]},{allowCloseReference});
    const currentDecimals=coherent.odds.map(value=>value>1?value:null);
    const liveVerified=coherent.phase==='current'&&coherent.complete;
    const paired=selectCurrentPairedMarkets(sourceRaw,{allowCloseReference});
    return{provider:sourceRaw.provider?.displayName||sourceRaw.provider?.name||`公开市场 ${index+1}`,decimals:[...currentDecimals],currentDecimals,liveVerified,quoteReason:coherent.reason,total:paired.total,spread:paired.spread,details:sourceRaw.details||''};
  }).filter(Boolean);
  const selected=selectCurrentMoneyline(competition,{allowCloseReference});
  const decimals=selected.odds.map(value=>value>1?value:null);
  const bestProviders=decimals.map(value=>value?selected.provider:null);
  const currentDecimals=[...decimals];
  const currentProviders=[...bestProviders];
  return{
    provider:selected.provider||'当前价格缺失',
    decimals,
    bestProviders,
    currentDecimals,
    currentProviders,
    offers,
    liveVerified:selected.phase==='current'&&selected.complete,
    quoteReason:selected.reason,
    quotePhase:selected.phase,
    historicalOnly:selected.historicalOnly,
    total:offers[0]?.total||null,
    details:offers[0]?.details||''
  };
}
function normalizeEvent(event,league){
  const comp=event?.competitions?.[0]||event?.competition||{};
  const competitors=Array.isArray(comp.competitors)?comp.competitors:event?.competitors||[];
  const home=competitors.find(t=>t.homeAway==='home')||competitors[0]||{};
  const away=competitors.find(t=>t.homeAway==='away')||competitors[1]||{};
  const state=comp.status?.type?.state||event.status?.type?.state||'pre';
  const detail=comp.status?.type?.detail||comp.status?.type?.shortDetail||event.status?.type?.detail||event.status?.type?.shortDetail||'';
  const clockText=comp.status?.displayClock||comp.status?.clock?.displayValue||comp.status?.periodTime?.displayValue||event.status?.displayClock||'';
  let status=detectStatus(state,clockText,detail,comp.status?.type?.completed||event.status?.type?.completed||false);
  const minute=extractMinute(clockText);
  const clockSeconds=extractClockSeconds(clockText,minute);
  const eventAt=new Date(event.date||comp.date);if(!Number.isFinite(eventAt.getTime()))return null;
  const odds=parseOddsNode(comp,status==='soon'&&Number(eventAt)>Date.now());
  const rawOddsItems=Array.isArray(comp?.odds)?comp.odds:(Array.isArray(comp?.odds?.items)?comp.odds.items:[comp?.odds]).filter(Boolean);
  const elapsed=(Date.now()-Number(eventAt))/60000;
  const halftime=/^(?:HT|Half[- ]?Time|Halftime)$/i.test(String(detail).trim())&&Number.isFinite(elapsed)&&elapsed>=35&&elapsed<=85;
  if(status==='live'&&(!Number.isFinite(elapsed)||elapsed<-20||elapsed>Math.max(240,minute+120)||(minute>0&&elapsed-minute>(Number(comp.status?.period||event.status?.period||0)>=2?35:12)&&!halftime)))status='unverified';
  const liveMinute=minute;
  const liveClockSeconds=clockSeconds;
  const period=Number(comp.status?.period||event.status?.period||0);
  const homeOriginal=home.team?.shortDisplayName||home.team?.displayName||'主队',awayOriginal=away.team?.shortDisplayName||away.team?.displayName||'客队';
  const row={id:String(event.id||event.uid||`${league.code}-${Date.now()}-${Math.random()}`),leagueCode:league.code,league:league.name,home:{originalName:homeOriginal,name:displayTeamName(homeOriginal,league.code),abbr:home.team?.abbreviation||initials(home.team?.displayName),score:Number(home.score)||0,shots:stat(home,'totalShots'),sot:stat(home,'shotsOnTarget'),possession:stat(home,'possessionPct'),form:home.form||'',formPoints:formPoints(home.form)},away:{originalName:awayOriginal,name:displayTeamName(awayOriginal,league.code),abbr:away.team?.abbreviation||initials(away.team?.displayName),score:Number(away.score)||0,shots:stat(away,'totalShots'),sot:stat(away,'shotsOnTarget'),possession:stat(away,'possessionPct'),form:away.form||'',formPoints:formPoints(away.form)},hs:Number(home.score)||0,as:Number(away.score)||0,status,minute:liveMinute,period,clock:clockText,clockSeconds:liveClockSeconds,capturedAt:Number(event._edgeCapturedAt)||Date.now(),date:eventAt,statusDetail:detail,odds,sourceCount:Number(event._edgeSourceCount)||1,scoreConflict:!!event._edgeScoreConflict,clockConflict:!!event._edgeClockConflict,provisionalLead:!!event._edgeProvisionalLead,sourceObservations:event._edgeObservations||[]};
  row.home.logo=home.team?.logo;row.away.logo=away.team?.logo;row.leagueLogo=event._edgeLeagueLogo||league.logo;
  row.scoreKnown=[home.score,away.score].every(score=>score!=null&&/^\d+$/.test(String(score)));
  row.official=event._edgeOfficial||null;
  if(row.official?.state==='finished'&&row.status==='finished'&&!row.scoreConflict&&row.official.score?.[0]===row.hs&&row.official.score?.[1]===row.as)row.sourceCount+=1;
  if(row.official?.state==='finished'&&Array.isArray(row.official.score)&&row.official.score.length===2&&Date.now()-Number(row.official.capturedAt)<10*60000&&(row.status!=='finished'||row.hs!==row.official.score[0]||row.as!==row.official.score[1])){
    row.primaryObservation={status:row.status,hs:row.hs,as:row.as,clock:row.clock};
    row.status='finished';row.hs=row.official.score[0];row.as=row.official.score[1];
    row.home.score=row.hs;row.away.score=row.as;row.scoreKnown=true;
    row.officialOnlyFinal=true;row.scoreConflict=true;row.capturedAt=row.official.capturedAt;
    row.statusDetail=officialLabel(row)+'完场 · ESPN 待核验';row.odds=null;
    row.sourceCount+=1;
  }
  if(row.official?.state==='live'&&row.status!=='finished'&&Date.now()-row.official.capturedAt<90000){
    row.primaryObservation={status:row.status,hs:row.hs,as:row.as,clock:row.clock};
    row.status='live';row.hs=row.official.score[0];row.as=row.official.score[1];
    row.home.score=row.hs;row.away.score=row.as;row.scoreKnown=true;
    row.minute=row.official.minute;row.clock=`${row.official.period==='first-half'?'上半场':'下半场'} ${row.minute}′`;
    row.clockSeconds=row.minute*60;row.capturedAt=row.official.capturedAt;
    const officialDate=new Date(row.official.fixtureDate);if(Number.isFinite(officialDate.getTime()))row.date=officialDate;row.period=row.official.period==='first-half'?1:2;
    row.statusDetail='J.LEAGUE 官方现场';row.odds=null;
    row.sourceCount+=1;
  }
  row.oddsAvailability=classifyOddsAvailability({status:row.status,kickoffAt:Number(row.date),observedAt:row.capturedAt,prices:row.status==='live'?(row.odds?.currentDecimals||[]):(row.odds?.decimals||[]),historicalPrices:row.odds?.decimals||[],rawOddsCount:rawOddsItems.length,moneylineCount:rawOddsItems.filter(item=>item?.moneyline||item?.moneyLine||item?.moneyline?.moneyline).length,historicalOnly:!!row.odds?.historicalOnly,officialOnly:!!row.officialOnlyFinal});
  row.model=modelFor(row);
  row.strategy=strategyFor(row);
  return row;
}

function statusText(m){if(kickoffUnconfirmed(m))return '已到开球时间 · 现场状态待核验';if(normalHalftime(m))return '中场 HT · 45 分钟时钟正常暂停';if(m.status==='live')return m.feedStale||m.scoreConflict&&!m.provisionalLead||Date.now()-Number(m.lastProgressAt||m.capturedAt||0)>180000?`时间待核验 · 上次 ${m.clock||`${m.minute}′`}`:m.clock||(m.minute?`${m.minute}′`:'分钟未提供');if(m.status==='unverified')return`状态待核验 · 源头 ${m.clock||m.statusDetail||'进行中'}`;if(m.status==='finished')return'完场';return m.date.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})}
function competitionKind(m){const code=String(m?.leagueCode||'');if(/(?:\.w\.|\.w$|friendly\.w|wchampions)/.test(code)||['eng.w.1','esp.w.1','fra.w.1','aus.w.1','usa.nwsl'].includes(code))return'女足';if(/^(?:fifa\.|uefa\.nations|uefa\.euroq|concacaf\.nations|afc\.cupq|caf\.nations_qual)/.test(code))return'国家队';return'俱乐部';}
function teamIcon(match,side){const team=match?.[side]||{};if(competitionKind(match)==='国家队'){const flag=countryFlag(team.originalName||team.name);return `<span class="country-flag" role="img" aria-label="${esc(teamZh(team.name))}国旗">${flag||'🏳️'}</span>`;}return crest(team.logo,team.name);}
function displayTeamName(raw,leagueCode){const translated=teamZh(raw)||String(raw||'球队');return competitionKind({leagueCode})==='女足'&&!translated.endsWith('女足')?`${translated}女足`:translated;}
function renderLeagueOptions(){
  const current=$('#leagueFilter')?.value||activeLeague;
  const available=[...new Set(matches.map(m=>m.leagueCode))];
  if(!$('#leagueFilter')) return;
  $('#leagueFilter').innerHTML='<option value="all">全部已接入赛事</option>'+leagues.filter(l=>available.includes(l.code)).map(l=>`<option value="${l.code}">${l.name}</option>`).join('');
  $('#leagueFilter').value=available.includes(current)?current:'all';
  activeLeague=$('#leagueFilter').value;
}
function sortMatches(rows){
  const rank={live:0,unverified:1,soon:2,finished:3};
  return rows.sort((a,b)=>(rank[a.status]??3)-(rank[b.status]??3)||(a.status==='finished'?b.date-a.date:a.date-b.date));
}
let latestDecisionLab = null;
let simulationIndex = null;
let simulationDetails = new Map();
function virtualLegText(leg) {
  if (leg.market === 'total') return `全场${leg.side === 'over' ? '大' : '小'} ${String(Number(leg.line))} 球 @ ${Number(leg.odds).toFixed(2)}`;
  if (leg.market === 'spread') return `${leg.side === 'home' ? '主队' : '客队'} ${Number(leg.line) > 0 ? '+' : ''}${String(Number(leg.line))} 让球 @ ${Number(leg.odds).toFixed(2)}`;
  return `${['主胜','平局','客胜'][leg.pick] || '胜平负'} @ ${Number(leg.odds).toFixed(2)}`;
}
function virtualStateText(state) { return ({open:'待结算',win:'已命中',loss:'未命中',review:'待核对',void:'作废'})[state] || state || '待结算'; }
window.addEventListener('edge:simulation-ledger', event => {
  latestDecisionLab = event.detail;
  updateLabBetMap(event.detail);
  simulationIndex = new Map();
  simulationDetails = new Map();
  for (const portfolio of event.detail.portfolios || []) for (const ticket of portfolio.tickets || []) for (const leg of ticket.legs || []) {
    const key = `${leg.leagueCode}:${leg.matchId}`;
    const entries = simulationIndex.get(key) || new Set();
    entries.add(portfolio.name); simulationIndex.set(key, entries);
    const details = simulationDetails.get(key) || [];
    details.push({portfolio:portfolio.name, ticketId:ticket.id, text:virtualLegText(leg), state:virtualStateText(ticket.status || leg.status), status:ticket.status||leg.status, pnl:Number(ticket.pnl||0), legs:(ticket.legs||[]).map(part=>`${part.home||''} - ${part.away||''}：${virtualLegText(part)}`), goalEvidence:leg.goalEvidence, provider:leg.provider, phase:leg.phase, priceCapturedAt:leg.priceCapturedAt});
    simulationDetails.set(key, details);
  }
  renderMatches();
  renderSelected();
});
function simulationLabel(match) {
  if (!simulationIndex) return '模拟记录读取中';
  const entries = simulationDetails.get(`${match.leagueCode}:${match.id}`) || [];
  return entries.length ? `本场模拟：${entries.slice(0,2).map(e=>e.text).join(' / ')}${entries.length>2?` 等 ${entries.length} 单`:''}` : '本场暂无合格的模拟单；点开查看模型倾向和其他市场';
}
function simulationTone(match){const entries=simulationDetails.get(`${match.leagueCode}:${match.id}`)||[],closed=entries.filter(e=>['win','loss','void'].includes(e.status));if(!closed.length)return'neutral';const pnl=closed.reduce((sum,e)=>sum+Number(e.pnl||0),0);return pnl>0?'positive':pnl<0?'negative':'neutral'}
function decisionEvidenceCurrent(match){const health=feedHealth.get(match.leagueCode);return decisionEvidenceFresh({scanAt:match.contextDecision?.calculatedAt,feedStatus:health?.status,lastSuccessAt:health?.lastSuccessAt,quoteStale:quoteNeedsRefresh(match)});}
function displayAction(match){return match.status==='finished'?'已完场｜仅供复盘':match.status==='live'?'比赛进行中｜不生成赛前候选':quoteNeedsRefresh(match)?'暂停模拟｜报价待刷新':match.contextDecision?.qualified&&!decisionEvidenceCurrent(match)?'暂停模拟｜研究或联赛读取待刷新':match.contextDecision?.action||'研究核对中｜暂不生成模拟单'}
function oddsHealthText(match,compact=false){
  if(quoteNeedsRefresh(match))return compact?'赔率待刷新':'该联赛抓取失败或超过 5 分钟未刷新，显示的是上次赔率快照；恢复同步前不参与价值判断';
  return oddsAvailabilityText(match.oddsAvailability,compact);
}
function matchSearchText(match) {
  return [match.league, match.leagueCode, match.home.name, match.away.name, match.home.originalName, match.away.originalName, teamZh(match.home.name), teamZh(match.away.name), teamOriginal(match.home.name), teamOriginal(match.away.name)].filter(Boolean).join(' ').toLocaleLowerCase();
}
function goalSourceLinks(evidence) {
  return (evidence?.sourceUrls||[]).map((raw,index)=>{try{const url=new URL(raw);return url.protocol==='https:'&&url.hostname==='site.web.api.espn.com'&&url.pathname.includes('/standings')?`<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(String(evidence.seasons?.[index]||index+1))} 赛季积分榜</a>`:''}catch{return ''}}).filter(Boolean).join(' / ');
}
const researchCache=new Map(),researchPending=new Set();
function safeResearchLink(raw,label) {try{const url=new URL(raw);return url.protocol==='https:'&&['site.web.api.espn.com','www.espn.com','espn.com','pc.dongqiudi.com'].includes(url.hostname)?`<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`:esc(label)}catch{return esc(label)}}
function contextualMarketAnalysis(match,data){
  const now=Date.now(),scanAt=Number(latestDecisionLab?.lastScanAt||0),health=feedHealth.get(match.leagueCode);
  const scanFresh=scanAt>0&&scanAt<=now+1000&&now-scanAt<=5*60000;
  const feedAt=Number(health?.lastSuccessAt||0),feedFresh=health?.status==='ok'&&feedAt>0&&feedAt<=now+1000&&now-feedAt<=5*60000&&!quoteNeedsRefresh(match);
  const evidenceFresh=decisionEvidenceFresh({scanAt,feedStatus:health?.status,lastSuccessAt:feedAt,quoteStale:quoteNeedsRefresh(match),now});
  const matching=(latestDecisionLab?.marketReviews||[]).filter(r=>String(r.leg.matchId)===String(match.id)&&r.leg.leagueCode===match.leagueCode&&Number(r.leg.kickoffAt)>Date.now());
  const candidates=matching.map(r=>{const l=r.leg,quoteMatches=candidateQuoteMatches(l,match,now),qualifies=evidenceFresh&&quoteMatches&&Number(r.edge)>=.08&&Number(l.score)>=75&&Number(l.probability)>=.4&&Number(l.odds)<=3;return {market:l.market==='spread'?'多档让球':l.market==='total'?'大小球':'胜平负',selection:l.market==='spread'?(teamZh(l.side==='home'?l.home:l.away)+' '+(l.line>0?'+':'')+l.line):l.market==='total'?('全场'+(l.side==='over'?'大':'小')+' '+l.line):['主胜','平局','客胜'][l.pick],odds:l.odds,score:l.score,probability:l.probability,edge:r.edge,qualifies,strong:qualifies,lowPrice:l.odds<1.2};}).sort((a,b)=>b.edge-a.edge);
  const qualified=candidates.find(r=>r.qualifies),best=qualified||candidates[0],quoteMismatch=evidenceFresh&&matching.length>0&&!matching.some(r=>candidateQuoteMatches(r.leg,match,now)),audit=(latestDecisionLab?.decisionAudit||[]).find(r=>r.matchId===String(match.id));
  const spreadAudit=(audit?.spreadCandidates||[]).slice().sort((a,b)=>Number(b.edge)-Number(a.edge));
  const spreadLine=audit?(audit.spreadLines||[]):[];
  const spreadExplanation=!audit?'让球档位审查尚无快照。':spreadLine.length===0?'当前合法公开源没有返回同源双边让球价，不能生成让球模拟单。':spreadLine.length===1?`当前公开源只返回主队 ${Number(spreadLine[0])>0?'+':''}${spreadLine[0]} 这一档；系统支持多档，但不会给没有真实赔率的理论档位出票。`:`当前公开源返回 ${spreadLine.length} 档：${spreadLine.map(v=>`${Number(v)>0?'+':''}${v}`).join('、')}。`;
  const spreadVerdict=spreadAudit.length?spreadAudit.slice(0,4).map(row=>`${row.side==='home'?'主队':'客队'} ${Number(row.line)>0?'+':''}${row.line} @ ${Number(row.odds).toFixed(2)}：${row.qualifies?evidenceFresh?'扫描时通过数值门槛':'旧扫描曾通过，当前待核验':(row.reasons||[]).join('；')}`).join(' | '):'没有可计算的当前/收盘双边让球报价，或独立进球模型缺失。';
  const reasons=[
    scanFresh&&feedFresh?quoteMismatch?'扫描价与当前同提供方、同盘口报价不一致，旧候选只能用于复盘；需要重新扫描。':'执行候选需同时匹配 5 分钟内扫描与本联赛同提供方、同盘口、同价格的 current 字段；公开报价仍不保证可成交。':`执行候选已暂停：${!scanFresh?'后台扫描超过 5 分钟或尚无扫描；':''}${!feedFresh?'本联赛读取或报价超过 5 分钟；':''}旧价格和旧分数只供历史研究。`,
    '严格筛选实验门槛：评分 ≥75、保守优势 ≥8%、获利概率 ≥40%、赔率 ≤3.00；不足不补位，也不代表已验证盈利。',
    data?.lineupConfirmed?'已有首发，仍须核对报价与扫描时间。':'首发未确认，候选不是确定赛果；不可把新闻数量当伤停概率。',
    audit?audit.reason:'此场执行审查尚无快照；研究报告仍展示可核验资料，不能把没有候选理解为没有比赛。',
    `让球档位：${spreadExplanation}`,
    `让球门槛审计：${spreadVerdict}`,
    '广覆盖与娱乐对照可能记录负优势；与本区严格候选分开。'
  ];
  return {qualified:!!qualified,strong:!!qualified,best,candidates,reasons,action:qualified?qualified.market+' · '+qualified.selection+' @ '+qualified.odds.toFixed(2):!scanFresh||!feedFresh?'暂停精选 · 等待新扫描与本联赛报价':quoteMismatch?'暂停精选 · 价格变化后待重扫':'不生成精选 · 等待有效价格或通过门槛',headline:qualified?'通过当前扫描数值门槛，仍需核对信息变化':!scanFresh||!feedFresh?'旧扫描或本联赛报价未核验 · 暂不行动':quoteMismatch?'扫描价与当前报价不符 · 暂不行动':'本场暂无通过严格筛选的候选',uncertainty:data?.goalEvidence?.uncertaintyMargin??null,calculatedAt:scanAt||null};
}
function renderMatchPick(match) {
  if(!match)return;
  if(selected?.id===match.id&&$('#signalText'))$('#signalText').textContent=displayAction(match);
  const model=match.model||{},probabilities=[Number(model.home)||0,Number(model.draw)||0,Number(model.away)||0],index=probabilities.indexOf(Math.max(...probabilities));
  const direction=index===0?`${teamZh(match.home.name)}胜`:index===1?'平局':`${teamZh(match.away.name)}胜`,modelAvailable=!!model.hasMarketOdds;
  const context=match.contextDecision,option=context?.best,qualified=Boolean(context?.qualified)&&decisionEvidenceCurrent(match)&&match.status==='soon';
  const quoted=qualified&&option?`${option.market} · ${option.selection} @ ${option.odds.toFixed(2)}`:'暂无经当前价格核验的候选';
  const action=match.status==='finished'?'已完场 · 不生成赛后模拟单':qualified?`候选：${context.action}`:'暂不生成模拟单';
  // Blogger-style narrative: verdict first, one spoken-language line,
  // then the checked status facts, then the money math. No jargon soup.
  const formLine=`${teamZh(match.home.name)} 近 5 场 ${match.home.form||'无记录'}，${teamZh(match.away.name)} 近 5 场 ${match.away.form||'无记录'}`;
  const dqdLine=(context?.reasons||[]).find(r=>r.includes('懂球帝'))||'懂球帝伤停信号：核对中';
  const oneLiner=context?`${formLine}；${dqdLine.replace(/^懂球帝近14天公开新闻与出场信号：/,'懂球帝信号 ').replace(/（主.*?）;/,'')}`:`状态核对需要 10 秒上下（公开源慢）：先看下方"综合模型结论"卡，本卡加载完自动更新；失败会自动重试一次。`;
  const marketImplied=match.odds?.decimals?.[index]?((1/Number(match.odds.decimals[index]))*100).toFixed(0)+'%':null;
  const modelProb=(probabilities[index]*100).toFixed(1);
  const mathLine=match.status==='soon'?qualified?`候选 ${quoted}：模型概率 ${(Number(option.probability)*100).toFixed(1)}%，保守估计优势 ${(Number(option.edge)*100).toFixed(1)}%；仅供虚拟模拟，公开参考价不保证可成交。`:modelAvailable?`胜平负模型倾向 ${direction}，概率 ${modelProb}%${marketImplied?`；参考价隐含概率 ${marketImplied}`:''}。${!context||!decisionEvidenceCurrent(match)?'研究扫描或本联赛报价未核验，当前优势不能成立。':'没有通过严格门槛且与当前盘口吻合的候选；等待新扫描。'}`:'缺少完整可核验的胜平负报价；本场不展示由固定占位先验算出的概率，等待新资料。':'本场已开赛或完场，只复盘历史记录。';
  const reasons=context?.reasons?.length?context.reasons:[modelAvailable?`状态核对进行中：当前模型方向 ${direction}（${modelProb}%）仍须核价。`:'状态核对进行中：胜平负报价不完整，暂不展示数值概率。'];
  if($('#matchPickDirection'))$('#matchPickDirection').textContent=modelAvailable?`${direction} · ${modelProb}%（未校准）`:'报价不完整 · 概率未展示';
  if($('#matchPickSelection'))$('#matchPickSelection').textContent=quoted;
  if($('#matchPickScore'))$('#matchPickScore').textContent=qualified?`评分 ${Number(option.score||0).toFixed(0)} · 优势 ${(Number(option.edge)*100).toFixed(1)}%（实验门槛）`:'未通过当前严格门槛';
  if($('#matchPickAction'))$('#matchPickAction').textContent=action;
  if($('#matchPickState'))$('#matchPickState').textContent=context?.action?.startsWith('暂停精选')||context?.qualified&&!decisionEvidenceCurrent(match)?'⚠ 联赛或价格待核验':context?'研究状态已读取':match.researchFailed?'⚠ 研究接口暂不可用':match.researchDegraded?'⚠ 研究源降级':'⏳ 状态核对中…';
  if($('#matchPickReason'))$('#matchPickReason').textContent=oneLiner;
  const health=feedHealth.get(match.leagueCode),last=Number(health?.lastSuccessAt||0),age=last?Math.max(0,Math.floor((Date.now()-last)/60000)):null;
  const healthText=!health?'本联赛尚未完成本轮读取':health.status==='error'?'本联赛最近读取失败':health.status==='empty'?'本联赛本批返回空赛程':`本联赛最近读取成功（${age} 分钟前）`;
  if($('#matchPickDataHealth')){$('#matchPickDataHealth').textContent=`数据健康：${healthText}；赛事本机抓取 ${Number(match.capturedAt)?new Date(Number(match.capturedAt)).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'时间未记录'}；研究扫描 ${Number(context?.calculatedAt)?new Date(Number(context.calculatedAt)).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚未执行'}。两条 ESPN 端点同属一个供应商，赔率源头更新时间与可成交性未知。`;$('#matchPickDataHealth').classList.toggle('is-unavailable',health?.status!=='ok'||quoteNeedsRefresh(match));}
  if($('#matchPickFactors'))$('#matchPickFactors').innerHTML=[...reasons,mathLine].map(reason=>`<li>${esc(reason)}</li>`).join('');
}
function localDeepDive(match){
  const g=match.goalModel,known=g&&Number.isFinite(g.expectedHome)&&Number.isFinite(g.expectedAway);
  const home=esc(teamZh(match.home.name)),away=esc(teamZh(match.away.name));
  const form='<p>'+home+' 近期记录：'+esc(match.home.form||'未取得')+'；'+away+' 近期记录：'+esc(match.away.form||'未取得')+'。</p>';
  const model=known?'<p>现有进球模型预期 '+g.expectedHome.toFixed(2)+' : '+g.expectedAway.toFixed(2)+'，预期总进球 '+(g.expectedHome+g.expectedAway).toFixed(2)+'。这是模型均值，不是确定比分。</p>':'<p>当前没有可核验的进球模型输入，无法从胜平负概率唯一反推出预期进球或比分剧本。</p>';
  return '<details class="deep-dive" open><summary>深度拆解 · 本地简版</summary><p class="deep-dive-summary">'+home+' 对 '+away+' · 外部研究暂不可达</p><section class="deep-dive-sec"><h4>已知球队信息</h4>'+form+model+'</section><section class="deep-dive-sec"><h4>尚待核对</h4><p>首发、具体伤停、战术安排和赛程疲劳未获得完整核验，不能仅凭赔率断言控球、轮换或比赛意愿。</p></section><section class="deep-dive-sec"><h4>重新评估条件</h4><p>确认首发、早段红牌、比分或盘口变化后，应重新计算。研究恢复后会补充完整资料；本地简版不覆盖已记录票据的赛前依据。</p></section></details>';
}
function localResearchData(match,reason='外部研究源暂时不可达'){
  const team=(name)=>({name:String(name||''),id:'',formation:'',starters:[]});
  return{ok:true,partial:true,reason,provider:'本地比赛模型（外部研究源待恢复）',sourceUrl:'',capturedAt:Date.now(),state:'unknown',lineupConfirmed:false,teams:[team(match.home.name),team(match.away.name)],lastFive:[{team:match.home.name,games:[]},{team:match.away.name,games:[]}],rest:[{team:match.home.name,restDays:null},{team:match.away.name,restDays:null}],standings:[],news:[],availabilityNews:[],injuries:[{team:match.home.name,reportAvailable:false,reportCount:0,list:[],sourceUrl:''},{team:match.away.name,reportAvailable:false,reportCount:0,list:[],sourceUrl:''}],dongqiudi:[{team:match.home.name,news:[],availabilitySignals:0,matchStatus:'source-unavailable'},{team:match.away.name,news:[],availabilitySignals:0,matchStatus:'source-unavailable'}],goalEvidence:match.goalModel||null,halfTimeModel:null,contextQuality:{lineup:'unconfirmed',injuryEvidence:'missing',restEvidence:'missing',standingsEvidence:'partial',availabilityNews:0,dongqiudi:'partial'},modelUsage:'外部研究源不可达；仅使用本地已缓存比赛数据和模型，不猜测首发、伤停或新闻。'};
}
function renderMatchResearch(match,data){
  const box=$('#matchResearch'),deepBox=$('#deepDivePanel');if(!box||!match)return;
  if(!data?.ok){const fallback=localDeepDive(match);match.researchFailed=true;match.researchDegraded=false;if(deepBox)deepBox.innerHTML=fallback;box.innerHTML=`${fallback}<strong>场外研究来源暂不可用</strong><small>当前没有可核验的首发、伤停或完整疲劳数据；深度拆解仅基于本地比赛模型，不能替代完整研究。</small>`;renderMatchPick(match);return}
  if(data.degraded&&!data.partial)data=localResearchData(match,data.error||'公开研究源暂时未返回');
  const context=contextualMarketAnalysis(match,data);match.contextDecision=context;match.researchFailed=false;match.researchDegraded=Boolean(data.partial);
  const lineup=data.lineupConfirmed?`<p>ESPN 比赛摘要列出双方首发（状态 ${esc(data.state)}；球员影响未入模）：${(data.teams||[]).map(team=>`<details><summary>${esc(matchTeamZh(team.name,match.leagueCode))} ${esc(team.formation||'阵型未提供')} · ${(team.starters||[]).length} 人</summary>${(team.starters||[]).map(player=>`${esc(player.name)} ${esc(player.position)}`).join(' / ')}</details>`).join('')}</p>`:'<p>首发：未确认。没有可靠预计阵容，不按假设的首发调整概率。</p>';
  const form=(data.lastFive||[]).map(team=>{const games=(team.games||[]).slice(0,5);return `<p>${esc(teamZh(team.team))} 最近五场来源记录：${games.length?games.map(game=>`${esc(String(game.date||'').slice(0,10))} ${esc(game.result)} ${esc(game.score)} vs ${esc(teamZh(game.opponent))}`).join('；'):'未提供'}</p>`}).join('');
  const injuries=(data.injuries||[]).map(row=>`<p>${esc(matchTeamZh(row.team,match.leagueCode))} 伤停：${row.reportStatus==='named'?`接口有 ${Number(row.reportCount)||0} 个命名条目，状态需逐项核对`:row.reportStatus==='empty'?'接口返回空名单；不等于确认全员健康':row.reportStatus==='unsupported'?'接口格式未识别':'接口不可用'} · ${safeResearchLink(row.sourceUrl,'伤停来源')}</p>`).join('');
  const news=(data.news||[]).length?`<p>近期球队相关新闻（仅标题匹配，未验证对阵关联）：${data.news.map(item=>`${safeResearchLink(item.url,item.headline||item.title||'公开新闻')} (${esc(item.published||'时间未知')})`).join('；')}</p>`:'<p>新闻：本场摘要没有近 14 天且明确提到球队的文章；不根据联赛级旧新闻推断临场伤停。</p>';
  const dqdLinks=(data.teams||[]).map(team=>{const name=matchTeamZh(team.name,match.leagueCode),url='https://www.bing.com/search?q='+encodeURIComponent('site:pc.dongqiudi.com/articles/ '+name+' 伤停 首发');return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">手动查：${esc(name)}</a>`}).join(' · ');
  const rest=(data.rest||[]).map(row=>`${esc(matchTeamZh(row.team,match.leagueCode))}：${row.restDays!=null&&Number.isFinite(Number(row.restDays))?Number(row.restDays)+' 天':'缺失'}`).join('；')||'最近比赛日期不足，无法估计休息天数或疲劳。';
  const half=data.halfTimeModel,halfHtml=half?`<p>半场独立模型（${esc(half.modelVersion)}）：半场预期进球 主 ${Number(half.expectedHome).toFixed(2)} / 客 ${Number(half.expectedAway).toFixed(2)}；主胜 ${(Number(half.probabilities?.home||0)*100).toFixed(1)}% / 平 ${(Number(half.probabilities?.draw||0)*100).toFixed(1)}% / 客胜 ${(Number(half.probabilities?.away||0)*100).toFixed(1)}%。<br><small>${(half.assumptions||[]).map(esc).join('；')}。因此当前只展示研究概率，不生成半场模拟下注。</small></p>`:'<p>半场模型：当前联赛/球队缺少两季可匹配进球样本，且没有公开半场双边赔率；不生成半场推荐或模拟单。</p>';
  const dqdNews=(data.dongqiudi||[]).map(row=>{const body=row.matchStatus==='unsupported-gender'?'当前球队 ID 只验证到男足，同名女足球队不自动匹配；不读取男足新闻。':row.matchStatus==='unmatched'?'未匹配到稳定球队 ID，未进入模型。':row.matchStatus==='source-unavailable'?'公开页面暂时不可读取，未进入模型。':row.news?.length?row.news.slice(0,5).map(item=>safeResearchLink(item.url,item.title||'懂球帝公开新闻')+'（'+esc(item.published||'时间未知')+'）'+(item.availabilitySignal?' · 疑似出场线索，需核对原文；未自动入模':'')).join('；'):'近14天未发现球队页新闻；不等于没有伤停。';return `<p class="dqd-evidence"><strong>懂球帝球队页 · ${esc(matchTeamZh(row.team,match.leagueCode))}</strong>：${body}</p>`}).join('');
  const marketRows=context.candidates?.length?`<div class="context-market-grid">${context.candidates.map(row=>`<span class="${row.qualifies?'context-pass':row.edge<0?'context-loss':'context-watch'}"><b>${esc(row.market)} · ${esc(row.selection)}</b><small>@ ${row.odds.toFixed(2)} · 保守概率 ${(row.probability*100).toFixed(1)}% · 优势 ${(row.edge*100).toFixed(1)}%${row.lowPrice?' · 低于 1.20':''}</small></span>`).join('')}</div>`:'<p>当前没有可同时核验模型概率与双边价格的市场。</p>';
  const deepDive=data.deepDive?.sections?.length?`<details class="deep-dive" open><summary>📖 深度拆解 · 把这场讲透</summary><p class="deep-dive-summary">${esc(data.deepDive.summary||'')}</p>${data.deepDive.sections.map(section=>`<section class="deep-dive-sec"><h4>${esc(section.title)}</h4>${(section.paras||[]).map(paragraph=>`<p>${esc(paragraph)}</p>`).join('')}</section>`).join('')}</details>`:localDeepDive(match);
  if(deepBox)deepBox.innerHTML=deepDive;
  const partialNote=data.partial?`<div class="context-verdict context-hold"><strong>本地研究可用 · 外部研究源暂不可达</strong><p>${esc(data.reason||'已使用本地模型和缓存数据；首发、伤停、新闻保持未知。')}</p></div>`:'';
  box.innerHTML=`${deepDive}${partialNote}<div class="context-verdict ${context.qualified?'context-pass':'context-hold'}"><strong>${esc(context.headline)}</strong><p>当前研究动作：${esc(context.action)}</p></div>${marketRows}<details open><summary>为什么这样判断</summary><ul>${(context.reasons||[]).map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul></details><strong>逐场场外研究 · ${data.partial?'外部源待恢复':'ESPN 比赛摘要'}</strong><small>抓取 ${new Date(Number(data.capturedAt)||Date.now()).toLocaleString('zh-CN',{hour12:false})}；源头更新时间未知。${esc(data.modelUsage||'')}</small>${lineup}${form}${injuries}${news}<p>公开资讯手动核对：${dqdLinks||'球队名称缺失'}。下列标题仅作线索，不自动调整模型；同名女足球队不得映射到男足页面。</p><p>赛程间隔（未方向性入模）：${rest}</p>${halfHtml}${dqdNews}`;
  if($('#directPlay'))$('#directPlay').textContent=displayAction(match);
  if($('#signalReason'))$('#signalReason').textContent=(context.reasons||[]).join(' ');
  renderMatchPick(match);
  renderMatches();
}
async function loadMatchResearch(match){
  if(!match?.id||!match.leagueCode)return;
  const key=`${match.leagueCode}:${match.id}`,cached=researchCache.get(key);
  if(cached&&Date.now()-cached.at<60000){renderMatchResearch(match,cached.data);return}
  if(researchPending.has(key))return;
  researchPending.add(key);
  if(selected?.id===match.id&&$('#matchResearch'))$('#matchResearch').textContent='正在核对本场首发、近期战绩、伤停与新闻来源…';
  if(selected?.id===match.id&&$('#deepDivePanel'))$('#deepDivePanel').innerHTML='<div class="deep-dive-loading">正在生成深度拆解：逐项核对球队状态、战术对位、伤停/首发、赛程疲劳、盘口价值与风险触发条件…</div>';
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(`/api/match-research?league=${encodeURIComponent(match.leagueCode)}&id=${encodeURIComponent(match.id)}`,{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const payload=await response.json();
    const data=payload.degraded?localResearchData(match,payload.error||'上游研究资料暂不可用'):payload;
    researchCache.set(key,{at:Date.now(),data});
    if(selected?.id===match.id&&selected?.leagueCode===match.leagueCode)renderMatchResearch(match,data);
  }catch{
    if(selected?.id===match.id&&selected?.leagueCode===match.leagueCode)renderMatchResearch(match,localResearchData(match,'研究接口暂时不可用，已切换本地研究模式'));
  }finally{clearTimeout(timeout);researchPending.delete(key)}
}
function renderSelectedVirtualPicks(match) {
  const box=$('#selectedVirtualPicks'); if(!box || !match)return;
  const key=`${match.leagueCode}:${match.id}`;
  const placed=simulationDetails.get(key)||[];
  const offers=(match.odds?.offers||[]).flatMap(o=>{
    const rows=[];
    if(o.total?.line!=null && o.total.overOdds>1 && o.total.underOdds>1) rows.push(`大小球 ${o.total.line}：大 ${Number(o.total.overOdds).toFixed(2)} / 小 ${Number(o.total.underOdds).toFixed(2)}（${o.provider}）`);
    if(o.spread?.homeLine!=null && o.spread.homeOdds>1 && o.spread.awayOdds>1) rows.push(`让球 ${o.spread.homeLine}：主 ${Number(o.spread.homeOdds).toFixed(2)} / 客 ${Number(o.spread.awayOdds).toFixed(2)}（${o.provider}）`);
    return rows;
  });
  const model=[{name:'主胜',prob:match.model.home},{name:'平局',prob:match.model.draw},{name:'客胜',prob:match.model.away}].sort((a,b)=>b.prob-a.prob)[0];
  const placedHtml=placed.length?`<strong>本场已有 ${placed.length} 条可审计模拟玩法</strong>${placed.slice(0,8).map(e=>{const g=e.goalEvidence,tone=e.status==='win'?'positive':e.status==='loss'?'negative':'neutral',settlement=['win','loss','void'].includes(e.status)?`<b class="simulation-pnl ${tone}">实际 ${e.pnl>0?'+':''}¥${Number(e.pnl).toFixed(2)}</b>`:'';const modelNote=g?`<small>进球模型 ${esc(g.modelVersion)}：赛前主 ${Number(g.expectedHome).toFixed(2)} / 客 ${Number(g.expectedAway).toFixed(2)} 预期进球；来源 ${goalSourceLinks(g)||'积分榜链接未存'}；抓取 ${new Date(Number(g.capturedAt)).toLocaleString('zh-CN',{hour12:false})}，源头更新时间未知。首发、伤停、疲劳尚未纳入，模型未校准。</small>`:'<small>本单未保存独立进球模型；请查看模拟对比页的逐单审计。首发与伤停未纳入此版概率。</small>';return `<p class="selected-pick-row ${tone}">${esc(e.portfolio)}：${esc(e.text)} · ${esc(e.state)} ${settlement}${e.legs?.length>1?`<br>${e.legs.length} 串 1 全单：${e.legs.map(esc).join(' / ')}`:''}<br>参考市场：${esc(e.provider||'来源未存')} · ${esc(e.phase||'阶段未存')} · 抓取 ${Number(e.priceCapturedAt)?new Date(Number(e.priceCapturedAt)).toLocaleString('zh-CN',{hour12:false}):'时间未存'}<br>${modelNote}</p>`}).join('')}`:`<strong>本场暂无已记录模拟注单</strong><p>${match.model.hasMarketOdds?`当前未校准模型倾向：${esc(model.name)} ${Math.round(model.prob*100)}%；`:'胜平负报价不完整，数值概率暂不展示；'}页面决策：${esc(displayAction(match))}。模型倾向不等于已下注或盈利优势。</p>`;
  const other=offers.length?`<p>非胜负市场参考报价：${offers.slice(0,4).map(esc).join('；')}</p><small>仅报价不代表推荐；未通过模型、价格、数据新鲜度门槛时不虚构模拟注单。半场、角球等缺少可核验盘口与结算数据，暂不自动模拟。</small>`:'<small>本场尚未取得可核验的大小球、让球等双边报价；半场、角球等也无可审计报价，暂不编造推荐。</small>';
  box.innerHTML=placedHtml+other;
}
let labBetMap=new Map();
function updateLabBetMap(lab){const map=new Map();for(const p of lab.portfolios||[])for(const t of p.tickets||[]){if(!['open','review'].includes(t.status))continue;for(const l of t.legs||[]){const key=String(l.matchId),a=map.get(key)||[];a.push(p.name.replace(/（.*）/,'')+':'+virtualLegText(l));map.set(key,a);}}labBetMap=map;}
async function pollLabBets(){try{const r=await fetch('/api/lab',{cache:'no-store',signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok||!d.ok)return;updateLabBetMap(d.lab);renderMatches();}catch{}}
const betBadge=id=>{const a=labBetMap.get(String(id));if(!a)return '';return '<span class="bet-badge" title="'+esc(a.join(' · '))+'">模拟 '+a.length+' 单待结算</span>';};
function renderMatches(){
  const focusedMatchId=document.activeElement?.classList?.contains('match')?document.activeElement.dataset.id:null;
  const collapsed=new Set([...document.querySelectorAll('.league-group:not([open])')].map(el=>el.dataset.league));
  const query=($('#matchSearch')?.value||'').trim().toLocaleLowerCase();
  // Within each league: live first (earliest kickoff), then upcoming
  // (soonest first — "最近的比赛放前面"), then finished (most recent
  // final first). Unverified states sit after live.
  const recencyRank=m=>m.status==='live'?0:m.status==='unverified'?1:m.status==='soon'?2:3;
  const orderMatches=rows=>rows.slice().sort((a,b)=>recencyRank(a)-recencyRank(b)||(recencyRank(a)===3?Number(b.date)-Number(a.date):Number(a.date)-Number(b.date)));
  const shown=matches.filter(m=>(!query||matchSearchText(m).includes(query))&&(activeFilter==='all'||m.status===activeFilter||(activeFilter==='live'&&(kickoffUnconfirmed(m)||m.status==='unverified')))&&(activeLeague==='all'||m.leagueCode===activeLeague));
  let outsideNotice=$('#selectedOutsideFilter');
  if(selected&&!shown.includes(selected)){if(!outsideNotice){outsideNotice=document.createElement('p');outsideNotice.id='selectedOutsideFilter';outsideNotice.className='panel-copy';$('#matchPickCard')?.before(outsideNotice);}outsideNotice.textContent='当前详情不在左侧筛选结果中；请在列表选择一场符合条件的比赛，或清除筛选。';}else outsideNotice?.remove();
  const card=m=>`<button class="match ${selected&&m.id===selected.id?'active':''}" data-id="${esc(m.id)}"><span class="match-head"><span>${m.feedStale?'⚠ 上次缓存':m.scoreConflict&&m.provisionalLead?'⚠ 领先源临时比分':m.scoreConflict?'⚠ 比分冲突':kickoffUnconfirmed(m)?'⚠ 开赛待核验':m.status==='unverified'?'⚠ 状态异常':m.status==='live'&&Number(m.sourceCount||0)<2?'⚠ 单源观察':m.status==='live'?'源报直播':competitionKind(m)}</span><span class="${m.status==='live'&&!m.feedStale?'state-live':''}">${esc(statusText(m))}</span></span>${betBadge(m.id)}<span class="teamrow"><span class="team">${teamIcon(m,'home')}${esc(teamZh(m.home.name))}<small class="team-original">${esc(m.home.originalName||teamOriginal(m.home.name))}</small></span><span class="score">${displayedScore(m,'hs')}</span></span><span class="teamrow"><span class="team">${teamIcon(m,'away')}${esc(teamZh(m.away.name))}<small class="team-original">${esc(m.away.originalName||teamOriginal(m.away.name))}</small></span><span class="score">${displayedScore(m,'as')}</span></span>${scoreObservationWarning(m)?`<span class="score-note">⚠ ${esc(scoreObservationWarning(m))}</span>`:''}<span class="mini-signal"><span>${esc(oddsHealthText(m,true))} · 实时重算</span><b>分析结论：${esc(displayAction(m))}</b></span><span class="simulation-match-note ${simulationTone(m)}">${esc(simulationLabel(m))}</span></button>`;
  const groups=leagues.map(l=>({league:l,rows:orderMatches(shown.filter(m=>m.leagueCode===l.code))})).filter(g=>g.rows.length).sort((a,b)=>Math.min(...a.rows.map(recencyRank))-Math.min(...b.rows.map(recencyRank)));
  if($('#matchList')) $('#matchList').innerHTML=shown.length?groups.map(g=>`<details class="league-group" data-league="${esc(g.league.code)}" ${collapsed.has(g.league.code)&&!query?'':'open'}><summary><span>${crest(g.rows[0]?.leagueLogo)}${g.league.name}</span><span>${g.rows.filter(m=>m.status==='live').length?`${g.rows.filter(m=>m.status==='live').length} 场直播`:`${g.rows.length} 场`}</span></summary><div class="league-matches">${g.rows.map(card).join('')}</div></details>`).join(''):'<div class="panel-copy">已载入批次没有符合筛选的赛事；其他联赛尚未全部读取，不能据此判断现实中没有比赛。</div>';
  $$('.match').forEach(el=>el.addEventListener('click',()=>{selected=matches.find(m=>m.id===el.dataset.id);if(selected){deepLinkMatch=null;deepLinkLeague=selected.leagueCode;const url=new URL(location.href);url.searchParams.set('match',`${selected.leagueCode}:${selected.id}`);history.replaceState(null,'',url);}renderMatches();renderSelected();const target=$('#matchPickCard');target?.focus({preventScroll:true});target?.scrollIntoView({behavior:'smooth',block:'start'})}));
  if(focusedMatchId)$$('.match').find(el=>el.dataset.id===focusedMatchId)?.focus({preventScroll:true});
  if($('#matchCount')) $('#matchCount').textContent=matches.length+' 场';
  if($('#liveCount')) $('#liveCount').textContent=matches.filter(m=>m.status==='live').length+' 场源报直播 · '+matches.filter(m=>kickoffUnconfirmed(m)).length+' 场开赛待核验';
}
function renderSelected(){
  document.querySelector('.main')?.classList.toggle('has-no-match',!selected);
  if(!selected){if($('#matchEmpty'))$('#matchEmpty').textContent='当前已载入批次没有可用赛事；可刷新下一批联赛。搜索和列表尚未覆盖全部 65 个联赛。';return;}
  const m=selected,p=[m.model.home,m.model.draw,m.model.away],labels=[m.home.name,'平局',m.away.name];
  renderMatchPick(m);
  renderSelectedVirtualPicks(m);
  loadMatchResearch(m);
  if($('#leagueName')) $('#leagueName').textContent=m.league;
  if($('#homeName')) $('#homeName').textContent=teamZh(m.home.name);
  if($('#awayName')) $('#awayName').textContent=teamZh(m.away.name);
  if($('#homeCrest')) $('#homeCrest').innerHTML=teamIcon(m,'home');
  if($('#awayCrest')) $('#awayCrest').innerHTML=teamIcon(m,'away');
  if($('#score')) $('#score').textContent=`${displayedScore(m,'hs')} — ${displayedScore(m,'as')}`;
  renderLiveClock();
  if($('#shots')) $('#shots').textContent=`${m.home.sot??'—'} — ${m.away.sot??'—'}`;
  if($('#xg')) $('#xg').textContent=`${m.home.shots??'—'} — ${m.away.shots??'—'}`;
  if($('#danger')) $('#danger').textContent=Number.isFinite(m.home.possession)&&Number.isFinite(m.away.possession)?`${m.home.possession.toFixed(0)}% — ${m.away.possession.toFixed(0)}%`:'—';
  if($('#possession')) $('#possession').textContent=m.odds?.decimals?.some(Boolean)?m.odds.decimals.map(x=>x?x.toFixed(2):'—').join(' / '):'暂无';
  if($('#oddsProvider')) $('#oddsProvider').textContent=m.oddsAvailability?.complete?(m.status==='live'?'current 滚球 · 三项完整':m.odds.provider):oddsHealthText(m,true);
  if($('#marketName')) $('#marketName').textContent='基础模型参考';
  if($('#signalText')) $('#signalText').textContent=displayAction(m);
  if($('#signalReason')) $('#signalReason').textContent=`未校准的 1X2 模型说明：${m.strategy.reason}`;
  if($('#confidence')) $('#confidence').textContent=m.model.confidence;
  if($('#confidenceRing')) $('#confidenceRing').style.background=`conic-gradient(var(--lime) 0 ${m.model.confidence}%,#21332a ${m.model.confidence}%)`;
  if($('#predictions')) $('#predictions').innerHTML=p.map((v,i)=>`<div class="prediction ${m.model.hasMarketOdds&&i===m.strategy.best?'best':''}"><span>${esc(labels[i])}</span><strong>${m.model.hasMarketOdds?(v*100).toFixed(0)+'%':'—'}</strong></div>`).join('');
  if($('#fairLine')) $('#fairLine').textContent=m.model.hasMarketOdds?`${labels[m.strategy.best]} 公允赔率 ${m.strategy.fair.toFixed(2)}`:'胜平负报价不完整，公允价暂不展示';
  if($('#directPlay')) $('#directPlay').textContent=displayAction(m);
  if($('#minimumOdds')) $('#minimumOdds').textContent=m.strategy.minOdds;
  if($('#stakePct')) $('#stakePct').textContent=m.strategy.stakePct;
  if($('#cancelCondition')) $('#cancelCondition').textContent=m.strategy.cancel;
  if($('#dataFreshness')) $('#dataFreshness').textContent=scoreObservationWarning(m)|| (m.status==='live'?`${dataAgeSeconds(m)} 秒前获取`:`数据来源 ${new Date(m.capturedAt).toLocaleTimeString('zh-CN',{hour12:false})}`);
  renderEvidence();
  loadOddsHistory(m.id,m.leagueCode);
  renderSimSummary();
  // The adjacent calculator uses only explicit user hypotheses. Selecting a
  // match must not silently turn an uncalibrated model/quote into its inputs.
}
async function loadOddsHistory(matchId,leagueCode){
  if(!matchId)return;
  if(oddsHistoryMatchId===matchId&&oddsHistoryLeagueCode===leagueCode&&Date.now()-oddsHistoryFetchedAt<12000)return;
  oddsHistoryMatchId=matchId;oddsHistoryLeagueCode=leagueCode;oddsHistoryFetchedAt=Date.now();
  try{
    const res=await fetch(`/api/odds-history?matchId=${encodeURIComponent(matchId)}&league=${encodeURIComponent(leagueCode)}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!res.ok)throw new Error('价格历史暂不可用');const data=await res.json();if(matchId!==oddsHistoryMatchId)return;
    const rows=Array.isArray(data?.rows)?data.rows:[];oddsHistoryRows=rows;const shown=renderOddsHistory(rows);
    const match=matches.find(m=>m.id===matchId);
    if(match&&shown.length){
      let changedAt=Number(shown[0].captured_at)||Date.now();
      for(let i=1;i<shown.length;i++)if(['home_odds','draw_odds','away_odds'].some(k=>Number(shown[i][k])!==Number(shown[i-1][k])))changedAt=Number(shown[i].captured_at)||changedAt;
      const wasStale=match.strategy?.signal==='赔率疑似陈旧';match.oddsLastChangedAt=changedAt;match.strategy=strategyFor(match);
      if(match===selected&&(wasStale!== (match.strategy?.signal==='赔率疑似陈旧')))renderSelected();
    }
  }catch{if(matchId===oddsHistoryMatchId){renderOddsHistory([]);if($('#oddsHistoryNote'))$('#oddsHistoryNote').textContent='价格历史暂时读取失败，稍后会自动重试。';}}
}
function renderOddsHistory(rows){
  const ids=['oddsHistoryHome','oddsHistoryDraw','oddsHistoryAway'],keys=['home_odds','draw_odds','away_odds'],note=$('#oddsHistoryNote'),grid=$('#oddsHistoryGrid');
  const selector=$('#oddsHistoryProvider');
  if(!note||!grid)return [];
  const providers=[...new Set(rows.map(row=>String(row.provider||'来源未存')))];
  if(selector){const previous=selector.value;selector.innerHTML=providers.map(provider=>`<option value="${esc(provider)}">${esc(provider)}</option>`).join('');selector.value=providers.includes(previous)?previous:providers[0]||'';selector.onchange=()=>renderOddsHistory(oddsHistoryRows);selector.disabled=providers.length<2;}
  const chosen=selector?.value||providers[0];rows=rows.filter(row=>String(row.provider||'来源未存')===chosen);
  if(rows.length<2){ids.forEach(id=>$('#'+id)?.setAttribute('d',''));grid.innerHTML='';note.textContent=rows.length?'已记录第一个价格点，等待下一次变化':'暂时没有可验证的历史赔率';return rows}
  const all=rows.flatMap(r=>keys.map(k=>Number(r[k])).filter(v=>Number.isFinite(v)&&v>1));if(!all.length){ids.forEach(id=>$('#'+id)?.setAttribute('d',''));grid.innerHTML='';note.textContent='历史记录没有有效报价';return rows;}let min=Math.min(...all),max=Math.max(...all);const spread=Math.max(.1,max-min);min-=spread*.15;max+=spread*.15;
  const W=600,H=150,L=12,R=12,T=12,B=18,x=i=>L+i*(W-L-R)/Math.max(1,rows.length-1),y=v=>T+(max-v)*(H-T-B)/(max-min);
  grid.innerHTML=[min,(min+max)/2,max].map(v=>`<line class="odds-grid" x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}"></line>`).join('');
  keys.forEach((key,idx)=>{let started=false,d='';rows.forEach((r,i)=>{const v=Number(r[key]);if(i&&r.provider!==rows[i-1].provider)started=false;if(!Number.isFinite(v)||v<=1){started=false;return}d+=`${started?'L':'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;started=true});$('#'+ids[idx])?.setAttribute('d',d.trim())});
  const first=new Date(rows[0].captured_at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'}),last=new Date(rows.at(-1).captured_at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'});
  note.textContent=`${rows.length} 个 ${chosen} 同源价格点 · 共 ${providers.length} 个提供方 · ${first}—${last} · 提供方未给独立更新时间`;
  return rows;
}
function renderLiveClock(){
  if(!selected) return;
  const m=selected;
  if(m.status==='live'){
    if(m.feedStale){if($('#minute'))$('#minute').textContent=`上次记录 ${m.clock||`${m.minute}′`} · 当前时间未核验`;return}
    const seconds=Math.min(120*60,m.clockSeconds||m.minute*60);
    if($('#minute')) $('#minute').textContent=`源头 ${statusText(m)} · ${Math.max(0,Math.floor((Date.now()-Number(m.lastProgressAt||m.capturedAt||Date.now()))/1000))} 秒未推进`;
    const progress=clamp(seconds/(90*60)*100,2,100);
    if($('#progress')) $('#progress').style.width=progress+'%';
    if($('#progressTick')) $('#progressTick').style.left=progress+'%';
  }else{
    if($('#minute')) $('#minute').textContent=m.status==='finished'?'已完场':m.status==='unverified'?`${statusText(m)} · 时间不可信`:kickoffUnconfirmed(m)?statusText(m):`${statusText(m)} · 未开赛`;
    const progress=m.status==='finished'?100:2;
    if($('#progress')) $('#progress').style.width=progress+'%';
    if($('#progressTick')) $('#progressTick').style.left=progress+'%';
  }
}
function renderEvidence(){
  const m=selected;
  if(!m) return;
  const offers=m.odds?.offers||[];
  const quoteNote=m.odds?.quoteReason?`<small class="market-extra">${esc(m.odds.quoteReason)}；源头更新时刻未知，本次抓取不等于可成交保证。</small>`:'';
  const offerBoard=offers.length?`<div class="odds-board">${offers.map(o=>{const extras=[];if(o.total?.line!=null)extras.push(`${o.total.phase==='close-reference'?'close 字段参考':'当前'}大小 ${esc(o.total.line)}：大 ${o.total.overOdds.toFixed(2)} / 小 ${o.total.underOdds.toFixed(2)}`);if(o.spread?.homeLine!=null)extras.push(`${o.spread.phase==='close-reference'?'close 字段参考':'当前'}让球：主 ${esc(o.spread.homeLine)} @ ${o.spread.homeOdds.toFixed(2)} / 客 ${esc(o.spread.awayLine)} @ ${o.spread.awayOdds.toFixed(2)}`);return `<div><div class="odds-offer"><span>${esc(o.provider)}</span>${o.decimals.map(v=>`<b>${Number.isFinite(v)?v.toFixed(2):'—'}</b>`).join('')}</div><small class="market-extra">${esc(o.quoteReason)}</small>${extras.length?`<small class="market-extra">${extras.join(' · ')}</small>`:''}</div>`}).join('')}</div>`:'';
  const odds=m.odds?.decimals?.some(Boolean)?`${esc(m.odds.provider)}：主 ${m.odds.decimals[0]?.toFixed(2)||'—'} / 平 ${m.odds.decimals[1]?.toFixed(2)||'—'} / 客 ${m.odds.decimals[2]?.toFixed(2)||'—'}${m.oddsAvailability?.complete?'':`<small class="market-extra">${esc(oddsHealthText(m))}</small>`}${quoteNote}${offerBoard}`:`${esc(oddsHealthText(m))}${quoteNote}${offerBoard}；最后尝试 ${new Date(m.capturedAt||Date.now()).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}`;
  const sourceTime=m.date?new Date(m.date).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
  const consistency=m.scoreConflict?m.official?`ESPN 与 ${officialLabel(m)}比分或状态不一致，已暂停模拟`:'同一 ESPN 供稿商端点比分/状态不一致，已暂停模拟':m.clockConflict?`同一 ESPN 供稿商两条通道比分相同但比赛分钟不同；较新分钟仅为临时参考，暂停滚球模拟`:m.official?`ESPN 与 ${officialLabel(m)}两个独立公开渠道已匹配；仍须核验各自更新时间`:`${m.sourceCount||1} 个 ESPN 端点；不等于独立比分供稿商`;
  const rows=[['状态',`${esc(statusText(m))} · 比分 ${displayedScore(m,'hs')}—${displayedScore(m,'as')}`,'源头'],['一致性',esc(consistency),(m.scoreConflict||m.clockConflict)?'警告':'有限核验'],['时间源',`${sourceTime}；抓取 ${new Date(m.capturedAt||0).toLocaleTimeString('zh-CN',{hour12:false})}，源头更新时间未知`,'源头'],['现场推进',m.status==='live'?`比分/分钟/状态最后变化于 ${new Date(m.lastProgressAt||m.capturedAt).toLocaleTimeString('zh-CN',{hour12:false})}`:m.status==='unverified'?'源头仍声称直播，但比赛时钟与开赛时间矛盾；不计入实时场次':kickoffUnconfirmed(m)?'已到计划开球时间，但来源仍返回未开赛；抓取成功不代表现场更新':'非直播','新鲜度'],['射门',`射正 ${m.home.sot??'—'}—${m.away.sot??'—'}；总射门 ${m.home.shots??'—'}—${m.away.shots??'—'}`,'场面'],['控球',Number.isFinite(m.home.possession)&&Number.isFinite(m.away.possession)?`${m.home.possession.toFixed(1)}%—${m.away.possession.toFixed(1)}%`:'本场暂未提供','统计'],['近期',`${esc(teamZh(m.home.name))} ${esc(m.home.form||'—')} ｜ ${esc(teamZh(m.away.name))} ${esc(m.away.form||'—')}`,'走势'],['市场',odds,'赔率']];
  if($('#eventStream')) $('#eventStream').innerHTML=rows.map(r=>`<div class="event"><time>${r[0]}</time><span>${r[1]}</span><em>${r[2]}</em></div>`).join('');
  if($('#eventStream')&&m.sourceObservations?.length){
    const observations=m.sourceObservations.map(o=>`<div class="event"><time>${esc(o.endpoint||'ESPN')}</time><span>本次记录：${esc(o.home??'—')}—${esc(o.away??'—')}，${esc(o.state||'状态缺失')}，${Number.isFinite(Number(o.clock))?Math.floor(Number(o.clock)/60)+'′':'分钟缺失'}。同属 ESPN 供稿；抓取不证明源头已更新。</span><em>原始比较</em></div>`).join('');
    $('#eventStream').insertAdjacentHTML('afterbegin',observations);
  }
  if(m.official&&$('#eventStream')){
    const o=m.official,when=new Date(o.capturedAt).toLocaleTimeString('zh-CN',{hour12:false});
    const safeUrl=String(o.sourceUrl||'').startsWith('https://www.jleague.jp/en/match/')||String(o.sourceUrl||'').startsWith('https://www.the-afc.com/en/club/afc_champions_league_elite.html/news/')?o.sourceUrl:'https://www.jleague.jp/en/acle/match/';
    const lineup=o.lineup?`主队首发：${o.lineup.home.map(p=>esc(p.name)+' ('+esc(p.position)+')').join('、')}<br>客队首发：${o.lineup.away.map(p=>esc(p.name)+' ('+esc(p.position)+')').join('、')}`:'官方页面暂未提供完整双方首发';
    const primary=m.primaryObservation?`ESPN 本次记录：${esc(m.primaryObservation.status)} ${esc(m.primaryObservation.hs)}—${esc(m.primaryObservation.as)}，${esc(m.primaryObservation.clock||'未给分钟')}。`:'ESPN 本次记录仍见上方状态行。';
    $('#eventStream').insertAdjacentHTML('afterbegin',`<div class="event"><time>官方核对</time><span><a href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">${officialLabel(m)}来源页</a> · ${esc(when)} 抓取；${o.publishedDate?`赛报发表于 ${esc(o.publishedDate)}；`:''}来源更新时间未提供。官方记录：${esc(o.score?.[0]??'—')}—${esc(o.score?.[1]??'—')}${o.minute==null?'':`，${esc(o.minute)}′`}。${primary}${m.scoreConflict?'与 ESPN 状态或比分冲突，暂停模拟。':''}<br>${lineup}<br>${o.lineup?'首发已采集，尚未作为模型校准特征。':'首发尚未采集，未参与模型计算。'}</span><em>独立来源</em></div>`);
  }
}

function mergeFeedEvents(existing,rows,targets,mode='all'){
  const targetCodes=new Set(targets.map(l=>l.code));
  const newIds=new Set(rows.map(m=>m.id));
  const retained=existing.filter(m=>withinDisplayWindow(m)&&!newIds.has(m.id)).map(m=>{
    if(targetCodes.has(m.leagueCode)&&(mode!=='live'||needsLiveScan(m))){m.feedStale=true;m.strategy=strategyFor(m)}
    return m;
  });
  const previous=new Map(existing.map(m=>[m.id,m]));
  for(const row of rows){
    const old=previous.get(row.id);
    if(old?.status==='live'&&row.status==='live'&&(row.period<old.period||row.period===old.period&&row.minute+2<old.minute||row.hs<old.hs||row.as<old.as)){
      row.primaryObservation={status:old.status,hs:old.hs,as:old.as,clock:old.clock};
      row.scoreConflict=true;row.status='unverified';row.statusDetail='新抓取比上次直播分钟或比分倒退；等待复核';
    }
    const same=old&&old.status===row.status&&old.clockSeconds===row.clockSeconds&&old.minute===row.minute&&old.period===row.period&&old.hs===row.hs&&old.as===row.as;
    row.lastProgressAt=same?Number(old.lastProgressAt||old.capturedAt||row.capturedAt):Number(row.capturedAt||Date.now());
    row.strategy=strategyFor(row);
  }
  const unique=new Map();
  [...retained,...rows].forEach(m=>unique.set(m.id,m));
  return sortMatches([...unique.values()]);
}
function restoreCache(){
  try{
    const cached=JSON.parse(localStorage.getItem(CACHE_KEY)||'[]');
    if(!Array.isArray(cached)||!cached.length)return false;
    matches=cached.filter(m=>Number.isFinite(new Date(m?.date).getTime())&&m?.home&&m?.away).map(m=>{
      const row={...m,date:new Date(m.date),capturedAt:Number(m.capturedAt||0),feedStale:true};
      if(row.home)row.home={...row.home,name:displayTeamName(row.home.originalName||teamOriginal(row.home.name),row.leagueCode)};
      if(row.away)row.away={...row.away,name:displayTeamName(row.away.originalName||teamOriginal(row.away.name),row.leagueCode)};
      row.model=modelFor(row);
      row.strategy=strategyFor(row);
      return row;
    }).filter(withinDisplayWindow);
    if(!matches.length)return false;
    selected=matches.find(m=>m.status==='live')||matches.find(m=>m.status==='soon')||matches[0];
    renderLeagueOptions();renderMatches();renderSelected();
    if($('#dataMode')) $('#dataMode').textContent='显示上次成功数据';
    return true;
  }catch{return false}
}

function rawScoreFact(event,endpoint){
  const c=event?.competitions?.[0]||{},s=c.status||event?.status||{},teams=c.competitors||[];
  const home=teams.find(t=>t.homeAway==='home')||teams[0]||{},away=teams.find(t=>t.homeAway==='away')||teams[1]||{};
  const score=v=>v!=null&&/^\d+$/.test(String(v))?Number(v):null;
  return {endpoint,state:s.type?.state||'pre',clock:Number(s.clock||0),completed:!!s.type?.completed,home:score(home.score),away:score(away.score)};
}
function rawScoreProgress(f){
  const tie=f.completed||f.state==='post'?3:f.state==='in'?2:1;
  return f.clock*100+tie*10+(f.home??0)+(f.away??0);
}
function joinScoreFeeds(serverEvents,siteEvents,capturedAt){
  const groups=new Map();
  for(const event of serverEvents||[])if(event?.id)groups.set(String(event.id),{...(groups.get(String(event.id))||{}),server:event});
  for(const event of siteEvents||[])if(event?.id)groups.set(String(event.id),{...(groups.get(String(event.id))||{}),site:event});
  return [...groups.values()].map(({server,site})=>{
    const versions=[server,site].filter(Boolean),chosen=versions.sort((a,b)=>rawScoreProgress(rawScoreFact(b,b===site?'ESPN Site API':b._edgeEndpoint||'ESPN CDN'))-rawScoreProgress(rawScoreFact(a,a===site?'ESPN Site API':a._edgeEndpoint||'ESPN CDN')))[0];
    const observations=new Map();
    for(const o of server?._edgeObservations||[])if(o.endpoint)observations.set(o.endpoint,o);
    if(server&&!observations.size)observations.set(server._edgeEndpoint||'ESPN CDN',rawScoreFact(server,server._edgeEndpoint||'ESPN CDN'));
    if(site)observations.set('ESPN Site API',rawScoreFact(site,'ESPN Site API'));
    const facts=[...observations.values()],first=facts[0]||{},leader=rawScoreFact(chosen,chosen===site?'ESPN Site API':chosen._edgeEndpoint||'ESPN CDN');
    const conflict=Boolean(server?._edgeScoreConflict)||facts.some(o=>o.home!==first.home||o.away!==first.away||o.state!==first.state);
    const clockConflict=Boolean(server?._edgeClockConflict)||facts.some(o=>o.state==='in'&&first.state==='in'&&Math.abs(o.clock-first.clock)>120);
    const cdn=observations.get('ESPN CDN');
    const provisional=(conflict||clockConflict)&&chosen===site&&cdn?.home!=null&&cdn?.away!=null&&leader.home!=null&&leader.away!=null&&leader.clock-cdn.clock>=120&&leader.home>=cdn.home&&leader.away>=cdn.away;
    return {...chosen,_edgeOfficial:server?._edgeOfficial||chosen._edgeOfficial,_edgeLeagueLogo:server?._edgeLeagueLogo||chosen._edgeLeagueLogo,_edgeCapturedAt:chosen===site?capturedAt:server?._edgeCapturedAt||capturedAt,_edgeEndpoint:chosen===site?'ESPN Site API':chosen._edgeEndpoint||'ESPN CDN',_edgeSourceCount:observations.size,_edgeScoreConflict:conflict,_edgeClockConflict:clockConflict,_edgeProvisionalLead:provisional||Boolean(server?._edgeProvisionalLead),_edgeObservations:facts};
  });
}
async function fetchLeagueFeed(league,dates,mode='all'){
  const started=performance.now();
  const fetchJson=async(url,limit,headers)=>{
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),limit);
    try{const res=await fetch(url,{cache:'no-store',signal:controller.signal,headers});if(!res.ok){await res.body?.cancel().catch(()=>{});throw Error(`HTTP ${res.status}`)}const json=await res.json();json._edgeFetchedAt=Date.now();return json;}
    finally{clearTimeout(timeout)}
  };
  const extended=mode==='all'&&extendedCalendarLeagues.has(league.code),year=String(new Date().getUTCFullYear());
  const requestDates=extended?extendedDateWindow():dates;
  const serverUrl=`/api/feed?league=${encodeURIComponent(league.code)}&dates=${encodeURIComponent(requestDates)}&mode=${mode==='live'?'live':'all'}`;
  const siteUrl=`https://site.web.api.espn.com/apis/site/v2/sports/soccer/${encodeURIComponent(league.code)}/scoreboard?dates=${encodeURIComponent(extended?year:dates)}&limit=${extended?1000:100}`;
  const cached=seasonFeedCache.get(league.code),externalTask=extended&&cached&&Date.now()-cached.at<30*60000?Promise.resolve(cached.json):fetchJson(siteUrl,extended?18000:12000).then(json=>{if(extended)seasonFeedCache.set(league.code,{at:Date.now(),json});return json});
  // The browser's public Site API is CORS-readable. Avoid parsing the same
  // large fixture feed inside the long-lived local Worker on every tab poll.
  // Keep local dual-endpoint checks for live/selected/official-linked games,
  // periodically sample other leagues, and fall back locally on a real error.
  const checkedAt=localFeedVerificationAt.get(league.code)||0,now=Date.now();
  const important=mode==='live'||league.code==='afc.champions'||league.code==='jpn.1'||selected?.leagueCode===league.code;
  let siteJson=null,serverJson=null;
  try{siteJson=await externalTask;}catch{}
  if(shouldFetchLocalFeed({now,lastCheckedAt:checkedAt,important,siteAvailable:!!siteJson})){
    try{serverJson=await fetchJson(serverUrl,league.code==='afc.champions'?22000:15000,{'x-edge-bounded-feed':'1','x-edge-site-available':siteJson?'1':'0'});}catch{}
    localFeedVerificationAt.set(league.code,Date.now());
  }else if(!checkedAt)localFeedVerificationAt.set(league.code,now);
  const serverEvents=Array.isArray(serverJson?.events)?serverJson.events:[],siteEvents=Array.isArray(siteJson?.events)?siteJson.events:[];
  if(!serverJson&&!siteJson){
    feedHealth.set(league.code,{status:'error',latency:Math.round(performance.now()-started),events:0,sources:0,conflicts:0,at:Date.now(),error:'两个比分通道均不可用'});
    return [];
  }
  league.logo=serverJson?.content?.sbData?.leagues?.[0]?.logos?.[0]?.href||siteJson?.leagues?.[0]?.logos?.[0]?.href||league.logo;
  const events=joinScoreFeeds(serverEvents,siteEvents,Number(siteJson?._edgeFetchedAt)||Date.now());
  const current=events.map(e=>normalizeEvent(e,league)).filter(m=>m&&withinDisplayWindow(m));
  const future=current.filter(m=>m.status==='soon'&&Number(m.date)>Date.now()),complete=future.filter(m=>m.oddsAvailability?.complete),partial=future.filter(m=>['partial','invalid'].includes(m.oddsAvailability?.code)),missing=future.filter(m=>!m.oddsAvailability?.complete&&!['partial','invalid'].includes(m.oddsAvailability?.code)),executionMissing=future.filter(m=>Number(m.date)-Date.now()<=24*3600000&&!m.oddsAvailability?.complete);
  feedHealth.set(league.code,{status:current.length?'ok':'empty',latency:Math.round(performance.now()-started),events:current.length,sources:current.reduce((max,m)=>Math.max(max,Number(m.sourceCount)||0),0),conflicts:current.filter(m=>m.scoreConflict).length,clockConflicts:current.filter(m=>m.clockConflict).length,at:Date.now(),lastSuccessAt:Date.now(),server:!!serverJson,siteApi:!!siteJson,upcoming:future.length,oddsComplete:complete.length,oddsPartial:partial.length,oddsMissing:missing.length,executionMissing:executionMissing.length});
  return current;
}
function renderFeedHealth(){
  const rows=[...feedHealth.entries()].map(([code,value])=>({code,name:leagues.find(l=>l.code===code)?.name||code,...value}));
  const ok=rows.filter(r=>r.status==='ok'),empty=rows.filter(r=>r.status==='empty'),errors=rows.filter(r=>r.status==='error');
  const latency=rows.length?Math.round(rows.reduce((s,r)=>s+(Number(r.latency)||0),0)/rows.length):0;
  const dual=rows.filter(r=>r.sources>=2).length,conflicts=rows.reduce((s,r)=>s+(Number(r.conflicts)||0),0),clockConflicts=rows.reduce((s,r)=>s+(Number(r.clockConflicts)||0),0);
  if($('#healthChecked'))$('#healthChecked').textContent=`${rows.length}/${leagues.length}`;
  if($('#healthOk'))$('#healthOk').textContent=`${ok.length}`;
  if($('#healthEmpty'))$('#healthEmpty').textContent=`${empty.length}`;
  if($('#healthError'))$('#healthError').textContent=`${errors.length}`;
  if($('#healthLatency'))$('#healthLatency').textContent=rows.length?`${latency} ms`:'—';
  if($('#healthDual'))$('#healthDual').textContent=`${dual}`;
  if($('#healthConflicts'))$('#healthConflicts').textContent=`${conflicts}`;
  if($('#healthClock'))$('#healthClock').textContent=`${clockConflicts}`;
  const oddsComplete=rows.reduce((s,r)=>s+Number(r.oddsComplete||0),0),oddsPartial=rows.reduce((s,r)=>s+Number(r.oddsPartial||0),0),oddsMissing=rows.reduce((s,r)=>s+Number(r.oddsMissing||0),0),executionMissing=rows.reduce((s,r)=>s+Number(r.executionMissing||0),0),lastSuccess=Math.max(0,...rows.map(r=>Number(r.lastSuccessAt||0)));
  if($('#healthOddsComplete'))$('#healthOddsComplete').textContent=`${oddsComplete}`;
  if($('#healthOddsPartial'))$('#healthOddsPartial').textContent=`${oddsPartial}`;
  if($('#healthOddsMissing'))$('#healthOddsMissing').textContent=`${oddsMissing}`;
  if($('#healthOdds24hMissing'))$('#healthOdds24hMissing').textContent=`${executionMissing}`;
  if($('#healthOddsLast'))$('#healthOddsLast').textContent=lastSuccess?new Date(lastSuccess).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
  const attention=rows.filter(r=>r.status==='error'||r.conflicts||r.oddsPartial||r.executionMissing).sort((a,b)=>Number(b.executionMissing||0)-Number(a.executionMissing||0)||Number(b.oddsPartial||0)-Number(a.oddsPartial||0)).slice(0,8);
  if($('#healthDetails'))$('#healthDetails').innerHTML=attention.length?attention.map(r=>`<div class="daily-row"><span>${r.name}</span><span>${r.status==='error'?'赛事源连接失败':r.conflicts?`${r.conflicts} 场比分冲突`:r.executionMissing?`24h 内 ${r.executionMissing} 场无完整 1X2`:`${r.oddsPartial} 场只有部分价格`}</span><b class="${r.status==='error'||r.executionMissing?'negative':'neutral'}">${r.status==='error'?'自动重试':`最后成功 ${new Date(r.lastSuccessAt||r.at).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}`}</b></div>`).join(''):dual===0?`<div class="panel-copy" style="padding:9px 0">ESPN 第二端点当前没有返回赛事；${matches.some(m=>m.status==='live')?'直播场次不能进行双端点核验，自动模拟已暂停。':'来源尚未确认直播，不能据此判断实际没有比赛。'}即使 ESPN 双端点都返回，也不是独立供稿商。</div>`:'<div class="panel-copy" style="padding:9px 0">未发现端点连接、比分冲突或 24 小时内赔率完整性问题；同一 ESPN 供稿商的双端点不等于独立供稿商。</div>';
  const coverageRows=leagues.map(league=>{const health=feedHealth.get(league.code),last=Number(health?.lastSuccessAt||0),age=last?Math.floor((Date.now()-last)/60000):null;return `<div class="daily-row"><span>${esc(league.name)}</span><span>${!health?'尚未轮到本批':health.status==='error'?'最近抓取失败':health.status==='empty'?'已检查，当前无赛事':'已载入 '+health.events+' 场'}</span><b class="${!last||age>5?'negative':'neutral'}">${last?`成功读取 ${age} 分钟前`:'尚无成功读取'}</b></div>`;}).join('');
  $('#healthDetails')?.insertAdjacentHTML('beforeend',`<details class="feed-coverage"><summary>查看全部 ${leagues.length} 个联赛的读取状态与时间</summary>${coverageRows}</details>`);
}
async function refreshData(manual=false,mode='all'){
  if(refreshing){
    if(manual) refreshQueued=true;
    return;
  }
  if(!matches.length) cleanSimState();
  const liveCodes=[...new Set(matches.filter(m=>needsLiveScan(m)).map(m=>m.leagueCode))];
  const orderedCodes=(mode==='live'?liveCodes:rotatingLeagues.map(league=>league.code));
  const upcomingCodes=matches.filter(m=>m.status==='soon'&&Number(m.date)>Date.now()&&Number(m.date)-Date.now()<=48*3600000).sort((a,b)=>Number(a.date)-Number(b.date)).map(m=>m.leagueCode);
  const urgentCodes=[deepLinkLeague,activeLeague==='all'?null:activeLeague,selected?.leagueCode,...(mode==='live'?liveCodes:upcomingCodes)].filter(Boolean);
  const plan=planRotatingLeagueBatch(orderedCodes,mode==='live'?liveRefreshCursor:allRefreshCursor,urgentCodes,8,mode==='live'?1:2);
  if(mode==='live')liveRefreshCursor=plan.nextCursor;
  else {allRefreshCursor=plan.nextCursor;try{sessionStorage.setItem('edge-feed-cursor-v1',String(allRefreshCursor))}catch{}}
  const targets=plan.selected.map(code=>leagues.find(league=>league.code===code)).filter(Boolean);
  if(!targets.length){nextLiveAt=Date.now()+15000;return;}
  refreshing=true;
  if($('#refreshData')) $('#refreshData').textContent='刷新中…';
  if($('#dataMode')) $('#dataMode').textContent=mode==='live'?'正在同步现场比赛':`正在轮转刷新 ${targets.length}/${leagues.length} 联赛`;
  const dates=dateWindow();
  try{
    const settleRows=[];
    for(let i=0;i<targets.length;i+=2){
      const batchTargets=targets.slice(i,i+2),batch=await Promise.allSettled(batchTargets.map(league=>fetchLeagueFeed(league,dates,mode)));
      settleRows.push(...batch);
      const partial=batch.filter(x=>x.status==='fulfilled').flatMap(x=>x.value||[]);
      if(partial.length){matches=mergeFeedEvents(matches,partial,batchTargets,mode);selected=matches.find(m=>m.id===selected?.id)||matches.find(m=>m.status==='live')||matches.find(m=>m.status==='soon')||matches[0];renderLeagueOptions();renderMatches();renderSelected();if($('#dataMode'))$('#dataMode').textContent=`正在扫描 · 已显示 ${matches.length} 场`;}
    }
    const rows=settleRows.filter(x=>x.status==='fulfilled').flatMap(x=>x.value||[]);
    if(!rows.length&&targets.every(l=>feedHealth.get(l.code)?.status==='error')) throw new Error('all feeds unavailable');
    const oldId=selected?.id;
    matches=mergeFeedEvents(matches,rows,targets,mode);
    try{localStorage.setItem(CACHE_KEY,JSON.stringify(matches));}catch{/* Storage limits must not mark a successful feed fetch as failed. */}
    selected=matches.find(m=>m.id===oldId)||matches.find(m=>m.status==='live')||matches.find(m=>m.status==='soon')||matches[0];
    applyDeepLinkSelection();
    settleOpenBets();
    const placed=0; // New automatic tickets are created by the independent comparison portfolios on the server.
    recordScanJournal(placed);
    renderSimConfig();
    renderLeagueOptions();renderMatches();renderSelected();updateSyncLabel();
    renderFeedHealth();
    lastSyncAt=Date.now();
    nextLiveAt=lastSyncAt+15000;
    if(mode==='all') nextAllAt=lastSyncAt+30000;
    const liveCount=matches.filter(m=>m.status==='live').length;
    const oddsCount=matches.filter(m=>m.odds?.decimals?.some(Boolean)).length,liveOddsCount=matches.filter(m=>m.status==='live'&&m.odds?.liveVerified).length;
    const conflicts=matches.filter(m=>m.scoreConflict).length;
    const staleCount=matches.filter(quoteNeedsRefresh).length;
    if($('#dataMode')) $('#dataMode').textContent=liveCount?`现场模式 · ${liveCount} 场直播`:`本批已检查 ${targets.length}/${leagues.length} 联赛`;
    if($('#streamStatus')) $('#streamStatus').textContent=(liveCount?`直播联赛每 15 秒轮转刷新（源头更新频率未知） · ${oddsCount} 场含公开价格 · ${liveOddsCount} 场明确滚球`:`联赛按批轮转刷新 · 本批 ${targets.length}/${leagues.length} · ${matches.filter(m=>kickoffUnconfirmed(m)).length} 场开赛待核验 · ${oddsCount} 场含公开价格`)+(conflicts?` · ${conflicts} 场源冲突`:``)+(staleCount?` · ${staleCount} 场上次缓存（不下注）`:``);
    if(manual) toast(`本批已重新抓取 ${targets.length} 个联赛；其余联赛继续轮转，当前显示 ${matches.length} 场赛事`);
  }catch{
    const has=matches.length||restoreCache();
    const affected=new Set(targets.map(l=>l.code));
    matches=matches.filter(withinDisplayWindow).map(m=>{
      if(affected.has(m.leagueCode)){m.feedStale=true;m.strategy=strategyFor(m)}
      return m;
    });
    selected=matches.find(m=>m.id===selected?.id)||matches.find(m=>m.status==='live')||matches[0];
    renderLeagueOptions();renderMatches();renderSelected();renderFeedHealth();
    if($('#dataMode')) $('#dataMode').textContent=has?'数据暂时中断 · 保留上次结果':'全球赛事数据暂不可用';
    if($('#streamStatus')) $('#streamStatus').textContent='15 秒后自动重试';
    nextLiveAt=Date.now()+15000;
    nextAllAt=Date.now()+60000;
    if(manual) toast('本次刷新失败，已保留现有数据');
  }finally{
    refreshing=false;
    if($('#refreshData')) $('#refreshData').textContent='刷新下一批联赛';
    if(refreshQueued){
      refreshQueued=false;
      setTimeout(()=>refreshData(true,'all'),300);
    }
    updateSyncLabel();
  }
}
function updateSyncLabel(){
  if(refreshing){
    if($('#syncTime')) $('#syncTime').textContent='正在同步';
    return;
  }
  const now=Date.now(),hasLive=matches.some(m=>needsLiveScan(m)),next=hasLive?Math.min(nextLiveAt||Infinity,nextAllAt||Infinity):nextAllAt;
  const left=Number.isFinite(next)?Math.max(0,Math.ceil((next-now)/1000)):0;
  const stamp=lastSyncAt?new Date(lastSyncAt).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'}):'等待首次同步';
  if($('#syncTime')) $('#syncTime').textContent=`${stamp} · ${left} 秒后刷新`;
}
function scheduler(){
  if(document.hidden)return;
  const now=Date.now();
  if(now-lastLedgerPollAt>=60000)syncRemoteLedger();
  if(!refreshing && now>=(nextAllAt||0)) refreshData(false,'all');
  else if(!refreshing&&matches.some(m=>needsLiveScan(m))&&now>=(nextLiveAt||0)) refreshData(false,'live');
  if(now-lastResultReconcileAt>=300000) reconcileOpenBets();
  if(selected?.status==='live'){
    const age=dataAgeSeconds(selected);
    if($('#dataFreshness')) $('#dataFreshness').textContent=selected.feedStale?`上次缓存 · ${age} 秒前获取`:`${age} 秒前获取`;
    if(age>90 && selected.strategy.signal!=='数据过期'&&selected.strategy.signal!=='来源失联'){selected.strategy=strategyFor(selected);renderSelected();renderMatches()}
  }
  renderLiveClock();
  updateSyncLabel();
}

function calc(){
  const oddsText=String($('#odds')?.value||'').trim(),probText=String($('#probability')?.value||'').trim(),budgetText=String($('#bankroll')?.value||'').trim();
  const o=Number(oddsText),prob=Number(probText),b=Number(budgetText),p=prob/100;
  const validOdds=oddsText!==''&&Number.isFinite(o)&&o>1&&o<=100;
  const validProb=probText!==''&&Number.isFinite(prob)&&prob>0&&prob<100;
  const validBudget=budgetText!==''&&Number.isFinite(b)&&b>0;
  if($('#oddsOut'))$('#oddsOut').textContent=validOdds?o.toFixed(2):'未输入';
  if($('#probOut'))$('#probOut').textContent=validProb?`${prob}%`:'未输入';
  if(!validOdds||!validProb||!validBudget){
    if($('#ev')){$('#ev').textContent='—';$('#ev').className='';}
    if($('#stake'))$('#stake').textContent='—';
    if($('#calculatorStatus'))$('#calculatorStatus').textContent='请输入有效的赔率（大于 1）、假设胜率（0–100%）和正数预算；不会自动带入本场数据。';
    return;
  }
  const ev=p*o-1;
  const k=Math.max(0,(p*o-1)/(o-1))/4;
  const cap=b*.025;
  const stake=Math.min(cap,b*k);
  if($('#ev')) $('#ev').textContent=(ev>=0?'+':'')+(ev*100).toFixed(1)+'%';
  if($('#ev')) $('#ev').className=ev>0?'good':'';
  if($('#stake')) $('#stake').textContent=(ev>0?Math.floor(stake):0)+' 元';
  if($('#calculatorStatus'))$('#calculatorStatus').textContent='仅基于你输入的假设；未验证模型概率、报价时效或实际可得性。';
}
function toast(msg){
  const t=$('#toast');if(!t) return;
  t.textContent=msg;t.classList.add('show');clearTimeout(t.timer);t.timer=setTimeout(()=>t.classList.remove('show'),3000);
}

$$('.filter').forEach(btn=>btn.addEventListener('click',()=>{activeFilter=btn.dataset.filter;$$('.filter').forEach(b=>b.classList.toggle('active',b===btn));renderMatches()}));
if($('#leagueFilter')) $('#leagueFilter').addEventListener('change',e=>{activeLeague=e.target.value;renderMatches()});
if($('#matchSearch')) $('#matchSearch').addEventListener('input',()=>renderMatches());
if($('#backToMatches')) $('#backToMatches').addEventListener('click',()=>{const target=$('.match.active')||$('#matchList');target?.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'});target?.focus?.({preventScroll:true});});
['odds','probability','bankroll'].forEach(id=>{const el=$('#'+id);if(el) el.addEventListener('input',calc);});
if($('#refreshData')) $('#refreshData').addEventListener('click',()=>refreshData(true,'all'));
if($('#placeSimBet')) $('#placeSimBet').addEventListener('click',placeSimBet);
if($('#simStake')){
  $('#simStake').value=SIM_STAKE_DEFAULT;
  if($('#simStakeLabel')) $('#simStakeLabel').textContent=String(SIM_STAKE_DEFAULT);
  $('#simStake').addEventListener('input',()=>{if($('#simStakeLabel')) $('#simStakeLabel').textContent=$('#simStake').value||'0'});
}
['simAutoEnabled','simAutoStake','simAutoStakePct','simAutoMinEdge','simAutoLiveOnly','simAutoMode','simAutoMaxBets','simDailyStopLoss','simMaxExposure'].forEach(id=>{
  const el=$('#'+id);if(!el) return;
  const onUpdate=()=>updateSimConfigFromUI();
  el.addEventListener('input',onUpdate);
  el.addEventListener('change',onUpdate);
});
if($('#resetBalanceBtn')) $('#resetBalanceBtn').addEventListener('click',async()=>{
  const initial=asMoney($('#simInitialBalance')?.value);
  if(!initial){toast('起始本金不能为 0');return;}
  if(openExposure()>0){toast('仍有未结算模拟单，结算或作废后才能开始新周期');return;}
  if(!remoteLedgerReady||ledgerPolling){toast('请等待本机账本连接并完成同步后再开始新周期');return;}
  clearTimeout(remoteSaveTimer);
  if(Number(localStorage.getItem(LEDGER_UPDATED_KEY))>remoteUpdatedAt&&!await flushRemoteLedger()){
    toast('尚有未同步的账本改动；新周期没有提交');return;
  }
  let committed=false,submissionStarted=false,writeStatus=null;
  try{
    const fresh=await fetch('/api/ledger',{cache:'no-store',signal:AbortSignal.timeout(15000)});
    const latest=await fresh.json();
    if(!fresh.ok||!latest?.ok||!latest.ledger?.state)throw new Error('本机账本暂时无法核对');
    if(Number(latest.ledger.updatedAt)!==remoteUpdatedAt){await syncRemoteLedger();toast('账本刚被更新，请核对后重试新周期');return;}
    const canonical=latest.ledger.state;
    if(!Array.isArray(canonical.records)||canonical.records.some(record=>record.status==='open'||record.status==='review')){toast('服务端仍有未结算或待复核票，新周期未提交');return;}
    const previousBalance=Number(canonical.balance),previousStartAt=Number(canonical.portfolioStartAt)||0,previousTicketCount=canonical.records.filter(record=>Number(record.ts)>=previousStartAt).length;
    if(!Number.isFinite(previousBalance)||previousBalance<0)throw new Error('服务端账本余额无效');
    const preview=`将结束当前个人手动模拟资金周期：\n当前余额：¥${formatMoney(previousBalance)}\n本周期票据：${previousTicketCount} 张\n新周期起始本金：¥${formatMoney(initial)}\n\n所有历史票及其原金额保持不变。确认开始新周期吗？`;
    if(!window.confirm(preview))return;
    const startedAt=Math.max(Date.now(),previousStartAt+1);
    const id=`period-${startedAt}-${crypto.randomUUID().slice(0,8)}`;
    const nextState={...canonical,initialBalance:initial,balance:initial,dayStartBalance:initial,day:todayKey(),portfolioStartAt:startedAt,periodHistory:[...(Array.isArray(canonical.periodHistory)?canonical.periodHistory:[]),{id,startedAt,initialBalance:initial,previousBalance,previousStartAt,previousTicketCount}]};
    const updatedAt=Math.max(Date.now(),remoteUpdatedAt+1);
    submissionStarted=true;
    const response=await fetch('/api/ledger',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({state:nextState,settings:latest.ledger.settings,updatedAt,baseUpdatedAt:remoteUpdatedAt}),cache:'no-store',signal:AbortSignal.timeout(20000)});
    writeStatus=response.status;
    if(response.status===409){await syncRemoteLedger();toast('账本并发更新，新周期未提交；请核对后重试');return;}
    if(!response.ok){const error=await response.json().catch(()=>null);throw new Error(String(error?.error||'新周期保存失败'));}
    committed=true;
    simState=nextState;simSettings=latest.ledger.settings;remoteUpdatedAt=updatedAt;
    let cached=true;
    try{localStorage.setItem(SIM_KEY,JSON.stringify(simState));localStorage.setItem(LEDGER_UPDATED_KEY,String(updatedAt));}catch{cached=false;}
    renderSimConfig();renderSimSummary();
    toast(cached?`已开始新资金周期 ${id}；全部旧票保留`:`服务端已开始新周期 ${id}；浏览器缓存未保存，请刷新核对`);
  }catch(error){
    const detail=String(error?.message||error);
    toast(committed?`新周期已提交；页面更新失败，请刷新核对：${detail}`:submissionStarted&&writeStatus===null?`新周期提交结果未确认，请刷新账本核对后再操作：${detail}`:`新周期未提交：${detail}`);
  }
});
if($('#exportLedgerBtn'))$('#exportLedgerBtn').addEventListener('click',exportLedgerCsv);

function clock(){if($('#localTime')) $('#localTime').textContent=new Date().toLocaleTimeString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'})}
setInterval(()=>{clock();scheduler()},1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(Date.now()-lastSyncAt>30000)refreshData(false,'all');if(Date.now()-lastLedgerPollAt>30000)syncRemoteLedger()}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&remoteLedgerReady)flushRemoteLedger()});
window.addEventListener('online',()=>refreshData(false,'all'));
// The one-second scheduler above owns the bounded rotation. A second full
// refresh timer used to request all 65 leagues every minute and exhausted V8.
if(!document.querySelector('#simulation-dashboard')){pollLabBets();setInterval(()=>{if(!document.hidden)pollLabBets();},60000);}
setInterval(()=>{
  if(document.hidden)return;
  const due=matches.filter(m=>m.status==='soon'&&Number(m.date)-Date.now()>0&&Number(m.date)-Date.now()<=75*60000).slice(0,12).map(m=>({league:m.leagueCode,id:m.id,kickoffAt:Number(m.date)}));
  if(!due.length)return;
  fetch('/api/prewarm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({matches:due})}).catch(()=>{});
},60000);

clock();calc();
fetch('/api/auth-check',{cache:'no-store'}).catch(()=>{});
simSettings=loadSimSettings();
simState=loadSimState();
cleanSimState();
renderSimConfig();
renderSimSummary();
restoreCache();
ledgerBooting=false;
syncRemoteLedger();
refreshData(false,'all');
