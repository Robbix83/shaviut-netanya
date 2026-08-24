/**
 * scripts/audit-wave0g3-street-fetch.ts — READ-ONLY diagnostic reuse of
 * scripts/harvest.ts's harvestByStreets() single-street flow, for exactly
 * ONE street ("עובד בן עמי"), for evidence purposes only.
 *
 * Mirrors harvest.ts's harvestByStreets() single-street loop body (same
 * navigation, same autocomplete-suggestion selection logic, same
 * scrollUntilDone loop, same decode/normalize logic) so the acquired data
 * faithfully represents what the real street-mode harvester would see.
 * Does NOT import from scripts/harvest.ts (no exports exist there) — the
 * necessary functions are duplicated here verbatim so scripts/harvest.ts
 * itself is never touched or executed.
 *
 * HARD GUARANTEES:
 *  - Never opens or writes data/deals.json.
 *  - Never touches Supabase (no such code path exists in this file).
 *  - Writes only under audit/wave0g3/.
 *  - Logs every /deal-data page event for a full request trace.
 */
import { promises as fs } from "fs";
import path from "path";
import zlib from "zlib";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium: chromiumExtra } = require("playwright-extra");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromiumExtra.use(StealthPlugin());

const OUT_DIR = path.join(process.cwd(), "audit", "wave0g3");
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

const TARGET_STREET = process.env.WAVE0G3_STREET ?? "עובד בן עמי";
// Deals in canonical data/deals.json for this street carry neighborhoodId
// 66239254 ("מרכז העיר צפון") — used here ONLY as a normalize() tag for
// evidence comparison purposes, never written back anywhere.
const TAG_NEIGHBORHOOD_ID = "66239254";
const TAG_NEIGHBORHOOD_NAME = "מרכז העיר צפון";

function decodeDealData(text: string): any {
  try { return JSON.parse(text); } catch { /* try b64+gzip */ }
  try {
    const buf = Buffer.from(text.replace(/^"|"$/g, ""), "base64");
    const unz = zlib.gunzipSync(buf).toString("utf8");
    return JSON.parse(unz);
  } catch { return null; }
}

function num(v: any): number {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[^\d.]/g, "");
  return cleaned ? parseFloat(cleaned) : NaN;
}

const HEBREW_FLOOR: Record<string, number> = {
  מרתף: -1, מרתפית: -1, קרקע: 0, קרקעית: 0,
  ראשונה: 1, ראשון: 1, שנייה: 2, שניה: 2, שני: 2,
  שלישית: 3, שלישי: 3, רביעית: 4, רביעי: 4,
  חמישית: 5, חמישי: 5, שישית: 6, שישי: 6,
  שביעית: 7, שביעי: 7, שמינית: 8, שמיני: 8,
  תשיעית: 9, תשיעי: 9, עשירית: 10, עשירי: 10,
};
function parseFloor(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return HEBREW_FLOOR[s] ?? null;
}

function parseAddress(addr: string | null): { street: string | null; houseNumber: string | null } {
  if (!addr) return { street: null, houseNumber: null };
  const m = addr.trim().match(/^(.+?)\s+(\d+[א-ת]?)$/);
  if (m) return { street: m[1], houseNumber: m[2] };
  return { street: addr.trim(), houseNumber: null };
}

function classify(dealNature: string | null): "apartment" | "house" | "land" {
  const s = (dealNature || "").trim();
  if (/מגרש|קרקע|מקרקעין|חקלאי|נחלה/.test(s)) return "land";
  if (/דיר[הת]/.test(s)) return "apartment";
  if (/קוטג|צמוד|דו ?משפחת|וילה|חד ?משפחת/.test(s)) return "house";
  return "apartment";
}

