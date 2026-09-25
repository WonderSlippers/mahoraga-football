import test from 'node:test';
import assert from 'node:assert/strict';
import {recognizedLocalBuild,scanDue,scanMemorySafe} from '../scripts/local-scan-policy.mjs';

test('background scanner refuses unknown 5173 owners and bad metadata',()=>{
  const marker={ok:true,app:'edge-football-local',runnerProtocol:'prospective-scan-v2',port:5173};
  assert.equal(recognizedLocalBuild(404,marker),false);
  assert.equal(recognizedLocalBuild(200,{...marker,port:5175}),false);
  assert.equal(recognizedLocalBuild(200,{...marker,runnerProtocol:'old'}),false);
  assert.equal(recognizedLocalBuild(200,marker),true);
  assert.equal(recognizedLocalBuild(200,{...marker,runnerProtocol:'prospective-scan-v3'}),true);
  assert.equal(recognizedLocalBuild(200,{...marker,runnerProtocol:'prospective-scan-v4'}),true);
  assert.equal(recognizedLocalBuild(200,{...marker,runnerProtocol:'prospective-scan-v5'}),true);
  const now=1_800_000;
  assert.equal(scanDue(503,{ok:false,lastScanAt:0},now),false);
  assert.equal(scanDue(200,{ok:true,lastScanAt:'missing'},now),false);
  assert.equal(scanDue(200,{ok:true,lastScanAt:now-60_000},now),false);
  assert.equal(scanDue(200,{ok:true,lastScanAt:now-5*60_000},now),true);
});
test('background scanner pauses before workerd approaches the fatal heap range',()=>{
  assert.equal(scanMemorySafe(250*1024*1024),true);
  assert.equal(scanMemorySafe(800*1024*1024),false);
  assert.equal(scanMemorySafe(NaN),false);
  assert.equal(scanMemorySafe(0),false);
});
