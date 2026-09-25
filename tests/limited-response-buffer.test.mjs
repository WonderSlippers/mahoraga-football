import test from 'node:test';
import assert from 'node:assert/strict';
import {readTextLimited,readJsonLimited} from '../lib/limited-response.ts';
test('consumed chunks are preserved when producer reuses its byte buffer',async()=>{
  const scratch=new Uint8Array(1);let n=0;
  const response=new Response(new ReadableStream({pull(c){
    if(n===3){c.close();return;}
    scratch[0]=97+n++;c.enqueue(scratch);
  }},{highWaterMark:0}));
  assert.equal(await readTextLimited(response,3),'abc');
});
function chunked(bytes,chunkSize,headers={}){
  let offset=0;
  return new Response(new ReadableStream({pull(controller){
    if(offset===bytes.length){controller.close();return;}
    const next=Math.min(bytes.length,offset+chunkSize);
    controller.enqueue(bytes.slice(offset,next));offset=next;
  }}),{headers});
}
test('buffer growth retains large multilingual payload at exact byte limit',async()=>{
  const input='足球⚽🙂abcdef'.repeat(12000),bytes=new TextEncoder().encode(input);
  for(const size of [1,4093,65536,bytes.length])assert.equal(await readTextLimited(chunked(bytes,size),bytes.length),input);
});
test('BOM, truncated and malformed UTF8 agree with TextDecoder for every split',async()=>{
  for(const bytes of [new Uint8Array([239,187,191,97,226,130]),new Uint8Array([255,97,237,160,128]),new Uint8Array([240,159,153,130])]){
    for(let size=1;size<=bytes.length;size++)assert.equal(await readTextLimited(chunked(bytes,size),bytes.length),new TextDecoder().decode(bytes));
  }
});
test('underdeclared size still cancels actual overflow and unlocks reader',async()=>{
  let cancelled=false;
  const response=new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(30));},cancel(){cancelled=true;}}),{headers:{'content-length':'1'}});
  await assert.rejects(readTextLimited(response,31),RangeError);
  assert.equal(cancelled,true);assert.equal(response.body.locked,false);
});
test('empty body and empty chunks preserve zero-byte semantics',async()=>{
  assert.equal(await readTextLimited(new Response(null),0),'');
  const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(0));c.close();}}));
  assert.equal(await readTextLimited(response,0),'');
});
test('Request streams work and malformed JSON does not retain reader lock',async()=>{
  const req=new Request('http://localhost/only-test',{method:'POST',body:'{"球":1}',duplex:'half'});
  assert.deepEqual(await readJsonLimited(req,100),{'球':1});
  const response=new Response('not-json');await assert.rejects(readJsonLimited(response,100),SyntaxError);assert.equal(response.body.locked,false);
});
test('stream failure retains original cause even if cancellation fails',async()=>{
  const cause=new Error('upstream-disconnected');let calls=0;
  const response=new Response(new ReadableStream({pull(c){if(calls++===0)c.enqueue(new Uint8Array([97]));else c.error(cause);},cancel(){throw Error('secondary');}}));
  await assert.rejects(readTextLimited(response,100),error=>error===cause);assert.equal(response.body.locked,false);
});
