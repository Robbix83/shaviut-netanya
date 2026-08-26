/**
 * scripts/audit-wave0g17-filter-discovery.ts — Wave 0G-17 Phase 4/5
 * continued: captures the /deal-info response body (a previously-unseen
 * endpoint discovered this wave) and opens the "סינון" (filter) UI panel —
 * distinct from the already-known "מיון" (sort) menu — to inspect whether
 * it exposes a street-level filter with source-native IDs, as opposed to
 * the already-known free-text autocomplete search box (proven unreliable,
 * Wave 0G-7/0G-8). Read-only: opens the panel, does not select/submit
 * anything with an invented value.
 */
import { promises as fs } from "fs";
import path from "path";
import { buildDirectNeighborhoodUrl } from "../lib/nadlanAcquisition";
import { assertSafeShadowOutputPath } from "../lib/shadowRebuild";

const SOURCE_ID = "65209683";
const OUT_DIR_REL = "audit/wave0g17/shadow";
const OUT_DIR = path.join(process.cwd(), OUT_DIR_REL);
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log(`=== WAVE 0G-17 FILTER PANEL + /deal-info DISCOVERY (sourceId=${SOURCE_ID}) ===`);

  const headless = process.env.HARVEST_HEADLESS === "true";
  const { chromium: pwChromium } = await import("playwright");
  const ctx = await pwChromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless, slowMo: headless ? 0 : 60,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  let dealInfoBody: any = null;

  try {
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    page.on("response", async (resp: any) => {
      const u = resp.url();
      if (u.includes("/deal-info")) {
        try {
          const text = await resp.text();
          dealInfoBody = JSON.parse(text);
        } catch (e) {
          console.log("  [deal-info parse error] " + (e as Error).message);
        }
      }
    });

    const url = buildDirectNeighborhoodUrl(SOURCE_ID);
    console.log("NAVIGATING_DIRECTLY_TO=" + url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);

    console.log("DEAL_INFO_CAPTURED=" + (dealInfoBody !== null));
    if (dealInfoBody) {
      console.log("DEAL_INFO_KEYS=" + JSON.stringify(Object.keys(dealInfoBody)));
      console.log("DEAL_INFO_BODY=" + JSON.stringify(dealInfoBody, null, 2).slice(0, 3000));
    }

    // Open the "סינון" (filter) panel — distinct button from "מיון" (sort).
    const filterButtons = await page.locator("text=סינון").all();
    let filterBtn: any = null;
    for (const el of filterButtons) { if (await el.isVisible().catch(() => false)) { filterBtn = el; break; } }
    if (filterBtn) {
      await filterBtn.click({ timeout: 5000 });
      await page.waitForTimeout(1500);
      console.log("FILTER_PANEL_OPENED=true");

      // Inventory what appears inside the now-open filter panel.
      const panelText = await page.locator("body").innerText().catch(() => "");
      // Look specifically for a street-related control.
      const streetLabelMatches = await page.locator("text=רחוב").all();
      console.log("STREET_LABEL_MATCHES_IN_FILTER_PANEL=" + streetLabelMatches.length);
      for (let i = 0; i < Math.min(streetLabelMatches.length, 10); i++) {
        const el = streetLabelMatches[i];
        const visible = await el.isVisible().catch(() => false);
        const txt = await el.innerText().catch(() => "");
        console.log(`  [street match ${i}] visible=${visible} text="${txt.slice(0, 60)}"`);
      }

      // Dump all visible dropdown/select-like controls now visible.
      const controls = await page.locator("select, [role='combobox'], [role='listbox'], .dropdown, [class*='select']").all();
      console.log("DROPDOWN_LIKE_CONTROLS=" + controls.length);
      for (const el of controls.slice(0, 15)) {
        try {
          if (!(await el.isVisible())) continue;
          const cls = await el.getAttribute("class").catch(() => "");
          const txt = await el.innerText().catch(() => "");
          console.log(`  control class="${cls}" text="${txt.slice(0, 80).replace(/\n/g, " | ")}"`);
        } catch { /* stale */ }
      }

      assertSafeShadowOutputPath(`${OUT_DIR_REL}/filter_panel_text.txt`);
      await fs.writeFile(path.join(OUT_DIR, "filter_panel_text.txt"), panelText);
    } else {
      console.log("FILTER_PANEL_OPENED=false (button not found/visible)");
    }

    await page.waitForTimeout(1000);
  } catch (e) {
    console.log("ERROR=" + (e as Error).message);
  } finally {
    await ctx.close();
  }

  if (dealInfoBody) {
    assertSafeShadowOutputPath(`${OUT_DIR_REL}/deal_info_response.json`);
    await fs.writeFile(path.join(OUT_DIR, "deal_info_response.json"), JSON.stringify(dealInfoBody, null, 2));
  }
  console.log("DONE");
}

main().catch((e) => { console.error("FILTER_DISCOVERY_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
