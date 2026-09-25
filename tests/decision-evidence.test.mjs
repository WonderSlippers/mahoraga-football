import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionEvidenceFresh,candidateQuoteMatches} from '../public/decision-evidence.js';

test('a simulated candidate needs both a recent scan and healthy league quote',()=>{
  const now=Date.UTC(2026,8,24,0),base={scanAt:now-5*60000,lastSuccessAt:now-5*60000,feedStatus:'ok',quoteStale:false,now};
  assert.equal(decisionEvidenceFresh(base),true);
  assert.equal(decisionEvidenceFresh({...base,scanAt:base.scanAt-1}),false);
  assert.equal(decisionEvidenceFresh({...base,lastSuccessAt:base.lastSuccessAt-1}),false);
  assert.equal(decisionEvidenceFresh({...base,feedStatus:'error'}),false);
  assert.equal(decisionEvidenceFresh({...base,quoteStale:true}),false);
  assert.equal(decisionEvidenceFresh({...base,scanAt:now+1001}),false);
});

test('saved candidates must match a recent current quote from the same provider and line',()=>{
  const now=Date.UTC(2026,8,24,0);
  const match={odds:{provider:'source-a',quotePhase:'current',decimals:[2.1,3.2,3.6],offers:[
    {provider:'source-a',total:{phase:'current',line:2.5,overOdds:1.91,underOdds:1.93},spread:{phase:'current',homeLine:-0.5,awayLine:0.5,homeOdds:1.88,awayOdds:2.01}},
  ]}};
  const base={provider:'source-a',phase:'current',priceCapturedAt:now-60000};
  assert.equal(candidateQuoteMatches({...base,market:'1x2',pick:0,odds:2.1},match,now),true);
  assert.equal(candidateQuoteMatches({...base,market:'1x2',pick:0,odds:2.2},match,now),false);
  assert.equal(candidateQuoteMatches({...base,market:'1x2',pick:0,odds:2.1,provider:'source-b'},match,now),false);
  assert.equal(candidateQuoteMatches({...base,market:'1x2',pick:0,odds:2.1,phase:'close-reference'},match,now),false);
  assert.equal(candidateQuoteMatches({...base,market:'total',side:'over',line:2.5,odds:1.91},match,now),true);
  assert.equal(candidateQuoteMatches({...base,market:'total',side:'over',line:3.5,odds:1.91},match,now),false);
  assert.equal(candidateQuoteMatches({...base,market:'spread',side:'away',line:0.5,odds:2.01},match,now),true);
  assert.equal(candidateQuoteMatches({...base,market:'spread',side:'away',line:0,odds:2.01},match,now),false);
  assert.equal(candidateQuoteMatches({...base,market:'spread',side:'away',line:0.5,odds:2.01,priceCapturedAt:now-300001},match,now),false);
  match.odds.offers[0].spread.phase='close';
  assert.equal(candidateQuoteMatches({...base,market:'spread',side:'away',line:0.5,odds:2.01},match,now),false);
});
