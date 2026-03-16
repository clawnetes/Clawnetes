import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/specs",
  testMatch: "**/*.e2e.ts",
  timeout: 30000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://localhost:1420",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
  reporter: [["list"]],
});
