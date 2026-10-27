import { test, expect } from "@playwright/test";
import { captureErrors, expectNoHorizontalOverflow, expectRtl, prefersReducedMotion } from "./helpers";

// Minimal smoke: the app opens, renders RTL, logs no errors, and has no
// horizontal overflow — on every project (320, 390, 390 reduced-motion, desktop).
test("home page renders without errors or overflow", async ({ page }, testInfo) => {
  const errors = captureErrors(page);

  const res = await page.goto("/", { waitUntil: "load" });
  expect(res?.status()).toBe(200);
  await expect(page.locator("h1").first()).toBeVisible();
  await expectRtl(page);
  await expectNoHorizontalOverflow(page);

  // Reduced motion is emulated only in its own project; everywhere else it must be off,
  // so a project can't silently lose (or gain) the emulation.
  const wantsReducedMotion = testInfo.project.name.endsWith("reduced-motion");
  expect(await prefersReducedMotion(page)).toBe(wantsReducedMotion);

  expect(errors.pageErrors, "uncaught page errors").toEqual([]);
  expect(errors.consoleErrors, "console errors").toEqual([]);

  await page.screenshot({ path: testInfo.outputPath("home.png"), fullPage: false });
});
