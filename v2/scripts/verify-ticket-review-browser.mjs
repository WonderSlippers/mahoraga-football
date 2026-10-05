import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const dir = ".runtime-v2/restore-ledger";
const report = {
  startedAt: new Date().toISOString(),
  source:
    "Actual LOCAL_RESEARCH; no intercepted API or synthetic production records",
  checks: [],
  pages: [],
  errors: [],
};
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const p = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
p.on("pageerror", (e) => report.errors.push(e.message));
const get = (path) =>
  p.evaluate(async (path) => {
    const r = await fetch("/api/v2" + path);
    const j = await r.json();
    if (!r.ok) throw Error(JSON.stringify(j));
    return j.data;
  }, path);
const pass = (name) => report.checks.push({ name, status: "PASS" });
async function go(
  path,
  selector = '[data-testid="load-status"][data-loaded="true"]',
) {
  const at = Date.now();
  await p.goto("http://127.0.0.1:5274" + path, {
    waitUntil: "domcontentloaded",
  });
  await p.locator(selector).first().waitFor({ timeout: 60000 });
  report.pages.push({ path, loadMs: Date.now() - at });
  console.log("PAGE", path, Date.now() - at);
}
try {
  await go("/ledger");
  await expect(
    p.getByRole("button", { name: "按投注日期 · 那天投了什么", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const placed = await get(
    "/workspace/ledger?mode=PAPER_RESEARCH&period=YESTERDAY&basis=PLACED&limit=40",
  );
  assert.ok(placed.total > 0);
  assert.ok(
    placed.items.every(
      (r) =>
        r.legs.length === r.legCount &&
        r.legs.every((l) => l.selectionLabel && l.odds),
    ),
  );
  report.yesterdayPlaced = {
    total: placed.total,
    summary: placed.summary,
    asOf: placed.asOf,
  };
  await expect(p.locator('[data-testid="ticket-card"]').first()).toBeVisible();
  await expect(p.locator(".ticket-selection").first()).toContainText("@");
  pass(
    "Default yesterday placements show visible direction, original odds, whole outcome and stake",
  );
  await p.screenshot({ path: dir + "/yesterday-desktop.png", fullPage: true });
  await p
    .getByRole("button", { name: "按结算日期 · 那天赢了什么", exact: true })
    .click();
  await expect(
    p.getByRole("button", { name: "按结算日期 · 那天赢了什么", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const settled = await get(
    "/workspace/ledger?mode=PAPER_RESEARCH&period=YESTERDAY&basis=SETTLED&limit=40",
  );
  report.yesterdaySettled = {
    total: settled.total,
    summary: settled.summary,
    asOf: settled.asOf,
  };
  pass("Placement and settlement cohorts are independently selectable");
  await go(
    "/ledger?mode=PAPER_RESEARCH&period=YESTERDAY&basis=SETTLED&status=WIN",
  );
  const wins = await get(
    "/workspace/ledger?mode=PAPER_RESEARCH&period=YESTERDAY&basis=SETTLED&status=WIN",
  );
  assert.ok(wins.items.every((r) => ["WIN", "HALF_WIN"].includes(r.outcome)));
  pass("WIN filter uses actual outcome rather than SETTLED status");
  await go("/ledger?mode=LEGACY_IMPORT&period=ALL&ticketType=DOUBLE");
  const legacy = await get(
    "/workspace/ledger?mode=LEGACY_IMPORT&period=ALL&ticketType=DOUBLE&limit=40",
  );
  assert.ok(legacy.total > 0);
  assert.ok(
    legacy.items.every(
      (r) => r.legCount === 2 && r.legs.every((l) => l.selectionLabel !== -1),
    ),
  );
  const cards = p.locator('[data-testid="ticket-card"]');
  await expect(cards.first().locator(".ticket-leg")).toHaveCount(2);
  await expect(cards.first()).toContainText("2 串 1");
  report.legacyDoubles = { total: legacy.total, example: legacy.items[0] };
  pass(
    "Original double shows both selections, frozen prices, saved scores and whole combined odds",
  );
  await p.screenshot({
    path: dir + "/legacy-double-desktop.png",
    fullPage: true,
  });
  await cards.first().getByRole("button", { name: "原票与复盘 ↗" }).click();
  await expect(p.getByRole("dialog", { name: "记录详情" })).toBeVisible();
  pass("Original multi-leg record and read-only review open");
  await p.getByRole("button", { name: "关闭详情", exact: true }).click();
  await p
    .getByText("各策略账本 · 单场、二串一及旧版十策略", { exact: true })
    .click();
  assert.equal(
    (await get("/workspace/ledger?mode=LEGACY_IMPORT&period=ALL")).strategies
      .length,
    10,
  );
  pass("All ten original portfolio ledgers retained");
  await p.getByText("每日对账 · 投注与结算分开", { exact: true }).click();
  await expect(
    p
      .locator("details")
      .filter({
        has: p.getByText("每日对账 · 投注与结算分开", { exact: true }),
      })
      .locator("table"),
  ).toBeVisible();
  pass("Daily placements and settlement reconciliation visible");
  await p.setViewportSize({ width: 390, height: 844 });
  await go("/ledger");
  await expect(p.locator('[data-testid="ticket-card"]').first()).toBeVisible();
  assert.ok(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  pass("390px yesterday ledger has no page overflow");
  await p.screenshot({ path: dir + "/yesterday-mobile.png", fullPage: true });
  await go("/ledger?mode=LEGACY_IMPORT&period=ALL&ticketType=DOUBLE");
  assert.ok(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await p.screenshot({
    path: dir + "/legacy-double-mobile.png",
    fullPage: true,
  });
  pass("390px original doubles visible without horizontal page scrolling");
  await p.setViewportSize({ width: 1440, height: 1050 });
  await go("/review.html");
  await expect(p.locator('[data-testid="ticket-card"]').first()).toBeVisible();
  pass("Old review URL opens usable ledger");
  await go("/workbench", '[data-testid="general-panel"][data-loaded="true"]');
  await expect(
    p.getByRole("link", { name: "昨天投了什么、赢没赢 →" }),
  ).toBeVisible();
  await p.screenshot({ path: dir + "/schedule.png" });
  pass("Homepage yesterday review shortcut visible and real schedule loads");
  const schedule = await get("/workspace/schedule?view=ACTIVE");
  assert.ok(schedule.items.length > 0);
  await go(
    "/match/" + encodeURIComponent(schedule.items[0].id),
    '[data-testid="general-panel"][data-loaded="true"]',
  );
  await p.screenshot({ path: dir + "/match.png" });
  for (const [name, path, selector] of [
    ["history", "/history"],
    [
      "models",
      "/models",
      '[data-testid="general-laboratory"][data-loaded="true"]',
    ],
    ["runtime", "/system"],
    ["strategies", "/strategies", ".general-card"],
    ["legacy", "/legacy"],
  ]) {
    await go(path, selector);
    await p.screenshot({ path: dir + "/" + name + ".png" });
    pass(name + " real page loaded");
  }
  assert.equal(report.errors.length, 0);
  pass("No browser JavaScript exceptions");
  report.finishedAt = new Date().toISOString();
  report.exitCode = 0;
} catch (e) {
  report.failure = String(e.stack);
  report.exitCode = 1;
  process.exitCode = 1;
  await p.screenshot({ path: dir + "/failure.png" }).catch(() => {});
} finally {
  fs.writeFileSync(dir + "/browser.json", JSON.stringify(report, null, 2));
  await browser.close();
  console.log(
    JSON.stringify({
      exitCode: report.exitCode,
      checks: report.checks.length,
      pages: report.pages,
      failure: report.failure,
    }),
  );
}
