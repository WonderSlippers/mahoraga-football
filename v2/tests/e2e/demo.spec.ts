import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
const profile = "e2e-" + Date.now(),
  env = { ...process.env, V2_PROFILE: profile },
  dir = path.resolve(".runtime-v2", profile);
let child: ChildProcess;
let config: any;
async function start() {
  const log = fs.openSync(path.join(dir, "supervisor.log"), "a");
  child = spawn(process.execPath, ["scripts/runtime.mjs", "dev"], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ["ignore", log, log],
    env,
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:5273")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("V2_START_TIMEOUT");
}
async function stop() {
  if (!fs.existsSync(path.join(dir, "run.json"))) return;
  execFileSync(process.execPath, ["scripts/runtime.mjs", "stop"], { env });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("V2_STOP_TIMEOUT");
}
test.beforeAll(async () => {
  execFileSync(process.execPath, ["scripts/runtime.mjs", "bootstrap"], { env });
  config = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  await start();
  config = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const record = JSON.parse(
    fs.readFileSync(path.join(dir, "run.json"), "utf8"),
  );
  const rejected = await fetch(`http://127.0.0.1:${record.controlPort}/stop`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${record.runId}`,
      "X-V2-Pid": String(record.pid + 1),
      "X-V2-Started": record.startedAt,
    },
  });
  expect(rejected.status).toBe(403);
  expect((await fetch("http://127.0.0.1:5273")).ok).toBe(true);
});
test.afterAll(async () => {
  await stop();
});
test("A38 A39 A40 A72 browser → Python → D1 → ticket → settlement → correction → restart", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/workbench");
  await page.getByLabel("本地口令").fill(config.bootstrap);
  await page.getByRole("button", { name: "进入 DEMO" }).click();
  await expect(page.getByRole("heading", { name: "今日观察" })).toBeVisible();
  await page.getByRole("button", { name: "创建 DEMO 观察" }).click();
  await expect(
    page.getByRole("link", { name: "查看证据与纸面决策 →" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "查看证据与纸面决策 →" }).click();
  await expect(async () => {
    await page.getByRole("button", { name: "刷新预测", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "记录纸面票 · 25 PAPER" }),
    ).toBeVisible();
  }).toPass({ timeout: 20000 });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/01-frozen-research-1440.png",
    fullPage: true,
  });
  await expect(page.getByText("20.00%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "记录纸面票 · 25 PAPER" }).click();
  await expect(page.getByRole("status")).toContainText("已持久化");
  await page.getByRole("link", { name: "打开纸面账本 →" }).click();
  await expect(page.getByTestId("available")).toHaveText("75.00");
  await page.getByRole("button", { name: "DEMO 主胜结算" }).click();
  await expect(page.getByTestId("available")).toHaveText("125.00");
  await page.screenshot({
    path: "test-results/02-settlement-1440.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "追加更正为客胜" }).click();
  await expect(page.getByTestId("available")).toHaveText("75.00");
  await expect(page.getByText("-100.00%", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/03-correction-1440.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/04-ledger-mobile-390.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.screenshot({
    path: "test-results/05-ledger-1024.png",
    fullPage: true,
  });
  const before = await page.evaluate(
    async () => await (await fetch("/api/v2/export")).json(),
  );
  await stop();
  await start();
  await page.reload();
  await expect(page.getByTestId("available")).toHaveText("75.00");
  const after = await page.evaluate(
    async () => await (await fetch("/api/v2/export")).json(),
  );
  expect((after as any).data).toEqual((before as any).data);
  await page.screenshot({
    path: "test-results/06-restart-restored.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  fs.writeFileSync(
    "test-results/e2e-persistence.json",
    JSON.stringify(
      {
        mode: "DEMO",
        profile,
        installationId: config.installationId,
        predictionsUnchanged: true,
        ticketsUnchanged: true,
        browserErrors: errors,
        networkSources: "NONE",
        restarted: true,
      },
      null,
      2,
    ),
  );
});
