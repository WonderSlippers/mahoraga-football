import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const code=fs.readFileSync(new URL('../lib/local-origin-policy.ts',import.meta.url),'utf8');
const js=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {isLocalSimulationWrite}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));

test('simulated writes require exact loopback 5173 and same-origin browser context',()=>{
  assert.equal(isLocalSimulationWrite('http://127.0.0.1:5173/api/scan',null),true);
  assert.equal(isLocalSimulationWrite('http://localhost:5173/api/ledger','http://localhost:5173'),true);
  assert.equal(isLocalSimulationWrite('http://localhost:5173/api/scan','https://evil.example'),false);
  assert.equal(isLocalSimulationWrite('http://localhost:5175/api/scan',null),false);
  assert.equal(isLocalSimulationWrite('https://edge-football-live-cn.toasty-lemon-1138.chatgpt.site/api/scan',null),false);
});
