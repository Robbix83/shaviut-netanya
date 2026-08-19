/**
 * scripts/remap-deals.ts
 * מעדכן את neighborhoodId/neighborhoodName בכל עסקה ב-deals.json
 * לפי המיפוי המתוקן ב-street-index.json.
 * יש להריץ אחרי כל remap-streets.ts.
 * הרצה: npx tsx scripts/remap-deals.ts
 */
import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

async function main() {
  const [dealsRaw, indexRaw] = await Promise.all([
    fs.readFile(path.join(DATA_DIR, "deals.json"), "utf8"),
    fs.readFile(path.join(DATA_DIR, "street-index.json"), "utf8"),
  ]);

  const deals: any[] = JSON.parse(dealsRaw);
  const index: any[] = JSON.parse(indexRaw);

  // בנה מיפוי שם-רחוב → {neighborhoodId, neighborhoodName}
  const streetMap = new Map<string, { id: string; name: string }>();
  for (const s of index) {
    if (s.street && s.neighborhoodId) {
      streetMap.set(s.street, { id: String(s.neighborhoodId), name: s.neighborhoodName ?? "" });
    }
  }

  let changed = 0;
  const changedNeighs = new Map<string, { from: string; to: string; count: number }>();

  for (const deal of deals) {
    if (!deal.street) continue;
    const mapped = streetMap.get(deal.street);
    if (!mapped || !mapped.id) continue;

    if (deal.neighborhoodId !== mapped.id || deal.neighborhood !== mapped.name) {
      const key = `${deal.street}:${deal.neighborhood}→${mapped.name}`;
      const ex = changedNeighs.get(key);
      if (ex) ex.count++;
      else changedNeighs.set(key, { from: deal.neighborhood ?? "—", to: mapped.name, count: 1 });

      deal.neighborhoodId = mapped.id;
      deal.neighborhood   = mapped.name;
      changed++;
    }
  }

  if (changed === 0) {
    console.log("✅ כל העסקאות כבר ממופות נכון — אין שינויים.");
    return;
  }

  await fs.writeFile(path.join(DATA_DIR, "deals.json"), JSON.stringify(deals, null, 2), "utf8");

  console.log(`✅ עודכנו ${changed} עסקאות ב-deals.json\n`);
  console.log("שינויים לפי רחוב:");
  for (const [key, { from, to, count }] of [...changedNeighs.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const street = key.split(":")[0];
    console.log(`  ${street.padEnd(22)} ${from.padEnd(22)} → ${to}  (${count} עסקאות)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
