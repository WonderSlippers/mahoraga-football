import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const origin = "http://127.0.0.1:5274",
  dir = ".runtime-v2/recommendation-scores-20261004";
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [],
  checks = [],
  responses = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().startsWith("Failed to load resource:"))
    errors.push(m.text());
});
page.on("response", (r) => {
  const u = new URL(r.url());
  if (
    r.url().startsWith(origin) &&
    r.status() >= 400 &&
    !(u.pathname === "/api/v2/session" && r.status() === 401)
  )
    errors.push(`HTTP ${r.status()} ${u.pathname}`);
  if (u.pathname.startsWith("/api/v2/workspace/"))
    responses.push({ path: u.pathname + u.search, status: r.status() });
});
async function data(route) {
  return page.evaluate(async (route) => {
    const r = await fetch("/api/v2" + route);
    if (!r.ok) throw Error("HTTP " + r.status());
    return (await r.json()).data;
  }, route);
}
async function ready() {
  await page
    .locator('[data-testid="general-panel"][data-loaded="true"]')
    .waitFor({ timeout: 45000 });
  await page
    .locator('[data-testid="load-status"][data-loaded="true"]')
    .first()
    .waitFor({ state: "attached", timeout: 45000 });
}
async function shot(name) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
    "overflow " + name,
  );
  assert.deepEqual(
    (await page.locator('[role="alert"]').allTextContents()).filter((s) =>
      s.trim(),
    ),
    [],
  );
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}
try {
  await page.goto(origin + "/workbench?period=ALL&view=ALL&version=GENERAL");
  await ready();
  const reports = {};
  for (const version of ["GENERAL", "SEPTEMBER20"]) {
    await page.getByLabel("模型版本").selectOption(version);
    await ready();
    const report = await data("/workspace/universal?version=" + version);
    reports[version] = report;
    const cards = page.locator('[data-testid="general-plan"]');
    assert.ok(
      (await cards.count()) > 0,
      version + " real recommendations or broad direction",
    );
    for (const card of await cards.all()) {
      const id = await card.getAttribute("data-decision-id");
      const r = report.records.find((r) =>
        r.output.plans?.some((p) => p.decisionId === id),
      );
      assert.ok(r, id);
      const p = r.output.plans.find((p) => p.decisionId === id);
      const score = card.getByTestId("recommendation-score");
      assert.equal(
        await score.getAttribute("data-score"),
        String(p.rank ?? "UNKNOWN"),
      );
      assert.ok((await card.textContent()).includes("不是命中概率"));
      assert.ok((await card.locator(".team-original").count()) > 0);
      assert.ok(!(await card.textContent()).includes("NaN"));
    }
    if (await page.locator(".general-broad").count())
      await page.locator(".general-broad").evaluate((el) => (el.open = true));
    checks.push({
      name: version + " frozen scores, bilingual names, probabilities and EV",
      cards: await cards.count(),
    });
    await shot(version.toLowerCase() + "-recommendation-scores");
  }
  await page.getByLabel("模型版本").selectOption("GENERAL");
  await ready();
  const report = reports.GENERAL;
  const ended = report.records.find(
    (r) =>
      r.fixtureStatus !== "SCHEDULED" &&
      r.state === "DONE" &&
      r.output.plans?.some((p) => typeof p.rank === "number"),
  );
  assert.ok(ended, "real post-kickoff frozen record");
  const before = await data(
    "/workspace/universal?fixture=" +
      encodeURIComponent(ended.fixtureId) +
      "&version=GENERAL",
  );
  await page.goto(origin + "/match/" + encodeURIComponent(ended.fixtureId));
  await ready();
  assert.ok((await page.locator(".ws-match-hero .team-original").count()) >= 2);
  const evaluated = before.records[0].output.evaluated;
  for (let i = 0; i < evaluated.length; i++) {
    const p = evaluated[i],
      displayed = page
        .locator(".general-market-card")
        .nth(i)
        .getByTestId("recommendation-score");
    await displayed.waitFor({ state: "attached" });
    assert.equal(
      await displayed.getAttribute("data-score"),
      String(p.rank ?? "UNKNOWN"),
    );
  }
  const after = await data(
    "/workspace/universal?fixture=" +
      encodeURIComponent(ended.fixtureId) +
      "&version=GENERAL",
  );
  assert.equal(after.records[0].outputHash, before.records[0].outputHash);
  checks.push({
    name: "post-kickoff scores and output hash preserved",
    fixture: ended.fixtureId,
    evaluations: evaluated.length,
  });
  await shot("frozen-match-score-details");
  await page.goto(origin + "/workbench?period=ALL&view=ALL");
  await ready();
  const expected = await data(
    "/workspace/schedule?view=ALL&version=GENERAL&q=" +
      encodeURIComponent("曼联"),
  );
  assert.ok(expected.total > 0);
  for (const q of ["曼联", "Manchester United", "Man Utd"]) {
    const response = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/v2/workspace/schedule" &&
        new URL(r.url()).searchParams.get("q") === q &&
        r.ok(),
    );
    await page.getByLabel("搜索球队", { exact: true }).fill(q);
    await response;
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="load-status"]')
          ?.getAttribute("data-loaded") === "true",
    );
    const rows = page.locator(".fixture-card");
    await rows.first().waitFor();
    const actual = await data(
      "/workspace/schedule?view=ALL&version=GENERAL&q=" + encodeURIComponent(q),
    );
    assert.deepEqual(
      actual.items.map((r) => r.id),
      expected.items.map((r) => r.id),
    );
    assert.ok((await rows.first().innerText()).includes("Manchester United"));
    checks.push({ name: "bilingual/alias search " + q, total: actual.total });
  }
  await shot("english-team-search");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("english-team-search-mobile");
  checks.push({ name: "mobile search and bilingual schedule" });
  await page.goto(origin + "/workbench?period=ALL&view=ALL");
  await ready();
  await page.getByLabel("模型版本").selectOption("SEPTEMBER20");
  await ready();
  await shot("recommendation-scores-mobile");
  const first = page.locator('[data-testid="general-plan"]').first();
  await first.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${dir}/recommendation-card-mobile-viewport.png`,
  });
  checks.push({ name: "mobile scores and original names" });
  await page.getByLabel("模型版本").selectOption("V6");
  await ready();
  const v6 = await data("/workspace/universal?version=V6");
  assert.ok(
    v6.records.every((r) => r.output.plans?.every((p) => p.rank === null)),
  );
  assert.equal(
    await page
      .locator(
        '[data-testid="recommendation-score"]:not([data-score="UNKNOWN"])',
      )
      .count(),
    0,
  );
  checks.push({
    name: "V6 missing score never becomes fake numeric confidence",
  });
  await shot("v6-score-state");
  await page.getByLabel("模型版本").selectOption("SEPTEMBER20");
  await ready();
  await page.goto(origin + "/ledger?mode=PAPER_RESEARCH&period=ALL");
  await page
    .locator('[data-testid="ticket-card"]')
    .first()
    .waitFor({ timeout: 45000 });
  assert.ok(
    (await page.locator('[data-testid="ticket-card"] .team-original').count()) >
      0,
  );
  await shot("bilingual-ledger-mobile");
  checks.push({ name: "bilingual frozen ticket ledger" });
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    `${dir}/browser-result.json`,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        passed: checks.length,
        checks,
        errors,
        responses,
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
    JSON.stringify({ error: String(e), checks, errors, responses }, null, 2),
  );
  throw e;
} finally {
  await browser.close();
}
