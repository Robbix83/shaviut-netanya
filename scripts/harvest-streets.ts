/**
 * scripts/harvest-streets.ts  —  ארוסט ברמת רחוב (כתובת מלאה + מספר בית)
 * ---------------------------------------------------------------------------
 * בניגוד ל-harvest.ts שמחפש לפי שכונה, כאן מחפשים כל רחוב ספציפית.
 * חיפוש לפי רחוב מחזיר עסקאות עם fullAdress שכולל מספר בית.
 *
 * אסטרטגיה חכמה (לא 1,000 רחובות):
 *   1. רק רחובות שכבר מופיעים ב-deals.json (עסקאות קיימות)
 *   2. ממוין לפי מספר עסקאות — הרחובות הפעילים ביותר קודם
 *   3. 4 browsers במקביל → ~4x מהיר יותר
 *   4. HARVEST_TOP=50 להגביל לN רחובות (ברירת מחדל: 80)
 *
 * הרצה:
 *   npm run harvest:streets             # 80 רחובות פעילים
 *   HARVEST_TOP=30 npm run harvest:streets  # רק 30 רחובות
 *   DATA_SOURCE=supabase npm run harvest:streets
 *
 * זמן הרצה עם 4 workers: ~80 רחובות / 4 = 20 בכל פס × 35 שנ' = ~12 דקות
 * ---------------------------------------------------------------------------
 */
import { promises as fs } from "fs";
import path from "path";
import zlib from "zlib";
import type { Deal } from "../lib/types";

const SETTLEMENT   = "נתניה";
const DATA_DIR     = path.join(process.cwd(), "data");
const CONCURRENCY  = 4;   // browsers במקביל
const TOP_N        = Number(process.env.HARVEST_TOP ?? 80);
const POLITE_MS    = 2000; // המתנה בין רחובות לכל worker

// ─── קואורדינטות רחוב ───────────────────────────────────────────────────────
let streetCoords: Record<string, { x: number; y: number }> = {};
async function loadStreetCoords() {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, "street-index.json"), "utf8");
    const arr: any[] = JSON.parse(raw);
    for (const s of arr)
      if (s.street && typeof s.x === "number")
        streetCoords[s.street] = { x: s.x, y: s.y };
    console.log(`   📍 קואורדינטות: ${Object.keys(streetCoords).length} רחובות`);
  } catch { /* ריק */ }
}

// ─── פענוח deal-data ─────────────────────────────────────────────────────────
function decodeDealData(text: string): any {
  try { return JSON.parse(text); } catch { /* לא JSON */ }
  try {
    const buf = Buffer.from(text.replace(/^"|"$/g, ""), "base64");
    return JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
  } catch { return null; }
}

