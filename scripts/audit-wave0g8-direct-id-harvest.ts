/**
 * scripts/audit-wave0g8-direct-id-harvest.ts — READ-ONLY direct-ID acquisition
 * proof. Navigates DIRECTLY to https://www.nadlan.gov.il/?view=neighborhood&id={sourceId}&page=deals
 * (proven this wave to trigger a correctly entity-scoped /deal-data request)
 * with ZERO autocomplete/name-search interaction — no search box is touched
 * at all in this script.
 *
 * This directly answers Wave 0G-8's central question: can /deal-data be
 * reached by official sourceId alone, without routing through name-typed
 * search? It captures and self-verifies the RESPONSE entity identity against
 * the REQUESTED sourceId, failing closed (not silently "succeeding") on any
 * mismatch, missing identity, or empty result — the same standard Wave 0G-7's
 * fixed shadow script uses, applied here to a genuinely different, direct
 * acquisition path.
 *
 * HARD GUARANTEES:
 *  - Never opens or writes data/deals.json.
 *  - Never touches Supabase.
 *  - Never types into or clicks any autocomplete/search suggestion.
 *  - Writes only under audit/wave0g8/.
 *  - Never logs cookies, Authorization headers, or session-bound tokens.
 *
 * Usage:
 *   npx tsx scripts/audit-wave0g8-direct-id-harvest.ts <sourceId> <label> [maxFetches]
 */
import { promises as fs } from "fs";
import path from "path";
import zlib from "zlib";
import { buildDirectNeighborhoodUrl, assertDirectIdAcquisitionIdentity } from "../lib/nadlanAcquisition";

const OUT_DIR = path.join(process.cwd(), "audit", "wave0g8");
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

function decodeDealData(text: string): any {
  try { return JSON.parse(text); } catch { /* try b64+gzip */ }
  try {
    const buf = Buffer.from(text.replace(/^"|"$/g, ""), "base64");
    return JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
  } catch { return null; }
}

function num(v: any): number {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[^\d.]/g, "");
  return cleaned ? parseFloat(cleaned) : NaN;
}

interface ResponseCapture {
  seq: number;
  status: number;
  itemCount: number;
  distinctNeighborhoodIds: string[];
}

