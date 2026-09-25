import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryDue, recordOccupiedHttpFailure } from '../scripts/local-health-policy.mjs';

test('watchdog waits for two absent-port checks and a 90-second startup grace', () => {
  const at = 1_000_000;
  assert.equal(recoveryDue({ failures: 1, firstDownAt: at - 120_000 }, at), false);
  assert.equal(recoveryDue({ failures: 2, firstDownAt: at - 89_999 }, at), false);
  assert.equal(recoveryDue({ failures: 2, firstDownAt: at - 90_000 }, at), true);
});

test('watchdog limits restarts to one per fifteen minutes', () => {
  const at = 2_000_000;
  assert.equal(recoveryDue({ failures: 2, firstDownAt: at - 120_000, lastRestartAt: at - 899_999 }, at), false);
  assert.equal(recoveryDue({ failures: 2, firstDownAt: at - 120_000, lastRestartAt: at - 900_000 }, at), true);
});

test('occupied unhealthy listener retains failure duration and logs again after 30 minutes', () => {
  const first=recordOccupiedHttpFailure({},1_000_000);
  assert.equal(first.shouldLog,true);
  const second=recordOccupiedHttpFailure(first.state,1_060_000);
  assert.equal(second.shouldLog,false);
  assert.equal(second.durationMs,60_000);
  const later=recordOccupiedHttpFailure(second.state,2_800_000);
  assert.equal(later.shouldLog,true);
  assert.equal(later.durationMs,1_800_000);
});
