/**
 * scripts/discover-neighborhoods.ts
 * מאמת רשימת שכונות מועמדות מול ה-API של nadlan/govmap, ומחזיר את אלו שקיימות
 * עם השם הקנוני, המזהה (ObjectID) והקואורדינטות (ITM) — בלי המצאות.
 * הרצה: npx tsx scripts/discover-neighborhoods.ts
 */
const ES = "https://es.govmap.gov.il/TldSearch/api/DetailsByQuery";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.nadlan.gov.il/",
  Origin: "https://www.nadlan.gov.il",
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// מועמדות מתוך ויקיפדיה + עיריית נתניה (כולל שמות ותיקים/נרדפים)
const CANDIDATES = [
  "עיר ימים", "רמת פולג", "נוף הים", "אגמים", "קריית השרון",
  // שכונות מרכז העיר — "מרכז העיר" כשם כללי לא נמצא ב-GovMap; יש להשתמש בשמות המלאים:
  "צפון מערב מרכז העיר", "צפון מזרח מרכז העיר", "מרכז העיר דרום",
  "נאות הרצל", "נאות גנים", "נווה איתמר", "משכנות זבולון", "קריית רבין",
  "נווה עוז", "רמת אפרים", "רמת חן", "רמת ידין", "נאות שקד", "נאות גולדה",
  "קריית נורדאו", "נורדאו", "דורה", "קריית צאנז", "פרדס הגדוד", "עין התכלת",
  "נוף הטיילת", "גן ברכה", "טוברוק", "בן ציון", "גבעת האירוסים", "החוף הירוק",
  "נאות מנחם בגין", "נווה שלום", "פארק שיאים", "עמליה", "נתניה הירוקה",
];

async function resolve(name: string) {
  const url = `${ES}?query=${encodeURIComponent(name + " נתניה")}&lyrs=4&gid=nadlan`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      const ctype = res.headers.get("content-type") || "";
      if (!ctype.includes("json")) {
        await sleep(1500);
        continue;
      }
      const j: any = await res.json();
      const hit = j?.data?.NEIGHBORHOOD?.find((h: any) => String(h.ResultLable).includes("נתניה"));
      if (hit) return { name, label: hit.ResultLable, id: String(hit.ObjectID), x: hit.X, y: hit.Y };
      return null;
    } catch {
      await sleep(1500);
    }
  }
  return { name, error: true };
}

async function main() {
  const found: any[] = [];
  const missing: string[] = [];
  for (const c of CANDIDATES) {
    const r = await resolve(c);
    if (r && !(r as any).error && (r as any).id) {
      found.push(r);
      console.log(`✓ ${c.padEnd(16)} → ${(r as any).label}  id=${(r as any).id}`);
    } else {
      missing.push(c);
      console.log(`✗ ${c.padEnd(16)} (לא נמצא / שגיאה)`);
    }
    await sleep(700); // קצב מנומס
  }
  console.log(`\nנמצאו ${found.length} שכונות, לא נמצאו ${missing.length}: ${missing.join(", ")}`);
  console.log("\n=== JSON ===");
  console.log(JSON.stringify(found, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
