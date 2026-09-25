import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {asianFactor,marketExpectation} from '../public/market-math.js';
import {hypotheticalPnl} from '../public/ledger-metrics.js';
import {splitLab} from '../lib/lab-shards.js';
const compile=s=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');
const goalURL=compile(fs.readFileSync(new URL('../lib/goal-model.ts',import.meta.url),'utf8').replace('import {readJsonLimited} from "./limited-response";',''));
const mathURL=new URL('../public/market-math.js',import.meta.url).href;
const strategyURL=new URL('../public/strategy-status.js',import.meta.url).href;
const shardURL=new URL('../lib/lab-shards.js',import.meta.url).href;
const src=fs.readFileSync(new URL('../lib/simulation-lab.ts',import.meta.url),'utf8').replace('import { env } from "cloudflare:workers";','const env={};').replaceAll('@/lib/goal-model',goalURL).replaceAll('./goal-model',goalURL).replace('../public/market-math.js',mathURL).replace('../public/strategy-status.js',strategyURL).replace('./scan-progress-claim.js',new URL('../lib/scan-progress-claim.js',import.meta.url).href).replace('./lab-shards.js',shardURL);
const {settlePortfolio,processLab,prepareSimulationLab,preparePublicPaperTicket,featuredOpenLegs,applyFeaturedAnalyses,voidDuplicateOpenSingles,portfolioStreak,profitGuard,scoreLeg,scoreLegAudit,scoreLegV2Audit,computeCalibration}=await import(compile(src));
const {makeGoalEvidence,makeCurrentOnlyGoalEvidence}=await import(goalURL);
test('scan batch identity is frozen with the latest lab scan',()=>{
 const lab={version:4,portfolios:[],updatedAt:0,lastScanAt:0};
 processLab(lab,[],'',false,{scanBatchId:'batch-123'});
 assert.equal(lab.lastScan.scanBatchId,'batch-123');
});

