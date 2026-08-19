/**
 * קליינט קל-משקל לשירותי החיפוש הציבוריים של govmap (כפי ש-nadlan.gov.il משתמש בהם).
 * משמש בזמן בקשה: השלמת כתובות + המרת כתובת לקואורדינטות ITM.
 * נפח נמוך (קריאה אחת לכל הגשת טופס) ולכן rate-limit אינו בעיה.
 * זהירות: השרתים מגבילים קצב — לכן הקבצים הכבדים (העסקאות) נאספים מראש ל-DB (ראו scripts/harvest.ts).
 */

const ES_BASE = "https://es.govmap.gov.il/TldSearch";
const COMMON_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.nadlan.gov.il/",
  Origin: "https://www.nadlan.gov.il",
};

export interface AddressSuggestion {
  key: string;
  label: string;
  type: "STREET" | "NEIGHBORHOOD" | "POI_MID_POINT" | "ADDRESS" | "SETTLEMENT";
}

const _cache = new Map<string, { at: number; val: unknown }>();
const TTL = 1000 * 60 * 30; // 30 דק'

async function cachedFetchJson<T>(url: string): Promise<T | null> {
  const hit = _cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.val as T;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { headers: COMMON_HEADERS, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") || "";
    if (!ctype.includes("json")) return null; // התקבל HTML (שגיאה/חסימה)
    const val = (await res.json()) as T;
    _cache.set(url, { at: Date.now(), val });
    return val;
  } catch {
    return null;
  }
}

interface AutoCompleteRes {
  res: Record<string, { Key: string; Value: string }[]> | null;
  order: string[];
}

/** השלמת כתובות: מחזיר הצעות, מסונן לנתניה כברירת מחדל.
 *  ids=276267023 = שכבת רחובות ישראל (מוחזרים כסוג STREET).
 */
export async function autocomplete(
  query: string,
  settlementFilter = "נתניה",
): Promise<AddressSuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  // ids=276267023 מחזיר רחובות מכל הארץ — נסנן לנתניה
  const url = `${ES_BASE}/api/AutoComplete?query=${encodeURIComponent(q)}&ids=276267023&gid=govmap`;
  const data = await cachedFetchJson<AutoCompleteRes>(url);
  if (!data?.res) return [];
  const out: AddressSuggestion[] = [];
  const seen = new Set<string>();
  for (const type of ["STREET", "NEIGHBORHOOD", ...(data.order || [])]) {
    for (const item of data.res[type] || []) {
      if (settlementFilter && !item.Value.includes(settlementFilter)) continue;
      if (seen.has(item.Key)) continue;
      seen.add(item.Key);
      // הסרת " נתניה" מהסוף להצגה נקייה
      const label = item.Value.replace(/,?\s*נתניה$/, "").trim();
      out.push({ key: item.Key, label, type: type as AddressSuggestion["type"] });
    }
  }
  return out.slice(0, 10);
}

export interface ResolvedPoint {
  label: string;
  x: number;
  y: number;
  objectId: string;
}

interface DetailsRes {
  data: Record<string, { X: number; Y: number; ResultLable: string; ObjectID: string }[]>;
  order: string[];
  Error: number;
}

/**
 * המרת טקסט כתובת לקואורדינטות ITM + תווית.
 * lyrs=16399 מכסה כתובות/רחובות, gid=govmap.
 */
export async function resolvePoint(query: string): Promise<ResolvedPoint | null> {
  const q = query.trim();
  if (!q) return null;
  const url = `${ES_BASE}/api/DetailsByQuery?query=${encodeURIComponent(q)}&lyrs=16399&gid=govmap`;
  const data = await cachedFetchJson<DetailsRes>(url);
  if (!data?.data) return null;
  for (const type of data.order || Object.keys(data.data)) {
    const first = data.data[type]?.[0];
    if (first && first.X && first.Y) {
      return { label: first.ResultLable, x: first.X, y: first.Y, objectId: String(first.ObjectID) };
    }
  }
  return null;
}

/** מרחק ITM (מטרים) בין שתי נקודות */
export function itmDistance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x1 - x2, y1 - y2);
}

/**
 * המרת קואורדינטות WGS84 (lat/lon, EPSG:4326) ל-Israeli TM Grid (EPSG:2039) במטרים.
 * נחוץ מכיוון שמקורות פתוחים (OSM/GTFS) נותנים lat/lon, ואילו כל החישובים אצלנו ב-ITM.
 * נוסחת Transverse Mercator קדמית (Snyder) עם פרמטרי ITM הרשמיים על אליפסואיד GRS80.
 * דיוק: ס"מ בודדים — יותר ממספיק לחישובי מרחק להליכה.
 * ⚠️ לאחר ה-harvest כדאי לאמת מול נקודה ידועה (למשל תחנת רכבת נתניה ≈ x≈187200,y≈692600).
 */
