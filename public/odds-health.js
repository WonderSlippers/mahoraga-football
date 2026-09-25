const labels = ['主胜', '平局', '客胜'];

const validPrice = value => Number.isFinite(Number(value)) && Number(value) > 1;

export function classifyOddsAvailability({
  status = 'soon',
  kickoffAt = 0,
  observedAt = Date.now(),
  prices = [],
  historicalPrices = [],
  rawOddsCount = 0,
  moneylineCount = 0,
  historicalOnly = false,
  officialOnly = false,
} = {}) {
  const normalized = [0, 1, 2].map(index => validPrice(prices[index]));
  const historicalComplete = [0, 1, 2].every(index => validPrice(historicalPrices[index]));
  const available = normalized.filter(Boolean).length;
  const minutesToKickoff = (Number(kickoffAt) - Number(observedAt)) / 60000;

  if (officialOnly || status === 'finished') {
    return { code: 'not-applicable', complete: false, available, missing: [], minutesToKickoff };
  }
  if (available === 3) {
    return { code: 'complete', complete: true, available, missing: [], minutesToKickoff };
  }
  const missing = labels.filter((_, index) => !normalized[index]);
  if (status === 'live' && historicalComplete) {
    return { code: available ? 'live-partial' : 'live-unavailable', complete: false, available, missing, minutesToKickoff };
  }
  if (available > 0) {
    return { code: 'partial', complete: false, available, missing, minutesToKickoff };
  }
  if (historicalOnly) {
    return { code: 'historical-only', complete: false, available, missing, minutesToKickoff };
  }
  if (Number(rawOddsCount) <= 0) {
    return { code: minutesToKickoff > 24 * 60 ? 'not-returned-early' : 'not-returned', complete: false, available, missing, minutesToKickoff };
  }
  if (Number(moneylineCount) <= 0) {
    return { code: 'market-absent', complete: false, available, missing, minutesToKickoff };
  }
  return { code: 'invalid', complete: false, available, missing, minutesToKickoff };
}

export function oddsAvailabilityText(info, compact = false) {
  const missing = Array.isArray(info?.missing) && info.missing.length ? info.missing.join('、') : '主胜、平局、客胜';
  switch (info?.code) {
    case 'complete': return compact ? '1X2 完整' : '公开源已返回完整主胜、平局、客胜价格';
    case 'partial': return compact ? `1X2 不完整 · 缺${missing}` : `公开源只返回部分 1X2 价格，缺少${missing}；不参与价值判断`;
    case 'historical-only': return compact ? '只有历史价 · 无当前价' : '公开源只有开盘或收盘历史价，当前 1X2 价格未返回；不参与价值判断';
    case 'live-partial': return compact ? `滚球价不完整 · 缺${missing}` : `公开源有赛前或收盘价，但 current 滚球价不完整，缺少${missing}`;
    case 'live-unavailable': return compact ? '滚球价未返回' : '公开源有赛前或收盘价，但没有返回完整 current 滚球价';
    case 'not-returned-early': return compact ? '尚未返回 · 距开球较远' : '公开源已返回赛事，但尚未返回 1X2 价格；距离开球超过 24 小时，可能尚未开盘';
    case 'not-returned': return compact ? '源头未返回 1X2' : '公开源已返回赛事，但本次抓取没有 1X2 价格';
    case 'market-absent': return compact ? '没有 1X2 市场' : '公开源返回了其他盘口节点，但没有可验证的 1X2 市场';
    case 'invalid': return compact ? '1X2 格式无效' : '公开源返回了 1X2 节点，但三项价格无法完整解析；已停止价值判断';
    case 'not-applicable': return compact ? '完场 · 赔率不适用' : '比赛已经结束，不把赛后缺少赛前赔率计为当前数据故障';
    default: return compact ? '赔率状态待核验' : '当前赔率状态待核验';
  }
}
