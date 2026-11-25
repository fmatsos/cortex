import { defineConfig } from "@playwright/test";

// Browser tests run against a real static export of the site (see tests/ui/global-setup.ts), in the system Chrome:
// no Playwright browser is downloaded. `bun test` never sees this folder (bunfig.toml: [test] pathIgnorePatterns).
export default defineConfig({
  testDir: "./tests/ui",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/ui/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  outputDir: "./.playwright/results",
  use: { channel: "chrome", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
