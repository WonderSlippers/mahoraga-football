import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('review renderer covers every view, preserves full parlay legs and missing values',async()=>{
  const saved={document:globalThis.document,window:globalThis.window,setTimeout:globalThis.setTimeout,setInterval:globalThis.setInterval};
  const handlers={},events={},host={innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null,addEventListener:(key,fn)=>{handlers[key]=fn;}};
  globalThis.document={addEventListener(){},getElementById:()=>null,querySelector:()=>null,hidden:false};
  globalThis.window={addEventListener:(key,fn)=>{events[key]=fn;}};
  try{
    const {mountReviewBoard}=await import('../public/review-ui.js');
    globalThis.setTimeout=()=>0;globalThis.setInterval=()=>0;
    mountReviewBoard(host);
    const t={id:'fixture-ticket',status:'loss',stake:25,pnl:-25,createdAt:Date.now()-86400000,settledAt:Date.now(),legs:[{home:'Arsenal',away:'Chelsea',odds:2,pick:0,score:80,status:'loss',finalScore:'1-2'},{home:'Barcelona',away:'Real Madrid',odds:1.8,market:'total',side:'over',line:2.5,score:null,status:'open'}]};
    events['edge:simulation-ledger']({detail:{portfolios:[{id:'double',name:'二串一',tickets:[t]}],calibration:null}});
    assert.match(host.innerHTML,/本账单日已实现盈亏/);
    assert.match(host.innerHTML,/08:00 切账/);
    assert.match(host.innerHTML,/混合玩法串关/);
    for(const view of ['results','analysis','model','overview']){
      handlers.click({target:{closest:key=>key==='[data-review-view]'?{dataset:{reviewView:view}}:null}});
      assert.doesNotMatch(host.innerHTML,/NaN|undefined|Infinity/);
      if(view==='results'){
        assert.match(host.innerHTML,/2 串 1/);
        assert.match(host.innerHTML,/切尔西/);
        assert.match(host.innerHTML,/巴塞罗那/);
        assert.match(host.innerHTML,/待结算/);
      }
      if(view==='analysis')assert.match(host.innerHTML,/评分未记录/);
    }
  }finally{Object.assign(globalThis,saved);}
});

