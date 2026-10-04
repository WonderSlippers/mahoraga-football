import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cachedRead,
  invalidateReads,
  readSnapshot,
} from "../../apps/web/src/read-cache";
test("navigation reads reuse and deduplicate only the same query; writes invalidate old and pending snapshots", async () => {
  invalidateReads();
  let calls = 0;
  const get = () => Promise.resolve({ n: ++calls });
  const a = await cachedRead("/arena?period=ALL", get);
  assert.deepEqual(await cachedRead("/arena?period=ALL", get), a);
  assert.equal(calls, 1);
  await cachedRead("/arena?period=TODAY", get);
  assert.equal(calls, 2);
  assert.deepEqual(readSnapshot("/arena?period=ALL"), a);
  let done: any;
  const running = cachedRead(
    "/ledger",
    () =>
      new Promise((r) => {
        done = r;
      }),
  );
  assert.equal(cachedRead("/ledger", get), running);
  invalidateReads();
  const fresh = await cachedRead("/ledger", get);
  done({ n: 999 });
  await running;
  assert.deepEqual(readSnapshot("/ledger"), fresh);
  assert.equal(calls, 3);
});
test("failed reads do not poison navigation or hide errors", async () => {
  invalidateReads();
  await assert.rejects(
    cachedRead("/status", () => Promise.reject(Error("offline"))),
    /offline/,
  );
  assert.equal(readSnapshot("/status"), undefined);
  assert.equal(
    await cachedRead("/status", () => Promise.resolve("recovered")),
    "recovered",
  );
});
