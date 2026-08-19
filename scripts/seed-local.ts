/**
 * scripts/seed-local.ts
 * ---------------------------------------------------------------------------
 * מייצר מאגר *דוגמה* מקומי (data/neighborhoods.json + data/deals.json) כדי
 * שאפשר יהיה לבדוק את כל המערכת (שווי, משפך, לידים) end-to-end לפני שהאספן
 * האמיתי (scripts/harvest.ts) רץ.
 *
 * ⚠️  הנתונים כאן הם דוגמה ריאליסטית בלבד — שמות שכונות *ורחובות* אמיתיים בנתניה
 *     (השכונות מ-discover-neighborhoods, הרחובות מ-discover-streets → data/streets.json),
 *     ומחירי מ"ר מקורבים. רק העסקאות עצמן (מחיר/שטח/תאריך) מסונתזות. ברגע שהאספן ירוץ,
 *     הוא יחליף את data/deals.json בעסקאות אמיתיות מרשות המסים (לפי אותו מבנה).
 *
 * הרצה:  npm run seed:local
 * ---------------------------------------------------------------------------
 */
import { promises as fs } from "fs";
import path from "path";
import type { Deal, Neighborhood } from "../lib/types";

// מחולל פסאודו-אקראי דטרמיניסטי (לשחזוריות)
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
const rng = makeRng(42);
const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)];
const between = (a: number, b: number) => a + rng() * (b - a);

// רחובות אמיתיים פר-שכונה (data/streets.json מ-discover-streets.ts); נטען ב-main()
let STREETS: Record<string, string[]> = {};
const pickStreet = (neighborhood: string): string | null => {
  const list = STREETS[neighborhood];
  return list && list.length ? pick(list) : null;
};

// קואורדינטות רחוב (data/street-index.json) — לקואורדינטות פר-עסקה (כדי שרדיוס יעבוד בדמו)
let STREET_COORDS: Record<string, { x: number; y: number }> = {};
const jitter = () => (rng() - 0.5) * 100; // ±50מ'
function coordFor(street: string | null, n: { x: number; y: number }): { x: number; y: number } {
  const c = street ? STREET_COORDS[street] : null;
  const base = c ?? n; // נפילה למרכז השכונה אם אין קואורדינטת רחוב
  return { x: Math.round(base.x + jitter()), y: Math.round(base.y + jitter()) };
}

// 23 שכונות נתניה אמיתיות — שמות, מזהים (UNIQ_ID של nadlan) וקואורדינטות (ITM) שאומתו
// מול ה-API של רשות המסים. מחיר מ"ר = הערכה מקורבת לדמו בלבד; הנתונים האמיתיים מגיעים מהאספן.
const NEIGHBORHOODS: Array<{
  id: string;
  name: string;
  basePpsqm: number;
  x: number;
  y: number;
}> = [
  { id: "66239260", name: "עיר ימים", basePpsqm: 38000, x: 185256, y: 687199 },
  { id: "66239258", name: "רמת פולג", basePpsqm: 37000, x: 185416, y: 686598 },
  { id: "66239231", name: "נוף הטיילת", basePpsqm: 33000, x: 185948, y: 691042 },
  { id: "66239259", name: "עין התכלת", basePpsqm: 32000, x: 187155, y: 695127 },
  { id: "66239255", name: "אגמים", basePpsqm: 29000, x: 185960, y: 688600 },
  { id: "66239285", name: "פרדס הגדוד", basePpsqm: 28000, x: 187525, y: 694547 },
  { id: "66239241", name: "קריית השרון", basePpsqm: 27000, x: 188564, y: 689934 },
  { id: "65867396", name: "גבעת האירוסים", basePpsqm: 27000, x: 185980, y: 688027 },
  { id: "65867363", name: "קריית צאנז", basePpsqm: 26000, x: 186722, y: 694515 },
  { id: "66239243", name: "קריית נורדאו", basePpsqm: 25000, x: 186297, y: 687508 },
  { id: "65867837", name: "נאות שקד", basePpsqm: 24000, x: 186070, y: 689217 },
  { id: "65867903", name: "משכנות זבולון", basePpsqm: 23000, x: 188716, y: 690626 },
  { id: "66239242", name: "רמת ידין", basePpsqm: 23000, x: 186815, y: 689377 },
  { id: "66239239", name: "נאות הרצל", basePpsqm: 22000, x: 187799, y: 693538 },
  { id: "67468648", name: "רמת חן", basePpsqm: 22000, x: 187005, y: 691135 },
  { id: "66239257", name: "קריית רבין", basePpsqm: 22000, x: 189191, y: 690298 },
  { id: "66239237", name: "רמת אפרים", basePpsqm: 21000, x: 187288, y: 692060 },
  { id: "65867357", name: "נווה איתמר", basePpsqm: 21000, x: 188349, y: 692532 },
  { id: "66239240", name: "נאות גנים (שיכון ותיקים)", basePpsqm: 20000, x: 189244, y: 691421 },
  // 4 שכונות שהתגלו בבדיקה חוזרת (חסרו ברשימה המקורית):
  { id: "66239289", name: "גלי הים", basePpsqm: 34000, x: 185626, y: 689095 },
  { id: "66239288", name: "כוכב הים", basePpsqm: 30000, x: 186135, y: 690529 },
  { id: "66239287", name: "נוף השרון", basePpsqm: 25000, x: 187402, y: 691369 },
  { id: "66239286", name: "כוכב הצפון", basePpsqm: 24000, x: 188181, y: 694102 },
  // 3 שכונות מרכז העיר — חסרו; ויצמן 98 נמצא ב"צפון מזרח מרכז העיר"
  { id: "67468658", name: "מרכז העיר דרום", basePpsqm: 24000, x: 186262, y: 692892 },
  { id: "66239254", name: "צפון מזרח מרכז העיר", basePpsqm: 26000, x: 187349, y: 693994 },
  { id: "66239238", name: "צפון מערב מרכז העיר", basePpsqm: 25000, x: 186702, y: 693193 },
];

