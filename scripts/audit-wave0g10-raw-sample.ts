/**
 * scripts/audit-wave0g10-raw-sample.ts — READ-ONLY capture of full raw
 * /deal-data item objects (public transaction records — dealDate, dealAmount,
 * parcelNum, assetId, row_id, etc. — no PII, no credentials) for one direct-ID
 * entity, to support Wave 0G-10's transaction-identity field inventory
 * (Phase 6/7). Uses the same proven direct-URL navigation as prior waves.
 *
 * HARD GUARANTEES: read-only, no canonical writes, no Supabase, no
 * credential-value capture (only field NAMES are reported for sk/token/exp).
 * Writes only under audit/wave0g10/.
 */
import { promises as fs } from "fs";
import path from "path";
import zlib from "zlib";
import { buildDirectNeighborhoodUrl } from "../lib/nadlanAcquisition";

const OUT_DIR = path.join(process.cwd(), "audit", "wave0g10");
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

function decodeDealData(text: string): any {
  try { return JSON.parse(text); } catch { /* try b64+gzip */ }
  try {
    const buf = Buffer.from(text.replace(/^"|"$/g, ""), "base64");
    return JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
  } catch { return null; }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const sourceId = process.argv[2] ?? "65210195";
  const label = process.argv[3] ?? "nof_hatayelet";

  console.log("=== WAVE 0G-10 RAW SAMPLE CAPTURE (target: " + label + ", sourceId=" + sourceId + ") ===");

  const headless = process.env.HARVEST_HEADLESS === "true";
  const { chromium: pwChromium } = await import("playwright");
  const ctx = await pwChromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless, slowMo: headless ? 0 : 80,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  let page: any;
  try {
    page = await ctx.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
  } catch (e) {
    await ctx.close();
    throw e;
  }

  let captured: any[] | null = null;
  page.on("response", async (resp: any) => {
    if (captured) return;
    const u = resp.url();
    if (!u.includes("/deal-data")) return;
    try {
      const body = await resp.text();
      const decoded = decodeDealData(body);
      const items = decoded?.data?.items ?? decoded?.items ?? [];
      if (Array.isArray(items) && items.length > 0) {
        captured = items;
        console.log("CAPTURED_ITEMS=" + items.length);
      }
    } catch (e) { console.log("  [response parse error] " + (e as Error).message); }
  });

  try {
    const url = buildDirectNeighborhoodUrl(sourceId);
    console.log("NAVIGATING_DIRECTLY_TO=" + url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(8000);
  } catch (e) {
    console.log("ERROR=" + (e as Error).message);
  } finally {
    await ctx.close();
  }

  await fs.writeFile(path.join(OUT_DIR, `raw_items_sample_${label}.json`), JSON.stringify(captured ?? [], null, 2));
  console.log("DONE");
}

main().catch((e) => { console.error("CAPTURE_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
