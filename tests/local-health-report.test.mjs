import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeLocalHealth} from '../scripts/local-health-report-policy.mjs';

const base={runtime:{listening:true,version:'dist-next-35',versionNumber:35,privateBytes:200*1048576},ledger:{quickCheck:'ok',counts:{review:0},lastScanAt:100},scanLog:{lastOk:null},candidate:{number:40}};

test('a stored scan timestamp cannot be reported as a verified task success',()=>{
  const result=summarizeLocalHealth({...base,now:200});
  assert.equal(result.evidence.scanLastTaskOkAt,null);
  assert.equal(result.evidence.scanLastStoredAt,100);
  assert.match(result.evidence.scanStatus,/尚无可核对/);
  assert.equal(result.evidence.feedLastSuccessAt,null);
  assert.equal(result.evidence.reconcileLastSuccessAt,null);
});

test('missing D1, missing listener, and high private memory are not healthy',()=>{
  const result=summarizeLocalHealth({...base,runtime:{listening:false,privateBytes:900*1048576},ledger:{error:'unreadable'}});
  assert.equal(result.state,'critical');
  assert.deepEqual(result.alerts.filter(item=>item.severity==='critical').map(item=>item.code),['listener-missing','d1-unverified']);
  assert.ok(result.alerts.some(item=>item.code==='scan-memory-gate'));
});

test('a pending candidate and review tickets remain visible without inventing a failure',()=>{
  const result=summarizeLocalHealth({...base,ledger:{...base.ledger,counts:{review:2}},now:200});
  assert.equal(result.state,'incomplete');
  assert.ok(result.alerts.some(item=>item.code==='candidate-not-active'));
  assert.ok(result.alerts.some(item=>item.code==='review-pending'));
  assert.ok(result.alerts.some(item=>item.code==='scan-task-unverified'));
});
