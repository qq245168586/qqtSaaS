import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "cloud.spec.ts",
  workers: 1,
  use: {
    ...devices["iPhone 13"],
    browserName: "chromium",
    channel: "chrome",
    baseURL: "https://114.215.185.184",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  timeout: 60000,
});
