/**
 * scripts/audit-wave0g8-direct-id-probe.ts — READ-ONLY exploration of whether
 * nadlan.gov.il exposes a direct-navigation URL for a neighborhood entity
 * (avoiding the name-typed autocomplete search that Wave 0G-7 proved
 * unreliable). Captures the URL after a KNOWN-good address-level search
 * (which Wave 0G-5 already proved legitimately triggers a neighborhoodId-
 * scoped /deal-data request as a side effect), to see if that URL reveals a
 * navigable pattern.
 *
 * Read-only. No reCAPTCHA bypass, no token capture/forging. Writes only
 * under audit/wave0g8/.
 */
import { promises as fs } from "fs";
import path from "path";

const OUT_DIR = path.join(process.cwd(), "audit", "wave0g8");
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const headless = process.env.HARVEST_HEADLESS === "true";
  const { chromium: pwChromium } = await import("playwright");
  const ctx = await pwChromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless, slowMo: headless ? 0 : 80,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const dealDataRequests: string[] = [];
  page.on("request", (req: any) => {
    if (req.url().includes("api.nadlan.gov.il/deal-data")) {
      dealDataRequests.push(`${new Date().toISOString()} ${req.method()} ${req.url()}`);
    }
  });

  try {
    console.log("=== Step 1: navigate to homepage ===");
    await page.goto("https://www.nadlan.gov.il/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);
    console.log("HOMEPAGE_URL=" + page.url());

    console.log("\n=== Step 2: search for known address 'עובד בן עמי 41' (address-level, NOT neighborhood-name search) ===");
    const input = page.locator("input#myInput2, input.react-autosuggest__input").first();
    await input.fill("עובד בן עמי 41 נתניה");
    await page.waitForTimeout(3500);
    const exact = page.locator("li", { hasText: "41" }).filter({ hasText: "בן עמי" }).first();
    if (await exact.count()) {
      await exact.click();
    } else {
      await input.press("Enter");
    }
    await page.waitForTimeout(4000);

    const afterAddressUrl = page.url();
    console.log("AFTER_ADDRESS_SEARCH_URL=" + afterAddressUrl);

    // Try to find any client-side router state exposed on window (read-only inspection).
    const routerState = await page.evaluate(() => {
      const w = window as any;
      const out: Record<string, unknown> = {};
      // Common SPA state locations — purely inspecting, not modifying.
      if (w.__NUXT__) out.nuxt = "present";
      if (w.__NEXT_DATA__) out.nextData = "present";
      out.locationHref = window.location.href;
      out.locationSearch = window.location.search;
      out.locationHash = window.location.hash;
      return out;
    });
    console.log("ROUTER_STATE=" + JSON.stringify(routerState));

    await fs.writeFile(
      path.join(OUT_DIR, "url_after_address_search.txt"),
      `HOMEPAGE_URL=${page.url()}\nAFTER_ADDRESS_SEARCH_URL=${afterAddressUrl}\nROUTER_STATE=${JSON.stringify(routerState, null, 2)}\n`,
    );

    console.log("\n=== Step 3: reload the current URL fresh (new tab/context) to see if it alone reproduces the query ===");
    const page2 = await ctx.newPage();
    const dealDataRequests2: string[] = [];
    page2.on("request", (req: any) => {
      if (req.url().includes("api.nadlan.gov.il/deal-data")) {
        dealDataRequests2.push(`${new Date().toISOString()} ${req.method()} ${req.url()}`);
      }
    });
    await page2.goto(afterAddressUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page2.waitForTimeout(5000);
    console.log("RELOAD_TRIGGERED_DEAL_DATA_REQUESTS=" + dealDataRequests2.length);
    await page2.close();

    console.log("\n=== Step 4: fresh cold navigation to view=neighborhood&id=65210195 (the target entity, direct URL guess) ===");
    const page3 = await ctx.newPage();
    const dealDataRequests3: string[] = [];
    page3.on("request", (req: any) => {
      if (req.url().includes("api.nadlan.gov.il/deal-data")) {
        dealDataRequests3.push(`${new Date().toISOString()} ${req.method()} ${req.url()}`);
      }
    });
    const neighborhoodUrl = "https://www.nadlan.gov.il/?view=neighborhood&id=65210195&page=deals";
    await page3.goto(neighborhoodUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page3.waitForTimeout(6000);
    console.log("NEIGHBORHOOD_URL_TRIGGERED_DEAL_DATA_REQUESTS=" + dealDataRequests3.length);
    const page3Text = await page3.evaluate(() => document.body.innerText).catch(() => "N/A");
    console.log("PAGE3_TEXT_HEAD=" + page3Text.slice(0, 300).replace(/\n/g, " | "));
    await page3.close();

    console.log("\n=== Step 5: in-app client-side navigation (pushState) to the neighborhood URL, from the ALREADY-warmed-up page 1 ===");
    const dealDataCountBeforeStep5 = dealDataRequests.length;
    await page.evaluate((url) => {
      window.history.pushState({}, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, neighborhoodUrl);
    await page.waitForTimeout(5000);
    const step5NewRequests = dealDataRequests.length - dealDataCountBeforeStep5;
    console.log("INAPP_PUSHSTATE_NEW_DEAL_DATA_REQUESTS=" + step5NewRequests);

    await fs.writeFile(
      path.join(OUT_DIR, "deal_data_request_log.txt"),
      [
        "dealDataRequests (session 1, page1 — address click + later in-app pushState):",
        dealDataRequests.join("\n"),
        "",
        "dealDataRequests2 (session 2, cold navigation to captured address URL, no search interaction):",
        dealDataRequests2.join("\n"),
        "",
        "dealDataRequests3 (session 3, cold navigation to guessed neighborhood URL, no search interaction):",
        dealDataRequests3.join("\n"),
      ].join("\n"),
    );

    console.log("\nDEAL_DATA_REQUEST_COUNT_SESSION1_TOTAL=" + dealDataRequests.length);
    console.log("DEAL_DATA_REQUEST_COUNT_SESSION2(cold-nav-address-url)=" + dealDataRequests2.length);
    console.log("DEAL_DATA_REQUEST_COUNT_SESSION3(cold-nav-neighborhood-url)=" + dealDataRequests3.length);
    console.log("DEAL_DATA_REQUEST_COUNT_STEP5(inapp-pushstate-neighborhood-url)=" + step5NewRequests);
  } catch (e) {
    console.log("ERROR=" + (e as Error).message);
  } finally {
    await ctx.close();
  }

  console.log("\nDONE");
}

main().catch((e) => { console.error("PROBE_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
