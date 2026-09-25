// A visible tab must not ask the local Workerd for every league on every
// refresh. Rotate a bounded set and reserve slots for the selected/nearby games.
export function planRotatingLeagueBatch(allCodes, cursor = 0, urgentCodes = [], limit = 8, urgentLimit = 2) {
  const codes = [...new Set(allCodes.filter(Boolean))];
  if (!codes.length) return { selected: [], nextCursor: 0 };
  const size = Math.max(1, Math.min(codes.length, Math.floor(limit) || 8));
  const urgentSize = Math.max(0, Math.min(size, Math.floor(urgentLimit) || 0));
  const allowed = new Set(codes);
  const selected = [];
  for (const code of urgentCodes) {
    if (selected.length >= urgentSize) break;
    if (allowed.has(code) && !selected.includes(code)) selected.push(code);
  }
  let position = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor % codes.length : 0;
  let visited = 0;
  while (selected.length < size && visited < codes.length) {
    const code = codes[position];
    position = (position + 1) % codes.length;
    visited++;
    if (!selected.includes(code)) selected.push(code);
  }
  return { selected, nextCursor: position };
}

export function shouldFetchLocalFeed({now,lastCheckedAt=0,important=false,siteAvailable=false}) {
  if(!siteAvailable)return true;
  if(!lastCheckedAt)return false;
  return now-lastCheckedAt>=(important?60000:20*60000);
}
