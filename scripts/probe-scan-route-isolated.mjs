import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {LAB_READ_SQL,restoreLabRows} from '../lib/lab-shards.js';

const file=process.argv[2];
if(!file)throw new Error('Usage: node scripts/probe-scan-route-isolated.mjs <source-d1-sqlite>');
const tables=['app_state','model_forecasts','model_outcomes','market_quotes','market_results','odds_snapshots'];
const source=new DatabaseSync(file,{readOnly:true});
let legacy,personal,settings,schemas;
try{
  assert.equal(source.prepare('PRAGMA quick_check').get().quick_check,'ok');
  const read=key=>source.prepare('SELECT payload,updated_at FROM app_state WHERE key=?').get(key);
  legacy=read('simulation_lab_v1');personal=read('sim_state');settings=read('sim_settings');
  assert.ok(legacy?.payload&&personal?.payload&&settings?.payload,'source ledgers missing');
  schemas=tables.map(name=>source.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name)?.sql);
  assert.ok(schemas.every(Boolean),'source schema missing');
}finally{source.close()}

const virtual=new Map([
  ['@/lib/site-owner','export async function ownerWriteDenied(){return null;}'],
  ['@/lib/local-scan-policy','export function localScanWritesAllowed(){return true;}'],
  ['@/lib/jleague-source','export async function officialMatches(){return [];} export function attachOfficial(rows){return rows;}'],
  ['@/lib/afc-source','export async function afcResults(){return [];} export function attachAfc(rows){return rows;}'],
  ['@/lib/goal-model','export async function goalEvidenceForMatches(){return new Map();}'],
  ['@/lib/research-evidence','export function linkedResearchGoalEvidence(){return null;}'],
  ['../match-research/route','export async function GET(){return Response.json({ok:false,degraded:true});}'],
  ['../feed/route','export async function loadMergedFeed(){if(globalThis.__probeFeedMode)throw new Error("probe uses intercepted ESPN CDN");return {events:[]};}'],
]);
const bundled=await build({entryPoints:['app/api/scan/route.ts'],absWorkingDir:process.cwd(),bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',alias:{'@':process.cwd()},
  plugins:[{name:'isolated-scan-dependencies',setup(b){
    b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'worker-env',namespace:'scan-probe-env'}));
    b.onLoad({filter:/.*/,namespace:'scan-probe-env'},()=>({contents:'export const env={get DB(){return globalThis.__isolatedScanDB;}};',loader:'js'}));
    b.onResolve({filter:/.*/},args=>virtual.has(args.path)?{path:args.path,namespace:'scan-probe-virtual'}:undefined);
    b.onLoad({filter:/.*/,namespace:'scan-probe-virtual'},args=>({contents:virtual.get(args.path),loader:'js'}));
  }}]});
