const host=document.querySelector('#emperorsCupWatch');
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const time=value=>new Date(Number(value)).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
let lastRead=0,loading=false;

async function refresh(){
  if(!host||loading||document.hidden||Date.now()-lastRead<5*60_000)return;
  loading=true;lastRead=Date.now();
  try{
    const response=await fetch('/api/emperors-cup',{signal:AbortSignal.timeout(12000)});
    const data=await response.json();
    if(!response.ok||!data.ok)throw Error(data.error||'官方赛程不可用');
    const now=Date.now(),fixtures=Array.isArray(data.fixtures)?data.fixtures:[];
    const nearby=fixtures.filter(row=>Number(row.kickoffAt)>=now-6*3600000&&Number(row.kickoffAt)<=now+48*3600000);
    const future=fixtures.filter(row=>Number(row.kickoffAt)>now+48*3600000);
    const card=row=>{
      const passed=Number(row.kickoffAt)<=now;
      return `<article class="cup-fixture"><b>${esc(row.home)} <span>对</span> ${esc(row.away)}</b><small>${esc(time(row.kickoffAt))} 北京时间 · 第 ${Number(row.matchNo)} 场 · ${esc(row.venue)}</small><p>${passed?'开赛时间已到；官方公告不提供实时比分，赛况待核验。':'官方已确认赛程；开赛前阵容和赔率仍待逐项核验。'}</p><span class="cup-odds-state">未取得可核验的当前同源完整 1X2；不生成模拟单</span></article>`;
    };
    host.innerHTML=`<div class="cup-watch-head"><div><p class="eyebrow">OFFICIAL FIXTURE WATCH</p><h2>天皇杯 · ${nearby.length} 场临近赛程</h2></div><span>赛程源 ${esc(time(data.capturedAt))}${data.stale?' · 缓存待刷新':''}</span></div><p class="cup-watch-note">日本足协确认的是对阵与开赛时间，不等于直播比分或可成交赔率；J1 联赛数据不能自动替代天皇杯。<a href="${esc(data.sourceUrl)}" target="_blank" rel="noopener noreferrer">核对官方赛程</a> · <a href="https://www.winamax.fr/paris-sportifs" target="_blank" rel="noopener noreferrer">打开 Winamax 核对是否上架</a></p><div class="cup-fixtures">${nearby.map(card).join('')||'<p>未来 48 小时没有这份官方公告中的杯赛赛程。</p>'}</div>${future.length?`<details><summary>后续 ${future.length} 场已公布赛程</summary><div class="cup-fixtures">${future.map(card).join('')}</div></details>`:''}`;
  }catch(error){host.innerHTML=`<h2>天皇杯 · 赛程待核验</h2><p>${esc(error.message)}；不显示猜测的比分或赔率。</p><a href="https://www.jfa.jp/match/emperorscup_2026/schedule_result/" target="_blank" rel="noopener noreferrer">查看日本足协官方赛程</a>`;}
  finally{loading=false;}
}
refresh();
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
setInterval(refresh,5*60_000);
