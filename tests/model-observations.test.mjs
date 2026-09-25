import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

async function policy(name){const source=fs.readFileSync(new URL('../lib/'+name+'.ts',import.meta.url),'utf8');const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;return import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));}
const {prospectiveForecast,observedOutcome}=await policy('model-observation-policy');
const {evaluateProspective}=await policy('model-evaluation');

test('as-of forecast rejects cross-provider, stale-source and post-kickoff records',()=>{
  const now=Date.now(),match={id:'401234567',leagueCode:'usa.1',status:'soon',date:now+2*3600000,observedAt:now-60000,sourceUrl:'http://localhost/api/feed?league=usa.1',odds:[2,3,4],providers:['A','A','A'],oddsPhase:'close-reference'};
  const entry={matchId:match.id,leagueCode:match.leagueCode,odds:[2,3,4],rawProbabilities:[.5,.3,.2],pick:0,probability:.45,score:80,newScore:76};
  const row=prospectiveForecast(entry,match,now);
  assert.equal(row?.quotePhase,'close-reference');
  assert.equal(row?.sourceUpdatedAt,null);
  assert.notEqual(row?.id,prospectiveForecast(entry,{...match,goalModel:{modelVersion:'poisson-standings-v3'}},now)?.id);
  assert.equal(prospectiveForecast(entry,{...match,providers:['A','B','A']},now),null);
  assert.equal(prospectiveForecast(entry,{...match,observedAt:now-31*60000},now),null);
  assert.equal(prospectiveForecast(entry,{...match,date:now-1000},now),null);
  assert.equal(prospectiveForecast({...entry,rawProbabilities:[.8,.8,.2]},match,now),null);
});

test('ambiguous finals enter review; trustworthy regular-time finals are append-only observations',()=>{
  const now=Date.now(),match={id:'401234567',leagueCode:'usa.1',status:'finished',date:now-3*3600000,observedAt:now,sourceUrl:'http://localhost/api/feed?league=usa.1',hs:2,as:1,period:2,detail:'Full Time'};
  const final=observedOutcome(match);assert.equal(final?.state,'final');assert.deepEqual([final?.homeScore,final?.awayScore],[2,1]);
  assert.equal(observedOutcome({...match,scoreConflict:true})?.state,'review');
  assert.equal(observedOutcome({...match,detail:'After Extra Time',period:4})?.state,'review');
  assert.equal(observedOutcome({...match,hs:null,as:null}),null);
  const postponed=observedOutcome({...match,status:'soon',date:now+3600000,hs:null,as:null,detail:'Postponed'});
  assert.equal(postponed?.state,'review');assert.equal(postponed?.homeScore,null);
  assert.equal(observedOutcome({...match,status:'finished',detail:'Abandoned'})?.state,'review');
  assert.equal(observedOutcome({...match,sourceUrl:'https://untrusted.example/match'}) ,null);
});

