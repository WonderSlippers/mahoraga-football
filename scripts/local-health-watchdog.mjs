import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recoveryDue, recordOccupiedHttpFailure } from './local-health-policy.mjs';

// Local-only: never targets a remote site, a port-owning process, or the D1 ledger.
const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.join(root, '.sites-runtime');
const stateFile = path.join(runtime, 'local-health-state.json');
const logFile = path.join(runtime, 'local-health.log');
const taskName = 'Edge Football Local 5173';
const port = 5173;
const now = Date.now();
mkdirSync(runtime, { recursive: true });

function log(message) {
  if (existsSync(logFile) && statSync(logFile).size > 1024 * 1024)
    renameSync(logFile, path.join(runtime, 'local-health.previous.log'));
  appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
}
function readState() {
  try { return JSON.parse(readFileSync(stateFile, 'utf8')); }
  catch { return { failures: 0, firstDownAt: 0, lastRestartAt: 0 }; }
}
function saveState(state) { writeFileSync(stateFile, JSON.stringify(state)); }
function portOpen() {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(3000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}
async function healthy() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(5000) });
      await response.body?.cancel();
      if (response.status === 200) return true;
    } catch { /* Recheck once before declaring this poll unhealthy. */ }
  }
  return false;
}
function task(command) {
  return spawnSync('schtasks.exe', [command, '/TN', taskName], { encoding: 'utf8', timeout: 15000, windowsHide: true });
}

const state = readState();
if (await healthy()) {
  if (state.failures) log(`RECOVERED after ${state.failures} failed checks`);
  if (state.httpFailedSince) log(`HTTP_RECOVERED after ${Math.round((now - state.httpFailedSince) / 1000)}s`);
  saveState({ ...state, failures: 0, firstDownAt: 0, httpFailedSince: 0, lastHttpFailureLogAt: 0 });
  process.exit(0);
}
if (await portOpen()) {
  // A listener may belong to the user or another task; never take it over.
  const failure=recordOccupiedHttpFailure(state,now);
  if (failure.shouldLog) log(`HTTP_FAILED for ${Math.round(failure.durationMs / 1000)}s; port 5173 occupied; no process touched`);
  saveState(failure.state);
  process.exit(1);
}
state.failures = (state.failures || 0) + 1;
state.firstDownAt ||= now;
saveState(state);
if (!recoveryDue(state, now)) {
  if (state.failures === 1) log('PORT_MISSING first check; waiting for confirmation');
  process.exit(1);
}

// Recheck immediately before touching our exact scheduled task.
if (await portOpen()) { log('PORT_RETURNED before recovery; no process touched'); process.exit(0); }
const ended = task('/End'); // May report "not running"; that is safe.
let started = task('/Run');
if (started.status !== 0) {
  await new Promise(resolve => setTimeout(resolve, 2000));
  if (!(await portOpen())) started = task('/Run');
}
state.lastRestartAt = now;
state.failures = 0;
state.firstDownAt = 0;
saveState(state);
log(`TASK_RECOVERY end=${ended.status ?? 'error'} run=${started.status ?? 'error'} ${String(started.stderr || '').trim().slice(0, 240)}`);
process.exit(started.status === 0 ? 0 : 2);
