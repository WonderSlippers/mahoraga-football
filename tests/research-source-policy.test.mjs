import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../lib/research-source-policy.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {womensCompetition,newsInScope,classifyInjuryPayload,verifiedAbsenceCount,orderLastFive}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));

test('same-named mens-club headlines cannot be assigned to a womens match',()=>{
  const now=Date.parse('2026-09-23T00:00:00Z'),kickoff=now+86400000;
  assert.equal(womensCompetition('uefa.wchampions'),true);
  assert.equal(womensCompetition('fifa.friendly.w'),true);
  assert.equal(womensCompetition('esp.1'),false);
  assert.equal(newsInScope('Barcelona: Christensen injury in mens team','2026-09-22T12:00:00Z',['Barcelona'],'uefa.wchampions',kickoff,now),false);
  assert.equal(newsInScope('Barcelona women announce squad','2026-09-22T12:00:00Z',['Barcelona'],'uefa.wchampions',kickoff,now),true);
  assert.equal(newsInScope('Barcelona women announce squad','2026-09-24T12:00:00Z',['Barcelona'],'uefa.wchampions',kickoff,now),false);
});

test('an empty injury response is distinct from unavailable or unsupported',()=>{
  assert.deepEqual(classifyInjuryPayload({injuries:[]}),{status:'empty',entries:[]});
  assert.equal(classifyInjuryPayload({items:[{athlete:{displayName:'A'}}]}).status,'named');
  assert.equal(classifyInjuryPayload({}).status,'unsupported');
  assert.equal(verifiedAbsenceCount([{reportStatus:'named',list:[{player:'A',status:'Out'},{player:'B',status:'Questionable'},{player:'C',status:'Suspended'}]}]),2);
  assert.equal(verifiedAbsenceCount([{reportStatus:'unavailable',list:[{player:'A',status:'Out'}]}]),0);
});

test('form and rest rows remain assigned to ESPN team IDs, not array order',()=>{
  const rows=orderLastFive([{team:{id:'away'},events:[{gameDate:'2026-09-20',score:'2-0'}]},{team:{id:'home'},events:[{gameDate:'2026-09-19',score:'1-1'}]}],[{id:'home',name:'Home'},{id:'away',name:'Away'}]);
  assert.equal(rows[0].team,'Home');assert.equal(rows[0].games[0].score,'1-1');
  assert.equal(rows[1].team,'Away');assert.equal(rows[1].games[0].score,'2-0');
  assert.deepEqual(orderLastFive([],[{id:'missing',name:'Unknown'}])[0].games,[]);
});
