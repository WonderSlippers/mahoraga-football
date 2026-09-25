import test from 'node:test';
import assert from 'node:assert/strict';
import {decimalOdds,selectCurrentMoneyline,selectCurrentPairedMarkets} from '../public/odds-policy.js';

const offer=(provider,home,draw,away)=>({provider:{name:provider},moneyline:{home,draw,away}});
const current=odds=>({current:{odds}});

test('1X2 never splices complementary partial bookmakers into a fake complete quote',()=>{
  const quote=selectCurrentMoneyline({odds:[
    offer('A',current('2.10'),current('3.20'),{open:{odds:'4.10'}}),
    offer('B',{open:{odds:'2.30'}},current('3.40'),current('3.80')),
  ]});
  assert.equal(quote.complete,false);
  assert.equal(quote.provider,'A');
  assert.deepEqual(quote.odds,[2.1,3.2,0]);
  assert.match(quote.reason,/禁止跨来源补齐/);
});

test('complete current bookmaker wins over a partial higher-price bookmaker',()=>{
  const quote=selectCurrentMoneyline({odds:[
    offer('partial',current('9.00'),{},{}),
    offer('complete',current('2.20'),current('3.20'),current('3.80')),
  ]});
  assert.equal(quote.complete,true);
  assert.equal(quote.provider,'complete');
  assert.deepEqual(quote.odds,[2.2,3.2,3.8]);
});

test('open and close alone are historical, not current 1X2 prices',()=>{
  const quote=selectCurrentMoneyline({odds:[offer('old',
    {open:{odds:'2.10'}},{close:{odds:'3.20'}},{open:{odds:'3.50'}})]});
  assert.deepEqual(quote.odds,[0,0,0]);
  assert.equal(quote.complete,false);
  assert.equal(quote.historicalOnly,true);
  assert.match(quote.reason,/历史价/);
});

test('scheduled fixtures may use one coherent close-field reference, never a live quote',()=>{
  const match={odds:[offer('DraftKings',
    {open:{odds:'2.10'},close:{odds:'2.20'}},
    {open:{odds:'3.10'},close:{odds:'3.20'}},
    {open:{odds:'3.40'},close:{odds:'3.50'}})]};
  const scheduled=selectCurrentMoneyline(match,{allowCloseReference:true});
  assert.equal(scheduled.complete,true);
  assert.equal(scheduled.phase,'close-reference');
  assert.deepEqual(scheduled.odds,[2.2,3.2,3.5]);
  assert.match(scheduled.reason,/更新时间与可成交状态未知/);
  assert.equal(selectCurrentMoneyline(match).complete,false);
});

test('a partial current quote blocks fallback to an older complete close price',()=>{
  const quote=selectCurrentMoneyline({odds:[offer('A',
    {current:{odds:'2.10'},close:{odds:'2.20'}},
    {current:{odds:null},close:{odds:'3.20'}},
    {current:{odds:'3.40'},close:{odds:'3.50'}})]},{allowCloseReference:true});
  assert.equal(quote.complete,false);
  assert.equal(quote.phase,'current');
  assert.deepEqual(quote.odds,[2.1,0,3.4]);
});

test('totals and handicaps require paired current price and matching line',()=>{
  const mismatched=selectCurrentPairedMarkets({total:{over:{current:{line:'o2.5',odds:'1.90'}},under:{current:{line:'u3.5',odds:'1.90'}}},pointSpread:{home:{current:{line:'-1.5',odds:'2.00'}},away:{close:{line:'1.5',odds:'1.85'}}}});
  assert.equal(mismatched.total,null);
  assert.equal(mismatched.spread,null);
  const paired=selectCurrentPairedMarkets({total:{over:{current:{line:'o2.5',odds:'1.90'}},under:{current:{line:'u2.5',odds:'1.95'}}},pointSpread:{home:{current:{line:'-0.5',odds:'2.00'}},away:{current:{line:'0.5',odds:'1.85'}}}});
  assert.deepEqual(paired.total,{line:2.5,overOdds:1.9,underOdds:1.95,phase:'current'});
  assert.deepEqual(paired.spread,{homeLine:-.5,awayLine:.5,homeOdds:2,awayOdds:1.85,phase:'current'});
  const close=selectCurrentPairedMarkets({total:{over:{close:{line:'o2.5',odds:'1.90'}},under:{close:{line:'u2.5',odds:'1.95'}}}},{allowCloseReference:true});
  assert.equal(close.total?.phase,'close-reference');
  assert.equal(selectCurrentPairedMarkets({total:{over:{close:{line:'o2.5',odds:'1.90'}},under:{close:{line:'u2.5',odds:'1.95'}}}}).total,null);
});

test('direct same-provider decimal/American values remain supported',()=>{
  const quote=selectCurrentMoneyline({odds:[offer('legacy',
    {odds:'-150'},{odds:'+250'},{odds:'3.50'})]});
  assert.equal(quote.complete,true);
  assert.ok(Math.abs(quote.odds[0]-1.6666666667)<1e-8);
  assert.deepEqual(quote.odds.slice(1),[3.5,3.5]);
  assert.equal(decimalOdds(''),null);
  assert.equal(decimalOdds('1.00'),null);
});
