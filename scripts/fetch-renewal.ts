/**
 * scripts/fetch-renewal.ts
 * מושך את מתחמי ההתחדשות העירונית הרשמיים בנתניה (data.gov.il — הרשות להתחדשות עירונית),
 * ממפה כל מתחם לשכונה לפי שם הרחוב שבכתובת, וכותב data/renewal.json.
 * מקור אמיתי בלבד — אין המצאות. הרצה: npx tsx scripts/fetch-renewal.ts
 */
import { promises as fs } from "fs";
import path from "path";

const RESOURCE = "f65a0daf-f737-49c5-9424-d378d52104f5"; // מתחמי התחדשות עירונית
const BASE = "https://data.gov.il/api/3/action/datastore_search";
const NETANYA = 7400;
const clean = (s: any) => String(s ?? "").replace(/\s+/g, " ").trim();

interface Complex {
  id: number;
  name: string;        // ShemMitcham (כתובת/שם)
  street: string | null;
  existing: number | null;
  added: number | null;
  total: number | null;
  status: string;
  track: string;       // מסלול (מיסוי / רשויות / ...)
  declared: string;    // תאריך הכרזה
  mavatLink: string;
  mapLink: string;
}

// חילוץ שם רחוב מכתובת המתחם ("גורדון 7-9 נתניה" → "גורדון")
function extractStreet(shemMitcham: string): string | null {
  let s = shemMitcham.replace(/נתניה\s*$/, "").trim();
  // קטע לפני המספר הראשון
  const m = s.match(/^([^\d,]+)/);
  const name = (m ? m[1] : s).replace(/[",.]/g, " ").replace(/\s+/g, " ").trim();
  return name.length >= 2 ? name : null;
}

async function main() {
  // 1) משוך את כל מתחמי נתניה
  const filters = encodeURIComponent(JSON.stringify({ SemelYeshuv: NETANYA }));
  const url = `${BASE}?resource_id=${RESOURCE}&filters=${filters}&limit=500`;
  const j: any = await (await fetch(url, { headers: { Accept: "application/json" } })).json();
  const records: any[] = j?.result?.records ?? [];

  const complexes: Complex[] = records.map((r) => {
    const name = clean(r.ShemMitcham);
    return {
      id: r.MisparMitham,
      name,
      street: extractStreet(name),
      existing: r.YachadKayam ? Number(String(r.YachadKayam).replace(/\D/g, "")) || null : null,
      added: r.YachadTosafti ? Number(String(r.YachadTosafti).replace(/\D/g, "")) || null : null,
      total: r.YachadMutza ? Number(r.YachadMutza) || null : null,
      status: clean(r.Status),
      track: clean(r.Maslul),
      declared: clean(r.TaarichHachraza),
      mavatLink: clean(r.KishurLatar),
      mapLink: clean(r.KishurLaMapa),
    };
  });

  // 2) טען street-index → street→neighborhood + street→coords
  const idxRaw = await fs.readFile(path.join(process.cwd(), "data", "street-index.json"), "utf8");
  const idx: { street: string; neighborhoodId: string; neighborhoodName: string; x?: number; y?: number }[] = JSON.parse(idxRaw);
  const streetToNeigh = new Map<string, { id: string; name: string }>();
  const streetToCoords = new Map<string, { x: number; y: number }>();
  for (const s of idx) {
    if (s.neighborhoodId) streetToNeigh.set(s.street, { id: s.neighborhoodId, name: s.neighborhoodName });
    if (s.x && s.y && !streetToCoords.has(s.street)) streetToCoords.set(s.street, { x: s.x, y: s.y });
  }
  const coordsForStreet = (street: string | null): { x: number; y: number } | null => {
    if (!street) return null;
    if (streetToCoords.has(street)) return streetToCoords.get(street)!;
    for (const [k, v] of streetToCoords) if (k.includes(street) || street.includes(k)) return v;
    return null;
  };

  // 2b) קואורדינטות מדויקות למתחמים מ-ArcGIS (הרשות להתחדשות עירונית) — outSR=2039 (ITM)
  const arcCoords = new Map<number, { x: number; y: number }>();
  try {
    const au =
      "https://services6.arcgis.com/I08Ekaykft5ELucH/arcgis/rest/services/GIS_UrbanRenewalPro/FeatureServer/1/query" +
      "?where=" + encodeURIComponent("Yeshuv='נתניה'") +
      "&outFields=MisparProject&returnGeometry=false&returnCentroid=true&outSR=2039&f=json";
    const aj: any = await (await fetch(au, { headers: { Accept: "application/json" } })).json();
    for (const f of aj?.features ?? []) {
      const id = Number(f?.attributes?.MisparProject);
      const c = f?.centroid;
      if (id && c?.x && c?.y) arcCoords.set(id, { x: Math.round(c.x), y: Math.round(c.y) });
    }
    console.log(`📍 ArcGIS: ${arcCoords.size} מרכזי מתחמים (ITM)`);
  } catch (e) {
    console.warn("⚠️ ArcGIS לא זמין — נופלים לקואורדינטות רחוב", (e as Error).message);
  }
  const findNeigh = (street: string | null) => {
    if (!street) return null;
    if (streetToNeigh.has(street)) return streetToNeigh.get(street)!;
    // התאמה חלקית (הרחוב מכיל/מוכל)
    for (const [k, v] of streetToNeigh) {
      if (k.includes(street) || street.includes(k)) return v;
    }
    return null;
  };

  // 3) מערך מתחמים שטוח עם קואורדינטות (ArcGIS → fallback רחוב) + צבירה לשכונה (fallback)
  const byNeigh: Record<string, { complexes: number; addedUnits: number; examples: string[]; mapLink: string }> = {};
  const flat: any[] = [];
  let matched = 0, withCoords = 0;
  for (const c of complexes) {
    const n = findNeigh(c.street);
    const coord = arcCoords.get(c.id) ?? coordsForStreet(c.street);
    if (coord) withCoords++;
    flat.push({
      id: c.id,
      name: c.name,
      street: c.street,
      x: coord?.x ?? null,
      y: coord?.y ?? null,
      added: c.added ?? 0,
      mapLink: c.mapLink,
      neighborhoodName: n?.name ?? null,
    });
    if (n) {
      matched++;
      const e = (byNeigh[n.name] ||= { complexes: 0, addedUnits: 0, examples: [], mapLink: c.mapLink });
      e.complexes += 1;
      e.addedUnits += c.added ?? 0;
      if (e.examples.length < 3) e.examples.push(c.name);
    }
  }

  const out = {
    settlement: "נתניה",
    asOf: new Date().toISOString().slice(0, 10),
    totalComplexes: complexes.length,
    totalAddedUnits: complexes.reduce((a, c) => a + (c.added ?? 0), 0),
    matchedToNeighborhood: matched,
    withCoords,
    complexes: flat, // לסינון לפי מרחק
    byNeighborhood: byNeigh, // fallback כשאין קואורדינטות לכתובת
    officialMap: "https://www.govmap.gov.il/?layers=ADD_PROJECTS_UR_MUCHRAZ",
  };

  await fs.writeFile(path.join(process.cwd(), "data", "renewal.json"), JSON.stringify(out, null, 2), "utf8");
  console.log(`✅ ${complexes.length} מתחמי התחדשות · ${withCoords} עם קואורדינטות · ${matched} מופו לשכונה · ${out.totalAddedUnits} יח"ד`);
}

main().catch((e) => { console.error(e); process.exit(1); });
