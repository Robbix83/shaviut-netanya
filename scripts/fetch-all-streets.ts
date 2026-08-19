/**
 * scripts/fetch-all-streets.ts
 * מושך את הרשימה הרשמית המלאה של רחובות נתניה ממשרד הפנים (data.gov.il, סמל ישוב 7400).
 * כותב data/netanya-streets-raw.json — עמוד השדרה המלא (ללא גירוד, ללא פספוסים).
 * הרצה: npx tsx scripts/fetch-all-streets.ts
 */
import { promises as fs } from "fs";
import path from "path";

const RESOURCE = "9ad3862c-8391-4b2f-84a4-2d4c68625f4b"; // רשימת רחובות בישראל - מתעדכן
const BASE = "https://data.gov.il/api/3/action/datastore_search";
const NETANYA_CODE = 7400;

interface RawRec {
  "סמל_ישוב": number;
  "שם_ישוב": string;
  "סמל_רחוב": number;
  "שם_רחוב": string;
}

async function main() {
  const all: { code: number; name: string }[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const filters = encodeURIComponent(JSON.stringify({ "סמל_ישוב": NETANYA_CODE }));
    const url = `${BASE}?resource_id=${RESOURCE}&filters=${filters}&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const j: any = await res.json();
    const records: RawRec[] = j?.result?.records ?? [];
    if (records.length === 0) break;

    for (const r of records) {
      const name = String(r["שם_רחוב"] ?? "").trim();
      // דלג על ערכים לא-רחוב (שם הישוב עצמו, ריקים)
      if (!name || name === "נתניה" || /^\d+$/.test(name)) continue;
      all.push({ code: r["סמל_רחוב"], name });
    }
    offset += records.length;
    if (records.length < pageSize) break;
  }

  // dedup לפי קוד רחוב
  const seen = new Set<number>();
  const unique = all.filter((s) => (seen.has(s.code) ? false : seen.add(s.code)));
  unique.sort((a, b) => a.name.localeCompare(b.name, "he"));

  const dir = path.join(process.cwd(), "data");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "netanya-streets-raw.json"), JSON.stringify(unique, null, 2), "utf8");

  console.log(`✅ נשמרו ${unique.length} רחובות רשמיים של נתניה ל-data/netanya-streets-raw.json`);
  console.log("דוגמאות:", unique.slice(0, 5).map((s) => s.name).join(", "));
}

main().catch((e) => { console.error(e); process.exit(1); });
