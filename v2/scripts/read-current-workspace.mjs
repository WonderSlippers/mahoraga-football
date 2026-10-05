import fs from "node:fs";
import { chromium } from "@playwright/test";
const dir = ".runtime-v2/usability";
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const page = await browser.newPage();
try {
  await page.goto("http://127.0.0.1:5274/workbench");
  await page
    .locator('[data-testid="load-status"][data-loaded="true"]')
    .waitFor({ timeout: 60000 });
  const report = await page.evaluate(async () => {
    const get = async (route) =>
      (await (await fetch("/api/v2/workspace/" + route)).json()).data;
    const data = await get("schedule?upcoming=1");
    const pages = await Promise.all(
      Array.from({ length: Math.ceil(data.total / 40) }, (_, i) =>
        get("schedule?upcoming=1&offset=" + i * 40),
      ),
    );
    return {
      data,
      allUpcoming: pages.flatMap((p) => p.items),
      status: await get("status"),
    };
  });
  fs.writeFileSync(
    dir + "/current-workspace.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        total: report.data.total,
        known: report.data.totalKnown,
        states: report.data.states,
        candidates: report.data.researchCandidates.map((r) => ({
          id: r.id,
          home: r.home,
          away: r.away,
          research: r.research,
        })),
        upcoming: report.data.items.slice(0, 8).map((f) => ({
          id: f.id,
          home: f.home,
          away: f.away,
          kickoff: f.kickoffAt,
          quote: !!f.referenceMarket,
          detail: !!f.publicData.detail,
          reason: f.reason,
        })),
        automation: report.status.automation,
        queue: report.status.queue,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
