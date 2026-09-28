import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 120000,
  use: {
    baseURL: "http://127.0.0.1:5293",
    headless: true,
    launchOptions: {
      executablePath:
        process.env.CHROME_PATH ||
        (process.platform === "win32"
          ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
          : undefined),
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/e2e-report.json" }],
  ],
});
