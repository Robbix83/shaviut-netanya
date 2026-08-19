/**
 * scripts/harvest.ts  —  אספן עסקאות נתניה (מריצים אחת לחודש)
 * ---------------------------------------------------------------------------
 * מדוע Playwright? נתוני העסקאות של nadlan.gov.il מוגנים ב-reCAPTCHA v3 +
 * הגבלת-קצב, וקבצי ה-S3 הישירים נעולים. הדרך היציבה היא להפעיל דפדפן אמיתי
 * שמבצע את אותו זרימה כמו משתמש — האתר פותר את ה-reCAPTCHA בעצמו — ואנחנו
 * מיירטים את תגובת ה-/deal-data, מפענחים (gzip+base64), ומנרמלים ל-DB שלנו.
 *
 * זה רץ בנפח נמוך (נתניה בלבד, ~10-40 שכונות, פעם בחודש) ובקצב מנומס.
 *
 * דרישות מקדימות (פעם אחת):
 *    npm i -D playwright
 *    npx playwright install chromium
 *
 * הרצה:
 *    npm run harvest                # כותב ל-data/deals.json (DATA_SOURCE=local)
 *    DATA_SOURCE=supabase npm run harvest   # כותב ל-Supabase (כשמוגדר)
 * ---------------------------------------------------------------------------
 */
import { promises as fs } from "fs";
import path from "path";
import zlib from "zlib";
import type { Deal, Neighborhood } from "../lib/types";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium: chromiumExtra } = require("playwright-extra");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromiumExtra.use(StealthPlugin());

const SETTLEMENT = "נתניה";
const ES_BASE = "https://es.govmap.gov.il/TldSearch";
const POLITE_DELAY_MS = 4000; // המתנה מנומסת בין שכונות/רחובות

// קואורדינטות רחוב מ-street-index.json (נטען פעם אחת לפני האיסוף)
let streetCoords: Record<string, { x: number; y: number }> = {};
async function loadStreetCoords() {
  try {
    const raw = await fs.readFile(
      path.join(process.cwd(), "data", "street-index.json"),
      "utf8",
    );
    const arr: any[] = JSON.parse(raw);
    for (const s of arr) {
      if (s.street && typeof s.x === "number" && typeof s.y === "number") {
        streetCoords[s.street] = { x: s.x, y: s.y };
      }
    }
    console.log(`   📍 נטענו קואורדינטות ל-${Object.keys(streetCoords).length} רחובות`);
  } catch {
    console.warn("   ⚠️  street-index.json לא נמצא — עסקאות יקבלו קואורדינטת מרכז-שכונה");
  }
}

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.nadlan.gov.il/",
  Origin: "https://www.nadlan.gov.il",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** מגלה את שכונות נתניה + מזהי UNIQ_ID + מרכזים גאוגרפיים (מקור ציבורי, ללא reCAPTCHA) */
