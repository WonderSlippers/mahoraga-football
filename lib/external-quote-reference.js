// A read-only research fallback for the September 24 Nations League slate.
// These aggregated observations must never become scan prices.
export const nationalQuoteReferences = Object.freeze({
  '401861047': {slug:'andorra-vs-malta-2026-09-24',home:'Andorra',away:'Malta',kickoffAt:Date.parse('2026-09-24T16:00:00Z'),bookUrl:''},
  '401861048': {slug:'austria-vs-israel-2026-09-24',home:'Østrig',away:'Israel',kickoffAt:Date.parse('2026-09-24T18:45:00Z'),bookUrl:''},
  '401861045': {slug:'kosovo-vs-republic-of-ireland-2026-09-24',home:'Kosovo',away:'Irland',kickoffAt:Date.parse('2026-09-24T18:45:00Z'),bookUrl:''},
  '401861043': {slug:'liechtenstein-vs-lithuania-2026-09-24',home:'Liechtenstein',away:'Litauen',kickoffAt:Date.parse('2026-09-24T18:45:00Z'),bookUrl:''},
  '401861041': {slug:'netherlands-vs-germany-2026-09-24',home:'Nederlandene',away:'Tyskland',kickoffAt:Date.parse('2026-09-24T18:45:00Z'),bookUrl:'https://www.sportingbet.com/en/sports/events/netherlands-germany-2:7859257'},
  '401861046': {slug:'norway-vs-denmark-2026-09-24',home:'Norge',away:'Danmark',kickoffAt:Date.parse('2026-09-24T18:45:00Z'),bookUrl:'https://www.sportingbet.com/en/sports/events/norway-denmark-2:7859274'},
  '401861044': {slug:'portugal-vs-wales-2026-09-24',home:'Portugal',away:'Wales',kickoffAt:Date.parse('2026-09-24T18:45:00Z'),bookUrl:'https://www.sportingbet.com/en/sports/events/portugal-wales-2:7859275'},
  '401861042': {slug:'serbia-vs-greece-2026-09-24',home:'Serbien',away:'Grækenland',kickoffAt:Date.parse('2026-09-24T18:45:00Z'),bookUrl:''},
});

export const quoteReferenceUrl=fixture=>`https://statsbet.dk/fodbold/kampe/${fixture.slug}`;

export function parseQuoteReference(html,fixture){
  if(typeof html!=='string'||html.length>1_000_000)throw new Error('报价页面大小异常');
  const title=html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]||'';
  if(!title.includes(fixture.home)||!title.includes(fixture.away)||!html.includes('2026-09-24'))throw new Error('报价页面赛事身份或日期不符');
  const table=[...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(row=>row[0]).find(row=>/<th\b[^>]*>1<\/th>[\s\S]*?<th\b[^>]*>X<\/th>[\s\S]*?<th\b[^>]*>2<\/th>/i.test(row));
  if(!table)throw new Error('找不到完整胜平负报价表');
  const rows=[];
  for(const match of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=[...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell=>cell[1].replace(/<[^>]*>/g,'').trim());
    if(cells.length!==4)continue;
    const bookmaker=cells[0],odds=cells.slice(1).map(Number);
    if(!/^(?:bet365|Pinnacle|1xBet)$/.test(bookmaker)||odds.some(n=>!Number.isFinite(n)||n<1.01||n>1000))continue;
    rows.push({bookmaker,odds});
  }
  if(!rows.length)throw new Error('未取得同一公司完整三项报价');
  return rows;
}
