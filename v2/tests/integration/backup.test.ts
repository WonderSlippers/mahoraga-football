import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
// @ts-ignore paged implementation
import { exportPaged, restorePaged } from "../../scripts/paged-backup.mjs";
// @ts-ignore local runtime
import { engine, migrate } from "../../scripts/runtime-lib.mjs";
// @ts-ignore local backup
import { snapshot, restore } from "../../scripts/backup-lib.mjs";
// @ts-ignore local build
import { workerBuild } from "../../scripts/build.mjs";
import { observe } from "../../apps/api/src/services/observations";
test("A70 consistent D1 export restores to empty identity; rejects altered evidence and nonempty destination", async () => {
  await workerBuild();
  const cfg = {
    installationId: crypto.randomUUID(),
    mode: "DEMO",
    webOrigin: "http://127.0.0.1:5273",
    bootstrap: "x",
    serviceToken: "x",
    appCodeSha: "test",
  };
  const dest = { ...cfg, installationId: crypto.randomUUID() };
  const source = engine(cfg, ".runtime-v2/backup-test", {
      port: 0,
      persist: false,
    }),
    target = engine(dest, ".runtime-v2/restore-test", {
      port: 0,
      persist: false,
    });
  try {
    const a = await source.getD1Database("DB"),
      b = await target.getD1Database("DB");
    await migrate(a, cfg);
    await migrate(b, dest, { schemaOnly: true });
    await observe(
      { db: a, installationId: cfg.installationId, now: Date.now() },
      "backup",
    );
    const backup = await snapshot(a);
    const corrupt = structuredClone(backup);
    corrupt.data.fixtures[0].home = "tampered";
    await assert.rejects(restore(b, corrupt, dest), /BACKUP_HASH_MISMATCH/);
    const result = await restore(b, backup, dest);
    assert.equal(result.hashesMatch, true);
    assert.notEqual(result.sourceInstallationId, result.targetInstallationId);
    await assert.rejects(restore(b, backup, dest), /RESTORE_REQUIRES_EMPTY/);
  } finally {
    await source.dispose();
    await target.dispose();
  }
});
test("A70 bounded paged backup crosses multiple SQL pages and verifies restored rows", async () => {
  await workerBuild();
  const id = crypto.randomUUID(),
    dir = path.resolve(".runtime-v2/paged-test-" + id);
  fs.mkdirSync(dir);
  const cfg = {
      installationId: id,
      mode: "DEMO",
      webOrigin: "http://127.0.0.1:5273",
      bootstrap: "x",
      serviceToken: "x",
      appCodeSha: "test",
    },
    dest = { ...cfg, installationId: crypto.randomUUID() };
  const source = engine(cfg, dir, { port: 0, persist: false }),
    target = engine(dest, dir, { port: 0, persist: false });
  try {
    const a = await source.getD1Database("DB"),
      b = await target.getD1Database("DB");
    await migrate(a, cfg);
    await migrate(b, dest, { schemaOnly: true });
    await observe({ db: a, installationId: id, now: Date.now() }, "seed");
    const q = await a.prepare("SELECT * FROM quote_sets LIMIT 1").first();
    await a
      .prepare(
        "WITH RECURSIVE s(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM s WHERE n<300) INSERT INTO quote_sets SELECT 'p-'||n,?,?,?,?+n,NULL,'PREMATCH_OBSERVED',0,'TEST' FROM s",
      )
      .bind(q.marketId, q.sourceSnapshotId, q.providerId, q.observedAt)
      .run();
    await a.prepare("UPDATE installations SET schemaVersion=7").run();
    const backup = await exportPaged(a, path.join(dir, "snapshot"));
    assert.equal(backup.tables.quote_sets.rows, 301);
    for (const table of [
      "workspace_imports",
      "fixture_catalog",
      "automation_state",
    ])
      delete backup.tables[table];
    fs.writeFileSync(
      path.join(dir, "snapshot", "manifest.json"),
      JSON.stringify(backup),
    );
    const restored = await restorePaged(b, path.join(dir, "snapshot"), dest);
    assert.equal(restored.hashesMatch, true);
    assert.equal(
      (await b.prepare("SELECT schemaVersion FROM installations").first())
        .schemaVersion,
      8,
    );
    assert.equal(
      (await b.prepare("SELECT COUNT(*) n FROM fixture_catalog").first()).n,
      0,
    );
    assert.equal(
      (await b.prepare("SELECT COUNT(*) n FROM quote_sets").first()).n,
      301,
    );
  } finally {
    await source.dispose();
    await target.dispose();
  }
});