test('evaluation selects earliest eligible 24h forecast per match and excludes conflicting outcomes',()=>{
  const now=Date.now(),kick=now-3600000;
  const base={league_code:'usa.1',match_id:'1',kickoff_at:kick,source_observed_at:kick-12*3600000,source_url:'http://localhost/api/feed',quote_phase:'close-reference',home_odds:2.5,draw_odds:3,away_odds:3,raw_probabilities:JSON.stringify([.5,.3,.2]),pick:0,conservative_probability:.44,old_score:80,new_score:70};
  const early={...base,captured_at:kick-12*3600000},late={...base,captured_at:kick-3600000,pick:2,old_score:70,new_score:80};
  const outcome={league_code:'usa.1',match_id:'1',state:'final',home_score:2,away_score:1};
  const report=evaluateProspective([late,early],[outcome],false,now);
  assert.equal(report.selectedMatches,1);assert.equal(report.oldA.matches,1);assert.equal(report.newA.matches,0);
  assert.equal(report.all.wins,1);assert.equal(report.all.roi,1.5);assert.equal(report.provisional,true);assert.equal(report.promotionAllowed,false);
  assert.equal(report.currentQuoteOnly.all.matches,0);assert.equal(report.closeReferenceOnly.all.matches,1);
  const conflict=evaluateProspective([early],[outcome,{...outcome,home_score:0,away_score:1}],false,now);
  assert.equal(conflict.selectedMatches,0);assert.equal(conflict.skipped.conflictMatches,1);
  const retrospective=evaluateProspective([{...early,captured_at:kick+1000}],[outcome],false,now);
  assert.equal(retrospective.selectedMatches,0);
});
test('holdout boundary stays fixed as new matches arrive and model versions are disclosed',()=>{
  const now=Date.parse('2026-11-10T00:00:00Z'),before=Date.parse('2026-10-23T12:00:00Z'),after=Date.parse('2026-10-25T12:00:00Z');
  const forecast=(id,kickoff,modelVersion)=>({league_code:'eng.1',match_id:id,kickoff_at:kickoff,captured_at:kickoff-3600000,home_odds:2,draw_odds:3.5,away_odds:4,raw_probabilities:JSON.stringify([.5,.28,.22]),pick:0,old_score:78,new_score:76,quote_phase:'current',model_version:modelVersion});
  const outcome=id=>({league_code:'eng.1',match_id:id,state:'final',home_score:1,away_score:0});
  const first=evaluateProspective([forecast('a',before,'v1'),forecast('b',after,'v2')],[outcome('a'),outcome('b')],false,now);
  assert.equal(first.holdout.matches,1);
  assert.deepEqual(first.modelVersions,{v1:1,v2:1});
  assert.equal(first.byModelVersion.v1.all.matches,1);
  assert.equal(first.byModelVersion.v2.currentQuoteOnly.matches,1);
  const expanded=evaluateProspective([forecast('a',before,'v1'),forecast('b',after,'v2'),forecast('c',after+86400000,'v2')],[outcome('a'),outcome('b'),outcome('c')],false,now);
  assert.equal(expanded.holdout.matches,2);
  assert.equal(expanded.holdoutFrom,Date.parse('2026-10-24T00:00:00Z'));
  assert.equal(expanded.provisional,true);
  const sameMatch=evaluateProspective([forecast('a',before,'v1'),{...forecast('a',before,'v2'),captured_at:before-30*60000}],[outcome('a')],false,now);
  assert.equal(sameMatch.selectedMatches,1);
  assert.equal(sameMatch.byModelVersion.v1.all.matches,1);
  assert.equal(sameMatch.byModelVersion.v2.all.matches,1);
  assert.equal(sameMatch.multiVersionMatches,1);
});

test('same-price version pairing and price stress use frozen current quotes only',()=>{
  const now=Date.parse('2026-11-10T00:00:00Z'),kickoff=now-3600000;
  const base={league_code:'eng.1',match_id:'paired',kickoff_at:kickoff,captured_at:kickoff-3600000,home_odds:2,draw_odds:3.5,away_odds:4,
    raw_probabilities:JSON.stringify([.51,.27,.22]),pick:0,old_score:78,new_score:76,quote_phase:'current',quote_provider:'Same Book',source_updated_at:null,model_version:'v1'};
  const second={...base,captured_at:base.captured_at+120000,raw_probabilities:JSON.stringify([.49,.29,.22]),model_version:'v2'};
  const outcome={league_code:'eng.1',match_id:'paired',state:'final',home_score:1,away_score:0};
  const result=evaluateProspective([base,second],[outcome],false,now);
  assert.equal(result.selectedMatches,1);
  assert.equal(result.samePricePairedMatches,1);
  assert.deepEqual(result.pairedVersionComparisons[0].versions,['v1','v2']);
  assert.equal(result.pairedVersionComparisons[0].matches,1);
  assert.equal(result.priceStress.matches,1);
  assert.equal(result.priceStress.observedRoi,1);
  assert.equal(result.priceStress.priceMinus2PctRoi,.96);
  assert.equal(result.priceStress.positiveEdgeFlips,1);
  assert.equal(result.coverage.plannedFixtures,null);
  assert.equal(result.coverage.sourceUpdatedTimeKnown,0);
  assert.equal(result.promotionAllowed,false);
});
