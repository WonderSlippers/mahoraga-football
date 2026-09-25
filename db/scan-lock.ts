import { env } from "cloudflare:workers";

const LOCK_KEY = "scan_lock";
// The scheduled task may be slower than one five-minute interval even with
// bounded league batches. Keep a second writer from re-entering mid-scan.
const LEASE_MS = 12 * 60 * 1000;

function database() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

export async function acquireScanLease() {
  const token = crypto.randomUUID();
  const now = Date.now();
  const payload = JSON.stringify({ token, acquiredAt: now });
  const result = await database().prepare(
    "INSERT INTO app_state (key,payload,updated_at) VALUES (?,?,?) " +
    "ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at " +
    "WHERE app_state.updated_at < ?",
  ).bind(LOCK_KEY, payload, now, now - LEASE_MS).run();
  return Number(result.meta.changes) === 1 ? token : null;
}

export async function releaseScanLease(token: string) {
  const result = await database().prepare(
    "DELETE FROM app_state WHERE key=? AND json_extract(payload,'$.token')=?",
  ).bind(LOCK_KEY, token).run();
  return Number(result.meta.changes) === 1;
}
