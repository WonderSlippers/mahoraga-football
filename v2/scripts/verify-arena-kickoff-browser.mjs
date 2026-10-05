import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const dir = ".runtime-v2/arena-kickoff-20261005";
fs.mkdirSync(dir, { recursive: true });
const origin = "http://127.0.0.1:5274";
const report = {
  checks: [],
  errors: [],
  legs: 0,
  screenshots: [],
  limitations: [],
};
const formatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
page.on("pageerror", (e) => report.errors.push(e.message));
const response = (path, strategy) =>
  page.waitForResponse(
    (r) => {
      const u = new URL(r.url());
      return (
        u.origin === origin &&
        u.pathname === "/api/v2/workspace/" + path &&
        (!strategy || u.searchParams.get("strategy") === strategy) &&
        r.ok()
      );
    },
    { timeout: 60000 },
  );
const pass = (name, details = {}) =>
  report.checks.push({ name, status: "PASS", ...details });
async function inspect(scope, records, name) {
  const cards = scope.locator('[data-testid="ticket-card"]');
  await expect(cards).toHaveCount(records.length);
  let count = 0;
  for (const [i, record] of records.entries()) {
    const card = cards.nth(i);
    await expect(card.locator("header p")).toContainText("出票");
    const times = card.locator('[data-testid="ticket-kickoff"]');
    await expect(times).toHaveCount(record.legs.length);
    for (const [j, leg] of record.legs.entries()) {
      const time = times.nth(j);
      await expect(time).toBeVisible();
      if (leg.kickoffAt == null) {
        await expect(time).toHaveText("开赛时间未保存");
        await expect(time.locator("time")).toHaveCount(0);
      } else {
        const kickoff = new Date(leg.kickoffAt);
        await expect(time.locator("time")).toHaveAttribute(
          "datetime",
          kickoff.toISOString(),
        );
        await expect(time.locator("time")).toHaveText(
          formatter.format(kickoff),
        );
        await expect(time).toContainText("柏林时间");
        count++;
      }
    }
  }
  report.legs += count;
  pass(name, { tickets: records.length, savedKickoffs: count });
}
async function shot(name) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
    "page must fit viewport",
  );
  await page.locator("#strategy-actions").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/${name}.png` });
  report.screenshots.push(`${name}.png`);
}
try {
  const initial = response("arena");
  await page.goto(origin + "/strategies?version=GENERAL", {
    waitUntil: "domcontentloaded",
  });
  let arena = (await (await initial).json()).data;
  await expect(page.locator('[data-testid="strategy-arena"]')).toHaveAttribute(
    "data-loaded",
    "true",
  );
  await inspect(
    page.locator("#strategy-actions"),
    arena.latest,
    "Recent preview",
  );
  await shot("arena-preview-desktop");
  const versions = await page
    .getByLabel("模型版本")
    .locator("option")
    .evaluateAll((options) => options.map((option) => option.value));
  assert.ok(versions.includes("GENERAL") && versions.includes("SEPTEMBER20"));
  for (const version of versions) {
    if (version !== "GENERAL") {
      const pending = response("arena");
      await page.getByLabel("模型版本").selectOption(version);
      arena = (await (await pending).json()).data;
    }
    if (!arena.strategies.some((s) => s.lifetimeN > 0)) {
      assert.equal(arena.latest.length, 0);
      await expect(page.locator(".arena-feed .chart-empty")).toContainText(
        "当前没有该策略的模拟票",
      );
      report.limitations.push({
        version,
        reason:
          "No real stored paper tickets; kickoff rendering cannot be exercised for this version",
        strategies: arena.strategies.map((s) => ({
          id: s.id,
          tickets: s.lifetimeN,
        })),
      });
      pass(
        version +
          ": actual empty paper-ticket state shown without invented records",
      );
      continue;
    }
    const strategies =
      version === "GENERAL"
        ? arena.strategies
        : [arena.strategies.find((s) => s.lifetimeN > 0)].filter(Boolean);
    assert.ok(strategies.length > 0, version + " has real stored strategies");
    for (const strategy of strategies) {
      const pending = response("ledger", strategy.portfolioId);
      await page
        .locator("tr")
        .filter({
          has: page.locator(
            `a[href*="strategy=${encodeURIComponent(strategy.portfolioId)}"]`,
          ),
        })
        .locator(".rank-select")
        .click();
      const ledger = (await (await pending).json()).data;
      const scope = page.locator('[data-testid="strategy-records"]');
      await expect(scope).toHaveAttribute("aria-busy", "false", {
        timeout: 60000,
      });
      await inspect(scope, ledger.items, version + ":" + strategy.id);
      if (version === "GENERAL" && /value-singles$/.test(strategy.id)) {
        assert.ok(ledger.items.length > 0, "actual value tickets required");
        await shot("value-desktop");
        await page.setViewportSize({ width: 390, height: 844 });
        await inspect(scope, ledger.items, "Mobile value tickets");
        await shot("value-mobile");
        await page.setViewportSize({ width: 1440, height: 1050 });
      }
      if (version === "GENERAL" && /fun-double/.test(strategy.id)) {
        assert.ok(
          ledger.items.some((r) => r.legs.length === 2),
          "actual parlay required",
        );
        await shot("double-desktop");
        await page.setViewportSize({ width: 390, height: 844 });
        await inspect(
          scope,
          ledger.items,
          "Mobile parlay: each leg has its own kickoff",
        );
        await shot("double-mobile");
        await page.setViewportSize({ width: 1440, height: 1050 });
      }
    }
  }
  assert.ok(report.legs > 0);
  assert.deepEqual(report.errors, []);
  pass("No browser runtime errors");
} catch (e) {
  report.failure = String(e);
  await page.screenshot({ path: `${dir}/failure.png` }).catch(() => {});
  throw e;
} finally {
  report.checkedAt = new Date().toISOString();
  report.passed = report.checks.length;
  fs.writeFileSync(`${dir}/browser.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}
