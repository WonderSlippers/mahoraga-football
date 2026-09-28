import { canonical } from "../../../../packages/contracts/index";
import { score } from "../../../../packages/domain/index";
import { receipt, type Context } from "./commands";
import { stmt, one, rows, uid, atomic } from "../repositories/db";
export async function adjudicate(
  c: Context,
  key: string,
  p: {
    fixtureId: string;
    expectedRevision: number;
    selectedEvidenceId: string | null;
    reason: string;
  },
) {
  const r = await receipt(c, "source-adjudication", key, p);
  if (r.old) return { id: r.old.resultRef };
  if (
    typeof p.reason !== "string" ||
    p.reason.trim().length < 3 ||
    p.reason.length > 1000 ||
    !(p.selectedEvidenceId === null || typeof p.selectedEvidenceId === "string")
  )
    throw Error("ADJUDICATION_REASON_REQUIRED");
  const fixture = await one(
    c.db,
    "SELECT * FROM fixtures WHERE id=?",
    p.fixtureId,
  );
  const evidence = await rows(
    c.db,
    "SELECT * FROM result_observations WHERE fixtureId=? ORDER BY observedAt,id LIMIT 1001",
    fixture.id,
  );
  if (!evidence.length) throw Error("RESULT_MISSING");
  if (evidence.length > 1000) throw Error("EVIDENCE_REVIEW_LIMIT");
  const normalized = evidence.map((e) => {
    let regulation = null;
    if (e.regulationJson) {
      try {
        const raw = JSON.parse(e.regulationJson);
        regulation = score(
          Array.isArray(raw) ? { home: raw[0], away: raw[1] } : raw,
        );
      } catch {
        /* stays unknown */
      }
    }
    return { ...e, id: e.id as string, regulation };
  });
  const values = new Set(
    normalized.filter((e) => e.regulation).map((e) => canonical(e.regulation)),
  );
  let state = "REVIEW",
    regulation = null;
  if (p.selectedEvidenceId !== null) {
    const selected = normalized.find((e) => e.id === p.selectedEvidenceId);
    if (!selected?.regulation) throw Error("RESULT_REGULATION_UNKNOWN");
    regulation = selected.regulation;
    state = "ACCEPTED_REGULATION";
  } else if (values.size === 1 && normalized.every((e) => e.regulation)) {
    regulation = normalized[0].regulation;
    state = "ACCEPTED_REGULATION";
  }
  const previous = await stmt(
    c.db,
    "SELECT * FROM result_adjudications WHERE fixtureId=? ORDER BY revision DESC LIMIT 1",
    fixture.id,
  ).first<any>();
  if ((previous?.revision || 0) !== p.expectedRevision)
    throw Error("REVISION_CONFLICT");
  const id = uid(),
    knownCount = evidence.length;
  const reason =
    (p.selectedEvidenceId
      ? "MANUAL_EVIDENCE_RESOLUTION"
      : values.size > 1
        ? "RESULT_CONFLICT"
        : state === "REVIEW"
          ? "RESULT_REGULATION_UNKNOWN"
          : "OPENLIGA_SINGLE_SOURCE_REGULATION_V1") +
    ": " +
    p.reason;
  try {
    await atomic(
      c.db,
      [
        stmt(
          c.db,
          "INSERT INTO command_receipts VALUES(?,?,?,?,CASE WHEN COALESCE((SELECT MAX(revision) FROM result_adjudications WHERE fixtureId=?),0)=? AND (SELECT COUNT(*) FROM result_observations WHERE fixtureId=?)=? THEN 1 ELSE 0 END,?,?)",
          uid(),
          r.scope,
          key,
          r.hash,
          fixture.id,
          p.expectedRevision,
          fixture.id,
          knownCount,
          id,
          c.now,
        ),
        stmt(
          c.db,
          "INSERT INTO result_adjudications VALUES(?,?,?,?,?,?,?,?,?)",
          id,
          fixture.id,
          p.expectedRevision + 1,
          state,
          regulation ? canonical(regulation) : null,
          canonical(evidence.map((e) => e.id).sort()),
          reason,
          "LOCAL_RESEARCH_OPERATOR",
          previous?.id || null,
        ),
      ],
      c.failAt,
    );
  } catch {
    const replay = await receipt(c, "source-adjudication", key, p);
    if (replay.old) return { id: replay.old.resultRef };
    throw Error("REVISION_CONFLICT");
  }
  return { id };
}
