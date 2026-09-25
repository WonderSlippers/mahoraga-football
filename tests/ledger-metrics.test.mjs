import test from 'node:test';
import assert from 'node:assert/strict';
import {dayAt,dailyStats,summarize,ticketMarket,ticketBand,parseScore,hypotheticalPnl} from '../public/ledger-metrics.js';

const createdAt=Date.parse('2026-09-19T14:00:00Z');
const settledAt=Date.parse('2026-09-19T17:00:00Z');
const win={createdAt,settledAt,status:'win',stake:100,pnl:50,legs:[{market:'total',score:80},{score:62}]};
test('settlements before Beijing 08:00 stay in the previous bill',()=>{
  assert.equal(dayAt(settledAt),'2026-09-19');
  assert.equal(dailyStats([win],'2026-09-19').pnl,50);
  assert.equal(dailyStats([win],'2026-09-20').pnl,0);
  assert.equal(dailyStats([win],'2026-09-19').placedCount,1);
});
test('Beijing 08:00 is the exact billing boundary',()=>{
  assert.equal(dayAt(Date.parse('2026-09-19T23:59:59.999Z')),'2026-09-19');
  assert.equal(dayAt(Date.parse('2026-09-20T00:00:00.000Z')),'2026-09-20');
});
test('void is settled but excluded from ROI and hit rate, pending is excluded',()=>{
  const s=summarize([win,{...win,status:'loss',pnl:-100},{...win,status:'void',pnl:0},{...win,status:'open',pnl:999}]);
  assert.deepEqual(s,{count:3,wins:1,losses:1,voids:1,pnl:-50,stake:200,roi:-25,hitRate:50});
});
test('missing settlement date cannot be replaced with creation date',()=>{
  assert.equal(summarize([{...win,settledAt:undefined}]).pnl,50);
  assert.equal(dailyStats([{...win,settledAt:undefined}],'2026-09-19').pnl,0);
});
test('parlay is counted once and mixed market is not assigned to first leg',()=>{
  assert.equal(summarize([win]).count,1);
  assert.equal(summarize([win]).pnl,50);
  assert.equal(ticketMarket(win),'mixed');
  assert.equal(ticketBand(win),'B');
});
test('missing scores are not zero or D',()=>{
  assert.equal(ticketBand({...win,legs:[{score:null}]}),'unknown');
  assert.equal(ticketBand({...win,legs:[{}]}),'unknown');
  assert.equal(ticketBand({...win,legs:[{score:0}]}),'D');
});
test('recognize supported score separators and reject invented 0-0',()=>{
  for(const sep of ['—','-',':','：','–'])assert.deepEqual(parseScore('2'+sep+'1'),[2,1]);
  assert.equal(parseScore('待核验'),null);
});
test('whole parlay counterfactual retains all legs and handles push',()=>{
  const ticket={stake:100,legs:[{finalScore:'1-1',odds:2,pick:0,status:'loss'},{finalScore:'2:0',odds:1.5,pick:0,status:'win'}]};
  assert.equal(hypotheticalPnl(ticket,0,{market:'total',side:'over',line:2,odds:2}),50);
  assert.equal(hypotheticalPnl(ticket,0,{pick:1,odds:3}),350);
  assert.equal(hypotheticalPnl(ticket,0,{market:'total',side:'over',line:2.25,odds:2}),-25);
  assert.equal(hypotheticalPnl({...ticket,legs:[ticket.legs[0],{...ticket.legs[1],finalScore:''}]},0,{pick:1,odds:3}),null);
});
