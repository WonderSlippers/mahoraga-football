import { canonical, sha } from '../../../../packages/contracts/index';
import { sourceUrl, normalizeOpenLiga, boundedBody, evidenceChunks } from '../../../../packages/sources/index';
import { one, rows, stmt, uid, atomic } from '../repositories/db';
import type { Context } from './commands';

export async function normalizeSnapshot(c: Context, snapshotId: string, season: number) {
  const existing = await stmt(c.db, 'SELECT * FROM normalization_receipts WHERE snapshotId=?', snapshotId).first();
  if (existing) return existing;
  const snapshot = await one(c.db, 'SELECT * FROM source_snapshots WHERE id=?', snapshotId);
  if (snapshot.mode !== 'LOCAL_RESEARCH' || snapshot.providerId !== 'OPENLIGADB_V1' || snapshot.contentState !== 'COMPLETE') throw Error('SOURCE_NOT_READY');
  const chunks = await rows(c.db, 'SELECT content FROM source_chunks WHERE snapshotId=? ORDER BY chunkNo', snapshotId);
  const text = chunks.map(x => x.content).join('');
  if (await sha(text) !== snapshot.payloadHash) throw Error('SOURCE_HASH_MISMATCH');
  const fixtures = normalizeOpenLiga(JSON.parse(text.replace(/^\uFEFF/, '')), season);
  const queries: D1PreparedStatement[] = [];
  for (const f of fixtures) {
    const current = await stmt(c.db, 'SELECT f.*,r.id revisionId,r.kickoffAt FROM fixtures f JOIN fixture_revisions r ON r.fixtureId=f.id AND r.revision=f.currentRevision WHERE f.id=?', f.id).first<any>();
    if (current && (current.home !== f.home || current.away !== f.away)) throw Error('SOURCE_IDENTITY_REVIEW');
    let revisionId = current?.revisionId;
    if (!current) {
      revisionId = uid();
      queries.push(stmt(c.db, 'INSERT INTO fixtures VALUES(?,?,?,1,?)', f.id, f.home, f.away, f.status));
      queries.push(stmt(c.db, 'INSERT INTO fixture_sources VALUES(?,?,?,?,?,?)', f.id, 'OPENLIGADB_V1', 'ger.1', season, f.homeId, f.awayId));
      queries.push(stmt(c.db, 'INSERT INTO fixture_revisions VALUES(?,?,1,?,?,?)', revisionId, f.id, f.kickoffAt, snapshot.observedAt, snapshotId));
    } else if (current.kickoffAt !== f.kickoffAt) {
      revisionId = uid();
      queries.push(stmt(c.db, 'INSERT INTO fixture_revisions VALUES(?,?,?,?,?,?)', revisionId, f.id, current.currentRevision + 1, f.kickoffAt, snapshot.observedAt, snapshotId));
      queries.push(stmt(c.db, 'UPDATE fixtures SET currentRevision=currentRevision+1 WHERE id=?', f.id));
      queries.push(stmt(c.db, "UPDATE observation_slots SET state='SUPERSEDED',reason='KICKOFF_CHANGED' WHERE fixtureRevisionId=? AND state IN('PLANNED','MISSED')", current.revisionId));
    }
    queries.push(stmt(c.db, 'UPDATE fixtures SET status=? WHERE id=?', f.status, f.id));
    const scheduled = f.kickoffAt - 3600000, deadline = scheduled + 300000;
    queries.push(stmt(c.db, "INSERT OR IGNORE INTO observation_slots VALUES(?,?,'T_MINUS_60_V1',?,?,?,?)",
      `${revisionId}:T60`, revisionId, scheduled, deadline,
      deadline < c.now ? 'MISSED' : f.status === 'FINISHED' ? 'MISSED' : 'PLANNED',
      deadline < c.now ? 'SLOT_MISSED' : 'QUOTE_MISSING'));
    if (f.status === 'FINISHED') queries.push(stmt(c.db, 'INSERT INTO result_observations VALUES(?,?,?,?,?,?)', uid(), f.id, snapshotId,
      f.regulation ? canonical(f.regulation) : null, f.resultReason || 'FINISHED', snapshot.observedAt));
  }
  queries.push(stmt(c.db, 'INSERT INTO normalization_receipts VALUES(?,?,?)', snapshotId, fixtures.length, c.now));
  await atomic(c.db, queries, c.failAt);
  return { snapshotId, fixtureCount: fixtures.length, normalizedAt: c.now };
}

