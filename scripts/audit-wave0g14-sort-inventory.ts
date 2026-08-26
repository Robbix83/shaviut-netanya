/**
 * scripts/audit-wave0g14-sort-inventory.ts — Wave 0G-14 Phase 4: read-only
 * inventory of every visible sort option in the official nadlan.gov.il
 * transaction-list UI for Rasko (sourceId=65210248).
 *
 * This script does NOT select/click any sort option — it only opens the
 * "מיון" dropdown and reads the DOM text of visible candidate elements, then
 * closes the menu (Escape) without changing the page's active sort. No new
 * fetch_number=1 request is issued for any option beyond the page's default
 * load. This keeps Phase 4 strictly an inventory step; Phase 5/6/8 select
 * and live-test specific new surfaces.
 *
 * NOTE (ECC planner finding): the DOM scan below is page-wide, not scoped to
 * only the "מיון" dropdown's own menu items — it also matches the page's
 * separate room-count FILTER chips (e.g. "כל החדרים", "3 חדרים") that happen
 * to be visible at the same time. Every matching candidate is captured, then
 * classified post-hoc as `kind: "sort"` (carries an explicit ascending/
 * descending direction phrase, "סדר עולה"/"סדר יורד") or `kind: "filter"`
 * (everything else matching the broad regex).
 *
 * Reuses the proven direct-URL navigation + persistent Chrome profile
 * pattern from Wave 0G-8/0G-13. No canonical/Supabase writes.
 */
import { promises as fs } from "fs";
import path from "path";
import { buildDirectNeighborhoodUrl } from "../lib/nadlanAcquisition";

const SOURCE_ID = "65210248";
const OUT_DIR = path.join(process.cwd(), "audit/wave0g14/shadow");

interface ClassifiedOption {
  text: string;
  kind: "sort" | "filter";
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log("=== WAVE 0G-14 PHASE 4: SORT UI INVENTORY (Rasko, sourceId=" + SOURCE_ID + ") ===");

  const headless = process.env.HARVEST_HEADLESS === "true";
  const { chromium: pwChromium } = await import("playwright");
  const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
    ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");
  const ctx = await pwChromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless, slowMo: headless ? 0 : 80,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  let classified: ClassifiedOption[] = [];
  let errorMsg: string | null = null;

  try {
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const url = buildDirectNeighborhoodUrl(SOURCE_ID);
    console.log("NAVIGATING_DIRECTLY_TO=" + url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);

    const sortWords = await page.locator("text=מיון").all();
    let toggle: any = null;
    for (const el of sortWords) { if (await el.isVisible().catch(() => false)) { toggle = el; break; } }
    if (!toggle) throw new Error("NO_VISIBLE_SORT_TOGGLE_FOUND");

    await toggle.click({ timeout: 5000 });
    await page.waitForTimeout(1500);

    const candidates = await page.locator("li, div[role='option'], a, button").all();
    const seen = new Set<string>();
    for (const el of candidates) {
      try {
        if (!(await el.isVisible())) continue;
        const txt = (await el.innerText()).trim();
        if (!txt || txt.length > 60) continue;
        if (/תאריך|מחיר|שטח|סדר עולה|סדר יורד|קומה|חדרים/.test(txt) && !seen.has(txt)) {
          seen.add(txt);
          const kind: "sort" | "filter" = /סדר עולה|סדר יורד/.test(txt) ? "sort" : "filter";
          classified.push({ text: txt, kind });
        }
      } catch { /* stale element, skip */ }
    }

    // Close the menu without selecting anything, to leave page state
    // (default descending sort) untouched.
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);

    const sortOnly = classified.filter((c) => c.kind === "sort");
    console.log("VISIBLE_CANDIDATES_FOUND=" + classified.length + " (sort=" + sortOnly.length + ", filter=" + (classified.length - sortOnly.length) + ")");
    for (const c of classified) console.log(`  [${c.kind}] ${c.text}`);
  } catch (e) {
    errorMsg = (e as Error).message;
    console.log("ERROR=" + errorMsg);
  } finally {
    await ctx.close();
  }

  await fs.writeFile(
    path.join(OUT_DIR, "sort_ui_inventory.json"),
    JSON.stringify({ sourceId: SOURCE_ID, classified, error: errorMsg }, null, 2),
  );
  console.log("DONE");
}

main().catch((e) => { console.error("SORT_INVENTORY_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
