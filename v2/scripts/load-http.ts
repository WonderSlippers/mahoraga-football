import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
// @ts-ignore shared runtime
import { engine } from "./runtime-lib.mjs";
// @ts-ignore state guard
import { safeState } from "./safety.mjs";
const setup = spawnSync(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "scripts/capacity.ts"],
  { encoding: "utf8", windowsHide: true, maxBuffer: 8388608 },
);
if (setup.status !== 0)
  throw Error("CAPACITY_SETUP_FAILED: " + setup.stdout.slice(-2000));
const seeded = JSON.parse(setup.stdout.trim().split("\n").at(-1)!);
const dir = safeState(path.resolve(seeded.dir)),
  id = seeded.installationId;
if (!/^capacity-[a-f0-9-]+$/.test(path.basename(dir)))
  throw Error("LOAD_DIRECTORY_INVALID");
fs.writeFileSync(path.join(dir, "setup.log"), setup.stdout + setup.stderr);
const report: any = {
  phase: "RUNNING",
  mode: "DEMO",
  synthetic: true,
  installationId: id,
  startedAt: new Date().toISOString(),
  pid: process.pid,
  command: "npm run test:load",
  durationRequiredMs: 3600000,
  samples: 0,
  maxSampleGapMs: 0,
  failures: [],
  timings: { meta: [], tickets: [], quotes: [] },
  memory: [],
  budgets: {
    metaBytes: 16384,
    pageBytes: 65536,
    metaP95Ms: 250,
    pageP95Ms: 750,
    combinedRssBytes: 1073741824,
    maxTailGrowthRatio: 1.25,
  },
  runtimeVersion: JSON.parse(
    fs.readFileSync("node_modules/miniflare/package.json", "utf8"),
  ).version,
  workerBuildHash: crypto
    .createHash("sha256")
    .update(fs.readFileSync("dist/worker.js"))
    .digest("hex"),
};
const save = () =>
  fs.writeFileSync(
    path.join(dir, "http-load-report.json"),
    JSON.stringify(report, null, 2),
  );
