/**
 * scripts/audit-wave0g7-shadow-harvest.ts — READ-ONLY shadow acquisition probe
 * for the NEW official-catalog discovery source (lib/nadlanCatalog.ts).
 *
 * Reuses the same real acquisition request/parser path established across
 * Waves 0G-2 through 0G-5 (duplicated, not imported, from scripts/harvest.ts,
 * which has no exports and is a standalone script) — this file does NOT
 * introduce a second independent harvester architecture, it is the same
 * shadow-diagnostic pattern already used and ECC-approved multiple times this
 * engagement, now parameterized by an official nadlan sourceId/name instead of
 * a hardcoded target.
 *
 * HARD GUARANTEES:
 *  - Never opens or writes data/deals.json.
 *  - Never touches Supabase.
 *  - Never writes any production/canonical checkpoint file.
 *  - Writes only under audit/wave0g7/.
 *
 * Usage:
 *   npx tsx scripts/audit-wave0g7-shadow-harvest.ts <sourceId> <label>
 *   e.g. npx tsx scripts/audit-wave0g7-shadow-harvest.ts 65210195 nof_hatayelet
 */
import { promises as fs } from "fs";
import path from "path";
import zlib from "zlib";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium: chromiumExtra } = require("playwright-extra");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromiumExtra.use(StealthPlugin());

const OUT_DIR = path.join(process.cwd(), "audit", "wave0g7");
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

function normalize(raw: any, sourceId: string, sourceName: string): any | null {
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
    id: `nadlan-${sourceId}-${raw.keyValue ?? raw.dealId ?? `${dealDate}-${price}-${builtArea}`}`,
    dealDate, price, propertyType,
    rooms: !isLand && Number.isFinite(rooms) ? rooms : null,
    areaSqm,
    floor: parseFloor(raw.floor ?? raw.floorNo ?? raw.FLOORNO),
    dealNature: raw.dealNature ?? null,
    address: raw.address ?? null, street: p.street, houseNumber: p.houseNumber,
    // Shadow-mode diagnostic model: preserves BOTH the raw upstream neighborhoodId
    // (proven present on every raw record, see audit/wave0g4) AND the source-native
    // catalog entity used to drive this specific query. Deliberately NOT written
    // into the app's existing Deal.neighborhoodId domain — see Phase 12 analysis.
    rawUpstreamNeighborhoodId: raw.neighborhoodId != null ? String(raw.neighborhoodId) : null,
    sourceEntityId: sourceId,
    sourceEntityName: sourceName,
    parcelNum: raw.parcelNum ?? null,
    addressId: raw.addressId != null ? String(raw.addressId) : null,
  };
}

interface PageEvent { seq: number; timestamp: string; itemsInResponse: number; runningTotal: number }

