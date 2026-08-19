/**
 * scripts/fetch-poi.ts  —  ארוסט נקודות-עניין (תשתיות) לנתניה ל-data/poi.json
 * ---------------------------------------------------------------------------
 * אוסף תחנות רכבת, תחנות אוטובוס, בתי ספר ופארקים בתוך גבולות נתניה
 * ממקור פתוח חופשי (OpenStreetMap דרך Overpass API — ללא token, ללא reCAPTCHA).
 * הקואורדינטות מומרות מ-WGS84 ל-ITM כדי להתאים לחישובי המרחק הקיימים (itmDistance).
 *
 * למה לאסוף מראש ולא בזמן-אמת:
 *   נתוני POI כמעט-סטטיים, וכך נמנעים מ-rate-limit ומ-token בכל טעינת כרטיס.
 *   זהה לדפוס של neighborhoods.json / deals.json.
 *
 * הרצה:
 *   npm run fetch:poi
 *   DATA_SOURCE=supabase npm run fetch:poi   (אם תרצו להעלות לטבלת pois)
 * ---------------------------------------------------------------------------
 */
import { promises as fs } from "fs";
import path from "path";
import { wgs84ToItm } from "../lib/govmap";
import type { Poi } from "../lib/govmap";

const DATA_DIR = path.join(process.cwd(), "data");
const OVERPASS = "https://overpass-api.de/api/interpreter";

// גבולות נתניה (WGS84) — מלבן נדיב סביב העיר (דרום-מערב → צפון-מזרח)
const BBOX = { s: 32.27, w: 34.82, n: 32.36, e: 34.90 };

/**
 * שאילתת Overpass אחת לכל הקטגוריות.
 *  - רכבת:   railway=station/halt (כולל הקו המהיר נתניה/ספיר)
 *  - אוטובוס: highway=bus_stop, public_transport=platform עם bus=yes
 *  - בית ספר: amenity=school
 *  - פארק:    leisure=park / leisure=garden
 */
function buildQuery(): string {
  const b = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`;
  return `[out:json][timeout:60];
(
  node["railway"~"^(station|halt)$"](${b});
  way["railway"~"^(station|halt)$"](${b});
  node["highway"="bus_stop"](${b});
  node["public_transport"="platform"]["bus"="yes"](${b});
  node["amenity"="school"](${b});
  way["amenity"="school"](${b});
  node["leisure"~"^(park|garden)$"](${b});
  way["leisure"~"^(park|garden)$"](${b});
);
out center tags;`;
}

type Cat = Poi["category"];

function classify(tags: Record<string, string>): Cat | null {
  if (tags.railway === "station" || tags.railway === "halt") return "train";
  if (tags.highway === "bus_stop" || (tags.public_transport === "platform" && tags.bus === "yes")) return "bus";
  if (tags.amenity === "school") return "school";
  if (tags.leisure === "park" || tags.leisure === "garden") return "park";
  return null;
}

interface OverpassElement {
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function main() {
  console.log("\n🔎 שולף נקודות-עניין לנתניה מ-OpenStreetMap (Overpass)…");
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "shaviut-netanya/1.0 (real-estate lead tool; contact via github)",
      "Accept": "application/json",
    },
    body: "data=" + encodeURIComponent(buildQuery()),
  });
  if (!res.ok) {
    console.error(`❌ Overpass HTTP ${res.status}. נסו שוב מאוחר יותר (שרת ציבורי עמוס).`);
    process.exit(1);
  }
  const json = (await res.json()) as { elements: OverpassElement[] };

  const counts: Record<Cat, number> = { train: 0, bus: 0, school: 0, park: 0 };
  const pois: Poi[] = [];
  for (const el of json.elements ?? []) {
    const tags = el.tags ?? {};
    const category = classify(tags);
    if (!category) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const { x, y } = wgs84ToItm(lat, lon);
    pois.push({ category, name: tags["name:he"] ?? tags.name ?? null, x, y });
    counts[category]++;
  }

  console.log(
    `\n📊 נאספו ${pois.length} נקודות:  🚆 ${counts.train}  🚌 ${counts.bus}  🏫 ${counts.school}  🌳 ${counts.park}`,
  );
  if (pois.length === 0) {
    console.error("❌ לא נאספו נקודות — בדקו את ה-bbox או נסו שוב.");
    process.exit(1);
  }
  if (counts.train === 0) {
    console.warn("⚠️  לא נמצאו תחנות רכבת ב-bbox — שווה לאמת את גבולות העיר.");
  }

  if (process.env.DATA_SOURCE === "supabase") {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    await sb.from("pois").delete().neq("category", "");
    for (let i = 0; i < pois.length; i += 500) await sb.from("pois").insert(pois.slice(i, i + 500));
    console.log(`✅ הועלו ${pois.length} נקודות ל-Supabase (טבלת pois).`);
  } else {
    await fs.writeFile(path.join(DATA_DIR, "poi.json"), JSON.stringify(pois, null, 2), "utf8");
    console.log(`✅ נכתבו ${pois.length} נקודות ל-data/poi.json`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
