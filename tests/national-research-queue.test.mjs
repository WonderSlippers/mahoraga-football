import test from 'node:test';
import assert from 'node:assert/strict';
import {nationalResearchLeagues,nationalResearchRows} from '../public/national-research-queue.js';

test('national fixtures reach research without an odds quote or writable scan',()=>{
  const now=Date.parse('2026-09-24T14:00:00Z'),kickoffAt=now+5*3600000;
  const radar={capturedAt:now-30*3600000,entries:[{matchId:'n1',leagueCode:'uefa.nations',home:'Netherlands',away:'Germany',kickoffAt,priced:true,quotePhase:'close',observedAt:now-30*3600000},{matchId:'c1',leagueCode:'caf.nations_qual',home:'Congo DR',away:'Eq. Guinea',kickoffAt:kickoffAt-3600000,priced:false,observedAt:now-30*3600000}]};
  assert.deepEqual(nationalResearchLeagues(radar,now),['uefa.nations','caf.nations_qual']);
  const feeds={failedLeagues:['caf.nations_qual'],leagues:[{leagueCode:'uefa.nations',fetchedAt:now,events:[{id:'n1',date:new Date(kickoffAt).toISOString(),status:{type:{state:'pre'}},competitions:[{competitors:[{homeAway:'home',team:{displayName:'Netherlands'}},{homeAway:'away',team:{displayName:'Germany'}}]}]}]}]};
  const rows=nationalResearchRows(feeds,radar,now);
  assert.equal(rows.length,2);
  assert.equal(rows[0].source,'old-radar');
  assert.equal(rows[1].source,'read-only-feed');
  assert.equal(rows[1].matchId,'n1');
  assert.equal(rows[1].odds,undefined);
  assert.equal(nationalResearchRows({...feeds,failedLeagues:[],leagues:[...feeds.leagues,{leagueCode:'caf.nations_qual',events:[]}]},radar,now).length,1);
});

test('research board shows stale national fixture as a research task, not a priced candidate',async()=>{
  const original=globalThis.document;globalThis.document={addEventListener(){}};
  try{
    const {researchBoard}=await import('../public/research-ui.js');
    const now=Date.now(),lab={portfolios:[{id:'value-singles',tickets:[]}],lastScanAt:now-30*3600000,radar:{capturedAt:now-30*3600000,entries:[{matchId:'401861041',leagueCode:'uefa.nations',home:'Netherlands',away:'Germany',kickoffAt:now+3*3600000,stage:'execution',priced:true,quotePhase:'close',odds:[2.5,3.8,2.45],observedAt:now-30*3600000}]}};
    const html=researchBoard(lab,{scanAvailable:false});
    assert.match(html,/国家队重点研究队列/);
    assert.match(html,/荷兰/);
    assert.match(html,/本轮优先研究/);
    assert.match(html,/欧足联赛前前瞻/);
    assert.match(html,/旧扫描赛程，待复核/);
    assert.match(html,/未来 48 小时已见 1 场国家队比赛进入研究队列；0 个跨玩法候选通过价格数值预筛/);
    assert.match(html,/当前没有通过价格门槛的多市场候选；上方赛程研究队列仍可逐场核对/);
    assert.doesNotMatch(html,/审查方向 主胜 @ 2\.50/);
  }finally{globalThis.document=original;}
});

test('source-backed matchday spotlights precede earlier non-spotlight fixtures',()=>{
  const now=Date.parse('2026-09-24T14:00:00Z');
  const radar={entries:[
    {matchId:'401861047',leagueCode:'uefa.nations',home:'Andorra',away:'Malta',kickoffAt:now+2*3600000},
    {matchId:'401861041',leagueCode:'uefa.nations',home:'Netherlands',away:'Germany',kickoffAt:now+4*3600000},
  ]};
  const rows=nationalResearchRows(null,radar,now);
  assert.equal(rows[0].matchId,'401861041');
  assert.match(rows[0].spotlight.reason,/欧足联本轮前瞻/);
  assert.equal(rows[1].spotlight,null);
});
