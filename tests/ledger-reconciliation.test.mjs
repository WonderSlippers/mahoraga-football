import test from 'node:test';
import assert from 'node:assert/strict';
import {compareTickets,summarizeLab,ticketIndex} from '../scripts/ledger-reconciliation.mjs';
const fixture=()=>({portfolios:[{id:'p',tickets:[{id:'a',status:'open',stake:20,odds:2,pnl:0,legs:[{matchId:'m',probability:.5,evidence:{source:'original'},status:'open'}]},{id:'b',status:'review',stake:30,odds:2,pnl:0,legs:[]}]}]});
test('open and review are distinct; historical review stake is not normalized',()=>{
  const lab=fixture();const summary=summarizeLab(lab);
  assert.deepEqual(summary.counts,{open:1,review:1,win:0,loss:0,void:0});
  assert.equal(summary.unsettled,2);assert.equal(summary.pending[1].stake,30);
});
test('API presentation changes are reported but financial/state/evidence drift fails',()=>{
  const a=fixture(),b=structuredClone(a);b.portfolios[0].tickets[0].legs[0].rationale=['display'];
  Object.assign(b.portfolios[0].tickets[0].legs[0],{score:61,scoreOrigin:'read-time-recomputed',scoreComputedAt:123,scoreDisplayVersion:'read-score-v1'});
  assert.equal(compareTickets(a,b,{api:true}).ok,true);
  for(const [key,value] of [['stake',21],['status','review'],['pnl',-20]]) {
    const c=structuredClone(b);c.portfolios[0].tickets[0][key]=value;
    assert.equal(compareTickets(a,c,{api:true}).ok,false);
  }
  b.portfolios[0].tickets[0].legs[0].evidence.source='changed';
  assert.equal(compareTickets(a,b,{api:true}).ok,false);
});
test('history enumerates settlement changes but rejects frozen probability drift and missing tickets',()=>{
  const a=fixture(),b=structuredClone(a);b.portfolios[0].tickets[0].status='loss';b.portfolios[0].tickets[0].pnl=-20;
  assert.equal(compareTickets(a,b).changes.length,1);assert.equal(compareTickets(a,b).ok,true);
  b.portfolios[0].tickets[0].legs[0].probability=.7;assert.equal(compareTickets(a,b).ok,false);
  b.portfolios[0].tickets.pop();assert.ok(compareTickets(a,b).errors.some(e=>e.reason==='missing-ticket'));
});
test('duplicates and unknown states fail instead of silently losing rows',()=>{
  const a=fixture();a.portfolios[0].tickets.push(a.portfolios[0].tickets[0]);assert.throws(()=>ticketIndex(a),/duplicate/);
  const b=fixture();b.portfolios[0].tickets[0].status='pending';assert.throws(()=>summarizeLab(b),/Unknown/);
});
