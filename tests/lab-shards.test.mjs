import assert from 'node:assert/strict';
import test from 'node:test';
import {Miniflare} from 'miniflare';
import {FENCED_LAB_V1_INSERT_SQL,FENCED_LAB_V1_UPDATE_SQL,joinLab,LAB_READ_SQL,LAB_SHARD_MAX_BYTES,LAB_V1_INSERT_SQL,LAB_V1_UPDATE_SQL,prepareLabShardCommit,restoreLabRows,splitLab} from '../lib/lab-shards.js';

function fixture(){
  return {updatedAt:1790248906593,lastScanAt:1790248800000,notes:'保留原始中文与 €',portfolios:[
    {id:'all-singles',name:'单关',tickets:[{id:'t-1',selection:'韩国胜',stake:20}]},
    {id:'value-singles',name:'价值单关',tickets:[{id:'t-2',selection:'平局',stake:28.75}]},
  ]};
}

test('lab shards round trip every portfolio without mutating or reordering input',()=>{
  const original=fixture();
  const snapshot=structuredClone(original);
  const {root,shards}=splitLab(original);
  assert.deepEqual(original,snapshot);
  assert.deepEqual(shards.map(row=>row.id),['all-singles:0','value-singles:0']);
  const restored=joinLab(root,shards.slice().reverse().map(row=>[row.id,row.payload]));
  assert.deepEqual(restored,original);
  assert.equal(JSON.stringify(restored),JSON.stringify(original));
  for(const payload of [root,...shards.map(row=>row.payload)])assert.ok(Buffer.byteLength(payload,'utf8')<LAB_SHARD_MAX_BYTES);
});

test('lab shards reject missing, duplicate, extra, and mixed-revision rows',()=>{
  const {root,shards}=splitLab(fixture());
  const rows=shards.map(row=>[row.id,row.payload]);
  assert.throws(()=>joinLab(root,rows.slice(0,1)),/missing or extra/);
  assert.throws(()=>joinLab(root,[...rows,rows[0]]),/duplicate/);
  assert.throws(()=>joinLab(root,[...rows,['unknown',rows[0][1]]]),/unexpected/);
  const stale=JSON.stringify({...JSON.parse(rows[0][1]),revision:123});
  assert.throws(()=>joinLab(root,[[rows[0][0],stale],rows[1]]),/malformed/);
});

test('storage reader prefers complete v2 and rejects orphan or mixed revisions',()=>{
  const lab=fixture(),{root,shards}=splitLab(lab),revision=lab.updatedAt;
  const legacy={key:'simulation_lab_v1',payload:JSON.stringify(lab),updated_at:revision-1};
  const rootRow={key:'simulation_lab_v2',payload:root,updated_at:revision};
  const shardRows=shards.map(row=>({key:`simulation_lab_v2:${row.id}`,payload:row.payload,updated_at:revision}));
  assert.deepEqual(restoreLabRows([legacy]),{lab,revision:revision-1,storage:'v1'});
  assert.deepEqual(restoreLabRows([legacy,rootRow,...shardRows]),{lab,revision,storage:'v2'});
  assert.throws(()=>restoreLabRows([legacy,...shardRows]),/without root/);
  assert.throws(()=>restoreLabRows([rootRow,{...shardRows[0],updated_at:revision-1},...shardRows.slice(1)]),/revision mismatch/);
  assert.throws(()=>restoreLabRows([rootRow,...shardRows.slice(1)]),/missing or extra/);
  assert.match(LAB_READ_SQL,/NOT EXISTS/);
});

