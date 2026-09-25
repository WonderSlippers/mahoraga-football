import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {FINALIZE_SCAN_GUARD_SQL,FINALIZE_SCAN_LEDGER_SQL,FINALIZE_SCAN_PROGRESS_SQL} from '../lib/scan-finalize-sql.js';

function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE app_state(key TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at INTEGER NOT NULL)');
  const insert=db.prepare('INSERT INTO app_state VALUES (?,?,?)');
  insert.run('scan_lock',JSON.stringify({token:'owner-a'}),1);
  insert.run('scan_progress_v1',JSON.stringify({id:'batch-a',stage:'odds',status:'running',errors:[]}),20);
  insert.run('sim_state','old-ledger',10);
  insert.run('sim_settings','settings',10);
  return db;
}
function value(db,key){return {...db.prepare('SELECT payload,updated_at FROM app_state WHERE key=?').get(key)}}
function finalize(db,{token='owner-a',revision=10,failAfterLedger=false}={}){
  db.exec('BEGIN');
  try{
    assert.equal(db.prepare(FINALIZE_SCAN_GUARD_SQL).get(token,20,'batch-a','odds',revision,revision).allowed,1);
    assert.equal(db.prepare(FINALIZE_SCAN_LEDGER_SQL).run('new-ledger',11,revision,revision).changes,1);
    if(failAfterLedger)db.exec('INSERT INTO app_state(key,payload,updated_at) VALUES (\'bad\',NULL,1)');
    assert.equal(db.prepare(FINALIZE_SCAN_PROGRESS_SQL).run(JSON.stringify({id:'batch-a',stage:'complete',status:'complete',errors:[]}),21,20,'batch-a').changes,1);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
}
test('final scan guard rejects stolen lease and a changed personal revision before any write',()=>{
  const db=fixture();
  try{
    assert.throws(()=>finalize(db,{token:'owner-b'}),/malformed JSON/);
    assert.throws(()=>finalize(db,{revision:11}),/malformed JSON/);
    assert.deepEqual(value(db,'sim_state'),{payload:'old-ledger',updated_at:10});
    assert.equal(JSON.parse(value(db,'scan_progress_v1').payload).stage,'odds');
  }finally{db.close()}
});
test('failure after ledger update rolls back ledger and progress together',()=>{
  const db=fixture();
  try{
    assert.throws(()=>finalize(db,{failAfterLedger:true}),/NOT NULL/);
    assert.deepEqual(value(db,'sim_state'),{payload:'old-ledger',updated_at:10});
    assert.equal(JSON.parse(value(db,'scan_progress_v1').payload).stage,'odds');
    finalize(db);
    assert.deepEqual(value(db,'sim_state'),{payload:'new-ledger',updated_at:11});
    assert.equal(JSON.parse(value(db,'scan_progress_v1').payload).stage,'complete');
  }finally{db.close()}
});
