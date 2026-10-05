import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const dir = ".runtime-v2/general-adaptation-20261005";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const report = {
  source:
    "Actual isolated research site; no intercepted APIs or invented production outcomes",
  checks: [],
  errors: [],
  snapshots: [],
};
page.on("pageerror", (e) => report.errors.push(e.message));
const pass = (name) => report.checks.push({ name, status: "PASS" });
const get = (url) =>
  page.evaluate(async (url) => {
    const r = await fetch(url),
      j = await r.json();
    if (!r.ok) throw Error(JSON.stringify(j));
    return j.data;
  }, url);
async function go(path) {
  await page.goto("http://127.0.0.1:5274" + path, {
    waitUntil: "domcontentloaded",
  });
  await page
    .locator('[data-testid="load-status"][data-loaded="true"]')
    .first()
    .waitFor({ state: "attached", timeout: 60000 });
}
try {
  await go("/workbench");
  const general = await get("/api/v2/workspace/universal");
  assert.equal(general.manifest.id, "GENERAL_FOOTBALL_ADAPTIVE_RESEARCH_V1");
  assert.ok(general.records.length > 0);
  pass(
    "General recommendations and historical frozen observations remain available",
  );
  await page.screenshot({ path: dir + "/workbench.png" });
  report.snapshots.push({
    page: "workbench",
    observations: general.records.length,
  });
  const learning = await get("/api/v2/workspace/general-adaptation");
  assert.equal(learning.active.protocol, "GENERAL_PREQUENTIAL_CALIBRATION_V1");
  assert.equal(learning.rules.minimumValidation, 30);
  assert.ok(
    learning.active.modelTrust >= 0.6 && learning.active.modelTrust <= 1,
  );
  pass(
    "Authenticated diagnostic API exposes persisted calibration and bounded protocol",
  );
  report.learning = learning;
  const denied = await page.evaluate(async () => {
    const r = await fetch("/internal/v2/general-learning/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner: "browser" }),
    });
    return r.status;
  });
  assert.ok(denied >= 400);
  pass("Browser cannot claim or submit internal parameter tasks");
  await go(
    "/ledger?mode=PAPER_RESEARCH&period=ALL&basis=PLACED&version=GENERAL",
  );
  await page
    .locator('[data-testid="score-performance"][data-loaded="true"]')
    .waitFor({ state: "attached", timeout: 60000 });
  const ledger = await get(
    "/api/v2/workspace/ledger?mode=PAPER_RESEARCH&period=ALL&basis=PLACED&version=GENERAL",
  );
  assert.ok(ledger.total > 0);
  assert.equal(ledger.scorePerformance.tickets, ledger.total);
  assert.ok(
    ledger.items.some((t) => t.models.includes("GENERAL_FOOTBALL_RESEARCH_V2")),
  );
  pass(
    "General ledger retains old fixed-model tickets and frozen grade performance",
  );
  await page.screenshot({ path: dir + "/ledger.png" });
  report.snapshots.push({ page: "ledger", tickets: ledger.total });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  pass("Mobile ledger fits viewport");
  await page.screenshot({ path: dir + "/mobile-ledger.png" });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await go("/system");
  await page.screenshot({ path: dir + "/system.png" });
  pass("Data runtime page remains usable");
  assert.deepEqual(report.errors, []);
  fs.writeFileSync(dir + "/browser.json", JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      passed: report.checks.length,
      screenshots: 4,
      learningRevision: learning.active.revision,
      pending: learning.pending?.state ?? null,
    }),
  );
} catch (error) {
  report.failure = String(error);
  fs.writeFileSync(
    dir + "/browser-failed.json",
    JSON.stringify(report, null, 2),
  );
  await page.screenshot({ path: dir + "/browser-failed.png" });
  throw error;
} finally {
  await browser.close();
}
