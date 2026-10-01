import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
// @ts-ignore local runtime
import { engine, migrate } from "../../scripts/runtime-lib.mjs";
// @ts-ignore local build
import { workerBuild } from "../../scripts/build.mjs";
import {
  captureSource,
  normalizeSnapshot,
  tickSources,
} from "../../apps/api/src/services/sources";
import { rows, one } from "../../apps/api/src/repositories/db";
import type { Context } from "../../apps/api/src/services/commands";
const recorded = fs.readFileSync(
  "tests/fixtures/openliga-recorded.json",
  "utf8",
);
let mf: any, db: D1Database, c: Context;
before(async () => {
  await workerBuild();
});
beforeEach(async () => {
  const config = {
    installationId: crypto.randomUUID(),
    mode: "LOCAL_RESEARCH",
    webOrigin: "http://127.0.0.1:5274",
    bootstrap: "test",
    serviceToken: "test",
    appCodeSha: "test",
  };
  mf = engine(config, ".runtime-v2/source-tests", {
    port: 0,
    persist: false,
    sourceFetch: async () => new Response(recorded),
  });
  db = await mf.getD1Database("DB");
  await migrate(db, config);
  c = { db, installationId: config.installationId, now: Date.now() };
});
afterEach(async () => {
  await mf.dispose();
});
test("A43 Worker HTTP capture route crosses real workerd outbound bridge", async () => {
  const origin = (await mf.ready).origin;
  const session = await mf.dispatchFetch(origin + "/api/v2/session/bootstrap", {
    method: "POST",
    headers: { Origin: "http://127.0.0.1:5274" },
    body: JSON.stringify({ passphrase: "test" }),
  });
  const token = (await session.json()).data.csrf;
  const response = await mf.dispatchFetch(origin + "/api/v2/source-captures", {
    method: "POST",
    headers: {
      Origin: "http://127.0.0.1:5274",
      Cookie: session.headers.get("set-cookie"),
      "X-CSRF-Token": token,
      "Idempotency-Key": "worker",
    },
    body: JSON.stringify({ season: 2026 }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.state, "DEGRADED", JSON.stringify(body));
  assert.equal(body.data.normalizedCount, 2);
});
test("A43 A50 complete raw capture survives downstream failure; no fake success", async () => {
  const run = await captureSource(
    c,
    "bad-schema",
    2026,
    async () => new Response('{"unexpected":true}'),
  );
  assert.equal(run.state, "NORMALIZATION_FAILED");
  assert.ok(run.snapshotId);
  assert.equal((await rows(db, "SELECT * FROM source_snapshots")).length, 1);
  assert.equal((await rows(db, "SELECT * FROM fixtures")).length, 0);
  assert.equal((await rows(db, "SELECT * FROM predictions")).length, 0);
});
test("A42 A43 A49 real recorded payload normalizes once, mode isolation and missed slots", async () => {
  const run = await captureSource(
    c,
    "recorded",
    2026,
    async () => new Response(recorded),
  );
  assert.equal(run.state, "DEGRADED");
  assert.equal(run.normalizedCount, 2);
  assert.equal((await rows(db, "SELECT * FROM portfolios")).length, 0);
  assert.equal(
    (await rows(db, "SELECT * FROM source_snapshots"))[0].mode,
    "LOCAL_RESEARCH",
  );
  assert.equal((await rows(db, "SELECT * FROM fixtures")).length, 2);
  await normalizeSnapshot(c, run.snapshotId, 2026);
  assert.equal((await rows(db, "SELECT * FROM fixtures")).length, 2);
  assert.equal((await rows(db, "SELECT * FROM observation_slots")).length, 2);
  await tickSources({ ...c, now: Date.parse("2028-01-01T00:00:00Z") });
  assert.ok(
    (await rows(db, "SELECT * FROM observation_slots")).every(
      (x) => x.state === "MISSED",
    ),
  );
  assert.equal((await rows(db, "SELECT * FROM input_bundles")).length, 0);
  assert.deepEqual(
    await captureSource(c, "recorded", 2026, async () => {
      throw Error("must not fetch");
    }),
    run,
  );
  await assert.rejects(
    captureSource(c, "recorded", 2025),
    /IDEMPOTENCY_CONFLICT/,
  );
});
test("A44 oversized responses cannot publish COMPLETE evidence", async () => {
  const run = await captureSource(
    c,
    "large",
    2026,
    async () =>
      new Response("x", {
        headers: { "content-length": String(9 * 1024 * 1024) },
      }),
  );
  assert.equal(run.reason, "PAYLOAD_LIMIT");
  assert.equal(run.snapshotId, null);
  assert.equal((await rows(db, "SELECT * FROM source_snapshots")).length, 0);
});
test("A45 source failure is persisted with retry backoff, no fabricated fixtures", async () => {
  const run = await captureSource(c, "offline", 2026, async () => {
    throw new TypeError("network");
  });
  assert.equal(run.state, "FAILED");
  assert.equal(run.reason, "SOURCE_UNAVAILABLE");
  await assert.rejects(
    captureSource(c, "retry", 2026, async () => new Response(recorded)),
    /SOURCE_BACKOFF/,
  );
  assert.equal((await rows(db, "SELECT * FROM fixtures")).length, 0);
});
test("A32 source normalization fault rolls whole publication back while preserving evidence", async () => {
  const run = await captureSource(
    { ...c, failAt: 2 },
    "fault",
    2026,
    async () => new Response(recorded),
  );
  assert.equal(run.state, "NORMALIZATION_FAILED");
  assert.equal((await rows(db, "SELECT * FROM fixtures")).length, 0);
  assert.equal(
    (await rows(db, "SELECT * FROM normalization_receipts")).length,
    0,
  );
  await normalizeSnapshot(c, run.snapshotId, 2026);
  assert.equal((await rows(db, "SELECT * FROM fixtures")).length, 2);
});

test("A45 A82 429 uses persisted backoff and recovery publishes once", async () => {
  const limited = await captureSource(
    c,
    "rate-limited",
    2026,
    async () => new Response("rate limited", { status: 429 }),
  );
  assert.equal(limited.state, "FAILED");
  assert.equal(limited.snapshotId, null);
  await assert.rejects(
    captureSource(c, "too-early", 2026, async () => new Response(recorded)),
    /SOURCE_BACKOFF/,
  );
  const recovered = await captureSource(
    { ...c, now: limited.nextAttemptAt + 1 },
    "after-backoff",
    2026,
    async () => new Response(recorded),
  );
  assert.equal(recovered.state, "DEGRADED");
  assert.equal(recovered.normalizedCount, 2);
  assert.deepEqual(
    await captureSource(c, "after-backoff", 2026, async () => {
      throw Error("must not fetch again");
    }),
    recovered,
  );
  assert.equal((await rows(db, "SELECT * FROM fixtures")).length, 2);
  assert.equal((await rows(db, "SELECT * FROM tickets")).length, 0);
});
