/**
 * scripts/enrich-coords.ts
 * ---------------------------------------------------------------------------
 * מתקן קואורדינטות של עסקאות קיימות ב-deals.json:
 * החליף קואורדינטת מרכז-שכונה → קואורדינטת מרכז-רחוב (מ-street-index.json).
 *
 * למה זה נחוץ: ה-harvest הישן שמר x/y = מרכז השכונה לכל עסקה.
 * כתוצאה, סינון "אותו בניין/רחוב" בחישוב השווי לא עבד — כל העסקאות
 * נראו "רחוקות" מהרחוב שנבחר.
 *
 * הרצה:
 *   npx tsx scripts/enrich-coords.ts                  # מקומי (data/deals.json)
 *   DATA_SOURCE=supabase npx tsx scripts/enrich-coords.ts  # Supabase
 * ---------------------------------------------------------------------------
 */
import { promises as fs } from "fs";
import path from "path";
import type { Deal } from "../lib/types";

const DATA_DIR = path.join(process.cwd(), "data");

async function main() {
  // טען מפת רחוב → קואורדינטות
  let streetCoords: Record<string, { x: number; y: number }> = {};
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, "street-index.json"), "utf8");
    const arr: any[] = JSON.parse(raw);
    for (const s of arr) {
      if (s.street && typeof s.x === "number" && typeof s.y === "number") {
        streetCoords[s.street] = { x: s.x, y: s.y };
      }
    }
    console.log(`📍 נטענו קואורדינטות ל-${Object.keys(streetCoords).length} רחובות`);
  } catch {
    console.error("❌ לא נמצא data/street-index.json — הריצו 'npx tsx scripts/fetch-all-streets.ts' תחילה");
    process.exit(1);
  }

  if (process.env.DATA_SOURCE === "supabase") {
    await enrichSupabase(streetCoords);
  } else {
    await enrichLocal(streetCoords);
  }
}

async function enrichLocal(streetCoords: Record<string, { x: number; y: number }>) {
  const deals: Deal[] = JSON.parse(await fs.readFile(path.join(DATA_DIR, "deals.json"), "utf8"));

  let enriched = 0, skipped = 0;
  for (const d of deals) {
    if (d.street && streetCoords[d.street]) {
      d.x = streetCoords[d.street].x;
      d.y = streetCoords[d.street].y;
      enriched++;
    } else {
      skipped++;
    }
  }

  await fs.writeFile(path.join(DATA_DIR, "deals.json"), JSON.stringify(deals, null, 2), "utf8");
  console.log(`✅ עודכנו ${enriched} עסקאות עם קואורדינטות רחוב (${skipped} ללא רחוב — נשארו כמרכז שכונה)`);
}

async function enrichSupabase(streetCoords: Record<string, { x: number; y: number }>) {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // קרא את כל הרחובות הייחודיים שיש להם קואורדינטות
  const streets = Object.keys(streetCoords);
  let totalUpdated = 0;

  // עדכן במנות לפי רחוב
  for (let i = 0; i < streets.length; i += 50) {
    const batch = streets.slice(i, i + 50);
    for (const street of batch) {
      const { x, y } = streetCoords[street];
      const { count } = await sb
        .from("deals")
        .update({ x, y })
        .eq("street", street)
        .select("id", { count: "exact", head: true });
      totalUpdated += count ?? 0;
    }
    process.stdout.write(`\r   ${Math.min(i + 50, streets.length)}/${streets.length} רחובות...`);
  }
  console.log(`\n✅ עודכנו ~${totalUpdated} עסקאות ב-Supabase`);
}

main().catch((e) => { console.error(e); process.exit(1); });