async function directIdHarvest(sourceId: string, label: string, maxScrollRounds: number) {
  const responses: ResponseCapture[] = [];
  const allItems: any[] = [];
  // Deliberately: NO request-body capture here (avoiding any session-token
  // exposure risk, per Wave 0G-5's finding that the body embeds short-lived
  // credential fields) — only response bodies (public transaction data) are
  // read, and only request METHOD/URL (no headers) are logged for the trace.
  const requestLog: string[] = [];
  let seq = 0;

  console.log(`\n=== DIRECT-ID HARVEST: ${label} (sourceId=${sourceId}) — via direct URL, NO autocomplete/search ===`);

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
    if (req.url().includes("api.nadlan.gov.il/deal-data")) {
      requestLog.push(`${req.method()} ${req.url()}`);
    }
  });

  page.on("response", async (resp: any) => {
    const u = resp.url();
    if (u.includes("/deal-data")) {
      try {
        const body = await resp.text();
        const decoded = decodeDealData(body);
        const items = decoded?.data?.items ?? decoded?.items ?? [];
        if (Array.isArray(items)) {
          allItems.push(...items);
          seq++;
          const distinctIds = [...new Set(items.map((it: any) => String(it.neighborhoodId)))];
          responses.push({ seq, status: resp.status(), itemCount: items.length, distinctNeighborhoodIds: distinctIds });
          console.log(`  [response ${seq}] status=${resp.status()} items=${items.length} neighborhoodIds=${JSON.stringify(distinctIds)}`);
        }
      } catch (e) { console.log("  [response parse error] " + (e as Error).message); }
    }
  });

  let navigationError: string | null = null;
  try {
    const url = buildDirectNeighborhoodUrl(sourceId);
    console.log("NAVIGATING_DIRECTLY_TO=" + url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(5000);

    const pageText = await page.evaluate(() => document.body.innerText).catch(() => "");
    console.log("PAGE_HEADING_CHECK (first 150 chars)=" + pageText.slice(0, 150).replace(/\n/g, " | "));

    // Scroll to trigger any further paginated fetches, same idle-detection
    // pattern as prior waves' scroll-based harvesters — but here we ALSO know
    // (Wave 0G-5) the client may use a `fetch_number` field internally; we do
    // not construct that field ourselves, we only observe what scrolling
    // legitimately triggers.
    let idleRounds = 0;
    let lastCount = allItems.length;
    for (let round = 0; round < maxScrollRounds; round++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2500);
      if (allItems.length === lastCount) {
        idleRounds++;
        if (idleRounds >= 4) break;
      } else { idleRounds = 0; lastCount = allItems.length; }
    }
  } catch (e) {
    navigationError = (e as Error).message;
    console.log("NAVIGATION_ERROR=" + navigationError);
  } finally {
    await ctx.close();
  }

  const seen = new Set<string>();
  const uniqueItems = allItems.filter((it) => {
    const key = String(it.keyValue ?? it.dealId ?? JSON.stringify(it));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Fail-closed identity check via the shared, unit-tested
  // lib/nadlanAcquisition.ts helper — same standard as Wave 0G-7's shadow script.
  const identity = assertDirectIdAcquisitionIdentity(uniqueItems, sourceId);
  const distinctNeighborhoodIds = identity.distinctIds;
  const matchingCount = identity.matchingCount;
  const responseEntityId = distinctNeighborhoodIds.length === 1 ? distinctNeighborhoodIds[0] : (distinctNeighborhoodIds.length === 0 ? null : "MIXED:" + distinctNeighborhoodIds.join(","));

  let requestValid = !navigationError && identity.valid;
  let error: string | null = navigationError ?? identity.error;

  const dates = uniqueItems.map((it) => {
    const d = it.dealDate ?? it.DEALDATETIME ?? it.dealDateTime;
    return d ? new Date(d).toISOString().slice(0, 10) : null;
  }).filter(Boolean).sort() as string[];

  const streets = new Set<string>();
  const houseNumbers = new Set<string>();
  for (const it of uniqueItems) {
    const addr = String(it.address ?? "").trim();
    if (!addr || addr === "0") continue;
    const m = addr.match(/^(.+?)\s+(\d+[א-ת]?)$/);
    if (m) { streets.add(m[1]); houseNumbers.add(m[2]); } else { streets.add(addr); }
  }

  const summary = {
    requestedId: sourceId,
    label,
    navigationUsed: "direct URL (?view=neighborhood&id=...) — zero autocomplete/search interaction",
    requestValid,
    error,
    responseEntityId,
    entityMatch: requestValid,
    rawResponseCount: responses.length,
    rawItemCount: allItems.length,
    uniqueItemCount: uniqueItems.length,
    matchingCount,
    distinctNeighborhoodIds,
    earliestDate: dates[0] ?? null,
    latestDate: dates[dates.length - 1] ?? null,
    distinctStreetsCount: streets.size,
    distinctHouseNumbersCount: houseNumbers.size,
    perResponseBreakdown: responses,
    requestLogCount: requestLog.length,
  };

  console.log("\nSUMMARY=" + JSON.stringify(summary, null, 2));

  return { summary, uniqueItems };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const sourceId = process.argv[2];
  const label = process.argv[3];
  const maxScrollRounds = process.argv[4] ? parseInt(process.argv[4], 10) : 200;
  if (!sourceId || !label) {
    console.error("Usage: npx tsx scripts/audit-wave0g8-direct-id-harvest.ts <sourceId> <label> [maxScrollRounds]");
    process.exit(1);
  }

  const { summary, uniqueItems } = await directIdHarvest(sourceId, label, maxScrollRounds);
  await fs.writeFile(path.join(OUT_DIR, `${label}_direct.json`), JSON.stringify({ summary, items: uniqueItems }, null, 2));

  const benAmiTargets = [
    { date: "2024-11-15", price: 280000 }, { date: "2023-06-21", price: 925000 },
    { date: "2023-05-11", price: 680000 }, { date: "2023-04-20", price: 975000 },
    { date: "2022-06-08", price: 232000 }, { date: "2022-05-29", price: 460000 },
    { date: "2022-02-23", price: 718000 },
  ];
  console.log("\n=== BEN AMI 41 CHECK ===");
  let found7 = 0;
  for (const t of benAmiTargets) {
    const hit = uniqueItems.find((it: any) => {
      const d = it.dealDate ?? it.DEALDATETIME ?? it.dealDateTime;
      const dd = d ? new Date(d).toISOString().slice(0, 10) : "";
      const p = num(it.dealAmount ?? it.DEALAMOUNT ?? it.price);
      return dd === t.date && p === t.price;
    });
    if (hit) found7++;
    console.log(`  ${t.date} / ₪${t.price} -> FOUND=${!!hit}`);
  }
  console.log(`KNOWN_7_FOUND=${found7}/7`);

  console.log("\nDONE (direct-ID only, no canonical writes, no Supabase writes)");
}

main().catch((e) => { console.error("DIRECT_ID_HARVEST_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
