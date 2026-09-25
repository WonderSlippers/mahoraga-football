import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {LAB_READ_SQL,prepareLabShardCommit,restoreLabRows} from '../lib/lab-shards.js';

const file=process.argv[2];
if(!file)throw new Error('Usage: node scripts/probe-atomic-scan-isolated.mjs <source-d1-sqlite>');
const tables=['app_state','model_forecasts','model_outcomes','market_quotes','market_results','odds_snapshots'];
const source=new DatabaseSync(file,{readOnly:true});
let legacy,personal,settings,schemas;
try{
  assert.equal(source.prepare('PRAGMA quick_check').get().quick_check,'ok');
  const read=key=>source.prepare('SELECT payload,updated_at FROM app_state WHERE key=?').get(key);
  legacy=read('simulation_lab_v1');personal=read('sim_state');settings=read('sim_settings');
  assert.ok(legacy?.payload&&personal?.payload&&settings?.payload,'source ledger rows missing');
  schemas=tables.map(name=>source.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name)?.sql);
  assert.ok(schemas.every(Boolean),'source schema is incomplete');
}finally{source.close()}

const bundled=await build({stdin:{contents:"export {prepareModelObservationStatements} from './db/model-observations.ts'; export {prepareSamplingAuditStatement} from './db/sampling-audit.ts'; export {prepareMarketQuoteStatements} from './db/market-quotes.ts'; export {prepareMarketResultStatements} from './db/market-results.ts'; export {prepareOddsSnapshotStatements} from './db/odds.ts'; export {prepareScanFinalizationStatements} from './db/scan-progress.ts'; export {commitAtomicScan} from './db/scan-atomic.ts';",resolveDir:process.cwd(),sourcefile:'atomic-scan-probe-entry.ts'},
  bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',alias:{'@':process.cwd()},
  plugins:[{name:'isolated-worker-binding',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'worker-env',namespace:'test-env'}));b.onLoad({filter:/.*/,namespace:'test-env'},()=>({contents:'export const env={};',loader:'js'}));}}]});
