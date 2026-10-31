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
import { pathToFileURL } from "url";
import type { Deal, Neighborhood } from "../lib/types";
import { discoverNeighborhoods as discoverNeighborhoodsImpl } from "../lib/neighborhoodDiscovery";
import { decodeDealData, normalizeDeal, mergeIncrementalDeals } from "../lib/dealNormalization";
import { resolveDataTables } from "../lib/config";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium: chromiumExtra } = require("playwright-extra");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromiumExtra.use(StealthPlugin());

const SETTLEMENT = "נתניה";
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wave 0G-L1F: reads all existing deals from Supabase (read-only) so
 * mergeIncrementalDeals() can recognize an already-stored transaction even
 * though Wave 0G-L1D changed the id-generation formula. Without this, the
 * Supabase upsert below had NO visibility into what the `deals` table
 * already contains (existingDeals was only ever loaded from the local
 * data/deals.json file, never for DATA_SOURCE=supabase) — a re-harvested
 * version of an already-stored transaction would get a brand-new
 * new-format id and get upserted as a genuine duplicate row alongside the
 * untouched old one (upsert matches by primary key only; it never deletes
 * or merges rows absent from its own payload). Applies to BOTH a full
 * citywide run and an incremental HARVEST_ONLY run — a full run's
 * exposure is larger (every neighborhood's already-stored transactions
 * would get a duplicate upserted), not smaller.
 *
 * Paginated (PostgREST caps a single response ~1000 rows), mirroring the
 * exhaustive-pagination pattern lib/store.ts's SupabaseStore.getAllDeals()
 * already uses for this exact table.
 */
