import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const dir = ".runtime-v2/lifecycle";
fs.mkdirSync(dir, { recursive: true });
const report = {
  at: new Date().toISOString(),
  checks: [],
  pages: [],
  errors: [],
  source:
    "Actual own LOCAL_RESEARCH runtime; no intercepted/mocked API or synthetic production records",
};
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const check = (name) => report.checks.push({ name, status: "PASS" });
const get = (page, route) =>
  page.evaluate(async (route) => {
    const start = performance.now(),
      r = await fetch("/api/v2/workspace/" + route),
      j = await r.json();
    if (!r.ok) throw Error(j.error?.code);
    return { data: j.data, durationMs: performance.now() - start };
  }, route);
const loaded = (page) =>
  page
    .locator('[data-testid="load-status"][data-loaded="true"]')
    .waitFor({ timeout: 60000, state: "attached" });
const go = async (page, path) => {
  await page.goto("http://127.0.0.1:5274" + path, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await loaded(page);
  await expect(page.locator('[data-testid="load-status"]')).not.toContainText(
    "读取失败",
  );
};
const clickView = async (page, name, value) => {
  const response = page.waitForResponse(
    (r) =>
      r.url().includes("/workspace/schedule?") &&
      r.url().includes("view=" + value) &&
      r.status() === 200,
    { timeout: 60000 },
  );
  await page
    .getByRole("button", { name: new RegExp("^" + name) })
    .first()
    .click();
  const result = await (await response).json();
  await expect(page.locator(".fixture-card")).toHaveCount(
    Math.min(40, result.data.total),
    { timeout: 60000 },
  );
  await expect(page.locator('[data-testid="load-status"]')).toContainText(
    "本地快照",
    { timeout: 60000 },
  );
  await expect(page.locator('[data-testid="load-status"]')).not.toContainText(
    "读取失败",
  );
};
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 1000 },
    });
    page.on("pageerror", (e) => report.errors.push(String(e)));
    await go(page, "/workbench");
    await expect(
      page.getByRole("navigation", { name: "比赛进程" }),
    ).toBeVisible();
    const { data: active, durationMs } = await get(
      page,
      "schedule?view=ACTIVE",
    );
    assert.ok(active.total > 0);
    assert.ok(active.items.every((f) => f.state !== "FINISHED"));
    const { data: live } = await get(page, "schedule?view=LIVE");
    const { data: fixed } = await get(
      page,
      "schedule?upcoming=1&status=STARTED",
    );
    assert.ok(fixed.items.every((f) => f.state === "STARTED"));
    assert.ok(Number.isSafeInteger(fixed.total) && fixed.total >= 0);
    check(`开赛筛选不会被赛前条件清空 ${width}`);
    await clickView(page, "进行中", "LIVE");
    await page.screenshot({ path: `${dir}/live-${width}.png`, fullPage: true });
    await page.screenshot({ path: `${dir}/live-viewport-${width}.png` });
    check(`进行中入口可点击并持久化URL ${width}`);
    assert.ok(page.url().includes("view=LIVE"));
    await page.reload();
    await loaded(page);
    assert.ok(page.url().includes("view=LIVE"));
    const { data: results } = await get(page, "schedule?view=RESULTS");
    assert.ok(results.total > 0);
    await clickView(page, "近期赛果", "RESULTS");
    await page.screenshot({
      path: `${dir}/results-${width}.png`,
      fullPage: true,
    });
    check(`近期赛果和待确认结果直接可达 ${width}`);
    const { data: followed } = await get(page, "schedule?view=TRACKED");
    assert.ok(followed.total > 0);
    assert.ok(
      followed.items.every((f) => f.tracking || f.parallelDirections.length),
    );
    await clickView(page, "推荐跟踪", "TRACKED");
    await page.screenshot({
      path: `${dir}/tracked-${width}.png`,
      fullPage: true,
    });
    check(`所有已保存研究和V6/V2方向有独立跟踪入口 ${width}`);
    const methodResponse = page.waitForResponse(
      (r) => r.url().includes("trackingModel=V6") && r.status() === 200,
      { timeout: 60000 },
    );
    await page.getByRole("button", { name: /^V6 配置388/ }).click();
    const methodData = (await (await methodResponse).json()).data;
    assert.ok(
      methodData.items.every((f) =>
        f.parallelDirections.some((r) => r.methodId.startsWith("V6")),
      ),
    );
    await expect(page.locator(".fixture-card")).toHaveCount(
      Math.min(40, methodData.total),
      { timeout: 60000 },
    );
    check(`V6原生方向可单独查看 ${width}`);
    // Choose an actually started or finished game with a frozen recommendation.
    const { data: closed } = await get(
      page,
      "schedule?view=TRACKED&status=STARTED",
    );
    const { data: ended } = await get(
      page,
      "schedule?view=TRACKED&status=FINISHED",
    );
    const trackedMatch = closed.items[0] || ended.items[0] || followed.items[0];
    const { data: before } = await get(
      page,
      "fixtures/" + encodeURIComponent(trackedMatch.id),
    );
    await go(page, "/match/" + encodeURIComponent(trackedMatch.id));
    await expect(page.locator(".ws-match-hero")).toBeVisible();
    if (before.scoreboard.score)
      await expect(page.locator(".ws-match-middle")).toContainText(
        before.scoreboard.score.map((v) => v ?? "—").join(" : "),
      );
    const { data: after } = await get(
      page,
      "fixtures/" + encodeURIComponent(trackedMatch.id),
    );
    for (const p of before.predictions) {
      const kept = after.predictions.find((x) => x.id === p.id);
      assert.ok(kept);
      assert.equal(kept.predictionHash, p.predictionHash);
      assert.equal(kept.centralJson, p.centralJson);
      assert.equal(kept.cutoffAt, p.cutoffAt);
    }
    check(`开赛后详情仍保留原冻结概率和报价 ${width}`);
    const fixture = trackedMatch.id;
    for (const [name, path] of [
      ["schedule", "/workbench"],
      ["match", "/match/" + encodeURIComponent(fixture)],
      ["history", "/history"],
      ["ledger", "/ledger"],
      ["models", "/models"],
      ["runtime", "/system"],
    ]) {
      await go(page, path);
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
      assert.ok(layout.body <= width + 1, `${name} ${width} overflows`);
      if (name === "schedule" && width === 390)
        assert.ok(
          layout.firstFixture < 1000,
          `First game too low: ${layout.firstFixture}`,
        );
      await page.screenshot({
        path: `${dir}/${name}-${width}.png`,
        fullPage: true,
      });
      report.pages.push({ name, path, width, layout });
    }
    report.checks.push({
      name: `六个主要页面可用且无横向溢出 ${width}`,
      status: "PASS",
    });
    report[`snapshot${width}`] = {
      liveN: live.total,
      resultN: results.total,
      trackedN: followed.total,
      activeN: active.total,
      readDurationMs: durationMs,
      fixture,
      score: before.scoreboard,
      predictionIds: before.predictions.slice(0, 8).map((p) => p.id),
    };
    await page.close();
  }
  assert.deepEqual(report.errors, []);
  report.exitCode = 0;
} catch (e) {
  report.failure = String(e.stack || e);
  report.exitCode = 1;
  process.exitCode = 1;
} finally {
  await browser.close();
  fs.writeFileSync(
    `${dir}/browser-report.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      checks: report.checks.length,
      pages: report.pages.length,
      errors: report.errors,
      exitCode: report.exitCode,
      failure: report.failure,
    }),
  );
}
