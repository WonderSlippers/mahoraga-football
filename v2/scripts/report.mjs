import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
  "test:e2e",
  "build",
];
const records = [];
for (const command of commands) {
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
    log: path.relative(process.cwd(), file),
    tests: Number(
      output.match(/ℹ tests (\d+)/)?.[1] ||
        output.match(/(\d+) passed \(/)?.[1] ||
        0,
    ),
    failed: Number(output.match(/ℹ fail (\d+)/)?.[1] || 0),
    skipped: Number(output.match(/ℹ skipped (\d+)/)?.[1] || 0),
  };
  records.push(record);
  console.log(JSON.stringify(record));
  if (r.status !== 0) {
    console.log(output.slice(-6000));
    break;
  }
}
fs.writeFileSync(
  path.join(dir, "verification.json"),
  JSON.stringify(
    { scope: "P0-P2 DEMO engineering; not model parity", records },
    null,
    2,
  ),
);
console.log("VERIFICATION_DIR " + dir);
if (records.length !== commands.length || records.some((r) => r.exitCode !== 0))
  process.exitCode = 1;
