const stages = ['prepared','lab','featured','observations','quotes','results','odds','ledger','complete'];

export function advanceScanProgress(current, stage, error = '') {
  if (!current || !stages.includes(stage)) throw new Error('invalid scan stage');
  const previous = stages.indexOf(current.stage);
  const next = stages.indexOf(stage);
  if (next < previous || (next > previous + 1 && stage !== 'complete')) throw new Error('scan stage out of order');
  const errors = error ? [...current.errors, `${stage}: ${String(error).slice(0, 200)}`] : current.errors;
  return { ...current, stage, status: stage === 'complete' ? errors.length ? 'partial' : 'complete' : errors.length ? 'partial' : 'running', errors };
}
