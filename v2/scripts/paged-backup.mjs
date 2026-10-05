// Offline-only, bounded-memory backup/restore. The caller must stop its own V2 writer.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { tables } from "./backup-lib.mjs";
const hashFile = async (file) => {
  const h = crypto.createHash("sha256");
  for await (const bytes of fs.createReadStream(file)) h.update(bytes);
  return h.digest("hex");
};
async function* tablePages(db, table) {
  const h = crypto.createHash("sha256");
  let cursor = 0,
    count = 0;
  while (true) {
    const result = await db
      .prepare(
        `SELECT rowid AS __backupRowId,* FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT 128`,
      )
      .bind(cursor)
      .all();
    if (!result.results.length) break;
    const lines = [];
    for (const resultRow of result.results) {
      const { __backupRowId, ...row } = resultRow;
      cursor = __backupRowId;
      count++;
      const text = JSON.stringify(row) + "\n";
      h.update(text);
      lines.push(text);
    }
    yield { lines };
  }
  return { rows: count, sha256: h.digest("hex") };
}
// Manual iterator so the generator's final hash/count stays available.
async function visit(db, table, consume) {
  const iterator = tablePages(db, table);
  while (true) {
    const x = await iterator.next();
    if (x.done) return x.value;
    await consume(x.value.lines);
  }
}
export async function exportPaged(db, dir) {
  fs.mkdirSync(dir, { recursive: false });
  const metadata = {
    format: "MAHORAGA_OFFLINE_PAGED_BACKUP_V1",
    method: "OWN_V2_WRITER_STOPPED",
    captureStart: new Date().toISOString(),
    tables: {},
    sourceInstallation: await db.prepare("SELECT * FROM installations").first(),
  };
  for (const table of tables) {
    const file = path.join(dir, table + ".jsonl"),
      fd = fs.openSync(file, "wx");
    try {
      metadata.tables[table] = await visit(db, table, async (lines) => {
        for (const line of lines) fs.writeSync(fd, line, null, "utf8");
      });
    } finally {
      fs.closeSync(fd);
    }
  }
  metadata.captureEnd = new Date().toISOString();
  metadata.state = "COMPLETE";
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(metadata, null, 2),
    { flag: "wx" },
  );
  return metadata;
}
async function* rowsFrom(file) {
  let pending = Buffer.alloc(0);
  for await (const chunk of fs.createReadStream(file, {
    highWaterMark: 65536,
  })) {
    pending = Buffer.concat([pending, chunk]);
    let end;
    while ((end = pending.indexOf(10)) >= 0) {
      if (end > 2097152) throw Error("BACKUP_ROW_LIMIT");
      const line = pending.subarray(0, end);
      pending = pending.subarray(end + 1);
      if (line.length)
        yield JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(line),
        );
    }
    if (pending.length > 2097152) throw Error("BACKUP_ROW_LIMIT");
  }
  if (pending.length) throw Error("BACKUP_TRUNCATED");
}
export async function restorePaged(db, dir, identity) {
  const metadata = JSON.parse(
    fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
  );
  const missingWorkspace =
    metadata.sourceInstallation?.schemaVersion === 7
      ? ["workspace_imports", "fixture_catalog", "automation_state"]
      : [];
  const missingNew = [
    ...(metadata.sourceInstallation?.schemaVersion < 9
      ? ["comparison_methods", "comparison_features", "comparison_observations"]
      : []),
    ...(metadata.sourceInstallation?.schemaVersion < 11
      ? ["universal_observations", "paper_policies"]
      : []),
  ].filter((t) => !metadata.tables[t]);
  const expectedTables = tables.filter(
    (t) => ![...missingWorkspace, ...missingNew].includes(t),
  );
  if (
    metadata.format !== "MAHORAGA_OFFLINE_PAGED_BACKUP_V1" ||
    metadata.state !== "COMPLETE" ||
    metadata.sourceInstallation.mode !== identity.mode ||
    Object.keys(metadata.tables).sort().join() !==
      [...expectedTables].sort().join()
  )
    throw Error("BACKUP_FORMAT_INVALID");
  for (const table of [...missingWorkspace, ...missingNew])
    if ((await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n)
      throw Error("RESTORE_REQUIRES_EMPTY_DATABASE");
  for (const table of expectedTables) {
    const file = path.join(dir, table + ".jsonl");
    if (
      fs.realpathSync(file) !== path.resolve(file) ||
      (await hashFile(file)) !== metadata.tables[table].sha256
    )
      throw Error("BACKUP_HASH_MISMATCH");
    if ((await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n)
      throw Error("RESTORE_REQUIRES_EMPTY_DATABASE");
  }
  for (const table of expectedTables) {
    const columns = (
      await db.prepare(`PRAGMA table_info(${table})`).all()
    ).results.map((x) => x.name);
    let batch = [],
      count = 0;
    for await (const original of rowsFrom(path.join(dir, table + ".jsonl"))) {
      if (Object.keys(original).sort().join() !== [...columns].sort().join())
        throw Error("BACKUP_SCHEMA_MISMATCH");
      const row =
        table === "installations"
          ? { ...original, id: identity.installationId, schemaVersion: 12 }
          : original;
      batch.push(
        db
          .prepare(
            `INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
          )
          .bind(...columns.map((k) => row[k])),
      );
      count++;
      if (batch.length === 128) {
        await db.batch(batch);
        batch = [];
      }
    }
    if (batch.length) await db.batch(batch);
    if (count !== metadata.tables[table].rows)
      throw Error("BACKUP_COUNT_MISMATCH");
  }
  return verifyPaged(db, metadata);
}
export async function verifyPaged(db, metadata) {
  const missingWorkspace =
    metadata.sourceInstallation?.schemaVersion === 7
      ? ["workspace_imports", "fixture_catalog", "automation_state"]
      : [];
  const missingNew = [
    ...(metadata.sourceInstallation?.schemaVersion < 9
      ? ["comparison_methods", "comparison_features", "comparison_observations"]
      : []),
    ...(metadata.sourceInstallation?.schemaVersion < 11
      ? ["universal_observations", "paper_policies"]
      : []),
  ];
  let rows = 0;
  for (const table of tables) {
    const actual = await visit(db, table, async () => {});
    rows += actual.rows;
    if (
      !metadata.tables[table] &&
      [...missingWorkspace, ...missingNew].includes(table)
    ) {
      if (actual.rows !== 0) throw Error("RESTORE_HASH_MISMATCH");
      continue;
    }
    if (
      actual.rows !== metadata.tables[table].rows ||
      (table !== "installations" &&
        actual.sha256 !== metadata.tables[table].sha256)
    )
      throw Error("RESTORE_HASH_MISMATCH");
  }
  return { hashesMatch: true, tables: tables.length, rows };
}