async function shadowHarvestOne(sourceId: string, sourceName: string) {
  const collected: any[] = [];
  const pageEvents: PageEvent[] = [];
  let last405 = false;
  let seq = 0;
  let navigationError: string | null = null;

  console.log(`\n=== SHADOW HARVEST: ${sourceName} (sourceId=${sourceId}) ===`);

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
    await input.fill(`${sourceName} נתניה`);
    await page.waitForTimeout(3000);

    const suggestions = await page.locator("li").allTextContents();
    console.log("SUGGESTIONS=" + JSON.stringify(suggestions.map((s) => s.trim().replace(/\s+/g, " "))));

    const exact = page.locator("li", { hasText: sourceName }).filter({ hasText: "שכונה" }).first();
    let clicked = false;
    let clickedLabel = "";
    if (await exact.count()) {
      clickedLabel = (await exact.textContent()) || "";
      await exact.click(); clicked = true;
    } else {
      const opt = page.locator("li").filter({ hasText: "שכונה" }).first();
      if (await opt.count()) {
        clickedLabel = (await opt.textContent()) || "";
        await opt.click(); clicked = true;
      }
    }
    if (!clicked) { console.log("NO_NEIGHBORHOOD_SUGGESTION_FOUND — falling back to Enter"); await input.press("Enter"); }
    else console.log("SUGGESTION_CLICKED=" + clickedLabel.trim().replace(/\s+/g, " "));

    await page.waitForTimeout(4000);

    const MAX_SCROLL_ROUNDS = 200;
    const SCROLL_IDLE_ROUNDS = 4;
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
    navigationError = (e as Error).message;
    console.log("NAVIGATION_ERROR=" + navigationError);
  } finally {
    await ctx.close();
  }

  const seen = new Set<string>();
  const uniqueRaw: any[] = [];
  for (const r of collected) {
    const key = String(r.keyValue ?? r.dealId ?? JSON.stringify(r));
    if (!seen.has(key)) { seen.add(key); uniqueRaw.push(r); }
  }
  const normalized = uniqueRaw.map((r) => normalize(r, sourceId, sourceName)).filter((d): d is any => !!d);

  const dates = normalized.map((d) => d.dealDate).filter(Boolean).sort();
  const streets = new Set(normalized.map((d) => d.street).filter(Boolean));

  // Self-diagnosing mismatch check: does the data actually returned carry the
  // SAME upstream neighborhoodId we asked for? The UI's name-typed search box
  // is proven (this wave) NOT to guarantee this — silently trusting a "success"
  // result without this check would recreate exactly the silent-mismatch defect
  // this whole investigation exists to eliminate.
  const distinctUpstreamIds = [...new Set(normalized.map((d: any) => d.rawUpstreamNeighborhoodId).filter(Boolean))];
  const matchingRowCount = normalized.filter((d: any) => d.rawUpstreamNeighborhoodId === sourceId).length;
  // Deliberately NOT `.includes(sourceId)` — that would only check that SOME row
  // matches, silently accepting a MIXED batch (e.g. 5 correct rows buried among
  // 495 contaminated ones) as a clean success. Every row must match.
  const idMismatch = normalized.length > 0 && matchingRowCount !== normalized.length;

  let requestValid = !last405 && !navigationError;
  let error: string | null = navigationError ?? (last405 ? "405 reCAPTCHA rejection" : null);
  if (requestValid && collected.length === 0) {
    requestValid = false;
    error = "NO_SUGGESTION_OR_EMPTY_RESULT — no matching autocomplete suggestion was found for this name, or the site genuinely returned zero rows; these are NOT distinguished as a success";
  } else if (requestValid && idMismatch) {
    requestValid = false;
    error = `ID_MISMATCH — requested sourceId=${sourceId} but only ${matchingRowCount}/${normalized.length} returned rows carry that rawUpstreamNeighborhoodId (distinct ids present: ${JSON.stringify(distinctUpstreamIds)}) — the name-typed search box resolved to a DIFFERENT (or MIXED) entity set than requested`;
  }

  const summary = {
    sourceId, sourceName,
    requestValid,
    error,
    idMismatch,
    matchingRowCount,
    totalRowCount: normalized.length,
    distinctUpstreamNeighborhoodIds: distinctUpstreamIds,
    rawRows: collected.length,
    uniqueRows: uniqueRaw.length,
    earliestDate: dates[0] ?? null,
    latestDate: dates[dates.length - 1] ?? null,
    distinctStreetsCount: streets.size,
  };
  console.log("SUMMARY=" + JSON.stringify(summary, null, 2));

  return { summary, normalized, pageEvents };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const sourceId = process.argv[2];
  const labelArg = process.argv[3];
  if (!sourceId || !labelArg) {
    console.error("Usage: npx tsx scripts/audit-wave0g7-shadow-harvest.ts <sourceId> <label> [sourceName]");
    process.exit(1);
  }
  const sourceName = process.argv[4] ?? labelArg;

  const { summary, normalized, pageEvents } = await shadowHarvestOne(sourceId, sourceName);

  await fs.writeFile(path.join(OUT_DIR, `${labelArg}_shadow.json`), JSON.stringify({ summary, normalized, pageEvents }, null, 2));

  // Ben Ami 41 check, only meaningful for the נוף הטיילת target — harmless no-op elsewhere.
  const benAmiTargets = [
    { date: "2024-11-15", price: 280000 }, { date: "2023-06-21", price: 925000 },
    { date: "2023-05-11", price: 680000 }, { date: "2023-04-20", price: 975000 },
    { date: "2022-06-08", price: 232000 }, { date: "2022-05-29", price: 460000 },
    { date: "2022-02-23", price: 718000 },
  ];
  const benAmiRows = normalized.filter((d: any) => (d.address ?? "").includes("בן עמי") && (d.address ?? "").includes("41"));
  const known7Found = benAmiTargets.filter((t) => normalized.some((d: any) => d.dealDate === t.date && d.price === t.price)).length;
  console.log(`\nBEN_AMI_41_ROWS=${benAmiRows.length} KNOWN_7_FOUND=${known7Found}/7`);

  console.log("\nDONE (shadow-only, no canonical writes, no Supabase writes)");
}

main().catch((e) => { console.error("SHADOW_HARVEST_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
