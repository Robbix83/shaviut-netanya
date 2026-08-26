/**
 * scripts/audit-wave0g17-autocomplete-probe.ts — Wave 0G-17 Phase 5
 * continued: types a REAL, already-observed street name (from קריית השרון's
 * own transaction rows, not invented) into the site's free-text
 * autocomplete box to observe what suggestion TYPES it offers — a genuine
 * "רחוב" (street)-typed suggestion (which Wave 0G-3 never got to test) vs.
 * only address-level/settlement suggestions (which Wave 0G-3 proved
 * contamination-prone: 435/930 rows, 47%, belonged to other streets).
 *
 * Does NOT click/select any suggestion or submit a search — inventories
 * the suggestion list only, to answer Phase 5's PROVEN/NOT_PROVEN question
 * without fabricating a request shape.
 */
import { promises as fs } from "fs";
import path from "path";
import { buildDirectNeighborhoodUrl } from "../lib/nadlanAcquisition";
import { assertSafeShadowOutputPath } from "../lib/shadowRebuild";

const SOURCE_ID = "65209683";
const STREET_NAME = "הר שגיא"; // real street observed in this entity's own transaction rows this wave
const OUT_DIR_REL = "audit/wave0g17/shadow";
const OUT_DIR = path.join(process.cwd(), OUT_DIR_REL);
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log(`=== WAVE 0G-17 AUTOCOMPLETE SUGGESTION-TYPE PROBE: "${STREET_NAME}" ===`);

  const headless = process.env.HARVEST_HEADLESS === "true";
  const { chromium: pwChromium } = await import("playwright");
  const ctx = await pwChromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless, slowMo: headless ? 0 : 60,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  try {
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const url = buildDirectNeighborhoodUrl(SOURCE_ID);
    console.log("NAVIGATING_DIRECTLY_TO=" + url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);

    const input = page.locator("input[placeholder*='כתובת']").first();
    if ((await input.count()) === 0) throw new Error("AUTOCOMPLETE_INPUT_NOT_FOUND");
    await input.click({ timeout: 5000 });
    await input.type(STREET_NAME, { delay: 120 });
    await page.waitForTimeout(2500);

    // Inventory suggestion list items without clicking any.
    const suggestions = await page.locator("li, [class*='suggestion']").all();
    const seen = new Set<string>();
    const items: string[] = [];
    for (const el of suggestions) {
      try {
        if (!(await el.isVisible())) continue;
        const txt = (await el.innerText()).trim();
        if (!txt || txt.length > 100 || seen.has(txt)) continue;
        seen.add(txt);
        items.push(txt);
      } catch { /* stale */ }
    }
    console.log("SUGGESTION_COUNT=" + items.length);
    for (const it of items) console.log("  SUGGESTION: " + it);

    assertSafeShadowOutputPath(`${OUT_DIR_REL}/autocomplete_suggestions.json`);
    await fs.writeFile(path.join(OUT_DIR, "autocomplete_suggestions.json"), JSON.stringify({ streetName: STREET_NAME, suggestions: items }, null, 2));

    // Clear without submitting — read-only inspection only.
    await input.fill("");
    await page.waitForTimeout(500);
  } catch (e) {
    console.log("ERROR=" + (e as Error).message);
  } finally {
    await ctx.close();
  }

  console.log("DONE");
}

main().catch((e) => { console.error("AUTOCOMPLETE_PROBE_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
