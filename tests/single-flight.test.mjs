import test from 'node:test';
import assert from 'node:assert/strict';
import {createSingleFlight} from '../lib/single-flight.ts';

test('identical in-flight feed reads share one upstream job, then refresh',async()=>{
  const run=createSingleFlight();
  let jobs=0,release;
  const work=()=>{jobs++;return new Promise(resolve=>{release=resolve;});};
  const first=run('league|dates',work),second=run('league|dates',work);
  await Promise.resolve();
  assert.equal(jobs,1);
  assert.strictEqual(first,second);
  release('feed');
  assert.deepEqual(await Promise.all([first,second]),['feed','feed']);
  assert.equal(await run('league|dates',async()=>{jobs++;return 'new feed';}),'new feed');
  assert.equal(jobs,2);
});

test('a rejected shared feed read is cleared so a later request can retry',async()=>{
  const run=createSingleFlight();
  let jobs=0;
  const failure=run('same',async()=>{jobs++;throw new Error('upstream unavailable');});
  await assert.rejects(failure,/upstream unavailable/);
  assert.equal(await run('same',async()=>{jobs++;return 'recovered';}),'recovered');
  assert.equal(jobs,2);
});
