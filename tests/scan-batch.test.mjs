import test from 'node:test';
import assert from 'node:assert/strict';
import {planScanBatch,MAX_LEAGUES_PER_SCAN} from '../lib/scan-batch.ts';

test('bounded rotation visits every league without dropping women or national teams',()=>{
  const codes=Array.from({length:65},(_,i)=>`league.${i}`);
  codes[25]='fifa.friendly.w';codes[26]='uefa.wchampions';
  const now=1_800_000_000_000;
  const seen=new Set();
  const slots=Math.ceil(codes.length/8);
  for(let offset=0;offset<slots;offset++){
    const batch=planScanBatch(codes,now+offset*300_000);
    assert.ok(batch.selected.length<=MAX_LEAGUES_PER_SCAN);
    batch.selected.forEach(code=>seen.add(code));
  }
  assert.deepEqual([...seen].sort(),[...codes].sort());
});

test('imminent open-ticket and radar leagues receive extra checks without duplicates',()=>{
  const codes=Array.from({length:65},(_,i)=>`league.${i}`),now=1_800_000_000_000;
  const batch=planScanBatch(codes,now,[{leagueCode:'league.60',kickoffAt:now-60_000}],{
    entries:[{leagueCode:'league.61',kickoffAt:now+60_000},{leagueCode:'unknown',kickoffAt:now+60_000}],
  });
  assert.ok(batch.selected.includes('league.60'));
  assert.ok(batch.selected.includes('league.61'));
  assert.equal(batch.selected.length,new Set(batch.selected).size);
  assert.ok(batch.selected.length<=MAX_LEAGUES_PER_SCAN);
});
test('persisted rotation cursor covers missed slots after a slow request',()=>{
  const codes=Array.from({length:65},(_,i)=>`league.${i}`),now=1_800_000_000_000;
  const first=planScanBatch(codes,now,[],undefined,3);
  const next=planScanBatch(codes,now+20*300_000,[],undefined,first.slot);
  assert.equal(first.slot,4);
  assert.equal(next.slot,5);
  assert.ok(first.selected.includes('league.24'));
  assert.ok(next.selected.includes('league.32'));
});
