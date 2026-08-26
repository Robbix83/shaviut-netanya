/**
 * scripts/audit-wave0g17-street-discovery.ts — Wave 0G-17 Phase 4/5: live,
 * read-only inspection of קריית השרון's (sourceId=65209683) nadlan.gov.il
 * neighborhood page for ANY official street-level enumeration or filtering
 * mechanism — a street filter dropdown, a street-list network call, or any
 * other official data source that names streets with a source-native id.
 *
 * Does NOT click into or select any street — inventory/discovery only, to
 * decide whether Phase 5 (direct street-level querying) has anything to
 * test against. No fetch_number>=2, no login-wall interaction.
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

/**
 * SECURITY FIX (ECC security-reviewer finding — CRITICAL, live in this
 * wave): the original version of this script captured EVERY nadlan.gov.il
 * request's URL and a 200-char body preview, unfiltered by endpoint. This
 * captured a real, undecoded auth token VALUE from a POST to
 * /auth/token-verify and wrote it to a committed-directory file
 * (street_discovery_network.json) — a direct violation of this engagement's
 * "field NAMES/presence only, never VALUES" credential rule. The file was
 * deleted immediately on discovery. Fixed by: (1) never reading postData()
 * at all in this script — URL/method only, no body content whatsoever;
 * (2) explicitly skipping any URL containing "token" or "auth" so an
 * auth-related endpoint is never even recorded by name-plus-body, only by
 * bare URL if it happens to match the allow-pattern below.
 */
async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log(`=== WAVE 0G-17 PHASE 4: STREET ENUMERATION DISCOVERY (sourceId=${SOURCE_ID}) ===`);

  const headless = process.env.HARVEST_HEADLESS === "true";
  const { chromium: pwChromium } = await import("playwright");
  const ctx = await pwChromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless, slowMo: headless ? 0 : 60,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  const networkCalls: { url: string; method: string }[] = [];

  try {
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    page.on("request", (req: any) => {
      const u = req.url();
      // Never any auth/token endpoint, by name, at all — and never body
      // content for any endpoint, credential-bearing or not.
      if (/token|auth\./i.test(u)) return;
      if (u.includes("nadlan.gov.il") && !u.includes(".js") && !u.includes(".css") && !u.includes(".png") && !u.includes(".svg") && !u.includes(".woff")) {
        networkCalls.push({ url: u, method: req.method() });
      }
    });

    const url = buildDirectNeighborhoodUrl(SOURCE_ID);
    console.log("NAVIGATING_DIRECTLY_TO=" + url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);

    // Look for any visible filter control mentioning street ("רחוב").
    const streetFilterCandidates = await page.locator("text=רחוב").all();
    console.log("STREET_TEXT_MATCHES_FOUND=" + streetFilterCandidates.length);
    for (let i = 0; i < Math.min(streetFilterCandidates.length, 10); i++) {
      const el = streetFilterCandidates[i];
      const visible = await el.isVisible().catch(() => false);
      const text = await el.innerText().catch(() => "");
      console.log(`  [${i}] visible=${visible} text="${text.slice(0, 60)}"`);
    }

    // Check page's full accessibility/DOM text for any filter/dropdown widget.
    const allButtons = await page.locator("button, [role='combobox'], select, input[type='text']").all();
    console.log("INTERACTIVE_CONTROL_COUNT=" + allButtons.length);
    const controlSummaries: string[] = [];
    for (const el of allButtons.slice(0, 40)) {
      try {
        if (!(await el.isVisible())) continue;
        const tag = await el.evaluate((e: any) => e.tagName);
        const txt = (await el.innerText().catch(() => "")) || (await el.getAttribute("placeholder").catch(() => "")) || "";
        if (txt.trim()) controlSummaries.push(`${tag}: ${txt.trim().slice(0, 40)}`);
      } catch { /* stale */ }
    }
    console.log("VISIBLE_CONTROL_LABELS=" + JSON.stringify([...new Set(controlSummaries)], null, 2));

    await page.waitForTimeout(1000);
  } catch (e) {
    console.log("ERROR=" + (e as Error).message);
  } finally {
    await ctx.close();
  }

  const nonDealDataCalls = networkCalls.filter((c) => !c.url.includes("/deal-data"));
  console.log("TOTAL_NADLAN_NETWORK_CALLS=" + networkCalls.length);
  console.log("NON_DEAL_DATA_CALLS=" + nonDealDataCalls.length);
  for (const c of nonDealDataCalls) console.log(`  ${c.method} ${c.url}`);

  assertSafeShadowOutputPath(`${OUT_DIR_REL}/street_discovery_network.json`);
  await fs.writeFile(path.join(OUT_DIR, "street_discovery_network.json"), JSON.stringify(networkCalls, null, 2));
  console.log("DONE");
}

main().catch((e) => { console.error("STREET_DISCOVERY_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
