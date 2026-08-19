/**
 * scripts/fetch-datagov.ts  —  ארוסט עסקאות מ-data.gov.il (ללא Playwright / reCAPTCHA)
 * ---------------------------------------------------------------------------
 * data.gov.il מפרסם את אותם נתוני רשות המסים כ-API ציבורי פתוח (CKAN).
 * אין צורך בדפדפן — fetch רגיל עובד.
 *
 * הרצה:
 *   npm run fetch:datagov
 *   DATA_SOURCE=supabase npm run fetch:datagov
 * ---------------------------------------------------------------------------
 */
import { promises as fs } from "fs";
import path from "path";
import type { Deal, Neighborhood } from "../lib/types";

const DATA_DIR   = path.join(process.cwd(), "data");
const SETTLEMENT = "נתניה";
const CKAN_BASE  = "https://data.gov.il/api/3/action";

// מזהה המשאב של עסקאות נדל"ן ב-data.gov.il (רשות המסים — עסקאות נדל"ן)
const RESOURCE_ID = "43a3b913-e4e2-4a1d-9e96-6982ef5a9e5a";
const PAGE_SIZE   = 100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** מנרמל שם שכונה מה-API לשם שבשימוש אצלנו */
const NEIGH_ALIASES: Record<string, string> = {
  "עיר ימים":       "עיר ימים",
  "ניר ימים":       "עיר ימים",
  "ים ימים":        "עיר ימים",
};
function normNeigh(s: string): string {
  return NEIGH_ALIASES[s.trim()] ?? s.trim();
}

function num(v: any): number {
  if (v == null || v === "") return NaN;
  if (typeof v === "number") return v;
  return parseFloat(String(v).replace(/[^\d.]/g, "")) || NaN;
}

function classifyNature(s: string | null): "apartment" | "house" | "land" {
  const t = (s || "").trim();
  if (/מגרש|קרקע|מקרקעין|חקלאי|נחלה/.test(t)) return "land";
  if (/דיר[הת]/.test(t)) return "apartment";
  if (/קוטג|צמוד|דו ?משפחת|וילה|חד ?משפחת/.test(t)) return "house";
  return "apartment";
}

interface RawRecord { [key: string]: any }

/** ממפה שורת CKAN ל-Deal שלנו */
function normalize(r: RawRecord, neighborhoods: Neighborhood[]): Deal | null {
  const price = num(r["DEALPRICE"] ?? r["dealPrice"] ?? r["deal_price"]);
  if (!price || !Number.isFinite(price) || price <= 0) return null;

  const builtArea = num(r["BUILDINGAREASQM"] ?? r["buildingAreaSqm"] ?? r["building_area_sqm"] ?? r["ASSETAREA"]);
  const plotArea  = num(r["LANDAREASQM"]     ?? r["landAreaSqm"]     ?? r["land_area_sqm"]     ?? r["PLOTAREA"]);
  const rooms     = num(r["ROOMS"]           ?? r["rooms"]           ?? r["ROOMNUM"]);
  const dateRaw   = r["DEALDATETIME"] ?? r["dealDateTime"] ?? r["DEALDATE"] ?? r["dealDate"] ?? r["deal_date"];
  const dealDate  = dateRaw ? new Date(dateRaw).toISOString().slice(0, 10) : "";
  if (!dealDate) return null;

  const dealNature  = r["DEALNATUREDESCRIPTION"] ?? r["dealNatureDescription"] ?? r["DEALNATURE"] ?? r["dealNature"] ?? null;
  const propertyType = classifyNature(dealNature);
  const isLand = propertyType === "land";

  const areaSqm  = isLand ? null : (Number.isFinite(builtArea) && builtArea > 0 ? builtArea : null);
  let   plotSqm  = Number.isFinite(plotArea) && plotArea > 0 ? plotArea : null;
  if (isLand && !plotSqm && Number.isFinite(builtArea) && builtArea > 0) plotSqm = builtArea;

  const ppsqmBase  = isLand ? plotSqm : areaSqm;
  const pricePerSqm = ppsqmBase && ppsqmBase > 0 ? Math.round(price / ppsqmBase) : null;

  const streetName = r["STREETNAME"] ?? r["streetName"] ?? r["street_name"] ?? r["STREET"] ?? null;
  const houseNum   = r["HOUSENUMBER"] ?? r["houseNumber"] ?? r["house_number"] ?? r["HOUSENUM"] != null
    ? String(r["HOUSENUMBER"] ?? r["houseNumber"] ?? r["house_number"] ?? r["HOUSENUM"] ?? "")
    : null;
  const fullAddr   = r["FULLADRESS"] ?? r["fullAddress"] ?? r["full_address"] ?? null;

  const neighName  = normNeigh(r["NEIGHBORHOOD"] ?? r["neighborhood"] ?? r["NEIGHBORHOODNAME"] ?? r["neighborhoodName"] ?? "");
  const neighObj   = neighborhoods.find(
    (n) => n.name === neighName || n.name.includes(neighName) || neighName.includes(n.name),
  );
  const neighborhoodId = neighObj?.id ?? neighName;

  const gush   = r["GUSH"]   ?? r["gush"]   ?? "";
  const helka  = r["HELKA"]  ?? r["helka"]  ?? "";
  const idBase = gush && helka
    ? `${gush}-${helka}-${dealDate}-${Math.round(price)}`
    : `dg-${neighName}-${dealDate}-${Math.round(price)}-${builtArea || plotArea || 0}`;

  return {
    id:            idBase,
    dealDate,
    price,
    propertyType,
    rooms:         !isLand && Number.isFinite(rooms) && rooms > 0 ? rooms : null,
    areaSqm,
    plotSqm,
    floor:         r["FLOORNO"] != null ? Number(r["FLOORNO"]) : null,
    yearBuilt:     r["BUILDINGYEAR"] != null ? Number(r["BUILDINGYEAR"]) : null,
    dealNature,
    address:       fullAddr,
    houseNumber:   houseNum || null,
    street:        streetName,
    neighborhoodId,
    neighborhood:  neighName || null,
    settlement:    SETTLEMENT,
    x:             neighObj?.x ?? null,
    y:             neighObj?.y ?? null,
    pricePerSqm,
  };
}

