import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const dir = ".runtime-v2/strategy-records-20261004";
fs.mkdirSync(dir, { recursive: true });
const origin = "http://127.0.0.1:5274";
const checks = [],
  errors = [],
  reports = new Map();
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().startsWith("Failed to load resource:"))
    errors.push(m.text());
});
page.on("response", async (r) => {
  const url = new URL(r.url());
  if (
    r.url().startsWith(origin) &&
    r.status() >= 400 &&
    !(url.pathname === "/api/v2/session" && r.status() === 401)
  )
    errors.push(`HTTP ${r.status()} ${url.pathname}`);
  if (url.pathname === "/api/v2/workspace/ledger" && r.ok()) {
    const json = await r.json();
    reports.set(
      [
        url.searchParams.get("version"),
        url.searchParams.get("strategy"),
        url.searchParams.get("period"),
        url.searchParams.get("offset") ?? "0",
      ].join(":"),
      json.data,
    );
  }
});
async function data(route) {
  return page.evaluate(async (route) => {
    const r = await fetch("/api/v2" + route);
    if (!r.ok) throw Error("HTTP " + r.status());
    return (await r.json()).data;
  }, route);
}
async function loaded() {
  await page
    .locator('[data-testid="strategy-arena"][data-loaded="true"]')
    .waitFor({ timeout: 45000 });
}
async function records() {
  await page
    .locator(
      '[data-testid="strategy-records"][data-loaded="true"][aria-busy="false"]',
    )
    .waitFor({ timeout: 45000 });
}
async function shot(name) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
    "horizontal overflow",
  );
  assert.deepEqual(
    (await page.locator('[role="alert"]').allTextContents()).filter((x) =>
      x.trim(),
    ),
    [],
  );
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}
let paginated = false;
try {
  await page.goto(origin + "/strategies?version=GENERAL");
  await loaded();
  for (const version of ["GENERAL", "SEPTEMBER20", "V6"]) {
    await page.getByLabel("模型版本").selectOption(version);
    await loaded();
    const arena = await data("/workspace/arena?period=ALL&version=" + version);
    for (const s of arena.strategies) {
      // GENERAL uses shorter display names. Row account order is independent of ranking.
      const row = page.locator("tr").filter({
        has: page.locator(
          `a[href*="strategy=${encodeURIComponent(s.portfolioId)}"]`,
        ),
      });
      await row.locator(".rank-select").click();
      await records();
      await page.waitForFunction(() => {
        const bounds = document
          .getElementById("strategy-actions")
          ?.getBoundingClientRect();
        return bounds && bounds.top < innerHeight && bounds.bottom > 0;
      });
      assert.ok(
        (await page.locator(".arena-focus").innerText()).includes(
          `每日新增上限 ${s.maximumPerDay} 张`,
        ),
      );
      const key = [version, s.portfolioId, "ALL", "0"].join(":");
      const report = reports.get(key);
      assert.ok(report, key + " real ledger response");
      assert.equal(report.total, s.lifetimeN);
      assert.equal(
        await page
          .locator(
            '[data-testid="strategy-records"] [data-testid="ticket-card"]',
          )
          .count(),
        Math.min(40, report.total),
      );
      const link = page.getByRole("link", { name: "打开完整账本 ↗" });
      const href = new URL(await link.getAttribute("href"), origin);
      assert.equal(href.searchParams.get("strategy"), s.portfolioId);
      assert.equal(href.searchParams.get("basis"), "PLACED");
      assert.equal(href.searchParams.get("period"), "ALL");
      const rankLink = new URL(
        await row.locator("a").getAttribute("href"),
        origin,
      );
      assert.equal(rankLink.searchParams.get("basis"), "PLACED");
      checks.push({
        name: version + ":" + s.id,
        total: report.total,
        maximumPerDay: s.maximumPerDay,
        displayed: Math.min(40, report.total),
        open: report.summary.open,
        settled: report.summary.settled,
      });
      if (s.id.endsWith("value-singles"))
        await shot(version.toLowerCase() + "-value-all");
      if (!paginated && report.nextOffset != null) {
        await page.getByRole("button", { name: "下一页", exact: true }).click();
        await records();
        const next = reports.get(
          [version, s.portfolioId, "ALL", String(report.nextOffset)].join(":"),
        );
        assert.ok(next);
        assert.equal(
          await page
            .locator(
              '[data-testid="strategy-records"] [data-testid="ticket-card"]',
            )
            .count(),
          next.items.length,
        );
        assert.ok(
          next.items.every(
            (r) => !report.items.some((previous) => previous.id === r.id),
          ),
        );
        await shot("complete-records-page-two");
        await page
          .locator('[data-testid="strategy-records"] button')
          .filter({ hasText: "复盘" })
          .first()
          .click();
        await page.locator('[role="dialog"]').waitFor({ timeout: 45000 });
        assert.equal(
          new URL(page.url()).searchParams.get("strategy"),
          s.portfolioId,
        );
        assert.equal(
          new URL(page.url()).searchParams.get("offset"),
          String(report.nextOffset),
        );
        assert.equal(await page.getByLabel("模型版本").inputValue(), version);
        await shot("page-two-ticket-review");
        checks.push({
          name: "pagination-and-page-two-review",
          total: report.total,
          nextPage: next.items.length,
        });
        await page.goto(origin + "/strategies");
        await loaded();
        paginated = true;
      }
    }
  }
  assert.ok(paginated, "real data pagination exercised");
  await page.getByLabel("模型版本").selectOption("SEPTEMBER20");
  await loaded();
  const arena = await data("/workspace/arena?period=ALL&version=SEPTEMBER20");
  const value = arena.strategies.find(
    (s) => s.id === "september20:value-singles",
  );
  await page
    .locator("tr")
    .filter({
      has: page.locator(
        `a[href*="strategy=${encodeURIComponent(value.portfolioId)}"]`,
      ),
    })
    .locator(".rank-select")
    .click();
  await records();
  await page.getByRole("button", { name: "今天", exact: true }).click();
  await records();
  const today = reports.get(
    ["SEPTEMBER20", value.portfolioId, "TODAY", "0"].join(":"),
  );
  assert.ok(today);
  assert.equal(
    await page
      .locator('[data-testid="strategy-records"] [data-testid="ticket-card"]')
      .count(),
    Math.min(40, today.total),
  );
  const todayLink = new URL(
    await page
      .getByRole("link", { name: "打开完整账本 ↗" })
      .getAttribute("href"),
    origin,
  );
  assert.equal(todayLink.searchParams.get("period"), "TODAY");
  checks.push({ name: "period-resets-pagination", total: today.total });
  await page.getByRole("button", { name: "累计", exact: true }).click();
  await records();
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("september20-value-mobile");
  await page.locator("#strategy-actions").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/value-records-mobile-viewport.png` });
  checks.push({ name: "mobile-complete-records" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/system");
  await page
    .locator('[data-testid="load-status"][data-loaded="true"]')
    .first()
    .waitFor({ state: "attached", timeout: 45000 });
  await shot("automation-status");
  checks.push({ name: "live-automation-status" });
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    `${dir}/browser-result.json`,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        passed: checks.length,
        checks,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, checks, errors }));
} catch (e) {
  await page
    .screenshot({ path: `${dir}/browser-failure.png`, fullPage: true })
    .catch(() => {});
  fs.writeFileSync(
    `${dir}/browser-failure.json`,
    JSON.stringify({ error: String(e), checks, errors }, null, 2),
  );
  throw e;
} finally {
  await browser.close();
}
