import { canonical, sha } from "../../../../packages/contracts/index";
import { receipt, type Context } from "./commands";
import { stmt, uid, atomic, one } from "../repositories/db";
// DEMO-only scheduling changes. Old tickets and predictions keep their revision FK.
export async function reschedule(
  c: Context,
  key: string,
  p: { fixtureId: string; expectedRevision: number; kickoffAt: number },
) {
  const r = await receipt(c, "reschedule", key, p);
  if (r.old) return { id: r.old.resultRef };
  if (!Number.isSafeInteger(p.kickoffAt) || p.kickoffAt <= c.now)
    throw Error("KICKOFF_PASSED");
  const old = await one(
    c.db,
    "SELECT * FROM fixture_revisions WHERE fixtureId=? AND revision=?",
    p.fixtureId,
    p.expectedRevision,
  );
  const id = uid(),
    source = uid(),
    slot = uid();
  const raw = canonical({
    mode: "DEMO",
    fixtureId: p.fixtureId,
    kickoffAt: p.kickoffAt,
  });
  await atomic(
    c.db,
    [
      stmt(
        c.db,
        `INSERT INTO command_receipts VALUES(?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM fixtures WHERE id=? AND currentRevision=? AND status='SCHEDULED') THEN 1 ELSE 0 END,?,?)`,
        uid(),
        r.scope,
        key,
        r.hash,
        p.fixtureId,
        p.expectedRevision,
        id,
        c.now,
      ),
      stmt(
        c.db,
        "INSERT INTO source_snapshots VALUES(?,?,?,?,?,NULL,?,'DEMO','COMPLETE')",
        source,
        "DEMO_SCHEDULE_V1",
        p.fixtureId,
        c.now,
        c.now,
        await sha(raw),
      ),
      stmt(c.db, "INSERT INTO source_chunks VALUES(?,0,?)", source, raw),
      stmt(
        c.db,
        "INSERT INTO fixture_revisions VALUES(?,?,?,?,?,?)",
        id,
        p.fixtureId,
        p.expectedRevision + 1,
        p.kickoffAt,
        c.now,
        source,
      ),
      stmt(
        c.db,
        "UPDATE fixtures SET currentRevision=currentRevision+1 WHERE id=?",
        p.fixtureId,
      ),
      stmt(
        c.db,
        "UPDATE observation_slots SET state='SUPERSEDED',reason='SLOT_SUPERSEDED' WHERE fixtureRevisionId=?",
        old.id,
      ),
      stmt(
        c.db,
        "UPDATE jobs SET state='BLOCKED',reason='SLOT_SUPERSEDED' WHERE bundleId IN(SELECT b.id FROM input_bundles b JOIN observation_slots s ON s.id=b.slotId WHERE s.fixtureRevisionId=?) AND state<>'DONE'",
        old.id,
      ),
      stmt(
        c.db,
        "INSERT INTO observation_slots VALUES(?,?,'DEMO_T60_V1',?,?,'PLANNED','QUOTE_MISSING')",
        slot,
        id,
        p.kickoffAt - 3600000,
        p.kickoffAt - 3300000,
      ),
    ],
    c.failAt,
  );
  return { id };
}
