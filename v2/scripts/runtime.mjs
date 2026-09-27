import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "vite";
import { safeState, root, freePort, modeGuard } from "./safety.mjs";
import { runtime, config, engine, migrate } from "./runtime-lib.mjs";
import { workerBuild } from "./build.mjs";
import { localSessionPlugin } from "./local-session.mjs";
process.chdir(root);
const command = process.argv[2];
modeGuard(process.env.V2_MODE || "DEMO", process.env.V2_HOST || "127.0.0.1");
const dir = runtime();
const python = path.join(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
if (command === "doctor") {
  await freePort(5273);
  await freePort(8788);
  console.log(
    JSON.stringify({
      node: process.version,
      python: fs.existsSync(python),
      mode: "DEMO",
      state: "isolated .runtime-v2 profile",
      ports: [5273, 8788],
      network: false,
    }),
  );
} else if (command === "bootstrap") {
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === "win32") {
    const user = execFileSync("whoami", [], { encoding: "utf8" }).trim();
    execFileSync(
      "icacls",
      [dir, "/inheritance:r", "/grant:r", user + ":(OI)(CI)F"],
      { stdio: "ignore", windowsHide: true },
    );
  }
  let c;
  if (fs.existsSync(path.join(dir, "manifest.json"))) c = config(dir);
  else {
    c = {
      installationId: crypto.randomUUID(),
      mode: "DEMO",
      bootstrap: crypto.randomBytes(24).toString("hex"),
      serviceToken: crypto.randomBytes(32).toString("hex"),
      webOrigin: "http://127.0.0.1:5273",
      appCodeSha: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
    };
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify(c, null, 2),
      { mode: 0o600 },
    );
    fs.writeFileSync(path.join(dir, "login-code.txt"), c.bootstrap, {
      mode: 0o600,
    });
  }
  await workerBuild();
  const mf = engine(c, dir, { port: 0 });
  try {
    await migrate(await mf.getD1Database("DB"), c);
    console.log("DEMO_BOOTSTRAPPED " + c.installationId);
  } finally {
    await mf.dispose();
  }
} else if (command === "dev") {
  await freePort(5273);
  await freePort(8788);
  const c = config(dir);
  await workerBuild();
  c.bootstrap = crypto.randomBytes(24).toString("hex");
  c.localSessionToken = crypto.randomBytes(32).toString("hex");
  c.appCodeSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (
    execFileSync("git", ["status", "--porcelain", "--", "v2"], {
      cwd: path.dirname(root),
      encoding: "utf8",
    }).trim()
  )
    c.appCodeSha += "-dirty";
  c.workerBuildHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(root, "dist/worker.js")))
    .digest("hex");
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(c, null, 2),
    { mode: 0o600 },
  );
  fs.writeFileSync(path.join(dir, "login-code.txt"), c.bootstrap, {
    mode: 0o600,
  });
  const mf = engine(c, dir);
  await mf.ready;
  const db = await mf.getD1Database("DB");
  const installation = await db
    .prepare("SELECT id,mode FROM installations")
    .first();
  if (installation?.id !== c.installationId || installation.mode !== c.mode) {
    await mf.dispose();
    throw Error("INSTALLATION_MISMATCH");
  }
  const web = await createServer({
    configFile: path.join(root, "apps/web/vite.config.ts"),
    plugins: [localSessionPlugin(c)],
  });
  await web.listen();
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const log = fs.openSync(path.join(dir, "runner.log"), "a");
  const runner = spawn(python, ["model-runner/runner.py"], {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      V2_API: "http://127.0.0.1:8788",
      V2_SERVICE_TOKEN: c.serviceToken,
    },
  });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    runner.kill();
    await web.close();
    await mf.dispose();
    control.close();
    fs.writeFileSync(
      path.join(dir, "last-stop.json"),
      JSON.stringify({
        runId,
        supervisorPid: process.pid,
        runnerPid: runner.pid,
        stoppedAt: new Date().toISOString(),
      }),
    );
    process.exit(0);
  };
  const control = http.createServer((req, res) => {
    if (
      req.method !== "POST" ||
      req.url !== "/stop" ||
      req.headers.authorization !== `Bearer ${runId}` ||
      req.headers["x-v2-pid"] !== String(process.pid) ||
      req.headers["x-v2-started"] !== startedAt ||
      req.headers["x-v2-cwd-hash"] !==
        crypto.createHash("sha256").update(root).digest("hex")
    ) {
      res.writeHead(403).end();
      return;
    }
    res.end("stopping");
    void close();
  });
  await new Promise((resolve) => control.listen(0, "127.0.0.1", resolve));
  const record = {
    runId,
    pid: process.pid,
    runnerPid: runner.pid,
    cwd: root,
    startedAt,
    controlPort: control.address().port,
  };
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(record), {
    mode: 0o600,
  });
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
  console.log("DEMO_READY http://127.0.0.1:5273 automatic local session");
} else if (command === "stop") {
  const record = JSON.parse(
    fs.readFileSync(path.join(dir, "run.json"), "utf8"),
  );
  if (record.cwd !== root || !record.runId)
    throw Error("PROCESS_IDENTITY_MISMATCH");
  const res = await fetch(`http://127.0.0.1:${record.controlPort}/stop`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${record.runId}`,
      "X-V2-Pid": String(record.pid),
      "X-V2-Started": record.startedAt,
      "X-V2-Cwd-Hash": crypto
        .createHash("sha256")
        .update(record.cwd)
        .digest("hex"),
    },
  });
  if (!res.ok) throw Error("PROCESS_IDENTITY_MISMATCH");
  console.log("OWN_SUPERVISOR_STOP_REQUESTED");
} else throw Error("UNKNOWN_COMMAND");