async function loadExistingDealsFromSupabase(sb: any): Promise<Deal[]> {
  const PAGE_SIZE = 1000;
  const all: Deal[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb.from(resolveDataTables(process.env).deals).select("*").order("id").range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`SUPABASE_EXISTING_DEALS_READ_FAILED:${error.code}:${error.message}`);
    const page = (data ?? []) as Deal[];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * מגלה את שכונות נתניה + מזהי UNIQ_ID + מרכזים גאוגרפיים.
 *
 * Wave 0G-11: המימוש עבר ל-lib/neighborhoodDiscovery.ts, ששכבה 1 שלו היא
 * הקטלוג הרשמי של nadlan.gov.il עצמו (proven Wave 0G-6/0G-7) במקום חיפוש-שם
 * בלבד — השיטה הישנה החמיצה בשקט את הישות 65210195 ("נוף הטיילת", המזהה
 * השני), שם נמצאות 7 העסקאות החסרות של עובד בן עמי 41
 * (audit/wave0g4/CADASTRAL_ENTITY_RECONCILIATION.md). חיפוש-השם הישן נשמר
 * כמקור גיבוי, לא הוחלף.
 */
async function discoverNeighborhoods(): Promise<Neighborhood[]> {
  // שכונות שה-API לא מכיר כלל — נוסיף לפי ID ישירות מ-neighborhoods.json
  const existingNeighborhoods: Neighborhood[] = (() => {
    try { return JSON.parse(require("fs").readFileSync(require("path").join(process.cwd(), ...(process.env.DATA_TABLES === "v2" ? ["data", "v2-candidate", "neighborhoods-v2.json"] : ["data", "neighborhoods.json"])), "utf8")); }
    catch { return []; }
  })();
  return discoverNeighborhoodsImpl({ existingNeighborhoods, onLog: (m) => console.log(m) });
}

/**
 * מנרמל רשומת עסקה גולמית ל-Deal, תוך שימוש בקואורדינטות הרחוב שנטענו.
 * Wave 0G-12: המימוש עצמו עבר ל-lib/dealNormalization.ts (משותף עם ה-shadow
 * rebuild pilot) — זהו wrapper דק בלבד שמעביר את streetCoords של הקובץ הזה.
 */
function normalize(raw: any, n: Neighborhood): Deal | null {
  return normalizeDeal(raw, n, streetCoords);
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

  // Wave 0G-L1F: יוצרים את לקוח ה-Supabase וקוראים את העסקאות הקיימות
  // עכשיו — לפני השאיבה, לא אחריה. אחרת מפתח שגוי או תקלת קריאה חד-פעמית
  // מבטלים ריצה שלמה (עד עשרות דקות של שאיבה) ללא כל תוצאה, במקום להיכשל
  // מהר לפני שהזמן הזה מושקע (ECC planner finding). מדלגים ב-HARVEST_STREET
  // — לענף הזה אין כלל נתיב כתיבה ל-Supabase (פער נפרד, מתועד ולא מתוקן).
  const isSupabaseMode = process.env.DATA_SOURCE === "supabase";
  let sb: any = null;
  let existingDealsForMerge: Deal[] = onlyName ? existingDeals : [];
  if (isSupabaseMode && !onlyStreet) {
    const { createClient } = await import("@supabase/supabase-js");
    sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    existingDealsForMerge = await loadExistingDealsFromSupabase(sb);
    console.log(`   📂 נטענו ${existingDealsForMerge.length} עסקאות קיימות מ-Supabase`);
  }

  // ─── מצב HARVEST_STREET: שאיבת רחוב בודד ישירות ───
  if (onlyStreet) {
    // street-index מחזיק מזהי V1; ב-V2 שאיבת רחוב בודד הייתה מכפילה עסקאות
    if (process.env.DATA_TABLES) throw new Error("HARVEST_STREET does not support DATA_TABLES=v2: street-index holds V1 neighborhood ids.");
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
    // Wave 0G-L1E: id-format-aware merge — see mergeIncrementalDeals() docs.
    const { merged: deals2, addedCount, skippedDuplicateCount } = mergeIncrementalDeals(existingDeals, allDeals);
    if (skippedDuplicateCount > 0) console.log(`   ℹ️  ${skippedDuplicateCount} מהעסקאות שנאספו כבר קיימות (דולגו)`);
    await fs.writeFile(path.join(process.cwd(), "data", "deals.json"), JSON.stringify(deals2, null, 2));
    console.log(`✅ נכתבו ${deals2.length} עסקאות (${addedCount} חדשות עבור ${onlyStreet})`);
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

  // הסרת כפילויות — מיזוג מודע-לפורמט-מזהה עם הקיים (Wave 0G-L1E/L1F —
  // existingDealsForMerge/sb כבר נטענו לפני השאיבה למעלה — ראו תיעוד
  // mergeIncrementalDeals())
  const { merged: deals, added, addedCount, skippedDuplicateCount } = mergeIncrementalDeals(
    existingDealsForMerge,
    allDeals,
  );
  if (skippedDuplicateCount > 0) console.log(`   ℹ️  ${skippedDuplicateCount} מהעסקאות שנאספו כבר קיימות (דולגו)`);

  if (isSupabaseMode) {
    const { error: neighborhoodsError } = await sb.from(resolveDataTables(process.env).neighborhoods).upsert(neighborhoods);
    if (neighborhoodsError) throw new Error(`SUPABASE_NEIGHBORHOODS_WRITE_FAILED:${neighborhoodsError.message}`);
    // מעלים רק את השורות שבאמת חדשות (added) — לא את כל deals, כדי לא
    // לדחוף מחדש שורות שכבר קיימות ב-Supabase (הבחנה זו היא בדיוק מה
    // שהמיזוג למעלה מזהה).
    for (let i = 0; i < added.length; i += 500) {
      const { error: dealsError } = await sb.from(resolveDataTables(process.env).deals).upsert(added.slice(i, i + 500));
      if (dealsError) throw new Error(`SUPABASE_DEALS_WRITE_FAILED:${dealsError.message}`);
    }
    console.log(`✅ הועלו ${added.length} עסקאות חדשות ל-Supabase (סה"כ בטבלה: ${deals.length}).`);
  } else if (deals.length > 0) {
    const dataDir = path.join(process.cwd(), "data");
    await fs.mkdir(dataDir, { recursive: true });
    if (!onlyName) {
      // הרצה מלאה — כותב גם neighborhoods.json
      await fs.writeFile(path.join(dataDir, "neighborhoods.json"), JSON.stringify(neighborhoods, null, 2));
    }
    await fs.writeFile(path.join(dataDir, "deals.json"), JSON.stringify(deals, null, 2));
    console.log(`✅ נכתבו ${deals.length} עסקאות ל-data/deals.json (${addedCount} חדשות מהסבב הזה)`);
  }

  // Wave 0G-L1F: הבדיקה חייבת להיות על allDeals (מה שבאמת נאסף בסבב הזה),
  // לא על deals (הכולל כעת גם עסקאות קיימות מ-Supabase/מהקובץ) — אחרת
  // אזהרת "לא נאספו עסקאות" כמעט אף פעם לא תופיע ב-Supabase mode, גם
  // כשה-scrape עצמו לא החזיר כלום.
  if (allDeals.length === 0) {
    console.warn(
      "⚠️  לא נאספו עסקאות (לא נכתב כלום חדש). ייתכן ש-reCAPTCHA חסם headless, או שכתובת/מבנה העמוד השתנו.",
    );
  }
}

// Wave 0G-L1F: guarded, matching the established pattern in
// scripts/build-v2-launch-candidate.ts — without this, merely IMPORTING
// this file (e.g. to reuse/test loadExistingDealsFromSupabase) would
// launch a real Playwright browser and start live scraping immediately.
const isDirectExecution = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { loadExistingDealsFromSupabase };
