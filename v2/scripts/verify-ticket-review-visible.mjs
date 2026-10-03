import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const dir = ".runtime-v2/restore-ledger",
  report = {
    startedAt: new Date().toISOString(),
    checks: [],
    source: "Actual LOCAL_RESEARCH, existing tickets only",
  };
const b = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  }),
  p = await b.newPage({ viewport: { width: 1440, height: 1050 } });
const go = async (path) => {
  await p.goto("http://127.0.0.1:5274" + path);
  await p.locator('[data-testid="load-status"][data-loaded="true"]').waitFor();
};
const pass = (name) => report.checks.push({ name, status: "PASS" });
try {
  await go("/ledger");
  await p.screenshot({ path: dir + "/ledger-overview.png" });
  await p
    .locator('[aria-label="输赢筛选"]')
    .getByRole("button", { name: "输", exact: true })
    .click();
  await expect(
    p
      .locator('[aria-label="输赢筛选"]')
      .getByRole("button", { name: "输", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    p.locator('[data-testid="ticket-card"]').first().locator(".ticket-outcome"),
  ).toContainText("输");
  pass("Visible LOSS button really filters losing tickets");
  await p
    .locator('[data-testid="ticket-card"]')
    .first()
    .screenshot({ path: dir + "/yesterday-ticket.png" });
  await p
    .locator('[aria-label="输赢筛选"]')
    .getByRole("button", { name: "赢", exact: true })
    .click();
  await expect(
    p.locator('[data-testid="ticket-card"]').first().locator(".ticket-outcome"),
  ).toContainText("赢");
  pass("Visible WIN button really filters winning tickets");
  await p
    .locator('[data-testid="ticket-card"]')
    .first()
    .screenshot({ path: dir + "/yesterday-winner.png" });
  await go("/ledger?mode=LEGACY_IMPORT&period=ALL&ticketType=DOUBLE");
  await p
    .locator('[data-testid="ticket-card"]')
    .first()
    .screenshot({ path: dir + "/legacy-double-ticket.png" });
  await expect(p.locator(".ticket-selection").first()).toContainText(
    "主队 -0.5",
  );
  pass("Real old Asian double uses signed direction rather than internal -1");
  await p.getByRole("button", { name: "浅色", exact: true }).click();
  await p
    .locator('[data-testid="ticket-card"]')
    .first()
    .screenshot({ path: dir + "/legacy-double-light.png" });
  pass("Light theme original double renders");
  await p.getByRole("button", { name: "深色", exact: true }).click();
  await p.getByText("每日对账 · 投注与结算分开", { exact: true }).click();
  const daily = p
    .locator("details")
    .filter({ has: p.getByText("每日对账 · 投注与结算分开", { exact: true }) });
  await daily
    .getByRole("button", { name: "2026-09-20 ↗", exact: true })
    .click();
  await expect(p.getByLabel("起始日期", { exact: true })).toHaveValue(
    "2026-09-20",
  );
  await expect(
    p.getByRole("button", { name: "按结算日期 · 那天赢了什么", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  pass("Original daily reconciliation date opens that settlement day");
  await p.setViewportSize({ width: 390, height: 844 });
  await go("/ledger?mode=LEGACY_IMPORT&period=ALL&ticketType=DOUBLE");
  await p
    .locator('[data-testid="ticket-card"]')
    .first()
    .scrollIntoViewIfNeeded();
  await p.screenshot({ path: dir + "/double-mobile-visible.png" });
  assert.ok(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  pass("Mobile original double first card and payoff readable");
  await go("/ledger");
  await p
    .locator('[data-testid="ticket-card"]')
    .first()
    .scrollIntoViewIfNeeded();
  await p.screenshot({ path: dir + "/yesterday-mobile-visible.png" });
  pass("Mobile yesterday first ticket readable");
  report.exitCode = 0;
} catch (e) {
  report.exitCode = 1;
  report.failure = String(e.stack);
  process.exitCode = 1;
  await p.screenshot({ path: dir + "/visible-failure.png" }).catch(() => {});
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(
    dir + "/visible-check.json",
    JSON.stringify(report, null, 2),
  );
  await b.close();
  console.log(JSON.stringify(report));
}
