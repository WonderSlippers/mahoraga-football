import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceScanProgress} from '../lib/scan-progress-policy.js';

const start=()=>({id:'batch-1',stage:'prepared',status:'running',errors:[]});
test('scan phases are ordered and partial failure cannot become success',()=>{
  const lab=advanceScanProgress(start(),'lab');
  const featured=advanceScanProgress(lab,'featured','report unavailable');
  assert.equal(featured.status,'partial');
  const observations=advanceScanProgress(featured,'observations');
  assert.equal(observations.status,'partial');
  const complete=advanceScanProgress(observations,'complete');
  assert.equal(complete.status,'partial');
  assert.match(complete.errors[0],/featured/);
  assert.throws(()=>advanceScanProgress(lab,'odds'),/out of order/);
  assert.throws(()=>advanceScanProgress(lab,'prepared'),/out of order/);
});
