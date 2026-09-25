import test from 'node:test';
import assert from 'node:assert/strict';
import {strategyStatus,strategyCanCreate} from '../public/strategy-status.js';

test('effective strategy status does not misrepresent stored enabled=true',()=>{
  for(const id of ['totals-baseline','totals-poisson']){
    assert.equal(strategyStatus({id,enabled:true}),'只读历史');
    assert.equal(strategyCanCreate({id,enabled:true}),false);
  }
  for(const id of ['treble','mixed-double'])assert.equal(strategyStatus({id,enabled:true}),'暂停待复核');
  assert.equal(strategyStatus({id:'value-singles',enabled:true}),'运行中');
  assert.equal(strategyStatus({id:'value-singles',enabled:false}),'已暂停');
});
