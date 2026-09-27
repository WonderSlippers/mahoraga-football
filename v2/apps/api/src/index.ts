import { exactFields, sha } from "../../../packages/contracts/index";
import { stmt, one, rows, uid } from "./repositories/db";
import { place, settle, summary } from "./services/commands";
import { observe, claim, complete, demoResult } from "./services/observations";
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
  APP_SHA: string;
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
      if (env.MODE !== "DEMO") throw new Error("NETWORK_DISABLED");
      const installation = await one(
        env.DB,
        "SELECT * FROM installations WHERE id=?",
        env.INSTALLATION_ID,
      );
      if (installation.mode !== env.MODE)
        throw new Error("INSTALLATION_MISMATCH");
      const context = { db: env.DB, installationId: env.INSTALLATION_ID, now };
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
            if (size > 32768) {
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
        if (req.method !== "POST") throw new Error("NOT_FOUND");
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
          "Set-Cookie": `mahoraga_v2=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
        });
      }
      const cookie = req.headers
        .get("Cookie")
        ?.match(/(?:^|;\s*)mahoraga_v2=([^;]+)/)?.[1];
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
        if (path === "/api/v2/session") return ok({ csrf: session.csrf });
        if (path === "/api/v2/meta")
          return ok({
            installationId: env.INSTALLATION_ID,
            mode: env.MODE,
            schemaVersion: 1,
            appCodeSha: env.APP_SHA,
            network: "DISABLED",
            autoPaper: false,
            jobs: await rows(
              env.DB,
              "SELECT state,COUNT(*) AS count FROM jobs GROUP BY state",
            ),
            ports: { web: 5273, api: 8788 },
          });
        if (path === "/api/v2/models")
          return ok(await rows(env.DB, "SELECT * FROM model_manifests"));
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
              `SELECT d.*,e.ev,e.probability,e.predictionId,p.modelId,p.fixtureRevisionId,r.fixtureId,q.selection,q.decimalOdds,qs.observedAt FROM decisions d JOIN market_expectations e ON e.id=d.expectationId JOIN predictions p ON p.id=e.predictionId JOIN fixture_revisions r ON r.id=p.fixtureRevisionId JOIN quote_selections q ON q.id=e.quoteSelectionId JOIN quote_sets qs ON qs.id=q.quoteSetId ORDER BY d.decidedAt DESC LIMIT 100`,
            ),
          );
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
            predictions: await rows(
              env.DB,
              "SELECT p.* FROM predictions p JOIN fixture_revisions r ON r.id=p.fixtureRevisionId WHERE r.fixtureId=?",
              m[1],
            ),
            evidence:await rows(env.DB,"SELECT s.*,c.content FROM fixture_revisions r JOIN source_snapshots s ON s.id=r.sourceSnapshotId JOIN source_chunks c ON c.snapshotId=s.id WHERE r.fixtureId=? ORDER BY r.revision LIMIT 20",m[1]),
            bundles:await rows(env.DB,"SELECT b.id,b.cutoffAt,b.manifestHash,b.state FROM input_bundles b JOIN observation_slots s ON s.id=b.slotId JOIN fixture_revisions r ON r.id=s.fixtureRevisionId WHERE r.fixtureId=? LIMIT 20",m[1]),
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
              "SELECT t.*,l.predictionId,l.fixtureRevisionId,l.frozenOdds,l.marketSpecJson FROM tickets t JOIN ticket_legs l ON l.ticketId=t.id WHERE t.id=?",
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
