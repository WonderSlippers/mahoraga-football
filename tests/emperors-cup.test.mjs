import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEmperorsCupFixtures,EMPERORS_CUP_SOURCE} from '../lib/emperors-cup-policy.js';

const row=(number,date,time,teams)=>`<tr><td>【${number}】</td><td>${date}<br />(水)</td><td>${time}</td><td>${teams}</td><td>会場</td><td>略称</td></tr>`;

test('JFA Emperor Cup fixtures parse as official schedule without invented score or odds',()=>{
  const html='天皇杯 JFA 第106回'+row(57,'9月23日','17:00','鹿島アントラーズ vs ヴァンフォーレ甲府')+row(58,'10月7日','19:00','ガイナーレ鳥取 vs 東京ヴェルディ');
  const fixtures=parseEmperorsCupFixtures(html);
  assert.equal(fixtures.length,2);
  assert.deepEqual(fixtures.map(row=>row.matchNo),[57,58]);
  assert.equal(new Date(fixtures[0].kickoffAt).toISOString(),'2026-09-23T08:00:00.000Z');
  assert.equal(fixtures[0].sourceUrl,EMPERORS_CUP_SOURCE);
  assert.equal(Object.hasOwn(fixtures[0],'odds'),false);
  assert.equal(Object.hasOwn(fixtures[0],'score'),false);
});

test('unrelated rows and malformed JFA documents do not create fixtures',()=>{
  assert.deepEqual(parseEmperorsCupFixtures('天皇杯'+row(3,'9月23日','17:00','A vs B')),[]);
  assert.throws(()=>parseEmperorsCupFixtures('not a JFA page'),/invalid/);
});
