import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeHealthHistory} from '../scripts/local-health-history.mjs';

const report=(time,pid,bytes,codes=[],version='dist-next-35')=>({
  kind:'edge-local-health-v1',runtime:{pid,version,privateBytes:bytes},
  summary:{checkedAt:new Date(time).toISOString(),alerts:codes.map(code=>({code}))},
});

test('memory trend uses only the same PID and build, while alert changes use latest report',()=>{
  const old=report(1000,1,100*1048576,['old']);
  const same=report(2000,2,200*1048576,['warning']);
  const differentBuild=report(2500,2,900*1048576,['warning'],'dist-next-34');
  const current=report(3000,2,210*1048576,['warning','new']);
  const result=summarizeHealthHistory([old,same,differentBuild],current);
  assert.equal(result.process.samples,2);
  assert.equal(result.process.deltaMiB,10);
  assert.deepEqual(result.alertChanges.new,['new']);
  assert.deepEqual(result.alertChanges.continuing,['warning']);
});

test('malformed or future observations cannot prove a memory trend',()=>{
  const current=report(3000,2,210*1048576);
  const result=summarizeHealthHistory([{},report(4000,2,1),report(1000,2,-1)],current);
  assert.equal(result.process.samples,1);
  assert.equal(result.process.deltaMiB,0);
  assert.equal(result.alertChanges.previousAt,new Date(1000).toISOString());
});
