export const stmt = (db: D1Database, sql: string, ...args: unknown[]) =>
  db.prepare(sql).bind(...args);
export async function one<T = Record<string, any>>(
  db: D1Database,
  sql: string,
  ...args: unknown[]
): Promise<T> {
  const row = await stmt(db, sql, ...args).first<T>();
  if (!row) throw new Error("NOT_FOUND");
  return row;
}
export async function rows(db: D1Database, sql: string, ...args: unknown[]) {
  return (await stmt(db, sql, ...args).all()).results as Record<string, any>[];
}
export const uid = () => crypto.randomUUID();
export async function atomic(
  db: D1Database,
  list: D1PreparedStatement[],
  failAt?: number,
) {
  if (failAt !== undefined)
    list.splice(
      failAt,
      0,
      db.prepare("INSERT INTO fault_guard(value) VALUES(0)"),
    );
  await db.batch(list);
}