test('simulation dashboard restores a snapshot before refreshing and does not let legacy ledger block',async()=>{
  const source=await readFile(new URL('../public/lab.js',import.meta.url),'utf8');
  assert.match(source,/restoreCachedLab\(\);\s*\n\s*load\(true\)/);
  assert.match(source,/AbortSignal\.timeout\(8000\)/);
  assert.match(source,/loadLegacyInBackground\(\)/);
  assert.doesNotMatch(source,/Promise\.allSettled\(\[\s*fetch\('\/api\/lab'/);
  assert.match(source,/function safeRender\(\)/);
  assert.match(source,/function renderFallback\(error\)/);
  assert.match(source,/host\.dataset\.labBoot='fallback'/);
  assert.match(source,/elements\.namedItem\('stake'\)/);
  assert.match(source,/各策略每日已实现盈亏/);
  assert.match(source,/策略每日盈亏/);
  assert.match(source,/data-chart-overlay/);
  assert.match(source,/pointermove/);
  assert.match(source,/未来 7 天赛程雷达/);
  assert.match(source,/48 小时预筛/);
  assert.match(source,/赔率覆盖诊断/);
});

test('odds availability distinguishes complete, partial, unopened and live-only gaps',async()=>{
  const {classifyOddsAvailability,oddsAvailabilityText}=await import('../public/odds-health.js');
  const now=Date.now();
  const complete=classifyOddsAvailability({prices:[1.9,3.3,4.2],kickoffAt:now+3600000,observedAt:now});
  const partial=classifyOddsAvailability({prices:[1.9,null,4.2],rawOddsCount:1,moneylineCount:1,kickoffAt:now+3600000,observedAt:now});
  const early=classifyOddsAvailability({prices:[],rawOddsCount:0,kickoffAt:now+36*3600000,observedAt:now});
  const historical=classifyOddsAvailability({prices:[],rawOddsCount:1,moneylineCount:1,historicalOnly:true,kickoffAt:now+3600000,observedAt:now});
  const live=classifyOddsAvailability({status:'live',prices:[],historicalPrices:[1.9,3.3,4.2],rawOddsCount:1,moneylineCount:1,kickoffAt:now-3600000,observedAt:now});
  assert.equal(complete.code,'complete');
  assert.equal(partial.code,'partial');
  assert.deepEqual(partial.missing,['平局']);
  assert.match(oddsAvailabilityText(partial),/不参与价值判断/);
  assert.equal(early.code,'not-returned-early');
  assert.equal(historical.code,'historical-only');
  assert.match(oddsAvailabilityText(historical),/历史价/);
  assert.equal(live.code,'live-unavailable');
});

test('scanner releases failed HTTP bodies and stays within Worker connection limits',async()=>{
  const [http,feed,scan,goal]=await Promise.all([
    readFile(new URL('../lib/http-response.ts',import.meta.url),'utf8'),
    readFile(new URL('../app/api/feed/route.ts',import.meta.url),'utf8'),
    readFile(new URL('../app/api/scan/route.ts',import.meta.url),'utf8'),
    readFile(new URL('../lib/goal-model.ts',import.meta.url),'utf8'),
  ]);
  assert.match(http,/response\?\.body\?\.cancel\(\)/);
  assert.match(feed,/settledBatches\(days,4/);
  assert.match(scan,/tasks\.length; index \+= 1/);
  assert.match(scan,/settledBatches\(researchTargets,2/);
  assert.match(goal,/offset<codes\.length;offset\+=2/);
});

test('parallel pages share one server scan instead of racing ledger writes',async()=>{
  const route=await readFile(new URL('../app/api/scan/route.ts',import.meta.url),'utf8');
  const lock=await readFile(new URL('../db/scan-lock.ts',import.meta.url),'utf8');
  assert.match(route,/acquireScanLease\(\)/);
  assert.match(route,/activeScan:\s*true/);
  assert.match(route,/finally\s*\{[\s\S]*releaseScanLease/);
  assert.match(lock,/ON CONFLICT\(key\) DO UPDATE/);
  assert.match(lock,/app_state\.updated_at\s*<\s*\?/);
  assert.match(lock,/DELETE FROM app_state[\s\S]*json_extract/);
});

test('global football coverage includes women and national teams and renders progressively',async()=>{
  const [app,feed,scan,research]=await Promise.all([
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../app/api/feed/route.ts',import.meta.url),'utf8'),
    readFile(new URL('../app/api/scan/route.ts',import.meta.url),'utf8'),
    readFile(new URL('../public/research-ui.js',import.meta.url),'utf8'),
  ]);
  for(const code of ['fifa.friendly','fifa.friendly.w','eng.w.1','esp.w.1','fifa.worldq.uefa','concacaf.nations.league']){
    assert.match(app,new RegExp(code.replaceAll('.','\\.')));
    assert.match(feed,new RegExp(code.replaceAll('.','\\.')));
    assert.match(scan,new RegExp(code.replaceAll('.','\\.')));
  }
  assert.match(app,/正在扫描 · 已显示/);
  assert.match(app,/seasonFeedCache/);
  assert.doesNotMatch(research,/officialEvidence\(lab\.teamResearch\)/);
  assert.match(research,/teamEvidenceCurrent\?officialEvidence/);
  assert.match(research,/function ticketTeamIcon\(l,side,logo\)/);
});

test('extended national calendar and Chinese team labels remain enforced',async()=>{
  const [app,feed,names]=await Promise.all([
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../app/api/feed/route.ts',import.meta.url),'utf8'),
    import('../public/names-zh.js'),
  ]);
  assert.match(app,/function extendedDateWindow/);
  assert.match(app,/requestDates=extended\?extendedDateWindow\(\):dates/);
  assert.match(app,/uefa\.nations/);
  // Exact calendar and span boundaries are exercised in feed-date-window.test.
  assert.match(feed,/parseFeedDateWindow\(dates,mode,extended\)/);
  assert.match(feed,/limit=\$\{extended\?1000:100\}/);
  assert.equal(names.teamZh('Solomon Islands'),'所罗门群岛');
  assert.equal(names.teamZh('Sao Tome & P'),'圣多美和普林西比');
  assert.equal(names.teamZh('St Kitts & Nevis'),'圣基茨和尼维斯');
  assert.equal(names.countryFlag('France'),'🇫🇷');
  assert.equal(names.countryFlag('Sao Tome & P'),'🇸🇹');
  assert.ok(names.countryFlag('England'));
  assert.match(app,/competitionKind\(\{leagueCode\}\)==='女足'/);
  assert.match(app,/translated\.endsWith\('女足'\)/);
  assert.match(app,/function teamIcon\(match,side\)/);
  assert.match(app,/oddsAvailabilityText/);
  assert.match(app,/healthOdds24hMissing/);
});

test('all new simulation tickets use the flat 20 yuan stake',async()=>{
  const [engine,app,lab,html]=await Promise.all([
    readFile(new URL('../lib/simulation-lab.ts',import.meta.url),'utf8'),
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../public/lab.js',import.meta.url),'utf8'),
    readFile(new URL('../public/legacy.html',import.meta.url),'utf8'),
  ]);
  assert.match(engine,/existing\.stake=20/);
  assert.match(engine,/Object\.assign\(portfolio,\{enabled:input\.enabled,stake:20/);
  assert.doesNotMatch(engine,/enabled:true,stake:(?:5|10|25),maxTickets/);
  assert.doesNotMatch(engine,/const stake=Math\.max\(5,Math\.round\(kellyStake/);
  assert.match(app,/const SIM_STAKE_DEFAULT=20/);
  assert.match(lab,/统一均注 20 元/);
  assert.match(html,/统一均注 20 元/);
});
