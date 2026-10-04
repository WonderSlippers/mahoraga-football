import fs from "node:fs";
import { spawnSync } from "node:child_process";
const dir = ".runtime-v2/strategy-records-20261004";
fs.mkdirSync(dir, { recursive: true });
const commands = {
  check: ["scripts/check.mjs"],
  build: ["scripts/build.mjs"],
  browser: ["scripts/verify-strategy-records-browser.mjs"],
  integration: [
    "node_modules/tsx/dist/cli.mjs",
    "--test",
    "--test-concurrency=1",
    "tests/integration/universal.test.ts",
  ],
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
  const stamp = startedAt.replaceAll(":", "-");
  fs.writeFileSync(`${dir}/${name}-${stamp}.log`, log);
  const evidence = {
    name,
    command: ["node", ...args],
    startedAt,
    endedAt: new Date().toISOString(),
    exitCode: result.status,
    logPath: `${dir}/${name}-${stamp}.log`,
  };
  fs.writeFileSync(
    `${dir}/${name}-latest.json`,
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence));
  console.log(log.slice(-2200));
  if (result.status !== 0) process.exit(result.status ?? 1);
}
