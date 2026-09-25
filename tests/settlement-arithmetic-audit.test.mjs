import test from 'node:test';
import assert from 'node:assert/strict';
import {auditSettlementArithmetic} from '../scripts/settlement-arithmetic-audit.mjs';
const entry=(overrides={})=>({key:'portfolio:ticket',ticket:{status:'win',stake:20,pnl:16.67,settledOdds:11/6,legs:[{returnFactor:11/6}],...overrides}});
test('rounds a frozen 20-yuan single to cents without rewriting it',()=>{
  const input=[entry()],before=structuredClone(input),r=auditSettlementArithmetic(input);
  assert.equal(r.ok,true);assert.equal(r.checked[0].expectedPnl,16.67);assert.deepEqual(input,before);
});
test('detects incorrect positive payout that passes a sign-only audit',()=>{
  assert.equal(auditSettlementArithmetic([entry({pnl:99})]).errors[0].reason,'pnl-arithmetic-mismatch');
  assert.equal(auditSettlementArithmetic([entry({pnl:16.66})]).ok,false);
});
test('half wins, half losses, pushes and parlays use saved leg factors',()=>{
  for(const [status,factors,pnl] of [['win',[1.5],10],['loss',[.5],-10],['loss',[0,2],-20],['win',[2,1.5],40],['void',[1],0]]){
    assert.equal(auditSettlementArithmetic([entry({status,pnl,legs:factors.map(returnFactor=>({returnFactor})),settledOdds:factors.reduce((a,b)=>a*b,1)})]).ok,true);
  }
});
test('does not invent factors for old imports or treat review as settled',()=>{
  const result=auditSettlementArithmetic([entry({legs:[],settledOdds:undefined}),entry({status:'review',stake:28.75,pnl:0})]);
  assert.equal(result.ok,true);assert.equal(result.checked.length,0);assert.equal(result.skipped.length,2);
});
test('flags inconsistent factors, nonzero void PnL and non-finite money',()=>{
  assert.equal(auditSettlementArithmetic([entry({settledOdds:2})]).ok,false);
  assert.equal(auditSettlementArithmetic([entry({status:'void',pnl:1})]).ok,false);
  assert.equal(auditSettlementArithmetic([entry({stake:NaN})]).ok,false);
});
test('separate strategies remain two tickets, not duplicate ticket IDs',()=>{
  const a=entry(),b=entry();a.key='all-singles:761543';b.key='forced-fun:761543';
  const r=auditSettlementArithmetic([a,b]);assert.equal(r.checked.length,2);assert.equal(r.ok,true);
});
