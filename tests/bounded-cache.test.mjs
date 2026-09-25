import test from 'node:test';
import assert from 'node:assert/strict';
import {putBoundedCache} from '../lib/bounded-cache.ts';

test('research cache expires stale entries and respects both entry and byte limits',()=>{
  const cache=new Map();
  const put=(key,at,body,maxEntries=3,maxBytes=12)=>putBoundedCache(cache,key,{at,body},maxEntries,100,maxBytes,row=>row.body.length);
  put('a',1000,'1234');put('b',1001,'1234');put('c',1002,'1234');
  assert.deepEqual([...cache.keys()],['a','b','c']);
  put('d',1003,'1234');
  assert.deepEqual([...cache.keys()],['b','c','d']);
  put('e',1200,'1234567890');
  assert.deepEqual([...cache.keys()],['e']);
  put('f',1201,'1234567890');
  assert.deepEqual([...cache.keys()],['f']);
});