test('public displayed odds create one baseline paper ticket without changing existing tickets or featured picks',()=>{
 const now=Date.parse('2026-09-24T17:00:00Z');
 const old={id:'old-ticket',day:'2026-09-21',status:'win',stake:20,pnl:8,legs:[{matchId:'old-match',status:'win',odds:1.4}]};
 const lab={version:4,updatedAt:25,lastScanAt:10,portfolios:[{id:'forced-fun',enabled:true,maxTickets:60,tickets:[old]},{id:'featured-picks',enabled:true,maxTickets:10,tickets:[]}]};
 const frozen=structuredClone(lab);
 const quote={matchId:'401861048',leagueCode:'uefa.nations',home:'Austria',away:'Israel',kickoffAt:Date.parse('2026-09-24T18:45:00Z'),odds:[1.42,4.8,6],provider:'Winamax',sourceUrl:'https://www.wettfreunde.net/example',capturedAt:now};
 const first=preparePublicPaperTicket(lab,quote,now);
 assert.equal(first.created,true);
 assert.equal(first.pick,0);
 assert.equal(first.lab.portfolios[0].tickets.length,2);
 assert.deepEqual(first.lab.portfolios[0].tickets[0],old);
 assert.equal(first.lab.portfolios[1].tickets.length,0);
 assert.equal(first.lab.lastScanAt,10);
 assert.deepEqual(lab,frozen);
 const repeat=preparePublicPaperTicket(first.lab,quote,now);
 assert.equal(repeat.created,false);
 assert.equal(repeat.lab.portfolios[0].tickets.length,2);
 assert.throws(()=>preparePublicPaperTicket(lab,{...quote,odds:[1.42,4.8]},now),/不完整/);
 assert.throws(()=>preparePublicPaperTicket(lab,quote,quote.kickoffAt-9*60000),/窗口/);
});
test('scan preparation leaves persisted input untouched and featured evidence can be attached before saving',()=>{
 const original={version:4,portfolios:[{id:'featured-picks',tickets:[{legs:[{matchId:'123',leagueCode:'eng.1',status:'open'}]}]}],updatedAt:7,lastScanAt:0};
 const frozen=structuredClone(original);
 const prepared=prepareSimulationLab(original,[],'',false,{scanBatchId:'batch-a'});
 assert.deepEqual(original,frozen);
 assert.equal(prepared.expected,7);
 assert.equal(prepared.lab.lastScan.scanBatchId,'batch-a');
 assert.equal(featuredOpenLegs(prepared.lab).length,1);
 const analysis={summary:'已核对',sections:[],capturedAt:100,sourceUrl:'https://example.com',coverage:'fixture'};
 assert.equal(applyFeaturedAnalyses(prepared.lab,[{matchId:'123',leagueCode:'eng.1',analysis}]),1);
 assert.equal(applyFeaturedAnalyses(prepared.lab,[{matchId:'123',leagueCode:'eng.1',analysis:{...analysis,capturedAt:99}}]),0);
 assert.equal(original.portfolios[0].tickets[0].legs[0].deepAnalysis,undefined);
});
test('neutral teams receive the venue prior once, and goal model version changes with the fix',()=>{
 const team={games:20,for:30,against:30};
 const model=makeGoalEvidence(team,team,team,team,1.5,1.5,['now','previous'],[2026,2025],100,[100,90]);
 assert.equal(model.modelVersion,'poisson-standings-v3');
 assert.equal(model.capturedAt,90);
 assert.ok(Math.abs(model.expectedHome-1.725)<1e-9);
 assert.ok(Math.abs(model.expectedAway-1.275)<1e-9);
 const fallback=makeCurrentOnlyGoalEvidence(team,team,1.5,'now',2026,100);
 assert.equal(fallback.modelVersion,'poisson-standings-current-v3');
 assert.ok(Math.abs(fallback.expectedHome-1.725)<1e-9);
 assert.ok(Math.abs(fallback.expectedAway-1.275)<1e-9);
});
test('calibration assigns each settled leg to exactly one probability bucket',()=>{
 const probabilities=[.49,.5,.5,.59,.6];
 const tickets=probabilities.map((probability,index)=>({id:'ticket-'+index,status:'win',odds:2,stake:20,pnl:20,legs:[{leagueCode:'eng.1',matchId:String(index),pick:0,status:'win',odds:2,probability,decisionVersion:'old'}]}));
 const result=computeCalibration({version:1,updatedAt:0,lastScanAt:0,portfolios:[{id:'sample',tickets}]});
 assert.equal(result.totalSettledLegs,5);
 assert.equal(result.buckets.reduce((sum,bucket)=>sum+bucket.count,0),5);
 assert.equal(result.buckets.find(bucket=>bucket.range==='40–50%').count,1);
 assert.equal(result.buckets.find(bucket=>bucket.range==='50–60%').count,3);
});
test('reading and saving a user cap below five does not silently raise it',async()=>{
 let stored={version:1,updatedAt:123,lastScanAt:0,portfolios:[{id:'all-singles',name:'broad',rule:'',legs:1,enabled:true,stake:20,maxTickets:3,minTickets:5,initialBalance:10000,tickets:[]}]};
 globalThis.__decisionTestEnv={DB:{prepare(sql){return {async all(){return {results:[{key:'simulation_lab_v1',payload:JSON.stringify(stored),updated_at:stored.updatedAt}]};},async first(){return null;},bind(...args){return {async first(){return {payload:JSON.stringify(stored),updated_at:stored.updatedAt};},async run(){if(sql.startsWith('UPDATE'))stored=JSON.parse(args[0]);return {meta:{changes:1}};}};}};}}};
 const isolatedLab=await import(compile(src.replace('const env={};','const env=globalThis.__decisionTestEnv;')));
 try{const read=await isolatedLab.readLab();assert.equal(read.portfolios.find(p=>p.id==='all-singles').maxTickets,3);assert.equal(read.portfolios.find(p=>p.id==='all-singles').minTickets,3);const updated=await isolatedLab.updateLabConfig({id:'all-singles',enabled:true,stake:20,maxTickets:2});assert.equal(updated.portfolios.find(p=>p.id==='all-singles').maxTickets,2);assert.equal(updated.portfolios.find(p=>p.id==='all-singles').minTickets,2);}
 finally{delete globalThis.__decisionTestEnv;}
});
test('sharded lab is readable and a failed v2 write never falls back to v1',async()=>{
 const saved={version:1,updatedAt:4321,lastScanAt:0,portfolios:[{id:'all-singles',name:'broad',rule:'',legs:1,enabled:true,stake:20,maxTickets:3,minTickets:0,initialBalance:10000,tickets:[{id:'frozen-history',status:'win',stake:28.75,legs:[]}]}]};
 const {root,shards}=splitLab(saved);
 const rows=[{key:'simulation_lab_v2',payload:root,updated_at:4321},...shards.map(row=>({key:`simulation_lab_v2:${row.id}`,payload:row.payload,updated_at:4321}))];
 let legacyWrites=0;
 globalThis.__decisionTestEnv={DB:{prepare(){return {async all(){return {results:rows};},async first(){return {updated_at:4321};},bind(){return this;},async run(){legacyWrites++;return {meta:{changes:1}};}};},async batch(){throw new Error('isolated shard write failed');}}};
 const isolatedLab=await import(compile(src.replace('const env={};','const env=globalThis.__decisionTestEnv;')+'\n//sharded-fallback-test'));
 try{const lab=await isolatedLab.readLab();assert.equal(lab.portfolios.find(p=>p.id==='all-singles').tickets[0].stake,28.75);await assert.rejects(isolatedLab.updateLabConfig({id:'all-singles',enabled:true,stake:20,maxTickets:2}),/isolated shard write failed/);assert.equal(legacyWrites,0);assert.equal(saved.portfolios[0].tickets[0].stake,28.75);}
 finally{delete globalThis.__decisionTestEnv;}
});
test('score audit matches the actual score and 1X2 includes its goal model',()=>{
 const goalModel={expectedHome:1.7,expectedAway:1.1,rho:-.08,uncertaintyMargin:.02,modelVersion:'test',home:{},away:{},assumptions:[],sourceUrls:[]};
 const match={id:'score-audit',leagueCode:'uefa.wchampions',date:Date.now()+3600000,status:'soon',detail:'',home:'Real Madrid',away:'PSG',homeForm:'WWD',awayForm:'LWD',odds:[1.8,3.6,4.4],oddsPhase:'current',providers:['public','public','public'],goalModel};
 const opts={probability:.51,edge:-.05,goalModel};
 assert.equal(scoreLegAudit(match,opts).score,scoreLeg(match,opts));
 assert.match(scoreLegAudit(match,opts).parts.join('；'),/已纳入进球模型/);
 const lab={version:4,portfolios:[],updatedAt:0,lastScanAt:0};processLab(lab,[match]);
 const row=lab.radar.entries.find(entry=>entry.matchId==='score-audit');
 assert.ok(row);assert.match(row.scoreBasis,/已纳入进球模型/);
 assert.equal(row.score,scoreLegAudit(match,{probability:row.probability,edge:row.edge,goalModel}).score);
 assert.equal(row.newScore,scoreLegV2Audit(match,{probability:row.probability,edge:row.edge,goalModel}).score);
});
test('bounded scan carries unrefreshed radar rows as stale and never calls old prices fresh',()=>{
 const base={date:Date.now()+3600000,status:'soon',detail:'',home:'A',away:'B',homeForm:'',awayForm:'',odds:[1.8,3.5,4.5],oddsPhase:'current',providers:['public','public','public']};
 const lab={version:4,portfolios:[],updatedAt:0,lastScanAt:0};
 processLab(lab,[{...base,id:'a',leagueCode:'fifa.friendly.w'}],'',false,{freshLeagueCodes:['fifa.friendly.w']});
 assert.equal(lab.radar.fresh,1);
 processLab(lab,[{...base,id:'b',leagueCode:'eng.1'}],'',false,{freshLeagueCodes:['eng.1']});
 const carried=lab.radar.entries.find(row=>row.matchId==='a');
 assert.equal(carried.stale,true);
 assert.equal(carried.qualifies,false);
 assert.match(carried.reason,/不据此生成新模拟单/);
 assert.equal(lab.radar.fresh,1);
 assert.equal(lab.radar.stale,1);
 assert.equal(lab.radar.priced,1);
 processLab(lab,[],'',false,{freshLeagueCodes:['fifa.friendly.w']});
 assert.equal(lab.radar.entries.some(row=>row.matchId==='a'),false);
});
test('a complete close reference stays visible as historical evidence but never creates a new simulated ticket',()=>{
 const pf={id:'featured-picks',name:'featured',enabled:true,legs:1,stake:20,maxTickets:10,initialBalance:10000,tickets:[]};
 const match={id:'close-only',leagueCode:'fifa.friendly',date:Date.now()+3600000,status:'soon',detail:'',home:'A',away:'B',homeForm:'WWD',awayForm:'LDL',odds:[1.8,3.6,4.4],oddsPhase:'close-reference',oddsReason:'仅 close 字段参考价',providers:['public','public','public']};
 const lab={version:4,portfolios:[pf],updatedAt:0,lastScanAt:0};
 processLab(lab,[match]);
 const row=lab.radar.entries.find(entry=>entry.matchId==='close-only');
 assert.equal(row.quotePhase,'close-reference');
 assert.equal(row.priced,false);
 assert.equal(row.qualifies,false);
 assert.match(row.reason,/不生成模拟单/);
 assert.equal(pf.tickets.length,0);
});
test('new evidence score is separate and never changes the old A-grade decision',()=>{
 const match={odds:[2,3,4],research:{dqdSignals:[0,0],homeRest:null,awayRest:null,injuryAvailable:false,lineupConfirmed:false,newsMatched:false}};
 const opts={probability:.55,edge:.1};
 const old=scoreLegAudit(match,opts).score,trial=scoreLegV2Audit(match,opts);
 assert.equal(old,scoreLeg(match,opts));
 assert.ok(trial.score<old);
 assert.match(trial.parts.join('；'),/新闻零信号不能当作安全/);
 const withSignals={...opts,odds:2,goalModel:{seasons:[2026,2025],home:{games:8},away:{games:8},availabilityInputs:{marginBump:.03}}};
 const noSignals={...withSignals,goalModel:{...withSignals.goalModel,availabilityInputs:{marginBump:0}}};
 const signalScore=scoreLegV2Audit(match,withSignals),baselineScore=scoreLegV2Audit(match,noSignals);
 assert.ok(signalScore.score<baselineScore.score);
 assert.match(signalScore.parts.join('；'),/实际边际 \+3.0 个百分点/);
});
const {buildDeepDive}=await import(compile(fs.readFileSync(new URL('../lib/deep-dive.ts',import.meta.url),'utf8').replace('./goal-model',goalURL).replace('../public/market-math.js',mathURL)));
test('Asian handicap and totals: full, half, push and invalid',()=>{
 for(const [line,h,a,result] of [[-.5,1,0,2],[-1,1,0,1],[-1.25,1,0,.5],[-.75,1,0,1.5],[.25,0,0,1.5],[-.25,0,0,.5],[-2.5,1,0,0]])assert.equal(asianFactor('spread','home',line,2,h,a),result);
 assert.equal(asianFactor('total','over',2.25,2,1,1),.5);
 assert.equal(asianFactor('total','under',2.25,2,1,1),1.5);
 assert.equal(asianFactor('total','over',2,2,1,1),1);
 assert.equal(asianFactor('spread','home',.3,2,1,1),null);
});
test('Settlement preserves half-loss parlay value and frozen old history',()=>{
 const leg=(id,line)=>({matchId:id,leagueCode:'test',market:'spread',side:'home',line,odds:2,status:'open'});
 const t={id:'new',stake:20,status:'open',legs:[leg('1',-1.25),leg('2',-.5)],pnl:0};
 const old={id:'old',stake:20,status:'loss',pnl:-20,settledAt:123,legs:[{...leg('1',-1.25),status:'loss',returnFactor:0}]};
 const pf={id:'test',tickets:[t,old]};
 const m=id=>({id,leagueCode:'test',status:'finished',hs:1,as:0,period:2,detail:'FT',independentFinalVerified:true});
 settlePortfolio(pf,[m('1'),m('2')]);
 assert.equal(t.pnl,0);assert.equal(t.settledOdds,1);assert.equal(t.legs[0].returnFactor,.5);
 assert.equal(old.pnl,-20);assert.equal(old.settledAt,123);
 const single={id:'single',stake:20,status:'open',legs:[leg('1',-1.25)],pnl:0};
 settlePortfolio({id:'test',tickets:[single]},[m('1')]);assert.equal(single.pnl,-10);
});
test('Counterfactual and expected return use same settlement math',()=>{
 assert.equal(hypotheticalPnl({stake:20,legs:[{market:'spread',side:'home',line:-1.25,odds:2,status:'loss',finalScore:'1:0'}]},0,{market:'spread',side:'home',line:-.75,odds:2}),10);
 assert.equal(marketExpectation([[0,0],[1,0]],'spread','home',-1.25,2).expectedReturn,.5);
});
test('New selected strategies never fill negative edges; deep lines can enter',()=>{
 const pf=id=>({id,name:id,enabled:true,legs:1,stake:10,maxTickets:10,minTickets:5,initialBalance:10000,tickets:[]});
 const match={id:'123456',leagueCode:'esp.1',date:Date.now()+3600000,status:'soon',detail:'',home:'A',away:'B',homeForm:'',awayForm:'',odds:[1.1,2,2],providers:['test','test','test']};
 const lab={version:3,portfolios:[pf('featured-picks'),pf('value-singles')],updatedAt:0,lastScanAt:0};
 processLab(lab,[match]);
 assert.equal(lab.portfolios.flatMap(p=>p.tickets).length,0);
 const g={expectedHome:4,expectedAway:.3,rho:-.08,uncertaintyMargin:.02,modelVersion:'test',home:{},away:{},assumptions:[],sourceUrls:[]};
 const deep={...match,goalModel:g,spreadOffers:[{homeLine:-1.5,awayLine:1.5,home:2,away:1.8,phase:'current',provider:'test'}]};
 const lab2={version:3,portfolios:[pf('spread-singles')],updatedAt:0,lastScanAt:0};
 processLab(lab2,[deep]);assert.equal(lab2.portfolios[0].tickets.length,1);
 assert.equal(lab2.portfolios[0].tickets[0].legs[0].line,-1.5);
 assert.ok(lab2.portfolios[0].tickets[0].legs[0].score>=75);
 assert.equal(lab2.portfolios[0].tickets[0].legs[0].decisionVersion,'profit-guard-v4');
 assert.match(lab2.decisionAudit[0].reason,/独立进球模型 可用/);
 assert.equal(lab2.decisionAudit[0].spreadLines.length,1);
 assert.equal(lab2.decisionAudit[0].spreadCandidates.length,2);
 assert.equal(lab2.decisionAudit[0].spreadCandidates.some(row=>row.qualifies&&row.line===-1.5),true);
 assert.match(lab2.decisionAudit[0].reason,/公开源当前只给主盘口一档/);
});
test('broad single coverage does not repeat its own normal ticket as a minimum-coverage fill',()=>{
 const pf={id:'all-singles',name:'coverage',enabled:true,legs:1,stake:20,maxTickets:100,minTickets:5,initialBalance:10000,tickets:[]};
 const match={id:'same-direction',leagueCode:'esp.1',date:Date.now()+3600000,status:'soon',detail:'',home:'A',away:'B',homeForm:'WWD',awayForm:'LDL',odds:[1.8,3.6,4.4],oddsPhase:'current',providers:['public','public','public']};
 const lab={version:4,portfolios:[pf],updatedAt:0,lastScanAt:0};
 processLab(lab,[match]);
 assert.equal(pf.tickets.filter(t=>t.legs.some(l=>l.matchId==='same-direction')).length,1);
 assert.equal(pf.tickets.some(t=>t.id.includes(':fill:same-direction:')),false);
});
test('duplicate open single is retained as zero-PnL void while earliest direction remains open',()=>{
 const leg={matchId:'761543',market:'1x2',pick:0,odds:1.83,status:'open'};
 const first={id:'all-singles:761543',createdAt:1,stake:20,odds:1.83,status:'open',pnl:0,legs:[{...leg}]};
 const later={id:'all-singles:fill:761543:1x2',createdAt:2,stake:20,odds:1.83,status:'open',pnl:0,legs:[{...leg}]};
 const lab={portfolios:[{id:'all-singles',tickets:[later,first]}]};
 assert.equal(voidDuplicateOpenSingles(lab),1);
 assert.equal(first.status,'open');
 assert.equal(later.status,'void');assert.equal(later.pnl,0);
 assert.equal(later.stake,20);assert.equal(later.odds,1.83);
 assert.match(later.legs[0].finalScore,/重复单/);
 assert.equal(voidDuplicateOpenSingles(lab),0);
});
test('seven-day radar keeps non-mainstream fixtures visible before the 24h ticket window',()=>{
 const pf={id:'featured-picks',name:'featured',enabled:true,legs:1,stake:20,maxTickets:10,initialBalance:10000,tickets:[]};
 const base={status:'soon',detail:'',homeForm:'WWD',awayForm:'LDL',providers:['public','public','public'],hs:0,as:0,period:0};
 const matches=[
  {...base,id:'women-five-days',leagueCode:'fifa.friendly.w',date:Date.now()+5*86400000,home:'Women A',away:'Women B',odds:[]},
  {...base,id:'national-36h',leagueCode:'uefa.nations',date:Date.now()+36*3600000,home:'Country A',away:'Country B',odds:[1.8,3.4,4.2],oddsPhase:'current'},
  {...base,id:'minor-2h',leagueCode:'usa.nwsl',date:Date.now()+2*3600000,home:'Club A',away:'Club B',odds:[]},
 ];
 const lab={version:4,portfolios:[pf],updatedAt:0,lastScanAt:0};
 const result=processLab(lab,matches);
 assert.equal(result.radarMatches,3);
 assert.equal(lab.radar.total,3);
 assert.equal(lab.radar.entries.find(row=>row.matchId==='women-five-days').stage,'calendar');
 assert.equal(lab.radar.entries.find(row=>row.matchId==='national-36h').stage,'prescreen');
 assert.equal(lab.radar.entries.find(row=>row.matchId==='minor-2h').stage,'execution');
 assert.equal(lab.reviews.some(row=>row.leg.matchId==='national-36h'),true);
 assert.match(lab.radar.entries.find(row=>row.matchId==='minor-2h').reason,/1X2/);
 assert.equal(lab.portfolios[0].tickets.length,0);
});
test('Profit guard pauses loss-heavy experiments and cuts stake after losing streaks',()=>{
 const pf=(id,legs=1)=>({id,name:id,enabled:true,legs,stake:25,maxTickets:10,minTickets:0,initialBalance:10000,tickets:[]});
 const g={expectedHome:4,expectedAway:.3,rho:-.08,uncertaintyMargin:.02,modelVersion:'test',home:{},away:{},assumptions:[],sourceUrls:[]};
 const match={id:'654321',leagueCode:'eng.1',date:Date.now()+3600000,status:'soon',detail:'',home:'A',away:'B',homeForm:'WWWWW',awayForm:'LLLLL',odds:[1.8,4,5],providers:['test','test','test'],goalModel:g,totalOffers:[{line:2.5,over:2,under:1.9,phase:'current',provider:'test'}],spreadOffers:[{homeLine:-1.5,awayLine:1.5,home:2,away:1.8,phase:'current',provider:'test'}]};
 const lab={version:4,portfolios:[pf('treble',3),pf('mixed-double',2),pf('totals-poisson')],updatedAt:0,lastScanAt:0};
 processLab(lab,[match]);
 assert.equal(lab.portfolios.flatMap(p=>p.tickets).length,0);
 assert.deepEqual(lab.strategyPolicy.pausedPortfolios,['treble','mixed-double','totals-poisson','totals-baseline']);
 const streak={tickets:[1,2,3].map((n)=>({status:'loss',settledAt:n,createdAt:n}))};
 assert.equal(portfolioStreak(streak).mult,.5);
});
test('Profit guard basis refreshes from newly settled tickets',()=>{
 const lab={version:4,updatedAt:0,lastScanAt:0,portfolios:[
  {id:'mixed-double',tickets:[{id:'mixed-double:1',status:'loss',stake:25,pnl:-25,legs:[]}]},
  {id:'treble',tickets:[{id:'treble:fill:1',status:'win',stake:25,pnl:25,legs:[]}]},
  {id:'totals-poisson',tickets:[]},
 ]};
 const policy=profitGuard(lab);
 assert.match(policy.basis.join(' '),/补位票据 1 单，投入收益率 \+100\.00%/);
 assert.match(policy.basis.join(' '),/胜负＋大小球二串一 1 单，投入收益率 -100\.00%/);
});
test('Report does not invent low block, injuries, or timed goals',()=>{
 const d=buildDeepDive({home:'A',away:'B',expectedHome:2.5,expectedAway:.5,lastFive:[{team:'A',games:[{date:'2026-09-01',opponent:'C',result:'W',score:'2-0'}]}]});
 const text=JSON.stringify(d);
 assert.match(text,/C/);assert.match(text,/多玩法比较/);assert.match(text,/伤停名单缺失/);
 assert.doesNotMatch(text,/体能正常|后防或锋线有明确缺口|10 分钟内系统会重估|大概率高位压迫/);
});
