import test from 'node:test';
import assert from 'node:assert/strict';
import {nationalQuoteReferences,parseQuoteReference} from '../lib/external-quote-reference.js';
import {parseWinamaxPublicQuote} from '../lib/winamax-public-quote.js';

const fixture=nationalQuoteReferences['401861046'];
const html=`<title>Norge vs Danmark: Spilforslag & odds</title><p>2026-09-24</p><table><thead><tr><th>1</th><th>X</th><th>2</th></tr></thead><tbody><tr><td>bet365</td><td>1.66</td><td>4.10</td><td>4.50</td></tr><tr><td>Pinnacle</td><td>1.71</td><td>4.26</td><td>4.58</td></tr></tbody></table>`;

test('external reference keeps each company complete and separate',()=>{
  assert.deepEqual(parseQuoteReference(html,fixture),[
    {bookmaker:'bet365',odds:[1.66,4.1,4.5]},
    {bookmaker:'Pinnacle',odds:[1.71,4.26,4.58]},
  ]);
});

test('every September 24 national fixture has its own explicit source identity',()=>{
  assert.deepEqual(Object.keys(nationalQuoteReferences).sort(),['401861041','401861042','401861043','401861044','401861045','401861046','401861047','401861048']);
  assert.equal(new Set(Object.values(nationalQuoteReferences).map(row=>row.slug)).size,8);
});

test('external reference rejects wrong fixture and partial quotes',()=>{
  assert.throws(()=>parseQuoteReference(html.replace('Norge vs Danmark','Portugal vs Wales'),fixture),/身份/);
  assert.throws(()=>parseQuoteReference(html.replace('<td>4.50</td>','<td>—</td>').replace('<td>4.58</td>','<td>—</td>'),fixture),/完整三项/);
});

test('research UI uses public price for hypothetical paper payout and expires old observations',async()=>{
  const oldDocument=globalThis.document,oldDateNow=Date.now;
  const now=Date.parse('2026-09-24T12:00:00Z');
  globalThis.document={addEventListener(){}};Date.now=()=>now;
  try{
    const {researchBoard}=await import('../public/research-ui.js');
    const radar={entries:[{matchId:'401861046',leagueCode:'uefa.nations',home:'Norway',away:'Denmark',kickoffAt:now+3*3600000}]};
    const lab={portfolios:[{id:'value-singles',tickets:[]}],radar};
    const quote={ok:true,capturedAt:now,sourceUrl:'https://statsbet.dk/fodbold/kampe/norway-vs-denmark-2026-09-24',bookUrl:'https://www.sportingbet.com/en/sports/events/norway-denmark-2:7859274',rows:[{bookmaker:'bet365',odds:[1.66,4.1,4.5]}]};
    const fresh=researchBoard(lab,{externalQuoteReferences:{'401861046':quote}});
    assert.match(fresh,/按展示价假设成交 · 胜平负模拟/);
    assert.match(fresh,/bet365 1.66 \/ 4.10 \/ 4.50/);
    assert.match(fresh,/¥33.20 \/ ¥82.00 \/ ¥90.00/);
    assert.match(fresh,/真实账户可成交性未知/);
    assert.doesNotMatch(fresh,/审查方向 主胜 @ 1\.66/);
    const stale=researchBoard(lab,{externalQuoteReferences:{'401861046':{...quote,capturedAt:now-11*60000}}});
    assert.match(stale,/外部报价快照已过期/);
    assert.doesNotMatch(stale,/bet365 1.66/);
  }finally{globalThis.document=oldDocument;Date.now=oldDateNow;}
});

test('Winamax public listing requires exact fixture and complete same-book 1X2',()=>{
  const page='<title>Österreich - Israel Tipp &amp; Quoten | 24.09.2026</title><tr><td><div class="bcb-operator-title">Winamax</div></td><td><span data-odds="1.42" class="odds-action-home">1.42</span></td><td><span data-odds="4.8" class="odds-action-draw">4.80</span></td><td><span data-odds="6" class="odds-action-away">6.00</span></td></tr>';
  assert.deepEqual(parseWinamaxPublicQuote(page),{bookmaker:'Winamax',odds:[1.42,4.8,6]});
  assert.throws(()=>parseWinamaxPublicQuote(page.replace('Israel','Kosovo')),/身份/);
  assert.throws(()=>parseWinamaxPublicQuote(page.replace('odds-action-away','other-market')),/不完整/);
});
