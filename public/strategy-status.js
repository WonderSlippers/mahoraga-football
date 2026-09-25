export const HISTORY_ONLY_STRATEGIES=new Set(['totals-baseline','totals-poisson']);
export const REVIEW_PAUSED_STRATEGIES=new Set(['treble','mixed-double']);

export function strategyStatus(portfolio) {
  if(HISTORY_ONLY_STRATEGIES.has(portfolio.id))return '只读历史';
  if(REVIEW_PAUSED_STRATEGIES.has(portfolio.id))return '暂停待复核';
  return portfolio.enabled?'运行中':'已暂停';
}

export function strategyCanCreate(portfolio) {
  return strategyStatus(portfolio)==='运行中';
}
