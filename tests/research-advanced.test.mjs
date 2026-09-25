import test from 'node:test';
import assert from 'node:assert/strict';

test('research view separates data, proof and action while showing a fragile price edge',async()=>{
  const original=globalThis.document;
  globalThis.document={addEventListener(){}};
  try{
    const {researchBoard}=await import('../public/research-ui.js');
    const now=Date.now();
    const row={matchId:'123456789',leagueCode:'eng.1',home:'Arsenal',away:'Chelsea',kickoffAt:now+3600000,
      stage:'execution',priced:true,quotePhase:'current',odds:[1.9,3.4,4],pick:0,probability:.55,edge:.045,
      score:80,newScore:78,reason:'仅供研究',qualifies:false,observedAt:now};
    const lab={portfolios:[{id:'value-singles',tickets:[]}],radar:{capturedAt:now,entries:[row]},lastScanAt:now,
      scanProgress:{id:'qa-run'},samplingAudit:{id:'qa-run',selectedLeagues:['eng.1','fra.1'],failedLeagues:['fra.1'],futureFixturesSeen:3},marketReviews:[],reviews:[]};
    const html=researchBoard(lab,{scanAvailable:false});
    assert.match(html,/数据范围：/);
    assert.match(html,/选择 2 个联赛，失败 1 个/);
    assert.match(html,/预测证据：/);
    assert.match(html,/自动和手动新单扫描仍因保护暂停/);
    assert.match(html,/概率和报价变化后，结论还成立吗/);
    assert.match(html,/概率估计高了 3 个百分点，变成 -1\.2%/);
    assert.match(html,/不是统计置信区间/);
    assert.match(researchBoard({...lab,samplingAudit:{...lab.samplingAudit,id:'older-run'}},{scanAvailable:false}),/暂无可核对的近期采样范围/);
  }finally{globalThis.document=original;}
});
