import crypto from "node:crypto";
export const tables = [
  "installations",
  "fixtures",
  "source_snapshots",
  "source_chunks",
  "fixture_revisions",
  "market_definitions",
  "quote_sets",
  "quote_selections",
  "observation_slots",
  "input_bundles",
  "model_manifests",
  "feature_snapshots",
  "predictions",
  "market_expectations",
  "decisions",
  "portfolios",
  "command_receipts",
  "tickets",
  "ticket_legs",
  "ticket_state",
  "result_observations",
  "result_adjudications",
  "settlement_events",
  "ledger_entries",
  "jobs",
  "source_runs",
  "fixture_sources",
  "normalization_receipts",
  "import_batches",
  "import_file_chunks",
  "import_rows",
  "archive_keys",
  "import_commits",
  "archive_records",
  "model_registry_events",
  "reported_trade_events",
  "evaluation_runs",
  "evaluation_samples",
  "export_jobs",
  "export_chunks",
  "workspace_imports",
  "fixture_catalog",
  "automation_state",
];
const hash = (x) =>
  crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex");
// One real D1 batch = one transaction. Upper bounds make this supported small-v2
// snapshot path explicit; larger installations require a paged snapshot service.
export async function snapshot(db) {
  const captureStart = new Date().toISOString();
  const counts = await db.batch(
    tables.map((t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`)),
  );
  if (counts.some((x) => x.results[0].n > 10000))
    throw Error("BACKUP_CAPACITY_EXCEEDED");
  const result = await db.batch(
    tables.map((t) =>
      db.prepare(`SELECT * FROM ${t} ORDER BY rowid LIMIT 10001`),
    ),
  );
  if (result.some((x) => x.results.length > 10000))
    throw Error("BACKUP_CAPACITY_EXCEEDED");
  const data = Object.fromEntries(tables.map((t, i) => [t, result[i].results]));
  const manifest = Object.fromEntries(
    tables.map((t) => [t, { rows: data[t].length, sha256: hash(data[t]) }]),
  );
  return {
    format: "MAHORAGA_V2_CONSISTENT_SNAPSHOT_V1",
    captureStart,
    captureEnd: new Date().toISOString(),
    method: "D1_TRANSACTIONAL_BATCH",
    sourceInstallation: data.installations[0],
    manifest,
    data,
  };
}
export async function restore(db, backup, installation) {
  backup = structuredClone(backup);
  const missing =
    backup.sourceInstallation?.schemaVersion === 3
      ? [
          "model_registry_events",
          "reported_trade_events",
          "evaluation_runs",
          "evaluation_samples",
          "export_jobs",
          "export_chunks",
        ]
      : backup.sourceInstallation?.schemaVersion <= 6
        ? ["export_jobs", "export_chunks"]
        : [];
  for (const t of missing) {
    backup.data[t] = [];
    backup.manifest[t] = { rows: 0, sha256: hash([]) };
  }
  if (backup.sourceInstallation?.schemaVersion <= 7)
    for (const t of [
      "workspace_imports",
      "fixture_catalog",
      "automation_state",
    ]) {
      backup.data[t] = [];
      backup.manifest[t] = { rows: 0, sha256: hash([]) };
    }
  if (
    backup.format !== "MAHORAGA_V2_CONSISTENT_SNAPSHOT_V1" ||
    Object.keys(backup.data).sort().join() !== [...tables].sort().join()
  )
    throw Error("BACKUP_FORMAT_INVALID");
  if (backup.sourceInstallation?.mode !== installation.mode)
    throw Error("BACKUP_MODE_MISMATCH");
  for (const table of tables) {
    if (
      !Array.isArray(backup.data[table]) ||
      backup.data[table].length !== backup.manifest[table]?.rows ||
      hash(backup.data[table]) !== backup.manifest[table]?.sha256
    )
      throw Error("BACKUP_HASH_MISMATCH");
    if ((await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n !== 0)
      throw Error("RESTORE_REQUIRES_EMPTY_DATABASE");
  }
  const statements = [];
  for (const table of tables) {
    const columns = (
      await db.prepare(`PRAGMA table_info(${table})`).all()
    ).results.map((x) => x.name);
    for (const original of backup.data[table]) {
      if (Object.keys(original).sort().join() !== [...columns].sort().join())
        throw Error("BACKUP_SCHEMA_MISMATCH");
      const row =
        table === "installations"
          ? { ...original, id: installation.installationId, schemaVersion: 8 }
          : original;
      statements.push(
        db
          .prepare(
            `INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
          )
          .bind(...columns.map((k) => row[k])),
      );
    }
  }
  await db.batch(statements);
  const after = await snapshot(db);
  for (const table of tables.filter((t) => t !== "installations"))
    if (after.manifest[table].sha256 !== backup.manifest[table].sha256)
      throw Error("RESTORE_VERIFICATION_FAILED");
  return {
    restored: true,
    sourceInstallationId: backup.sourceInstallation.id,
    targetInstallationId: installation.installationId,
    tables: tables.length,
    rows: tables.reduce((n, t) => n + after.manifest[t].rows, 0),
    hashesMatch: true,
  };
}
