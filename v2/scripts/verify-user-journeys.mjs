import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const dir = path.resolve(".runtime-v2/usability"),
  report = { at: new Date().toISOString(), checks: [], errors: [] };
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => report.errors.push(String(e)));
const loaded = () =>
  page
    .locator('[data-testid="load-status"][data-loaded="true"]')
    .waitFor({ timeout: 60000 });
const get = (route) =>
  page.evaluate(async (route) => {
    const r = await fetch("/api/v2/workspace/" + route);
    const j = await r.json();
    if (!r.ok) throw Error(j.error.code);
    return j.data;
  }, route);
const go = async (route) => {
  await page.goto("http://127.0.0.1:5274" + route);
  await loaded();
};
const check = (name) => report.checks.push({ name, status: "PASS" });
const action = async (fragment, fn) => {
  const response = page.waitForResponse(
    (r) =>
      r.url().includes("/api/v2/workspace/") &&
      r.url().includes(fragment) &&
      r.status() === 200,
  );
  await fn();
  await response;
  await page.waitForTimeout(250);
};
try {
  await page.goto("http://127.0.0.1:5273/workbench");
  await page.waitForURL(/127\.0\.0\.1:5274/, { timeout: 60000 });
  await loaded();
  check("常用5273入口自动进入真实研究，不落入DEMO");
  const initial = await get("schedule?upcoming=1");
  assert(
    initial.items.every(
      (f) =>
        new Date(f.kickoffAt) > new Date() &&
        !["FINISHED", "CANCELLED"].includes(f.status),
    ),
  );
  assert(
    initial.items.some(
      (f) =>
        f.competition.includes("fifa") ||
        f.competition.includes("uefa.nations"),
    ),
  );
  check("默认赛程包含国家队，已结束比赛不挤占首页");
  await page.locator(".schedule-filters summary").click();
  await action("league=uefa.nations", () =>
    page.getByLabel("赛程联赛", { exact: true }).selectOption("uefa.nations"),
  );
  await action("q=", () =>
    page.getByLabel("搜索球队", { exact: true }).fill("哈萨克斯坦"),
  );
  assert((await page.locator(".fixture-card").count()) >= 1);
  for (const card of await page.locator(".fixture-card").all())
    await expect(card).toContainText("哈萨克斯坦");
  const nationalMatch = page
    .locator(".fixture-card")
    .filter({ hasText: "摩尔多瓦" })
    .first();
  await expect(nationalMatch).toBeVisible();
  const url = page.url();
  await nationalMatch.click();
  await loaded();
  await expect(page.locator(".ws-match-hero")).toContainText("哈萨克斯坦");
  await page.getByRole("button", { name: "亚洲盘", exact: true }).click();
  await expect(page.locator(".current-markets")).toContainText("让球");
  await page.getByRole("button", { name: "大小球", exact: true }).click();
  await expect(page.locator(".current-markets")).toContainText("大球");
  await page.getByRole("button", { name: "1X2", exact: true }).click();
  await page.locator(".quote-chart > summary").click();
  assert((await page.locator(".quote-chart circle").count()) > 0);
  assert(
    await page
      .locator(".quote-chart circle")
      .evaluateAll((nodes) =>
        nodes.every(
          (n) =>
            Number.isFinite(Number(n.getAttribute("cx"))) &&
            Number.isFinite(Number(n.getAttribute("cy"))),
        ),
      ),
  );
  await page.getByLabel("选择报价记录", { exact: true }).focus();
  await page.keyboard.press("End");
  await expect(page.locator(".quote-chart .ws-caption")).toContainText("抓取");
  check("真实同源报价曲线坐标有效，可用键盘读取捕获时间和赔率");
  await page.screenshot({ path: path.join(dir, "journey-national-match.png") });
  check("中文搜索、国家队详情、真实亚洲盘及大小球可操作");
  await page.getByRole("link", { name: "← 返回完整赛程" }).click();
  await loaded();
  assert.equal(page.url(), url);
  await expect(page.getByLabel("搜索球队", { exact: true })).toHaveValue(
    "哈萨克斯坦",
  );
  check("返回赛程保留中文搜索和联赛筛选");
  await page.reload();
  await loaded();
  assert((await page.locator(".fixture-card").count()) >= 1);
  for (const card of await page.locator(".fixture-card").all())
    await expect(card).toContainText("哈萨克斯坦");
  check("刷新保留筛选");
  await go("/workbench?period=CUSTOM&custom=2026-10-02");
  await page.locator(".schedule-filters summary").click();
  await expect(page.getByLabel("比赛日期", { exact: true })).toHaveValue(
    "2026-10-02",
  );
  check("指定日期可通过网址恢复");
  await go("/workbench");
  await page.getByRole("button", { name: /待观察/ }).click();
  const more = page.getByRole("button", { name: /查看全部/ });
  if (await more.count()) {
    await action("status=WATCH", () => more.click());
    const all = await get("schedule?upcoming=1&status=WATCH");
    assert(all.total > 6);
    check("待观察全部入口覆盖待补证及未入选比赛");
  }
  await go("/history");
  await page.locator(".ws-record-row").first().click();
  await expect(page.getByRole("dialog", { name: "记录详情" })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeFocused();
  await page.keyboard.press("Tab");
  assert(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.contains(document.activeElement)),
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  check("历史详情立即显示，键盘焦点与Escape关闭正常");
  await go("/ledger");
  const ledger = await get("ledger?mode=LEGACY_IMPORT&period=ALL");
  assert.equal(ledger.total, 498);
  assert.equal(ledger.summary.profitAtoms, "-365620000");
  assert.equal(ledger.summary.settledStakeAtoms, "7535620000");
  assert(Math.abs(ledger.summary.roi - -365.62 / 7535.62) < 1e-12);
  assert.equal(ledger.review.strategies.length, 10);
  assert(ledger.review.daily.length > 0);
  check("498张旧票收益及剔除退票的ROI与旧账本一致");
  await page
    .getByText("复盘：十策略、昨日结算、失误集中与样本质量", { exact: true })
    .click();
  await page.getByText("十策略逐日结算比较", { exact: true }).click();
  await expect(
    page.locator(".ws-table-scroll").filter({ hasText: "结算账日" }),
  ).toBeVisible();
  await page.getByLabel("选择结算记录", { exact: true }).focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
  await expect(
    page.locator(".ws-chart-panel .ws-caption[aria-live]"),
  ).toContainText("第 11 笔");
  await page.screenshot({ path: path.join(dir, "journey-ledger-review.png") });
  check("十策略逐日比较、复盘及曲线结算点可操作");
  await page.getByLabel("选择结算账日", { exact: true }).focus();
  await page.keyboard.press("End");
  await expect(page.locator(".daily-chart .ws-caption")).toContainText(
    ledger.review.daily.at(-1).day,
  );
  check("策略逐日图可通过键盘读取最后一个账日");
  const ledgerDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出当前筛选 ↗", exact: true })
    .click();
  const ledgerFile = await ledgerDownload,
    targetLedger = path.join(dir, "downloaded-ledger.json");
  await ledgerFile.saveAs(targetLedger);
  const exportedLedger = JSON.parse(fs.readFileSync(targetLedger, "utf8"));
  assert.equal(exportedLedger.total, 498);
  assert.equal(exportedLedger.items.length, 498);
  check("账本导出498张筛选票，包含翻页后记录");
  await page.getByText(/失败单腿 · 共/).click();
  await page
    .getByRole("link", { name: "打开原票与换腿复盘 →" })
    .first()
    .click();
  await loaded();
  await expect(page.getByRole("dialog", { name: "记录详情" })).toBeVisible();
  const chosenRecord = await get(
    "ledger?mode=LEGACY_IMPORT&period=ALL&q=" +
      encodeURIComponent(ledger.review.failedLegs[0].ticketId),
  );
  assert.equal(chosenRecord.total, 1);
  await expect(page.getByRole("dialog")).toContainText(
    chosenRecord.items[0].title,
  );
  check("失败单腿直接打开唯一原票，原记录及换腿证据可复盘");
  await go("/models");
  await page
    .locator("details.lab-detail")
    .filter({ hasText: "查看全部" })
    .first()
    .locator(":scope > summary")
    .click();
  await action("offset=20", () =>
    page
      .getByRole("button", { name: "下一页样本", exact: true })
      .first()
      .click(),
  );
  await expect(page.locator("details[open]")).toContainText("第 21");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出全部筛选样本 ↗" }).click();
  const d = await download;
  const target = path.join(dir, "downloaded-study.json");
  await d.saveAs(target);
  const study = JSON.parse(fs.readFileSync(target, "utf8"));
  assert.equal(study.models.length, 3);
  assert(study.models.every((m) => m.samples.length === 115));
  check("模型逐场分页与完整115场、三个方法证据导出");
  await action("odds=MID", () =>
    page.getByLabel("研究赔率区间", { exact: true }).selectOption("MID"),
  );
  const filtered = await get("models?odds=MID");
  assert.equal(
    new Set(filtered.models.map((m) => m.metrics.eligibleN)).size,
    1,
  );
  check("模型赔率筛选采用同一比赛集合");
  await go("/system");
  const status = await get("status");
  assert.equal(status.automation[0].enabled, 1);
  assert(status.runner.length > 0);
  assert(status.queue.some((q) => q.state === "DONE"));
  check("运行状态展示活动来源、任务心跳及已完成推断");
  await go("/legacy");
  assert(!(await page.getByText("个人假设计算器", { exact: true }).count()));
  assert(!(await page.getByText("手工实际记录", { exact: true }).count()));
  check("旧档入口保留配置，已移除用户不需要的计算器和实际交易入口");
  assert.equal(report.errors.length, 0);
  report.finishedAt = new Date().toISOString();
} catch (e) {
  report.failure = String(e);
  await page.screenshot({ path: path.join(dir, "journey-failure.png") });
  process.exitCode = 1;
} finally {
  await browser.close();
  fs.writeFileSync(
    path.join(dir, "user-journeys.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
