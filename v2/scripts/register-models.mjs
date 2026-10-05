import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { engine, config, migrate } from "./runtime-lib.mjs";
import { root, safeState } from "./safety.mjs";
import { workerBuild } from "./build.mjs";
const profile = process.argv[2] || "research";
if (!/^[a-z0-9-]+$/.test(profile)) throw Error("INVALID_PROFILE");
const dir = safeState(path.join(root, ".runtime-v2", profile));
const run = path.join(dir, "run.json");
if (fs.existsSync(run)) {
  let alive = false;
  try {
    process.kill(JSON.parse(fs.readFileSync(run)).pid, 0);
    alive = true;
  } catch (e) {
    if (e.code !== "ESRCH") throw e;
  }
  if (alive) throw Error("STOP_OWN_PROFILE_BEFORE_REGISTRATION");
}
execFileSync(
  path.join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  ),
  ["model-runner/registry.py"],
  { cwd: root, stdio: "inherit", windowsHide: true },
);
await workerBuild();
const cfg = config(dir),
  mf = engine(cfg, dir, { port: 0 });
try {
  const db = await mf.getD1Database("DB");
  await migrate(db, cfg);
  const manifests = JSON.parse(
    fs.readFileSync(".runtime-v2/model-parity/registry.json", "utf8"),
  );
  for (const manifest of manifests) {
    const json = JSON.stringify(manifest),
      hash = crypto.createHash("sha256").update(json).digest("hex");
    const old = await db
      .prepare("SELECT manifestHash FROM model_manifests WHERE id=?")
      .bind(manifest.modelId)
      .first();
    if (old) {
      if (old.manifestHash !== hash) throw Error("MODEL_ID_COLLISION");
      continue;
    }
    await db.batch([
      db
        .prepare("INSERT INTO model_manifests VALUES(?,?,?,?,?)")
        .bind(manifest.modelId, json, hash, manifest.outputKind, "BLOCKED"),
      db
        .prepare("INSERT INTO model_registry_events VALUES(?,?,?,?,?,?)")
        .bind(
          crypto.randomUUID(),
          manifest.modelId,
          "BLOCKED",
          "LOCAL_RESEARCH_IMPORT",
          manifest.reason,
          Date.now(),
        ),
    ]);
  }
  console.log(
    JSON.stringify({
      registered: manifests.length,
      mode: cfg.mode,
      status: "BLOCKED",
      promoted: false,
    }),
  );
} finally {
  await mf.dispose();
}
