const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./test",
  testMatch: "**/*.browser.spec.js",
  timeout: 20_000,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: "node test/server.js",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
