import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../lib/sampling-audit-policy.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {summarizeSamplingRun}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));

test('sampling audit keeps failed leagues and missing current quotes visible without inventing unobserved fixtures',()=>{
  const now=Date.now();
  const match=(id,phase,odds)=>({id,leagueCode:'eng.1',date:now+3600000,status:'soon',oddsPhase:phase,odds});
  const row=summarizeSamplingRun('batch-1',now,['eng.1','fra.1','eng.1'],['fra.1'],[
    match('1','current',[2,3,4]),match('1','current',[2,3,4]),match('2','close-reference',[2,3,4]),match('3','none',[0,0,0]),
    {...match('4','current',[2,3,4]),date:now+25*3600000},
  ],{forecastObserved:1,forecastInserted:1});
  assert.deepEqual(row.selectedLeagues,['eng.1','fra.1']);
  assert.deepEqual(row.failedLeagues,['fra.1']);
  assert.equal(row.returnedUniqueFixtures,4);
  assert.equal(row.futureFixturesSeen,3);
  assert.deepEqual([row.currentComplete,row.closeReference,row.incompleteOrUnavailable],[1,1,1]);
  assert.equal(row.plannedFixtureTotal,null);
  assert.equal(row.forecastInserted,1);
});

test('sampling audit does not claim a zero insert count before an atomic batch commits',()=>{
  const now=Date.now();
  const row=summarizeSamplingRun('batch-atomic',now,['eng.1'],[],[],{forecastObserved:2,outcomeObserved:1});
  assert.equal(row.forecastObserved,2);
  assert.equal(row.outcomeObserved,1);
  assert.equal(row.forecastInserted,null);
  assert.equal(row.outcomeInserted,null);
});
