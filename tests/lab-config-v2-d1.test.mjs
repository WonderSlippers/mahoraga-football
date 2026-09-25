import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {LAB_READ_SQL,prepareLabShardCommit,restoreLabRows} from '../lib/lab-shards.js';

const bundled=await build({entryPoints:['lib/simulation-lab.ts'],absWorkingDir:process.cwd(),bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',alias:{'@':process.cwd()},
  plugins:[{name:'isolated-worker-binding',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'worker-env',namespace:'test-env'}));b.onLoad({filter:/.*/,namespace:'test-env'},()=>({contents:'export const env={get DB(){return globalThis.__isolatedLabDB;}};',loader:'js'}));}}],
});
const {readLab,runSimulationLab,updateLabConfig}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));

test('v2 strategy config saves in shards while keeping the legacy ticket byte-identical',async()=>{
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:'lab-v2-config-isolated'}});
  try{
    const db=await mf.getD1Database('DB');
    globalThis.__isolatedLabDB=db;
    await db.exec('CREATE TABLE app_state(key TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at INTEGER NOT NULL)');
    const legacy={version:1,updatedAt:100,lastScanAt:0,portfolios:[{id:'all-singles',name:'广覆盖单场',rule:'旧规则',legs:1,enabled:true,stake:20,maxTickets:100,initialBalance:10000,tickets:[{id:'old-ticket',stake:28.75,status:'open',legs:[],odds:2}]}]};
    const legacyJson=JSON.stringify(legacy);
    await db.prepare('INSERT INTO app_state VALUES (?,?,?)').bind('simulation_lab_v1',legacyJson,100).run();
    const migration=prepareLabShardCommit(db,legacy,100,'v1',null,101);
    await db.batch(migration.statements);
    const before=await readLab();
    assert.equal(before.portfolios[0].tickets[0].stake,28.75);
    await updateLabConfig({id:'all-singles',enabled:false,stake:20,maxTickets:80});
    const stored=restoreLabRows((await db.prepare(LAB_READ_SQL).all()).results);
    assert.equal(stored.storage,'v2');
    assert.ok(stored.revision>101);
    assert.equal(stored.lab.portfolios.find(row=>row.id==='all-singles').enabled,false);
    assert.equal(stored.lab.portfolios.find(row=>row.id==='all-singles').maxTickets,80);
    assert.equal(stored.lab.portfolios.find(row=>row.id==='all-singles').tickets[0].stake,28.75);
    assert.equal((await db.prepare("SELECT payload FROM app_state WHERE key='simulation_lab_v1'").first()).payload,legacyJson);
    await db.prepare('INSERT INTO app_state VALUES (?,?,?)').bind('scan_lock',JSON.stringify({token:'owner-a'}),1).run();
    const revision=stored.revision;
    await assert.rejects(runSimulationLab([],'本轮无有效数据',false,undefined,'stale-owner'),/租约|并发/);
    assert.equal(restoreLabRows((await db.prepare(LAB_READ_SQL).all()).results).revision,revision);
    await runSimulationLab([],'本轮无有效数据',false,undefined,'owner-a');
    assert.ok(restoreLabRows((await db.prepare(LAB_READ_SQL).all()).results).revision>revision);
  }finally{delete globalThis.__isolatedLabDB;await mf.dispose()}
});