export async function captureSource(c: Context, key: string, season: number, fetcher: typeof fetch = fetch) {
  const installation = await one(c.db, 'SELECT mode FROM installations WHERE id=?', c.installationId);
  if (installation.mode !== 'LOCAL_RESEARCH') throw Error('NETWORK_DISABLED');
  if (!/^[\w-]{1,100}$/.test(key)) throw Error('INVALID_IDEMPOTENCY_KEY');
  const url = sourceUrl('OPENLIGADB_V1', 'ger.1', season);
  const prior = await stmt(c.db, 'SELECT * FROM source_runs WHERE id=?', key).first<any>();
  if (prior) {
    if (prior.season !== season) throw Error('IDEMPOTENCY_CONFLICT');
    return prior;
  }
  const recent = await stmt(c.db, 'SELECT nextAttemptAt FROM source_runs ORDER BY startedAt DESC LIMIT 1').first<any>();
  if (recent?.nextAttemptAt > c.now) throw Error('SOURCE_BACKOFF');
  const owner = uid();
  const lock = await stmt(c.db, 'INSERT INTO source_leases VALUES(?,?,?) ON CONFLICT(providerId) DO UPDATE SET owner=excluded.owner,leaseUntil=excluded.leaseUntil WHERE source_leases.leaseUntil<?', 'OPENLIGADB_V1', owner, c.now + 120000, c.now).run();
  if (lock.meta.changes !== 1) throw Error('SOURCE_BUSY');
  let snapshotId: string | null = null;
  try {
    await stmt(c.db, "INSERT INTO source_runs VALUES(?,'OPENLIGADB_V1','ger.1',?,?,?,NULL,'CAPTURING',NULL,NULL,0,?)", key, season, url, c.now, c.now + 60000).run();
    const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(25000), headers: { Accept: 'application/json' } });
    const bytes = await boundedBody(response);
    const observedAt = Date.now();
    const chunks = evidenceChunks(bytes);
    const text = chunks.join('');
    snapshotId = uid();
    const ingestedAt = Date.now();
    // Snapshot and all chunks become visible together; interrupted batches publish nothing.
    await atomic(c.db, [stmt(c.db, "INSERT INTO source_snapshots VALUES(?,'OPENLIGADB_V1',?,?,?,NULL,?,'LOCAL_RESEARCH','COMPLETE')",
      snapshotId, url, observedAt, ingestedAt, await sha(text)), ...chunks.map((part, index) => stmt(c.db, 'INSERT INTO source_chunks VALUES(?,?,?)', snapshotId, index, part))]);
    await stmt(c.db, 'UPDATE source_runs SET snapshotId=? WHERE id=?', snapshotId, key).run();
    const result = await normalizeSnapshot({ ...c, now: Date.now() }, snapshotId, season);
    await stmt(c.db, "UPDATE source_runs SET finishedAt=?,state='DEGRADED',reason='QUOTE_AND_XG_NOT_PROVIDED',normalizedCount=? WHERE id=?", Date.now(), (result as any).fixtureCount, key).run();
  } catch (e) {
    const raw = e instanceof Error ? e.message : '';
    const reason = /^[A-Z][A-Z0-9_]+$/.test(raw) ? raw : 'SOURCE_UNAVAILABLE';
    await stmt(c.db, "UPDATE source_runs SET finishedAt=?,state=?,reason=?,snapshotId=?,nextAttemptAt=? WHERE id=?", Date.now(), snapshotId ? 'NORMALIZATION_FAILED' : 'FAILED', reason, snapshotId, Date.now() + 60000, key).run();
  } finally {
    await stmt(c.db, 'DELETE FROM source_leases WHERE providerId=? AND owner=?', 'OPENLIGADB_V1', owner).run();
  }
  return one(c.db, 'SELECT * FROM source_runs WHERE id=?', key);
}

export async function tickSources(c: Context) {
  await stmt(c.db, "UPDATE observation_slots SET state='MISSED',reason='SLOT_MISSED' WHERE state='PLANNED' AND deadlineAt<?", c.now).run();
  await stmt(c.db, "UPDATE source_runs SET state='FAILED',reason='CAPTURE_INTERRUPTED',finishedAt=? WHERE state='CAPTURING' AND startedAt<?", c.now, c.now - 120000).run();
}
