import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteCoverage,summarizeQuoteCoverage} from '../lib/odds-coverage.js';

test('close reference cannot inflate the current complete count',()=>{
  const now=Date.now(),base={status:'soon',date:now+3600000};
  const rows=[
    {...base,odds:[2,3,4],oddsPhase:'current'},
    {...base,odds:[2,3,4],oddsPhase:'close-reference'},
    {...base,odds:[2,0,4],oddsPhase:'current'},
    {...base,odds:[0,0,0],oddsReason:'市场未开盘'},
    {...base,odds:[0,0,0],oddsReason:'公开源未返回当前 1X2 报价'},
  ];
  const result=summarizeQuoteCoverage(rows,now);
  assert.equal(result.executionFuture,5);
  assert.equal(result.executionComplete,1);
  assert.equal(result.executionReferenceComplete,1);
  assert.equal(result.executionPartial,1);
  assert.equal(result.executionUnopened,1);
  assert.equal(result.executionSourceMissing,1);
  assert.equal(result.executionMissing,2);
  assert.equal(quoteCoverage(rows[1]),'reference-complete');
});
