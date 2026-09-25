import test from 'node:test';
import assert from 'node:assert/strict';
import {auditLabTransition,openDuplicateDirections} from '../scripts/local-scan-audit.mjs';

function fixture(){
  const portfolios=Array.from({length:10},(_,i)=>({id:`strategy-${i}`,initialBalance:10000,stake:20,tickets:i?[]:[{id:'old',stake:15,odds:2,pnl:0,status:'open',legs:[{matchId:'m',market:'1x2',pick:0,odds:2}]}]}));
  const ledger={state:{initialBalance:10000,records:[]},settings:{autoStake:20}};
  return {lab:{portfolios},ledger};
}
test('automatic scan audit preserves frozen old tickets but allows ¥20 new ones',()=>{
  const before=fixture(),after=structuredClone(before);
  after.lab.portfolios[0].tickets[0].status='win';after.lab.portfolios[0].tickets[0].pnl=15;
  after.lab.portfolios[0].tickets.push({id:'new',stake:20,odds:2.5,pnl:0,status:'open',legs:[]});
  const report=auditLabTransition(before.lab,after.lab,before.ledger,after.ledger);
  assert.equal(report.ok,true);assert.equal(report.oldTickets,1);assert.equal(report.newTickets,2);
  after.lab.portfolios[0].tickets[0].odds=3;
  assert.equal(auditLabTransition(before.lab,after.lab,before.ledger,after.ledger).ok,false);
  after.lab.portfolios[0].tickets[0].odds=2;after.lab.portfolios[0].tickets[1].stake=40;
  assert.equal(auditLabTransition(before.lab,after.lab,before.ledger,after.ledger).ok,false);
});
test('same-strategy open singles with different ticket IDs but identical direction block another scan',()=>{
  const before=fixture(),after=structuredClone(before);
  after.lab.portfolios[0].tickets.push({id:'all-singles:fill:m:1x2',stake:20,odds:2,pnl:0,status:'open',legs:[{matchId:'m',market:'1x2',pick:0,odds:2}]});
  assert.equal(openDuplicateDirections(after.lab).length,1);
  assert.match(auditLabTransition(before.lab,after.lab,before.ledger,after.ledger).errors.join(' '),/方向重复/);
});
