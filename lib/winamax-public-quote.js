// Public third-party listing of Winamax prices. This is not a direct
// Winamax account quote; paper fills may assume the displayed price.
export const austriaIsraelWinamaxUrl='https://www.wettfreunde.net/nations-league-tipps/oesterreich-israel-tipp-ki-prognose-quoten-24-09-2026/';

export function parseWinamaxPublicQuote(html){
  if(typeof html!=='string'||html.length>700_000)throw new Error('Winamax 来源页面大小异常');
  const title=html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]||'';
  if(!/Österreich|Oesterreich/i.test(title)||!/Israel/i.test(title)||!html.includes('24.09.2026'))throw new Error('Winamax 页面赛事身份或日期不符');
  const row=[...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)]
    .map(match=>match[0]).find(value=>/<div\b[^>]*class="bcb-operator-title"[^>]*>Winamax<\/div>/i.test(value));
  if(!row)throw new Error('没有找到 Winamax 报价行');
  const odds=['home','draw','away'].map(side=>{
    const match=row.match(new RegExp(`<span\\b[^>]*data-odds="([0-9]+(?:\\.[0-9]+)?)"[^>]*odds-action-${side}\\b`, 'i'));
    return Number(match?.[1]??NaN);
  });
  if(odds.some(value=>!Number.isFinite(value)||value<=1||value>1000))throw new Error('Winamax 三项报价不完整');
  return {bookmaker:'Winamax',odds};
}