async function discoverNeighborhoods(): Promise<Neighborhood[]> {
  // DetailsByQuery על שם היישוב מחזיר שכבת שכונות; אפשר גם לעבור על אותיות א-ת.
  // כאן מימוש פשוט: שאילתת "<שם שכונה> נתניה" לרשימת שכונות ידועה מראש, או הרחבה
  // בעתיד דרך autocomplete. מחזיר מה שנמצא.
  // 19 שכונות נתניה שאומתו מול ה-API (scripts/discover-neighborhoods.ts)
  // 23 השכונות הרשמיות לפי עיריית נתניה + שכונות ידועות לפי ID
  // https://www.netanya.muni.il/City/NB/Neighborhoods/Pages/default.aspx
  const SEED_NAMES = [
    "אגמים", "עין התכלת", "עיר ימים", "גלי ים", "גבעת האירוסים",
    "קריית השרון", "קריית נורדאו", "קריית רבין", "קריית צאנז",
    "אופק הים", "כוכב הצפון", "משכנות זבולון", "נאות גנים",
    "נאות הרצל", "נאות שקד", "נווה איתמר", "נוף השרון", "נוף הטיילת",
    "פרדס הגדוד", "רמת חן", "רמת אפרים",
    // מרכז העיר: nadlan מכיר "מרכז העיר צפון" (לא "צפון-מזרח") ו"מרכז העיר דרום"
    "מרכז העיר צפון", "מרכז העיר דרום",
  ];

  // שכונות שה-API לא מכיר לפי שם — נוסיף לפי ID ישירות מ-neighborhoods.json
  const existingNeighborhoods: Neighborhood[] = (() => {
    try { return JSON.parse(require("fs").readFileSync(require("path").join(process.cwd(), "data", "neighborhoods.json"), "utf8")); }
    catch { return []; }
  })();
  const out: Neighborhood[] = [];
  for (const name of SEED_NAMES) {
    const url = `${ES_BASE}/api/DetailsByQuery?query=${encodeURIComponent(name + " נתניה")}&lyrs=4&gid=nadlan`;
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) continue;
      const ctype = res.headers.get("content-type") || "";
      if (!ctype.includes("json")) continue;
      const j: any = await res.json();
      const hit = j?.data?.NEIGHBORHOOD?.[0];
      if (hit?.ObjectID) {
        out.push({
          id: String(hit.ObjectID),
          name,
          settlement: SETTLEMENT,
          x: hit.X ?? null,
          y: hit.Y ?? null,
        });
      }
    } catch {
      /* דלג */
    }
    await sleep(800);
  }

  // מיזוג שכונות ידועות לפי ID (שה-API לא מכיר לפי שם)
  for (const n of existingNeighborhoods) {
    if (!out.find((o) => o.id === n.id)) {
      out.push(n);
    }
  }

  return out;
}

/** מפענח את גוף /deal-data (מחרוזת base64+gzip) למבנה {data:{items:[...]}} */
function decodeDealData(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    /* לא JSON גולמי — ננסה base64+gzip */
  }
  try {
    const buf = Buffer.from(text.replace(/^"|"$/g, ""), "base64");
    const unz = zlib.gunzipSync(buf).toString("utf8");
    return JSON.parse(unz);
  } catch {
    return null;
  }
}

/** מנקה מספר ממחרוזת ("3,251,000 ₪" → 3251000) */
function num(v: any): number {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[^\d.]/g, "");
  return cleaned ? parseFloat(cleaned) : NaN;
}

/** ממיר קומה עברית למספר: "שישית" → 6, "קרקע" → 0 */
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

/** מפרסר "שם רחוב 12" → { street, houseNumber } */
function parseAddress(addr: string | null): { street: string | null; houseNumber: string | null } {
  if (!addr) return { street: null, houseNumber: null };
  const m = addr.trim().match(/^(.+?)\s+(\d+[א-ת]?)$/);
  if (m) return { street: m[1], houseNumber: m[2] };
  return { street: addr.trim(), houseNumber: null };
}

/** מסווג סוג נכס מתוך תיאור העסקה (dealNature) */
function classify(dealNature: string | null): "apartment" | "house" | "land" {
  const s = (dealNature || "").trim();
  if (/מגרש|קרקע|מקרקעין|חקלאי|נחלה/.test(s)) return "land";
  if (/דיר[הת]/.test(s)) return "apartment"; // דירה בבית קומות, דירת גג, דירת גן — לפני בדיקת בית
  if (/קוטג|צמוד|דו ?משפחת|וילה|חד ?משפחת/.test(s)) return "house";
  return "apartment";
}

