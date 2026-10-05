import { atoms } from "../../../../packages/domain/index";
import { receipt, type Context } from "./commands";
import { stmt, uid, atomic } from "../repositories/db";
export async function reportTrade(
  c: Context,
  key: string,
  p: {
    account: string;
    externalKey: string;
    expectedRevision: number;
    stakeAtoms: string;
    grossClaimAtoms: string | null;
    currency: string;
    description: string;
    evidenceNote: string;
    reason: string;
  },
) {
  const r = await receipt(c, "reported-trade", key, p);
  if (r.old) return { id: r.old.resultRef };
  if (
    ![p.account, p.externalKey, p.description, p.evidenceNote, p.reason].every(
      (x) => typeof x === "string" && x.trim().length > 0 && x.length <= 1000,
    ) ||
    !/^[A-Z]{3}$/.test(p.currency) ||
    p.currency === "PAP"
  )
    throw Error("REPORTED_FIELDS_REQUIRED");
  atoms(p.stakeAtoms, true);
  if (p.grossClaimAtoms !== null && atoms(p.grossClaimAtoms) < 0n)
    throw Error("AMOUNT_INVALID");
  const prior = await stmt(
    c.db,
    "SELECT * FROM reported_trade_events WHERE account=? AND externalKey=? ORDER BY revision DESC LIMIT 1",
    p.account,
    p.externalKey,
  ).first<any>();
  if ((prior?.revision || 0) !== p.expectedRevision)
    throw Error("REVISION_CONFLICT");
  if (prior && prior.currency !== p.currency) throw Error("CURRENCY_MISMATCH");
  const id = uid();
  try {
    await atomic(
      c.db,
      [
        stmt(
          c.db,
          "INSERT INTO command_receipts VALUES(?,?,?,?,CASE WHEN COALESCE((SELECT MAX(revision) FROM reported_trade_events WHERE account=? AND externalKey=?),0)=? THEN 1 ELSE 0 END,?,?)",
          uid(),
          r.scope,
          key,
          r.hash,
          p.account,
          p.externalKey,
          p.expectedRevision,
          id,
          c.now,
        ),
        stmt(
          c.db,
          "INSERT INTO reported_trade_events VALUES(?,?,?,?,?,?,?,?,?,?,?,'USER_REPORTED')",
          id,
          p.account,
          p.externalKey,
          p.expectedRevision + 1,
          p.stakeAtoms,
          p.grossClaimAtoms,
          p.currency,
          p.description,
          p.evidenceNote,
          p.reason,
          c.now,
        ),
      ],
      c.failAt,
    );
  } catch {
    const old = await receipt(c, "reported-trade", key, p);
    if (old.old) return { id: old.old.resultRef };
    throw Error("REVISION_CONFLICT");
  }
  return { id };
}
