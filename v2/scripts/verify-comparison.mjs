import { spawnSync } from "node:child_process";
import fs from "node:fs";
const dir = ".runtime-v2/parallel-models";
fs.mkdirSync(dir, { recursive: true });
const python = ".venv/Scripts/python.exe";
const commands = {
  check: ["scripts/check.mjs"],
  unit: ["node_modules/tsx/dist/cli.mjs", "--test", "tests/unit/*.test.ts"],
  integration: [
    "node_modules/tsx/dist/cli.mjs",
    "--test",
    "--test-concurrency=1",
    "tests/integration/*.test.ts",
  ],
  queue: [
    "node_modules/tsx/dist/cli.mjs",
    "--test",
    "tests/integration/public-research.test.ts",
  ],
  e2e: ["node_modules/@playwright/test/cli.js", "test"],
  model: ["scripts/run-python.mjs", "model-parity"],
  comparison: ["model-runner/test_comparison.py", "-v"],
  publicmodel: ["model-runner/test_public_research.py", "-v"],
  build: ["scripts/build.mjs"],
  browser: ["scripts/verify-parallel-browser.mjs"],
};
for (const name of process.argv.slice(2)) {
  const executable = ["comparison", "publicmodel"].includes(name)
    ? python
    : process.execPath;
  const args = commands[name];
  if (!args) throw Error("UNKNOWN_CHECK");
  const at = new Date().toISOString();
  for (const ext of ["json", "log"]) {
    const previous = `${dir}/check-${name}.${ext}`;
    if (fs.existsSync(previous)) {
      fs.mkdirSync(`${dir}/check-history`, { recursive: true });
      fs.copyFileSync(
        previous,
        `${dir}/check-history/${at.replaceAll(":", "-")}-${name}.${ext}`,
      );
    }
  }
  const r = spawnSync(executable, args, {
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const log = (r.stdout || "") + (r.stderr || "");
  fs.writeFileSync(`${dir}/check-${name}.log`, log);
  const count =
    log.match(/(?:ℹ|#) tests (\d+)/)?.[1] ??
    log.match(/Ran (\d+) tests/)?.[1] ??
    log.match(/(\d+) passed/)?.[1];
  const record = {
    command: executable + " " + args.join(" "),
    startedAt: at,
    finishedAt: new Date().toISOString(),
    exitCode: r.status,
    testCount: count ? Number(count) : null,
    log: `${dir}/check-${name}.log`,
    error: r.error?.message || null,
  };
  fs.writeFileSync(
    `${dir}/check-${name}.json`,
    JSON.stringify(record, null, 2),
  );
  console.log(name, "exit", r.status, "tests", count ?? "see evidence");
  console.log(log.slice(-2600));
  if (r.status !== 0) {
    process.exitCode = r.status ?? 1;
    break;
  }
}
