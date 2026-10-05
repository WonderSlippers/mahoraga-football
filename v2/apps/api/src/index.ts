import {
  claimGeneralLearning,
  proposeGeneralLearning,
  generalAdaptationReport,
} from "./services/general-adaptation";
import { exactFields, sha } from "../../../packages/contracts/index";
import { stmt, one, rows, uid } from "./repositories/db";
import { place, settle, summary } from "./services/commands";
import {
  observe,
  claim,
  complete,
  demoResult,
  heartbeat,
  failJob,
} from "./services/observations";
import { captureSource, tickSources } from "./services/sources";
import { capabilities } from "../../../packages/sources/index";
import { importPreview, importCommit, batchReport } from "./services/imports";
import { adjudicate } from "./services/adjudications";
import { reportTrade } from "./services/reported";
import { evaluate } from "./services/evaluations";
import { csvCell } from "../../../packages/evaluation/index";
import { createExport, stepExport, downloadExport } from "./services/exports";
import {
  workspaceSchedule,
  workspaceReport,
  workspaceFixture,
  workspaceMetadata,
  importWorkspace,
  modelLaboratory,
} from "./services/workspace";
import { automationTick } from "./services/automation";
import { generalMetrics } from "./services/general-metrics";
import { strategyArena } from "./services/arena";
import {
  completeVersion,
  versionPaperStep,
  versionsReport,
  versionDirections,
  versionMetrics,
  selectedVersion,
} from "./services/versions";
import {
  completeUniversal,
  universalReport,
  autoPaper,
  configurePaper,
} from "./services/universal";
import {
  comparisonFeatures,
  comparisonReport,
  completeComparison,
} from "./services/comparison";
let bootstrapWindow = 0,
  bootstrapAttempts = 0;
