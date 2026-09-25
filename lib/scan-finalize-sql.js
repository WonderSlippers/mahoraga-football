// D1 rolls back a failed batch. A guard must throw, not simply return zero
// changes, before the ledger and progress statements can run.
export const FINALIZE_SCAN_GUARD_SQL = `SELECT CASE WHEN
  EXISTS (SELECT 1 FROM app_state WHERE key='scan_lock' AND json_extract(payload,'$.token')=?)
  AND EXISTS (SELECT 1 FROM app_state WHERE key='scan_progress_v1' AND updated_at=?
    AND json_extract(payload,'$.id')=? AND json_extract(payload,'$.stage')=?)
  AND EXISTS (SELECT 1 FROM app_state WHERE key='sim_state' AND updated_at=?)
  AND (SELECT MAX(updated_at) FROM app_state WHERE key IN ('sim_state','sim_settings'))=?
  THEN 1 ELSE json_extract('invalid-scan-commit-guard','$') END AS allowed`;

export const FINALIZE_SCAN_LEDGER_SQL = `UPDATE app_state SET payload=?,updated_at=?
  WHERE key='sim_state' AND updated_at=?
    AND (SELECT MAX(updated_at) FROM app_state WHERE key IN ('sim_state','sim_settings'))=?`;

export const FINALIZE_SCAN_PROGRESS_SQL = `UPDATE app_state SET payload=?,updated_at=?
  WHERE key='scan_progress_v1' AND updated_at=? AND json_extract(payload,'$.id')=?`;
