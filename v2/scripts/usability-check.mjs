import { spawnSync } from "node:child_process";
import fs from "node:fs";
const dir = ".runtime-v2/usability";
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
  e2e: ["node_modules/@playwright/test/cli.js", "test"],
  model: ["scripts/run-python.mjs", "model-parity"],
  publicmodel: ["model-runner/test_public_research.py", "-v"],
  build: ["scripts/build.mjs"],
  browser: ["scripts/capture-usability-pages.mjs"],
  journeys: ["scripts/verify-user-journeys.mjs"],
};
for (const name of process.argv.slice(2)) {
  if (!commands[name]) throw Error("Unknown check");
  const start = new Date().toISOString();
  const executable =
    name === "publicmodel" ? ".venv/Scripts/python.exe" : process.execPath;
  const r = spawnSync(executable, commands[name], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  const log = (r.stdout ?? "") + (r.stderr ?? "");
  fs.writeFileSync(`${dir}/check-${name}.log`, log);
  let count =
    log.match(/(?:ℹ|#) tests (\d+)/)?.[1] ??
    log.match(/Ran (\d+) tests/)?.[1] ??
    log.match(/(\d+) passed/)?.[1];
  let results = null;
  if (name === "e2e" && fs.existsSync("test-results/e2e-report.json")) {
    const stats = JSON.parse(
      fs.readFileSync("test-results/e2e-report.json", "utf8"),
    ).stats;
    count = String(
      stats.expected + stats.unexpected + stats.skipped + stats.flaky,
    );
    results = {
      passed: stats.expected,
      failed: stats.unexpected,
      skipped: stats.skipped,
      flaky: stats.flaky,
    };
  }
  fs.writeFileSync(
    `${dir}/check-${name}.json`,
    JSON.stringify(
      {
        command:
          (name === "publicmodel" ? executable : "node") +
          " " +
          commands[name].join(" "),
        startedAt: start,
        finishedAt: new Date().toISOString(),
        exitCode: r.status,
        testCount: count ? Number(count) : null,
        results,
        log: `${dir}/check-${name}.log`,
        error: r.error ? String(r.error) : null,
      },
      null,
      2,
    ),
  );
  console.log(name, "exit", r.status, "tests", count ?? "see log");
  console.log(log.slice(-2400));
  if (r.status !== 0) {
    process.exitCode = r.status ?? 1;
    break;
  }
}