function num(v: any): number {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  return parseFloat(String(v).replace(/[^\d.]/g, "")) || NaN;
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

function classify(s: string | null): "apartment" | "house" | "land" {
  const t = (s || "").trim();
  if (/מגרש|קרקע|מקרקעין|חקלאי|נחלה/.test(t)) return "land";
  if (/דיר[הת]/.test(t)) return "apartment"; // דירה בבית קומות, דירת גג, דירת גן — לפני בדיקת בית
  if (/קוטג|צמוד|דו ?משפחת|וילה|חד ?משפחת/.test(t)) return "house";
  return "apartment";
}

interface StreetMeta { neighId: string; neighName: string; dealCount: number }

function normalize(raw: any, streetName: string, meta: StreetMeta): Deal | null {
  const price = num(raw.dealAmount ?? raw.DEALAMOUNT ?? raw.price);
  if (!price || !Number.isFinite(price)) return null;

  const builtArea = num(raw.assetArea ?? raw.ASSETAREA ?? raw.dealNatureArea);
  const plotArea  = num(raw.plotArea  ?? raw.landArea  ?? raw.parcelArea);
  const rooms     = num(raw.roomNum   ?? raw.assetRoomNum ?? raw.ROOMNUM);
  const dateRaw   = raw.dealDate ?? raw.DEALDATETIME ?? raw.dealDateTime;
  const dealDate  = dateRaw ? new Date(dateRaw).toISOString().slice(0, 10) : "";
  const ptype     = classify(raw.dealNature ?? null);
  const isLand    = ptype === "land";

  const areaSqm = isLand ? null : (Number.isFinite(builtArea) && builtArea > 0 ? builtArea : null);
  let plotSqm   = Number.isFinite(plotArea) && plotArea > 0 ? plotArea : null;
  if (isLand && !plotSqm && Number.isFinite(builtArea) && builtArea > 0) plotSqm = builtArea;

  const base = isLand ? plotSqm : areaSqm;
  const pricePerSqm = base && base > 0 ? Math.round(price / base) : null;

  const { street: parsedStreet, houseNumber: houseNum } = parseAddress(raw.address ?? null);
  const sName = parsedStreet ?? streetName;
  const coords = streetCoords[sName] ?? { x: null, y: null };

  return {
    id: `st-${meta.neighId}-${raw.keyValue ?? raw.dealId ?? `${dealDate}-${price}-${builtArea||plotArea}`}`,
    dealDate, price,
    propertyType: ptype,
    rooms: !isLand && Number.isFinite(rooms) ? rooms : null,
    areaSqm, plotSqm,
    floor:       parseFloor(raw.floor ?? raw.floorNo),
    yearBuilt:   raw.yearBuilt != null ? Number(raw.yearBuilt) : raw.buildingYear != null ? Number(raw.buildingYear) : null,
    dealNature:  raw.dealNature ?? null,
    address:     raw.address ?? null,
    houseNumber: houseNum,
    street:      sName,
    neighborhoodId: meta.neighId,
    neighborhood:   meta.neighName,
    settlement:  SETTLEMENT,
    x: coords.x, y: coords.y,
    pricePerSqm,
  };
}

// ─── ארוסט רחוב בודד (מריץ בתוך worker) ─────────────────────────────────────
async function harvestStreet(browser: any, streetName: string, meta: StreetMeta): Promise<Deal[]> {
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const collected: any[] = [];
  let last405 = false;

  const DEBUG = process.env.HARVEST_DEBUG === "true";

  page.on("response", async (resp: any) => {
    if (!resp.url().includes("/deal-data")) return;
    try {
      const decoded = decodeDealData(await resp.text());
      if (decoded?.statusCode === 405) { last405 = true; return; }
      const items = decoded?.data?.items ?? decoded?.items ?? [];
      if (Array.isArray(items)) {
        // DEBUG: הדפס שדות של עסקה ראשונה פעם אחת
        if (DEBUG && collected.length === 0 && items.length > 0) {
          const debugPath = path.join(process.cwd(), "data", "debug-raw-deal.json");
          require("fs").writeFileSync(debugPath, JSON.stringify(items[0], null, 2));
          console.log(`\n🔍 DEBUG — raw deal saved to ${debugPath}`);
          console.log("   שדות:", Object.keys(items[0]).join(", "));
        }
        collected.push(...items);
      }
    } catch { /* skip */ }
  });

  try {
    await page.goto("https://www.nadlan.gov.il/", { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForTimeout(2000);

    const input = page.locator("input#myInput2, input.react-autosuggest__input").first();
    await input.fill(`${streetName} נתניה`);
    await page.waitForTimeout(2200);

    // בחר הצעת "רחוב"
    const opt = page.locator("li", { hasText: streetName }).filter({ hasText: "רחוב" }).first();
    if (await opt.count() > 0) await opt.click();
    else await input.press("Enter");

    await page.waitForTimeout(3500);

    // גלילה
    let idle = 0, last = 0;
    for (let i = 0; i < 18 && !last405; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1800);
      if (collected.length === last) { if (++idle >= 3) break; }
      else { idle = 0; last = collected.length; }
    }
  } finally {
    await page.close();
  }

  if (last405) return [];
  return collected.map(r => normalize(r, streetName, meta)).filter((d): d is Deal => !!d);
}

// ─── worker: מעבד תור של רחובות ────────────────────────────────────────────
async function worker(
  browser: any,
  queue: Array<[string, StreetMeta]>,
  results: Map<string, Deal[]>,
  wid: number,
) {
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const [street, meta] = item;
    process.stdout.write(`   [w${wid}] 📍 ${street.padEnd(20)} ... `);
    try {
      const deals = await harvestStreet(browser, street, meta);
      results.set(street, deals);
      const hasHouseNum = deals.some(d => d.houseNumber);
      console.log(`${deals.length} עסקאות${hasHouseNum ? " (מס' בית ✓)" : ""}`);
    } catch (e) {
      console.log(`שגיאה`);
      results.set(street, []);
    }
    if (queue.length > 0) await new Promise(r => setTimeout(r, POLITE_MS));
  }
}

// ─── main ────────────────────────────────────────────────────────────────────
async function main() {
  let chromium: any;
  try { ({ chromium } = await import("playwright")); }
  catch { console.error("❌ Playwright לא מותקן"); process.exit(1); }

  await loadStreetCoords();

  // ─── בנה תור רחובות מסודר לפי פעילות ─────────────────────────────────────
  let existingDeals: Deal[] = [];
  try {
    existingDeals = JSON.parse(await fs.readFile(path.join(DATA_DIR, "deals.json"), "utf8"));
  } catch {
    console.error("❌ deals.json לא נמצא — הריצו 'npm run harvest' תחילה");
    process.exit(1);
  }

  // ספור עסקאות לכל רחוב
  const streetMeta = new Map<string, StreetMeta>();
  for (const d of existingDeals) {
    if (!d.street) continue;
    const m = streetMeta.get(d.street);
    if (m) m.dealCount++;
    else streetMeta.set(d.street, { neighId: d.neighborhoodId, neighName: d.neighborhood ?? "", dealCount: 1 });
  }

  // אם אין רחובות ב-deals.json — קח מ-street-index (רחובות עם קואורדינטות)
  if (streetMeta.size === 0) {
    console.log("⚠️  deals.json ללא רחובות — לוקח מ-street-index.json");
    try {
      const si: any[] = JSON.parse(await fs.readFile(path.join(DATA_DIR, "street-index.json"), "utf8"));
      for (const s of si)
        if (s.street && s.neighborhoodId && !streetMeta.has(s.street))
          streetMeta.set(s.street, { neighId: String(s.neighborhoodId), neighName: s.neighborhoodName ?? "", dealCount: 0 });
    } catch { /* skip */ }
  }

  // מיון: רחובות עם הכי הרבה עסקאות קודם (הכי שימושיים)
  const sortedStreets = [...streetMeta.entries()]
    .sort((a, b) => b[1].dealCount - a[1].dealCount)
    .slice(0, TOP_N);

  console.log(`\n🏘️  ארוסט ברמת רחוב — ${sortedStreets.length} רחובות פעילים (מתוך ${streetMeta.size})`);
  console.log(`   ⚡ ${CONCURRENCY} browsers במקביל`);
  const estMin = Math.ceil(sortedStreets.length / CONCURRENCY * 35 / 60);
  console.log(`   ⏱️  זמן משוער: ~${estMin} דקות\n`);

  // ─── פתח browsers עם פרופיל שמור (כמו harvest.ts — מונע חסימת reCAPTCHA) ────
  const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
    ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

  const browsers: any[] = [];
  const contexts: any[] = [];

  for (let i = 0; i < CONCURRENCY; i++) {
    try {
      const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
        channel: "chrome", headless: false, slowMo: 60,
        args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
      });
      contexts.push(ctx);
      // עטוף context כ-browser-like כדי שה-workers יוכלו לקרוא newPage()
      browsers.push({ newPage: () => ctx.newPage(), close: () => Promise.resolve() });
    } catch {
      // fallback: ללא פרופיל
      browsers.push(await chromium.launch({ headless: false, slowMo: 80 }));
      contexts.push(null);
    }
  }
  console.log(`   🌐 ${browsers.length} Chrome נפתחו (פרופיל: ${PROFILE_DIR})\n`);

  // ─── הפעל workers במקביל ──────────────────────────────────────────────────
  const queue = [...sortedStreets];
  const results = new Map<string, Deal[]>();

  await Promise.all(
    browsers.map((b, i) => worker(b, queue, results, i + 1))
  );

  for (const ctx of contexts) if (ctx) await ctx.close().catch(() => {});

  // ─── מיזוג לתוך deals.json ────────────────────────────────────────────────
  const allNew: Deal[] = [...results.values()].flat();
  if (allNew.length === 0) {
    console.warn("\n⚠️  לא נאספו עסקאות חדשות.");
    return;
  }

  const key = (d: Deal) =>
    `${d.street ?? ""}|${d.dealDate}|${d.price}|${d.areaSqm ?? d.plotSqm ?? ""}`;

  const mergeMap = new Map<string, Deal>();
  for (const d of existingDeals) mergeMap.set(key(d), d);

  let enriched = 0, added = 0;
  for (const d of allNew) {
    const k = key(d);
    if (mergeMap.has(k)) {
      const ex = mergeMap.get(k)!;
      if (!ex.houseNumber && d.houseNumber) { ex.houseNumber = d.houseNumber; enriched++; }
      if (!ex.address    && d.address)    ex.address = d.address;
    } else {
      mergeMap.set(k, d);
      added++;
    }
  }

  const merged = [...mergeMap.values()];

  if (process.env.DATA_SOURCE === "supabase") {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
    for (let i = 0; i < merged.length; i += 500)
      await sb.from("deals").upsert(merged.slice(i, i + 500));
    console.log(`\n✅ Supabase — ${enriched} עודכנו, ${added} חדשות`);
  } else {
    await fs.writeFile(path.join(DATA_DIR, "deals.json"), JSON.stringify(merged, null, 2));
    console.log(`\n✅ deals.json — ${enriched} קיבלו מספר בית, ${added} עסקאות חדשות`);
    console.log(`   סה"כ: ${merged.length} עסקאות`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
