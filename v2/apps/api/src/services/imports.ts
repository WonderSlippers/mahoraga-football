import { canonical, sha } from "../../../../packages/contracts/index";
import {
  previewFiles,
  sourceManifest,
  reconcile,
  type ImportFile,
  type ArchiveRow,
} from "../../../../packages/imports/index";
import { evidenceChunks } from "../../../../packages/sources/index";
import { stmt, one, rows, atomic, uid } from "../repositories/db";
import type { Context } from "./commands";
export async function importPreview(
  c: Context,
  p: { namespace: string; files: ImportFile[] },
) {
  const parsed = await previewFiles(p.namespace, p.files);
  const old = await stmt(
    c.db,
    "SELECT * FROM import_batches WHERE namespace=? AND sourceHash=?",
    p.namespace,
    parsed.manifest.sourceHash,
  ).first<any>();
  if (old && old.state !== "STAGING") return batchReport(old);
  for (const row of parsed.rows) {
    if (row.disposition !== "ACCEPTED") continue;
    const prior = await stmt(
      c.db,
      "SELECT contentHash FROM archive_keys WHERE businessKey=?",
      row.businessKey,
    ).first<any>();
    if (prior) {
      row.disposition =
        prior.contentHash === row.contentHash ? "DUPLICATE" : "QUARANTINE";
      if (row.disposition === "QUARANTINE")
        row.warnings.push("SAME_KEY_DIFFERENT_CONTENT");
    }
  }
  parsed.report = reconcile(parsed.rows);
  parsed.previewHash = await sha(
    canonical({
      namespace: p.namespace,
      sourceHash: parsed.manifest.sourceHash,
      rows: parsed.rows,
      report: parsed.report,
      warnings: parsed.warnings,
      claims: parsed.claims,
    }),
  );
  if (old && old.previewHash !== parsed.previewHash)
    throw Error("IMPORT_STAGING_CHANGED");
  let id = old?.id || uid();
  // Stage in bounded batches, then publish a preview. STAGING is never an archive.
  if (!old) {
    try {
      await stmt(
        c.db,
        "INSERT INTO import_batches VALUES(?,?,?,?,'STAGING',?,NULL,?,?,?,?)",
        id,
        p.namespace,
        parsed.manifest.sourceHash,
        parsed.previewHash,
        c.now,
        canonical(parsed.manifest),
        canonical(parsed.report),
        canonical(parsed.warnings),
        canonical(parsed.claims),
      ).run();
    } catch (error) {
      const concurrent = await stmt(
        c.db,
        "SELECT * FROM import_batches WHERE namespace=? AND sourceHash=?",
        p.namespace,
        parsed.manifest.sourceHash,
      ).first<any>();
      if (!concurrent || concurrent.previewHash !== parsed.previewHash)
        throw error;
      id = concurrent.id;
      if (concurrent.state !== "STAGING") return batchReport(concurrent);
    }
  }
  const sorted = [...p.files].sort((a, b) => a.name.localeCompare(b.name));
  for (let f = 0; f < sorted.length; f++) {
    const chunks = evidenceChunks(new TextEncoder().encode(sorted[f].content));
    await atomic(
      c.db,
      chunks.map((chunk, i) =>
        stmt(
          c.db,
          "INSERT OR IGNORE INTO import_file_chunks VALUES(?,?,?,?)",
          id,
          f,
          i,
          chunk,
        ),
      ),
      c.failAt,
    );
  }
  for (let start = 0; start < parsed.rows.length; start += 100)
    await c.db.batch(
      parsed.rows
        .slice(start, start + 100)
        .map((r, i) =>
          stmt(
            c.db,
            "INSERT OR IGNORE INTO import_rows VALUES(?,?,?,?,?,?)",
            id,
            start + i,
            r.businessKey,
            r.contentHash,
            r.disposition,
            canonical(r),
          ),
        ),
    );
  await stmt(
    c.db,
    "UPDATE import_batches SET state='PREVIEW' WHERE id=? AND state='STAGING'",
    id,
  ).run();
  return batchReport(
    await one(c.db, "SELECT * FROM import_batches WHERE id=?", id),
  );
}
export function batchReport(b: any) {
  return {
    id: b.id,
    namespace: b.namespace,
    state: b.state,
    sourceHash: b.sourceHash,
    previewHash: b.previewHash,
    createdAt: b.createdAt,
    committedAt: b.committedAt,
    manifest: JSON.parse(b.manifestJson),
    report: JSON.parse(b.reportJson),
    warnings: JSON.parse(b.warningsJson),
    claims: JSON.parse(b.claimsJson),
  };
}
export async function importCommit(
  c: Context,
  p: { previewId: string; previewHash: string; files: ImportFile[] },
) {
  const b = await one(
    c.db,
    "SELECT * FROM import_batches WHERE id=?",
    p.previewId,
  );
  const manifest = await sourceManifest(p.files);
  if (b.sourceHash !== manifest.sourceHash)
    throw Error("IMPORT_SOURCE_CHANGED");
  if (b.previewHash !== p.previewHash) throw Error("IMPORT_PREVIEW_CHANGED");
  if (b.state === "COMMITTED") return batchReport(b);
  if (b.state !== "PREVIEW") throw Error("IMPORT_NOT_READY");
  const staged = await rows(
    c.db,
    "SELECT * FROM import_rows WHERE batchId=? ORDER BY rowNo",
    b.id,
  );
  const facts = staged
    .filter((x) => x.disposition === "ACCEPTED")
    .map((x) => JSON.parse(x.rowJson) as ArchiveRow);
  const list = [
    stmt(
      c.db,
      `INSERT INTO import_commits SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM import_batches WHERE id=? AND state='PREVIEW') AND NOT EXISTS(SELECT 1 FROM import_rows r JOIN archive_keys k ON k.businessKey=r.businessKey WHERE r.batchId=? AND r.disposition='ACCEPTED' AND r.contentHash<>k.contentHash) THEN 1 ELSE 0 END`,
      b.id,
      b.id,
      b.id,
    ),
  ];
  for (const r of facts) {
    list.push(
      stmt(
        c.db,
        "INSERT OR IGNORE INTO archive_keys VALUES(?,?)",
        r.businessKey,
        r.contentHash,
      ),
    );
    list.push(
      stmt(
        c.db,
        "INSERT OR IGNORE INTO archive_records VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'LEGACY_IMPORT',?)",
        await sha(r.businessKey + r.contentHash),
        b.id,
        r.businessKey,
        r.portfolio,
        r.kind,
        r.originalId,
        r.contentHash,
        r.raw,
        r.stakeAtoms,
        r.pnlAtoms,
        r.legCount,
        r.status,
        r.currency,
        canonical(r.warnings),
      ),
    );
  }
  list.push(
    stmt(
      c.db,
      "UPDATE import_batches SET state='COMMITTED',committedAt=? WHERE id=? AND state='PREVIEW'",
      c.now,
      b.id,
    ),
  );
  try {
    await atomic(c.db, list, c.failAt);
  } catch (e) {
    const latest = await one(
      c.db,
      "SELECT * FROM import_batches WHERE id=?",
      b.id,
    );
    if (latest.state === "COMMITTED") return batchReport(latest);
    throw Error("IMPORT_COMMIT_CONFLICT");
  }
  return batchReport(
    await one(c.db, "SELECT * FROM import_batches WHERE id=?", b.id),
  );
}
