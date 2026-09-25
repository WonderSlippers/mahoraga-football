import test from 'node:test';
import assert from 'node:assert/strict';
import {exportReviewCsv} from '../public/review-export.js';

test('full strategy export retains every parlay leg and neutralizes external spreadsheet formulas',()=>{
  const csv=exportReviewCsv([{id:'double',name:'二串一',tickets:[{id:'ticket-1',status:'open',createdAt:Date.UTC(2026,8,24),stake:20,odds:3.2,pnl:0,legs:[
    {matchId:'1',home:'=HYPERLINK("https://bad.example")',away:'Away',market:'1x2',pick:0,odds:1.8,status:'open'},
    {matchId:'2',home:'Home',away:'Other',market:'total',side:'over',line:2.5,odds:1.9,status:'open'}
  ]}]}]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.equal(csv.trimEnd().split('\r\n').length,3);
  assert.match(csv,/"'=HYPERLINK\(""https:\/\/bad\.example""\)"/);
  assert.match(csv,/"Other"/);
  assert.match(csv,/"十策略模拟账本"/);
  assert.doesNotMatch(csv,/"=HYPERLINK/);
});
