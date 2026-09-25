import { isDeepStrictEqual } from 'node:util';

export function ticketIndex(lab) {
  if (!Array.isArray(lab?.portfolios)) throw new Error('Missing portfolios');
  const result = new Map();
  const portfolios = new Set();
  for (const p of lab.portfolios) {
    if (!p.id || portfolios.has(p.id) || !Array.isArray(p.tickets)) throw new Error('Invalid/duplicate portfolio');
    portfolios.add(p.id);
    for (const t of p.tickets) {
      const key = JSON.stringify([p.id, t.id]);
      if (!t.id || result.has(key) || !Array.isArray(t.legs)) throw new Error('Invalid/duplicate ticket');
      result.set(key, t);
    }
  }
  return result;
}

export function summarizeLab(lab) {
  const counts = {open:0, review:0, win:0, loss:0, void:0};
  const pending = [];
  for (const [key,t] of ticketIndex(lab)) {
    if (!Object.hasOwn(counts,t.status)) throw new Error(`Unknown status: ${t.status}`);
    counts[t.status]++;
    if (t.status === 'open' || t.status === 'review') pending.push({key,status:t.status,stake:t.stake,odds:t.odds,pnl:t.pnl,legs:t.legs.map(l=>({matchId:l.matchId,home:l.home,away:l.away,status:l.status,finalScore:l.finalScore}))});
  }
  return {portfolios:lab.portfolios.length,total:Object.values(counts).reduce((a,b)=>a+b,0),counts,unsettled:counts.open+counts.review,pending};
}

// Report every changed field. Historical settlement changes are evidence,
// not permission to rewrite history or proof of a correct sporting result.
export function fieldDiff(before, after, path='') {
  if (isDeepStrictEqual(before,after)) return [];
  if (before && after && typeof before==='object' && typeof after==='object' && Array.isArray(before)===Array.isArray(after)) {
    return [...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(k=>fieldDiff(before[k],after[k],path ? `${path}.${k}` : k));
  }
  return [{path,before:before===undefined?{missing:true}:before,after:after===undefined?{missing:true}:after}];
}

const displayOnly = /^legs\.\d+\.(score|scoreOrigin|scoreComputedAt|scoreDisplayVersion|rationale|directionChanged|alt|driftNote)(\.|$)/;
const frozen = /^(id|day|createdAt|stake|odds|estimatedEdge)$|^legs\.\d+\.(matchId|leagueCode|home|away|kickoffAt|market|pick|side|line|odds|probability|provider|phase|priceCapturedAt|evidence|goalEvidence|deepAnalysis|decisionVersion|newScore)(\.|$)/;

export function compareTickets(before,after,{api=false}={}) {
  const left=ticketIndex(before),right=ticketIndex(after),changes=[],errors=[];
  for (const key of new Set([...left.keys(),...right.keys()])) {
    const a=left.get(key),b=right.get(key);
    if (!a || !b) { errors.push({key,reason:a?'missing-ticket':'added-ticket'}); continue; }
    const fields=fieldDiff(a,b);
    if (fields.length) changes.push({key,beforeStatus:a.status,afterStatus:b.status,fields});
    for (const f of fields) if (api ? !displayOnly.test(f.path) : frozen.test(f.path)) errors.push({key,...f});
  }
  return {ok:errors.length===0,compared:left.size,errors,changes};
}
