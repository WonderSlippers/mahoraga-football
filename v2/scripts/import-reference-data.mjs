import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "@playwright/test";
const base = process.argv[2];
if (!base) throw Error("EXISTING_EXPORT_DIRECTORY_REQUIRED");
const names = [
  "market_quotes.csv",
  "odds_snapshots.csv",
  "model_forecasts.json",
  "model_outcomes.json",
  "market_results.json",
];
const files = names.map((n) => path.join(base, n));
const digest = (p) =>
  crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const before = Object.fromEntries(
  files.map((p) => [path.basename(p), digest(p)]),
);
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5274/archives");
  await page
    .getByRole("heading", { name: "历史档案与对账", exact: true })
    .waitFor();
  await page
    .getByLabel("原系统标识", { exact: true })
    .fill("legacy-export-20260925");
  await page.getByLabel("历史导出文件").setInputFiles(files);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/imports/preview"),
    { timeout: 120000 },
  );
  await page.getByRole("button", { name: "预览并对账" }).click();
  const r = await response;
  const p = await r.json();
  fs.writeFileSync(
    ".runtime-v2/import-verification/reference-preview.json",
    JSON.stringify(p, null, 2),
  );
  if (
    !r.ok() ||
    p.data.warnings.length ||
    Object.values(p.data.report.portfolios).some((x) => x.quarantine)
  )
    throw Error("REFERENCE_PREVIEW_REJECTED");
  if (files.some((f) => digest(f) !== before[path.basename(f)]))
    throw Error("SOURCE_CHANGED");
  if (p.data.state !== "COMMITTED") {
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/imports/commit"),
      { timeout: 120000 },
    );
    await page.getByRole("button", { name: "提交到新只读档案" }).click();
    const r = await response;
    const p = await r.json();
    if (!r.ok() || p.data.state !== "COMMITTED")
      throw Error("REFERENCE_COMMIT_FAILED");
  }
  // Reassemble every original file via paged API chunks and compare original-byte SHA.
  const rebuilt = await page.evaluate(async (id) => {
    const result = [];
    for (let index = 0; index < 5; index++) {
      let after = -1,
        parts = [];
      while (true) {
        const response = await fetch(
          `/api/v2/imports/${id}/files/${index}/chunks?after=${after}`,
        );
        const j = await response.json();
        if (!response.ok) throw Error("CHUNK_READ_FAILED");
        parts.push(...j.data.chunks.map((c) => c.content));
        if (j.data.nextCursor === null) break;
        after = j.data.nextCursor;
      }
      const h = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(parts.join("")),
      );
      result.push(
        [...new Uint8Array(h)]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join(""),
      );
    }
    return result;
  }, p.data.id);
  if (p.data.manifest.files.some((f, i) => f.sha256 !== rebuilt[i]))
    throw Error("ARCHIVED_SOURCE_HASH_MISMATCH");
  const result = {
    batchId: p.data.id,
    records: p.data.report.records,
    claims: p.data.claims,
    sourceHashes: before,
    originalsUnchanged: files.every(
      (f) => digest(f) === before[path.basename(f)],
    ),
    reassembledHashesMatch: true,
    exitCode: 0,
  };
  fs.writeFileSync(
    ".runtime-v2/import-verification/reference-report.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
