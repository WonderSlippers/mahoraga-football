import test from 'node:test';
import assert from 'node:assert/strict';
import {oneXTwoSensitivity} from '../public/decision-sensitivity.js';

test('a three-point probability error can reverse a seemingly positive 1X2 edge',()=>{
  const row=oneXTwoSensitivity(.55,1.9);
  assert.equal(Math.round(row.referenceEdge*1000)/1000,.045);
  assert.equal(Math.round(row.probabilityStressEdge*1000)/1000,-.012);
  assert.ok(Math.abs(row.worseOdds-1.862)<1e-12);
  assert.ok(row.combinedStressEdge<row.probabilityStressEdge);
  assert.ok(row.breakEvenOdds>1.8&&row.breakEvenOdds<1.9);
});

test('invalid or absent 1X2 inputs never produce a stress result',()=>{
  for(const pair of [[null,1.9],[.55,0],[1,1.9],[.55,Infinity]])assert.equal(oneXTwoSensitivity(...pair),null);
});
