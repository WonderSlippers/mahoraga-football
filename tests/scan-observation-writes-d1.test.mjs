import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {LAB_READ_SQL,prepareLabShardCommit,restoreLabRows} from '../lib/lab-shards.js';

const bundled=await build({
  stdin:{contents:"export {prepareModelObservationStatements} from './db/model-observations.ts'; export {prepareSamplingAuditStatement} from './db/sampling-audit.ts'; export {prepareMarketQuoteStatements} from './db/market-quotes.ts'; export {prepareMarketResultStatements} from './db/market-results.ts'; export {prepareOddsSnapshotStatements} from './db/odds.ts'; export {prepareScanFinalizationStatements} from './db/scan-progress.ts'; export {commitAtomicScan,MAX_ATOMIC_SCAN_STATEMENTS} from './db/scan-atomic.ts';",resolveDir:process.cwd(),sourcefile:'scan-observation-test-entry.ts'},
  bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',
  alias:{'@':process.cwd()},
  plugins:[{name:'isolated-worker-binding',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'worker-env',namespace:'test-env'}));b.onLoad({filter:/.*/,namespace:'test-env'},()=>({contents:'export const env={};',loader:'js'}));}}],
});
const {prepareModelObservationStatements,prepareSamplingAuditStatement,prepareMarketQuoteStatements,prepareMarketResultStatements,prepareOddsSnapshotStatements,prepareScanFinalizationStatements,commitAtomicScan,MAX_ATOMIC_SCAN_STATEMENTS}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));

test('model observations and sampling audit roll back together on late D1 failure and replay once',async()=>{
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:'scan-observation-writes-isolated'}});
  try{
    const db=await mf.getD1Database('DB');
    await db.exec(`CREATE TABLE app_state(key TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE model_forecasts(id TEXT PRIMARY KEY,league_code TEXT,match_id TEXT,kickoff_at INTEGER,captured_at INTEGER,source_observed_at INTEGER,source_url TEXT,source_updated_at INTEGER,quote_provider TEXT,quote_phase TEXT,home_odds REAL,draw_odds REAL,away_odds REAL,raw_probabilities TEXT,pick INTEGER,conservative_probability REAL,old_score INTEGER,new_score INTEGER,model_version TEXT);
      CREATE TABLE model_outcomes(id TEXT PRIMARY KEY,league_code TEXT,match_id TEXT,observed_at INTEGER,state TEXT,home_score INTEGER,away_score INTEGER,source_url TEXT,detail TEXT);`);
    const now=Date.now();
    const upcoming={id:'401234567',leagueCode:'eng.1',date:now+2*3600000,status:'soon',observedAt:now-60000,sourceUrl:'http://localhost/api/feed?league=eng.1',odds:[2,3,4],providers:['Book A','Book A','Book A'],oddsPhase:'current'};
    const final={id:'401234568',leagueCode:'eng.1',date:now-3*3600000,status:'finished',observedAt:now,sourceUrl:'http://localhost/api/feed?league=eng.1',hs:2,as:1,period:2,detail:'Full Time'};
    const radar={capturedAt:now,entries:[{matchId:upcoming.id,leagueCode:upcoming.leagueCode,odds:[2,3,4],rawProbabilities:[.5,.3,.2],pick:0,probability:.45,score:80,newScore:76}]};
    const prepared=prepareModelObservationStatements(db,[upcoming,final],radar);
    assert.deepEqual([prepared.forecastObserved,prepared.outcomeObserved],[1,1]);
    const audit=prepareSamplingAuditStatement(db,'batch-a',now,['eng.1'],[],[upcoming,final],{forecastObserved:1,forecastInserted:1,outcomeObserved:1,outcomeInserted:1});
    const statements=[...prepared.forecastStatements,...prepared.outcomeStatements,audit.statement];
    await assert.rejects(db.batch([...statements,db.prepare("INSERT INTO app_state VALUES ('invalid',NULL,1)")]));
    for(const table of ['model_forecasts','model_outcomes','app_state'])assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n,0);
    const first=await db.batch(statements);
    assert.deepEqual(first.map(row=>row.meta.changes),[1,1,1]);
    const replay=await db.batch(statements);
    assert.deepEqual(replay.map(row=>row.meta.changes),[0,0,0]);
    const saved=await db.prepare("SELECT payload FROM app_state WHERE key='sampling_run:batch-a'").first();
    assert.equal(JSON.parse(saved.payload).forecastObserved,1);
  }finally{await mf.dispose()}
});

