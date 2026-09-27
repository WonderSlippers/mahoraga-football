import {
  canonical,
  sha,
  input,
  central,
} from "../../../../packages/contracts/index";
import { score } from "../../../../packages/domain/index";
import { one, stmt, uid, rows, atomic } from "../repositories/db";
import { receipt, type Context } from "./commands";
export const MODELS = ["MARKET_PROPORTIONAL_V1", "DEMO_FIXED_CENTRAL_V1"];
export async function observe(c: Context, key: string) {
  const r = await receipt(c, "observe", key, {});
  if (r.old) return { id: r.old.resultRef };
  const id = uid(),
    source = uid(),
    rev = uid(),
    market = uid(),
    qs = uid(),
    slot = uid(),
    bundle = uid(),
    kickoff = c.now + 3600000;
  const raw = canonical({
    mode: "DEMO",
    home: "DEMO 青岚",
    away: "DEMO 赤松",
    odds: ["2.00", "3.20", "4.00"],
    observedAt: new Date(c.now).toISOString(),
  });
  const rawHash = await sha(raw);
  const frozen = input({
    mode: "DEMO",
    fixtureId: id,
    revisionId: rev,
    observedAt: new Date(c.now).toISOString(),
    ingestedAt: new Date(c.now).toISOString(),
    cutoffAt: new Date(c.now).toISOString(),
    kickoffAt: new Date(kickoff).toISOString(),
    odds: ["2.00", "3.20", "4.00"],
    missingMask: [],
  });
  const bytes = canonical(frozen),
    hash = await sha(bytes);
  // Capture raw evidence separately: a subsequent model failure never discards it.
  await c.db.batch([
    stmt(
      c.db,
      "INSERT INTO source_snapshots VALUES(?,?,?,?,?,NULL,?,'DEMO','COMPLETE')",
      source,
      "DEMO_GENERATOR_V1",
      id,
      c.now,
      c.now,
      rawHash,
    ),
    stmt(c.db, "INSERT INTO source_chunks VALUES(?,0,?)", source, raw),
  ]);
  const list = [
    stmt(
      c.db,
      "INSERT INTO command_receipts VALUES(?,?,?,?,1,?,?)",
      uid(),
      r.scope,
      key,
      r.hash,
      id,
      c.now,
    ),
    stmt(
      c.db,
      "INSERT INTO fixtures VALUES(?,?,?,1,'SCHEDULED')",
      id,
      "DEMO 青岚",
      "DEMO 赤松",
    ),
    stmt(
      c.db,
      "INSERT INTO fixture_revisions VALUES(?,?,1,?,?,?)",
      rev,
      id,
      kickoff,
      c.now,
      source,
    ),
    stmt(
      c.db,
      "INSERT INTO market_definitions VALUES(?,?,?,'REGULATION_90','1X2')",
      market,
      id,
      await sha(id + ":REGULATION_90:1X2"),
    ),
    stmt(
      c.db,
      "INSERT INTO quote_sets VALUES(?,?,?,?,?,NULL,'PREMATCH_OBSERVED',0,?)",
      qs,
      market,
      source,
      "DEMO_GENERATOR_V1",
      c.now,
      rawHash,
    ),
    ...["HOME", "DRAW", "AWAY"].map((s, i) =>
      stmt(
        c.db,
        "INSERT INTO quote_selections VALUES(?,?,?,?,?,'decimal')",
        uid(),
        qs,
        s,
        frozen.odds[i],
        frozen.odds[i],
      ),
    ),
    stmt(
      c.db,
      "INSERT INTO observation_slots VALUES(?,?, 'DEMO_T60_V1',?,?,'QUEUED',NULL)",
      slot,
      rev,
      c.now,
      c.now + 300000,
    ),
    stmt(
      c.db,
      "INSERT INTO input_bundles VALUES(?,?,?,?,?,?,'READY')",
      bundle,
      slot,
      qs,
      c.now,
      hash,
      bytes,
    ),
    ...MODELS.map((m) =>
      stmt(
        c.db,
        "INSERT INTO jobs(id,bundleId,modelId,state,deadlineAt) VALUES(?,?,?,'QUEUED',?)",
        uid(),
        bundle,
        m,
        c.now + 300000,
      ),
    ),
  ];
  try {
    await atomic(c.db, list, c.failAt);
  } catch {
    const again = await receipt(c, "observe", key, {});
    if (again.old) return { id: again.old.resultRef };
    throw new Error("REVISION_CONFLICT");
  }
  return { id };
}
export async function claim(c: Context, owner: string) {
  await stmt(
    c.db,
    "UPDATE jobs SET state='BLOCKED',reason='SLOT_MISSED' WHERE state IN ('QUEUED','RUNNING') AND deadlineAt<=?",
    c.now,
  ).run();
  await stmt(
    c.db,
    "UPDATE observation_slots SET state='MISSED',reason='SLOT_MISSED' WHERE deadlineAt<=? AND state IN('QUEUED','PARTIAL','PLANNED')",
    c.now,
  ).run();
  const j = await stmt(
    c.db,
    `UPDATE jobs SET state='RUNNING',leaseOwner=?,leaseUntil=MIN(? ,deadlineAt),fencingToken=fencingToken+1,attempts=attempts+1 WHERE id=(SELECT id FROM jobs WHERE (state='QUEUED' OR (state='RUNNING' AND leaseUntil<=?)) AND deadlineAt>? ORDER BY rowid LIMIT 1) RETURNING *`,
    owner,
    c.now + 30000,
    c.now,
    c.now,
  ).first<any>();
  if (!j) return null;
  const b = await one(
    c.db,
    "SELECT * FROM input_bundles WHERE id=?",
    j.bundleId,
  );
  const model = await one(
    c.db,
    "SELECT * FROM model_manifests WHERE id=?",
    j.modelId,
  );
  return {
    ...j,
    canonical: b.canonical,
    bundleHash: b.manifestHash,
    modelHash: model.manifestHash,
  };
}
export async function complete(
  c: Context,
  id: string,
  p: {
    owner: string;
    fencingToken: number;
    bundleHash: string;
    modelHash: string;
    central: number[];
    featureCanonical: string;
  },
) {
  central(p.central);
  const j = await one(c.db, "SELECT * FROM jobs WHERE id=?", id);
  const b = await one(
    c.db,
    "SELECT * FROM input_bundles WHERE id=?",
    j.bundleId,
  );
  const model = await one(
    c.db,
    "SELECT * FROM model_manifests WHERE id=?",
    j.modelId,
  );
  if (p.bundleHash !== b.manifestHash || p.modelHash !== model.manifestHash)
    throw new Error("MODEL_HASH_MISMATCH");
  if (
    p.featureCanonical !== b.canonical ||
    (await sha(b.canonical)) !== b.manifestHash
  )
    throw new Error("FEATURE_SCHEMA_MISMATCH");
  if (!MODELS.includes(j.modelId)) throw new Error("RESEARCH_FIT_FORBIDDEN");
  if (
    j.state === "DONE" &&
    j.leaseOwner === p.owner &&
    j.fencingToken === p.fencingToken
  ) {
    const old = await one(
      c.db,
      "SELECT requestHash,resultRef FROM command_receipts WHERE scope=? AND idempotencyKey=?",
      c.installationId + ":complete",
      id + ":" + p.fencingToken,
    );
    if (old.requestHash !== (await sha(canonical(p))))
      throw new Error("IDEMPOTENCY_CONFLICT");
    return { state: "DONE", predictionId: old.resultRef };
  }
  const f = input(JSON.parse(b.canonical));
  if (f.mode !== "DEMO") throw new Error("NETWORK_DISABLED");
  if (c.now < b.cutoffAt || c.now >= Date.parse(f.kickoffAt))
    throw new Error("FEATURE_LATE");
  const feature = uid(),
    prediction = uid();
  const quotes = await rows(
    c.db,
    "SELECT * FROM quote_selections WHERE quoteSetId=?",
    b.quoteSetId,
  );
  const statements = [
    stmt(
      c.db,
      `INSERT INTO command_receipts VALUES(?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM jobs WHERE id=? AND state='RUNNING' AND leaseOwner=? AND fencingToken=? AND leaseUntil>? AND deadlineAt>?) AND EXISTS(SELECT 1 FROM fixtures f JOIN fixture_revisions r ON r.fixtureId=f.id WHERE r.id=? AND f.currentRevision=r.revision AND f.status='SCHEDULED') THEN 1 ELSE 0 END,?,?)`,
      uid(),
      c.installationId + ":complete",
      id + ":" + p.fencingToken,
      await sha(canonical(p)),
      id,
      p.owner,
      p.fencingToken,
      c.now,
      c.now,
      f.revisionId,
      prediction,
      c.now,
    ),
    stmt(
      c.db,
      "INSERT INTO feature_snapshots VALUES(?,?,?,?,?)",
      feature,
      b.id,
      j.modelId,
      b.manifestHash,
      b.canonical,
    ),
    stmt(
      c.db,
      "INSERT INTO predictions(id,slotId,fixtureRevisionId,modelId,featureSnapshotId,calculatedAt,centralJson,predictionHash) VALUES(?,?,?,?,?,?,?,?)",
      prediction,
      b.slotId,
      f.revisionId,
      j.modelId,
      feature,
      c.now,
      canonical(p.central),
      await sha(
        canonical({
          modelId: j.modelId,
          bundleHash: b.manifestHash,
          central: p.central,
        }),
      ),
    ),
  ];
  for (const q of quotes) {
    const prob = p.central[["HOME", "DRAW", "AWAY"].indexOf(q.selection)];
    const er = prob * Number(q.decimalOdds),
      e = uid();
    statements.push(
      stmt(
        c.db,
        "INSERT INTO market_expectations VALUES(?,?,?,?,?,?,'RETURN_V1')",
        e,
        prediction,
        q.id,
        er,
        er - 1,
        prob,
      ),
      stmt(
        c.db,
        "INSERT INTO decisions VALUES(?,?,?,?,?,'DEMO_EV_POSITIVE_V1')",
        uid(),
        e,
        er > 1 ? 1 : 0,
        er > 1 ? "DEMO_CANDIDATE" : "EV_BELOW_THRESHOLD",
        c.now,
      ),
    );
  }
  statements.push(
    stmt(c.db, "UPDATE jobs SET state='DONE' WHERE id=?", id),
    stmt(
      c.db,
      "UPDATE observation_slots SET state=CASE WHEN NOT EXISTS(SELECT 1 FROM jobs WHERE bundleId=? AND state<>'DONE') THEN 'COMPLETE' ELSE 'PARTIAL' END WHERE id=?",
      b.id,
      b.slotId,
    ),
  );
  try {
    await atomic(c.db, statements, c.failAt);
  } catch {
    throw new Error("LEASE_EXPIRED");
  }
  return { state: "DONE", predictionId: prediction };
}
export async function demoResult(
  c: Context,
  key: string,
  p: {
    fixtureId: string;
    scenario: string;
    expectedRevision: number;
    reason: string;
  },
) {
  const r = await receipt(c, "result", key, p);
  if (r.old) return { id: r.old.resultRef };
  if (
    !["WIN", "LOSS", "CONFLICT", "AET", "VOID"].includes(p.scenario) ||
    !p.reason?.trim()
  )
    throw new Error("INVALID_FIELDS");
  await one(c.db, "SELECT * FROM fixtures WHERE id=?", p.fixtureId);
  const previous = await stmt(
    c.db,
    "SELECT * FROM result_adjudications WHERE fixtureId=? ORDER BY revision DESC LIMIT 1",
    p.fixtureId,
  ).first<any>();
  const id = uid(),
    source = uid(),
    ob = uid();
  const scores =
    p.scenario === "WIN"
      ? { home: 2, away: 0 }
      : p.scenario === "LOSS"
        ? { home: 0, away: 1 }
        : null;
  if (scores) score(scores);
  const state = scores
    ? "ACCEPTED_REGULATION"
    : p.scenario === "VOID"
      ? "VOID_BY_RULE"
      : p.scenario === "CONFLICT"
        ? "CONFLICT"
        : "PENDING";
  const raw = canonical({
    mode: "DEMO",
    scenario: p.scenario,
    regulationScore: scores,
    conflictingScores:
      p.scenario === "CONFLICT"
        ? [
            { home: 2, away: 1 },
            { home: 0, away: 1 },
          ]
        : null,
  });
  const hash = await sha(raw);
  await atomic(
    c.db,
    [
      stmt(
        c.db,
        `INSERT INTO command_receipts VALUES(?,?,?,?,CASE WHEN COALESCE((SELECT MAX(revision) FROM result_adjudications WHERE fixtureId=?),0)=? THEN 1 ELSE 0 END,?,?)`,
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
        "DEMO_RESULT_V1",
        p.fixtureId,
        c.now,
        c.now,
        hash,
      ),
      stmt(c.db, "INSERT INTO source_chunks VALUES(?,0,?)", source, raw),
      stmt(
        c.db,
        "INSERT INTO result_observations VALUES(?,?,?,?,?,?)",
        ob,
        p.fixtureId,
        source,
        scores ? canonical(scores) : null,
        p.scenario,
        c.now,
      ),
      stmt(
        c.db,
        "INSERT INTO result_adjudications VALUES(?,?,?,?,?,?,?,?,?)",
        id,
        p.fixtureId,
        (previous?.revision || 0) + 1,
        state,
        scores ? canonical(scores) : null,
        canonical([ob]),
        p.reason,
        "LOCAL_DEMO_OPERATOR",
        previous?.id || null,
      ),
      stmt(
        c.db,
        "UPDATE fixtures SET status='FINISHED' WHERE id=?",
        p.fixtureId,
      ),
    ],
    c.failAt,
  );
  return { id };
}
