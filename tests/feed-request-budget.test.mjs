import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createLegacyFeedBudget} from '../lib/feed-request-budget.ts';

test('old all-league tabs are bounded without suppressing live scores indefinitely',()=>{
  const permit=createLegacyFeedBudget(2,3,60_000);
  assert.equal(permit('all',1000),true);
  assert.equal(permit('all',1001),true);
  assert.equal(permit('all',1002),false);
  assert.equal(permit('live',1003),true);
  assert.equal(permit('live',1004),true);
  assert.equal(permit('live',1005),true);
  assert.equal(permit('live',1006),false);
  assert.equal(permit('all',61_000),true);
});

test('new bounded UI identifies itself; both request classes have server budgets',async()=>{
  const [app,route]=await Promise.all([
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../app/api/feed/route.ts',import.meta.url),'utf8'),
  ]);
  assert.match(app,/x-edge-bounded-feed/);
  assert.match(route,/status:429/);
  assert.match(route,/bounded\?allowBoundedFeed\(mode\):allowLegacyFeed\(mode\)/);
});