function normalize(raw: any): any | null {
  const price = num(raw.dealAmount ?? raw.DEALAMOUNT ?? raw.price);
  if (!price || !Number.isFinite(price)) return null;
  const builtArea = num(raw.assetArea ?? raw.ASSETAREA ?? raw.dealNatureArea);
  const rooms = num(raw.roomNum ?? raw.assetRoomNum);
  const dateRaw = raw.dealDate ?? raw.DEALDATETIME ?? raw.dealDateTime;
  const dealDate = dateRaw ? new Date(dateRaw).toISOString().slice(0, 10) : "";
  const propertyType = classify(raw.dealNature ?? null);
  const isLand = propertyType === "land";
  const areaSqm = isLand ? null : Number.isFinite(builtArea) && builtArea > 0 ? builtArea : null;
  const p = parseAddress(raw.address ?? null);
  return {
    id: `${TAG_NEIGHBORHOOD_ID}-${raw.keyValue ?? raw.dealId ?? `${dealDate}-${price}-${builtArea}`}`,
    dealDate, price, propertyType,
    rooms: !isLand && Number.isFinite(rooms) ? rooms : null,
    areaSqm,
    floor: parseFloor(raw.floor ?? raw.floorNo ?? raw.FLOORNO),
    dealNature: raw.dealNature ?? null,
    address: raw.address ?? null, street: p.street, houseNumber: p.houseNumber,
    neighborhoodId: TAG_NEIGHBORHOOD_ID, neighborhood: TAG_NEIGHBORHOOD_NAME,
  };
}

