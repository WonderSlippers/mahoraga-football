// The initial progress claim must be one SQLite statement. Two workers may
// read the same old progress row before either writes; only one may replace it.
export const CLAIM_SCAN_PROGRESS_SQL = `INSERT INTO app_state (key,payload,updated_at)
  SELECT ?,?,? WHERE EXISTS (
    SELECT 1 FROM app_state AS lease
    WHERE lease.key='scan_lock' AND json_extract(lease.payload,'$.token')=?
  )
  ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at
  WHERE app_state.updated_at=? AND (
    COALESCE(json_extract(app_state.payload,'$.status'),'')!='running'
    OR CAST(json_extract(app_state.payload,'$.updatedAt') AS INTEGER)<=?
    OR EXISTS (SELECT 1 FROM app_state AS new_lease WHERE new_lease.key='scan_lock'
      AND json_extract(new_lease.payload,'$.token')=?
      AND CAST(json_extract(new_lease.payload,'$.acquiredAt') AS INTEGER)>app_state.updated_at)
  )`;
// The lease check belongs in the same SQL statement as the progress CAS.
// Checking it in JavaScript first would allow a stale worker to claim after
// another scan takes over the expired lease.
export const ADVANCE_SCAN_PROGRESS_SQL = `UPDATE app_state SET payload=?,updated_at=?
  WHERE key=? AND updated_at=? AND EXISTS (
    SELECT 1 FROM app_state AS lease
    WHERE lease.key='scan_lock' AND json_extract(lease.payload,'$.token')=?
  )`;
export const FENCED_APP_STATE_INSERT_SQL = `INSERT INTO app_state (key,payload,updated_at)
  SELECT ?,?,? WHERE EXISTS (
    SELECT 1 FROM app_state AS lease
    WHERE lease.key='scan_lock' AND json_extract(lease.payload,'$.token')=?
  ) ON CONFLICT(key) DO NOTHING`;
export const FENCED_APP_STATE_UPDATE_SQL = `UPDATE app_state SET payload=?,updated_at=?
  WHERE key=? AND updated_at=? AND EXISTS (
    SELECT 1 FROM app_state AS lease
    WHERE lease.key='scan_lock' AND json_extract(lease.payload,'$.token')=?
  )`;
export const nextScanRevision=(now,previous=0)=>Math.max(now,previous+1);
