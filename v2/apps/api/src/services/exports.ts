import { canonical, sha } from "../../../../packages/contracts/index";
import { stmt, one, rows, uid, atomic } from "../repositories/db";
import { receipt, type Context } from "./commands";

// Every exported relation is immutable. High-water rowids fix the entire sample
// in the same D1 transaction as the receipt, before any page is generated.
export const exportTables = [
  "source_snapshots",
  "source_chunks",
  "fixture_revisions",
  "market_definitions",
  "quote_sets",
  "quote_selections",
  "input_bundles",
  "model_manifests",
  "feature_snapshots",
  "predictions",
  "market_expectations",
  "decisions",
  "tickets",
  "ticket_legs",
  "result_observations",
  "result_adjudications",
  "settlement_events",
  "ledger_entries",
] as const;
export async function createExport(c: Context, key: string) {
  const receiptInfo = await receipt(c, "export", key, {});
  if (receiptInfo.old) return { id: receiptInfo.old.resultRef };
  const id = uid();
  const marks = exportTables
    .map((t) => `'${t}',COALESCE((SELECT MAX(rowid) FROM ${t}),0)`)
    .join(",");
  try {
    await atomic(
      c.db,
      [
        stmt(
          c.db,
          "INSERT INTO command_receipts VALUES(?,?,?,?,1,?,?)",
          uid(),
          receiptInfo.scope,
          key,
          receiptInfo.hash,
          id,
          c.now,
        ),
        stmt(
          c.db,
          `INSERT INTO export_jobs(id,mode,createdAt,state,manifestJson,chainHash) SELECT ?,mode,?,'QUEUED',json_object('format','MAHORAGA_FROZEN_JSONL_V1','installationId',id,'mode',mode,'asOf',?,'highWater',json_object(${marks})) ,? FROM installations WHERE id=?`,
          id,
          c.now,
          c.now,
          await sha(""),
          c.installationId,
        ),
      ],
      c.failAt,
    );
  } catch (error) {
    const replay = await receipt(c, "export", key, {});
    if (replay.old) return { id: replay.old.resultRef };
    throw error;
  }
  return { id };
}
export async function stepExport(c: Context) {
  const job = await stmt(
    c.db,
    "SELECT * FROM export_jobs WHERE state IN('QUEUED','RUNNING') ORDER BY createdAt,id LIMIT 1",
  ).first<any>();
  if (!job) return { active: false };
  const manifest = JSON.parse(job.manifestJson),
    table = exportTables[job.tableIndex];
  const page = await rows(
    c.db,
    `SELECT rowid __rowid,* FROM ${table} WHERE rowid>? AND rowid<=? ORDER BY rowid LIMIT 64`,
    job.cursor,
    manifest.highWater[table],
  );
  const texts: string[] = [];
  let text = "",
    cursor = job.cursor;
  for (const row of page) {
    const { __rowid, ...data } = row;
    cursor = __rowid;
    const line = canonical({ table, mode: job.mode, data }) + "\n";
    if (new TextEncoder().encode(line).byteLength > 2097152)
      throw Error("EXPORT_ROW_LIMIT");
    if (text && new TextEncoder().encode(text + line).byteLength > 65536) {
      texts.push(text);
      text = "";
    }
    text += line;
  }
  if (text) texts.push(text);
  let chain = job.chainHash;
  const writes: D1PreparedStatement[] = [];
  for (let i = 0; i < texts.length; i++) {
    const digest = await sha(texts[i]);
    chain = await sha(chain + digest);
    writes.push(
      stmt(
        c.db,
        "INSERT INTO export_chunks VALUES(?,?,?,?)",
        job.id,
        job.nextChunk + i,
        texts[i],
        digest,
      ),
    );
  }
  const finished = page.length < 64 || cursor >= manifest.highWater[table];
  const nextTable = job.tableIndex + (finished ? 1 : 0),
    state = nextTable === exportTables.length ? "COMPLETE" : "RUNNING";
  try {
    await atomic(
      c.db,
      [
        stmt(
          c.db,
          "INSERT INTO command_receipts VALUES(?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM export_jobs WHERE id=? AND revision=? AND state IN('QUEUED','RUNNING')) THEN 1 ELSE 0 END,?,?)",
          uid(),
          c.installationId + ":export-step",
          job.id + ":" + job.revision,
          await sha(canonical({ cursor: job.cursor, table: job.tableIndex })),
          job.id,
          job.revision,
          job.id,
          c.now,
        ),
        ...writes,
        stmt(
          c.db,
          "UPDATE export_jobs SET state=?,tableIndex=?,cursor=?,nextChunk=?,rowsExported=rowsExported+?,chainHash=?,revision=revision+1 WHERE id=?",
          state,
          nextTable,
          finished ? 0 : cursor,
          job.nextChunk + texts.length,
          page.length,
          chain,
          job.id,
        ),
      ],
      c.failAt,
    );
  } catch (error) {
    const current = await one(
      c.db,
      "SELECT revision FROM export_jobs WHERE id=?",
      job.id,
    );
    if (current.revision === job.revision) throw error;
  }
  return { active: true, id: job.id, state };
}
export async function downloadExport(db: D1Database, id: string) {
  const job = await one(db, "SELECT * FROM export_jobs WHERE id=?", id);
  if (job.state !== "COMPLETE") throw Error("EXPORT_NOT_COMPLETE");
  let ordinal = -1;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (ordinal === -1) {
          ordinal = 0;
          controller.enqueue(
            encoder.encode(
              canonical({
                manifest: JSON.parse(job.manifestJson),
                rows: job.rowsExported,
                chunks: job.nextChunk,
                chainHash: job.chainHash,
              }) + "\n",
            ),
          );
          return;
        }
        if (ordinal >= job.nextChunk) {
          controller.close();
          return;
        }
        const chunk = await one(
          db,
          "SELECT content,sha256 FROM export_chunks WHERE jobId=? AND ordinal=?",
          id,
          ordinal++,
        );
        if ((await sha(chunk.content)) !== chunk.sha256)
          throw Error("EXPORT_HASH_MISMATCH");
        controller.enqueue(encoder.encode(chunk.content));
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="mahoraga-${job.mode}-${id}.jsonl"`,
      "Cache-Control": "no-store",
    },
  });
}
