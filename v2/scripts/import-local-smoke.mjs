import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "@playwright/test";
const source = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !fs.statSync(source).isFile())
  throw Error("EXISTING_EXPORT_FILE_REQUIRED");
const original = fs.readFileSync(source);
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
const parsed = JSON.parse(original.toString("utf8").replace(/^\uFEFF/, ""));
const portfolios = parsed.simulation_lab_v1?.data?.portfolios;
if (!Array.isArray(portfolios)) throw Error("EXPECTED_EXISTING_LAB_EXPORT");
const expected = {
  records: portfolios.reduce((n, p) => n + p.tickets.length, 0),
  legs: portfolios.reduce(
    (n, p) => n + p.tickets.reduce((s, t) => s + t.legs.length, 0),
    0,
  ),
};
const dir = ".runtime-v2/import-verification";
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5274/archives");
  await page
    .getByRole("heading", { name: "历史档案与对账", exact: true })
    .waitFor();
  await page
    .getByLabel("原系统标识", { exact: true })
    .fill("legacy-export-20260925");
  await page.getByLabel("历史导出文件").setInputFiles(source);
  const previewResponse = page.waitForResponse(
    (r) => r.url().endsWith("/imports/preview"),
    { timeout: 120000 },
  );
  await page.getByRole("button", { name: "预览并对账" }).click();
  const response = await previewResponse;
  const preview = await response.json();
  fs.writeFileSync(`${dir}/preview.json`, JSON.stringify(preview, null, 2));
  if (
    !response.ok() ||
    preview.data.report.records !== expected.records ||
    preview.data.warnings.length
  )
    throw Error("PREVIEW_RECONCILIATION_FAILED");
  const actual = Object.values(preview.data.report.portfolios);
  if (
    actual.reduce((s, p) => s + p.knownLegs, 0) !== expected.legs ||
    actual.some((p) => p.quarantine || p.duplicates)
  )
    throw Error("RECONCILIATION_DIFFERENCE");
  if (hash(fs.readFileSync(source)) !== hash(original))
    throw Error("IMPORT_SOURCE_CHANGED");
  let commit = preview;
  if (preview.data.state !== "COMMITTED") {
    const commitResponse = page.waitForResponse(
      (r) => r.url().endsWith("/imports/commit"),
      { timeout: 120000 },
    );
    await page.getByRole("button", { name: "提交到新只读档案" }).click();
    const r = await commitResponse;
    commit = await r.json();
    if (!r.ok() || commit.data.state !== "COMMITTED")
      throw Error("COMMIT_FAILED");
  }
  await page
    .getByRole("button", { name: "查看原记录 / 多腿详情" })
    .first()
    .waitFor();
  await page.screenshot({
    path: `${dir}/archive-desktop.png`,
    fullPage: false,
  });
  await page
    .getByRole("button", { name: "查看原记录 / 多腿详情" })
    .first()
    .click();
  await page
    .getByRole("heading", { name: "原始记录（只读）" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${dir}/archive-original.png`,
    fullPage: false,
  });
  const finalHash = hash(fs.readFileSync(source));
  fs.writeFileSync(
    `${dir}/report.json`,
    JSON.stringify(
      {
        sourceFile: path.basename(source),
        sourceHash: hash(original),
        sourceUnchanged: finalHash === hash(original),
        expected,
        previewId: preview.data.id,
        previewHash: preview.data.previewHash,
        state: commit.data.state,
        portfolios: actual.length,
        errors,
        exitCode: errors.length ? 1 : 0,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      state: commit.data.state,
      ...expected,
      sourceUnchanged: finalHash === hash(original),
      errors,
    }),
  );
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
