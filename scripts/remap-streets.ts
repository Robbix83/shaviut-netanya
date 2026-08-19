/**
 * scripts/remap-streets.ts
 * ממפה מחדש את כל הרחובות עם קואורדינטות (street-index.json) לשכונה הקרובה ביותר,
 * מול רשימת השכונות המעודכנת (data/neighborhoods.json). חישוב מקומי — ללא govmap.
 * משמש אחרי הוספת שכונות חדשות כדי לתקן מיפויים שגויים.
 * הרצה: npx tsx scripts/remap-streets.ts
 */
import { promises as fs } from "fs";
import path from "path";

interface Neigh { id: string; name: string; x?: number; y?: number }
interface Street { street: string; code?: number; neighborhoodId: string; neighborhoodName: string; x: number | null; y: number | null }

const dist = (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x1 - x2, y1 - y2);

async function main() {
  const dir = path.join(process.cwd(), "data");
  const neighborhoods: Neigh[] = JSON.parse(await fs.readFile(path.join(dir, "neighborhoods.json"), "utf8"));
  const streets: Street[] = JSON.parse(await fs.readFile(path.join(dir, "street-index.json"), "utf8"));
  const pins = neighborhoods.filter((n) => n.x && n.y);

  const nearest = (x: number, y: number) => {
    let best: Neigh | null = null, bd = Infinity;
    for (const n of pins) { const d = dist(x, y, n.x!, n.y!); if (d < bd) { bd = d; best = n; } }
    return bd < 5000 ? best : null;
  };

  let changed = 0, mapped = 0, stillUnmapped = 0;
  const changes: string[] = [];
  for (const s of streets) {
    if (s.x == null || s.y == null) { stillUnmapped++; continue; }
    const n = nearest(s.x, s.y);
    if (n) {
      if (n.name !== s.neighborhoodName) {
        changed++;
        if (changes.length < 25) changes.push(`  ${s.street}: ${s.neighborhoodName || "—"} → ${n.name}`);
      }
      s.neighborhoodId = n.id;
      s.neighborhoodName = n.name;
      mapped++;
    } else { stillUnmapped++; }
  }

  // כתוב street-index.json + streets.json (neighborhood → [streets])
  const byNeigh: Record<string, string[]> = {};
  for (const s of streets) {
    if (!s.neighborhoodName) continue;
    (byNeigh[s.neighborhoodName] ||= []).push(s.street);
  }
  for (const k of Object.keys(byNeigh)) byNeigh[k] = Array.from(new Set(byNeigh[k])).sort((a, b) => a.localeCompare(b, "he"));

  await fs.writeFile(path.join(dir, "street-index.json"), JSON.stringify(streets, null, 2), "utf8");
  await fs.writeFile(path.join(dir, "streets.json"), JSON.stringify(byNeigh, null, 2), "utf8");

  console.log(`✅ מופו מחדש ${mapped} רחובות מול ${pins.length} שכונות | שונו: ${changed} | ללא קואורדינטות: ${stillUnmapped}`);
  console.log(`שכונות עם רחובות: ${Object.keys(byNeigh).length}`);
  if (changes.length) { console.log("\nדוגמאות לשינויים (תיקוני שיוך):"); changes.forEach((c) => console.log(c)); }
  // ספירה לשכונות החדשות
  console.log("\nרחובות שעברו לשכונות החדשות:");
  for (const nm of ["גלי הים", "כוכב הים", "נוף השרון", "כוכב הצפון"]) {
    console.log(`  ${nm}: ${(byNeigh[nm] || []).length}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
