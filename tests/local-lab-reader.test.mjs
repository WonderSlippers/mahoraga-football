import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {splitLab} from '../lib/lab-shards.js';
import {readLocalLab} from '../scripts/local-lab-reader.mjs';

test('local audit reader switches to complete v2 without losing frozen v1 history',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('CREATE TABLE app_state(key TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at INTEGER NOT NULL)');
    const legacy={version:1,updatedAt:20,portfolios:[{id:'all-singles',tickets:[{id:'old-ticket',stake:28.75}]}]};
    db.prepare('INSERT INTO app_state VALUES (?,?,?)').run('simulation_lab_v1',JSON.stringify(legacy),20);
    assert.equal(readLocalLab(db).storage,'v1');
    const current={...legacy,updatedAt:21,portfolios:[{id:'all-singles',tickets:[...legacy.portfolios[0].tickets,{id:'new-ticket',stake:20}]}]};
    const {root,shards}=splitLab(current);
    const insert=db.prepare('INSERT INTO app_state VALUES (?,?,?)');
    insert.run('simulation_lab_v2',root,21);
    for(const shard of shards)insert.run(`simulation_lab_v2:${shard.id}`,shard.payload,21);
    const result=readLocalLab(db);
    assert.equal(result.storage,'v2');
    assert.deepEqual(result.lab,current);
    assert.equal(JSON.parse(db.prepare("SELECT payload FROM app_state WHERE key='simulation_lab_v1'").get().payload).portfolios[0].tickets[0].stake,28.75);
    db.prepare("UPDATE app_state SET updated_at=19 WHERE key LIKE 'simulation_lab_v2:%'").run();
    assert.throws(()=>readLocalLab(db),/revision mismatch/);
  }finally{db.close()}
});
