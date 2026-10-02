import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const dir = ".runtime-v2/universal/browser";
fs.mkdirSync(dir, { recursive: true });
const report = {
  startedAt: new Date().toISOString(),
  source:
    "Actual own LOCAL_RESEARCH runtime; no API interception or synthetic production records",
  checks: [],
  pages: [],
  errors: [],
};
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const pass = (name) => report.checks.push({ name, status: "PASS" });
const get = (p, path) =>
  p.evaluate(async (path) => {
    const r = await fetch("/api/v2" + path),
      j = await r.json();
    if (!r.ok) throw Error(j.error?.code ?? r.status);
    return j.data;
  }, path);
async function go(
  p,
  path,
  selector = '[data-testid="load-status"][data-loaded="true"]',
) {
  await p.goto("http://127.0.0.1:5274" + path, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await p
    .locator(selector)
    .first()
    .waitFor({ state: "attached", timeout: 60000 });
}
try {
  for (const width of [1440, 1024, 390]) {
    const p = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 1050 },
    });
    p.on("pageerror", (e) => report.errors.push(String(e)));
    const homepageRequests = [];
    p.on("request", (r) => homepageRequests.push(new URL(r.url()).pathname));
    await go(p, "/workbench");
    await p
      .locator('[data-testid="general-panel"][data-loaded="true"]')
      .waitFor({ timeout: 60000 });
    const general = await get(p, "/workspace/universal"),
      schedule = await get(p, "/workspace/schedule?view=ACTIVE");
    assert.ok(schedule.total > 0);
    assert.ok(general.coverage.independentN > 0);
    assert.ok(
      general.records.every(
        (r) => !("outputJson" in r) && !("grid" in r.output),
      ),
    );
    pass(`真实赛程与独立通用分析已显示 ${width}`);
    assert.equal(
      homepageRequests.includes("/api/v2/workspace/comparison"),
      false,
    );
    pass(`首页不加载全历史并行统计阻塞当前推荐 ${width}`);
    await p.getByRole("link", { name: "跳到完整赛程与筛选 ↓" }).click();
    await expect(p.locator("#fixtures")).toBeInViewport();
    pass(`完整赛程可直接到达 ${width}`);
    const tracked = await get(
      p,
      "/workspace/schedule?view=TRACKED&trackingModel=GENERAL",
    );
    assert.ok(tracked.total > 0);
    const ended = tracked.items.find((r) => r.status !== "SCHEDULED"),
      match = ended ?? tracked.items[0];
    assert.ok(match.generalDirections.length > 0);
    pass(`通用推荐独立跟踪含开赛记录 ${width}`);
    await go(p, "/workbench?view=TRACKED&period=ALL&trackingModel=GENERAL");
    await expect(
      p.getByRole("button", { name: /^通用赛前分析/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await p.screenshot({
      path: `${dir}/tracking-${width}.png`,
      animations: "disabled",
    });
    const before = await get(
      p,
      "/workspace/fixtures/" + encodeURIComponent(match.id),
    );
    for (const [name, path, selector] of [
      [
        "schedule",
        "/workbench",
        '[data-testid="general-panel"][data-loaded="true"]',
      ],
      [
        "match",
        "/match/" + encodeURIComponent(match.id),
        '[data-testid="general-panel"][data-loaded="true"]',
      ],
      ["history", "/history"],
      ["ledger", "/ledger?mode=PAPER_RESEARCH"],
      [
        "models",
        "/models",
        '[data-testid="general-laboratory"][data-loaded="true"]',
      ],
      ["runtime", "/system"],
      ["strategies", "/strategies", ".general-card"],
    ]) {
      await go(p, path, selector);
      if (await p.locator('[data-testid="load-status"]').count())
        await p
          .locator('[data-testid="load-status"][data-loaded="true"]')
          .waitFor({ timeout: 60000 });
      const layout = await p.evaluate(() => ({
        viewport: innerWidth,
        body: document.body.scrollWidth,
        headings: [...document.querySelectorAll("h1,h2")].map(
          (e) => e.textContent,
        ),
      }));
      assert.ok(
        layout.body <= width + 1,
        `${name} overflows ${layout.body}/${width}`,
      );
      if (name === "strategies")
        await expect(p.locator(".general-card")).toHaveCount(6);
      if (name === "ledger") {
        await expect(p.locator(".ws-note")).toContainText("账本读取截止");
        await expect(p.locator(".ws-note")).not.toContainText("旧档案导出截止");
      }
      await p.screenshot({
        path: `${dir}/${name}-${width}.png`,
        animations: "disabled",
      });
      if (name === "match") {
        await p
          .locator('[data-testid="general-panel"]')
          .evaluate((el) => el.scrollIntoView({ block: "start" }));
        await p.evaluate(() => window.scrollBy(0, -85));
        await p.screenshot({
          path: `${dir}/match-analysis-${width}.png`,
          animations: "disabled",
        });
      }
      report.pages.push({ name, path, width, layout });
      pass(`${name}页面有实际数据且无横向溢出 ${width}`);
    }
    const after = await get(
      p,
      "/workspace/fixtures/" + encodeURIComponent(match.id),
    );
    for (const old of before.predictions) {
      const kept = after.predictions.find((x) => x.id === old.id);
      assert.ok(kept);
      assert.equal(kept.predictionHash, old.predictionHash);
      assert.equal(kept.centralJson, old.centralJson);
    }
    pass(`浏览器读取不会改写原冻结预测 ${width}`);
    const metrics = await get(p, "/workspace/universal-metrics");
    assert.equal(metrics.populationN >= metrics.probability.probabilityN, true);
    assert.equal(
      metrics.probability.probabilityN,
      metrics.baseline.probabilityN,
    );
    report[`snapshot${width}`] = {
      coverage: general.coverage,
      asOf: general.asOf,
      activeN: schedule.total,
      trackedN: tracked.total,
      trackedAfterStart: !!ended,
      forwardN: metrics.populationN,
      scoredN: metrics.probability.probabilityN,
      paper: metrics.byStrategy.map((x) => ({
        id: x.id,
        enabled: x.enabled,
        N: x.metrics.count,
        open: x.metrics.open,
        settled: x.metrics.settled,
        roi: x.metrics.roi,
      })),
    };
    if (width === 1440) {
      await go(p, "/strategies", ".general-card");
      const policies = await get(p, "/workspace/paper-policies"),
        policy = policies.find((x) => x.id === "general-v2-value-singles");
      const card = p.locator(".general-card").filter({
        has: p.getByRole("heading", { name: policy.label, exact: true }),
      });
      try {
        const response = p.waitForResponse(
          (r) =>
            r.request().method() === "POST" &&
            r.url().endsWith("/workspace/paper-policies"),
        );
        await card
          .getByRole("button", {
            name: policy.enabled ? "暂停新票" : "恢复新票",
            exact: true,
          })
          .click();
        assert.equal((await response).status(), 200);
        await expect(
          card.getByRole("button", {
            name: policy.enabled ? "恢复新票" : "暂停新票",
            exact: true,
          }),
        ).toBeVisible();
        pass("策略暂停/恢复通过真实页面即时生效");
      } finally {
        const latest = (await get(p, "/workspace/paper-policies")).find(
          (x) => x.id === policy.id,
        );
        if (latest.enabled !== policy.enabled) {
          const response = p.waitForResponse(
            (r) =>
              r.request().method() === "POST" &&
              r.url().endsWith("/workspace/paper-policies"),
          );
          await card
            .getByRole("button", {
              name: policy.enabled ? "恢复新票" : "暂停新票",
              exact: true,
            })
            .click();
          assert.equal((await response).status(), 200);
          await expect(
            card.getByRole("button", {
              name: policy.enabled ? "暂停新票" : "恢复新票",
              exact: true,
            }),
          ).toBeVisible();
        }
      }
    }
    await p.close();
  }
  const lan = await browser.newPage();
  await lan.goto("http://192.168.2.130:5274/workbench", { timeout: 60000 });
  await lan
    .locator('[data-testid="general-panel"][data-loaded="true"]')
    .waitFor({ timeout: 60000 });
  pass("局域网入口可打开真实数据工作台");
  await lan.close();
  assert.deepEqual(report.errors, []);
  report.exitCode = 0;
} catch (error) {
  report.failure = String(error.stack ?? error);
  report.exitCode = 1;
  process.exitCode = 1;
} finally {
  await browser.close();
  report.finishedAt = new Date().toISOString();
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
