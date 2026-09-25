export function recoveryDue(state, now) {
  return Number(state.failures) >= 2
    && now - Number(state.firstDownAt || now) >= 90_000
    && now - Number(state.lastRestartAt || 0) >= 15 * 60_000;
}

export function recordOccupiedHttpFailure(state, now) {
  const first = Number(state.httpFailedSince) || now;
  const lastLog = Number(state.lastHttpFailureLogAt) || 0;
  const shouldLog = !lastLog || now - lastLog >= 30 * 60_000;
  return {
    shouldLog,
    durationMs: Math.max(0, now - first),
    state: { ...state, httpFailedSince: first, lastHttpFailureLogAt: shouldLog ? now : lastLog, failures: 0, firstDownAt: 0 },
  };
}
