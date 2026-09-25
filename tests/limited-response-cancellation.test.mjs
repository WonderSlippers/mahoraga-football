import test from 'node:test';
import assert from 'node:assert/strict';
import {readTextLimited} from '../lib/limited-response.ts';

test('declared oversized response cancels without consuming the body', async () => {
  let cancellations=0, pulls=0;
  const stream=new ReadableStream({pull(){pulls++;},cancel(){cancellations++;}},{highWaterMark:0});
  const response=new Response(stream,{headers:{'content-length':'101'}});
  await assert.rejects(readTextLimited(response,100),RangeError);
  assert.equal(cancellations,1);
  assert.equal(pulls,0);
  assert.equal(stream.locked,false);
});

test('cancel failure preserves the declared-size RangeError', async () => {
  const response=new Response(new ReadableStream({cancel(){throw new Error('cancel failed');}}),{headers:{'content-length':'101'}});
  await assert.rejects(readTextLimited(response,100),{name:'RangeError',message:'response body exceeds byte limit'});
  assert.equal(response.body.locked,false);
});

test('streamed oversized response cancels and releases the reader', async () => {
  let cancelled=false;
  const response=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(101));},cancel(){cancelled=true;}}));
  await assert.rejects(readTextLimited(response,100),RangeError);
  assert.equal(cancelled,true);
  assert.equal(response.body.locked,false);
});

test('exact UTF-8 byte limit keeps valid chunked text and does not cancel success', async () => {
  let cancelled=false;
  const bytes=new TextEncoder().encode('足球');
  const response=new Response(new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,2));controller.enqueue(bytes.slice(2));controller.close();},cancel(){cancelled=true;}}),{headers:{'content-length':'6'}});
  assert.equal(await readTextLimited(response,6),'足球');
  assert.equal(cancelled,false);
  assert.equal(response.body.locked,false);
});
