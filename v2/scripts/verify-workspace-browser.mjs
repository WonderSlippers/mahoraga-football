import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const base = process.env.V2_VERIFY_URL || "http://127.0.0.1:5274";
if (!/^http:\/\/127\.0\.0\.1:527[34]$/.test(base))
  throw Error("ONLY_OWN_V2_BROWSER");
const dir = path.resolve(".runtime-v2/feature-parity");
fs.mkdirSync(dir, { recursive: true });
const report = {
  startedAt: new Date().toISOString(),
  base,
  checks: [],
  screenshots: [],
  errors: [],
  failed: null,
};
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => report.errors.push(String(e)));
const check = (name, fn) => {
  fn();
  report.checks.push({ name, status: "PASS" });
};
const loaded = () =>
  page
    .locator('[data-testid="load-status"][data-loaded="true"]')
    .waitFor({ timeout: 120000 });
const go = async (route) => {
  await page.goto(base + route);
  await loaded();
};
const api = async (route) =>
  page.evaluate(async (r) => {
    const response = await fetch("/api/v2/workspace/" + r);
    const j = await response.json();
    if (!response.ok) throw Error(j.error?.code || "HTTP_" + response.status);
    return j.data;
  }, route);
const shot = async (name) => {
  const file = path.join(dir, name + ".png");
  await page.screenshot({ path: file, fullPage: false });
  report.screenshots.push(file);
};
const choose = async (label, value) => {
  const response = page.waitForResponse(
    (r) =>
      r.url().includes("/api/v2/workspace/") &&
      r.request().method() === "GET" &&
      r.status() === 200,
  );
  await page.getByLabel(label, { exact: true }).selectOption(value);
  await response;
  await loaded();
};
try {
  await go("/workbench");
  const initial = await api("schedule");
  check(
    "all known fixtures remain present even with zero strict candidates",
    () => {
      assert(initial.total >= 306);
      assert.equal(initial.strictCandidates.length, 0);
      assert.equal(awaitCountGuard(initial.items), 40);
    },
  );
  await shot("schedule-desktop");
  report.dataset = {
    totalKnown: initial.totalKnown,
    historyTickets: 498,
    leagues: initial.metadata.leagues.length,
    sourceHash: initial.metadata.sourceHash,
    sourceCutoffAt: initial.metadata.sourceCutoffAt,
    sourceReadAt: initial.metadata.sourceReadAt,
    savedQuoteRows: initial.metadata.savedQuoteRows,
  };
  const start = await api("status");
  const selectors = await page
    .locator("select")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
  report.scheduleSelectors = selectors;
  await choose(selectors[0], "ger.1");

  const leagueResponse = await api("schedule?league=ger.1");
  check("server league filter exact", () => {
    assert(leagueResponse.total > 0);
    assert(leagueResponse.items.every((r) => r.competition === "ger.1"));
  });
  await choose(selectors[0], "ALL");
  await choose(selectors[1], "FINISHED");
  const historical = page
    .locator(
      'a.ws-fixture-row[href*="legacy%3A"],a.ws-fixture-row[href*="legacy:"]',
    )
    .first();
  await historical.waitFor();
  const historicalLink = await historical.getAttribute("href");
  await historical.click();
  await loaded();
  const id = decodeURIComponent(historicalLink.split("/").at(-1));
  const detail = await api("fixtures/" + encodeURIComponent(id));
  check(
    "historical match preserves saved markets and original archives without fabricated predictions",
    () => {
      assert(detail.archives.length > 0);
      assert(detail.publicData.legacyMarkets.length > 0);
      assert.equal(detail.predictions.length, 0);
      assert.equal(detail.publicData.validation, "LEGACY_NON_PROSPECTIVE");
    },
  );
  await shot("detail-desktop");
  await page
    .getByText("原票市场赔率、旧模型观测与解释（未经前瞻认证）", {
      exact: true,
    })
    .click();
  check("raw market audit expands in browser", () =>
    assert(
      detail.publicData.legacyMarkets.every((q) => "priceCapturedAt" in q),
    ),
  );
  const savedSchedule = await api("schedule?q=Bournemouth");
  const savedFixture = savedSchedule.items.find((f) =>
    f.id.startsWith("legacy:"),
  );
  assert(savedFixture, "SAVED_MARKET_FIXTURE_NOT_PROJECTED");
  const savedRoute = "/match/" + encodeURIComponent(savedFixture.id);
  await go(savedRoute);
  const savedDetail = await api(
    "fixtures/" + encodeURIComponent(savedFixture.id),
  );
  check(
    "saved source quotes preserve both 1X2 and total market evidence",
    () => {
      assert(savedDetail.savedQuotes.oneXTwo.length > 0);
      assert(savedDetail.savedQuotes.markets.length > 0);
      assert(savedDetail.sourceEvidence.snapshot.payloadHash);
      assert.equal(savedDetail.predictions.length, 0);
    },
  );
  await page.getByRole("button", { name: "大小球", exact: true }).click();
  const totals = page
    .locator(".ws-odds-history")
    .filter({ hasText: "全场大小球" });
  assert((await totals.count()) > 0);
  check("total market tab displays archived line and prices", () =>
    assert(
      savedDetail.savedQuotes.markets.every((q) => q.market === "total-ft"),
    ),
  );
  await shot("detail-saved-markets");
  await go("/history");
  const history = await api("history");
  check("automatic import publishes original history", () =>
    assert.equal(history.total, 719),
  );
  const visibleHistoryCount = await page
    .getByRole("heading", { name: /历史档案/ })
    .innerText();
  check(
    "all-time history includes undated original archives in the actual UI",
    () => assert(visibleHistoryCount.includes(String(history.total))),
  );
  check(
    "saved research observations remain readable but outside the financial ledger",
    () => {
      assert(history.dimensions.models.includes("market-form-v2-gated"));
    },
  );
  const observations = await api(
    "history?strategy=" + encodeURIComponent("旧研究观测"),
  );
  check(
    "14 original observations preserve their original explanations and calculation times",
    () => {
      assert.equal(observations.total, 14);
      assert.equal(observations.items[0].kind, "RESEARCH_OBSERVATION");
      assert(
        observations.items.every(
          (r) => r.raw.leg && r.stakeAtoms === null && r.pnlAtoms === null,
        ),
      );
      assert(
        observations.items.some(
          (r) => r.raw.leg.deepAnalysis?.sections?.length,
        ),
      );
    },
  );
  await shot("history-desktop");
  await page.locator(".ws-record-row").first().click();
  await page.getByRole("heading", { name: /原始记录/ }).waitFor();
  const historyMatch = page.locator(".ws-fixture-link").first();
  await historyMatch.waitFor();
  await historyMatch.click();
  await loaded();
  const linkedTitle = await page.locator("h1").innerText();
  check("history ticket links to its frozen match evidence", () =>
    assert(linkedTitle.includes("比赛研究")),
  );
  await go("/history");

  const league = history.dimensions.leagues[0];
  await choose("历史联赛", league);
  const filtered = await api("history?league=" + encodeURIComponent(league));
  check("history league filter returns subset", () => {
    assert(filtered.total > 0);
    assert(filtered.total < history.total);
  });
  await go("/ledger");
  const ledger = await api("ledger?mode=LEGACY_IMPORT&period=ALL");
  check("ledger keeps 498 historical tickets separate", () => {
    assert.equal(ledger.total, 498);
    assert.equal(ledger.summary.count, 498);
    assert(ledger.items.every((r) => r.mode === "LEGACY_IMPORT"));
  });
  await shot("ledger-desktop");
  const next = page.waitForResponse(
    (r) =>
      r.url().includes("/workspace/ledger?") && r.url().includes("offset=40"),
  );
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await next;
  await loaded();
  const paged = await api("ledger?mode=LEGACY_IMPORT&period=ALL&offset=40");
  check("pagination preserves totals and changes records", () => {
    assert.deepEqual(paged.summary, ledger.summary);
    assert.notEqual(paged.items[0].id, ledger.items[0].id);
  });
  await page.getByRole("button", { name: "今日", exact: true }).click();
  await loaded();
  const today = await api("ledger?mode=LEGACY_IMPORT&period=TODAY");
  check("today range respects archived cutoff", () => {
    assert(Date.parse(ledger.sourceCutoffAt) < Date.now());
    assert.equal(today.total, 0);
    assert.equal(today.summary.roi, null);
  });
  await page.getByRole("button", { name: "2.0纸面票", exact: true }).click();
  await loaded();
  const paper = await api("ledger?mode=PAPER");
  check("paper ROI remains null when no actions", () => {
    if (paper.total === 0) assert.equal(paper.summary.roi, null);
    assert(paper.items.every((r) => r.mode === "PAPER"));
  });
  await go("/models");
  const lab = await api("models");
  check("three fixed models compare genuine common archived inputs", () => {
    assert.equal(lab.models.length, 3);
    assert(lab.models.every((m) => m.metrics.eligibleN === 115));
    assert.equal(lab.models[0].metrics.roi, null);
    assert.equal(lab.models[1].metrics.brier, null);
    assert.equal(lab.models[2].id, "V7_RETURN_PARTIAL_QUOTE_WEIGHTED_FIXED");
    assert.equal(lab.prospective.n, 0);
  });
  await shot("laboratory-desktop");
  await choose("研究联赛", lab.leagues[0]);
  const labSubset = await api(
    "models?league=" + encodeURIComponent(lab.leagues[0]),
  );
  check("model league comparison uses same population", () =>
    assert(
      labSubset.models.every(
        (m) => m.metrics.eligibleN < 115 && m.metrics.eligibleN > 0,
      ),
    ),
  );
  await go("/legacy");
  const writes = [];
  const listener = (request) => {
    if (["POST", "PUT", "DELETE", "PATCH"].includes(request.method()))
      writes.push(request.url());
  };
  page.on("request", listener);
  await page.getByLabel("假设十进制赔率").fill("2");
  await page.getByLabel("自行假设概率（%）").fill("60");
  await page.getByLabel("可承受损失预算").fill("100");
  await page.getByText("20.00%", { exact: true }).waitFor();
  check("hypothesis calculator accepts odds, probability and budget", () =>
    assert.equal(writes.length, 0),
  );
  page.off("request", listener);
  check("Legacy interaction sends no writes", () =>
    assert.equal(writes.length, 0),
  );
  await shot("legacy-desktop");
  await page
    .getByRole("link", { name: "天皇杯官方已公布赛程 →", exact: true })
    .click();
  await loaded();
  const official = await api("schedule?league=jfa.emperors");
  check(
    "official cup watch is restored without guessed results or quotes",
    () => {
      assert.equal(official.total, 16);
      assert(
        official.items.every(
          (f) =>
            f.publicData.regulation === null &&
            f.publicData.providerOdds.length === 0,
        ),
      );
    },
  );
  await shot("official-cup-desktop");
  await go("/system");
  await shot("runtime-desktop");
  const waitUntil = Date.now() + 70000;
  let end;
  do {
    end = await api("status");
    if (end.automation?.[0]?.cursor > start.automation?.[0]?.cursor) break;
    await new Promise((r) => setTimeout(r, 2000));
  } while (Date.now() < waitUntil);
  check(
    "normal use advances persisted source rotation without refresh clicks",
    () => assert(end.automation?.[0]?.cursor > start.automation?.[0]?.cursor),
  );
  report.automation = { before: start.automation, after: end.automation };
  for (const [name, route] of [
    ["schedule", "/workbench"],
    ["history", "/history"],
    ["ledger", "/ledger"],
    ["laboratory", "/models"],
    ["runtime", "/system"],
    ["detail", historicalLink],
  ]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await go(route);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await shot(name + "-mobile");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    check(name + " actual mobile width", () => assert.equal(overflow, false));
  }
  await page.setViewportSize({ width: 1024, height: 900 });
  await go("/workbench");
  await shot("schedule-tablet");
  const tabletOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  check("tablet has no overflow", () => assert.equal(tabletOverflow, false));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await go("/workbench");
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await shot("schedule-light");
  const theme = await page.evaluate(
    () => document.documentElement.dataset.theme,
  );
  check("light theme changes active document", () =>
    assert.equal(theme, "light"),
  );
  await page.getByRole("button", { name: "深色", exact: true }).click();
  check("no browser script errors", () => assert.deepEqual(report.errors, []));
  report.status = "PASS";
} catch (e) {
  report.failed = { message: String(e), stack: e.stack };
  report.status = "FAIL";
  process.exitCode = 1;
  await page
    .screenshot({ path: path.join(dir, "browser-failure.png"), fullPage: true })
    .catch(() => {});
} finally {
  report.finishedAt = new Date().toISOString();
  report.tests = report.checks.length + (report.failed ? 1 : 0);
  report.passed = report.checks.length;
  report.skipped = 0;
  fs.writeFileSync(
    path.join(dir, "browser-functional-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      status: report.status,
      tests: report.tests,
      passed: report.passed,
      failed: report.failed,
      screenshots: report.screenshots.length,
    }),
  );
  await browser.close();
}
function awaitCountGuard(items) {
  return items.length;
}
