import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { engine, migrate, config } from "./runtime-lib.mjs";
import { root, safeState } from "./safety.mjs";
import { exportPaged, restorePaged, verifyPaged } from "./paged-backup.mjs";
import { workerBuild } from "./build.mjs";
const profile = process.argv[2] || "demo";
if (!/^[a-z0-9-]+$/.test(profile)) throw Error("INVALID_PROFILE");
const source = safeState(path.join(root, ".runtime-v2", profile)),
  cfg = config(source),
  runFile = path.join(source, "run.json");
if (fs.existsSync(runFile)) {
  let alive = false;
  try {
    process.kill(JSON.parse(fs.readFileSync(runFile)).pid, 0);
    alive = true;
  } catch (e) {
    if (e.code !== "ESRCH") throw e;
  }
  if (alive) throw Error("STOP_OWN_V2_PROFILE_BEFORE_BACKUP");
}
const suffix = new Date().toISOString().replaceAll(":", "-"),
  base = safeState(path.join(root, ".runtime-v2", "backup-" + suffix));
fs.mkdirSync(base);
if (process.platform === "win32")
  execFileSync(
    "icacls",
    [
      base,
      "/inheritance:r",
      "/grant:r",
      execFileSync("whoami", [], { encoding: "utf8" }).trim() + ":(OI)(CI)F",
    ],
    { stdio: "ignore", windowsHide: true },
  );
await workerBuild();
const src = engine(cfg, source, { port: 0 });
let metadata;
try {
  const db = await src.getD1Database("DB");
  const id = await db.prepare("SELECT id FROM installations").first();
  if (id.id !== cfg.installationId) throw Error("INSTALLATION_MISMATCH");
  metadata = await exportPaged(db, path.join(base, "snapshot"));
} finally {
  await src.dispose();
}
const target = path.join(base, "restored"),
  dest = {
    ...cfg,
    installationId: crypto.randomUUID(),
    bootstrap: crypto.randomBytes(32).toString("hex"),
    serviceToken: crypto.randomBytes(32).toString("hex"),
    localSessionToken: crypto.randomBytes(32).toString("hex"),
    restorationState: "IN_PROGRESS",
  };
fs.mkdirSync(target);
fs.writeFileSync(
  path.join(target, "manifest.json"),
  JSON.stringify(dest, null, 2),
  { mode: 0o600 },
);
const restored = engine(dest, target, { port: 0 });
let result;
try {
  const db = await restored.getD1Database("DB");
  await migrate(db, dest, { schemaOnly: true });
  result = await restorePaged(db, path.join(base, "snapshot"), dest);
} finally {
  await restored.dispose();
}
const rebooted = engine(dest, target, { port: 0 });
try {
  await verifyPaged(await rebooted.getD1Database("DB"), metadata);
} finally {
  await rebooted.dispose();
}
dest.restorationState = "COMPLETE";
fs.writeFileSync(
  path.join(target, "manifest.json"),
  JSON.stringify(dest, null, 2),
  { mode: 0o600 },
);
const evidence = {
  ...result,
  restarted: true,
  sourceInstallationId: cfg.installationId,
  targetInstallationId: dest.installationId,
  sourceProfile: profile,
  snapshotDirectory: path.join(base, "snapshot"),
  mode: cfg.mode,
  method: metadata.method,
  finishedAt: new Date().toISOString(),
};
fs.writeFileSync(
  path.join(base, "restore-test.json"),
  JSON.stringify(evidence, null, 2),
);
console.log(
  JSON.stringify({
    ...evidence,
    evidence: path.join(base, "restore-test.json"),
  }),
);