export function wgs84ToItm(lat: number, lon: number): { x: number; y: number } {
  const a = 6378137.0;                  // GRS80 חצי-ציר ראשי
  const e2 = 0.00669438002290;          // אקסצנטריות בריבוע (GRS80)
  const k0 = 1.0000067;                 // מקדם קנה-מידה
  const lat0 = 31.734393515 * Math.PI / 180; // קו-רוחב מקור
  const lon0 = 35.204516944 * Math.PI / 180; // מרידיאן מרכזי
  const FE = 219529.584;                // מזרח מדומה
  const FN = 626907.390;                // צפון מדומה

  const phi = lat * Math.PI / 180;
  const lam = lon * Math.PI / 180;
  const ep2 = e2 / (1 - e2);

  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = (lam - lon0) * Math.cos(phi);

  const M = (p: number) =>
    a * (
      (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * p
      - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * p)
      + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * p)
      - (35 * e2 ** 3 / 3072) * Math.sin(6 * p)
    );

  const x = FE + k0 * N * (
    A + (1 - T + C) * A ** 3 / 6
    + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120
  );
  const y = FN + k0 * (
    M(phi) - M(lat0)
    + N * Math.tan(phi) * (
      A ** 2 / 2
      + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
      + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720
    )
  );
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

// ===== נגישות / מיקום ותשתיות =====

/** קטגוריות נקודות-עניין שמוצגות בכרטיס הליד */
export type PoiCategory = "train" | "bus" | "school" | "park";

/** נקודת-עניין מנורמלת (קואורדינטות ITM) — נאספת מראש ל-data/poi.json */
export interface Poi {
  category: PoiCategory;
  name: string | null;
  x: number; // ITM
  y: number;
}

/** מרחק לנקודה הקרובה ביותר בקטגוריה */
export interface NearestPoi {
  category: PoiCategory;
  name: string | null;
  distanceMeters: number; // מרחק אווירי (ITM)
  found: boolean;
}

export interface AccessibilityResult {
  /** ציון נגישות כולל 1–10 */
  score: number;
  nearest: NearestPoi[]; // לפי הסדר: train, bus, school, park
}

/**
 * סף מרחק (מטרים) לכל קטגוריה: near=ציון 10, far=ציון 0 (אינטרפולציה ליניארית).
 * נגזר מהיגיון הליכתי (תחנת אוטובוס קרובה=מצוין; רכבת סובלת מרחק גדול יותר).
 */
const POI_THRESHOLDS: Record<PoiCategory, { near: number; far: number; label: string; icon: string }> = {
  train:  { near: 800, far: 5000, label: "תחנת רכבת",   icon: "🚆" },
  bus:    { near: 200, far: 1000, label: "תחנת אוטובוס", icon: "🚌" },
  school: { near: 400, far: 1500, label: "בית ספר",      icon: "🏫" },
  park:   { near: 300, far: 1200, label: "פארק",         icon: "🌳" },
};

export const POI_META = POI_THRESHOLDS;

function subScore(cat: PoiCategory, dist: number): number {
  const { near, far } = POI_THRESHOLDS[cat];
  if (dist <= near) return 10;
  if (dist >= far) return 0;
  return 10 * (far - dist) / (far - near);
}

/**
 * מחשב את הנקודה הקרובה ביותר בכל קטגוריה ואת ציון הנגישות הכולל (1–10).
 * הציון הוא ממוצע תת-הציונים של ארבע הקטגוריות (קטגוריה ללא נתון = 0).
 * שקוף ונגזר ישירות ממרחקים אמיתיים — אינו "נתון מומצא".
 */
export function computeAccessibility(x: number, y: number, pois: Poi[]): AccessibilityResult {
  const cats: PoiCategory[] = ["train", "bus", "school", "park"];
  const nearest: NearestPoi[] = cats.map((category) => {
    let best: Poi | null = null;
    let bestDist = Infinity;
    for (const p of pois) {
      if (p.category !== category) continue;
      const d = itmDistance(x, y, p.x, p.y);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    return best
      ? { category, name: best.name, distanceMeters: Math.round(bestDist), found: true }
      : { category, name: null, distanceMeters: 0, found: false };
  });

  const avg = nearest.reduce(
    (sum, n) => sum + (n.found ? subScore(n.category, n.distanceMeters) : 0), 0,
  ) / cats.length;
  // עיגול לחצי נקודה, מינימום 1 כשיש לפחות נתון אחד
  const hasAny = nearest.some((n) => n.found);
  const score = hasAny ? Math.max(1, Math.round(avg * 2) / 2) : 0;

  return { score, nearest };
}

/**
 * כתובת iframe של govmap הממורכזת על נקודה (ITM) — ללא token.
 * c=מרכז(x,y) · z=רמת זום · b=רקע. הצגת מיקום הנכס על מפת המדינה הרשמית.
 */
export function govmapEmbedUrl(x: number, y: number, zoom = 8): string {
  return `https://www.govmap.gov.il/?c=${Math.round(x)},${Math.round(y)}&z=${zoom}&b=0`;
}

export interface NeighborhoodPin {
  id: string;
  name: string;
  x: number;
  y: number;
}

/**
 * מוצאת את השכונה הקרובה ביותר לנקודה נתונה (קואורדינטות ITM).
 * מחזירה null אם אין שכונות זמינות, או אם המרחק עולה על maxDistMeters.
 */
export function nearestNeighborhood(
  x: number,
  y: number,
  neighborhoods: NeighborhoodPin[],
  maxDistMeters = 3500,
): NeighborhoodPin | null {
  let best: NeighborhoodPin | null = null;
  let bestDist = Infinity;
  for (const n of neighborhoods) {
    const d = itmDistance(x, y, n.x, n.y);
    if (d < bestDist) { bestDist = d; best = n; }
  }
  return bestDist <= maxDistMeters ? best : null;
}