/** ממפה רשומת עסקה גולמית של נדל"ן ל-Deal מנורמל */
function normalize(raw: any, n: Neighborhood): Deal | null {
  const price = num(raw.dealAmount ?? raw.DEALAMOUNT ?? raw.price);
  if (!price || !Number.isFinite(price)) return null;
  const builtArea = num(raw.assetArea ?? raw.ASSETAREA ?? raw.dealNatureArea);
  const plotArea = num(raw.plotArea ?? raw.landArea ?? raw.parcelArea ?? raw.gushArea);
  const rooms = num(raw.roomNum ?? raw.assetRoomNum);
  const dateRaw = raw.dealDate ?? raw.DEALDATETIME ?? raw.dealDateTime;
  const dealDate = dateRaw ? new Date(dateRaw).toISOString().slice(0, 10) : "";
  const propertyType = classify(raw.dealNature ?? null);

  // לקרקע: השטח הוא שטח המגרש; לדירה/בית: שטח בנוי (+ מגרש אם קיים).
  const isLand = propertyType === "land";
  const areaSqm = isLand ? null : Number.isFinite(builtArea) && builtArea > 0 ? builtArea : null;
  let plotSqm: number | null = Number.isFinite(plotArea) && plotArea > 0 ? plotArea : null;
  if (isLand && plotSqm == null && Number.isFinite(builtArea) && builtArea > 0) plotSqm = builtArea;

  // מחיר למ"ר: לקרקע לפי מגרש, אחרת לפי שטח בנוי
  const ppsqmBase = isLand ? plotSqm : areaSqm;
  const pricePerSqm = ppsqmBase && ppsqmBase > 0 ? Math.round(price / ppsqmBase) : null;

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
    // כתובת: השדה האמיתי הוא "address" בפורמט "שם רחוב מספר"
    ...(() => { const p = parseAddress(raw.address ?? null); return { address: raw.address ?? null, street: p.street, houseNumber: p.houseNumber }; })(),
    neighborhoodId: n.id,
    neighborhood: n.name,
    settlement: SETTLEMENT,
    // קואורדינטות ברמת רחוב (אם ידועות) — חיוני לסינון בניין/רחוב בחישוב השווי
    ...(raw.streetName && streetCoords[raw.streetName]
      ? streetCoords[raw.streetName]
      : { x: n.x, y: n.y }),
    pricePerSqm,
  };
}

/** פותח דף חדש עם listener ל-deal-data — משמש לשתי שיטות השאיבה */
async function openPageWithListener(browser: any): Promise<{ page: any; collected: any[]; last405Ref: { v: boolean } }> {
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const collected: any[] = [];
  const last405Ref = { v: false };
  page.on("response", async (resp: any) => {
    const u = resp.url();
    if (u.includes("/deal-data")) {
      try {
        const body = await resp.text();
        const decoded = decodeDealData(body);
        if (decoded?.statusCode === 405) last405Ref.v = true;
        const items = decoded?.data?.items ?? decoded?.items ?? [];
        if (Array.isArray(items)) collected.push(...items);
      } catch { /* התעלם */ }
    }
  });
  return { page, collected, last405Ref };
}

/** גלילה עד שאין עסקאות חדשות */
async function scrollUntilDone(page: any, collected: any[], last405Ref: { v: boolean }) {
  const MAX_SCROLL_ROUNDS = 200;   // ← הוגדל מ-24 כדי לכסות רחובות עם 50+ עמודים
  const SCROLL_IDLE_ROUNDS = 4;   // ← הוגדל מ-3 לוידוא שאכן אין עוד
  let idleRounds = 0;
  let lastCount = 0;
  for (let round = 0; round < MAX_SCROLL_ROUNDS && !last405Ref.v; round++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2500);
    if (collected.length === lastCount) {
      idleRounds++;
      if (idleRounds >= SCROLL_IDLE_ROUNDS) break;
    } else { idleRounds = 0; lastCount = collected.length; }
  }
}

/**
 * שאיבה לפי רחוב — לשכונות שnadlan לא מכיר לפי שם (כמו מרכז העיר צפון).
 * מחפש כל רחוב של השכונה בנפרד ואוסף את כל העסקאות.
 */