fs.writeFileSync(
  ".runtime-v2/active-http-load.json",
  JSON.stringify({ dir, pid: process.pid, startedAt: report.startedAt }),
);
const cfg = {
  installationId: id,
  mode: "DEMO",
  webOrigin: "http://127.0.0.1:5293",
  bootstrap: crypto.randomUUID(),
  serviceToken: crypto.randomUUID(),
  appCodeSha: "SYNTHETIC_HTTP_LOAD_ONLY",
};
const mf = engine(cfg, dir, { port: 0 });
const memory = () => {
  let all: any[] = [];
  if (process.platform === "win32") {
    const command = `$all=Get-CimInstance Win32_Process; $ids=@(${process.pid}); for($i=0;$i -lt 4;$i++){ $ids+=@($all | Where-Object { $_.ParentProcessId -in $ids } | Select-Object -ExpandProperty ProcessId); $ids=@($ids | Select-Object -Unique) }; @($all | Where-Object { $_.ProcessId -in $ids } | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize) | ConvertTo-Json -Compress`;
    all = [].concat(
      JSON.parse(
        execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
          encoding: "utf8",
          windowsHide: true,
        }),
      ),
    );
  } else {
    const processes = execFileSync(
      "ps",
      ["-e", "-o", "pid=,ppid=,rss=,comm="],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .map((line) => {
        const [pid, ppid, rss, ...name] = line.trim().split(/\s+/);
        return {
          ProcessId: Number(pid),
          ParentProcessId: Number(ppid),
          WorkingSetSize: Number(rss) * 1024,
          Name: name.join(" "),
        };
      });
    const ids = new Set([process.pid]);
    for (let i = 0; i < 4; i++)
      for (const p of processes)
        if (ids.has(p.ParentProcessId)) ids.add(p.ProcessId);
    all = processes.filter((p) => ids.has(p.ProcessId));
  }
  const workers = all.filter((p) => p.Name.toLowerCase().includes("workerd"));
  if (!workers.length) throw Error("WORKER_RSS_UNAVAILABLE");
  const nodeRss = process.memoryUsage().rss,
    workerRss = workers.reduce((n, p) => n + Number(p.WorkingSetSize), 0);
  return {
    at: new Date().toISOString(),
    nodeRss,
    workerRss,
    combinedRss: nodeRss + workerRss,
    ownedProcesses: all,
  };
};
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
try {
  const session = await mf.dispatchFetch(
    "http://127.0.0.1:0/api/v2/session/bootstrap",
    {
      method: "POST",
      headers: { Origin: cfg.webOrigin },
      body: JSON.stringify({ passphrase: cfg.bootstrap }),
    },
  );
  assert.equal(session.status, 200);
  const cookie = session.headers.get("set-cookie"),
    begin = performance.now();
  let last = begin;
  report.loadStartedAt = new Date().toISOString();
  save();
  while (performance.now() - begin < report.durationRequiredMs) {
    const tick = performance.now(),
      gap = tick - last;
    last = tick;
    report.maxSampleGapMs = Math.max(report.maxSampleGapMs, gap);
    if (gap > 15000) throw Error("CONTINUITY_GAP_EXCEEDED");
    for (const [name, route] of [
      ["meta", "/meta"],
      ["tickets", "/ticket-page"],
      ["quotes", "/quote-page?marketId=" + seeded.quoteMarketId],
    ]) {
      const at = performance.now(),
        response = await mf.dispatchFetch("http://127.0.0.1:0/api/v2" + route, {
          headers: { Cookie: cookie },
        });
      assert.equal(response.status, 200);
      const text = await response.text(),
        bytes = Buffer.byteLength(text);
      if (bytes > (name === "meta" ? 16384 : 65536))
        throw Error("PAYLOAD_BUDGET_EXCEEDED");
      const data = JSON.parse(text).data;
      if (name !== "meta") assert.equal(data.items.length, 50);
      report.timings[name].push(performance.now() - at);
      report.maxBytes ||= {};
      report.maxBytes[name] = Math.max(report.maxBytes[name] || 0, bytes);
    }
    report.samples++;
    if (report.samples % 60 === 1) {
      const sample = memory();
      report.memory.push(sample);
      report.elapsedMs = performance.now() - begin;
      if (sample.combinedRss > report.budgets.combinedRssBytes)
        throw Error("RSS_CAPACITY_EXCEEDED");
      save();
    }
    await new Promise((r) =>
      setTimeout(r, Math.max(0, 1000 - (performance.now() - tick))),
    );
  }
  report.elapsedMs = performance.now() - begin;
  if (performance.now() - last > 15000 || report.samples < 3500)
    throw Error("INSUFFICIENT_CONTINUOUS_SAMPLES");
  report.metrics = Object.fromEntries(
    Object.entries(report.timings).map(([name, values]: any) => {
      const ordered = [...values].sort((a, b) => a - b);
      return [
        name,
        {
          samples: values.length,
          p95Ms: ordered[Math.floor(ordered.length * 0.95)],
          p99Ms: ordered[Math.floor(ordered.length * 0.99)],
        },
      ];
    }),
  );
  const middle = report.memory.slice(-20, -10).map((m: any) => m.combinedRss),
    tail = report.memory.slice(-10).map((m: any) => m.combinedRss);
  report.rss = {
    firstWindowMedian: median(
      report.memory.slice(0, 10).map((m: any) => m.combinedRss),
    ),
    previousWindowMedian: median(middle),
    lastWindowMedian: median(tail),
    peak: Math.max(...report.memory.map((m: any) => m.combinedRss)),
    tailGrowthRatio: median(tail) / median(middle),
  };
  if (
    report.metrics.meta.p95Ms > 250 ||
    report.metrics.tickets.p95Ms > 750 ||
    report.metrics.quotes.p95Ms > 750
  )
    throw Error("LATENCY_BUDGET_EXCEEDED");
  if (report.rss.tailGrowthRatio > report.budgets.maxTailGrowthRatio)
    throw Error("RSS_TAIL_GROWTH_REVIEW_REQUIRED");
  report.phase = "COMPLETE";
  report.exitCode = 0;
} catch (error) {
  report.phase = "FAILED";
  report.exitCode = 1;
  report.failures.push(String(error));
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  save();
  await mf.dispose();
  console.log(
    JSON.stringify({
      dir,
      phase: report.phase,
      exitCode: report.exitCode,
      metrics: report.metrics,
      rss: report.rss,
      failures: report.failures,
    }),
  );
}
