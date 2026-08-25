/**
 * scripts/audit-wave0g5-request-contract.ts — READ-ONLY diagnostic to capture
 * the exact /deal-data POST request contract (URL, method, content-type, and
 * SAFE body fields only) for the address-level query "עובד בן עמי 41" that
 * Wave 0G-4 proved works, but did not capture the request body for.
 *
 * Explicitly never logs cookies, Authorization headers, or any other secret.
 * Only request.url(), request.method(), request.headers()["content-type"],
 * and request.postData() (the request BODY, which nadlan's own client sends
 * to itself — not a credential) are captured.
 *
 * HARD GUARANTEES:
 *  - Never opens or writes data/deals.json.
 *  - Never touches Supabase.
 *  - Writes only under audit/wave0g5/.
 */
import { promises as fs } from "fs";
import path from "path";
import zlib from "zlib";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium: chromiumExtra } = require("playwright-extra");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromiumExtra.use(StealthPlugin());

const OUT_DIR = path.join(process.cwd(), "audit", "wave0g5");
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

interface CapturedRequest {
  seq: number;
  url: string;
  method: string;
  contentType: string | null;
  postData: string | null; // the request BODY only — no headers/cookies ever captured
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const captured: CapturedRequest[] = [];
  let seq = 0;
  const dealDataResponses: any[] = [];

  console.log("=== WAVE 0G-5 REQUEST-CONTRACT CAPTURE (read-only, target: עובד בן עמי 41) ===");

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
    if (u.includes("api.nadlan.gov.il/deal-data")) {
      seq++;
      let contentType: string | null = null;
      try { contentType = req.headers()["content-type"] ?? null; } catch { /* ignore */ }
      captured.push({ seq, url: u, method: req.method(), contentType, postData: req.postData() });
      console.log(`  [captured ${seq}] ${req.method()} ${u} content-type=${contentType}`);
      console.log(`  [body] ${req.postData()}`);
    }
  });

  page.on("response", async (resp: any) => {
    const u = resp.url();
    if (u.includes("/deal-data")) {
      try {
        const body = await resp.text();
        const decoded = decodeDealData(body);
        const items = decoded?.data?.items ?? decoded?.items ?? [];
        dealDataResponses.push({ url: u, status: resp.status(), itemCount: Array.isArray(items) ? items.length : null });
        console.log(`  [response] status=${resp.status()} items=${Array.isArray(items) ? items.length : "N/A"}`);
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
    if (await exact.count()) {
      console.log("CLICKING_EXACT=" + (await exact.textContent()));
      await exact.click();
    } else {
      console.log("NO_EXACT_MATCH_FALLING_BACK_TO_ENTER");
      await input.press("Enter");
    }

    await page.waitForTimeout(6000);

    // Try scrolling briefly in case the deal-data call is scroll-triggered on this page too
    for (let round = 0; round < 4; round++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
    }
  } catch (e) {
    console.log("NAVIGATION_ERROR=" + (e as Error).message);
  } finally {
    await ctx.close();
  }

  await fs.writeFile(path.join(OUT_DIR, "dealdata_request_contract.json"), JSON.stringify(captured, null, 2));
  await fs.writeFile(path.join(OUT_DIR, "dealdata_response_summary.json"), JSON.stringify(dealDataResponses, null, 2));

  console.log("\nTOTAL_CAPTURED_REQUESTS=" + captured.length);
  console.log("DONE");
}

main().catch((e) => { console.error("REQUEST_CONTRACT_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