/** שואל CKAN עם offset + פילטר עיר */
async function fetchPage(offset: number): Promise<{ records: RawRecord[]; total: number }> {
  const params = new URLSearchParams({
    resource_id: RESOURCE_ID,
    limit:       String(PAGE_SIZE),
    offset:      String(offset),
    q:           SETTLEMENT,
  });
  const url = `${CKAN_BASE}/datastore_search?${params}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Shaviut-Netanya/1.0 (public data research)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  const j = await res.json();
  if (!j.success) throw new Error("CKAN error: " + JSON.stringify(j.error));
  return { records: j.result.records ?? [], total: j.result.total ?? 0 };
}

/** גילוי שדות ורשומה לדוגמה */
async function discoverFields(): Promise<void> {
  const url = `${CKAN_BASE}/datastore_search?resource_id=${RESOURCE_ID}&limit=1`;
  const res = await fetch(url);
  const j = await res.json();
  if (j.success) {
    console.log("   📋 שדות:", j.result.fields?.map((f: any) => f.id).join(", "));
    if (j.result.records?.[0]) console.log("   📄 דוגמה:", JSON.stringify(j.result.records[0], null, 2).slice(0, 600));
  }
}

async function main() {
  const neighborhoods: Neighborhood[] = JSON.parse(
    await fs.readFile(path.join(DATA_DIR, "neighborhoods.json"), "utf8"),
  );

  // שלב 0: גילוי שדות (תצוגה בלבד)
  console.log("\n🔎 בודק שדות זמינים ב-data.gov.il...");
  await discoverFields();

  // שלב 1: ספירה
  const { total } = await fetchPage(0);
  if (total === 0) {
    console.error(`\n❌ לא נמצאו רשומות עם הפילטר "${SETTLEMENT}" ב-resource_id=${RESOURCE_ID}.`);
    console.error("   ייתכן שה-resource_id השתנה. בדוק ב: https://data.gov.il/dataset/remez");
    process.exit(1);
  }
  console.log(`\n✅ נמצאו ${total} עסקאות לנתניה ב-data.gov.il`);
  const pages = Math.ceil(total / PAGE_SIZE);
  console.log(`   מוריד ${pages} עמודים (${PAGE_SIZE} רשומות כל אחד)...\n`);

  // שלב 2: הורדה
  const allRaw: RawRecord[] = [];
  for (let p = 0; p < pages; p++) {
    process.stdout.write(`   עמוד ${p + 1}/${pages}... `);
    try {
      const { records } = await fetchPage(p * PAGE_SIZE);
      allRaw.push(...records);
      console.log(`${records.length} רשומות`);
    } catch (e) {
      console.log(`שגיאה: ${(e as Error).message}`);
    }
    if (p < pages - 1) await sleep(300); // מנומס
  }

  // שלב 3: נרמול
  const deals: Deal[] = allRaw
    .map((r) => normalize(r, neighborhoods))
    .filter((d): d is Deal => d !== null);

  // הסרת כפילויות
  const seen = new Set<string>();
  const unique = deals.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));

  console.log(`\n📊 ${allRaw.length} רשומות גולמיות → ${unique.length} עסקאות תקינות`);

  // שלב 4: כתיבה
  if (process.env.DATA_SOURCE === "supabase") {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    for (let i = 0; i < unique.length; i += 500) {
      await sb.from("deals").upsert(unique.slice(i, i + 500));
    }
    console.log(`✅ הועלו ${unique.length} עסקאות ל-Supabase.`);
  } else {
    await fs.writeFile(path.join(DATA_DIR, "deals.json"), JSON.stringify(unique, null, 2));
    console.log(`✅ נכתבו ${unique.length} עסקאות ל-data/deals.json`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
