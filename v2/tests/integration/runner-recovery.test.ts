import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
// @ts-ignore shared runtime
import { engine, migrate } from "../../scripts/runtime-lib.mjs";
// @ts-ignore shared build
import { workerBuild } from "../../scripts/build.mjs";
import { observe } from "../../apps/api/src/services/observations";
import { rows, one } from "../../apps/api/src/repositories/db";

test(
  "A46 A82 actual Python process death and real lease expiry recover once",
  { timeout: 90000 },
  async () => {
    await workerBuild();
    const cfg = {
      installationId: crypto.randomUUID(),
      mode: "DEMO",
      webOrigin: "http://127.0.0.1:5293",
      bootstrap: "test",
      serviceToken: crypto.randomUUID(),
      appCodeSha: "runner-crash-test",
    };
    const mf = engine(cfg, ".runtime-v2/runner-recovery", {
      port: 0,
      persist: false,
    });
    const db = await mf.getD1Database("DB");
    await migrate(db, cfg);
    const engineOrigin = (await mf.ready).origin;
    let firstComplete = true,
      held: http.ServerResponse | undefined,
      resolveHeld: () => void = () => {},
      current: ChildProcess | undefined;
    const completeReached = new Promise<void>((r) => {
      resolveHeld = r;
    });
    const bridge = http.createServer(async (req, res) => {
      try {
        const chunks: Buffer[] = [];
        for await (const part of req) chunks.push(part);
        if (firstComplete && req.url?.endsWith("/complete")) {
          firstComplete = false;
          held = res;
          resolveHeld();
          return;
        }
        const response = await mf.dispatchFetch(engineOrigin + req.url, {
          method: req.method,
          headers: req.headers,
          body: req.method === "GET" ? undefined : Buffer.concat(chunks),
        });
        res.writeHead(response.status, { "Content-Type": "application/json" });
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        res.writeHead(503);
        res.end("{}");
      }
    });
    await new Promise<void>((r) => bridge.listen(0, "127.0.0.1", r));
    const port = (bridge.address() as any).port;
    const python = path.resolve(
      ".venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    );
    const start = () =>
      spawn(python, ["model-runner/runner.py"], {
        windowsHide: true,
        stdio: "ignore",
        env: {
          ...process.env,
          V2_API: "http://127.0.0.1:" + port,
          V2_SERVICE_TOKEN: cfg.serviceToken,
        },
      });
    const stop = async (child: ChildProcess) => {
      if (child.exitCode === null) {
        const done = new Promise<void>((r) => child.once("exit", () => r()));
        child.kill();
        await done;
      }
    };
    const began = Date.now();
    try {
      await observe(
        { db, installationId: cfg.installationId, now: began },
        "crash-observation",
      );
      current = start();
      const firstPid = current.pid;
      await Promise.race([
        completeReached,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(Error("RUNNER_DID_NOT_REACH_COMPLETE")),
            15000,
          ).unref(),
        ),
      ]);
      const leased = await one(db, "SELECT * FROM jobs WHERE state='RUNNING'");
      assert.equal(leased.attempts, 1);
      await stop(current);
      held?.writeHead(503);
      held?.end("{}");
      current = start();
      assert.notEqual(current.pid, firstPid);
      const until = Date.now() + 50000;
      while (
        (await rows(db, "SELECT * FROM predictions")).length < 2 &&
        Date.now() < until
      )
        await new Promise((r) => setTimeout(r, 250));
      const predictions = await rows(db, "SELECT * FROM predictions");
      assert.equal(predictions.length, 2);
      const recovered = await one(
        db,
        "SELECT * FROM jobs WHERE id=?",
        leased.id,
      );
      assert.equal(recovered.state, "DONE");
      assert.equal(recovered.attempts, 2);
      assert.equal(recovered.fencingToken, leased.fencingToken + 1);
      assert.equal((await rows(db, "SELECT * FROM tickets")).length, 0);
      assert.equal((await rows(db, "SELECT * FROM ledger_entries")).length, 0);
      assert.ok(
        Date.now() >= leased.leaseUntil,
        "actual lease expiry must elapse",
      );
      fs.mkdirSync(".runtime-v2/fault-evidence", { recursive: true });
      fs.writeFileSync(
        ".runtime-v2/fault-evidence/runner-recovery.json",
        JSON.stringify(
          {
            firstPid,
            restartedPid: current.pid,
            leaseUntil: leased.leaseUntil,
            finishedAt: Date.now(),
            elapsedMs: Date.now() - began,
            predictions: predictions.length,
            recoveredAttempts: recovered.attempts,
            mode: "DEMO",
            fault: "OWN_PYTHON_CHILD_KILLED_BEFORE_COMMIT",
            clock: "REAL_WALL_CLOCK",
          },
          null,
          2,
        ),
      );
    } finally {
      if (current) await stop(current);
      held?.end();
      bridge.closeAllConnections();
      await new Promise<void>((r) => bridge.close(() => r()));
      await mf.dispose();
    }
  },
);
