/**
 * scripts/discover-streets.ts
 * מושך רחובות אמיתיים לכל שכונה מה-autocomplete של nadlan/govmap
 * (פורמט התוצאה: "<שכונה> <רחוב> נתניה"), וכותב data/streets.json.
 * לא חסום ב-reCAPTCHA. הרצה: npx tsx scripts/discover-streets.ts
 */
import { promises as fs } from "fs";
import path from "path";

const ES = "https://es.govmap.gov.il/TldSearch/api/AutoComplete";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.nadlan.gov.il/",
  Origin: "https://www.nadlan.gov.il",
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SUFFIX = " נתניה";

// seedName = השם כפי שמופיע בסיד; query = השם לחיפוש ב-API
const NEIGHBORHOODS: Array<{ seedName: string; query: string }> = [
  { seedName: "עיר ימים", query: "עיר ימים" },
  { seedName: "רמת פולג", query: "רמת פולג" },
  { seedName: "נוף הטיילת", query: "נוף הטיילת" },
  { seedName: "עין התכלת", query: "עין התכלת" },
  { seedName: "אגמים", query: "אגמים" },
  { seedName: "פרדס הגדוד", query: "פרדס הגדוד" },
  { seedName: "קריית השרון", query: "קריית השרון" },
  { seedName: "גבעת האירוסים", query: "גבעת האירוסים" },
  { seedName: "קריית צאנז", query: "קריית צאנז" },
  { seedName: "קריית נורדאו", query: "קריית נורדאו" },
  { seedName: "נאות שקד", query: "נאות שקד" },
  { seedName: "משכנות זבולון", query: "משכנות זבולון" },
  { seedName: "רמת ידין", query: "רמת ידין" },
  { seedName: "נאות הרצל", query: "נאות הרצל" },
  { seedName: "רמת חן", query: "רמת חן" },
  { seedName: "קריית רבין", query: "קריית רבין" },
  { seedName: "רמת אפרים", query: "רמת אפרים" },
  { seedName: "נווה איתמר", query: "נווה איתמר" },
  { seedName: "נאות גנים (שיכון ותיקים)", query: "נאות גנים" },
];

async function queryStreets(q: string): Promise<string[]> {
  const url = `${ES}?query=${encodeURIComponent(q)}&ids=276267023&gid=govmap`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!(res.headers.get("content-type") || "").includes("json")) { await sleep(1200); continue; }
      const j: any = await res.json();
      return (j?.res?.STREET || []).map((s: any) => String(s.Value));
    } catch { await sleep(1200); }
  }
  return [];
}

// מחלץ שם רחוב מ-"<שכונה> <רחוב> נתניה"
function extract(values: string[], neigh: string): string[] {
  return values
    .filter((v) => v.startsWith(neigh + " ") && v.endsWith(SUFFIX))
    .map((v) => v.slice(neigh.length + 1, v.length - SUFFIX.length).trim())
    .filter(Boolean);
}

async function streetsFor(q: string): Promise<string[]> {
  const set = new Set<string>(extract(await queryStreets(q), q));
  // העשרה: לשכונות עם מעט תוצאות, נשאל לפי אות פותחת
  if (set.size < 6) {
    for (const letter of ["א", "ה", "ב", "מ", "ש", "ר", "י", "ד"]) {
      if (set.size >= 12) break;
      await sleep(550);
      extract(await queryStreets(`${q} ${letter}`), q).forEach((s) => set.add(s));
    }
  }
  return Array.from(set).slice(0, 12);
}

async function main() {
  const out: Record<string, string[]> = {};
  for (const n of NEIGHBORHOODS) {
    const streets = await streetsFor(n.query);
    out[n.seedName] = streets;
    console.log(`${n.seedName.padEnd(26)} → ${streets.length} רחובות: ${streets.slice(0, 5).join(", ")}${streets.length > 5 ? "…" : ""}`);
    await sleep(700);
  }
  const dir = path.join(process.cwd(), "data");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "streets.json"), JSON.stringify(out, null, 2), "utf8");
  const total = Object.values(out).reduce((a, s) => a + s.length, 0);
  console.log(`\n✅ נכתבו ${total} רחובות אמיתיים ל-data/streets.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
