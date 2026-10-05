import { canonical, sha } from "../../../../packages/contracts";
import { marketBaseline } from "../../../../packages/domain";
import {
  ADAPTATION_PROTOCOL,
  ADAPTATION_RULES,
  GENERAL_ADAPTIVE_ID,
  GENERAL_FIXED_ID,
  INITIAL_CALIBRATION,
  validCalibration,
  validationDecision,
  type Calibration,
  type CalibrationSample,
} from "../../../../packages/domain/general-adaptation";
import { atomic, one, rows, stmt, uid } from "../repositories/db";
import type { Context } from "./commands";

async function research(c: Context) {
  return (
    (
      await one(
        c.db,
        "SELECT mode FROM installations WHERE id=?",
        c.installationId,
      )
    ).mode === "LOCAL_RESEARCH"
  );
}
export async function calibrationSnapshot(c: Context) {
  await stmt(
    c.db,
    "INSERT OR IGNORE INTO general_calibration_state VALUES(?,0,?,0)",
    GENERAL_ADAPTIVE_ID,
    canonical(INITIAL_CALIBRATION),
  ).run();
  const s = await one(
    c.db,
    "SELECT * FROM general_calibration_state WHERE modelId=?",
    GENERAL_ADAPTIVE_ID,
  );
  return {
    protocol: ADAPTATION_PROTOCOL,
    revision: s.revision,
    ...(JSON.parse(s.parametersJson) as Calibration),
    effectiveAt: s.effectiveAt,
  };
}
// Earliest actual pre-match forecast per fixture, across fixed/adaptive General.
// Read compact vectors only: never read every repeated grid or treat paper legs as samples.
export async function learningSamples(
  c: Context,
  afterCutoff = -1,
): Promise<CalibrationSample[]> {
  const found = await rows(
    c.db,
    `WITH first AS MATERIALIZED(
    SELECT o.id,ROW_NUMBER() OVER(PARTITION BY r.fixtureId ORDER BY o.calculatedAt,o.id) n
    FROM universal_observations o JOIN jobs j ON j.id=o.jobId
    JOIN fixture_revisions r ON r.id=o.fixtureRevisionId JOIN input_bundles b ON b.id=o.bundleId
    JOIN quote_sets q ON q.id=b.quoteSetId JOIN source_snapshots src ON src.id=q.sourceSnapshotId
    WHERE j.modelId IN(?,?) AND o.state='DONE' AND o.calculatedAt<r.kickoffAt
      AND b.cutoffAt<r.kickoffAt AND q.observedAt<=b.cutoffAt AND b.cutoffAt-q.observedAt<=600000 AND src.mode='LOCAL_RESEARCH'
      AND json_extract(b.canonical,'$.mode')='LOCAL_RESEARCH' AND b.cutoffAt>?
  ) SELECT r.fixtureId,o.id observationId,a.id adjudicationId,b.cutoffAt,r.kickoffAt,
    COALESCE(json_extract(o.outputJson,'$.adaptation.baseCentral'),json_extract(o.outputJson,'$.central')) baseJson,
    json_extract(b.canonical,'$.odds') oddsJson,a.regulationJson
    FROM first x JOIN universal_observations o ON o.id=x.id
    JOIN fixture_revisions r ON r.id=o.fixtureRevisionId JOIN input_bundles b ON b.id=o.bundleId
    JOIN result_adjudications a ON a.fixtureId=r.fixtureId AND a.revision=(SELECT MAX(z.revision) FROM result_adjudications z WHERE z.fixtureId=r.fixtureId)
    WHERE x.n=1 AND r.kickoffAt<? AND a.state='ACCEPTED_REGULATION'
      AND EXISTS(SELECT 1 FROM command_receipts cr WHERE cr.resultRef=a.id AND cr.committedAt<=?)
    ORDER BY r.kickoffAt DESC,r.fixtureId LIMIT 400`,
    GENERAL_FIXED_ID,
    GENERAL_ADAPTIVE_ID,
    afterCutoff,
    c.now,
    c.now,
  );
  return found
    .map((r: any) => {
      const score = JSON.parse(r.regulationJson);
      if (
        !Number.isInteger(score.home) ||
        !Number.isInteger(score.away) ||
        score.home < 0 ||
        score.away < 0
      )
        throw Error("RESULT_INVALID");
      return {
        fixtureId: r.fixtureId,
        observationId: r.observationId,
        adjudicationId: r.adjudicationId,
        cutoffAt: r.cutoffAt,
        kickoffAt: r.kickoffAt,
        base: JSON.parse(r.baseJson),
        market: marketBaseline(JSON.parse(r.oddsJson)),
        outcome:
          score.home > score.away ? 0 : score.home === score.away ? 1 : 2,
      };
    })
    .sort(
      (a, b) =>
        a.kickoffAt - b.kickoffAt || a.fixtureId.localeCompare(b.fixtureId),
    );
}
async function trainingUnchanged(c: Context, training: CalibrationSample[]) {
  const adjudications = await rows(
    c.db,
    "SELECT a.fixtureId,a.id,a.state FROM result_adjudications a WHERE a.fixtureId IN(SELECT value FROM json_each(?)) AND a.revision=(SELECT MAX(z.revision) FROM result_adjudications z WHERE z.fixtureId=a.fixtureId)",
    canonical(training.map((s) => s.fixtureId)),
  );
  return training.every((s) =>
    adjudications.some(
      (a) =>
        a.fixtureId === s.fixtureId &&
        a.id === s.adjudicationId &&
        a.state === "ACCEPTED_REGULATION",
    ),
  );
}
function resultGuard(c: Context, samples: CalibrationSample[]) {
  return stmt(
    c.db,
    `INSERT INTO fault_guard VALUES(CASE WHEN
    (SELECT COUNT(*) FROM json_each(?) x JOIN result_adjudications a
      ON a.fixtureId=json_extract(x.value,'$.fixtureId') AND a.id=json_extract(x.value,'$.adjudicationId')
      WHERE a.state='ACCEPTED_REGULATION' AND a.revision=(SELECT MAX(z.revision) FROM result_adjudications z WHERE z.fixtureId=a.fixtureId))=?
    THEN 1 ELSE 0 END)`,
    canonical(
      samples.map(({ fixtureId, adjudicationId }) => ({
        fixtureId,
        adjudicationId,
      })),
    ),
    samples.length,
  );
}
async function validatePending(c: Context) {
  const pending = await stmt(
    c.db,
    "SELECT j.*,p.parametersJson proposedJson,p.proposedAt FROM general_learning_jobs j JOIN general_learning_proposals p ON p.jobId=j.id WHERE j.state='VALIDATING' ORDER BY j.createdAt LIMIT 1",
  ).first<any>();
  if (!pending) return null;
  const training: CalibrationSample[] = JSON.parse(pending.trainingJson),
    trainedIds = new Set(training.map((s) => s.fixtureId));
  const samples = await learningSamples(c, pending.proposedAt);
  const validation = samples
    .filter(
      (s) => !trainedIds.has(s.fixtureId) && s.cutoffAt > pending.proposedAt,
    )
    .slice(0, ADAPTATION_RULES.minimumValidation);
  const current = await calibrationSnapshot(c);
  const stale =
    current.revision !== pending.baseRevision ||
    !(await trainingUnchanged(c, training));
  if (!stale && validation.length < ADAPTATION_RULES.minimumValidation)
    return {
      jobId: pending.id,
      state: "VALIDATING",
      validationN: validation.length,
      required: ADAPTATION_RULES.minimumValidation,
    };
  const proposed = JSON.parse(pending.proposedJson),
    result = stale
      ? {
          accepted: false,
          reason: "TRAINING_RESULT_CORRECTED_OR_REVISION_CHANGED",
        }
      : validationDecision(
          validation,
          JSON.parse(pending.parametersJson),
          proposed,
        );
  const nextRevision = current.revision + (result.accepted ? 1 : 0);
  const statements = [
    stmt(
      c.db,
      "INSERT INTO fault_guard VALUES(CASE WHEN EXISTS(SELECT 1 FROM general_learning_jobs WHERE id=? AND state='VALIDATING') AND EXISTS(SELECT 1 FROM general_calibration_state WHERE modelId=? AND revision=?) THEN 1 ELSE 0 END)",
      pending.id,
      GENERAL_ADAPTIVE_ID,
      current.revision,
    ),
    stmt(c.db, "DELETE FROM fault_guard"),
    // CAS protects same-cycle races. Result-revision guard covers concurrent corrections.
    resultGuard(c, [...training, ...validation]),
    stmt(c.db, "DELETE FROM fault_guard"),
  ];
  // Stale training must be recorded, not made to pass the old adjudication guard.
  if (stale) statements.splice(2);
  if (result.accepted)
    statements.push(
      stmt(
        c.db,
        "UPDATE general_calibration_state SET revision=revision+1,parametersJson=?,effectiveAt=? WHERE modelId=? AND revision=?",
        canonical(proposed),
        c.now,
        GENERAL_ADAPTIVE_ID,
        current.revision,
      ),
    );
  statements.push(
    stmt(
      c.db,
      "INSERT INTO general_learning_events VALUES(?,?,?,?,?,?)",
      uid(),
      pending.id,
      result.accepted ? "APPLIED" : stale ? "STALE" : "REJECTED",
      nextRevision,
      c.now,
      canonical({
        protocol: ADAPTATION_PROTOCOL,
        ...result,
        parameters: proposed,
        validation,
        proposedAt: pending.proposedAt,
        scope: "NEW_FORWARD_FIXTURES_PAPER_RESEARCH",
      }),
    ),
    stmt(
      c.db,
      "UPDATE general_learning_jobs SET state=? WHERE id=?",
      stale ? "STALE" : "COMPLETE",
      pending.id,
    ),
  );
  await atomic(c.db, statements, c.failAt);
  return {
    jobId: pending.id,
    state: stale ? "STALE" : "COMPLETE",
    ...result,
    revision: nextRevision,
  };
}
export async function claimGeneralLearning(c: Context, owner: string) {
  if (!(await research(c))) return { state: "DEMO_OFFLINE", job: null };
  if (typeof owner !== "string" || !owner.length || owner.length > 120)
    throw Error("INVALID_FIELDS");
  await calibrationSnapshot(c);
  const validation = await validatePending(c);
  if (validation?.state === "VALIDATING") return { ...validation, job: null };
  const samples = await learningSamples(c);
  const active = await stmt(
    c.db,
    "SELECT id FROM general_learning_jobs WHERE state IN('QUEUED','RUNNING') LIMIT 1",
  ).first();
  if (!active) {
    if (samples.length < ADAPTATION_RULES.minimumTraining)
      return {
        state: "TRAINING_WARMUP",
        trainingN: samples.length,
        required: ADAPTATION_RULES.minimumTraining,
        job: null,
      };
    const last = await stmt(
      c.db,
      "SELECT trainingJson FROM general_learning_jobs ORDER BY createdAt DESC,rowid DESC LIMIT 1",
    ).first<any>();
    const seen = new Set<string>(
      last
        ? JSON.parse(last.trainingJson).map(
            (s: CalibrationSample) => s.fixtureId,
          )
        : [],
    );
    if (
      last &&
      samples.filter((s) => !seen.has(s.fixtureId)).length <
        ADAPTATION_RULES.minimumNewTraining
    )
      return { state: "WAITING_FOR_NEW_TRAINING_FIXTURES", job: null };
    const current = await calibrationSnapshot(c),
      trainingHash = await sha(canonical(samples));
    await atomic(c.db, [
      stmt(
        c.db,
        "INSERT INTO fault_guard VALUES(CASE WHEN NOT EXISTS(SELECT 1 FROM general_learning_jobs WHERE state IN('QUEUED','RUNNING','VALIDATING')) AND EXISTS(SELECT 1 FROM general_calibration_state WHERE modelId=? AND revision=?) THEN 1 ELSE 0 END)",
        GENERAL_ADAPTIVE_ID,
        current.revision,
      ),
      stmt(c.db, "DELETE FROM fault_guard"),
      stmt(
        c.db,
        "INSERT OR IGNORE INTO general_learning_jobs(id,trainingHash,trainingJson,baseRevision,parametersJson,state,createdAt) VALUES(?,?,?,?,?,'QUEUED',?)",
        uid(),
        trainingHash,
        canonical(samples),
        current.revision,
        canonical({
          modelTrust: current.modelTrust,
          temperature: current.temperature,
        }),
        c.now,
      ),
    ]);
  }
  const j = await stmt(
    c.db,
    "UPDATE general_learning_jobs SET state='RUNNING',owner=?,fencingToken=fencingToken+1,leaseUntil=? WHERE id=(SELECT id FROM general_learning_jobs WHERE state='QUEUED' OR state='RUNNING' AND leaseUntil<=? ORDER BY createdAt LIMIT 1) RETURNING *",
    owner,
    c.now + 60000,
    c.now,
  ).first<any>();
  return {
    state: j ? "RUNNING" : "BUSY",
    job: j
      ? {
          id: j.id,
          protocol: ADAPTATION_PROTOCOL,
          trainingHash: j.trainingHash,
          baseRevision: j.baseRevision,
          parameters: JSON.parse(j.parametersJson),
          training: JSON.parse(j.trainingJson),
          fencingToken: j.fencingToken,
          leaseUntil: j.leaseUntil,
        }
      : null,
  };
}
export async function proposeGeneralLearning(c: Context, id: string, p: any) {
  if (!(await research(c))) throw Error("MODE_MISMATCH");
  const proposed = validCalibration(p.parameters),
    requestHash = await sha(canonical(p));
  const old = await stmt(
    c.db,
    "SELECT requestHash FROM general_learning_proposals WHERE jobId=?",
    id,
  ).first<any>();
  if (old) {
    if (old.requestHash !== requestHash) throw Error("IDEMPOTENCY_CONFLICT");
    return { id, replayed: true };
  }
  const j = await one(
      c.db,
      "SELECT * FROM general_learning_jobs WHERE id=?",
      id,
    ),
    current = JSON.parse(j.parametersJson);
  if (
    Math.abs(proposed.modelTrust - current.modelTrust) > 0.050000001 ||
    Math.abs(proposed.temperature - current.temperature) > 0.050000001
  )
    throw Error("CALIBRATION_STEP_TOO_LARGE");
  if (p.trainingHash !== j.trainingHash) throw Error("MODEL_HASH_MISMATCH");
  if (!(await trainingUnchanged(c, JSON.parse(j.trainingJson)))) {
    await atomic(c.db, [
      stmt(
        c.db,
        "INSERT INTO fault_guard VALUES(CASE WHEN EXISTS(SELECT 1 FROM general_learning_jobs WHERE id=? AND state='RUNNING' AND owner=? AND fencingToken=? AND leaseUntil>?) THEN 1 ELSE 0 END)",
        id,
        p.owner,
        p.fencingToken,
        c.now,
      ),
      stmt(c.db, "DELETE FROM fault_guard"),
      stmt(
        c.db,
        "UPDATE general_learning_jobs SET state='STALE',leaseUntil=0 WHERE id=?",
        id,
      ),
      stmt(
        c.db,
        "INSERT INTO general_learning_events VALUES(?,?,'STALE',?,?,?)",
        uid(),
        id,
        j.baseRevision,
        c.now,
        canonical({ reason: "TRAINING_RESULT_CORRECTED" }),
      ),
    ]);
    return { id, state: "STALE" };
  }
  const same = canonical(current) === canonical(proposed);
  try {
    await atomic(
      c.db,
      [
        stmt(
          c.db,
          "INSERT INTO fault_guard VALUES(CASE WHEN EXISTS(SELECT 1 FROM general_learning_jobs WHERE id=? AND state='RUNNING' AND owner=? AND fencingToken=? AND leaseUntil>?) AND EXISTS(SELECT 1 FROM general_calibration_state WHERE modelId=? AND revision=?) THEN 1 ELSE 0 END)",
          id,
          p.owner,
          p.fencingToken,
          c.now,
          GENERAL_ADAPTIVE_ID,
          j.baseRevision,
        ),
        stmt(c.db, "DELETE FROM fault_guard"),
        resultGuard(c, JSON.parse(j.trainingJson)),
        stmt(c.db, "DELETE FROM fault_guard"),
        stmt(
          c.db,
          "INSERT INTO general_learning_proposals VALUES(?,?,?,?,?,?)",
          id,
          canonical(proposed),
          requestHash,
          c.now,
          p.owner,
          p.fencingToken,
        ),
        stmt(
          c.db,
          "INSERT INTO general_learning_events VALUES(?,?,?, ?,?,?)",
          uid(),
          id,
          same ? "UNCHANGED" : "PROPOSED",
          j.baseRevision,
          c.now,
          canonical({
            protocol: ADAPTATION_PROTOCOL,
            parameters: proposed,
            trainingHash: j.trainingHash,
            trainingN: JSON.parse(j.trainingJson).length,
          }),
        ),
        stmt(
          c.db,
          "UPDATE general_learning_jobs SET state=?,leaseUntil=0 WHERE id=?",
          same ? "COMPLETE" : "VALIDATING",
          id,
        ),
      ],
      c.failAt,
    );
  } catch (error) {
    const replay = await stmt(
      c.db,
      "SELECT requestHash FROM general_learning_proposals WHERE jobId=?",
      id,
    ).first<any>();
    if (replay?.requestHash === requestHash) return { id, replayed: true };
    throw error;
  }
  return { id, state: same ? "COMPLETE" : "VALIDATING" };
}
export async function generalAdaptationReport(c: Context) {
  const active = await calibrationSnapshot(c),
    pending = await stmt(
      c.db,
      "SELECT j.id,j.state,json_array_length(j.trainingJson) trainingN,p.parametersJson proposedJson,p.proposedAt FROM general_learning_jobs j LEFT JOIN general_learning_proposals p ON p.jobId=j.id WHERE j.state IN('QUEUED','RUNNING','VALIDATING') ORDER BY j.createdAt LIMIT 1",
    ).first<any>(),
    history = await rows(
      c.db,
      "SELECT id,jobId,kind,revision,at,evidenceJson FROM general_learning_events ORDER BY rowid DESC LIMIT 20",
    );
  return {
    active,
    rules: ADAPTATION_RULES,
    pending: pending
      ? {
          ...pending,
          proposed: pending.proposedJson
            ? JSON.parse(pending.proposedJson)
            : null,
        }
      : null,
    history: history.map((r) => ({
      id: r.id,
      jobId: r.jobId,
      kind: r.kind,
      revision: r.revision,
      at: r.at,
      evidence: JSON.parse(r.evidenceJson),
    })),
    asOf: c.now,
  };
}
