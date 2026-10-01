import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const dir = path.resolve(".runtime-v2/parallel-models");
fs.mkdirSync(dir, { recursive: true });
const report = {
  at: new Date().toISOString(),
  checks: [],
  errors: [],
  pages: [],
};
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const check = (name) => report.checks.push({ name, status: "PASS" });
const loaded = (page) =>
  page
    .locator('[data-testid="load-status"][data-loaded="true"]')
    .waitFor({ timeout: 60000 });
const api = (page, route) =>
  page.evaluate(async (route) => {
    const r = await fetch("/api/v2/" + route);
    const j = await r.json();
    if (!r.ok) throw Error(j.error?.code);
    return j.data;
  }, route);
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 1000 },
    });
    page.on("pageerror", (e) => report.errors.push(String(e)));
    await page.goto("http://127.0.0.1:5274/workbench");
    await loaded(page);
    const schedule = await api(page, "workspace/schedule?upcoming=1");
    assert.ok(schedule.total > 0);
    assert.ok(
      schedule.items.every(
        (f) =>
          new Date(f.kickoffAt).getTime() > Date.now() &&
          !["FINISHED", "LIVE", "CANCELLED"].includes(f.status),
      ),
    );
    check(`中文未开赛完整目录 ${width}`);
    const fixture = schedule.researchCandidates[0]?.id || schedule.items[0].id;
    for (const [name, route] of [
      ["schedule", "/workbench"],
      ["match", "/match/" + encodeURIComponent(fixture)],
      ["history", "/history"],
      ["ledger", "/ledger"],
      ["models", "/models"],
      ["runtime", "/system"],
    ]) {
      await page.goto("http://127.0.0.1:5274" + route);
      await loaded(page);
      if (["schedule", "match", "models"].includes(name))
        await page
          .locator('[data-testid="parallel-comparison"][data-loaded="true"]')
          .waitFor({ timeout: 30000 });
      await page.waitForTimeout(200);
      const layout = await page.evaluate(() => ({
        viewport: innerWidth,
        body: document.body.scrollWidth,
        firstFixture: document
          .querySelector(".fixture-card")
          ?.getBoundingClientRect().top,
        headings: [...document.querySelectorAll("h1,h2")].map(
          (x) => x.textContent,
        ),
      }));
      assert.ok(layout.body <= width, `${name}: ${layout.body}>${width}`);
      if (name === "schedule")
        assert.ok(
          layout.firstFixture < 760,
          "Fixture entry must remain visible near the first screen",
        );
      const screenshot = path.join(dir, `${name}-${width}.png`);
      await page.screenshot({ path: screenshot, fullPage: false });
      report.pages.push({ name, route, width, layout, screenshot });
    }
    await page.goto("http://127.0.0.1:5274/models");
    await loaded(page);
    await expect(
      page.locator('[data-testid="parallel-comparison"]'),
    ).toContainText("V6 原生规则");
    const all = await api(page, "workspace/comparison");
    assert.equal(all.methods.length, 2);
    assert.equal(all.savedV7.status, "SAVED_NOT_AUTO_PROMOTED");
    check(`固定方法与V7封存 ${width}`);
    await page.getByLabel("比较口径").selectOption("all");
    await expect(page.getByLabel("比较口径")).toHaveValue("all");
    check(`共同样本/独立覆盖切换 ${width}`);
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "导出冻结记录 ↗", exact: true })
      .click();
    const download = await downloadPromise;
    const file = path.join(dir, `comparison-export-${width}.json`);
    await download.saveAs(file);
    const exported = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(exported.methods.length, 2);
    assert.equal(exported.records.length, exported.totalRecords);
    check(`全量冻结记录导出 ${width}`);
    const v6 = exported.records.find(
      (r) =>
        r.methodId.startsWith("V6") &&
        r.state === "DONE" &&
        r.output.actions.length &&
        new Date(r.kickoffAt).getTime() > Date.now(),
    );
    assert.ok(
      v6,
      "Real V6 native action is required; no synthetic substitution",
    );
    await page.goto(
      "http://127.0.0.1:5274/match/" + encodeURIComponent(v6.fixtureId),
    );
    await loaded(page);
    await page
      .locator('[data-testid="parallel-comparison"][data-loaded="true"]')
      .waitFor({ timeout: 30000 });
    await expect(
      page.locator('[data-testid="parallel-comparison"]'),
    ).toContainText("V6 原生规则");
    await page
      .locator('[data-testid="parallel-comparison"]')
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(dir, `real-v6-action-${width}.png`),
      fullPage: false,
    });
    check(`真实V6规则方向和冻结详情 ${width}`);
    const transfer = await page.evaluate(async () => {
      const started = performance.now(),
        r = await fetch("/api/v2/workspace/schedule?upcoming=1"),
        body = await r.text();
      return {
        status: r.status,
        bytes: new TextEncoder().encode(body).byteLength,
        elapsedMs: performance.now() - started,
      };
    });
    assert.equal(transfer.status, 200);
    fs.writeFileSync(
      path.join(dir, `schedule-transfer-${width}.json`),
      JSON.stringify(transfer, null, 2),
    );
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => report.errors.push(String(e)));
  const device = await (
    await fetch("http://127.0.0.1:5274/api/v2/device-access")
  ).json();
  assert.ok(device.data.lanOrigin);
  const origin = device.data.lanOrigin;
  await page.goto(origin + "/workbench");
  await loaded(page);
  check("通过真实私网地址进入，无登录口令");
  assert.equal(await page.evaluate(() => window.isSecureContext), false);
  await page.getByRole("button", { name: "立即刷新 ↗", exact: true }).click();
  await expect(page.locator(".ws-notice")).not.toHaveText("Error:");
  const refreshResult = await page.evaluate(async () => {
    const session = await (await fetch("/api/v2/session")).json();
    const r = await fetch("/api/v2/workspace/refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.data.csrf,
        "Idempotency-Key": "browser-verified-private-http-" + Date.now(),
      },
      body: "{}",
    });
    return { status: r.status, body: await r.json() };
  });
  assert.equal(refreshResult.status, 200);
  check("手机私网HTTP会话、CSRF与写请求实际通过");
  const internal = await page.evaluate(async () => {
    const r = await fetch("/internal/v2/model-jobs/claim");
    return r.status;
  });
  assert.equal(internal, 403);
  check("私网入口无法访问内部模型接口");
  await page.screenshot({
    path: path.join(dir, "phone-lan-390.png"),
    fullPage: false,
  });
  await page.goto(origin + "/models");
  await loaded(page);
  await expect(
    page.locator('[data-testid="parallel-comparison"]'),
  ).toContainText("V6 原生规则");
  await page.screenshot({
    path: path.join(dir, "phone-comparison-390.png"),
    fullPage: false,
  });
  fs.writeFileSync(
    path.join(dir, "live-comparison.json"),
    JSON.stringify(await api(page, "workspace/comparison"), null, 2),
  );
  fs.writeFileSync(
    path.join(dir, "device-access.json"),
    JSON.stringify(device.data, null, 2),
  );
  await page.close();
} catch (e) {
  report.errors.push(String(e));
  process.exitCode = 1;
} finally {
  await browser.close();
  fs.writeFileSync(
    path.join(dir, "browser-verification.json"),
    JSON.stringify(report, null, 2),
  );
}
console.log(
  JSON.stringify(
    {
      checks: report.checks.length,
      pages: report.pages.length,
      errors: report.errors,
    },
    null,
    2,
  ),
);
if (report.errors.length) process.exitCode = 1;
