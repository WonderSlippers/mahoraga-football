import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {feedSourceMode} from '../lib/feed-source-policy.js';

test('only a bounded browser with a real Site API response skips duplicate server Site fetch',()=>{
  assert.equal(feedSourceMode(new Headers()),'full');
  assert.equal(feedSourceMode(new Headers({'x-edge-bounded-feed':'1'})),'full');
  assert.equal(feedSourceMode(new Headers({'x-edge-site-available':'1'})),'full');
  assert.equal(feedSourceMode(new Headers({'x-edge-bounded-feed':'1','x-edge-site-available':'0'})),'full');
  assert.equal(feedSourceMode(new Headers({'x-edge-bounded-feed':'1','x-edge-site-available':'1'})),'cdn-only');
});

test('browser reports verified Site availability and worker leaves fallback intact',async()=>{
  const browser=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const route=await readFile(new URL('../app/api/feed/route.ts',import.meta.url),'utf8');
  assert.match(browser,/['"]x-edge-site-available['"]:siteJson\?'1':'0'/);
  assert.match(route,/siteSkipped\?\[\]/);
  assert.match(route,/!siteSkipped&&\(responses\[1\]/);
  assert.match(route,/feedSourceMode\(request\.headers\)/);
  assert.match(route,/skipped:index===1&&siteSkipped\?'browser-supplied'/);
});
