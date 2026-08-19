/**
 * scripts/stats.ts  —  סיכום כיסוי נתונים אחרי harvest
 * הרצה:  npm run stats
 */
import { promises as fs } from "fs";
import path from "path";
import type { Deal, Neighborhood } from "../lib/types";

const DATA_DIR = path.join(process.cwd(), "data");

const CONFIDENCE_THRESHOLDS = { high: 25, medium: 10 };
const STALE_DAYS = 60; // עסקה אחרונה ישנה מ-60 יום → ⚠️

function confidence(n: number): string {
  if (n >= CONFIDENCE_THRESHOLDS.high)   return "🟢 גבוה  ";
  if (n >= CONFIDENCE_THRESHOLDS.medium) return "🟡 בינוני";
  if (n >= 3)                            return "🔴 נמוך  ";
  return "❌ אין   ";
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function pad(s: string, n: number, right = false): string {
  const str = String(s);
  const spaces = " ".repeat(Math.max(0, n - str.length));
  return right ? spaces + str : str + spaces;
}

async function main() {
  const neighborhoods: Neighborhood[] = JSON.parse(
    await fs.readFile(path.join(DATA_DIR, "neighborhoods.json"), "utf8"),
  );
  const deals: Deal[] = JSON.parse(
    await fs.readFile(path.join(DATA_DIR, "deals.json"), "utf8"),
  );

  // קיבוץ עסקאות לפי שכונה
  const byNeigh = new Map<string, Deal[]>();
  for (const n of neighborhoods) byNeigh.set(n.id, []);
  for (const d of deals) {
    if (!byNeigh.has(d.neighborhoodId)) byNeigh.set(d.neighborhoodId, []);
    byNeigh.get(d.neighborhoodId)!.push(d);
  }

  const today = new Date().toISOString().slice(0, 10);

  // כותרת
  console.log("\n" + "=".repeat(95));
  console.log(
    pad("שכונה", 22) +
    pad("עסקאות", 9, true) +
    "  " + pad("ביטחון", 10) +
    pad("ראשונה", 12) +
    pad("אחרונה", 12) +
    pad("לפני", 7, true) + "  " +
    pad("דירה", 6, true) + "/" +
    pad("בית", 4, true) + "/" +
    pad("קרקע", 5, true),
  );
  console.log("-".repeat(95));

  let totalDeals = 0;
  let noCoverage = 0;
  let lowCoverage = 0;
  let stale = 0;

  for (const n of neighborhoods) {
    const ds = byNeigh.get(n.id) ?? [];
    totalDeals += ds.length;

    const dates = ds.map((d) => d.dealDate).filter(Boolean).sort();
    const first = dates[0] ?? "—";
    const last  = dates[dates.length - 1] ?? "—";
    const age   = last !== "—" ? daysSince(last) : null;

    const apt   = ds.filter((d) => d.propertyType === "apartment").length;
    const house = ds.filter((d) => d.propertyType === "house").length;
    const land  = ds.filter((d) => d.propertyType === "land").length;

    const ageStr = age !== null ? age + " ימים" : "—";
    const ageWarn = age !== null && age > STALE_DAYS ? " ⚠️" : "";

    if (ds.length === 0) noCoverage++;
    else if (ds.length < CONFIDENCE_THRESHOLDS.medium) lowCoverage++;
    if (age !== null && age > STALE_DAYS) stale++;

    console.log(
      pad(n.name, 22) +
      pad(String(ds.length), 9, true) +
      "  " + confidence(ds.length) + "  " +
      pad(first, 12) +
      pad(last,  12) +
      pad(ageStr + ageWarn, 14, true) + "  " +
      pad(String(apt),   6, true) + "/" +
      pad(String(house), 4, true) + "/" +
      pad(String(land),  5, true),
    );
  }

  console.log("=".repeat(95));
  console.log(`סה"כ: ${totalDeals} עסקאות ב-${neighborhoods.length} שכונות`);
  if (noCoverage)  console.log(`⚠️  ${noCoverage} שכונות ללא נתונים — משתמשים לא יקבלו הערכה`);
  if (lowCoverage) console.log(`⚠️  ${lowCoverage} שכונות עם ביטחון נמוך (<${CONFIDENCE_THRESHOLDS.medium} עסקאות)`);
  if (stale)       console.log(`⚠️  ${stale} שכונות עם עסקה אחרונה ישנה מ-${STALE_DAYS} יום`);
  if (!noCoverage && !lowCoverage && !stale) console.log("✅ כיסוי מלא — כל השכונות מוכנות");
  console.log();
}

main().catch((e) => { console.error(e); process.exit(1); });
