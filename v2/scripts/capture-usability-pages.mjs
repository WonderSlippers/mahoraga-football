import fs from "node:fs";
import { chromium } from "@playwright/test";
const dir = ".runtime-v2/usability",
  report = { at: new Date().toISOString(), errors: [], pages: [] };
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
    { width: 1024, height: 900 },
  ]) {
    const page = await browser.newPage({ viewport });
    page.on("pageerror", (e) => report.errors.push(String(e)));
    page.on("console", (m) => {
      if (
        m.type() === "error" &&
        !m.text().startsWith("Failed to load resource:")
      )
        report.errors.push(m.text());
    });
    for (const [name, route] of [
      ["schedule", "/workbench"],
      ["match", "/match/espn%3Auefa.nations%3A401861101"],
      ["history", "/history"],
      ["ledger", "/ledger"],
      ["models", "/models"],
      ["runtime", "/system"],
    ]) {
      await page.goto("http://127.0.0.1:5274" + route);
      await page
        .locator('[data-testid="load-status"][data-loaded="true"]')
        .waitFor({ timeout: 60000 });
      await page.waitForTimeout(350);
      if (
        viewport.width === 1024 &&
        (await page.getByRole("button", { name: "浅色", exact: true }).count())
      )
        await page.getByRole("button", { name: "浅色", exact: true }).click();
      const screenshot = `${dir}/${name}-${viewport.width}.png`;
      await page.screenshot({ path: screenshot, fullPage: false });
      const layout = await page.evaluate(() => ({
        body: document.body.scrollWidth,
        viewport: innerWidth,
        firstFixture: document
          .querySelector(".fixture-card")
          ?.getBoundingClientRect().top,
        headings: [...document.querySelectorAll("h1,h2")].map(
          (n) => n.textContent,
        ),
        theme: document.documentElement.dataset.theme,
      }));
      report.pages.push({ name, route, viewport, screenshot, layout });
      if (layout.body > viewport.width)
        report.errors.push(
          `${name} ${viewport.width}: horizontal overflow ${layout.body}`,
        );
      if (name === "schedule" && layout.firstFixture > 760)
        report.errors.push(
          `${name} ${viewport.width}: first fixture below usable first screen ${layout.firstFixture}`,
        );
    }
    await page.close();
  }
} finally {
  await browser.close();
  fs.writeFileSync(
    dir + "/browser-smoke.json",
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report, null, 2));
if (report.errors.length) process.exitCode = 1;
