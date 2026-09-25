// Old open tabs still request every league on each refresh after a new build
// is activated. Bound their same-origin feed work until the tab is reloaded.
// The current client opts into its own tested eight-league rotation.
export function createLegacyFeedBudget(allPerMinute = 4, livePerMinute = 8, windowMs = 60_000) {
  let windowStart = 0;
  let allCount = 0;
  let liveCount = 0;
  return (mode: string, now = Date.now()) => {
    if (!Number.isFinite(now)) return false;
    if (!windowStart || now < windowStart || now - windowStart >= windowMs) {
      windowStart = now;
      allCount = 0;
      liveCount = 0;
    }
    if (mode === 'live') {
      if (liveCount >= livePerMinute) return false;
      liveCount++;
    } else {
      if (allCount >= allPerMinute) return false;
      allCount++;
    }
    return true;
  };
}
