import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {FINALIZE_SCAN_GUARD_SQL,FINALIZE_SCAN_LEDGER_SQL,FINALIZE_SCAN_PROGRESS_SQL} from '../lib/scan-finalize-sql.js';

test('isolated D1 batch rolls back stale owner and late statement failures',async()=>{
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:'scan-finalize-isolated'}});
  try{
    const db=await mf.getD1Database('DB');
    await db.exec('CREATE TABLE app_state(key TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at INTEGER NOT NULL)');
    const insert=db.prepare('INSERT INTO app_state VALUES (?,?,?)');
    await db.batch([
      insert.bind('scan_lock',JSON.stringify({token:'owner-a'}),1),
      insert.bind('scan_progress_v1',JSON.stringify({id:'batch-a',stage:'odds',status:'running',errors:[]}),20),
      insert.bind('sim_state','old-ledger',10),
      insert.bind('sim_settings','settings',10),
    ]);
    const guard=token=>db.prepare(FINALIZE_SCAN_GUARD_SQL).bind(token,20,'batch-a','odds',10,10);
    const ledger=db.prepare(FINALIZE_SCAN_LEDGER_SQL).bind('new-ledger',11,10,10);
    const progress=db.prepare(FINALIZE_SCAN_PROGRESS_SQL).bind(JSON.stringify({id:'batch-a',stage:'complete',status:'complete',errors:[]}),21,20,'batch-a');
    await assert.rejects(db.batch([guard('old-owner'),ledger,progress]));
    assert.equal((await db.prepare("SELECT payload FROM app_state WHERE key='sim_state'").first()).payload,'old-ledger');
    await assert.rejects(db.batch([guard('owner-a'),ledger,db.prepare("INSERT INTO app_state VALUES ('bad',NULL,1)"),progress]));
    assert.equal((await db.prepare("SELECT payload FROM app_state WHERE key='sim_state'").first()).payload,'old-ledger');
    assert.equal(JSON.parse((await db.prepare("SELECT payload FROM app_state WHERE key='scan_progress_v1'").first()).payload).stage,'odds');
    const results=await db.batch([guard('owner-a'),ledger,progress]);
    assert.equal(results[1].meta.changes,1);
    assert.equal(results[2].meta.changes,1);
    assert.equal((await db.prepare("SELECT payload FROM app_state WHERE key='sim_state'").first()).payload,'new-ledger');
    await db.prepare("UPDATE app_state SET payload=?,updated_at=? WHERE key='scan_progress_v1'")
      .bind(JSON.stringify({id:'batch-a',stage:'prepared',status:'running',errors:[]}),22).run();
    const outage=await db.batch([
      db.prepare(FINALIZE_SCAN_GUARD_SQL).bind('owner-a',22,'batch-a','prepared',11,11),
      db.prepare(FINALIZE_SCAN_LEDGER_SQL).bind('outage-journal',12,11,11),
      db.prepare(FINALIZE_SCAN_PROGRESS_SQL).bind(JSON.stringify({id:'batch-a',stage:'complete',status:'partial',errors:['prepared: all feeds failed']}),23,22,'batch-a'),
    ]);
    assert.equal(outage[1].meta.changes,1);
    assert.equal((await db.prepare("SELECT payload FROM app_state WHERE key='sim_state'").first()).payload,'outage-journal');
    assert.equal(JSON.parse((await db.prepare("SELECT payload FROM app_state WHERE key='scan_progress_v1'").first()).payload).status,'partial');
  }finally{await mf.dispose()}
});