function wire(data: unknown): unknown {
  return JSON.parse(
    JSON.stringify(data, (key, value) => {
      if (typeof value === "number" && (key.endsWith("At") || key === "at"))
        return new Date(value).toISOString();
      if (
        typeof value === "number" &&
        [
          "stakeAtoms",
          "gross",
          "delta",
          "available",
          "openStake",
          "realized",
          "initial",
        ].includes(key)
      )
        return String(value);
      return value;
    }),
  );
}
export interface Env {
  DB: D1Database;
  INSTALLATION_ID: string;
  MODE: string;
  WEB_ORIGIN: string;
  API_HOST: string;
  BOOTSTRAP_HASH: string;
  SERVICE_TOKEN: string;
  LOCAL_SESSION_TOKEN: string;
  APP_SHA: string;
  APP_BUILD_HASH: string;
}
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const requestId = uid(),
      now = Date.now(),
      url = new URL(req.url),
      path = url.pathname;
    const ok = (
      data: unknown,
      status = 200,
      headers: Record<string, string> = {},
    ) =>
      Response.json(
        {
          data: path.startsWith("/internal/") ? data : wire(data),
          meta: {
            requestId,
            asOf: new Date(now).toISOString(),
            mode: env.MODE,
          },
        },
        { status, headers: { "Cache-Control": "no-store", ...headers } },
      );
    try {
      if (url.host !== env.API_HOST) throw new Error("HOST_INVALID");
      if (
        req.headers.has("Origin") &&
        req.headers.get("Origin") !== env.WEB_ORIGIN
      )
        throw new Error("ORIGIN_INVALID");
      if (!["DEMO", "LOCAL_RESEARCH"].includes(env.MODE))
        throw new Error("NETWORK_DISABLED");
      const installation = await one(
        env.DB,
        "SELECT * FROM installations WHERE id=?",
        env.INSTALLATION_ID,
      );
      if (installation.mode !== env.MODE)
        throw new Error("INSTALLATION_MISMATCH");
      const context = { db: env.DB, installationId: env.INSTALLATION_ID, now };
      const cookieName =
        env.MODE === "DEMO" ? "mahoraga_v2" : "mahoraga_v2_research";
      const isWrite = req.method !== "GET";
      let body: Record<string, any> = {};
      if (isWrite) {
        const reader = req.body?.getReader();
        let size = 0;
        const parts: Uint8Array[] = [];
        if (reader) {
          while (true) {
            const x = await reader.read();
            if (x.done) break;
            size += x.value.byteLength;
            if (
              size >
              ([
                "/api/v2/imports/preview",
                "/api/v2/imports/commit",
                "/internal/v2/workspace-import",
                "/internal/v2/archive-import",
              ].includes(path)
                ? 9 * 1024 * 1024
                : 32768)
            ) {
              await reader.cancel();
              throw new Error("PAYLOAD_LIMIT");
            }
            parts.push(x.value);
          }
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const p of parts) {
          bytes.set(p, offset);
          offset += p.length;
        }
        try {
          body = JSON.parse(new TextDecoder().decode(bytes) || "{}");
        } catch {
          throw new Error("INVALID_JSON");
        }
      }
      if (path.startsWith("/internal/v2/")) {
        if (
          req.headers.has("Origin") ||
          req.headers.get("Authorization") !== `Bearer ${env.SERVICE_TOKEN}`
        )
          throw new Error("AUTH_REQUIRED");
        const bundleMatch = path.match(
          /^\/internal\/v2\/input-bundles\/([^/]+)\/chunks$/,
        );
        if (bundleMatch && req.method === "GET") {
          const offset = Number(url.searchParams.get("offset") || 0);
          if (!Number.isInteger(offset) || offset < 0 || offset > 8388608)
            throw Error("INVALID_CURSOR");
          const b = await one(
            env.DB,
            "SELECT canonical,manifestHash FROM input_bundles WHERE id=? AND state='READY'",
            bundleMatch[1],
          );
          const bytes = new TextEncoder().encode(b.canonical),
            part = bytes.slice(offset, offset + 32768);
          return ok({
            contentBase64: btoa(
              Array.from(part, (n) => String.fromCharCode(n)).join(""),
            ),
            offset,
            offsetUnit: "UTF8_BYTES",
            nextOffset:
              offset + part.length < bytes.length ? offset + part.length : null,
            manifestHash: b.manifestHash,
          });
        }
        if (
          path === "/internal/v2/comparison/targets" &&
          req.method === "GET"
        ) {
          return ok(
            await rows(
              env.DB,
              "SELECT f.id fixtureId,f.home,f.away,r.kickoffAt,cat.competition FROM fixtures f JOIN fixture_revisions r ON r.fixtureId=f.id AND r.revision=f.currentRevision JOIN fixture_catalog cat ON cat.fixtureId=f.id WHERE f.status='SCHEDULED' AND r.kickoffAt>? AND cat.competition IN('eng.1','ger.1','ita.1','esp.1','fra.1') ORDER BY r.kickoffAt LIMIT 100",
              now,
            ),
          );
        }
        if (req.method !== "POST") throw new Error("NOT_FOUND");
        if (path === "/internal/v2/comparison/features") {
          exactFields(body, ["fixtureId", "payload", "sources"]);
          return ok(await comparisonFeatures(context, body));
        }
        const researchComplete = path.match(
          /^\/internal\/v2\/model-jobs\/([^/]+)\/complete-comparison$/,
        );
        const versionComplete = path.match(
          /^\/internal\/v2\/model-jobs\/([^/]+)\/complete-version$/,
        );
        if (versionComplete) {
          exactFields(body, [
            "owner",
            "fencingToken",
            "bundleHash",
            "modelHash",
            "featureCanonical",
            "output",
          ]);
          return ok(await completeVersion(context, versionComplete[1], body));
        }
        const universalComplete = path.match(
          /^\/internal\/v2\/model-jobs\/([^/]+)\/complete-universal$/,
        );
        if (universalComplete) {
          exactFields(body, [
            "owner",
            "fencingToken",
            "bundleHash",
            "modelHash",
            "featureCanonical",
            "output",
          ]);
          const completed = await completeUniversal(
            context,
            universalComplete[1],
            body,
          );
          return ok(completed);
        }
        if (path === "/internal/v2/general-learning/claim") {
          exactFields(body, ["owner"]);
          return ok(await claimGeneralLearning(context, body.owner));
        }
        const learningProposal = path.match(
          /^\/internal\/v2\/general-learning\/([^/]+)\/propose$/,
        );
        if (learningProposal) {
          exactFields(body, [
            "owner",
            "fencingToken",
            "trainingHash",
            "parameters",
          ]);
          return ok(
            await proposeGeneralLearning(context, learningProposal[1], body),
          );
        }
        if (path === "/internal/v2/paper/step") {
          exactFields(body, []);
          return ok({
            general: await autoPaper(context),
            versions: await versionPaperStep(context),
          });
        }
        if (researchComplete) {
          exactFields(body, [
            "owner",
            "fencingToken",
            "bundleHash",
            "modelHash",
            "featureCanonical",
            "output",
          ]);
          return ok(
            await completeComparison(context, researchComplete[1], body),
          );
        }
        if (path === "/internal/v2/workspace-import") {
          exactFields(body, [
            "sourceHash",
            "sourceCutoffAt",
            "metadata",
            "study",
          ]);
          return ok(await importWorkspace(context, body));
        }
        if (path === "/internal/v2/archive-import") {
          exactFields(body, ["namespace", "files"]);
          const preview = await importPreview(context, body as any);
          const result = await importCommit(context, {
            previewId: preview.id,
            files: body.files,
            previewHash: preview.previewHash,
          });
          return ok(result);
        }
        if (path === "/internal/v2/export-jobs/step") {
          exactFields(body, []);
          return ok(await stepExport(context));
        }
        if (path === "/internal/v2/automation/tick") {
          exactFields(body, []);
          return ok(await automationTick(context, env.MODE));
        }
        const leaseMatch = path.match(
          /^\/internal\/v2\/model-jobs\/([^/]+)\/(heartbeat|fail)$/,
        );
        if (leaseMatch) {
          exactFields(
            body,
            leaseMatch[2] === "heartbeat"
              ? ["owner", "fencingToken"]
              : ["owner", "fencingToken", "reason", "retryable"],
          );
          return ok(
            leaseMatch[2] === "heartbeat"
              ? await heartbeat(context, leaseMatch[1], body as any)
              : await failJob(context, leaseMatch[1], body as any),
          );
        }
        if (path === "/internal/v2/scheduler/tick") {
          exactFields(body, []);
          await tickSources(context);
          await stmt(
            env.DB,
            "INSERT INTO runtime_health VALUES('PYTHON_PULL_RUNNER',?) ON CONFLICT(component) DO UPDATE SET lastSeenAt=excluded.lastSeenAt",
            now,
          ).run();
          return ok({ tickedAt: now });
        }
        if (path === "/internal/v2/model-jobs/claim") {
          exactFields(body, ["owner"]);
          if (typeof body.owner !== "string" || body.owner.length > 100)
            throw new Error("INVALID_FIELDS");
          return ok(await claim(context, body.owner));
        }
        const match = path.match(
          /^\/internal\/v2\/model-jobs\/([^/]+)\/complete$/,
        );
        if (match) {
          exactFields(body, [
            "owner",
            "fencingToken",
            "bundleHash",
            "modelHash",
            "central",
            "featureCanonical",
          ]);
          return ok(await complete(context, match[1], body as any));
        }
        throw new Error("NOT_FOUND");
      }
      if (isWrite && req.headers.get("Origin") !== env.WEB_ORIGIN)
        throw new Error("ORIGIN_INVALID");
      if (path === "/api/v2/session/local" && req.method === "POST") {
        if (
          !env.LOCAL_SESSION_TOKEN ||
          req.headers.get("X-V2-Local-Capability") !== env.LOCAL_SESSION_TOKEN
        )
          throw new Error("AUTH_REQUIRED");
        exactFields(body, []);
        const id = uid(),
          csrf = uid();
        await stmt(
          env.DB,
          "INSERT INTO sessions VALUES(?,?,?)",
          id,
          csrf,
          now + 86400000,
        ).run();
        return ok({ csrf }, 200, {
          "Set-Cookie": `${cookieName}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
        });
      }
      if (path === "/api/v2/session/bootstrap" && req.method === "POST") {
        if (now - bootstrapWindow > 60000) {
          bootstrapWindow = now;
          bootstrapAttempts = 0;
        }
        if (++bootstrapAttempts > 20) throw new Error("RATE_LIMITED");
        exactFields(body, ["passphrase"]);
        if (
          typeof body.passphrase !== "string" ||
          (await sha(body.passphrase)) !== env.BOOTSTRAP_HASH
        )
          throw new Error("AUTH_REQUIRED");
        const id = uid(),
          csrf = uid();
        try {
          await env.DB.batch([
            stmt(
              env.DB,
              "INSERT INTO bootstrap_uses VALUES(?,?)",
              env.BOOTSTRAP_HASH,
              now,
            ),
            stmt(
              env.DB,
              "INSERT INTO sessions VALUES(?,?,?)",
              id,
              csrf,
              now + 86400000,
            ),
          ]);
        } catch {
          throw new Error("BOOTSTRAP_USED");
        }
        return ok({ csrf }, 200, {
          "Set-Cookie": `${cookieName}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
        });
      }
      const cookie = req.headers
        .get("Cookie")
        ?.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`))?.[1];
      const session = cookie
        ? await stmt(
            env.DB,
            "SELECT * FROM sessions WHERE id=? AND expiresAt>?",
            cookie,
            now,
          ).first<any>()
        : null;
      if (!session) throw new Error("AUTH_REQUIRED");
      if (isWrite && req.headers.get("X-CSRF-Token") !== session.csrf)
        throw new Error("CSRF_INVALID");
      const key = req.headers.get("Idempotency-Key") || "";
      if (req.method === "GET") {
        if (path === "/api/v2/workspace/versions")
          return ok({
            ...(await versionsReport(context)),
            results: await Promise.all(
              ["GENERAL", "SEPTEMBER20", "V6"].map((version) =>
                strategyArena(
                  context,
                  new URLSearchParams({ version, period: "ALL" }),
                ),
              ),
            ),
          });
        if (path === "/api/v2/workspace/arena")
          return ok(await strategyArena(context, url.searchParams));
        if (path === "/api/v2/workspace/schedule")
          return ok(await workspaceSchedule(context, url.searchParams));
        if (path === "/api/v2/workspace/history")
          return ok(
            await workspaceReport(context, url.searchParams, "history"),
          );
        if (path === "/api/v2/workspace/ledger")
          return ok(await workspaceReport(context, url.searchParams, "ledger"));
        if (path === "/api/v2/workspace/models")
          return ok(await modelLaboratory(context, url.searchParams));
        if (path === "/api/v2/workspace/comparison")
          return ok(await comparisonReport(context, url.searchParams));
        if (path === "/api/v2/workspace/general-adaptation")
          return ok(await generalAdaptationReport(context));
        if (path === "/api/v2/workspace/universal")
          return ok(
            selectedVersion(url.searchParams).id === "GENERAL"
              ? await universalReport(context, url.searchParams)
              : await versionDirections(context, url.searchParams),
          );
        if (path === "/api/v2/workspace/universal-metrics")
          return ok(
            selectedVersion(url.searchParams).id === "GENERAL"
              ? await generalMetrics(context)
              : await versionMetrics(context, url.searchParams),
          );
        if (path === "/api/v2/workspace/paper-policies") {
          return ok(
            await rows(
              env.DB,
              "SELECT pp.*,p.available,p.openStake,p.realized,p.initial,p.revision accountRevision,(SELECT COUNT(*) FROM tickets WHERE portfolioId=p.id) ticketN FROM paper_policies pp JOIN portfolios p ON p.id=pp.portfolioId ORDER BY pp.rowid",
            ),
          );
        }
        if (path === "/api/v2/workspace/settings")
          return ok(await workspaceMetadata(env.DB));
        if (path === "/api/v2/workspace/status")
          return ok({
            leagues: (await workspaceMetadata(env.DB)).leagues,
            automation: await rows(env.DB, "SELECT * FROM automation_state"),
            sources: await rows(
              env.DB,
              "SELECT * FROM source_runs ORDER BY startedAt DESC LIMIT 30",
            ),
            runner: await rows(env.DB, "SELECT * FROM runtime_health"),
            queue: await rows(
              env.DB,
              "SELECT state,COUNT(*) count FROM jobs GROUP BY state",
            ),
            mode: env.MODE,
            asOf: now,
          });
        const workspaceDetail = path.match(
          /^\/api\/v2\/workspace\/fixtures\/([^/]+)$/,
        );
        if (workspaceDetail)
          return ok(
            await workspaceFixture(
              context,
              decodeURIComponent(workspaceDetail[1]),
              url.searchParams,
            ),
          );
        if (path === "/api/v2/export-jobs")
          return ok(
            await rows(
              env.DB,
              "SELECT id,mode,createdAt,state,rowsExported,nextChunk,chainHash,reason FROM export_jobs ORDER BY createdAt DESC LIMIT 30",
            ),
          );
        const download = path.match(
          /^\/api\/v2\/export-jobs\/([a-f0-9-]+)\/download$/,
        );
        if (download) return await downloadExport(env.DB, download[1]);
        if (path === "/api/v2/fixture-page") {
          const state = url.searchParams.get("status") || "SCHEDULED";
          if (!["SCHEDULED", "FINISHED", "ALL"].includes(state))
            throw Error("INVALID_FILTER");
          const ascending = state === "SCHEDULED",
            afterAt = url.searchParams.get("afterAt"),
            afterId = url.searchParams.get("afterId");
          const at = afterAt === null ? null : Date.parse(afterAt);
          if (
            afterAt !== null &&
            (!Number.isFinite(at) || !afterId || afterId.length > 100)
          )
            throw Error("INVALID_CURSOR");
          const conditions = ["r.revision=f.currentRevision"];
          const params: any[] = [];
          if (state !== "ALL") {
            conditions.push("f.status=?");
            params.push(state);
          }
          if (at !== null) {
            conditions.push(
              `(r.kickoffAt,r.id) ${ascending ? ">" : "<"} (?,?)`,
            );
            params.push(at, afterId);
          }
          const page = await rows(
            env.DB,
            `SELECT f.*,r.kickoffAt,r.id revisionId,(SELECT COUNT(*) FROM predictions p JOIN market_expectations e ON e.predictionId=p.id JOIN decisions d ON d.expectationId=e.id WHERE p.fixtureRevisionId=r.id) decisionCount FROM fixture_revisions r JOIN fixtures f ON f.id=r.fixtureId WHERE ${conditions.join(" AND ")} ORDER BY r.kickoffAt ${ascending ? "ASC" : "DESC"},r.id ${ascending ? "ASC" : "DESC"} LIMIT 51`,
            ...params,
          );
          return ok({
            items: page.slice(0, 50),
            nextCursor:
              page.length > 50
                ? { at: page[49].kickoffAt, id: page[49].revisionId }
                : null,
          });
        }
        if (path === "/api/v2/reported-trades")
          return ok(
            await rows(
              env.DB,
              `SELECT e.* FROM reported_trade_events e WHERE e.revision=(SELECT MAX(r.revision) FROM reported_trade_events r WHERE r.account=e.account AND r.externalKey=e.externalKey) ORDER BY e.at DESC,e.id LIMIT 100`,
            ),
          );
        const reportedMatch = path.match(
          /^\/api\/v2\/reported-trades\/([^/]+)\/history$/,
        );
        if (reportedMatch) {
          const original = await one(
            env.DB,
            "SELECT account,externalKey FROM reported_trade_events WHERE id=?",
            reportedMatch[1],
          );
          return ok(
            await rows(
              env.DB,
              "SELECT * FROM reported_trade_events WHERE account=? AND externalKey=? ORDER BY revision LIMIT 100",
              original.account,
              original.externalKey,
            ),
          );
        }
        if (path === "/api/v2/evaluations")
          return ok(
            await rows(
              env.DB,
              "SELECT * FROM evaluation_runs ORDER BY createdAt DESC LIMIT 30",
            ),
          );
        const evalMatch = path.match(
          /^\/api\/v2\/evaluations\/([^/]+)(\/csv)?$/,
        );
        if (evalMatch) {
          const run = await one(
            env.DB,
            "SELECT * FROM evaluation_runs WHERE id=?",
            evalMatch[1],
          );
          if (evalMatch[2]) {
            const metrics = JSON.parse(run.metricsJson);
            const lines = [
              [
                "mode",
                "protocol",
                "asOf",
                "modelId",
                "sampleCount",
                "brier",
                "logLoss",
                "settledStakeAtoms",
                "profitAtoms",
                "roi",
                "manifestHash",
              ],
              ...Object.entries(metrics).map(([id, m]: any) => [
                run.mode,
                run.protocol,
                new Date(run.asOf).toISOString(),
                id,
                m.sampleCount,
                m.brier,
                m.logLoss,
                m.settledStakeAtoms,
                m.profitAtoms,
                m.roi,
                run.manifestHash,
              ]),
            ];
            return new Response(
              "\uFEFF" +
                lines.map((row) => row.map(csvCell).join(",")).join("\r\n"),
              {
                headers: {
                  "Content-Type": "text/csv; charset=utf-8",
                  "Content-Disposition":
                    'attachment; filename="evaluation.csv"',
                  "Cache-Control": "no-store",
                },
              },
            );
          }
          const offset = Number(url.searchParams.get("offset") || 0);
          if (!Number.isSafeInteger(offset) || offset < 0)
            throw Error("INVALID_CURSOR");
          const samples = await rows(
            env.DB,
            "SELECT * FROM evaluation_samples WHERE evaluationId=? AND ordinal>=? ORDER BY ordinal LIMIT 51",
            run.id,
            offset,
          );
          return ok({
            ...run,
            metrics: JSON.parse(run.metricsJson),
            samples: samples.slice(0, 50),
            nextOffset: samples.length > 50 ? samples[49].ordinal + 1 : null,
          });
        }
        if (path === "/api/v2/imports")
          return ok(
            (
              await rows(
                env.DB,
                "SELECT * FROM import_batches ORDER BY createdAt DESC LIMIT 20",
              )
            ).map(batchReport),
          );
        const fileMatch = path.match(
          /^\/api\/v2\/imports\/([^/]+)\/files\/(\d+)\/chunks$/,
        );
        if (fileMatch) {
          const batch = await one(
            env.DB,
            "SELECT * FROM import_batches WHERE id=? AND state IN('PREVIEW','COMMITTED')",
            fileMatch[1],
          );
          const index = Number(fileMatch[2]),
            after = Number(url.searchParams.get("after") ?? -1);
          if (!Number.isInteger(after) || after < -1)
            throw Error("INVALID_CURSOR");
          const chunks = await rows(
            env.DB,
            "SELECT chunkNo,content FROM import_file_chunks WHERE batchId=? AND fileIndex=? AND chunkNo>? ORDER BY chunkNo LIMIT 5",
            batch.id,
            index,
            after,
          );
          return ok({
            chunks: chunks.slice(0, 4),
            nextCursor: chunks.length > 4 ? chunks[3].chunkNo : null,
          });
        }
        if (path === "/api/v2/archives") {
          const after = url.searchParams.get("after") || "";
          const portfolio = url.searchParams.get("portfolio");
          const page = await rows(
            env.DB,
            `SELECT a.id,a.portfolio,a.kind,a.originalId,a.stakeAtoms,a.pnlAtoms,a.legCount,a.status,a.currency,a.mode,a.warningsJson FROM archive_records a JOIN import_batches b ON b.id=a.batchId WHERE b.state='COMMITTED' AND a.id>? ${portfolio ? "AND a.portfolio=?" : ""} ORDER BY a.id LIMIT 51`,
            ...(portfolio ? [after, portfolio] : [after]),
          );
          return ok({
            items: page.slice(0, 50),
            nextCursor: page.length > 50 ? page[49].id : null,
          });
        }
        const archiveMatch = path.match(/^\/api\/v2\/archives\/([^/]+)$/);
        if (archiveMatch)
          return ok(
            await one(
              env.DB,
              "SELECT a.* FROM archive_records a JOIN import_batches b ON b.id=a.batchId WHERE b.state='COMMITTED' AND a.id=?",
              archiveMatch[1],
            ),
          );
        if (path === "/api/v2/session") return ok({ csrf: session.csrf });
        if (path === "/api/v2/meta")
          return ok({
            installationId: env.INSTALLATION_ID,
            mode: env.MODE,
            schemaVersion: installation.schemaVersion,
            appCodeSha: env.APP_SHA,
            workerBuildHash: env.APP_BUILD_HASH || null,
            health: await rows(
              env.DB,
              "SELECT component,lastSeenAt FROM runtime_health",
            ),
            network: env.MODE === "DEMO" ? "DISABLED" : "OPENLIGADB_ALLOWLIST",
            autoPaper:
              env.MODE === "LOCAL_RESEARCH" &&
              !!(await stmt(
                env.DB,
                "SELECT id FROM paper_policies WHERE enabled=1 LIMIT 1",
              ).first()),
            jobs: await rows(
              env.DB,
              "SELECT state,COUNT(*) AS count FROM jobs GROUP BY state",
            ),
            ports: {
              web: Number(new URL(env.WEB_ORIGIN).port),
              api: Number(env.API_HOST.split(":")[1]),
            },
          });
        if (path === "/api/v2/models")
          return ok(await rows(env.DB, "SELECT * FROM model_manifests"));
        if (path === "/api/v2/sources")
          return ok({
            capabilities,
            mode: env.MODE,
            autoPaper: false,
            runs: await rows(
              env.DB,
              "SELECT * FROM source_runs ORDER BY startedAt DESC LIMIT 20",
            ),
            coverage: await rows(
              env.DB,
              "SELECT s.competition,s.season,f.status,COUNT(*) count FROM fixture_sources s JOIN fixtures f ON f.id=s.fixtureId GROUP BY s.competition,s.season,f.status",
            ),
            slots: await rows(
              env.DB,
              "SELECT state,reason,COUNT(*) count FROM observation_slots GROUP BY state,reason",
            ),
          });
        if (path === "/api/v2/fixtures")
          return ok(
            await rows(
              env.DB,
              "SELECT f.*,r.kickoffAt,r.id AS revisionId FROM fixtures f JOIN fixture_revisions r ON r.fixtureId=f.id AND r.revision=f.currentRevision ORDER BY r.kickoffAt DESC LIMIT 50",
            ),
          );
        if (path === "/api/v2/decisions")
          return ok(
            await rows(
              env.DB,
              `SELECT d.*,e.ev,e.probability,e.predictionId,p.modelId,p.fixtureRevisionId,r.fixtureId,q.selection,q.decimalOdds,qs.observedAt FROM decisions d JOIN market_expectations e ON e.id=d.expectationId JOIN predictions p ON p.id=e.predictionId JOIN fixture_revisions r ON r.id=p.fixtureRevisionId JOIN quote_selections q ON q.id=e.quoteSelectionId JOIN quote_sets qs ON qs.id=q.quoteSetId ${url.searchParams.has("fixtureId") ? "WHERE r.fixtureId=?" : ""} ORDER BY d.decidedAt DESC LIMIT 100`,
              ...(url.searchParams.has("fixtureId")
                ? [url.searchParams.get("fixtureId")]
                : []),
            ),
          );
        if (path === "/api/v2/quote-page") {
          const marketId = url.searchParams.get("marketId"),
            at = url.searchParams.get("afterAt"),
            id = url.searchParams.get("afterId");
          if (!marketId || marketId.length > 100) throw Error("INVALID_MARKET");
          const values: any[] = [marketId];
          let cursor = "";
          if (at !== null) {
            const time = Date.parse(at);
            if (!Number.isFinite(time) || !id || id.length > 100)
              throw Error("INVALID_CURSOR");
            cursor = " AND (observedAt,id)<(?,?)";
            values.push(time, id);
          }
          const page = await rows(
            env.DB,
            `SELECT * FROM quote_sets WHERE marketId=?${cursor} ORDER BY observedAt DESC,id DESC LIMIT 51`,
            ...values,
          );
          return ok({
            items: page.slice(0, 50),
            nextCursor:
              page.length > 50
                ? { at: page[49].observedAt, id: page[49].id }
                : null,
            qualification:
              "Raw quote sets; completeness must be verified against selections before pricing",
          });
        }
        if (path === "/api/v2/ticket-page") {
          const at = url.searchParams.get("afterAt"),
            id = url.searchParams.get("afterId"),
            conditions: string[] = [],
            params: any[] = [];
          if (at !== null) {
            const stamp = Date.parse(at);
            if (!Number.isFinite(stamp) || !id || id.length > 100)
              throw Error("INVALID_CURSOR");
            conditions.push("(t.createdAt,t.id)<(?,?)");
            params.push(stamp, id);
          }
          const page = await rows(
            env.DB,
            `SELECT t.*,s.currentStatus,s.gross,s.revision settlementRevision,l.predictionId,l.selection,l.frozenOdds FROM tickets t JOIN ticket_state s ON s.ticketId=t.id JOIN ticket_legs l ON l.ticketId=t.id ${conditions.length ? "WHERE " + conditions.join(" AND ") : ""} ORDER BY t.createdAt DESC,t.id DESC LIMIT 51`,
            ...params,
          );
          return ok({
            items: page.slice(0, 50),
            nextCursor:
              page.length > 50
                ? { at: page[49].createdAt, id: page[49].id }
                : null,
          });
        }
        if (path === "/api/v2/tickets")
          return ok(
            await rows(
              env.DB,
              "SELECT t.*,s.currentStatus,s.gross,s.revision AS settlementRevision,l.predictionId,l.selection,l.frozenOdds FROM tickets t JOIN ticket_state s ON s.ticketId=t.id JOIN ticket_legs l ON l.ticketId=t.id ORDER BY t.createdAt DESC LIMIT 100",
            ),
          );
        if (path === "/api/v2/portfolios/demo/summary")
          return ok(await summary(env.DB, "demo"));
        let m = path.match(/^\/api\/v2\/fixtures\/([^/]+)$/);
        if (m) {
          const fixture = await one(
            env.DB,
            "SELECT * FROM fixtures WHERE id=?",
            m[1],
          );
          return ok({
            ...fixture,
            revisions: await rows(
              env.DB,
              "SELECT * FROM fixture_revisions WHERE fixtureId=? ORDER BY revision",
              m[1],
            ),
            adjudications: await rows(
              env.DB,
              "SELECT * FROM result_adjudications WHERE fixtureId=? ORDER BY revision",
              m[1],
            ),
            resultObservations: await rows(
              env.DB,
              "SELECT * FROM result_observations WHERE fixtureId=? ORDER BY observedAt DESC,id LIMIT 100",
              m[1],
            ),
            predictions: await rows(
              env.DB,
              "SELECT p.* FROM predictions p JOIN fixture_revisions r ON r.id=p.fixtureRevisionId WHERE r.fixtureId=?",
              m[1],
            ),
            evidence: await rows(
              env.DB,
              "SELECT s.*,c.content FROM fixture_revisions r JOIN source_snapshots s ON s.id=r.sourceSnapshotId JOIN source_chunks c ON c.snapshotId=s.id WHERE r.fixtureId=? ORDER BY r.revision LIMIT 20",
              m[1],
            ),
            bundles: await rows(
              env.DB,
              "SELECT b.id,b.cutoffAt,b.manifestHash,b.state FROM input_bundles b JOIN observation_slots s ON s.id=b.slotId JOIN fixture_revisions r ON r.id=s.fixtureRevisionId WHERE r.fixtureId=? LIMIT 20",
              m[1],
            ),
          });
        }
        m = path.match(/^\/api\/v2\/predictions\/([^/]+)(\/explanation)?$/);
        if (m) {
          const p = await one(
            env.DB,
            "SELECT * FROM predictions WHERE id=?",
            m[1],
          );
          const expectations = await rows(
            env.DB,
            "SELECT e.*,q.selection,q.decimalOdds FROM market_expectations e JOIN quote_selections q ON q.id=e.quoteSelectionId WHERE e.predictionId=?",
            m[1],
          );
          return ok({
            prediction: p,
            expectations,
            templateVersion: "PERSISTED_EXPECTATION_V1",
            meaning: "冻结中心概率；DEMO 非真实模型验证",
          });
        }
        m = path.match(/^\/api\/v2\/tickets\/([^/]+)$/);
        if (m)
          return ok({
            original: await one(
              env.DB,
              "SELECT t.*,l.predictionId,l.fixtureRevisionId,l.frozenOdds,l.marketSpecJson,r.fixtureId FROM tickets t JOIN ticket_legs l ON l.ticketId=t.id JOIN fixture_revisions r ON r.id=l.fixtureRevisionId WHERE t.id=?",
              m[1],
            ),
            current: await one(
              env.DB,
              "SELECT * FROM ticket_state WHERE ticketId=?",
              m[1],
            ),
            events: await rows(
              env.DB,
              "SELECT * FROM settlement_events WHERE ticketId=? ORDER BY revision",
              m[1],
            ),
          });
        if (path === "/api/v2/export")
          return ok({
            mode: "DEMO",
            tickets: await rows(
              env.DB,
              "SELECT t.*,l.predictionId FROM tickets t JOIN ticket_legs l ON l.ticketId=t.id LIMIT 100",
            ),
            predictions: await rows(
              env.DB,
              "SELECT * FROM predictions LIMIT 100",
            ),
            note: "首版有界 DEMO 导出，上限100条",
          });
      }
      if (req.method === "POST") {
        if (path === "/api/v2/workspace/paper-policies") {
          exactFields(body, [
            "id",
            "enabled",
            "maximumPerDay",
            "expectedRevision",
          ]);
          return ok(await configurePaper(context, key, body));
        }
        if (path === "/api/v2/workspace/refresh") {
          exactFields(body, []);
          return ok(await automationTick(context, env.MODE, true));
        }
        if (path === "/api/v2/workspace/automation") {
          exactFields(body, ["enabled"]);
          if (typeof body.enabled !== "boolean") throw Error("INVALID_FIELDS");
          await stmt(
            env.DB,
            "UPDATE automation_state SET enabled=? WHERE id='LOCAL_PIPELINE'",
            body.enabled ? 1 : 0,
          ).run();
          return ok({ enabled: body.enabled });
        }
        if (path === "/api/v2/export-jobs") {
          exactFields(body, []);
          return ok(await createExport(context, key), 202);
        }
        if (path === "/api/v2/reported-trades") {
          exactFields(body, [
            "account",
            "externalKey",
            "expectedRevision",
            "stakeAtoms",
            "grossClaimAtoms",
            "currency",
            "description",
            "evidenceNote",
            "reason",
          ]);
          return ok(await reportTrade(context, key, body as any));
        }
        if (path === "/api/v2/evaluations") {
          exactFields(body, ["asOf"]);
          return ok(await evaluate(context, key, body as any));
        }
        if (path === "/api/v2/result-adjudications") {
          exactFields(body, [
            "fixtureId",
            "expectedRevision",
            "selectedEvidenceId",
            "reason",
          ]);
          return ok(await adjudicate(context, key, body as any));
        }
        if (path === "/api/v2/imports/preview") {
          exactFields(body, ["namespace", "files"]);
          return ok(await importPreview(context, body as any));
        }
        if (path === "/api/v2/imports/commit") {
          exactFields(body, ["previewId", "previewHash", "files"]);
          return ok(await importCommit(context, body as any));
        }
        if (path === "/api/v2/source-captures") {
          exactFields(body, ["season"]);
          return ok(await captureSource(context, key, body.season));
        }
        if (env.MODE !== "DEMO") throw Error("RESEARCH_READ_ONLY");
        if (path === "/api/v2/observation-requests") {
          exactFields(body, []);
          return ok(await observe(context, key), 202);
        }
        if (path === "/api/v2/paper-tickets") {
          exactFields(body, [
            "decisionId",
            "portfolioId",
            "stakeAtoms",
            "expectedRevision",
          ]);
          return ok(await place(context, key, body as any), 201);
        }
        if (path === "/api/v2/demo/results") {
          exactFields(body, [
            "fixtureId",
            "scenario",
            "expectedRevision",
            "reason",
          ]);
          return ok(await demoResult(context, key, body as any));
        }
        if (path === "/api/v2/settlement-requests") {
          exactFields(body, ["ticketId", "adjudicationId", "expectedRevision"]);
          return ok(await settle(context, key, body as any));
        }
      }
      throw new Error("NOT_FOUND");
    } catch (e) {
      if (path === "/internal/v2/paper/step")
        console.error(
          "PAPER_STEP_FAILED",
          e instanceof Error ? e.stack : String(e),
        );
      let code = e instanceof Error ? e.message : "INTERNAL_ERROR";
      if (!/^[A-Z][A-Z0-9_]*$/.test(code)) code = "COMMAND_REJECTED";
      const status =
        code === "NOT_FOUND"
          ? 404
          : code.includes("AUTH")
            ? 401
            : ["HOST_INVALID", "ORIGIN_INVALID", "CSRF_INVALID"].includes(code)
              ? 403
              : code.includes("CONFLICT") ||
                  code.includes("DUPLICATE") ||
                  code === "LEASE_EXPIRED"
                ? 409
                : 400;
      return Response.json(
        { error: { code, message: code, retryable: false, requestId } },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    }
  },
};
