/**
 * scripts/enrich-plot.ts
 * ---------------------------------------------------------------------------
 * מעשיר עסקאות בתים ב-plotSqm (שטח מגרש) מ-govmap.gov.il.
 *
 * **איך זה עובד:**
 * govmap חושף את שכבת החלקות (govmap:layer_parcel_all) דרך WFS proxy פנימי
 * ב-/api/geoserver/wfs — נגיש רק כאשר הקריאה מגיעה מתוך הדפדפן עם cookies של govmap.
 * Playwright פותח עמוד govmap אחד, ואז מריץ fetch() לשירות החלקות
 * ישירות מתוך ה-browser context — הקריאות נושאות cookies + Referer אוטומטית.
 *
 * **אסטרטגיית בחירת חלקה:**
 * לכל עסקה: חיפוש BBOX 15-50מ' סביב הקואורדינטה.
 * מסנן: legal_area >= areaSqm (מגרש >= בנוי), legal_area < 10,000.
 * מחזיר את שטח החלקה לפי legal_area.
 *
 * הרצה:
 *   npx tsx scripts/enrich-plot.ts               # כל הבתים
 *   ENRICH_LIMIT=20 npx tsx scripts/enrich-plot.ts  # 20 ראשונים בלבד
 * ---------------------------------------------------------------------------
 */
import { promises as fs } from "fs";
import path from "path";
import type { Deal } from "../lib/types";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium: chromiumExtra } = require("playwright-extra");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromiumExtra.use(StealthPlugin());

const DATA_DIR = path.join(process.cwd(), "data");
const SLEEP_MS = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const WFS_TYPE = "govmap:layer_parcel_all";
const MAX_PLOT = 10_000; // מ"ר — סף עליון סביר לבית פרטי

/** מחזיר שטח חלקה (legal_area מ"ר) שמכיל את נקודת העסקה */
async function queryPlotSqm(
  page: any,
  x: number,
  y: number,
  areaSqm: number | null,
): Promise<number | null> {
  // ננסה רדיוסים הולכים וגדלים עד שנמצא חלקה מתאימה
  for (const pad of [15, 30, 60]) {
    const result: any = await page.evaluate(
      async (params: { x: number; y: number; pad: number; type: string }) => {
        const { x, y, pad, type } = params;
        const url =
          "/api/geoserver/wfs?service=wfs&version=1.1.0&request=GetFeature" +
          "&typeName=" + type +
          "&outputFormat=application/json&srsName=EPSG:2039" +
          "&BBOX=" + (x - pad) + "," + (y - pad) + "," + (x + pad) + "," + (y + pad) + ",EPSG:2039" +
          "&maxFeatures=20";
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          const ct = res.headers.get("content-type") || "";
          if (!ct.includes("json")) return null;
          return await res.json();
        } catch {
          return null;
        }
      },
      { x, y, pad, type: WFS_TYPE },
    );

    if (!result?.features?.length) continue;

    // סנן חלקות לפי גודל סביר
    const minArea = areaSqm ? Math.max(50, areaSqm * 0.5) : 50;
    const candidates = result.features
      .map((f: any) => f.properties?.legal_area as number | undefined)
      .filter((a: number | undefined) => typeof a === "number" && a >= minArea && a <= MAX_PLOT)
      .sort((a: number, b: number) => a - b); // מהקטנה לגדולה — בחר הקטנה שעונה לתנאי

    if (candidates.length > 0) return Math.round(candidates[0]);
  }
  return null;
}

async function main() {
  const dealsPath = path.join(DATA_DIR, "deals.json");
  const deals: Deal[] = JSON.parse(await fs.readFile(dealsPath, "utf8"));

  const houses = deals.filter(
    (d) => d.propertyType === "house" && d.x && d.y && !d.plotSqm,
  );

  const limit = process.env.ENRICH_LIMIT
    ? parseInt(process.env.ENRICH_LIMIT, 10)
    : houses.length;
  const targets = houses.slice(0, limit);

  if (targets.length === 0) {
    console.log("✅ אין בתים לעשרות — כולם כבר מעושרים.");
    return;
  }

  console.log(`\n🏡 מעשיר ${targets.length}/${houses.length} בתים עם שטח מגרש מ-govmap...`);

  const browser = await chromiumExtra.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  // פתח govmap פעם אחת לקבלת cookies
  console.log("   🌐 פותח govmap לקבלת session...");
  const first = targets[0];
  await page.goto(
    `https://www.govmap.gov.il/?c=${Math.round(first.x!)},${Math.round(first.y!)}&z=15&b=0`,
    { waitUntil: "domcontentloaded", timeout: 30000 },
  );
  await sleep(3000);

  // בנה מפה מ-id → אינדקס ב-deals
  const idToIndex: Record<string, number> = {};
  deals.forEach((d, i) => { idToIndex[d.id] = i; });

  let enriched = 0, failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const deal = targets[i];
    const plotSqm = await queryPlotSqm(page, deal.x!, deal.y!, deal.areaSqm);

    if (plotSqm && plotSqm > 0) {
      deals[idToIndex[deal.id]].plotSqm = plotSqm;
      enriched++;
      if (enriched <= 5 || enriched % 20 === 0) {
        console.log(`   ✅ ${deal.address ?? deal.street} — ${plotSqm} מ"ר מגרש`);
      }
    } else {
      failed++;
    }

    if ((i + 1) % 50 === 0) {
      process.stdout.write(
        `\r   ⏳ ${i + 1}/${targets.length} (✅ ${enriched}, ❌ ${failed})   `,
      );
      // שמור ביניים כל 50 עסקאות
      await fs.writeFile(dealsPath, JSON.stringify(deals, null, 2), "utf8");
    }

    await sleep(SLEEP_MS);
  }

  process.stdout.write("\n");
  await fs.writeFile(dealsPath, JSON.stringify(deals, null, 2), "utf8");
  await browser.close();

  console.log(`\n✅ הסתיים:`);
  console.log(`   עושרו: ${enriched}/${targets.length} עסקאות`);
  console.log(`   נכשלו: ${failed} עסקאות`);
  console.log(`   נשמר: data/deals.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
