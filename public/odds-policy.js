// A 1X2 quote must be offered by ONE provider in ONE market phase.
// Historical open/close fields are evidence of a past price, not an executable
// pre-match current quote. Never splice three outcomes across bookmakers.
export function decimalOdds(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return null;
  if (/^[+-]/.test(raw) || n < 0 || n > 20) {
    const converted = n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
    return Number.isFinite(converted) && converted > 1 && converted <= 1000 ? converted : null;
  }
  return n > 1 && n <= 20 ? n : null;
}

function phasePrice(side, phase) {
  const slot = side?.[phase];
  return decimalOdds(slot && typeof slot === 'object' ? slot.odds ?? slot.value : slot);
}

function directPrice(side) {
  return decimalOdds(side && typeof side === 'object' ? side.odds ?? side.value : side);
}

export function selectCurrentMoneyline(competition,{allowCloseReference=false}={}) {
  const raw = competition?.odds;
  const items = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : raw ? [raw] : [];
  const current = [], close = [], historical = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const line = item?.moneyline?.moneyline || item?.moneyline || item?.moneyLine;
    if (!line || typeof line !== 'object') continue;
    const provider = String(item.provider?.displayName || item.provider?.name || `公开市场 ${index + 1}`);
    const sides = [line.home, line.draw ?? line.tied, line.away];
    const phased = sides.some(side => side && typeof side === 'object' && ['current', 'close', 'open'].some(key => Object.hasOwn(side, key)));
    const values = phased ? sides.map(side => phasePrice(side, 'current'))
      : [directPrice(sides[0]), directPrice(sides[1]) ?? decimalOdds(item?.drawOdds?.moneyLine), directPrice(sides[2])];
    if (values.some(value => value != null)) current.push({values, provider, index});
    if (phased) {
      const closeValues=sides.map(side=>phasePrice(side,'close'));
      if(closeValues.some(value=>value!=null))close.push({values:closeValues,provider,index});
    }
    if (phased && sides.some(side => ['close', 'open'].some(phase => phasePrice(side, phase) != null))) historical.push(provider);
  }
  // Prefer a complete current quote. Otherwise retain only one provider's
  // partial quote for diagnosis; it cannot enter a value judgment.
  const complete = current.find(row => row.values.every(value => value != null));
  const partial=current.sort((a, b) => b.values.filter(value => value != null).length - a.values.filter(value => value != null).length || a.index - b.index)[0];
  // ESPN frequently publishes a future fixture's linked reference prices in
  // `close` with no `current`. A scheduled fixture may use the coherent close
  // triple for virtual research, but it is labelled reference-only and never
  // presented as a verified live/executable quote. A partial current quote
  // blocks fallback to close to avoid masking a market withdrawal.
  const closeSelected=allowCloseReference&&!partial?(close.find(row=>row.values.every(value=>value!=null))||close.sort((a,b)=>b.values.filter(value=>value!=null).length-a.values.filter(value=>value!=null).length||a.index-b.index)[0]):null;
  const selected = complete || partial || closeSelected;
  if (selected) {
    const odds = selected.values.map(value => value ?? 0);
    const full = odds.every(value => value > 1);
    const phase=selected===closeSelected?'close-reference':'current';
    return {odds, provider:selected.provider, phase, complete:full,historicalOnly:false,
      reason:phase==='close-reference'?(full?`ESPN 本次返回 ${selected.provider} 的同源完整 close 字段参考价；源头更新时间与可成交状态未知`:`ESPN 本次仅返回 ${selected.provider} 的部分 close 字段参考价；禁止跨来源补齐`)
        :(full?`同一来源 ${selected.provider} 的本次 1X2 三项报价；源头更新时间未知`:`来源 ${selected.provider} 的本次 1X2 仅有部分价格；禁止跨来源补齐`)};
  }
  return {odds:[0,0,0], provider:'', phase:'none', complete:false,historicalOnly:historical.length>0,
    reason:historical.length ? `仅见开盘/收盘历史价（${[...new Set(historical)].join('、')}），当前市场未提供完整报价` : '公开源未返回当前 1X2 报价'};
}

// Totals and handicaps also need both sides from one provider/phase/line.
// This helper is for the visible market card; the server independently
// validates its recorded multi-market quote rows.
export function selectCurrentPairedMarkets(item,{allowCloseReference=false}={}) {
  const total=item?.total,spread=item?.pointSpread;
  const totalAt=phase=>{const over=total?.over?.[phase],under=total?.under?.[phase];const line=Number(String(over?.line??'').replace(/^o/i,'')),other=Number(String(under?.line??'').replace(/^u/i,''));const overOdds=decimalOdds(over?.odds),underOdds=decimalOdds(under?.odds);return over?.line!=null&&under?.line!=null&&line>0&&line===other&&overOdds!=null&&underOdds!=null?{line,overOdds,underOdds,phase:phase==='close'?'close-reference':'current'}:null;};
  const spreadAt=phase=>{const home=spread?.home?.[phase],away=spread?.away?.[phase];const homeLine=Number(home?.line),awayLine=Number(away?.line),homeOdds=decimalOdds(home?.odds),awayOdds=decimalOdds(away?.odds);return home?.line!=null&&away?.line!=null&&Number.isFinite(homeLine)&&homeLine===-awayLine&&Number.isInteger(homeLine*4)&&homeOdds!=null&&awayOdds!=null?{homeLine,awayLine,homeOdds,awayOdds,phase:phase==='close'?'close-reference':'current'}:null;};
  const hasCurrentTotal=total?.over?.current!=null||total?.under?.current!=null;
  const hasCurrentSpread=spread?.home?.current!=null||spread?.away?.current!=null;
  return {total:totalAt('current')||(!hasCurrentTotal&&allowCloseReference?totalAt('close'):null),
    spread:spreadAt('current')||(!hasCurrentSpread&&allowCloseReference?spreadAt('close'):null)};
}
