// The legacy browser still sends a whole ledger. Validate that transition
// before its compare-and-swap write so an old tab cannot erase historical bets.
const frozenFields = [
  'id', 'ts', 'day', 'matchId', 'leagueCode', 'league', 'home', 'away',
  'pick', 'pickLabel', 'odds', 'stake', 'source', 'mode', 'marketPhase',
  'priceKind', 'priceProvider', 'modelProbability', 'strategyVersion', 'sourceScore',
  'scoreAtBet', 'kickoffAt',
];
const terminalFields = ['status', 'pnl', 'settledAt', 'finalScore'];
const statuses = new Set(['open', 'review', 'win', 'loss', 'void']);

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function validateLedgerWrite(current, next) {
  if (!object(next?.state) || !object(next?.settings) || !Array.isArray(next.state.records)) return '账本格式无效';
  if (!money(next.state.balance) || !money(next.state.initialBalance)) return '账本余额无效';
  if (Number(next.settings.autoStake) !== 20) return '新模拟单固定金额须为 20 元';
  const oldRecords = current?.state?.records;
  if (current && !Array.isArray(oldRecords)) return '原账本结构无效，需人工复核';
  const prior = new Map();
  for (const record of oldRecords || []) {
    if (!object(record) || !record.id || prior.has(String(record.id))) return '原账本票号异常，需人工复核';
    prior.set(String(record.id), record);
  }
  const seen = new Set();
  let settledDelta = 0;
  for (const record of next.state.records) {
    if (!object(record) || !record.id || seen.has(String(record.id)) || !statuses.has(record.status)) return '票据格式或票号无效';
    seen.add(String(record.id));
    const old = prior.get(String(record.id));
    if (!old) {
      if (record.status !== 'open' || record.stake !== 20 || !Number.isFinite(record.odds) || record.odds <= 1 || ![0, 1, 2].includes(Number(record.pick)) || !Number.isFinite(Number(record.ts)) || Number(record.ts) <= 0 || Number(record.pnl) !== 0) return '新票必须是 20 元未结算模拟单';
      continue;
    }
    if (frozenFields.some(field => !equal(old[field], record[field]))) return `历史票 ${record.id} 的出票字段不可更改`;
    if (old.status !== 'open') {
      if (terminalFields.some(field => !equal(old[field], record[field]))) return `历史票 ${record.id} 的结算字段不可更改`;
      continue;
    }
    if (record.status === 'open' && Number(record.pnl) !== 0) return `未结算票 ${record.id} 的盈亏无效`;
    if (record.status === 'review' || record.status === 'void') {
      if (Number(record.pnl) !== 0) return `待复核或作废票 ${record.id} 的盈亏必须为零`;
    } else if (record.status === 'win' || record.status === 'loss') {
      if (!Number.isFinite(Number(record.settledAt)) || Number(record.settledAt) <= 0 || !/^\d+\s*[—–-]\s*\d+$/.test(String(record.finalScore || ''))) return `结算票 ${record.id} 缺少赛果`; 
      const expected = record.status === 'win' ? Number(old.stake) * (Number(old.odds) - 1) : -Number(old.stake);
      if (!Number.isFinite(expected) || Math.abs(Number(record.pnl) - expected) > 0.011) return `结算票 ${record.id} 的盈亏不守恒`;
      settledDelta += Number(record.pnl);
    }
  }
  for (const id of prior.keys()) if (!seen.has(id)) return `历史票 ${id} 不可删除`;
  if (current) {
    const oldStart = Number(current.state.portfolioStartAt || 0), nextStart = Number(next.state.portfolioStartAt || 0);
    const oldPeriods = Array.isArray(current.state.periodHistory) ? current.state.periodHistory : [];
    const newPeriods = Array.isArray(next.state.periodHistory) ? next.state.periodHistory : [];
    if (!Number.isSafeInteger(nextStart) || nextStart < oldStart || newPeriods.length < oldPeriods.length
      || oldPeriods.some((period,index) => !equal(period,newPeriods[index]))) return '资金周期历史不可回退或改写';
    const reset = nextStart > oldStart;
    if (reset) {
      const event = newPeriods.at(-1);
      const previousTicketCount = oldRecords.filter(record => Number(record.ts) >= oldStart).length;
      if (newPeriods.length !== oldPeriods.length + 1 || !event || !/^period-\d{13,}-[0-9a-f]{8}$/.test(String(event.id))
        || event.startedAt !== nextStart || event.previousStartAt !== oldStart
        || !money(event.initialBalance) || event.initialBalance !== next.state.initialBalance
        || !money(event.previousBalance) || Math.abs(event.previousBalance - current.state.balance) > 0.011
        || event.previousTicketCount !== previousTicketCount
        || next.state.records.some(record => record.status === 'open' || record.status === 'review')) return '资金周期变更缺少有效预览记录或仍有未决票';
    } else if (newPeriods.length !== oldPeriods.length) return '资金周期记录只能随新周期追加';
    const expectedBalance = reset ? Number(next.state.initialBalance) : Number(current.state.balance) + settledDelta;
    if (!Number.isFinite(expectedBalance) || Math.abs(Number(next.state.balance) - expectedBalance) > 0.011) return '账本余额与逐票盈亏不守恒';
  }
  return null;
}
