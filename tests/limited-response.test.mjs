import test from 'node:test';
import assert from 'node:assert/strict';
import {readJsonLimited} from '../lib/limited-response.ts';

test('reads small JSON while refusing a declared or streamed oversized body',async()=>{
  assert.deepEqual(await readJsonLimited(new Response('{"ok":true}'),100),{ok:true});
  await assert.rejects(readJsonLimited(new Response('{"ok":true}',{headers:{'content-length':'1000'}}),100),RangeError);
  const streamed=new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(' '.repeat(60)));controller.enqueue(new TextEncoder().encode(' '.repeat(60)));controller.close();}}));
  await assert.rejects(readJsonLimited(streamed,100),RangeError);
});
