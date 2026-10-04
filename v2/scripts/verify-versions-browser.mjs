import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const dir = ".runtime-v2/versions-20261004";
const origin = "http://127.0.0.1:5274";
const startedAt = new Date().toISOString();
const errors = [],
  checks = [],
  requests = [];
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (message) => {
  // An initial session probe is intentionally 401 before automatic local login.
  // All other local HTTP failures are checked by the response listener below.
  if (
    message.type() === "error" &&
    !message.text().startsWith("Failed to load resource:")
  )
    errors.push(message.text());
});
page.on("response", (r) => {
  if (
    r.url().startsWith(origin) &&
    r.status() >= 400 &&
    !(new URL(r.url()).pathname === "/api/v2/session" && r.status() === 401)
  )
    errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);
  if (r.url().includes("/api/v2/workspace/"))
    requests.push({
      url: new URL(r.url()).pathname + new URL(r.url()).search,
      status: r.status(),
    });
});
async function data(route) {
  return page.evaluate(async (route) => {
    const r = await fetch("/api/v2" + route);
    const j = await r.json();
    if (!r.ok) throw Error(JSON.stringify(j.error));
    return j.data;
  }, route);
}
async function screenshot(name) {
  await page.screenshot({
    path: path.join(dir, name + ".png"),
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth + 1,
  );
  assert.equal(overflow, false, name + " horizontal overflow");
  const alerts = (
    await page.locator('[role="alert"]').allTextContents()
  ).filter((x) => x.trim());
  assert.deepEqual(alerts, [], name + " alerts");
  checks.push({ name, screenshot: name + ".png", overflow, alerts });
}
try {
  await page.goto(origin + "/versions");
  await page.getByLabel("模型版本").waitFor();
  await page.locator(".version-card").first().waitFor({ timeout: 45000 });
  assert.equal(await page.locator(".version-card").count(), 3);
  await screenshot("versions-desktop");
  for (const version of ["GENERAL", "SEPTEMBER20", "V6"]) {
    await page.getByLabel("模型版本").selectOption(version);
    const arena = await data("/workspace/arena?period=ALL&version=" + version);
    assert.equal(arena.version.id, version);
    assert.ok(
      arena.strategies.every((p) =>
        version === "GENERAL"
          ? p.id.startsWith("general")
          : version === "SEPTEMBER20"
            ? p.id.startsWith("september20:")
            : p.id === "v6-native",
      ),
    );
    const schedule = await data(
      "/workspace/schedule?period=ALL&view=ALL&version=" + version,
    );
    assert.equal(schedule.version.id, version);
    assert.ok(schedule.totalKnown > 0);
    checks.push({
      version,
      knownFixtures: schedule.totalKnown,
      strategies: arena.strategies.map((p) => p.id),
      openN: arena.openN,
      settled: arena.summary.settled,
    });
    for (const [route, ready] of [
      ["/strategies", '[data-testid="strategy-arena"][data-loaded="true"]'],
      [
        "/workbench?period=ALL&view=ALL",
        '[data-testid="load-status"][data-loaded="true"]',
      ],
      ["/ledger?period=ALL", '[data-testid="load-status"][data-loaded="true"]'],
      ["/models", '[data-testid="general-laboratory"][data-loaded="true"]'],
    ]) {
      await page.goto(origin + route);
      assert.equal(await page.getByLabel("模型版本").inputValue(), version);
      await page
        .locator(ready)
        .first()
        .waitFor({ timeout: 45000, state: "attached" });
      await screenshot(
        version.toLowerCase() + "-" + route.split("?")[0].slice(1),
      );
    }
    if (version === "SEPTEMBER20" && schedule.items.length) {
      const outputs = await data("/workspace/universal?version=SEPTEMBER20");
      const fixtureId =
        outputs.records.find((r) => r.state === "DONE")?.fixtureId ??
        schedule.items[0].id;
      await page.goto(origin + "/match/" + encodeURIComponent(fixtureId));
      await page
        .locator('[data-testid="load-status"][data-loaded="true"]')
        .first()
        .waitFor({ timeout: 45000, state: "attached" });
      await screenshot("september20-detail");
    }
  }
  // Each open tab retains its own version even when another tab changes localStorage.
  await page.getByLabel("模型版本").selectOption("SEPTEMBER20");
  const second = await context.newPage();
  await second.goto(origin + "/strategies?version=V6");
  await second.getByLabel("模型版本").waitFor();
  assert.equal(await second.getByLabel("模型版本").inputValue(), "V6");
  await page.goto(origin + "/versions");
  await page.locator(".version-card").first().waitFor();
  assert.equal(await page.getByLabel("模型版本").inputValue(), "SEPTEMBER20");
  await screenshot("versions-september20");
  await second.close();
  await page.goto(origin + "/system");
  await page
    .locator('[data-testid="load-status"][data-loaded="true"]')
    .first()
    .waitFor({ timeout: 45000, state: "attached" });
  await screenshot("runtime-status");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + "/versions");
  await page.locator(".version-card").first().waitFor();
  await screenshot("versions-mobile");
  await page.goto(origin + "/strategies");
  await page
    .locator('[data-testid="strategy-arena"][data-loaded="true"]')
    .waitFor();
  await screenshot("september20-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await page.goto(origin + "/versions");
  await page.locator(".version-card").first().waitFor();
  await screenshot("versions-light");
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.getByLabel("模型版本").selectOption("GENERAL");
  assert.deepEqual(errors, []);
} finally {
  fs.writeFileSync(
    path.join(dir, "browser-result.json"),
    JSON.stringify(
      {
        startedAt,
        endedAt: new Date().toISOString(),
        origin,
        checks,
        errors,
        requests,
        syntheticNetwork: false,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
console.log(
  JSON.stringify({
    checks: checks.length,
    screenshots: checks.filter((c) => c.screenshot).length,
    pageErrors: errors.length,
  }),
);
