import { env } from "cloudflare:workers";
import {FENCED_APP_STATE_UPDATE_SQL} from '@/lib/scan-progress-claim';

export type StoredLedger = {
  state: unknown;
  settings: unknown;
  updatedAt: number;
};

function database() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

export async function readLedger(): Promise<StoredLedger | null> {
  const rows = await database()
    .prepare("SELECT key, payload, updated_at FROM app_state WHERE key IN (?, ?)")
    .bind("sim_state", "sim_settings")
    .all<{ key: string; payload: string; updated_at: number }>();
  const values = new Map(rows.results.map((row) => [row.key, row]));
  const state = values.get("sim_state");
  const settings = values.get("sim_settings");
  if (!state && !settings) return null;
  return {
    state: state ? JSON.parse(state.payload) : null,
    settings: settings ? JSON.parse(settings.payload) : null,
    updatedAt: Math.max(state?.updated_at ?? 0, settings?.updated_at ?? 0),
  };
}

export async function writeLedger(value: StoredLedger) {
  const db = database();
  const sql = "INSERT INTO app_state (key, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at";
  await db.batch([
    db.prepare(sql).bind("sim_state", JSON.stringify(value.state), value.updatedAt),
    db.prepare(sql).bind("sim_settings", JSON.stringify(value.settings), value.updatedAt),
  ]);
}

export async function writeLedgerIfUnchanged(value: StoredLedger, expectedUpdatedAt: number) {
  const result = await database().prepare(
    "UPDATE app_state SET payload = CASE WHEN key = ? THEN ? ELSE ? END, updated_at = ? WHERE key IN (?, ?) AND (SELECT MAX(updated_at) FROM app_state WHERE key IN (?, ?)) = ?",
  ).bind(
    "sim_state", JSON.stringify(value.state), JSON.stringify(value.settings), value.updatedAt,
    "sim_state", "sim_settings", "sim_state", "sim_settings", expectedUpdatedAt,
  ).run();
  return Number(result.meta.changes) === 2;
}

export async function writeSimStateIfUnchanged(state: unknown, expectedUpdatedAt: number, nextUpdatedAt: number, leaseToken?:string) {
  const sql=leaseToken
    ? `${FENCED_APP_STATE_UPDATE_SQL} AND (SELECT MAX(updated_at) FROM app_state WHERE key IN (?, ?)) = ?`
    : "UPDATE app_state SET payload = ?, updated_at = ? WHERE key = ? AND updated_at = ? AND (SELECT MAX(updated_at) FROM app_state WHERE key IN (?, ?)) = ?";
  const values=[JSON.stringify(state),nextUpdatedAt,"sim_state",expectedUpdatedAt];
  if(leaseToken)values.push(leaseToken);
  values.push("sim_state","sim_settings",expectedUpdatedAt);
  const result = await database().prepare(sql).bind(...values).run();
  return Number(result.meta.changes) === 1;
}
