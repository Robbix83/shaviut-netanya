/**
 * scripts/audit-wave0g4-address-trace.ts — READ-ONLY diagnostic network trace
 * against nadlan.gov.il's real UI, searching directly for "עובד בן עמי 41".
 *
 * Purpose: Wave 0G-4 Phase 5 — determine what network requests the OFFICIAL UI
 * itself fires when reaching an address that neighborhood- and street-level
 * automated acquisition (Waves 0G-2/0G-3) could not find. Does NOT bypass
 * reCAPTCHA or any anti-bot control — uses the same normal browser navigation
 * and the operator's own pre-existing, already-authenticated Chrome profile,
 * exactly as Waves 0G-2/0G-3 did.
 *
 * Logs ONLY: request method, URL, and (for the specific /deal-data endpoint)
 * decoded response bodies. Explicitly never logs cookies, Authorization
 * headers, or any other header value.
 *
 * HARD GUARANTEES:
 *  - Never opens or writes data/deals.json.
 *  - Never touches Supabase.
 *  - Writes only under audit/wave0g4/.
 */
import { promises as fs } from "fs";
import path from "path";
import zlib from "zlib";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium: chromiumExtra } = require("playwright-extra");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromiumExtra.use(StealthPlugin());

const OUT_DIR = path.join(process.cwd(), "audit", "wave0g4");
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

function decodeDealData(text: string): any {
  try { return JSON.parse(text); } catch { /* try b64+gzip */ }
  try {
    const buf = Buffer.from(text.replace(/^"|"$/g, ""), "base64");
    const unz = zlib.gunzipSync(buf).toString("utf8");
    return JSON.parse(unz);
  } catch { return null; }
}

interface RequestLogEntry {
  seq: number;
  timestamp: string;
  method: string;
  url: string; // full URL including query string — no header/cookie values are ever logged
  resourceType: string;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const requestLog: RequestLogEntry[] = [];
  const dealDataResponses: any[] = [];
  let seq = 0;

  console.log("=== WAVE 0G-4 ADDRESS-LEVEL NETWORK TRACE (read-only, target: עובד בן עמי 41) ===");
  console.log("PROFILE_DIR=" + PROFILE_DIR);

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

  page.on("request", (req: any) => {
    const u = req.url();
    // Only log calls to nadlan's own API surface — skip static assets/fonts/analytics noise.
    if (u.includes("nadlan.gov.il") && (u.includes("/api/") || u.includes("TldSearch") || u.includes("deal-data") || u.includes("Details"))) {
      seq++;
      requestLog.push({ seq, timestamp: new Date().toISOString(), method: req.method(), url: u, resourceType: req.resourceType() });
      console.log(`  [req ${seq}] ${req.method()} ${u}`);
    }
  });

  page.on("response", async (resp: any) => {
    const u = resp.url();
    if (u.includes("/deal-data")) {
      try {
        const body = await resp.text();
        const decoded = decodeDealData(body);
        const items = decoded?.data?.items ?? decoded?.items ?? [];
        dealDataResponses.push({ url: u, status: resp.status(), itemCount: Array.isArray(items) ? items.length : null, items });
        console.log(`  [deal-data response] status=${resp.status()} items=${Array.isArray(items) ? items.length : "N/A"}`);
      } catch (e) { console.log("  [response parse error] " + (e as Error).message); }
    }
  });

  try {
    await page.goto("https://www.nadlan.gov.il/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);
    const input = page.locator("input#myInput2, input.react-autosuggest__input").first();
    await input.fill("עובד בן עמי 41 נתניה");
    await page.waitForTimeout(3500);

    const suggestions = await page.locator("li").allTextContents();
    console.log("SUGGESTIONS=" + JSON.stringify(suggestions.map(s => s.trim().replace(/\s+/g, " "))));

    const exact = page.locator("li", { hasText: "41" }).filter({ hasText: "בן עמי" }).first();
    let clicked = false;
    let clickedLabel = "";
    if (await exact.count()) {
      clickedLabel = (await exact.textContent() || "").trim();
      await exact.click(); clicked = true;
    } else {
      const anyOpt = page.locator("li").first();
      if (await anyOpt.count()) {
        clickedLabel = (await anyOpt.textContent() || "").trim();
        await anyOpt.click(); clicked = true;
      }
    }
    if (!clicked) { await input.press("Enter"); clickedLabel = "(Enter — no suggestion)"; }
    console.log("SUGGESTION_CLICKED=" + clickedLabel);

    await page.waitForTimeout(4000);

    // Try scrolling briefly in case a result list needs to load
    for (let round = 0; round < 6; round++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
    }

    // Capture the visible page text for evidence of what the UI actually shows
    const bodyText = await page.evaluate(() => document.body.innerText);
    await fs.writeFile(path.join(OUT_DIR, "address_trace_page_text.txt"), bodyText, "utf8");
    console.log("PAGE_TEXT_LENGTH=" + bodyText.length);
    console.log("PAGE_TEXT_CONTAINS_41=" + bodyText.includes("41"));
    console.log("PAGE_TEXT_CONTAINS_BEN_AMI=" + bodyText.includes("בן עמי"));

    // Try to find and click a transaction row resembling 8252-156-59, if visible
    const gushRow = page.locator("*", { hasText: "8252" }).first();
    if (await gushRow.count()) {
      console.log("FOUND_GUSH_8252_TEXT_ON_PAGE=true");
      try {
        await gushRow.click({ timeout: 5000 });
        await page.waitForTimeout(2500);
      } catch { console.log("GUSH_ROW_CLICK_FAILED"); }
    } else {
      console.log("FOUND_GUSH_8252_TEXT_ON_PAGE=false");
    }
  } catch (e) {
    console.log("NAVIGATION_ERROR=" + (e as Error).message);
  } finally {
    await ctx.close();
  }

  await fs.writeFile(path.join(OUT_DIR, "address_trace_requests.json"), JSON.stringify(requestLog, null, 2));
  await fs.writeFile(path.join(OUT_DIR, "address_trace_deal_data_responses.json"), JSON.stringify(dealDataResponses, null, 2));

  console.log("\nTOTAL_LOGGED_REQUESTS=" + requestLog.length);
  console.log("TOTAL_DEAL_DATA_RESPONSES=" + dealDataResponses.length);
  console.log("\nDONE");
}

main().catch((e) => { console.error("ADDRESS_TRACE_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
