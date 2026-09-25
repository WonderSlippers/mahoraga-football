import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {coherentOddsHistory} from '../lib/coherent-odds-history.js';

test('same timestamp never splices partial bookmakers into a synthetic full 1X2',()=>{
  const rows=[
    {captured_at:100,home_odds:2.1,draw_odds:3.2,away_odds:null,provider:'A'},
    {captured_at:100,home_odds:null,draw_odds:3.3,away_odds:4.2,provider:'B'},
  ];
  const history=coherentOddsHistory(rows);
  assert.equal(history.length,1);
  assert.equal(history[0].provider,'A');
  assert.equal(history[0].away_odds,null);
});

test('a complete bookmaker row wins over a partial row at the same capture time',()=>{
  const history=coherentOddsHistory([
    {captured_at:100,home_odds:2.1,draw_odds:null,away_odds:null,provider:'A'},
    {captured_at:100,home_odds:2.2,draw_odds:3.2,away_odds:3.9,provider:'B'},
  ]);
  assert.equal(history[0].provider,'B');
  assert.deepEqual([history[0].home_odds,history[0].draw_odds,history[0].away_odds],[2.2,3.2,3.9]);
});

test('the closing-reference query selects one complete row, not MAX values across providers',async()=>{
  const source=await readFile(new URL('../db/odds.ts',import.meta.url),'utf8');
  assert.match(source,/home_odds > 1 AND draw_odds > 1 AND away_odds > 1 ORDER BY captured_at DESC, id DESC LIMIT 1/);
  assert.doesNotMatch(source,/MAX\(home_odds\)/);
});
