import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright — browser checks for design validation (e2e/ only).
 *
 * Vitest owns every *.test.ts file; Playwright only discovers e2e/**\/*.spec.ts,
 * so the two runners never pick up each other's files.
 *
 * Reuses an already-running dev server on PLAYWRIGHT_BASE_URL (default
 * http://localhost:3030, the .claude/launch.json "shaviut-netanya" port) and
 * only starts `npm run dev` itself when nothing is listening there.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3030";
const port = Number(new URL(baseURL).port || 80);

// Chromium with a phone viewport + touch + mobile meta-viewport handling.
const phone = (width: number, height: number) => ({
  ...devices["Desktop Chrome"],
  viewport: { width, height },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // One worker: every project hits the same Next dev server, which compiles on
  // demand; parallel cold requests to it time out.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },

  projects: [
    { name: "mobile-320", use: phone(320, 568) },
    { name: "mobile-390", use: phone(390, 844) },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    {
      name: "mobile-390-reduced-motion",
      use: { ...phone(390, 844), contextOptions: { reducedMotion: "reduce" } },
    },
  ],

  webServer: {
    command: `npm run dev -- -p ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