const {prepareModelObservationStatements,prepareSamplingAuditStatement,prepareMarketQuoteStatements,prepareMarketResultStatements,prepareOddsSnapshotStatements,prepareScanFinalizationStatements,commitAtomicScan}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const sha256=value=>createHash('sha256').update(value).digest('hex');
const lab=JSON.parse(legacy.payload),ticketCount=lab.portfolios.reduce((n,p)=>n+p.tickets.length,0);
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:'real-ledger-atomic-probe-isolated'}});
let elapsed,statementCount;
try{
  const db=await mf.getD1Database('DB');
  for(const schema of schemas)await db.prepare(schema).run();
  const insert=db.prepare('INSERT INTO app_state(key,payload,updated_at) VALUES (?,?,?)');
  const progress={id:'isolated-atomic-probe',startedAt:20,updatedAt:21,stage:'prepared',status:'running',selectedLeagues:['eng.1'],errors:[]};
  await db.batch([insert.bind('simulation_lab_v1',legacy.payload,legacy.updated_at),insert.bind('sim_state',personal.payload,personal.updated_at),insert.bind('sim_settings',settings.payload,settings.updated_at),insert.bind('scan_lock',JSON.stringify({token:'isolated-owner'}),1),insert.bind('scan_progress_v1',JSON.stringify(progress),21)]);
  const now=Date.now(),capturedAt=now-3*3600000,kickoff=now-2*3600000;
  const feedUrl='https://cdn.espn.com/core/soccer/scoreboard?league=eng.1';
  const quote={id:'401234569',leagueCode:'eng.1',home:'Probe Home',away:'Probe Away',date:kickoff,status:'soon',detail:'',sourceUrl:feedUrl,observedAt:capturedAt,totalOffers:[{line:2.5,over:1.9,under:1.9,provider:'Probe Book',phase:'current'}]};
  const final={...quote,status:'finished',detail:'Full Time',observedAt:now,hs:2,as:1,period:2};
  const forecastMatch={id:'401234570',leagueCode:'eng.1',date:now+2*3600000,status:'soon',observedAt:now-60000,sourceUrl:'http://localhost/api/feed?league=eng.1',odds:[2,3,4],providers:['Probe Book','Probe Book','Probe Book'],oddsPhase:'current'};
  const radar={capturedAt:now,entries:[{matchId:forecastMatch.id,leagueCode:'eng.1',odds:[2,3,4],rawProbabilities:[.5,.3,.2],pick:0,probability:.45,score:80,newScore:76}]};
  const model=prepareModelObservationStatements(db,[forecastMatch,final],radar);
  const sampling=prepareSamplingAuditStatement(db,progress.id,now,['eng.1'],[],[forecastMatch],{forecastObserved:model.forecastObserved,outcomeObserved:model.outcomeObserved});
  const quotes=prepareMarketQuoteStatements(db,[quote],capturedAt);
  const results=prepareMarketResultStatements(db,[final]);
  const odds=prepareOddsSnapshotStatements(db,[{matchId:quote.id,leagueCode:'eng.1',capturedAt,homeOdds:2,drawOdds:3,awayOdds:4,provider:'Probe Book'}]);
  const revision=Math.max(personal.updated_at,settings.updated_at);
  assert.equal(personal.updated_at,revision,'source personal ledger revision differs from settings; probe requires equal revisions');
  const progressRow=await db.prepare("SELECT payload,updated_at FROM app_state WHERE key='scan_progress_v1'").first();
  const finish=prepareScanFinalizationStatements(db,progressRow,progress.id,'isolated-owner',JSON.parse(personal.payload),revision,revision+1,'prepared');
  const labWrite=prepareLabShardCommit(db,lab,legacy.updated_at,'v1','isolated-owner',legacy.updated_at+1);
  const set={lab:labWrite.statements,forecasts:model.forecastStatements,outcomes:model.outcomeStatements,quotes:quotes.statements,results,odds,sampling:sampling.statement,finalize:finish.statements};
  await assert.rejects(commitAtomicScan(db,{...set,finalize:[finish.statements[0],finish.statements[1],db.prepare("INSERT INTO app_state VALUES ('invalid',NULL,1)"),finish.statements[2]]}));
  assert.equal(restoreLabRows((await db.prepare(LAB_READ_SQL).all()).results).storage,'v1');
  assert.equal((await db.prepare("SELECT payload FROM app_state WHERE key='sim_state'").first()).payload,personal.payload);
  for(const table of tables.slice(1))assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n,0,`partial row in ${table}`);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM app_state WHERE key LIKE 'sampling_run:%'").first()).n,0);
  const started=performance.now(),written=await commitAtomicScan(db,set);elapsed=Math.round(performance.now()-started);statementCount=written.statementCount;
  assert.deepEqual([written.forecastInserted,written.outcomeInserted,written.quotesInserted,written.resultsInserted,written.oddsInserted],[1,1,1,1,1]);
  const current=restoreLabRows((await db.prepare(LAB_READ_SQL).all()).results);
  assert.equal(current.storage,'v2');
  assert.equal(JSON.stringify(current.lab.portfolios),JSON.stringify(lab.portfolios),'historical tickets changed');
  assert.equal((await db.prepare("SELECT payload FROM app_state WHERE key='simulation_lab_v1'").first()).payload,legacy.payload);
  assert.equal(JSON.parse((await db.prepare("SELECT payload FROM app_state WHERE key='scan_progress_v1'").first()).payload).status,'complete');
  await assert.rejects(commitAtomicScan(db,set));
  assert.equal(restoreLabRows((await db.prepare(LAB_READ_SQL).all()).results).revision,current.revision);
}finally{await mf.dispose()}
console.log(JSON.stringify({sourceReadOnly:true,isolatedD1:true,rollbackVerified:true,replayRejected:true,ticketsPreserved:ticketCount,sourceLabBytes:Buffer.byteLength(legacy.payload),sourceLabSha256:sha256(legacy.payload),statementCount,batchDurationMs:elapsed}));
