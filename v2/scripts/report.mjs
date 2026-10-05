import fs from "node:fs";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import crypto from "node:crypto";
function sourceDigest() {
  const files = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter((f) => f && /\.(?:ts|tsx|mjs|py|json|sql|css)$/.test(f))
    .sort();
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update(fs.readFileSync(file));
  }
  return hash.digest("hex");
}
const dir = path.resolve(
  ".runtime-v2/verification",
  new Date().toISOString().replaceAll(":", "-"),
);
fs.mkdirSync(dir, { recursive: true });
const npm = process.env.npm_execpath;
if (!npm) throw Error("Run with npm run report:verification");
const commands = [
  "doctor",
  "check",
  "test:unit",
  "test:integration",
  "test:import",
  "test:e2e",
  ...(process.argv.includes("--core") ? [] : ["test:model-parity"]),
  "build",
];
const records = [];
for (const command of commands) {
  const beforeSourceHash = sourceDigest();
  const startedAt = new Date().toISOString();
  const r = spawnSync(process.execPath, [npm, "run", command], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  const output = (r.stdout || "") + (r.stderr || "");
  const file = path.join(dir, command.replaceAll(":", "-") + ".log");
  fs.writeFileSync(file, output);
  const record = {
    command: "npm run " + command,
    startedAt,
    endedAt: new Date().toISOString(),
    exitCode: r.status,
    beforeSourceHash,
    afterSourceHash: sourceDigest(),
    log: path.relative(process.cwd(), file),
    tests: Number(
      output.match(/ℹ tests (\d+)/)?.[1] ||
        output.match(/(\d+) passed \(/)?.[1] ||
        output.match(/Ran (\d+) tests? in/)?.[1] ||
        0,
    ),
    failed: Number(
      output.match(/ℹ fail (\d+)/)?.[1] ||
        output.match(/(\d+) failed/)?.[1] ||
        (r.status === 0 ? 0 : 1),
    ),
    skipped: Number(output.match(/ℹ skipped (\d+)/)?.[1] || 0),
  };
  records.push(record);
  console.log(JSON.stringify(record));
  if (r.status !== 0 || record.beforeSourceHash !== record.afterSourceHash) {
    console.log(output.slice(-6000));
    break;
  }
}
fs.writeFileSync(
  path.join(dir, "verification.json"),
  JSON.stringify(
    {
      scope: process.argv.includes("--core")
        ? "Portable core; private model parity NOT_RUN"
        : "V2 core plus historical original-function parity; live V6/V7 BLOCKED",
      platform: process.platform,
      node: process.version,
      records,
      countingNote:
        "test:import reruns a subset of unit/integration and must not be added twice",
      loadNote:
        "60-minute load evidence is recorded independently; not rerun implicitly",
    },
    null,
    2,
  ),
);
console.log("VERIFICATION_DIR " + dir);
if (
  records.length !== commands.length ||
  records.some(
    (r) => r.exitCode !== 0 || r.beforeSourceHash !== r.afterSourceHash,
  )
)
  process.exitCode = 1;