async function harvestByStreets(browser: any, n: Neighborhood): Promise<Deal[]> {
  // טען רחובות ייחודיים של השכונה מ-street-index.json
  let streetNames: string[] = [];
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "data", "street-index.json"), "utf8");
    const arr: any[] = JSON.parse(raw);
    const seen = new Set<string>();
    for (const s of arr) {
      if (String(s.neighborhoodId) === String(n.id) && s.street && !seen.has(s.street)) {
        seen.add(s.street);
        streetNames.push(s.street);
      }
    }
  } catch { /* אין street-index */ }

  if (streetNames.length === 0) {
    console.log("אין רחובות ב-street-index עבור שכונה זו");
    return [];
  }
  console.log(`   📋 ${streetNames.length} רחובות ייחודיים`);

  const allCollected: any[] = [];

  for (const streetName of streetNames) {
    process.stdout.write(`      🏘️  ${streetName} ... `);
    const { page, collected, last405Ref } = await openPageWithListener(browser);
    try {
      await page.goto("https://www.nadlan.gov.il/", { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2500);
      const input = page.locator("input#myInput2, input.react-autosuggest__input").first();
      await input.fill(`${streetName} נתניה`);
      await page.waitForTimeout(3000);

      // חפש הצעה מסוג "רחוב" (לא "שכונה" ולא "עיר")
      const streetOpt = page.locator("li").filter({ hasText: "רחוב" }).filter({ hasText: "נתניה" }).first();
      const exactOpt  = page.locator("li", { hasText: streetName }).filter({ hasText: "נתניה" }).first();
      if (await exactOpt.count()) {
        await exactOpt.click();
      } else if (await streetOpt.count()) {
        await streetOpt.click();
      } else {
        // אין הצעה — נסה Enter
        await input.press("Enter");
      }

      await page.waitForTimeout(3500);
      await scrollUntilDone(page, collected, last405Ref);

      if (last405Ref.v && collected.length === 0) {
        console.log("405 (reCAPTCHA)");
      } else {
        console.log(`${collected.length} עסקאות`);
        allCollected.push(...collected);
      }
    } catch (e) {
      console.log(`שגיאה (${(e as Error).message})`);
    } finally {
      await page.close();
    }
    await sleep(POLITE_DELAY_MS);
  }

  // נרמול — מתייג את כולן לשכונה הנכונה
  const seen = new Set<string>();
  return allCollected
    .map((r) => normalize(r, n))
    .filter((d): d is Deal => !!d)
    .filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
}