const APT_NATURES = ["דירה בבית קומות", "דירה", "דירת גן", "פנטהאוז"];
const HOUSE_NATURES = ["בית בודד", "קוטג' חד משפחתי", "קוטג' דו משפחתי"];
const LAND_NATURES = ["מגרש", "קרקע למגורים"];

function isoDate(monthsAgo: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  d.setDate(1 + Math.floor(rng() * 27));
  return d.toISOString().slice(0, 10);
}

function round1000(n: number) {
  return Math.round(n / 1000) * 1000;
}

function genDealsForNeighborhood(n: (typeof NEIGHBORHOODS)[number]): Deal[] {
  const deals: Deal[] = [];
  const base = {
    address: null as string | null,
    neighborhoodId: n.id,
    neighborhood: n.name,
    settlement: "נתניה",
    x: n.x,
    y: n.y,
  };

  // ---- דירות (apartment) ----
  const aptCount = Math.floor(between(35, 70));
  for (let i = 0; i < aptCount; i++) {
    const rooms = pick([2, 2.5, 3, 3, 3.5, 4, 4, 4.5, 5, 5.5]);
    const areaSqm = Math.round(rooms * between(20, 26) + between(-6, 10));
    const floor = Math.floor(between(0, 14));
    const floorAdj = 1 + Math.min(floor, 10) * 0.004;
    const ppsqm = Math.round(n.basePpsqm * between(0.85, 1.18) * floorAdj);
    const street = pickStreet(n.name);
    const c = coordFor(street, n);
    deals.push({
      ...base,
      id: `${n.id}-a${i}`,
      dealDate: isoDate(Math.floor(between(0, 24))),
      price: round1000(ppsqm * areaSqm),
      propertyType: "apartment",
      rooms,
      areaSqm,
      plotSqm: null,
      floor,
      yearBuilt: Math.floor(between(1975, 2024)),
      dealNature: pick(APT_NATURES),
      street,
      houseNumber: street ? String(Math.floor(between(1, 50) * 2)) : null,
      x: c.x,
      y: c.y,
      pricePerSqm: ppsqm,
    });
  }

  // ---- בתים צמודי-קרקע (house) — מחיר/מ"ר בנוי גבוה יותר (פרמיית קרקע) ----
  const houseCount = Math.floor(between(14, 26));
  for (let i = 0; i < houseCount; i++) {
    const rooms = pick([4, 4.5, 5, 5, 5.5, 6, 6, 7]);
    const areaSqm = Math.round(between(130, 280)); // שטח בנוי
    const plotSqm = Math.round(between(220, 600)); // שטח מגרש
    const ppsqm = Math.round(n.basePpsqm * between(1.15, 1.75)); // ₪/מ"ר בנוי
    const street = pickStreet(n.name);
    const c = coordFor(street, n);
    deals.push({
      ...base,
      id: `${n.id}-h${i}`,
      dealDate: isoDate(Math.floor(between(0, 24))),
      price: round1000(ppsqm * areaSqm),
      propertyType: "house",
      rooms,
      areaSqm,
      plotSqm,
      floor: null,
      yearBuilt: Math.floor(between(1980, 2023)),
      dealNature: pick(HOUSE_NATURES),
      street,
      houseNumber: street ? String(Math.floor(between(1, 30) * 2)) : null,
      x: c.x,
      y: c.y,
      pricePerSqm: ppsqm,
    });
  }

  // ---- מגרשים/קרקע (land) — מחיר/מ"ר מגרש ----
  const landCount = Math.floor(between(8, 16));
  for (let i = 0; i < landCount; i++) {
    const plotSqm = Math.round(between(250, 700));
    const landPpsqm = Math.round(n.basePpsqm * between(0.25, 0.55)); // ₪/מ"ר מגרש
    const street = pickStreet(n.name);
    const c = coordFor(street, n);
    deals.push({
      ...base,
      id: `${n.id}-l${i}`,
      dealDate: isoDate(Math.floor(between(0, 24))),
      price: round1000(landPpsqm * plotSqm),
      propertyType: "land",
      rooms: null,
      areaSqm: null,
      plotSqm,
      floor: null,
      yearBuilt: null,
      dealNature: pick(LAND_NATURES),
      street,
      houseNumber: street ? String(Math.floor(between(1, 40) * 2)) : null,
      x: c.x,
      y: c.y,
      pricePerSqm: landPpsqm,
    });
  }

  return deals;
}

