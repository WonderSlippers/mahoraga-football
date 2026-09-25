import {teamZh} from './names-zh.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=v=>new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const pct=v=>Number.isFinite(v)?(v*100).toFixed(1)+'%':'缺失';
export function forecastView(data,now=Date.now()) {
  if(!Array.isArray(data.records)||!data.records.length)throw Error('尚无冻结预测');
  return `<p>冻结于 ${esc(time(data.createdAt))}（北京时间），不是即时更新的推荐。模型 ${esc(data.modelVersion)}；训练数据截止 ${esc(data.dataCutoffExclusive)} UTC之前，共 ${esc(data.historyMatches)} 场。</p><p>仅概率研究，未配对盘口价格，金额为0，不计入模拟盈亏。未使用首发、伤停和疲劳信息；尚无盈利验证。结果评估尚未接入自动更新。</p><div class="research-reviews">${data.records.map(r=>`<article class="research-review"><strong>${esc(teamZh(r.home))} vs ${esc(teamZh(r.away))}</strong><small class="team-original">${esc(r.home)} vs ${esc(r.away)}</small><p>${esc(time(r.date))} 开球 · ${Date.parse(r.date)>now?'按冻结赛程尚未开球':'已过原定开球时间，待赛果核验'}</p><p>主胜 ${pct(r.probabilities.home?.p)} · 平局 ${pct(r.probabilities.draw?.p)} · 客胜 ${pct(r.probabilities.away?.p)}</p><details><summary>查看大小球、让球概率及来源时间</summary><p>${[1.5,2.5,3.5].map(line=>`全场大${line}球 ${pct(r.probabilities['over'+line]?.p)}`).join('；')}</p><p>${[-1.5,-.5,.5,1.5].map(line=>`主队${line>=0?'+':''}${line} ${pct(r.probabilities['home-handicap'+line]?.p)}`).join('；')}（亚洲半球型盘口）</p><p>模型胜平负与各玩法由同一比分分布产生，不是独立拟合模型。开球时间来自冻结时赛程，改期需后续核验。</p><small>比赛编号 ${esc(r.id)}；赛程观察 ${esc(time(r.observedAt))}；预测记录 ${esc(time(r.predictedAt))}。</small></details></article>`).join('')}</div><p><a href="/forecast-20260915.json" download>下载冻结快照（含来源与校验值）</a>。后续新预测不得覆盖本版本。</p>`;
}
export const forecastPanel=()=>'<details class="forecast-panel"><summary>前瞻验证 · 下一轮英超10场 · 仅概率，未下注</summary><div class="forecast-body">展开查看冻结的赛前概率。</div></details>';
document.addEventListener('toggle',async e=>{
  const el=e.target;if(!el?.matches?.('details.forecast-panel')||!el.open||el.dataset.loading==='true')return;
  el.dataset.loading='true';const body=el.querySelector('.forecast-body');body.textContent='正在读取冻结快照…';
  try{const response=await fetch('/forecast-20260915.json',{cache:'no-store'});if(!response.ok)throw Error('读取失败');body.innerHTML=forecastView(await response.json());}
  catch(error){body.textContent='前瞻记录暂不可用：'+error.message;}
  finally{el.dataset.loading='false';}
},true);
