import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLedgerWrite} from '../lib/ledger-write-policy.js';

const old={id:'historical',ts:1,day:'2026-09-20',matchId:'123',leagueCode:'eng.1',pick:0,odds:2.5,stake:28.75,status:'open',pnl:0};
const current={state:{initialBalance:10000,balance:10000,records:[old]},settings:{autoStake:20}};
const next=()=>structuredClone(current);

test('preserves old ticket amount and identity while allowing valid settlement',()=>{
  const valid=next();valid.state.records[0]={...old,status:'win',pnl:43.125,settledAt:2,finalScore:'2—1'};
  valid.state.balance+=43.125;
  assert.equal(validateLedgerWrite(current,valid),null);
  for(const field of ['stake','odds','pick','matchId','leagueCode']){
    const forged=next();forged.state.records[0][field]='changed';
    assert.match(validateLedgerWrite(current,forged),/出票字段/);
  }
  const deleted=next();deleted.state.records=[];
  assert.match(validateLedgerWrite(current,deleted),/不可删除/);
});

test('rejects forged settlements, duplicate ids and backfilled wins',()=>{
  const profit=next();profit.state.records[0]={...old,status:'win',pnl:900,settledAt:2,finalScore:'2—1'};
  assert.match(validateLedgerWrite(current,profit),/不守恒/);
  const duplicate=next();duplicate.state.records.push({...old});
  assert.match(validateLedgerWrite(current,duplicate),/票号无效/);
  const forged=next();forged.state.records.push({id:'new',status:'win',stake:20,odds:2,pick:0,ts:2,pnl:20});
  assert.match(validateLedgerWrite(current,forged),/未结算/);
});

test('existing settled and review tickets stay frozen; new simulated tickets are 20 yuan',()=>{
  const settled=structuredClone(current);settled.state.records[0]={...old,status:'loss',pnl:-28.75,settledAt:2,finalScore:'0—1'};
  const changed=structuredClone(settled);changed.state.records[0].status='win';
  assert.match(validateLedgerWrite(settled,changed),/结算字段/);
  const reviewed=structuredClone(current);reviewed.state.records[0].status='review';
  const resolved=structuredClone(reviewed);resolved.state.records[0].status='win';
  assert.match(validateLedgerWrite(reviewed,resolved),/结算字段/);
  const added=next();added.state.records.push({id:'new',status:'open',stake:25,odds:2,pick:0,ts:2,pnl:0});
  assert.match(validateLedgerWrite(current,added),/20 元/);
});

test('a new funds period requires an append-only receipt and preserves every old ticket',()=>{
  const before=structuredClone(current);before.state.records[0]={...old,status:'void'};
  const after=structuredClone(before);
  after.state.portfolioStartAt=1_000_000_000_000;
  after.state.initialBalance=5000;after.state.balance=5000;
  after.state.periodHistory=[{id:'period-1000000000000-abcdef12',startedAt:after.state.portfolioStartAt,initialBalance:5000,previousBalance:10000,previousStartAt:0,previousTicketCount:1}];
  assert.equal(validateLedgerWrite(before,after),null);
  const noReceipt=structuredClone(after);delete noReceipt.state.periodHistory;
  assert.match(validateLedgerWrite(before,noReceipt),/资金周期/);
  const changedReceipt=structuredClone(after);changedReceipt.state.periodHistory[0].previousBalance=9000;
  assert.match(validateLedgerWrite(before,changedReceipt),/资金周期/);
  const reverted=structuredClone(after);reverted.state.portfolioStartAt=0;
  assert.match(validateLedgerWrite(after,reverted),/不可回退/);
  const reviewed=structuredClone(before);reviewed.state.records[0].status='review';
  const reviewReset=structuredClone(after);reviewReset.state.records[0].status='review';
  assert.match(validateLedgerWrite(reviewed,reviewReset),/未决票/);
  const later=structuredClone(after);later.state.balance=5000;
  assert.equal(validateLedgerWrite(after,later),null);
});