async function main() {
  const dataDir = path.join(process.cwd(), "data");
  await fs.mkdir(dataDir, { recursive: true });

  // טען רחובות אמיתיים אם קיימים (אחרת עסקאות יוצגו ללא רחוב — בלי המצאות)
  try {
    STREETS = JSON.parse(await fs.readFile(path.join(dataDir, "streets.json"), "utf8"));
    const total = Object.values(STREETS).reduce((a, s) => a + s.length, 0);
    console.log(`📍 נטענו ${total} רחובות אמיתיים מ-data/streets.json`);
  } catch {
    console.log("ℹ️  אין data/streets.json — הריצו 'npx tsx scripts/discover-streets.ts' לרחובות אמיתיים");
  }

  // טען קואורדינטות רחוב (street-index.json) — לקואורדינטות פר-עסקה
  try {
    const idx: any[] = JSON.parse(await fs.readFile(path.join(dataDir, "street-index.json"), "utf8"));
    for (const s of idx) if (s.x && s.y && !STREET_COORDS[s.street]) STREET_COORDS[s.street] = { x: s.x, y: s.y };
    console.log(`📍 נטענו קואורדינטות ל-${Object.keys(STREET_COORDS).length} רחובות`);
  } catch {
    console.log("ℹ️  אין street-index.json — עסקאות יקבלו קואורדינטת מרכז-שכונה");
  }

  const neighborhoods: Neighborhood[] = NEIGHBORHOODS.map((n) => ({
    id: n.id,
    name: n.name,
    settlement: "נתניה",
    x: n.x,
    y: n.y,
  }));

  let deals: Deal[] = [];
  for (const n of NEIGHBORHOODS) deals = deals.concat(genDealsForNeighborhood(n));

  await fs.writeFile(
    path.join(dataDir, "neighborhoods.json"),
    JSON.stringify(neighborhoods, null, 2),
    "utf8",
  );
  await fs.writeFile(path.join(dataDir, "deals.json"), JSON.stringify(deals, null, 2), "utf8");

  console.log(`✅ נכתבו ${neighborhoods.length} שכונות ו-${deals.length} עסקאות דוגמה ל-/data`);
  console.log("⚠️  נתוני דוגמה בלבד — הריצו את scripts/harvest.ts לנתונים אמיתיים.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
