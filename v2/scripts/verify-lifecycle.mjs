import { spawnSync } from "node:child_process";
import fs from "node:fs";
const dir = ".runtime-v2/lifecycle";
fs.mkdirSync(dir, { recursive: true });
const commands = {
  check: ["scripts/check.mjs"],
  unit: ["node_modules/tsx/dist/cli.mjs", "--test", "tests/unit/*.test.ts"],
  integration: [
    "node_modules/tsx/dist/cli.mjs",
    "--test",
    "--test-concurrency=1",
    "tests/integration/*.test.ts",
  ],
  targeted: [
    "node_modules/tsx/dist/cli.mjs",
    "--test",
    "--test-concurrency=1",
    "tests/integration/live-refresh.test.ts",
    "tests/integration/public-research.test.ts",
    "tests/integration/comparison.test.ts",
    "tests/integration/rotation.test.ts",
  ],
  build: ["scripts/build.mjs"],
  model: ["scripts/run-python.mjs", "model-parity"],
  e2e: ["node_modules/@playwright/test/cli.js", "test"],
  browser: ["scripts/verify-lifecycle-browser.mjs"],
};
for (const name of process.argv.slice(2)) {
  const args = commands[name];
  if (!args) throw Error("UNKNOWN_CHECK");
  const startedAt = new Date().toISOString();
  for (const ext of ["json", "log"]) {
    const previous = `${dir}/check-${name}.${ext}`;
    if (fs.existsSync(previous)) {
      fs.mkdirSync(`${dir}/check-history`, { recursive: true });
      fs.copyFileSync(
        previous,
        `${dir}/check-history/${startedAt.replaceAll(":", "-")}-${name}.${ext}`,
      );
    }
  }
  const result = spawnSync(process.execPath, args, {
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const log = (result.stdout || "") + (result.stderr || "");
  const testCount =
    Number(
      log.match(/(?:ℹ|#) tests (\d+)/)?.[1] ||
        log.match(/(\d+) passed/)?.[1] ||
        log.match(/Ran (\d+) tests/)?.[1] ||
        0,
    ) || null;
  fs.writeFileSync(`${dir}/check-${name}.log`, log);
  fs.writeFileSync(
    `${dir}/check-${name}.json`,
    JSON.stringify(
      {
        command: process.execPath + " " + args.join(" "),
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: result.status,
        testCount,
        log: `${dir}/check-${name}.log`,
        error: result.error?.message || null,
      },
      null,
      2,
    ),
  );
  console.log(name, "exit", result.status, "tests", testCount);
  console.log(log.slice(-2200));
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
