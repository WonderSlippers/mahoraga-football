import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/research-ui.js',import.meta.url),'utf8');

test('missing featured analysis loads inside the ticket instead of redirecting',()=>{
  assert.match(source,/data-deep-load/);
  assert.match(source,/在这里加载本场深析/);
  assert.match(source,/\/api\/match-research\?league=/);
  assert.match(source,/不再跳转到普通赛事页/);
  assert.match(source,/这不是“没有伤停”，而是资料尚未核实/);
});
