import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const dir = ".runtime-v2/score-review-20261005";
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const report = {
  source: "Actual isolated LOCAL_RESEARCH, no mocked responses or real wagers",
  checks: [],
  snapshots: [],
  errors: [],
};
page.on("pageerror", (e) => report.errors.push(e.message));
const pass = (name) => {
  report.checks.push({ name, status: "PASS" });
  console.log("PASS", name);
};
const get = (query) =>
  page.evaluate(async (query) => {
    const r = await fetch(`/api/v2/workspace/ledger?${query}`);
    const j = await r.json();
    if (!r.ok) throw Error(JSON.stringify(j));
    return j.data;
  }, query);
const money = (x) =>
  x == null
    ? "—"
    : (Number(x) / 1e6).toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
async function go(version, mode = "PAPER_RESEARCH") {
  await page.goto(
    `http://127.0.0.1:5274/ledger?mode=${mode}&period=ALL&basis=PLACED&version=${version}`,
    { waitUntil: "domcontentloaded" },
  );
  await page
    .locator('[data-testid="score-performance"][data-loaded="true"]')
    .waitFor({ state: "attached", timeout: 60000 });
  return new URLSearchParams({
    mode,
    period: "ALL",
    basis: "PLACED",
    version,
  }).toString();
}
try {
  for (const [version, mode] of [
    ["GENERAL", "PAPER_RESEARCH"],
    ["SEPTEMBER20", "PAPER_RESEARCH"],
    ["GENERAL", "LEGACY_IMPORT"],
    ["V6", "PAPER_RESEARCH"],
  ]) {
    const query = await go(version, mode);
    const data = await get(query);
    assert.equal(
      data.scorePerformance.bands.reduce((n, b) => n + b.count, 0),
      data.total,
    );
    for (const b of data.scorePerformance.bands) {
      const text = await page.locator(`[data-grade="${b.grade}"]`).innerText();
      assert.ok(
        text.includes(money(b.profitAtoms)),
        `${version} ${b.grade} profit`,
      );
      assert.ok(text.includes(`${b.wins} / ${b.losses} / ${b.neutral}`));
    }
    report.snapshots.push({
      version,
      mode,
      total: data.total,
      grades: data.scorePerformance.bands.map(
        ({
          grade,
          count,
          wins,
          losses,
          open,
          settled,
          stakeAtoms,
          profitAtoms,
          roi,
        }) => ({
          grade,
          count,
          wins,
          losses,
          open,
          settled,
          stakeAtoms,
          profitAtoms,
          roi,
        }),
      ),
    });
    pass(`${version}/${mode} grades match real API, including all pages`);
    await page
      .locator('[data-testid="score-performance"]')
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${dir}/${mode === "LEGACY_IMPORT" ? "legacy" : version.toLowerCase()}-grade-review.png`,
    });
    if (version === "GENERAL" && mode === "PAPER_RESEARCH") {
      assert.ok(data.total > 40);
      assert.ok(data.items.some((t) => t.score != null));
      const band = data.scorePerformance.bands.find(
        (b) => b.grade !== "UNKNOWN" && b.count > 0,
      );
      await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes("/workspace/ledger?") &&
            r.url().includes(`score=${band.grade}`) &&
            r.status() === 200,
        ),
        page.locator(`[data-grade="${band.grade}"]`).click(),
      ]);
      await page.waitForFunction(
        (grade) =>
          document
            .querySelector(`[data-grade="${grade}"]`)
            ?.getAttribute("aria-pressed") === "true",
        band.grade,
      );
      const filtered = await get(query + `&score=${band.grade}`);
      assert.equal(filtered.total, band.count);
      assert.equal(filtered.scorePerformance.tickets, data.total);
      await page.waitForFunction(
        ({ count, grade }) =>
          document.querySelectorAll('[data-testid="ticket-card"]').length ===
            Math.min(40, count) &&
          Array.from(document.querySelectorAll(".ticket-frozen-score")).every(
            (e) => e.textContent.includes(`· ${grade}`),
          ),
        { count: filtered.total, grade: band.grade },
      );
      pass(
        "Click grade filters actual tickets while comparison retains all grades",
      );
      await page.locator(".score-exact summary").click();
      const exact = data.scorePerformance.exactScores.find(
        (b) => b.score != null,
      );
      await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes("/workspace/ledger?") &&
            new URL(r.url()).searchParams.get("score") ===
              `EXACT:${exact.score}` &&
            r.status() === 200,
        ),
        page
          .locator(".score-exact tbody button")
          .filter({ hasText: `${exact.score} · ${exact.grade}` })
          .click(),
      ]);
      const exactData = await get(query + `&score=EXACT:${exact.score}`);
      assert.equal(exactData.total, exact.count);
      assert.ok(exactData.items.every((t) => t.score === exact.score));
      pass("Exact frozen score drill-down selects matching bets");
      await page.locator(".score-exact summary").click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .locator('[data-testid="score-performance"]')
        .scrollIntoViewIfNeeded();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      await page
        .locator('[data-testid="score-performance"]')
        .screenshot({ path: `${dir}/mobile-grade-review.png` });
      pass("Mobile grade review fits viewport");
      await page.setViewportSize({ width: 1440, height: 1050 });
    }
  }
  assert.deepEqual(report.errors, []);
  pass("No browser script errors");
  fs.writeFileSync(`${dir}/browser.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.checks.length, screenshots: 5 }));
} catch (e) {
  report.failure = String(e);
  fs.writeFileSync(
    `${dir}/browser-failed.json`,
    JSON.stringify(report, null, 2),
  );
  await page.screenshot({ path: `${dir}/failed.png`, fullPage: true });
  throw e;
} finally {
  await browser.close();
}
