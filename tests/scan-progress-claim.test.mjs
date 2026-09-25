import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ADVANCE_SCAN_PROGRESS_SQL,CLAIM_SCAN_PROGRESS_SQL,FENCED_APP_STATE_INSERT_SQL,FENCED_APP_STATE_UPDATE_SQL,nextScanRevision} from '../lib/scan-progress-claim.js';

test('new progress revisions remain monotonic within one millisecond',()=>{
  assert.equal(nextScanRevision(100,100),101);
  assert.equal(nextScanRevision(100,99),100);
});

function claim(db,id,expected,now=1_000_000,token='owner-a'){
  const value={id,updatedAt:now,status:'running',stage:'prepared',errors:[]};
  return db.prepare(CLAIM_SCAN_PROGRESS_SQL).run('scan_progress_v1',JSON.stringify(value),now,token,expected,now-900_000,token).changes;
}
function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE app_state(key TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at INTEGER NOT NULL)');
  db.prepare('INSERT INTO app_state VALUES (?,?,?)').run('scan_lock',JSON.stringify({token:'owner-a',acquiredAt:1}),1);
  return db;
}
test('only one claimant can replace the same completed scan revision',()=>{
  const db=fixture();
  try{
    db.prepare('INSERT INTO app_state VALUES (?,?,?)').run('scan_progress_v1',JSON.stringify({id:'old',status:'complete',updatedAt:5,errors:[]}),5);
    assert.equal(claim(db,'first',5),1);
    assert.equal(claim(db,'second',5),0);
    assert.equal(JSON.parse(db.prepare("SELECT payload FROM app_state WHERE key='scan_progress_v1'").get().payload).id,'first');
  }finally{db.close()}
});
test('fresh running owner cannot be replaced, stale owner can be claimed once',()=>{
  const db=fixture();
  try{
    const row=db.prepare('INSERT INTO app_state VALUES (?,?,?)');
    row.run('scan_progress_v1',JSON.stringify({id:'running',status:'running',updatedAt:900_000,errors:[]}),900_000);
    assert.equal(claim(db,'blocked',900_000),0);
    db.prepare('UPDATE app_state SET payload=?,updated_at=? WHERE key=?').run(JSON.stringify({id:'stale',status:'running',updatedAt:1,errors:[]}),1,'scan_progress_v1');
    assert.equal(claim(db,'recovery',1),1);
    assert.equal(claim(db,'racer',1),0);
  }finally{db.close()}
});
test('new lease owner can replace a fresh running progress row once',()=>{
  const db=fixture();
  try{
    db.prepare('INSERT INTO app_state VALUES (?,?,?)').run('scan_progress_v1',JSON.stringify({id:'old',status:'running',updatedAt:900_000,errors:[]}),900_000);
    db.prepare('UPDATE app_state SET payload=?,updated_at=? WHERE key=?').run(JSON.stringify({token:'owner-b',acquiredAt:1_000_000}),1_000_000,'scan_lock');
    assert.equal(claim(db,'old-retry',900_000,1_000_001,'owner-a'),0);
    assert.equal(claim(db,'new-owner',900_000,1_000_001,'owner-b'),1);
    assert.equal(claim(db,'new-owner-race',900_000,1_000_001,'owner-b'),0);
    assert.equal(JSON.parse(db.prepare("SELECT payload FROM app_state WHERE key='scan_progress_v1'").get().payload).id,'new-owner');
  }finally{db.close()}
});
test('a missing progress row also accepts only one initial claim',()=>{
  const db=fixture();
  try{
    assert.equal(claim(db,'first',0),1);
    assert.equal(claim(db,'second',0),0);
  }finally{db.close()}
});
test('expired lease owner cannot claim or advance after takeover',()=>{
  const db=fixture();
  try{
    db.prepare('UPDATE app_state SET payload=? WHERE key=?').run(JSON.stringify({token:'owner-b'}),'scan_lock');
    assert.equal(claim(db,'stale',0),0);
    assert.equal(db.prepare("SELECT count(*) AS count FROM app_state WHERE key='scan_progress_v1'").get().count,0);
    db.prepare('INSERT INTO app_state VALUES (?,?,?)').run('scan_progress_v1',JSON.stringify({id:'old',stage:'lab',status:'running',errors:[]}),10);
    assert.equal(db.prepare(ADVANCE_SCAN_PROGRESS_SQL).run(JSON.stringify({id:'old',stage:'complete',status:'complete',errors:[]}),11,'scan_progress_v1',10,'owner-a').changes,0);
    assert.equal(JSON.parse(db.prepare("SELECT payload FROM app_state WHERE key='scan_progress_v1'").get().payload).stage,'lab');
    assert.equal(db.prepare(ADVANCE_SCAN_PROGRESS_SQL).run(JSON.stringify({id:'old',stage:'featured',status:'running',errors:[]}),11,'scan_progress_v1',10,'owner-b').changes,1);
  }finally{db.close()}
});
test('lease takeover fences lab and personal ledger writes without changing their old payloads',()=>{
  const db=fixture();
  try{
    const put=db.prepare('INSERT INTO app_state VALUES (?,?,?)');
    put.run('simulation_lab_v1','old-lab',10);
    put.run('sim_state','old-personal',10);
    db.prepare('UPDATE app_state SET payload=? WHERE key=?').run(JSON.stringify({token:'owner-b'}),'scan_lock');
    assert.equal(db.prepare(FENCED_APP_STATE_UPDATE_SQL).run('new-lab',11,'simulation_lab_v1',10,'owner-a').changes,0);
    assert.equal(db.prepare(FENCED_APP_STATE_UPDATE_SQL).run('new-personal',11,'sim_state',10,'owner-a').changes,0);
    assert.equal(db.prepare(FENCED_APP_STATE_INSERT_SQL).run('new-key','new-lab',11,'owner-a').changes,0);
    assert.equal(db.prepare("SELECT payload FROM app_state WHERE key='simulation_lab_v1'").get().payload,'old-lab');
    assert.equal(db.prepare("SELECT payload FROM app_state WHERE key='sim_state'").get().payload,'old-personal');
    assert.equal(db.prepare(FENCED_APP_STATE_UPDATE_SQL).run('new-lab',11,'simulation_lab_v1',10,'owner-b').changes,1);
    assert.equal(db.prepare(FENCED_APP_STATE_INSERT_SQL).run('new-key','new-lab',11,'owner-b').changes,1);
  }finally{db.close()}
});
