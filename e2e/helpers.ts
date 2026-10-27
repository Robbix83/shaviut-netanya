import { expect, type Page } from "@playwright/test";

/** Collects uncaught page errors and console errors from the moment it is called. */
export function captureErrors(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  return { pageErrors, consoleErrors };
}

/** Fails if the document is wider than the viewport (horizontal scroll). */
export async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `page is ${scrollWidth}px wide in a ${clientWidth}px viewport`).toBeLessThanOrEqual(clientWidth);
}

/** Asserts the document is Hebrew right-to-left. */
export async function expectRtl(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "he");
}

/** True when the page sees prefers-reduced-motion: reduce. */
export function prefersReducedMotion(page: Page) {
  return page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
}
