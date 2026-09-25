import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../lib/research-evidence.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {linkedResearchGoalEvidence}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
const now=Date.now();
const goalEvidence={capturedAt:now-60_000,expectedHome:1.5,expectedAway:1.1,uncertaintyMargin:.105,sourceUrls:['https://site.web.api.espn.com/apis/common/v3/sports/soccer/eng.1/standings'],modelVersion:'poisson-standings-availability-v1',availabilityInputs:{marginBump:.005}};
const response={ok:true,capturedAt:now-30_000,teams:[{id:'home'},{id:'away'}],goalEvidence};
test('research goal evidence links only to the exact fixture and fresh public source',()=>{
 assert.equal(linkedResearchGoalEvidence(response,'home','away',now),goalEvidence);
 assert.equal(linkedResearchGoalEvidence(response,'away','home',now),null);
 assert.equal(linkedResearchGoalEvidence({...response,capturedAt:now-31*60_000},'home','away',now),null);
 assert.equal(linkedResearchGoalEvidence({...response,goalEvidence:{...goalEvidence,sourceUrls:['https://example.org/standings']}},'home','away',now),null);
 assert.equal(linkedResearchGoalEvidence({...response,degraded:true},'home','away',now),null);
});
