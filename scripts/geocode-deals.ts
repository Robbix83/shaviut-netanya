/**
 * scripts/geocode-deals.ts
 * ---------------------------------------------------------------------------
 * מעדכן קואורדינטות עסקאות מרמת-רחוב לרמת-בניין (מספר בית מדויק).
 *
 * איך זה עובד:
 *   לכל עסקה עם רחוב + מספר בית → שואל govmap "רחוב XX נתניה"
 *   ומחזיר קואורדינטות ITM של הבניין הספציפי.
 *   כך חיפוש "אותו בניין" (≤60מ') עובד באמת ולא תיאורטית.
 *
 * חכמות:
 *   - cache per (street, houseNumber) → קריאת API אחת לכל כתובת ייחודית
 *   - עסקאות ללא מספר בית → נשארות עם קואורדינטת רחוב (לא נגעים)
 *   - עסקאות שכבר עודכנו בריצה קודמת → מדולגות אוטומטית (flag geoLevel)
 *   - delay מנומס 550ms בין קריאות כדי לא לחסום את govmap
 *
 * הרצה:
 *   npx tsx scripts/geocode-deals.ts                          # מקומי (data/deals.json)
 *   DATA_SOURCE=supabase npx tsx scripts/geocode-deals.ts     # Supabase
 * ---------------------------------------------------------------------------
 */

import { promises as fs } from "fs";
import path from "path";
import type { Deal } from "../lib/types";

const DATA_DIR   = path.join(process.cwd(), "data");
const DELAY_MS   = 550;                          // מנומס — לא ייחסם
const ES_BASE    = "https://es.govmap.gov.il/TldSearch";
const HEADERS    = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json",
  Referer: "https://www.nadlan.gov.il/",
  Origin: "https://www.nadlan.gov.il",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** פונקציית geocoding: רחוב + מספר בית → קואורדינטות ITM */
async function geocodeAddress(street: string, houseNum: string): Promise<{ x: number; y: number } | null> {
  const query = `${street} ${houseNum} נתניה`;
  const url   = `${ES_BASE}/api/DetailsByQuery?query=${encodeURIComponent(query)}&lyrs=16399&gid=govmap`;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return null;
    const data: any = await res.json();
    if (!data?.data) return null;
    for (const type of (data.order ?? Object.keys(data.data))) {
      const hit = data.data[type]?.[0];
      if (hit?.X && hit?.Y) return { x: hit.X, y: hit.Y };
    }
  } catch { /* timeout / רשת */ }
  return null;
}

async function main() {
  const isSupabase = process.env.DATA_SOURCE === "supabase";

  // --- טעינת עסקאות ---
  let deals: Deal[];
  if (isSupabase) {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const { data, error } = await sb.from("deals").select("*");
    if (error || !data) { console.error("❌ שגיאה בטעינת Supabase:", error?.message); process.exit(1); }
    deals = data as Deal[];
  } else {
    deals = JSON.parse(await fs.readFile(path.join(DATA_DIR, "deals.json"), "utf8")) as Deal[];
  }

  console.log(`📦 נטענו ${deals.length} עסקאות`);

  // --- מפה של (street|houseNumber) → קואורדינטות (cache קריאות API) ---
  const coordCache = new Map<string, { x: number; y: number } | null>();

  // --- ספירות ---
  let alreadyGood = 0, noHouseNum = 0, geocoded = 0, failed = 0;

  // --- זהה אילו עסקאות צריכות עדכון ---
  // עסקאות שכבר עודכנו בריצה קודמת: geoLevel === "building" (אם קיים)
  const toUpdate: Deal[] = deals.filter((d) => {
    if (!d.street || !d.houseNumber) { noHouseNum++; return false; }
    if ((d as any).geoLevel === "building") { alreadyGood++; return false; }
    return true;
  });

  console.log(`🏠 ${toUpdate.length} עסקאות לעדכון · ${alreadyGood} כבר ברמת בניין · ${noHouseNum} ללא מספר בית`);
  if (toUpdate.length === 0) { console.log("✅ הכל מעודכן, אין מה לעשות."); return; }

  // --- geocoding ---
  // בנה רשימת כתובות ייחודיות תחילה (חוסך API calls)
  const uniqueAddrs = new Set<string>();
  for (const d of toUpdate) uniqueAddrs.add(`${d.street}|${d.houseNumber}`);

  console.log(`🌐 ${uniqueAddrs.size} כתובות ייחודיות לפתרון...`);

  let apiIdx = 0;
  for (const key of uniqueAddrs) {
    const [street, houseNum] = key.split("|");
    process.stdout.write(`\r   [${++apiIdx}/${uniqueAddrs.size}] ${street} ${houseNum}...        `);
    const coords = await geocodeAddress(street, houseNum);
    coordCache.set(key, coords);
    if (!coords) failed++;
    await sleep(DELAY_MS);
  }
  console.log(); // שורה חדשה

  // --- עדכון העסקאות ---
  const updates: Array<{ id: string; x: number; y: number }> = [];
  for (const d of toUpdate) {
    const key    = `${d.street}|${d.houseNumber}`;
    const coords = coordCache.get(key);
    if (!coords) continue;
    d.x = coords.x;
    d.y = coords.y;
    (d as any).geoLevel = "building";
    geocoded++;
    updates.push({ id: d.id, x: coords.x, y: coords.y });
  }

  console.log(`📍 עודכנו: ${geocoded} בניינים · נכשלו: ${failed} כתובות`);

  // --- שמירה ---
  if (isSupabase) {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    // עדכון במנות של 200
    for (let i = 0; i < updates.length; i += 200) {
      const batch = updates.slice(i, i + 200);
      for (const u of batch) {
        await sb.from("deals").update({ x: u.x, y: u.y, geo_level: "building" }).eq("id", u.id);
      }
      process.stdout.write(`\r   שמירה Supabase: ${Math.min(i + 200, updates.length)}/${updates.length}...`);
      await sleep(50);
    }
    console.log("\n✅ Supabase עודכן.");
  } else {
    await fs.writeFile(path.join(DATA_DIR, "deals.json"), JSON.stringify(deals, null, 2), "utf8");
    console.log(`✅ נשמר ל-data/deals.json`);
  }

  const pct = Math.round((geocoded / toUpdate.length) * 100);
  console.log(`\n🎯 סיכום: ${geocoded}/${toUpdate.length} עסקאות (${pct}%) קיבלו קואורדינטות ברמת בניין.`);
  if (failed > 0) {
    console.log(`⚠️  ${failed} כתובות לא נפתרו (govmap לא הכיר אותן) — נשארו עם קואורדינטת רחוב.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
