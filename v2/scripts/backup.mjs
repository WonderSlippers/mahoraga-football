import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { engine, migrate, config } from "./runtime-lib.mjs";
import { root, safeState } from "./safety.mjs";
import { snapshot, restore } from "./backup-lib.mjs";
import { workerBuild } from "./build.mjs";
const profile = process.argv[2] || "demo";
if (!/^[a-z0-9-]+$/.test(profile)) throw Error("INVALID_PROFILE");
const source = safeState(path.join(root, ".runtime-v2", profile));
const runFile = path.join(source, "run.json");
if (fs.existsSync(runFile)) {
  const run = JSON.parse(fs.readFileSync(runFile, "utf8"));
  let alive = false;
  try {
    process.kill(run.pid, 0);
    alive = true;
  } catch (e) {
    if (e.code !== "ESRCH") throw e;
  }
  if (alive) throw Error("STOP_OWN_V2_PROFILE_BEFORE_BACKUP");
}
const cfg = config(source);
await workerBuild();
const mf = engine(cfg, source, { port: 0 });
let backup;
try {
  backup = await snapshot(await mf.getD1Database("DB"));
} finally {
  await mf.dispose();
}
const suffix = new Date().toISOString().replaceAll(":", "-");
const target = safeState(path.join(root, ".runtime-v2", "restore-" + suffix));
fs.mkdirSync(target, { recursive: true });
if (process.platform === "win32")
  execFileSync(
    "icacls",
    [
      target,
      "/inheritance:r",
      "/grant:r",
      execFileSync("whoami", [], { encoding: "utf8" }).trim() + ":(OI)(CI)F",
    ],
    { stdio: "ignore", windowsHide: true },
  );
const dest = {
  ...cfg,
  installationId: crypto.randomUUID(),
  bootstrap: crypto.randomBytes(32).toString("hex"),
  serviceToken: crypto.randomBytes(32).toString("hex"),
  localSessionToken: crypto.randomBytes(32).toString("hex"),
};
fs.writeFileSync(
  path.join(target, "manifest.json"),
  JSON.stringify(dest, null, 2),
  { mode: 0o600 },
);
const file = safeState(
  path.join(root, ".runtime-v2", "backups", `${profile}-${suffix}.json`),
);
fs.mkdirSync(path.dirname(file), { recursive: true });
if (process.platform === "win32")
  execFileSync(
    "icacls",
    [
      path.dirname(file),
      "/inheritance:r",
      "/grant:r",
      execFileSync("whoami", [], { encoding: "utf8" }).trim() + ":(OI)(CI)F",
    ],
    { stdio: "ignore", windowsHide: true },
  );
fs.writeFileSync(file, JSON.stringify(backup), { mode: 0o600 });
const restored = engine(dest, target, { port: 0 });
let result;
try {
  const db = await restored.getD1Database("DB");
  await migrate(db, dest, { schemaOnly: true });
  result = await restore(db, JSON.parse(fs.readFileSync(file, "utf8")), dest);
} finally {
  await restored.dispose();
}
const rebooted = engine(dest, target, { port: 0 });
try {
  const after = await snapshot(await rebooted.getD1Database("DB"));
  if (
    Object.keys(backup.manifest).some(
      (t) =>
        t !== "installations" &&
        backup.manifest[t].sha256 !== after.manifest[t].sha256,
    )
  )
    throw Error("RESTORE_RESTART_MISMATCH");
  result = {
    ...result,
    restarted: true,
    sourceProfile: profile,
    backupFile: file,
    backupSha256: crypto
      .createHash("sha256")
      .update(fs.readFileSync(file))
      .digest("hex"),
    finishedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(target, "restore-test.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      ...result,
      evidence: path.join(target, "restore-test.json"),
    }),
  );
} finally {
  await rebooted.dispose();
}
