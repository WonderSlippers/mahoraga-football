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
import { importLegacyWorkspace } from "./import-workspace.mjs";
import { startLanGateway } from "./lan-gateway.mjs";
process.chdir(root);
const command = process.argv[2];
const mode = process.env.V2_MODE || "DEMO";
modeGuard(mode, process.env.V2_HOST || "127.0.0.1");
const webPort = Number(
  process.env.V2_WEB_PORT || (mode === "DEMO" ? 5273 : 5274),
);
const apiPort = Number(
  process.env.V2_API_PORT || (mode === "DEMO" ? 8788 : 8789),
);
if (
  [webPort, apiPort].some(
    (p) => !Number.isInteger(p) || p < 1024 || p > 65535 || p === 5173,
  ) ||
  webPort === apiPort
)
  throw Error("PROTECTED_OR_INVALID_PORT");
if (
  mode === "LOCAL_RESEARCH" &&
  (!process.env.V2_PROFILE || process.env.V2_PROFILE === "demo")
)
  throw Error("RESEARCH_PROFILE_REQUIRED");
const dir = runtime();
const python = path.join(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
if (command === "doctor") {
  await freePort(webPort);
  await freePort(apiPort);
  console.log(
    JSON.stringify({
      node: process.version,
      python: fs.existsSync(python),
      mode,
      state: "isolated .runtime-v2 profile",
      ports: [webPort, apiPort],
      network: mode === "LOCAL_RESEARCH" ? "OPENLIGADB_ALLOWLIST" : false,
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
      mode,
      bootstrap: crypto.randomBytes(24).toString("hex"),
      serviceToken: crypto.randomBytes(32).toString("hex"),
      webOrigin: `http://127.0.0.1:${webPort}`,
      apiPort,
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
  if (c.mode !== mode) throw Error("INSTALLATION_MISMATCH");
  await workerBuild();
  const mf = engine(c, dir, { port: 0 });
  try {
    await migrate(await mf.getD1Database("DB"), c);
    console.log(mode + "_BOOTSTRAPPED " + c.installationId);
  } finally {
    await mf.dispose();
  }
} else if (command === "dev") {
  await freePort(webPort);
  await freePort(apiPort);
  const c = config(dir);
  if (c.mode !== mode) throw Error("INSTALLATION_MISMATCH");
  if (
    c.webOrigin !== `http://127.0.0.1:${webPort}` ||
    (c.apiPort || 8788) !== apiPort
  )
    throw Error("PORT_CONFIGURATION_MISMATCH");
  if (c.restorationState && c.restorationState !== "COMPLETE")
    throw Error("RESTORE_NOT_READY");
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
  const mf = engine(c, dir, { port: apiPort });
  await mf.ready;
  const db = await mf.getD1Database("DB");
  const installation = await db
    .prepare("SELECT id,mode FROM installations")
    .first();
  if (installation?.id !== c.installationId || installation.mode !== c.mode) {
    await mf.dispose();
    throw Error("INSTALLATION_MISMATCH");
  }
  if (["demo", "research"].includes(process.env.V2_PROFILE || "demo")) {
    try {
      console.log(
        "LEGACY_AUTO_IMPORT",
        JSON.stringify(
          await importLegacyWorkspace(c, `http://127.0.0.1:${apiPort}`),
        ),
      );
    } catch (error) {
      console.error("LEGACY_AUTO_IMPORT_FAILED", String(error));
    }
  }
  const web = await createServer({
    configFile: path.join(root, "apps/web/vite.config.ts"),
    plugins: [localSessionPlugin(c)],
    server: {
      port: webPort,
      proxy: {
        "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
      },
    },
  });
  await web.listen();
  let lan = { origin: null, close: async () => {} };
  if (mode === "LOCAL_RESEARCH" && process.env.V2_LAN !== "0") {
    try {
      lan = await startLanGateway(webPort);
      c.lanOrigin = lan.origin;
      if (lan.origin) console.log("PHONE_READY", lan.origin + "/workbench");
    } catch (e) {
      console.error("LAN_LISTENER_UNAVAILABLE", e.code || e.message);
    }
  }
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const log = fs.openSync(path.join(dir, "runner.log"), "a");
  let closing = false,
    runner,
    record,
    restartTimer;
  let failures = 0;
  const startRunner = () => {
    const began = Date.now();
    runner = spawn(python, ["model-runner/runner.py"], {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", log, log],
      env: {
        ...process.env,
        V2_API: `http://127.0.0.1:${apiPort}`,
        V2_SERVICE_TOKEN: c.serviceToken,
      },
    });
    if (record) {
      record.runnerPid = runner.pid;
      fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(record), {
        mode: 0o600,
      });
    }
    runner.on("error", () => {
      console.error("RUNNER_START_FAILED");
    });
    runner.on("exit", () => {
      if (closing) return;
      failures = Date.now() - began > 60000 ? 0 : failures + 1;
      const delay = Math.min(30000, 1000 * 2 ** Math.min(failures, 5));
      console.error("OWN_RUNNER_RESTART_IN_MS", delay);
      restartTimer = setTimeout(startRunner, delay);
    });
  };
  startRunner();
  let featureRunner,
    featuresBusy = false;
  const advanceFeatures = () => {
    if (mode !== "LOCAL_RESEARCH" || closing || featuresBusy) return;
    featuresBusy = true;
    const runFeatureStep = (executable, args, next) => {
      featureRunner = spawn(executable, args, {
        cwd: root,
        windowsHide: true,
        stdio: ["ignore", log, log],
        env: {
          ...process.env,
          V2_API: `http://127.0.0.1:${apiPort}`,
          V2_SERVICE_TOKEN: c.serviceToken,
        },
      });
      if (record) {
        record.featureRunnerPid = featureRunner.pid;
        fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(record), {
          mode: 0o600,
        });
      }
      featureRunner.on("error", () => {
        featuresBusy = false;
        console.error("FEATURE_COLLECTOR_START_FAILED");
      });
      featureRunner.on("exit", (code) => {
        if (closing) return;
        if (code !== 0) console.error("FEATURE_COLLECTOR_EXIT", code);
        if (next) next();
        else featuresBusy = false;
      });
    };
    runFeatureStep(process.execPath, ["scripts/comparison-collector.mjs"], () =>
      runFeatureStep(
        python,
        ["model-runner/prepare_comparison_features.py"],
        null,
      ),
    );
  };
  const featuresTimer = setInterval(advanceFeatures, 300000);
  void advanceFeatures();
  const autoAbort = new AbortController();
  let automationBusy = false;
  const advanceAutomation = async () => {
    if (mode !== "LOCAL_RESEARCH" || closing || automationBusy) return;
    automationBusy = true;
    try {
      const response = await fetch(
        `http://127.0.0.1:${apiPort}/internal/v2/automation/tick`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + c.serviceToken,
            "Content-Type": "application/json",
          },
          body: "{}",
          signal: AbortSignal.any([
            autoAbort.signal,
            AbortSignal.timeout(60000),
          ]),
        },
      );
      await response.arrayBuffer();
      if (!response.ok) console.error("AUTOMATION_TICK_HTTP", response.status);
    } catch (error) {
      if (!closing) console.error("AUTOMATION_TICK_RETRY", error.name);
    } finally {
      automationBusy = false;
    }
  };
  const autoTimer = setInterval(advanceAutomation, 5000);
  void advanceAutomation();
  const close = async () => {
    if (closing) return;
    closing = true;
    clearInterval(autoTimer);
    clearInterval(featuresTimer);
    autoAbort.abort();
    clearTimeout(restartTimer);
    runner.kill();
    featureRunner?.kill();
    await lan.close();
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
  record = {
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
  console.log(
    mode + `_READY http://127.0.0.1:${webPort} automatic local session`,
  );
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
