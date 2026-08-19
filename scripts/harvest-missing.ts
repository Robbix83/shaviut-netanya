/**
 * scripts/harvest-missing.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * מוצא את כל הרחובות שחסרים לחלוטין מ-deals.json ומשאב אותם מ-nadlan.gov.il.
 *
 * למה זה נחוץ?
 *   street-index.json מכיל 196 רחובות עם neighborhoodId "פנטום" (66239238/88/42/58/89)
 *   שלא קיים ב-deals.json — הסריקה הרגילה מחמיצה אותם לחלוטין.
 *   הרב קוק לבדו יש 54 עמודי עסקאות ב-nadlan ואין לנו אפילו אחת.
 *
 * מה הסקריפט עושה?
 *   1. מזהה כל רחוב מ-street-index שאין לו אף עסקה ב-deals.json
 *   2. ממפה neighborhoodId פנטום → ID אמיתי (לפי קואורדינטות)
 *   3. שואב כל רחוב ישירות מ-nadlan.gov.il (חיפוש לפי שם)
 *   4. שומר תוספת ל-deals.json כל 5 רחובות (בטוח להפסיק ולהמשיך)
 *
 * הרצה:
 *   npm run harvest:missing
 *   SKIP_EXISTING=false npm run harvest:missing   # סורק גם רחובות עם מעט עסקאות
 *   ONLY_STREET="הרב קוק" npm run harvest:missing  # רחוב אחד בלבד
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { promises as fs } from "fs";
import * as path from "path";
import * as zlib from "zlib";
import type { Deal, Neighborhood } from "../lib/types";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium: chromiumExtra } = require("playwright-extra");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromiumExtra.use(StealthPlugin());

const DATA_DIR   = path.join(process.cwd(), "data");
const DEALS_FILE = path.join(DATA_DIR, "deals.json");

// ── מיפוי neighborhoodId פנטום → ID אמיתי (חושב לפי מרחק קואורדינטות) ──
const PHANTOM_TO_REAL: Record<string, string> = {
  "66239238": "66239254",  // צפון מערב מרכז העיר → מרכז העיר צפון
  "66239288": "66239231",  // כוכב הים → נוף הטיילת
  "66239289": "65867837",  // גלי הים → נאות שקד
  "66239258": "66239260",  // רמת פולג → עיר ימים
  "66239242": "65867837",  // רמת ידין → נאות שקד
};

const POLITE_DELAY_MS   = 3500;
const MAX_SCROLL_ROUNDS = 200;   // ← מספיק ל-54+ עמודים
const SCROLL_IDLE_WAIT  = 2500;
const IDLE_ROUNDS_STOP  = 4;
const SAVE_EVERY        = 5;     // שמור כל N רחובות

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── טעינת נתונים ──────────────────────────────────────────────────────────
async function loadData() {
  const [indexRaw, dealsRaw, neighRaw] = await Promise.all([
    fs.readFile(path.join(DATA_DIR, "street-index.json"), "utf8"),
    fs.readFile(DEALS_FILE, "utf8").catch(() => "[]"),
    fs.readFile(path.join(DATA_DIR, "neighborhoods.json"), "utf8").catch(() => "[]"),
  ]);
  return {
    streetIndex: JSON.parse(indexRaw) as any[],
    existingDeals: JSON.parse(dealsRaw) as Deal[],
    neighborhoods: JSON.parse(neighRaw) as Neighborhood[],
  };
}

// ── מחשב איזה רחובות חסרים ────────────────────────────────────────────────
function findMissingStreets(streetIndex: any[], existingDeals: Deal[]): any[] {
  const dealsPerStreet = new Map<string, number>();
  for (const d of existingDeals) {
    if (d.street) dealsPerStreet.set(d.street, (dealsPerStreet.get(d.street) ?? 0) + 1);
  }
  const skipExisting = process.env.SKIP_EXISTING !== "false";
  const onlyStreet   = process.env.ONLY_STREET;

  // ייחודיים: רחוב אחד אפילו אם מופיע בשתי שכונות ב-index
  const seen = new Set<string>();
  const missing: any[] = [];
  for (const s of streetIndex) {
    if (!s.street || !s.neighborhoodId) continue;
    if (onlyStreet && s.street !== onlyStreet) continue;
    if (seen.has(s.street)) continue;
    seen.add(s.street);
    const count = dealsPerStreet.get(s.street) ?? 0;
    if (skipExisting && count >= 5) continue;   // כבר יש עסקאות — דלג
    missing.push({ ...s, existingCount: count });
  }
  return missing;
}

// ── מחזיר את ה-neighborhoodId האמיתי (מפה פנטום אם צריך) ─────────────────
function realNeighId(phantomId: string): string {
  return PHANTOM_TO_REAL[String(phantomId)] ?? String(phantomId);
}

// ── Playwright: פרסור deal-data ───────────────────────────────────────────
function decodeDealData(text: string): any {
  try { return JSON.parse(text); } catch {}
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
  מרתף: -1, קרקע: 0, קרקעית: 0,
  ראשונה: 1, ראשון: 1, שנייה: 2, שניה: 2, שני: 2,
  שלישית: 3, שלישי: 3, רביעית: 4, רביעי: 4,
  חמישית: 5, חמישי: 5, שישית: 6, שישי: 6,
  שביעית: 7, שביעי: 7, שמינית: 8, שמיני: 8,
  תשיעית: 9, עשירית: 10,
};
function parseFloor(v: any): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return HEBREW_FLOOR[s] ?? null;
}

function parseAddress(addr: string | null) {
  if (!addr) return { street: null, houseNumber: null };
  const m = addr.trim().match(/^(.+?)\s+(\d+[א-ת]?)$/);
  return m ? { street: m[1], houseNumber: m[2] } : { street: addr.trim(), houseNumber: null };
}

function classify(dealNature: string | null): "apartment" | "house" | "land" {
  const s = (dealNature || "").trim();
  if (/מגרש|קרקע|מקרקעין|חקלאי/.test(s)) return "land";
  if (/דיר[הת]/.test(s)) return "apartment";
  if (/קוטג|צמוד|דו ?משפחת|וילה|חד ?משפחת/.test(s)) return "house";
  return "apartment";
}

function normalizeRaw(raw: any, n: Neighborhood, streetX: number | null, streetY: number | null): Deal | null {
  const price = num(raw.dealAmount ?? raw.DEALAMOUNT ?? raw.price);
  if (!price || !Number.isFinite(price)) return null;
  const builtArea = num(raw.assetArea ?? raw.ASSETAREA ?? raw.dealNatureArea);
  const plotArea  = num(raw.plotArea ?? raw.landArea ?? raw.parcelArea ?? raw.gushArea);
  const rooms     = num(raw.roomNum ?? raw.assetRoomNum);
  const dateRaw   = raw.dealDate ?? raw.DEALDATETIME ?? raw.dealDateTime;
  const dealDate  = dateRaw ? new Date(dateRaw).toISOString().slice(0, 10) : "";
  const propertyType = classify(raw.dealNature ?? null);
  const isLand = propertyType === "land";
  const areaSqm = isLand ? null : Number.isFinite(builtArea) && builtArea > 0 ? builtArea : null;
  let plotSqm: number | null = Number.isFinite(plotArea) && plotArea > 0 ? plotArea : null;
  if (isLand && plotSqm == null && Number.isFinite(builtArea) && builtArea > 0) plotSqm = builtArea;
  const ppsqmBase = isLand ? plotSqm : areaSqm;
  const pricePerSqm = ppsqmBase && ppsqmBase > 0 ? Math.round(price / ppsqmBase) : null;
  const addr = parseAddress(raw.address ?? null);

  return {
    id: `${n.id}-${raw.keyValue ?? raw.dealId ?? `${dealDate}-${price}-${builtArea || plotArea}`}`,
    dealDate,
    price,
    propertyType,
    rooms: !isLand && Number.isFinite(rooms) ? rooms : null,
    areaSqm,
    plotSqm,
    floor: parseFloor(raw.floor ?? raw.floorNo ?? raw.FLOORNO),
    yearBuilt: raw.yearBuilt != null ? Number(raw.yearBuilt) : raw.buildingYear != null ? Number(raw.buildingYear) : null,
    dealNature: raw.dealNature ?? null,
    address: raw.address ?? null,
    street: addr.street,
    houseNumber: addr.houseNumber,
    neighborhoodId: n.id,
    neighborhood: n.name,
    settlement: "נתניה",
    x: streetX ?? n.x,
    y: streetY ?? n.y,
    pricePerSqm,
  };
}

// ── שאיבת רחוב בודד מ-nadlan ──────────────────────────────────────────────
async function harvestStreet(browser: any, streetName: string, neigh: Neighborhood, streetX: number | null, streetY: number | null): Promise<{ deals: Deal[]; status: string }> {
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const collected: any[] = [];
  let got405 = false;
  page.on("response", async (resp: any) => {
    if (resp.url().includes("/deal-data")) {
      try {
        const body = await resp.text();
        const dec  = decodeDealData(body);
        if (dec?.statusCode === 405) got405 = true;
        const items = dec?.data?.items ?? dec?.items ?? [];
        if (Array.isArray(items)) collected.push(...items);
      } catch {}
    }
  });

  try {
    await page.goto("https://www.nadlan.gov.il/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);

    const input = page.locator("input#myInput2, input.react-autosuggest__input").first();
    await input.fill(`${streetName} נתניה`);
    await page.waitForTimeout(3000);

    // נסה לבחור הצעת "רחוב"
    const exactOpt  = page.locator("li", { hasText: streetName }).filter({ hasText: "נתניה" }).first();
    const streetOpt = page.locator("li").filter({ hasText: "רחוב" }).filter({ hasText: "נתניה" }).first();
    if (await exactOpt.count())  { await exactOpt.click(); }
    else if (await streetOpt.count()) { await streetOpt.click(); }
    else { await input.press("Enter"); }

    await page.waitForTimeout(3500);

    // גלול עד שאין עסקאות חדשות
    let idleRounds = 0, lastCount = 0;
    for (let round = 0; round < MAX_SCROLL_ROUNDS && !got405; round++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(SCROLL_IDLE_WAIT);
      if (collected.length === lastCount) {
        idleRounds++;
        if (idleRounds >= IDLE_ROUNDS_STOP) break;
      } else {
        idleRounds = 0;
        lastCount  = collected.length;
      }
    }
  } finally {
    await page.close();
  }

  if (got405 && collected.length === 0) return { deals: [], status: "reCAPTCHA" };

  const seen = new Set<string>();
  const deals = collected
    .map((r) => normalizeRaw(r, neigh, streetX, streetY))
    .filter((d): d is Deal => !!d)
    .filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));

  return { deals, status: `${deals.length} עסקאות` };
}

// ── שמירה תוספת ────────────────────────────────────────────────────────────
async function appendToDeals(newDeals: Deal[]) {
  if (newDeals.length === 0) return;
  const existing: Deal[] = JSON.parse(await fs.readFile(DEALS_FILE, "utf8").catch(() => "[]"));
  const existingIds = new Set(existing.map((d) => d.id));
  const fresh = newDeals.filter((d) => !existingIds.has(d.id));
  if (fresh.length === 0) return;
  await fs.writeFile(DEALS_FILE, JSON.stringify([...existing, ...fresh], null, 2));
  return fresh.length;
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("📂 טוען נתונים...");
  const { streetIndex, existingDeals, neighborhoods } = await loadData();
  const neighById = new Map(neighborhoods.map((n) => [n.id, n]));

  const missing = findMissingStreets(streetIndex, existingDeals);
  if (missing.length === 0) {
    console.log("✅ אין רחובות חסרים — הכל עדכני!");
    return;
  }
  console.log(`\n🔎 נמצאו ${missing.length} רחובות ללא עסקאות בדאטאבייס:`);
  console.log(`   (מתוך ${new Set(streetIndex.map((s:any)=>s.street)).size} רחובות ב-street-index)\n`);

  const headless  = process.env.HARVEST_HEADLESS === "true";
  const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
    ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");
  await fs.mkdir(PROFILE_DIR, { recursive: true });

  let browser: any;
  try {
    const { chromium: pw } = await import("playwright");
    const ctx = await pw.launchPersistentContext(PROFILE_DIR, {
      channel: "chrome", headless, slowMo: headless ? 0 : 80,
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    });
    browser = { newPage: () => ctx.newPage(), close: () => ctx.close() };
    console.log(`🌐 Chrome עם פרופיל שמור (${PROFILE_DIR})\n`);
  } catch (e) {
    console.error(`❌ לא ניתן לפתוח Chrome: ${(e as Error).message}`);
    process.exit(1);
  }

  let totalNew = 0, totalSkip = 0, totalFail = 0;
  const batch: Deal[] = [];

  for (let i = 0; i < missing.length; i++) {
    const s      = missing[i];
    const nidRaw = String(s.neighborhoodId);
    const nidReal = realNeighId(nidRaw);
    const neigh: Neighborhood = neighById.get(nidReal) ?? {
      id: nidReal, name: s.neighborhoodName ?? s.street,
      settlement: "נתניה", x: s.x ?? null, y: s.y ?? null,
    };

    const progress = `[${i + 1}/${missing.length}]`;
    process.stdout.write(`${progress} ${s.street} (${neigh.name}) ... `);

    try {
      const { deals, status } = await harvestStreet(browser, s.street, neigh, s.x ?? null, s.y ?? null);
      batch.push(...deals);
      console.log(status);

      if (deals.length > 0) totalNew += deals.length;
      else if (status === "reCAPTCHA") { totalFail++; }
      else totalSkip++;

      // שמור כל SAVE_EVERY רחובות
      if (batch.length > 0 && (i + 1) % SAVE_EVERY === 0) {
        const added = await appendToDeals(batch);
        batch.length = 0;
        if (added) console.log(`   💾 נשמרו ${added} עסקאות חדשות (סה"כ ${totalNew})`);
      }
    } catch (e) {
      console.log(`שגיאה: ${(e as Error).message.slice(0, 60)}`);
      totalFail++;
    }

    await sleep(POLITE_DELAY_MS);
  }

  // שמירה סופית
  if (batch.length > 0) {
    const added = await appendToDeals(batch);
    if (added) console.log(`\n💾 נשמרו ${added} עסקאות נוספות`);
  }

  await browser.close();

  console.log(`
═══════════════════════════════════════
✅ סיום harvest-missing
   עסקאות חדשות:  ${totalNew}
   ריקים/לא נמצאו: ${totalSkip}
   כשלונות:        ${totalFail}
═══════════════════════════════════════`);
}

main().catch((e) => { console.error(e); process.exit(1); });
