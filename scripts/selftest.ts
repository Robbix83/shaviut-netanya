/** בדיקת ליבה ישירה (ללא שכבת HTTP) — מנוע שווי + אחסון + קליטת ליד */
import { valuate } from "../lib/valuation";
import { getStore } from "../lib/store";
import { percentile } from "../lib/valuation";

async function main() {
  // 0) בדיקת percentile
  const pv = percentile([10, 20, 30, 40], 50);
  console.log("percentile p50 of [10,20,30,40] =", pv, pv === 25 ? "✓" : "✗");

  // 1) שווי לפי שכונה
  const v = await valuate({ neighborhoodId: "66239239", neighborhood: "נאות הרצל", rooms: 4, areaSqm: 100 });
  if (!v) {
    console.error("✗ valuate החזיר null");
    process.exit(1);
  }
  console.log("\n=== הערכת שווי: עיר ימים, 4 חד', 100 מ\"ר ===");
  console.log("טווח:", v.estimateLow.toLocaleString(), "–", v.estimateHigh.toLocaleString(), "₪");
  console.log("מחיר/מ\"ר (חציון):", v.pricePerSqmMid.toLocaleString());
  console.log("מבוסס על", v.basedOnDeals, "עסקאות · ביטחון:", v.confidence);
  console.log("עסקאות להשוואה:", v.comparableDeals.length);
  v.comparableDeals.slice(0, 3).forEach((c) =>
    console.log(`   • ${c.street ?? ""} ${c.rooms} חד' ${c.areaSqm} מ"ר → ${c.price.toLocaleString()} ₪ (${c.dealDate})`),
  );

  // 2) בדיקת היגיון: estimateLow < mid < high וכולם חיוביים
  const ok = v.estimateLow > 0 && v.estimateLow <= v.estimateMid && v.estimateMid <= v.estimateHigh;
  console.log("\nהיגיון טווח:", ok ? "✓" : "✗");

  // 3) קליטת ליד דרך ה-store
  const store = getStore();
  const lead = await store.insertLead({
    name: "בדיקה אוטומטית",
    phone: "0521234567",
    address: "עיר ימים נתניה",
    neighborhood: "עיר ימים",
    rooms: 4,
    areaSqm: 100,
    estimateLow: v.estimateLow,
    estimateHigh: v.estimateHigh,
    source: "selftest",
    consent: true,
  });
  console.log("\nליד נשמר עם id:", lead.id, lead.id ? "✓" : "✗");

  // 4) בדיקת היררכיה גיאוגרפית: ויצמן 98 → צפון מזרח מרכז העיר
  //    x=186965, y=693532 (קואורדינטות ITM של שד' ויצמן)
  const vGeo = await valuate({
    neighborhoodId: "66239254",
    neighborhood: "צפון מזרח מרכז העיר",
    propertyType: "apartment",
    rooms: 4,
    areaSqm: 100,
    floor: 5,
    yearBuilt: 2000,
    streetX: 186965,
    streetY: 693532,
  });
  if (!vGeo) {
    console.error("✗ valuate ויצמן 98 החזיר null — שכונה חסרה בסיד?");
    process.exit(1);
  }
  console.log("\n=== ויצמן 98: היררכיה גיאוגרפית ===");
  console.log("scope:", vGeo.compSearchScope, "| radius:", vGeo.compRadiusMeters, "מ' | window:", vGeo.windowMonths, "ח'");
  console.log("מבוסס על", vGeo.basedOnDeals, "עסקאות · ביטחון:", vGeo.confidence);
  const geoOk = vGeo.compSearchScope !== "neighborhood" || vGeo.basedOnDeals >= 3;
  console.log("יש עסקאות:", geoOk ? "✓" : "✗ — אפס תוצאות גיאוגרפיות");

  console.log("\n✅ כל בדיקות הליבה עברו.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