interface PageEvent { seq: number; timestamp: string; itemsInResponse: number; runningTotal: number }

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const collected: any[] = [];
  const pageEvents: PageEvent[] = [];
  let last405 = false;
  let seq = 0;

  console.log("=== WAVE 0G-3 LIVE STREET-LEVEL FETCH (read-only, target: " + TARGET_STREET + ") ===");
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

  page.on("response", async (resp: any) => {
    const u = resp.url();
    if (u.includes("/deal-data")) {
      try {
        const body = await resp.text();
        const decoded = decodeDealData(body);
        if (decoded?.statusCode === 405) last405 = true;
        const items = decoded?.data?.items ?? decoded?.items ?? [];
        if (Array.isArray(items)) {
          collected.push(...items);
          seq++;
          pageEvents.push({ seq, timestamp: new Date().toISOString(), itemsInResponse: items.length, runningTotal: collected.length });
          console.log(`  [response ${seq}] +${items.length} items (running total: ${collected.length})`);
        }
      } catch (e) { console.log("  [response parse error] " + (e as Error).message); }
    }
  });

  try {
    await page.goto("https://www.nadlan.gov.il/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);
    const input = page.locator("input#myInput2, input.react-autosuggest__input").first();
    await input.fill(`${TARGET_STREET} נתניה`);
    await page.waitForTimeout(3000);

    // Mirror harvestByStreets(): prefer an exact-text suggestion, else any "street" (רחוב) suggestion.
    const exactOpt = page.locator("li", { hasText: TARGET_STREET }).filter({ hasText: "נתניה" }).first();
    const streetOpt = page.locator("li").filter({ hasText: "רחוב" }).filter({ hasText: "נתניה" }).first();
    let clicked = false;
    let clickedLabel = "";
    if (await exactOpt.count()) {
      clickedLabel = (await exactOpt.textContent() || "").trim();
      await exactOpt.click(); clicked = true;
    } else if (await streetOpt.count()) {
      clickedLabel = (await streetOpt.textContent() || "").trim();
      await streetOpt.click(); clicked = true;
    }
    if (!clicked) { await input.press("Enter"); clickedLabel = "(Enter — no suggestion matched)"; }
    console.log("SUGGESTION_CLICKED=" + clickedLabel);

    await page.waitForTimeout(3500);

    const MAX_SCROLL_ROUNDS = 250;
    const SCROLL_IDLE_ROUNDS = 5;
    let idleRounds = 0;
    let lastCount = 0;
    for (let round = 0; round < MAX_SCROLL_ROUNDS && !last405; round++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2500);
      if (collected.length === lastCount) {
        idleRounds++;
        if (idleRounds >= SCROLL_IDLE_ROUNDS) break;
      } else { idleRounds = 0; lastCount = collected.length; }
    }
  } catch (e) {
    console.log("NAVIGATION_ERROR=" + (e as Error).message);
  } finally {
    await ctx.close();
  }

  console.log("\nHARVEST_STOP_REASON=" + (last405 ? "405 reCAPTCHA rejection" : "scroll-idle (no new items for 5 consecutive rounds) or max rounds reached"));
  console.log("TOTAL_RAW_ROWS_RECEIVED=" + collected.length);
  console.log("RAW_RESPONSES=" + pageEvents.length);

  const seen = new Set<string>();
  const uniqueRaw: any[] = [];
  for (const r of collected) {
    const key = String(r.keyValue ?? r.dealId ?? JSON.stringify(r));
    if (!seen.has(key)) { seen.add(key); uniqueRaw.push(r); }
  }
  console.log("UNIQUE_RAW_TRANSACTIONS=" + uniqueRaw.length);
  console.log("DUPLICATES=" + (collected.length - uniqueRaw.length));

  const normalized = uniqueRaw.map((r) => normalize(r)).filter((d): d is any => !!d);

  const dates = normalized.map((d) => d.dealDate).filter(Boolean).sort();
  console.log("EARLIEST_DATE=" + (dates[0] ?? "N/A"));
  console.log("LATEST_DATE=" + (dates[dates.length - 1] ?? "N/A"));
  const houseNums = [...new Set(normalized.map((d) => d.houseNumber))].sort();
  console.log("DISTINCT_HOUSE_NUMBERS=" + JSON.stringify(houseNums));
  console.log("EXACTLY_500=" + (collected.length === 500));

  const slug = TARGET_STREET.replace(/[^֐-׿a-zA-Z0-9]+/g, "_");
  await fs.writeFile(path.join(OUT_DIR, `street_live_raw_items_${slug}.json`), JSON.stringify(collected, null, 2));
  await fs.writeFile(path.join(OUT_DIR, `street_live_normalized_${slug}.json`), JSON.stringify(normalized, null, 2));
  await fs.writeFile(path.join(OUT_DIR, `street_page_trace_${slug}.json`), JSON.stringify(pageEvents, null, 2));

  // Ben Ami 41 check
  const benAmiTargets = [
    { date: "2024-11-15", price: 280000, area: 65 },
    { date: "2023-06-21", price: 925000, area: 65 },
    { date: "2023-05-11", price: 680000, area: 45 },
    { date: "2023-04-20", price: 975000, area: 65 },
    { date: "2022-06-08", price: 232000, area: 45 },
  ];
  console.log("\n=== BEN AMI 41 CHECK (against live street-level raw + normalized) ===");
  for (const t of benAmiTargets) {
    const rawHit = collected.find((r) => {
      const d = (r.dealDate ?? r.DEALDATETIME ?? r.dealDateTime);
      const dd = d ? new Date(d).toISOString().slice(0, 10) : "";
      const p = num(r.dealAmount ?? r.DEALAMOUNT ?? r.price);
      const a = num(r.assetArea ?? r.ASSETAREA ?? r.dealNatureArea);
      return dd === t.date && p === t.price && Math.abs(a - t.area) < 1;
    });
    const normHit = normalized.find((d) => d.dealDate === t.date && d.price === t.price && Math.abs((d.areaSqm ?? 0) - t.area) < 1);
    console.log(`  ${t.date} / ₪${t.price} / ${t.area}sqm -> RAW_FOUND=${!!rawHit} RAW_HOUSE_NUMBER=${rawHit ? (rawHit.address ?? "N/A") : "N/A"} PARSED=${!!normHit}`);
    if (rawHit) console.log("    RAW_TRANSACTION_ID=" + (rawHit.keyValue ?? rawHit.dealId ?? "N/A") + " RAW_PROPERTY_TYPE=" + (rawHit.dealNature ?? "N/A"));
  }

  console.log("\nDONE");
}

main().catch((e) => { console.error("LIVE_FETCH_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