const {POST}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:'isolated-scan-route-probe'}});
let failed,uncertain,first,second,priced,finished,takeover,recovered,finalTicketCount,fixtureLeague,fixtureForecasts,fixtureTicketStatuses,originalTicketCount;
const originalFetch=globalThis.fetch;
const originalNow=Date.now;
try{
  const db=await mf.getD1Database('DB');
  for(const schema of schemas)await db.prepare(schema).run();
  const insert=db.prepare('INSERT INTO app_state(key,payload,updated_at) VALUES (?,?,?)');
  await db.batch([insert.bind('simulation_lab_v1',legacy.payload,legacy.updated_at),insert.bind('sim_state',personal.payload,personal.updated_at),insert.bind('sim_settings',settings.payload,settings.updated_at)]);
  let failFinalBatch=true,loseNextResponse=false,takeoverFinalBatch=false;
  globalThis.__isolatedScanDB={prepare:(...args)=>db.prepare(...args),batch:async statements=>{
    if(takeoverFinalBatch&&statements.length>10){
      takeoverFinalBatch=false;
      await db.prepare("UPDATE app_state SET payload=json_set(payload,'$.token','takeover-probe') WHERE key='scan_lock'").run();
      return db.batch(statements);
    }
    if(failFinalBatch&&statements.length>10){
      failFinalBatch=false;
      return db.batch([...statements.slice(0,-1),db.prepare("INSERT INTO app_state VALUES ('invalid',NULL,1)"),statements.at(-1)]);
    }
    if(loseNextResponse&&statements.length>10){
      loseNextResponse=false;
      await db.batch(statements);
      throw new Error('isolated response lost after D1 commit');
    }
    return db.batch(statements);
  }};
  globalThis.fetch=async()=>{throw new Error('external fetch forbidden in isolated scan probe')};
  const run=async()=>{const response=await POST(new Request('http://localhost/api/scan',{method:'POST'}));return {status:response.status,body:await response.json()};};
  const originalError=console.error;
  try{console.error=()=>{};failed=await run();}finally{console.error=originalError;}
  assert.equal(failed.status,503,JSON.stringify(failed.body).slice(0,800));
  assert.equal(failFinalBatch,false,'late SQL fault was not injected');
  assert.equal(restoreLabRows((await db.prepare(LAB_READ_SQL).all()).results).storage,'v1');
  assert.equal((await db.prepare("SELECT payload FROM app_state WHERE key='sim_state'").first()).payload,personal.payload);
  for(const table of tables.slice(1))assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n,0,`partial row in ${table}`);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM app_state WHERE key LIKE 'sampling_run:%'").first()).n,0);
  assert.equal(JSON.parse((await db.prepare("SELECT payload FROM app_state WHERE key='scan_progress_v1'").first()).payload).status,'partial');
  loseNextResponse=true;
  try{console.error=()=>{};uncertain=await run();}finally{console.error=originalError;}
  assert.equal(uncertain.status,503);
  assert.equal(uncertain.body.commitStatus,'committed-unverified');
  assert.equal(restoreLabRows((await db.prepare(LAB_READ_SQL).all()).results).storage,'v2');
  assert.equal(JSON.parse((await db.prepare("SELECT payload FROM app_state WHERE key='scan_progress_v1'").first()).payload).status,'complete');
  first=await run();
  assert.equal(first.status,200,JSON.stringify(first.body).slice(0,800));
  assert.equal(first.body.ok,true);
  assert.ok(first.body.statementCount>0);
  const afterFirst=restoreLabRows((await db.prepare(LAB_READ_SQL).all()).results);
  assert.equal(afterFirst.storage,'v2');
  assert.equal((await db.prepare("SELECT payload FROM app_state WHERE key='simulation_lab_v1'").first()).payload,legacy.payload);
  second=await run();
  assert.equal(second.status,200,JSON.stringify(second.body).slice(0,800));
  assert.equal(second.body.ok,true);
  const afterSecond=restoreLabRows((await db.prepare(LAB_READ_SQL).all()).results);
  finalTicketCount=afterSecond.lab.portfolios.reduce((n,p)=>n+p.tickets.length,0);
  assert.equal(finalTicketCount,JSON.parse(legacy.payload).portfolios.reduce((n,p)=>n+p.tickets.length,0));
  assert.equal((await db.prepare("SELECT count(*) AS n FROM app_state WHERE key LIKE 'sampling_run:%'").first()).n,3);
  assert.equal(JSON.parse((await db.prepare("SELECT payload FROM app_state WHERE key='scan_progress_v1'").first()).payload).status,'complete');
  // A deterministic priced fixture goes through the actual route's CDN parser,
  // then the same match returns as a final after kickoff. No network is used.
  const fixtureId='987654321987',fixtureStart=originalNow(),kickoff=new Date(fixtureStart+15*60000).toISOString();
  const event=finished=>({id:fixtureId,date:kickoff,competitions:[{date:kickoff,
    competitors:[
      {homeAway:'home',score:finished?'2':undefined,form:'WWDWW',team:{id:'90101',displayName:'Probe Home'}},
      {homeAway:'away',score:finished?'1':undefined,form:'LDDLW',team:{id:'90102',displayName:'Probe Away'}},
    ],status:{period:finished?2:0,type:{state:finished?'post':'pre',completed:finished,name:finished?'FULL_TIME':'STATUS_SCHEDULED'}},
    odds:[{provider:{displayName:'Probe Book'},moneyline:{home:{current:{odds:'2.10'}},draw:{current:{odds:'3.20'}},away:{current:{odds:'3.70'}}},
      total:{over:{current:{line:'o2.5',odds:'1.90'}},under:{current:{line:'u2.5',odds:'1.95'}}}}],
  }]});
  globalThis.__probeFeedMode='priced';
  globalThis.fetch=async url=>{
    const parsed=new URL(String(url));
    if(parsed.hostname!=='cdn.espn.com'||parsed.pathname!=='/core/soccer/scoreboard')throw new Error(`external fetch forbidden: ${parsed.hostname}`);
    const league=parsed.searchParams.get('league');
    if(!fixtureLeague&&league)fixtureLeague=league;
    return Response.json({events:league===fixtureLeague?[event(globalThis.__probeFeedMode==='finished')]:[]});
  };
  priced=await run();
  assert.equal(priced.status,200,JSON.stringify(priced.body).slice(0,800));
  assert.ok(priced.body.monitored>=1);
  assert.ok(priced.body.pricedUpcoming>=1,JSON.stringify(priced.body).slice(0,800));
  assert.ok(priced.body.marketQuotes.inserted>=1,JSON.stringify(priced.body).slice(0,800));
  assert.ok(priced.body.oddsSnapshotsInserted>=1,JSON.stringify(priced.body).slice(0,800));
  assert.equal((await db.prepare('SELECT count(*) AS n FROM market_quotes WHERE match_id=?').bind(fixtureId).first()).n,1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM market_results WHERE match_id=?').bind(fixtureId).first()).n,0);
  fixtureForecasts=(await db.prepare('SELECT count(*) AS n FROM model_forecasts WHERE match_id=?').bind(fixtureId).first()).n;
  assert.equal(fixtureForecasts,1,'priced match should freeze one pre-kickoff forecast');
  globalThis.__probeFeedMode='finished';
  Date.now=()=>fixtureStart+25*60000;
  finished=await run();
  assert.equal(finished.status,200,JSON.stringify(finished.body).slice(0,800));
  assert.ok(finished.body.marketResults>=1,JSON.stringify(finished.body).slice(0,800));
  assert.ok(finished.body.modelObservations.outcomeInserted>=1,JSON.stringify(finished.body).slice(0,800));
  const result=await db.prepare('SELECT state,home_score,away_score FROM market_results WHERE match_id=?').bind(fixtureId).first();
  assert.deepEqual([result.state,result.home_score,result.away_score],['final',2,1]);
  const originalTickets=new Map(JSON.parse(legacy.payload).portfolios.flatMap(p=>p.tickets.map(t=>[String(t.id),JSON.stringify(t)])));
  originalTicketCount=originalTickets.size;
  const latest=restoreLabRows((await db.prepare(LAB_READ_SQL).all()).results).lab;
  const latestTickets=new Map(latest.portfolios.flatMap(p=>p.tickets.map(t=>[String(t.id),JSON.stringify(t)])));
  for(const [id,ticket] of originalTickets)assert.equal(latestTickets.get(id),ticket,`existing ticket changed: ${id}`);
  finalTicketCount=latestTickets.size;
  fixtureTicketStatuses=latest.portfolios.flatMap(p=>p.tickets.filter(t=>!originalTickets.has(String(t.id))).map(t=>String(t.status)));
  const fixtureLegs=latest.portfolios.flatMap(p=>p.tickets.filter(t=>!originalTickets.has(String(t.id))).flatMap(t=>t.legs.filter(l=>String(l.matchId)===fixtureId)));
  assert.ok(fixtureLegs.length>0,'priced fixture should appear in new virtual tickets');
  for(const leg of fixtureLegs){
    assert.match(String(leg.settlementEvidence?.provider||''),/单源/);
    assert.match(String(leg.settlementEvidence?.sourceUrl||''),/^https:\/\/cdn\.espn\.com\/core\/soccer\/scoreboard\?/);
    assert.ok(Number.isSafeInteger(leg.settlementEvidence?.capturedAt));
  }
  assert.equal((await db.prepare("SELECT count(*) AS n FROM app_state WHERE key LIKE 'sampling_run:%'").first()).n,5);
  // A new lease owner appears immediately before the old worker's final
  // batch. The opening SQL guard must reject the whole old write set.
  const beforeTakeoverLab=JSON.stringify(latest),beforeTakeoverPersonal=(await db.prepare("SELECT payload FROM app_state WHERE key='sim_state'").first()).payload;
  const beforeTakeoverCounts=await Promise.all(tables.slice(1).map(async table=>(await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n));
  globalThis.__probeFeedMode=null;
  takeoverFinalBatch=true;
  try{console.error=()=>{};takeover=await run();}finally{console.error=originalError;}
  assert.equal(takeover.status,503);
  assert.equal(takeoverFinalBatch,false,'lease takeover was not injected');
  assert.equal(JSON.stringify(restoreLabRows((await db.prepare(LAB_READ_SQL).all()).results).lab),beforeTakeoverLab);
  assert.equal((await db.prepare("SELECT payload FROM app_state WHERE key='sim_state'").first()).payload,beforeTakeoverPersonal);
  assert.deepEqual(await Promise.all(tables.slice(1).map(async table=>(await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n)),beforeTakeoverCounts);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM app_state WHERE key LIKE 'sampling_run:%'").first()).n,5);
  assert.equal(JSON.parse((await db.prepare("SELECT payload FROM app_state WHERE key='scan_progress_v1'").first()).payload).status,'running');
  // Let the replacement lease age out, then acquire a new token. The new
  // owner must claim the still-fresh running progress without waiting 15 min.
  await db.prepare("UPDATE app_state SET updated_at=? WHERE key='scan_lock'").bind(Date.now()-13*60000).run();
  Date.now=()=>fixtureStart+25*60000+2000;
  recovered=await run();
  assert.equal(recovered.status,200,JSON.stringify(recovered.body).slice(0,800));
  assert.equal(recovered.body.ok,true);
  assert.equal(JSON.parse((await db.prepare("SELECT payload FROM app_state WHERE key='scan_progress_v1'").first()).payload).status,'complete');
  assert.equal((await db.prepare("SELECT count(*) AS n FROM app_state WHERE key LIKE 'sampling_run:%'").first()).n,6);
  const recoveredTickets=new Map(restoreLabRows((await db.prepare(LAB_READ_SQL).all()).results).lab.portfolios.flatMap(p=>p.tickets.map(t=>[String(t.id),JSON.stringify(t)])));
  for(const [id,ticket] of originalTickets)assert.equal(recoveredTickets.get(id),ticket,`recovery changed existing ticket: ${id}`);
}finally{Date.now=originalNow;globalThis.fetch=originalFetch;delete globalThis.__probeFeedMode;delete globalThis.__isolatedScanDB;await mf.dispose()}
const sha256=value=>createHash('sha256').update(value).digest('hex');
console.log(JSON.stringify({sourceReadOnly:true,externalFetchBlocked:true,isolatedD1:true,failedStatus:failed.status,rollbackVerified:true,uncertainStatus:uncertain.status,uncertainCommit:uncertain.body.commitStatus,firstStatus:first.status,secondStatus:second.status,pricedStatus:priced.status,finishedStatus:finished.status,takeoverStatus:takeover.status,takeoverRollbackVerified:true,recoveredStatus:recovered.status,fixtureLeague,quotesInserted:priced.body.marketQuotes.inserted,oddsInserted:priced.body.oddsSnapshotsInserted,forecastsInserted:fixtureForecasts,resultsInserted:finished.body.marketResults,outcomesInserted:finished.body.modelObservations.outcomeInserted,fixtureTicketStatuses,firstBatch:first.body.scanBatchId,secondBatch:second.body.scanBatchId,firstStatements:first.body.statementCount,secondStatements:second.body.statementCount,ticketsAfterFixture:finalTicketCount,originalTicketsPreserved:originalTicketCount,sourceLabSha256:sha256(legacy.payload)}));
