import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
const profile = "e2e-" + Date.now(),
  env = {
    ...process.env,
    V2_PROFILE: profile,
    V2_WEB_PORT: "5293",
    V2_API_PORT: "8793",
  },
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
      if ((await fetch("http://127.0.0.1:5293")).ok) return;
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
  expect((await fetch("http://127.0.0.1:5293")).ok).toBe(true);
});
test.afterAll(async () => {
  await stop();
});
test("A65 A71 A74 A75 browser import, retired manual UI, evaluation and mobile routes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/archives");
  await expect(
    page.getByRole("heading", { name: "历史档案与对账", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("原系统标识", { exact: true })
    .fill("DEMO-browser-test");
  const content = JSON.stringify({
    portfolios: [
      {
        id: "DEMO-import",
        tickets: [
          {
            id: "DEMO-ticket",
            stake: 20,
            pnl: null,
            legs: [{}, {}],
            note: '<img src=x onerror="window.archiveXss=1">',
          },
        ],
      },
    ],
  });
  await page.getByLabel("历史导出文件").setInputFiles({
    name: "DEMO-import.json",
    mimeType: "application/json",
    buffer: Buffer.from(content),
  });
  await page.getByRole("button", { name: "预览并对账" }).click();
  await expect(page.getByRole("status")).toContainText("PREVIEW");
  const before: any = await page.evaluate(
    async () => await (await fetch("/api/v2/archives")).json(),
  );
  expect(before.data.items).toHaveLength(0);
  await page.getByRole("button", { name: "提交到新只读档案" }).click();
  await expect(page.getByRole("status")).toContainText("COMMITTED");
  await page.getByRole("button", { name: "查看原记录 / 多腿详情" }).click();
  await expect(
    page.getByRole("heading", { name: "原始记录（只读）" }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).archiveXss)).toBeUndefined();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/08-archive-browser.png",
    fullPage: false,
  });
  await page.goto("/reported");
  await expect(
    page.getByRole("heading", { name: "战绩与复盘.", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "手工成交声明", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存独立声明" })).toHaveCount(
    0,
  );
  await page.goto("/registry");
  await page.getByRole("button", { name: "冻结当前评估样本" }).click();
  await expect(
    page.getByRole("heading", { name: /固定样本结果/ }),
  ).toBeVisible();
  for (const route of [
    "/workbench",
    "/ledger",
    "/models",
    "/system",
    "/archives",
    "/reported",
  ]) {
    await page.goto(route);
    await page.locator("h1").waitFor();
    await expect(
      page
        .getByTestId(route === "/models" ? "general-laboratory" : "load-status")
        .first(),
    ).toHaveAttribute("data-loaded", "true");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      route,
    ).toBe(true);
    await page.screenshot({
      path: "test-results/09-mobile-" + route.slice(1) + ".png",
      fullPage: false,
    });
  }
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    path: "test-results/10-light-mobile.png",
    fullPage: false,
  });
  expect(errors).toEqual([]);
});
test("A38 A39 A40 A72 browser → Python → D1 → ticket → settlement → correction → restart", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const denied = await page.request.post("/api/v2/session/local", {
    headers: {
      Origin: "http://evil.test",
      "X-V2-Local-Session": "1",
      "Sec-Fetch-Site": "cross-site",
    },
    data: {},
  });
  expect(denied.status()).toBe(403);
  const direct = await page.request.post(
    "http://127.0.0.1:8793/api/v2/session/local",
    {
      headers: {
        Origin: "http://127.0.0.1:5293",
        Authorization: "Bearer " + config.serviceToken,
      },
      data: {},
    },
  );
  expect(direct.status()).toBe(401);
  await page.goto("/demo-workbench");
  await expect(page.getByRole("heading", { name: "今日观察" })).toBeVisible();
  await expect(page.locator("input[type=password]")).toHaveCount(0);
  const fresh = await browser.newContext();
  const freshPage = await fresh.newPage();
  await freshPage.goto("http://127.0.0.1:5293/demo-workbench");
  await expect(
    freshPage.getByRole("heading", { name: "今日观察" }),
  ).toBeVisible();
  await fresh.close();
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
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "记录纸面票 · 25 PAPER" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "取消", exact: true }),
  ).toBeFocused();
  await page.screenshot({ path: "test-results/11-paper-confirm.png" });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
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
  await page.getByRole("button", { name: "创建完整导出" }).click();
  await expect(page.getByRole("link", { name: "下载完整 JSONL" })).toBeVisible({
    timeout: 30000,
  });
  const download = await page.request.get(
    (await page
      .getByRole("link", { name: "下载完整 JSONL" })
      .getAttribute("href"))!,
  );
  expect(download.status()).toBe(200);
  const lines = (await download.text())
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  expect(lines.filter((x) => x.table === "tickets")).toHaveLength(1);
  expect(lines.filter((x) => x.table === "predictions")).toHaveLength(2);
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

test("A82 supervisor restarts only its verified child runner and preserves ledger", async ({
  page,
}) => {
  const current = JSON.parse(
    fs.readFileSync(path.join(dir, "run.json"), "utf8"),
  );
  expect(current.pid).toBe(child.pid);
  expect(current.cwd).toBe(process.cwd());
  const parent =
    process.platform === "win32"
      ? Number(
          execFileSync(
            "powershell.exe",
            [
              "-NoProfile",
              "-Command",
              `(Get-CimInstance Win32_Process -Filter "ProcessId = ${current.runnerPid}").ParentProcessId`,
            ],
            { encoding: "utf8", windowsHide: true },
          ).trim(),
        )
      : Number(
          fs
            .readFileSync("/proc/" + current.runnerPid + "/stat", "utf8")
            .split(") ")[1]
            .split(" ")[1],
        );
  expect(parent).toBe(current.pid);
  process.kill(current.runnerPid);
  await expect
    .poll(
      () => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"))
            .runnerPid;
        } catch {
          return current.runnerPid;
        }
      },
      { timeout: 15000 },
    )
    .not.toBe(current.runnerPid);
  await page.goto("/demo-workbench");
  await expect(page.getByTestId("load-status")).toHaveAttribute(
    "data-loaded",
    "true",
  );
  await page.getByRole("button", { name: "创建 DEMO 观察" }).click();
  await expect
    .poll(
      async () => {
        const result: any = await page.evaluate(
          async () => await (await fetch("/api/v2/export")).json(),
        );
        return result.data.predictions.length;
      },
      { timeout: 15000 },
    )
    .toBe(4);
  await page.goto("/demo-ledger");
  await expect(page.getByTestId("available")).toHaveText("75.00");
  const next = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
  fs.writeFileSync(
    "test-results/supervisor-recovery.json",
    JSON.stringify(
      {
        profile,
        supervisorPid: current.pid,
        oldRunnerPid: current.runnerPid,
        newRunnerPid: next.runnerPid,
        verifiedParent: parent,
        unchangedAvailable: "75000000",
        predictionsAfterRecovery: 4,
      },
      null,
      2,
    ),
  );
});
