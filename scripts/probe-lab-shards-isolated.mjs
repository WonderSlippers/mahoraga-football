import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {Miniflare} from 'miniflare';
import {joinLab,splitLab} from '../lib/lab-shards.js';

const file=process.argv[2];
if(!file)throw new Error('Usage: node scripts/probe-lab-shards-isolated.mjs <source-d1-sqlite>');
const source=new DatabaseSync(file,{readOnly:true});
let legacy;
try{
  assert.equal(source.prepare('PRAGMA quick_check').get().quick_check,'ok');
  legacy=source.prepare('SELECT payload,updated_at FROM app_state WHERE key=?').get('simulation_lab_v1');
  assert.ok(legacy?.payload,'source simulation_lab_v1 missing');
}finally{source.close()}

const lab=JSON.parse(legacy.payload),{root,shards}=splitLab(lab),sha256=value=>createHash('sha256').update(value).digest('hex');
assert.equal(JSON.stringify(joinLab(root,shards.map(row=>[row.id,row.payload]))),legacy.payload);
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:'lab-shards-probe-isolated'}});
let durationMs;
try{
  const db=await mf.getD1Database('DB');
  await db.exec('CREATE TABLE app_state(key TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at INTEGER NOT NULL)');
  const insert=db.prepare('INSERT INTO app_state VALUES (?,?,?)');
  await insert.bind('simulation_lab_v1',legacy.payload,legacy.updated_at).run();
  const statements=[insert.bind('simulation_lab_v2',root,legacy.updated_at),...shards.map(row=>insert.bind(`simulation_lab_v2:${row.id}`,row.payload,legacy.updated_at))];
  await assert.rejects(db.batch([...statements.slice(0,2),db.prepare("INSERT INTO app_state VALUES ('bad',NULL,1)"),...statements.slice(2)]));
  assert.equal((await db.prepare("SELECT count(*) AS count FROM app_state WHERE key LIKE 'simulation_lab_v2%'").first()).count,0);
  assert.equal((await db.prepare("SELECT payload FROM app_state WHERE key='simulation_lab_v1'").first()).payload,legacy.payload);
  const start=performance.now();
  await db.batch(statements);
  durationMs=Math.round(performance.now()-start);
  const rows=(await db.prepare("SELECT key,payload FROM app_state WHERE key LIKE 'simulation_lab_v2%'").all()).results;
  const restored=joinLab(rows.find(row=>row.key==='simulation_lab_v2').payload,rows.filter(row=>row.key!=='simulation_lab_v2').map(row=>[row.key.slice('simulation_lab_v2:'.length),row.payload]));
  assert.equal(JSON.stringify(restored),legacy.payload);
}finally{await mf.dispose()}
console.log(JSON.stringify({sourceReadOnly:true,isolatedD1:true,rollbackVerified:true,byteExact:true,sourceBytes:Buffer.byteLength(legacy.payload),sourceSha256:sha256(legacy.payload),rootBytes:Buffer.byteLength(root),shardCount:shards.length,largestShardBytes:Math.max(...shards.map(row=>Buffer.byteLength(row.payload))),ticketCount:lab.portfolios.reduce((total,portfolio)=>total+portfolio.tickets.length,0),batchDurationMs:durationMs}));