test('market quote, dependent result, and odds snapshot share rollback and replay boundaries',async()=>{
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:'scan-market-writes-isolated'}});
  try{
    const db=await mf.getD1Database('DB');
    await db.exec(`CREATE TABLE app_state(key TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE market_quotes(id TEXT PRIMARY KEY,match_id TEXT,league_code TEXT,home TEXT,away TEXT,kickoff_at INTEGER,captured_at INTEGER,market TEXT,line REAL,over_odds REAL,under_odds REAL,provider TEXT,phase TEXT,source_url TEXT);
      CREATE TABLE market_results(id TEXT PRIMARY KEY,match_id TEXT,league_code TEXT,observed_at INTEGER,state TEXT,home_score INTEGER,away_score INTEGER,detail TEXT,source_url TEXT,fingerprint TEXT);
      CREATE TABLE odds_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,match_id TEXT,league_code TEXT,captured_at INTEGER,home_odds REAL,draw_odds REAL,away_odds REAL,provider TEXT);`);
    const now=Date.now(),capturedAt=now-3*3600000,kickoff=now-2*3600000;
    const shared={id:'401234569',leagueCode:'eng.1',date:kickoff,sourceUrl:'https://cdn.espn.com/core/soccer/scoreboard?league=eng.1',detail:'Full Time'};
    const quote={...shared,home:'Home',away:'Away',status:'soon',observedAt:capturedAt,totalOffers:[{line:2.5,over:1.9,under:1.9,provider:'Book A',phase:'current'}]};
    const result={...shared,status:'finished',observedAt:now,hs:2,as:1,period:2};
    const preparedQuotes=prepareMarketQuoteStatements(db,[quote],capturedAt);
    const statements=[...preparedQuotes.statements,...prepareMarketResultStatements(db,[result]),...prepareOddsSnapshotStatements(db,[{matchId:shared.id,leagueCode:shared.leagueCode,capturedAt,homeOdds:2,drawOdds:3,awayOdds:4,provider:'Book A'}])];
    assert.equal(preparedQuotes.observed,1);
    assert.equal(statements.length,3);
    await assert.rejects(db.batch([...statements,db.prepare("INSERT INTO app_state VALUES ('invalid',NULL,1)")]));
    for(const table of ['market_quotes','market_results','odds_snapshots'])assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n,0);
    const first=await db.batch(statements);
    assert.deepEqual(first.map(row=>row.meta.changes),[1,1,1]);
    const replay=await db.batch(statements);
    assert.deepEqual(replay.map(row=>row.meta.changes),[0,0,0]);
    assert.equal((await db.prepare('SELECT state FROM market_results').first()).state,'final');
  }finally{await mf.dispose()}
});

test('composed lab shards, sampling audit, personal ledger and completion marker have one D1 rollback boundary',async()=>{
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:'scan-composed-writes-isolated'}});
  try{
    const db=await mf.getD1Database('DB');
    await db.exec('CREATE TABLE app_state(key TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at INTEGER NOT NULL)');
    const lab={updatedAt:1,portfolios:[{id:'all-singles',tickets:[{id:'old-ticket',stake:28.75}]}]};
    const progress={id:'batch-a',startedAt:19,updatedAt:20,stage:'prepared',status:'running',selectedLeagues:['eng.1'],errors:[]};
    const insert=db.prepare('INSERT INTO app_state VALUES (?,?,?)');
    await db.batch([insert.bind('simulation_lab_v1',JSON.stringify(lab),1),insert.bind('scan_lock',JSON.stringify({token:'owner-a'}),1),insert.bind('scan_progress_v1',JSON.stringify(progress),20),insert.bind('sim_state','old-ledger',10),insert.bind('sim_settings','settings',10)]);
    const next=structuredClone(lab);next.portfolios[0].tickets.push({id:'new-ticket',stake:20});
    const labWrites=prepareLabShardCommit(db,next,1,'v1','owner-a',2);
    const audit=prepareSamplingAuditStatement(db,'batch-a',Date.now(),['eng.1'],[],[],{});
    const progressRow=await db.prepare("SELECT payload,updated_at FROM app_state WHERE key='scan_progress_v1'").first();
    const finish=prepareScanFinalizationStatements(db,progressRow,'batch-a','owner-a',{records:[]},10,11,'prepared');
    const writeSet={lab:labWrites.statements,forecasts:[],outcomes:[],quotes:[],results:[],odds:[],sampling:audit.statement,finalize:finish.statements};
    await assert.rejects(commitAtomicScan(db,{...writeSet,finalize:[finish.statements[0],finish.statements[1],db.prepare("INSERT INTO app_state VALUES ('invalid',NULL,1)"),finish.statements[2]]}));
    assert.equal(restoreLabRows((await db.prepare(LAB_READ_SQL).all()).results).storage,'v1');
    assert.equal((await db.prepare("SELECT payload FROM app_state WHERE key='sim_state'").first()).payload,'old-ledger');
    assert.equal((await db.prepare("SELECT count(*) AS n FROM app_state WHERE key LIKE 'sampling_run:%'").first()).n,0);
    assert.equal(JSON.parse((await db.prepare("SELECT payload FROM app_state WHERE key='scan_progress_v1'").first()).payload).status,'running');
    await assert.rejects(commitAtomicScan(db,{...writeSet,forecasts:Array.from({length:MAX_ATOMIC_SCAN_STATEMENTS},()=>db.prepare('SELECT 1'))}),/超过单事务安全上限/);
    const committed=await commitAtomicScan(db,writeSet);
    assert.equal(committed.samplingRecorded,true);
    const stored=restoreLabRows((await db.prepare(LAB_READ_SQL).all()).results);
    assert.equal(stored.storage,'v2');
    assert.deepEqual(stored.lab.portfolios[0].tickets.map(ticket=>ticket.id),['old-ticket','new-ticket']);
    assert.equal((await db.prepare("SELECT payload FROM app_state WHERE key='simulation_lab_v1'").first()).payload,JSON.stringify(lab));
    assert.equal(JSON.parse((await db.prepare("SELECT payload FROM app_state WHERE key='scan_progress_v1'").first()).payload).status,'complete');
    await assert.rejects(commitAtomicScan(db,writeSet));
    assert.equal(restoreLabRows((await db.prepare(LAB_READ_SQL).all()).results).lab.portfolios[0].tickets.length,2);
  }finally{await mf.dispose()}
});
