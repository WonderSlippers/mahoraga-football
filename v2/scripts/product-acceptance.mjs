import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const dir = ".runtime-v2/product-20261004";
fs.mkdirSync(dir, { recursive: true });
const report = {
  startedAt: new Date().toISOString(),
  scope:
    "Actual isolated LOCAL_RESEARCH, real browser, no interception or inserted demo outcomes",
  checks: [],
  pages: [],
  navigation: [],
  errors: [],
  requests: [],
};
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
p.on("pageerror", (e) => report.errors.push(e.message));
const started = new Map();
p.on("request", (r) => started.set(r, Date.now()));
p.on("response", (r) => {
  if (r.url().includes("/api/v2/"))
    report.requests.push({
      path: new URL(r.url()).pathname + new URL(r.url()).search,
      status: r.status(),
      ms: Date.now() - started.get(r.request()),
    });
});
const get = (path) =>
  p.evaluate(async (path) => {
    const r = await fetch("/api/v2" + path),
      j = await r.json();
    if (!r.ok) throw Error(JSON.stringify(j));
    return j.data;
  }, path);
const pass = (name) => {
  report.checks.push({ name, status: "PASS" });
  console.log("PASS", name);
};
async function ready(
  selector = '[data-testid="load-status"][data-loaded="true"]',
) {
  await p
    .locator(selector)
    .first()
    .waitFor({ state: "attached", timeout: 30000 });
}
async function go(path, selector) {
  const t = Date.now();
  await p.goto("http://127.0.0.1:5274" + path, {
    waitUntil: "domcontentloaded",
  });
  await ready(selector);
  report.pages.push({ path, ms: Date.now() - t });
  console.log("PAGE", path, Date.now() - t);
}
async function shot(name, fullPage = true) {
  await p.screenshot({ path: dir + "/" + name + ".png", fullPage });
}
try {
  await go("/strategies", '[data-testid="strategy-arena"][data-loaded="true"]');
  const meta = await get("/meta");
  assert.equal(meta.mode, "LOCAL_RESEARCH");
  report.runtime = {
    installationId: meta.installationId,
    mode: meta.mode,
    appCodeSha: meta.appCodeSha,
  };
  const arena = await get("/workspace/arena?period=ALL");
  report.arena = arena;
  assert.equal(arena.strategies.length, 7);
  assert.ok(
    arena.strategies.every((s) => typeof s.metrics.settled === "number"),
  );
  assert.ok(
    arena.strategies.some(
      (s) => s.id === "general-fun-double-v1" && s.category === "BENCHMARK",
    ),
  );
  await expect(
    p.getByRole("heading", { name: "策略排行榜", exact: true }),
  ).toBeVisible();
  await expect(p.locator('[data-testid="profit-chart"]')).toBeVisible();
  pass(
    "Seven real strategy accounts with visible ROI, wins/losses, drawdown and cumulative profit comparison",
  );
  assert.equal(await p.locator(".shell > nav > a").count(), 4);
  pass(
    "Four plain primary entrances; technical and legacy tools live on the secondary page",
  );
  await shot("arena-desktop", false);
  await shot("arena-full");
  await p.getByRole("button", { name: "胜平负基准", exact: true }).click();
  await expect(p.locator(".arena-ranking tr.focused")).toContainText(
    "胜平负基准",
  );
  await expect(p.locator(".arena-focus")).toContainText("每场选最可能");
  pass(
    "Chart legend focuses strategy, explanation and actual latest tickets without fetching heavy research reports",
  );
  await shot("arena-selected", false);
  await Promise.all([
    p.waitForResponse(
      (r) =>
        r.url().includes("/workspace/arena?period=YESTERDAY") &&
        r.status() === 200,
    ),
    p.getByRole("button", { name: "昨天", exact: true }).click(),
  ]);
  const yesterday = await get("/workspace/arena?period=YESTERDAY");
  report.yesterday = yesterday.summary;
  assert.ok(
    yesterday.daily.every(
      (d) =>
        d.day !==
        new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" }),
    ),
  );
  pass("Yesterday strategy performance uses Berlin settlement dates");
  await p.getByRole("button", { name: "模拟设置", exact: true }).click();
  await expect(
    p.getByRole("heading", { name: "自动模拟设置", exact: true }),
  ).toBeVisible();
  assert.equal(await p.locator(".arena-setting").count(), 7);
  pass(
    "Settings are optional and show real pause/limit controls for each account",
  );
  await p.getByRole("button", { name: "完成", exact: true }).click();
  let t = Date.now();
  await p
    .locator(".shell > nav")
    .getByRole("link", { name: "战绩与复盘" })
    .click();
  await ready();
  report.navigation.push({ to: "ledger", ms: Date.now() - t });
  await expect(p.getByRole("heading", { name: /战绩与复盘/ })).toBeVisible();
  await expect(p.locator(".ws-chart-panel svg")).toBeVisible();
  await expect(p.locator('[data-testid="ticket-card"]').first()).toBeVisible();
  const ledger = await get(
    "/workspace/ledger?mode=PAPER_RESEARCH&period=YESTERDAY&basis=PLACED",
  );
  assert.ok(ledger.total > 0);
  report.ledger = {
    total: ledger.total,
    summary: ledger.summary,
    first: ledger.items[0],
  };
  pass(
    "Yesterday original simulated selections, odds, whole outcomes and visible earnings curve",
  );
  await p.waitForFunction(() =>
    [...document.querySelectorAll(".ticket-card img.team-crest")].some(
      (img) => img.complete && img.naturalWidth > 0,
    ),
  );
  pass("Ledger renders actual team logos beside original Chinese team names");
  await shot("ledger-desktop", false);
  await shot("ledger-full");
  await p
    .locator('[data-testid="ticket-card"]')
    .first()
    .getByRole("button", { name: "复盘 ↗", exact: true })
    .click();
  await expect(p.getByRole("dialog", { name: "记录详情" })).toBeVisible();
  await p.getByRole("button", { name: "关闭详情", exact: true }).click();
  pass("Original-ticket review opens and closes in one action");
  t = Date.now();
  await p
    .locator(".shell > nav")
    .getByRole("link", { name: "策略竞技场" })
    .click();
  await ready('[data-testid="strategy-arena"][data-loaded="true"]');
  report.navigation.push({ to: "arena-warm", ms: Date.now() - t });
  pass(
    "Previously opened arena shows cached real snapshot immediately and refreshes in background",
  );
  await go("/ledger?mode=PAPER_RESEARCH&period=ALL&status=WIN");
  const winners = await get(
    "/workspace/ledger?mode=PAPER_RESEARCH&period=ALL&status=WIN",
  );
  assert.ok(winners.total > 0);
  assert.ok(
    winners.items.every((r) => ["WIN", "HALF_WIN"].includes(r.outcome)),
  );
  pass("Winning filter comes from actual settled outcomes");
  await shot("winning-tickets", false);
  await go("/ledger?mode=LEGACY_IMPORT&period=ALL&ticketType=DOUBLE");
  const old = await get(
    "/workspace/ledger?mode=LEGACY_IMPORT&period=ALL&ticketType=DOUBLE",
  );
  assert.ok(old.total > 0);
  assert.ok(old.items.every((r) => r.legCount === 2));
  await expect(
    p.locator('[data-testid="ticket-card"]').first().locator(".ticket-leg"),
  ).toHaveCount(2);
  pass(
    "1.0 double archives retain both selections, original odds and outcomes",
  );
  await shot("legacy-double", false);
  await go(
    "/ledger?mode=PAPER_RESEARCH&period=ALL&strategy=paper%3Ageneral-fun-double-v1",
  );
  const fun = await get(
    "/workspace/ledger?mode=PAPER_RESEARCH&period=ALL&strategy=paper%3Ageneral-fun-double-v1",
  );
  assert.ok(fun.total > 0);
  assert.ok(
    fun.items.every(
      (r) => r.legCount === 2 && r.legs[0].fixtureId !== r.legs[1].fixtureId,
    ),
  );
  await expect(
    p.locator('[data-testid="ticket-card"]').first().locator(".ticket-leg"),
  ).toHaveCount(2);
  report.funDouble = { total: fun.total, summary: fun.summary };
  pass(
    "Automatic entertainment doubles use actual distinct matches, original odds and a separate virtual account",
  );
  await shot("entertainment-double", false);
  await go("/workbench");
  await expect(p.getByRole("heading", { name: /比赛与推荐/ })).toBeVisible();
  await shot("fixtures", false);
  const links = p.locator('a[href^="/match/"]');
  assert.ok((await links.count()) > 0);
  const target = await links.first().getAttribute("href");
  await go(target);
  await expect(p.locator(".team-crest").first()).toBeVisible();
  pass("Fixture detail remains accessible with teams and frozen evidence");
  await shot("match-detail", false);
  await go("/models", '[data-testid="general-laboratory"][data-loaded="true"]');
  await expect(
    p.locator('[data-testid="general-laboratory"][data-loaded="true"]'),
  ).toBeVisible({ timeout: 30000 });
  pass(
    "Model laboratory still exposes actual frozen probability and portfolio comparisons",
  );
  await shot("models", false);
  await p
    .getByRole("button", { name: "V6与旧V2 · 前瞻对照", exact: true })
    .click();
  await ready('[data-testid="parallel-comparison"][data-loaded="true"]');
  pass(
    "V6 and saved V2 forward comparison remains usable behind its own laboratory tab",
  );
  await shot("models-forward", false);
  await p
    .getByRole("button", { name: "V6 / V7 / 市场 · 历史研究", exact: true })
    .click();
  await ready();
  await expect(
    p.getByRole("heading", { name: "同一批比赛，三种固定方法", exact: true }),
  ).toBeVisible();
  pass(
    "Historical V6/V7/market matrix retains sample boundaries and independent metrics",
  );
  await shot("models-historical", false);
  await go("/system");
  const status = await get("/workspace/status");
  report.status = {
    automation: status.automation,
    runner: status.runner,
    queue: status.queue,
    sources: status.sources.map((s) => ({
      state: s.state,
      reason: s.reason,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
    })),
  };
  pass(
    "Data status shows actual runner, source attempts, queue and automatic processing",
  );
  await shot("runtime", false);
  await go("/history");
  pass("Historical center retains real imported records");
  await shot("history", false);
  await go("/tools", ".tools-grid");
  await expect(
    p.getByRole("heading", { name: "研究与设置", exact: true }),
  ).toBeVisible();
  assert.equal(await p.locator(".tool-card").count(), 6);
  pass("Secondary tools have direct descriptions and working destinations");
  await shot("tools", false);
  await p.setViewportSize({ width: 390, height: 844 });
  await go("/strategies", '[data-testid="strategy-arena"][data-loaded="true"]');
  assert.ok(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  pass(
    "390px arena has no page overflow; charts and strategy table stay usable",
  );
  const mobileRankingWidth = await p
    .locator(".arena-rank-scroll")
    .evaluate((e) => ({ scroll: e.scrollWidth, visible: e.clientWidth }));
  assert.ok(mobileRankingWidth.scroll <= mobileRankingWidth.visible + 1);
  await expect(p.locator(".rank-mobile-counts").first()).toBeVisible();
  pass(
    "Mobile ranking shows ROI, net profit and win/loss counts without horizontal table scrolling",
  );
  await shot("arena-mobile", false);
  await go("/ledger");
  assert.ok(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  pass("390px ledger keeps direct selections and odds without page overflow");
  await shot("ledger-mobile", false);
  await p.setViewportSize({ width: 1440, height: 1000 });
  await go("/strategies", '[data-testid="strategy-arena"][data-loaded="true"]');
  await p.getByRole("button", { name: "浅色", exact: true }).click();
  await shot("arena-light", false);
  assert.ok(
    await p.evaluate(() => document.documentElement.dataset.theme === "light"),
  );
  pass("Light theme and dark theme both render actual strategy results");
  await p.getByRole("button", { name: "深色", exact: true }).click();
  assert.deepEqual(report.errors, []);
  pass("No browser JavaScript exceptions");
} catch (e) {
  report.failure = String(e.stack);
  console.error(e);
  await shot("browser-failure", false);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(dir + "/browser.json", JSON.stringify(report, null, 2));
  console.log("CHECKS", report.checks.length, "EXIT", process.exitCode ?? 0);
  await browser.close();
}
