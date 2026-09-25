import {asianFactor} from './market-math.js?rev=evidence-v3';
// Display-only accounting. Never mutate the saved ledger or invent settlement dates.
export const closed = t => ['win', 'loss', 'void'].includes(t.status);
export const numeric = v => v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v));
export const tone = v => Number(v) > 0 ? 'positive' : Number(v) < 0 ? 'negative' : 'neutral';
// Accounting day closes at 08:00 Asia/Shanghai. Because Shanghai is UTC+8
// without daylight saving time, the UTC calendar date is the billing label:
// 07:59 local still belongs to yesterday; 08:00 starts a new bill.
export function dayAt(value) {
  if (!numeric(value) || Number(value) <= 0) return '';
  return new Date(Number(value)).toISOString().slice(0, 10);
}
export const recentDays = (count = 7, now = Date.now()) => Array.from({length: count}, (_, i) => dayAt(now - (count - i - 1) * 86400000));
export const ticketPnl = t => closed(t) && t.status !== 'void' && numeric(t.pnl) ? Number(t.pnl) : 0;
export function summarize(tickets) {
  const resolved = tickets.filter(closed), wins = resolved.filter(t => t.status === 'win').length;
  const losses = resolved.filter(t => t.status === 'loss').length, voids = resolved.filter(t => t.status === 'void').length;
  const pnl = Math.round(resolved.reduce((s, t) => s + ticketPnl(t), 0) * 100) / 100;
  const stake = resolved.filter(t => t.status !== 'void').reduce((s, t) => s + Number(t.stake || 0), 0);
  return {count: resolved.length, wins, losses, voids, pnl, stake, roi: stake ? pnl / stake * 100 : null, hitRate: wins + losses ? wins / (wins + losses) * 100 : null};
}
export function dailyStats(tickets, date) {
  const placed = tickets.filter(t => dayAt(t.createdAt) === date);
  const settled = tickets.filter(t => closed(t) && dayAt(t.settledAt) === date);
  return {...summarize(settled), placedCount: placed.length, placedStake: placed.reduce((s,t) => s + Number(t.stake || 0), 0)};
}
export function ticketMarket(t) {
  const markets = [...new Set((t.legs || []).map(l => l.market || '1x2'))];
  return markets.length === 1 ? markets[0] : markets.length ? 'mixed' : 'unknown';
}
export function ticketBand(t) {
  if (!t.legs?.length || t.legs.some(l => !numeric(l.score) || l.scoreOrigin === 'read-time-recomputed' || l.scoreOrigin === 'unscorable-missing-at-bet-probability')) return 'unknown';
  const score = Math.min(...t.legs.map(l => Number(l.score)));
  return score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 45 ? 'C' : 'D';
}
export function parseScore(value) {
  const match = String(value || '').trim().match(/^(\d+)\s*[-—–:：]\s*(\d+)$/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}
export function hypotheticalPnl(ticket, changedLegIndex, alternative) {
  // Only calculate a whole-ticket counterfactual when every leg is known.
  const factors = (ticket.legs || []).map((leg,index) => {
    const pick = index === changedLegIndex ? alternative : leg;
    if (leg.status === 'void' && !parseScore(leg.finalScore)) return 1;
    const score = parseScore(leg.finalScore);
    if (!score || !numeric(pick?.odds) || Number(pick.odds) <= 1) return null;
    const [home,away] = score;
    if (pick.market === 'total' || pick.market === 'spread') {
      if(!numeric(pick.line))return null;
      return asianFactor(pick.market,pick.side,Number(pick.line),Number(pick.odds),home,away);
    }
    if(!numeric(pick.pick) || ![0,1,2].includes(Number(pick.pick))) return null;
    return Number(pick.pick) === (home > away ? 0 : home === away ? 1 : 2) ? Number(pick.odds) : 0;
  });
  if (!factors.length || factors.some(f => f === null)) return null;
  return Math.round(Number(ticket.stake) * (factors.reduce((a,b) => a*b, 1) - 1) * 100) / 100;
}
