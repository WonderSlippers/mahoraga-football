import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const origin = "http://127.0.0.1:5274";
const dir = ".runtime-v2/score-order-20261005";
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.V2_BROWSER_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(String(e)));
function ordered(scores, name) {
  let previous = Infinity;
  for (const value of scores) {
    const score = Number.isFinite(value) ? value : -Infinity;
    assert.ok(score <= previous, `${name}: ${score} follows ${previous}`);
    previous = score;
  }
}
async function fixtureScores() {
  return page.locator(".fixture-card").evaluateAll((cards) =>
    cards.map((card) => {
      const scores = [
        ...card.querySelectorAll('[data-testid="recommendation-score"]'),
      ]
        .map((n) => n.getAttribute("data-score"))
        .filter((v) => v !== "UNKNOWN" && v != null)
        .map(Number);
      return scores.length ? Math.max(...scores) : null;
    }),
  );
}
async function ready(version, offset = 0) {
  await page.waitForFunction(
    ({ version, offset }) => {
      const status = document.querySelector(
        '[data-testid="load-status"][data-loaded="true"]',
      );
      return (
        !!status &&
        document.querySelector('[aria-label="模型版本"]')?.value === version &&
        new URL(location.href).searchParams.get("offset") === String(offset)
      );
    },
    { version, offset },
    { timeout: 45000 },
  );
  await page.locator(".fixture-card").first().waitFor({ timeout: 45000 });
}
try {
  for (const version of ["GENERAL", "SEPTEMBER20", "V6"]) {
    await page.goto(
      `${origin}/workbench?period=ALL&view=ALL&version=${version}`,
    );
    await ready(version);
    const scores = await fixtureScores();
    ordered(scores, version + " fixtures");
    assert.ok(scores.length > 0);
    if (version === "V6")
      assert.ok(
        scores.every((v) => v == null),
        "V6 has no invented score",
      );
    else
      assert.ok(
        scores.some((v) => v != null),
        version + " real saved scores",
      );
    checks.push({ name: version + " fixture ordering", scores });
    const next = page.getByRole("button", { name: "下一页" });
    if (await next.count()) {
      await next.click();
      await ready(version, 40);
      const nextScores = await fixtureScores();
      ordered([...scores, ...nextScores], version + " pagination");
      checks.push({
        name: version + " ordering across page boundary",
        scores: nextScores,
      });
    }
    await page.goto(
      `${origin}/workbench?period=ALL&view=ALL&version=${version}`,
    );
    await ready(version);
    await page.locator("#fixtures").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${dir}/${version.toLowerCase()}-scores.png`,
    });
  }
  await page.goto(`${origin}/workbench?period=ALL&view=ALL&version=GENERAL`);
  await ready("GENERAL");
  await page.getByLabel("模型版本").selectOption("SEPTEMBER20");
  await page.waitForResponse(
    (r) =>
      r.url().includes("/workspace/schedule?") &&
      r.url().includes("version=SEPTEMBER20") &&
      r.status() === 200,
  );
  await ready("SEPTEMBER20");
  ordered(await fixtureScores(), "model switch");
  checks.push({ name: "changing model preserves score order" });
  await page.getByLabel("搜索球队").fill("Manchester");
  await page.waitForResponse(
    (r) =>
      r.url().includes("/workspace/schedule?") &&
      r.url().includes("q=Manchester") &&
      r.status() === 200,
  );
  await ready("SEPTEMBER20");
  ordered(await fixtureScores(), "team filter");
  checks.push({ name: "team filtering preserves score order" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#fixtures").scrollIntoViewIfNeeded();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
  );
  await page.screenshot({ path: `${dir}/mobile-scores.png` });
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    `${dir}/browser.json`,
    JSON.stringify({ checks, errors, passed: checks.length }, null, 2),
  );
  console.log(
    JSON.stringify({ passed: checks.length, errors, screenshots: 4 }),
  );
} catch (e) {
  await page.screenshot({ path: `${dir}/failed.png`, fullPage: true });
  fs.writeFileSync(
    `${dir}/browser-failed.json`,
    JSON.stringify({ checks, errors, error: String(e) }, null, 2),
  );
  throw e;
} finally {
  await browser.close();
}
