import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/specs",
  testMatch: "**/real-deploy.e2e.ts",
  timeout: 300_000, // 5 minutes — real install takes time
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://localhost:1420",
    headless: false,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      slowMo: 500,
    },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
  reporter: [["list"]],
});
