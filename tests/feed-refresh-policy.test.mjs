import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {planRotatingLeagueBatch,shouldFetchLocalFeed} from '../public/feed-refresh-policy.js';

test('visible page rotates all 65 leagues without an unbounded refresh',()=>{
  const codes=Array.from({length:65},(_,index)=>`league.${index}`);
  const seen=new Set();
  let cursor=0;
  for(let round=0;round<12;round++){
    const batch=planRotatingLeagueBatch(codes,cursor,['league.64','league.63'],8,2);
    assert.ok(batch.selected.length<=8);
    assert.equal(new Set(batch.selected).size,batch.selected.length);
    assert.deepEqual(batch.selected.slice(0,2),['league.64','league.63']);
    batch.selected.forEach(code=>seen.add(code));
    cursor=batch.nextCursor;
  }
  assert.equal(seen.size,65);
});

test('rotation rejects unknown urgent codes and handles empty/malformed cursor',()=>{
  assert.deepEqual(planRotatingLeagueBatch([],NaN,['unknown']),{selected:[],nextCursor:0});
  assert.deepEqual(planRotatingLeagueBatch(['a','b','c'],NaN,['unknown','b','b'],2,1),{selected:['b','a'],nextCursor:1});
});

test('visible browser reads public source first and only samples local worker periodically',()=>{
  const now=1_000_000;
  assert.equal(shouldFetchLocalFeed({now,siteAvailable:true,important:false}),false);
  assert.equal(shouldFetchLocalFeed({now,siteAvailable:false}),true);
  assert.equal(shouldFetchLocalFeed({now,lastCheckedAt:now-59000,important:true,siteAvailable:true}),false);
  assert.equal(shouldFetchLocalFeed({now,lastCheckedAt:now-60000,important:true,siteAvailable:true}),true);
  assert.equal(shouldFetchLocalFeed({now,lastCheckedAt:now-19*60000,siteAvailable:true}),false);
  assert.equal(shouldFetchLocalFeed({now,lastCheckedAt:now-20*60000,siteAvailable:true}),true);
});

test('page refresh uses bounded batches, hides idle polling and never relaunches full scan each minute',async()=>{
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(source,/planRotatingLeagueBatch\(/);
  assert.match(source,/if\(document\.hidden\)return;/);
  assert.doesNotMatch(source,/setInterval\(\(\)=>\{if\(!document\.hidden&&Date\.now\(\)-lastSyncAt>55000\)refreshData\(false,'all'\)/);
  assert.match(source,/batchTargets=targets\.slice\(i,i\+2\)/);
});