test('isolated D1 batch never publishes partial lab shards',async()=>{
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:'lab-shards-isolated'}});
  try{
    const db=await mf.getD1Database('DB');
    await db.exec('CREATE TABLE app_state(key TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at INTEGER NOT NULL)');
    const lab=fixture(),legacy=JSON.stringify(lab),{root,shards}=splitLab(lab);
    await db.prepare('INSERT INTO app_state VALUES (?,?,?)').bind('simulation_lab_v1',legacy,lab.updatedAt).run();
    assert.equal(restoreLabRows((await db.prepare(LAB_READ_SQL).all()).results).storage,'v1');
    const insert=db.prepare('INSERT INTO app_state VALUES (?,?,?)');
    const statements=[insert.bind('simulation_lab_v2',root,lab.updatedAt),...shards.map(row=>insert.bind(`simulation_lab_v2:${row.id}`,row.payload,lab.updatedAt))];
    await assert.rejects(db.batch([...statements.slice(0,2),db.prepare("INSERT INTO app_state VALUES ('bad',NULL,1)"),...statements.slice(2)]));
    assert.equal((await db.prepare("SELECT count(*) AS count FROM app_state WHERE key LIKE 'simulation_lab_v2%'").first()).count,0);
    assert.equal((await db.prepare("SELECT payload FROM app_state WHERE key='simulation_lab_v1'").first()).payload,legacy);
    await db.batch(statements);
    assert.equal(restoreLabRows((await db.prepare(LAB_READ_SQL).all()).results).storage,'v2');
    await db.prepare('INSERT INTO app_state VALUES (?,?,?)').bind('scan_lock',JSON.stringify({token:'owner-a'}),1).run();
    assert.equal((await db.prepare(LAB_V1_UPDATE_SQL).bind('stale',lab.updatedAt+1,'simulation_lab_v1',lab.updatedAt).run()).meta.changes,0);
    assert.equal((await db.prepare(FENCED_LAB_V1_UPDATE_SQL).bind('stale',lab.updatedAt+1,'simulation_lab_v1',lab.updatedAt,'owner-a').run()).meta.changes,0);
    assert.equal((await db.prepare(LAB_V1_INSERT_SQL).bind('stale-copy','stale',lab.updatedAt+1).run()).meta.changes,0);
    assert.equal((await db.prepare(FENCED_LAB_V1_INSERT_SQL).bind('stale-copy','stale',lab.updatedAt+1,'owner-a').run()).meta.changes,0);
    assert.equal((await db.prepare("SELECT payload FROM app_state WHERE key='simulation_lab_v1'").first()).payload,legacy);
    const rows=(await db.prepare("SELECT key,payload FROM app_state WHERE key LIKE 'simulation_lab_v2%' ORDER BY key").all()).results;
    const restored=joinLab(rows.find(row=>row.key==='simulation_lab_v2').payload,rows.filter(row=>row.key!=='simulation_lab_v2').map(row=>[row.key.slice('simulation_lab_v2:'.length),row.payload]));
    assert.equal(JSON.stringify(restored),legacy);
  }finally{await mf.dispose()}
});

test('isolated D1 sharded commits fence lease and revisions, roll back late failures, and retain v1',async()=>{
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:'lab-sharded-commits-isolated'}});
  try{
    const db=await mf.getD1Database('DB');
    await db.exec('CREATE TABLE app_state(key TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at INTEGER NOT NULL)');
    const legacy=fixture(),legacyJson=JSON.stringify(legacy),read=async()=>restoreLabRows((await db.prepare(LAB_READ_SQL).all()).results);
    await db.prepare('INSERT INTO app_state VALUES (?,?,?)').bind('simulation_lab_v1',legacyJson,legacy.updatedAt).run();
    await db.prepare('INSERT INTO app_state VALUES (?,?,?)').bind('scan_lock',JSON.stringify({token:'owner-a'}),1).run();
    const stolen=prepareLabShardCommit(db,legacy,legacy.updatedAt,'v1','old-owner',legacy.updatedAt+1);
    await assert.rejects(db.batch(stolen.statements));
    assert.equal((await read()).storage,'v1');
    const first=prepareLabShardCommit(db,legacy,legacy.updatedAt,'v1','owner-a',legacy.updatedAt+1);
    await db.batch(first.statements);
    assert.equal(first.revision,legacy.updatedAt+1);
    assert.equal((await read()).storage,'v2');
    assert.equal((await db.prepare("SELECT payload FROM app_state WHERE key='simulation_lab_v1'").first()).payload,legacyJson);
    await assert.rejects(db.batch(first.statements));
    const next=structuredClone(first.nextLab);
    next.portfolios[0].tickets.push({id:'new-ticket',stake:20});
    const second=prepareLabShardCommit(db,next,first.revision,'v2','owner-a',first.revision);
    assert.equal(second.revision,first.revision+1);
    await assert.rejects(db.batch([...second.statements.slice(0,3),db.prepare("INSERT INTO app_state VALUES ('bad',NULL,1)"),...second.statements.slice(3)]));
    assert.equal((await read()).lab.portfolios[0].tickets.length,1);
    await db.prepare("UPDATE app_state SET payload=? WHERE key='scan_lock'").bind(JSON.stringify({token:'owner-b'})).run();
    await assert.rejects(db.batch(second.statements));
    assert.equal((await read()).lab.portfolios[0].tickets.length,1);
    const valid=prepareLabShardCommit(db,next,first.revision,'v2','owner-b',first.revision);
    await db.batch(valid.statements);
    assert.equal((await read()).lab.portfolios[0].tickets.length,2);
    assert.equal((await db.prepare("SELECT payload FROM app_state WHERE key='simulation_lab_v1'").first()).payload,legacyJson);
  }finally{await mf.dispose()}
});

test('lab shards split oversized Unicode portfolios into bounded rows',()=>{
  const lab=fixture();
  lab.portfolios[0].tickets[0].selection='界'.repeat(LAB_SHARD_MAX_BYTES/3);
  const {root,shards}=splitLab(lab);
  assert.ok(shards.length>2);
  assert.ok(shards.every(row=>Buffer.byteLength(row.payload,'utf8')<LAB_SHARD_MAX_BYTES));
  assert.equal(JSON.stringify(joinLab(root,shards.map(row=>[row.id,row.payload]))),JSON.stringify(lab));
});