async function harvestNeighborhood(browser: any, n: Neighborhood): Promise<Deal[]> {
  const { page, collected, last405Ref } = await openPageWithListener(browser);

  // ניווט דרך החיפוש של האתר — כך ה-SPA מגיע לעמוד הנכון ויורה deal-data עם טוקן תקין
  await page.goto("https://www.nadlan.gov.il/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3000);
  const input = page.locator("input#myInput2, input.react-autosuggest__input").first();
  const shortName = n.name.replace(/\s*(צפון|דרום|מזרח|מערב)\s*/g, " ").trim();
  const searchTerms = [n.name, shortName];
  let clicked = false;
  for (const term of [...new Set(searchTerms)]) {
    await input.fill(`${term} נתניה`);
    await page.waitForTimeout(3000);
    const suggestions = await page.locator("li").filter({ hasText: "שכונה" }).allTextContents();
    if (suggestions.length) {
      process.stdout.write(`[הצעות: ${suggestions.map(s=>s.trim().replace(/\s+/g,' ')).join(' | ')}] `);
    }
    const exact = page.locator("li", { hasText: term }).filter({ hasText: "שכונה" }).first();
    if (await exact.count()) { await exact.click(); clicked = true; break; }
    const opt = page.locator("li").filter({ hasText: "שכונה" }).first();
    if (await opt.count()) {
      const txt = (await opt.textContent() || "").trim();
      process.stdout.write(`[בחירת הצעה קרובה: "${txt}"] `);
      await opt.click(); clicked = true; break;
    }
  }
  if (!clicked) await input.press("Enter");

  await page.waitForTimeout(4000);
  await scrollUntilDone(page, collected, last405Ref);
  await page.close();

  if (last405Ref.v && collected.length === 0) {
    throw new Error("reCAPTCHA נדחה (405) — הריצו במצב גלוי על מחשב מקומי (HARVEST_HEADLESS=false)");
  }
  return collected.map((r) => normalize(r, n)).filter((d): d is Deal => !!d);
}

async function main() {
  await loadStreetCoords();
  console.log("🔎 מגלה שכונות נתניה...");
  const neighborhoods = await discoverNeighborhoods();
  console.log(`   נמצאו ${neighborhoods.length} שכונות.`);

  // ─── בחירת דפדפן ───────────────────────────────────────────────────────
  // reCAPTCHA Enterprise מזהה אוטומציה גם עם stealth.
  // הפתרון: פרופיל Chrome ייעודי שנשמר בין הרצות (~/.harvest-chrome).
  // בהרצה הראשונה Chrome נפתח ריק — ניווט ידני אחד לנדל"ן מספיק לבנות
  // ציון reCAPTCHA גבוה. מהרצה שנייה ואילך זה עובד אוטומטית.
  //
  //   HARVEST_HEADLESS=true  → headless (לבדיקות בלבד)
  //   HARVEST_PROFILE=none   → ללא פרופיל (שיטה ישנה)
  const headless  = process.env.HARVEST_HEADLESS === "true";
  const noProfile = process.env.HARVEST_PROFILE  === "none";

  // תיקיית פרופיל ייעודית — לא הפרופיל הדיפולטי (Chrome אוסר remote debugging שם)
  const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
    ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

  const { promises: fsp } = await import("fs");
  await fsp.mkdir(PROFILE_DIR, { recursive: true });

  // בדיקה אם פרופיל חדש (ריק) — נציג הנחיות למשתמש
  const isNewProfile = !(await fsp.readdir(PROFILE_DIR).then((f) => f.length > 0).catch(() => false));

  let browser: any;

  if (noProfile) {
    try {
      browser = await chromiumExtra.launch({
        channel: "chrome", headless, slowMo: headless ? 0 : 100,
        args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
      });
      console.log("   🌐 Chrome ריק (ללא פרופיל)");
    } catch {
      browser = await chromiumExtra.launch({ headless, slowMo: 150 });
    }
  } else {
    try {
      const { chromium: pwChromium } = await import("playwright");
      const ctx = await pwChromium.launchPersistentContext(PROFILE_DIR, {
        channel: "chrome", headless, slowMo: headless ? 0 : 80,
        args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
      });

      if (isNewProfile) {
        console.log("   🆕 פרופיל חדש — Chrome ייפתח. אם תראה 405 בסיום, הרץ שוב npm run harvest.");
      }

      browser = {
        newPage: () => ctx.newPage(),
        close:   () => ctx.close(),
      };
      console.log(`   🌐 Chrome + פרופיל שמור (${PROFILE_DIR})`);
    } catch (e) {
      console.error(`❌ לא ניתן לפתוח Chrome: ${(e as Error).message}`);
      console.error("   נסה:  $env:HARVEST_PROFILE='none'; npm run harvest");
      process.exit(1);
    }
  }
  // HARVEST_ONLY=<שם שכונה> — שואב שכונה אחת בלבד (לתיקון מהיר)
  const onlyName = process.env.HARVEST_ONLY;
  // HARVEST_STREET=<שם רחוב> — שואב רחוב ספציפי לפי שם (כשהשאיבה לפי שכונה מחמיצה אותו)
  const onlyStreet = process.env.HARVEST_STREET;

  const targetNeighborhoods = onlyName
    ? neighborhoods.filter((n) => n.name.includes(onlyName))
    : neighborhoods;
  if (onlyName) console.log(`   🎯 מצב יחיד: "${onlyName}" → ${targetNeighborhoods.length} שכונות`);

  let allDeals: Deal[] = [];

  // בסוגי HARVEST_ONLY / HARVEST_STREET — נטען את העסקאות הקיימות ונשמור מלא
  let existingDeals: Deal[] = [];
  if ((onlyName || onlyStreet) && process.env.DATA_SOURCE !== "supabase") {
    try {
      existingDeals = JSON.parse(
        await fs.readFile(path.join(process.cwd(), "data", "deals.json"), "utf8")
      );
      console.log(`   📂 נטענו ${existingDeals.length} עסקאות קיימות`);
    } catch { /* אין עדיין */ }
  }

  // ─── מצב HARVEST_STREET: שאיבת רחוב בודד ישירות ───
  if (onlyStreet) {
    console.log(`   🏘️  שאיבת רחוב: "${onlyStreet}"`);
    // מצא את השכונה של הרחוב מ-street-index לצורך normalize()
    let streetNeigh: Neighborhood = { id: "0", name: onlyStreet, settlement: SETTLEMENT, x: null, y: null };
    try {
      const raw = await fs.readFile(path.join(process.cwd(), "data", "street-index.json"), "utf8");
      const arr: any[] = JSON.parse(raw);
      const hit = arr.find(s => s.street === onlyStreet && s.neighborhoodId);
      if (hit) {
        const matched = neighborhoods.find(n => String(n.id) === String(hit.neighborhoodId));
        if (matched) streetNeigh = matched;
        else streetNeigh = { id: hit.neighborhoodId, name: hit.neighborhoodName || onlyStreet, settlement: SETTLEMENT, x: hit.x ?? null, y: hit.y ?? null };
      }
    } catch { /* אין street-index */ }
    console.log(`   📍 שכונה: ${streetNeigh.name} (${streetNeigh.id})`);
    const streetDeals = await harvestByStreets(browser, { ...streetNeigh, name: onlyStreet + " (רחוב)" });
    allDeals = allDeals.concat(streetDeals);
    console.log(`   ✅ ${streetDeals.length} עסקאות נאספו עבור "${onlyStreet}"`);
    await browser.close();
    const combined = [...existingDeals, ...allDeals];
    const seen2 = new Set<string>();
    const deals2 = combined.filter((d) => (seen2.has(d.id) ? false : (seen2.add(d.id), true)));
    await fs.writeFile(path.join(process.cwd(), "data", "deals.json"), JSON.stringify(deals2, null, 2));
    console.log(`✅ נכתבו ${deals2.length} עסקאות (${streetDeals.length} חדשות עבור ${onlyStreet})`);
    return;
  }

  // שכונות שnadlan.gov.il לא מכיר לפי שם — חייב לשאוב לפי רחובות
  const STREET_MODE_NEIGHBORHOODS = new Set(["מרכז העיר צפון"]);

  for (const n of targetNeighborhoods) {
    process.stdout.write(`   ⛏️  ${n.name} ... `);
    try {
      const deals = STREET_MODE_NEIGHBORHOODS.has(n.name)
        ? await harvestByStreets(browser, n)
        : await harvestNeighborhood(browser, n);
      allDeals = allDeals.concat(deals);
      console.log(`${deals.length} עסקאות סה"כ`);
    } catch (e) {
      console.log(`שגיאה (${(e as Error).message})`);
    }
    await sleep(POLITE_DELAY_MS);
  }
  await browser.close();

  // הסרת כפילויות — במצב HARVEST_ONLY: מיזוג עם הקיים
  const combined = onlyName ? [...existingDeals, ...allDeals] : allDeals;
  const seen = new Set<string>();
  const deals = combined.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));

  if (process.env.DATA_SOURCE === "supabase") {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    await sb.from("neighborhoods").upsert(neighborhoods);
    // העלאה במנות
    for (let i = 0; i < deals.length; i += 500) {
      await sb.from("deals").upsert(deals.slice(i, i + 500));
    }
    console.log(`✅ הועלו ${deals.length} עסקאות ל-Supabase.`);
  } else if (deals.length > 0) {
    const dataDir = path.join(process.cwd(), "data");
    await fs.mkdir(dataDir, { recursive: true });
    if (!onlyName) {
      // הרצה מלאה — כותב גם neighborhoods.json
      await fs.writeFile(path.join(dataDir, "neighborhoods.json"), JSON.stringify(neighborhoods, null, 2));
    }
    await fs.writeFile(path.join(dataDir, "deals.json"), JSON.stringify(deals, null, 2));
    const newCount = allDeals.filter((d): d is Deal => !!d).length;
    console.log(`✅ נכתבו ${deals.length} עסקאות ל-data/deals.json (${newCount} חדשות מהסבב הזה)`);
  }

  if (deals.length === 0) {
    console.warn(
      "⚠️  לא נאספו עסקאות (לא נכתב כלום — נתוני הדוגמה נשמרו). ייתכן ש-reCAPTCHA חסם headless, או שכתובת/מבנה העמוד השתנו.",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
