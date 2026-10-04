import fs from "node:fs";
import { spawnSync } from "node:child_process";
const dir = ".runtime-v2/recommendation-scores-20261004";
fs.mkdirSync(dir, { recursive: true });
const commands = {
  check: ["scripts/check.mjs"],
  build: ["scripts/build.mjs"],
  unit: ["node_modules/tsx/dist/cli.mjs", "--test", "tests/unit/*.test.ts"],
  integration: [
    "node_modules/tsx/dist/cli.mjs",
    "--test",
    "--test-concurrency=1",
    "tests/integration/universal.test.ts",
    "tests/integration/versions.test.ts",
  ],
  browser: ["scripts/verify-recommendation-scores-browser.mjs"],
};
for (const name of process.argv.slice(2)) {
  const args = commands[name];
  if (!args) throw Error("UNKNOWN_CHECK");
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  const logPath = `${dir}/${name}-${startedAt.replaceAll(":", "-")}.log`;
  fs.writeFileSync(logPath, log);
  const report = {
    name,
    command: ["node", ...args],
    startedAt,
    endedAt: new Date().toISOString(),
    exitCode: result.status,
    logPath,
  };
  fs.writeFileSync(
    `${dir}/${name}-latest.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  console.log(log.slice(-2600));
  if (result.status !== 0) process.exit(result.status ?? 1);
}
