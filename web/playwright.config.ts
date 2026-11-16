import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "ui.spec.ts",
  use: {
    ...devices["iPhone 13"],
    browserName: "chromium",
    channel: "chrome",
    baseURL: "http://127.0.0.1:5175",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5175/h5/",
    reuseExistingServer: !process.env.CI,
  },
});
