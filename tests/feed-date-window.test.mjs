import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {resolve} from 'node:path';
import {parseFeedDateWindow,FeedDateWindowError} from '../lib/feed-date-window.ts';
const bundle=buildSync({entryPoints:['app/api/feed/route.ts'],absWorkingDir:process.cwd(),bundle:true,write:false,platform:'node',format:'esm',alias:{'@':resolve('.')},logLevel:'silent'}).outputFiles[0].text;
const route=await import('data:text/javascript;base64,'+Buffer.from(bundle).toString('base64'));
test('impossible calendar dates never trigger upstream fetches or normalize to another day',async()=>{
  const original=globalThis.fetch;let requests=0;
  globalThis.fetch=async()=>{requests++;return Response.json({events:[]});};
  try{
    for(const dates of ['20260230-20260303','20260229-20260301','20260431-20260502','20260924-20260230']){
      const result=await route.GET(new Request('http://localhost/api/feed?league=eng.1&dates='+dates,{headers:{'x-edge-bounded-feed':'1'}}));
      assert.equal(result.status,400,dates);await result.arrayBuffer();
    }
    assert.equal(requests,0);
  }finally{globalThis.fetch=original;}
});
test('leap days and year boundaries preserve the exact inclusive UTC range',()=>{
  assert.deepEqual(parseFeedDateWindow('20240228-20240301','all',false).days,['20240228','20240229','20240301']);
  assert.deepEqual(parseFeedDateWindow('20261231-20270101','all',false).days,['20261231','20270101']);
  assert.deepEqual(parseFeedDateWindow('20260924-20260924','live',false).days,['20260924']);
});
test('club and extended national/women windows retain their distinct bounds',()=>{
  assert.equal(parseFeedDateWindow('20260901-20260910','all',false).days.length,10);
  assert.throws(()=>parseFeedDateWindow('20260901-20260911','all',false),FeedDateWindowError);
  assert.equal(parseFeedDateWindow('20260901-20260925','all',true).days.length,25);
  assert.throws(()=>parseFeedDateWindow('20260901-20260926','all',true),FeedDateWindowError);
  assert.throws(()=>parseFeedDateWindow('20260901-20260911','live',true),FeedDateWindowError);
});
test('malformed, impossible, reversed and unknown-mode input fails closed',()=>{
  for(const dates of ['20260230-20260303','20260229-20260301','20261301-20261302','20260900-20260901','20260931-20261001','20260925-20260924','20260924','2026-09-24']){
    assert.throws(()=>parseFeedDateWindow(dates,'all',true),FeedDateWindowError);
  }
  assert.throws(()=>parseFeedDateWindow('20260924-20260924','unknown',false),FeedDateWindowError);
});
