/**
 * lib/cbs.ts
 * פרופיל חברתי-כלכלי לפי נתוני מפקד 2022 (למ"ס / CBS).
 * מקור: data/cbs-netanya.json (נאסף ע"י npm run fetch:cbs).
 *
 * מיפוי שכונות → אזורים סטטיסטיים:
 *  - קריית צאנז → 223  (מאפיינים חרדיים: גיל חציוני 19, השכלה 5.4%, שכר 64K)
 *  - שאר השכונות → ממוצע עירוני (approximate=true)
 *  לשיפור: יש לקבל קובץ פוליגונים מ-CBS ולחשב intersection עם קואורדינטות הנכס.
 */

import { promises as fs } from "fs";
import path from "path";

// ───────── types ─────────

export interface CbsRaw {
  statArea:    number | null;
  statAreaCmb: string | null;
  pop:         number | null;
  density:     number | null;
  ageMedian:   number | null;
  age0_19:     number;
  age20_64:    number;
  age65:       number;
  academicPct: number;
  medWage:     number | null;
  ownPct:      number;
  wrkPct:      number;
}

export interface CbsProfile {
  /** ציון חברתי-כלכלי 1–10 (מחושב מנתוני השכר וההשכלה, יחסי לנתניה) */
  score:       number;
  /** "high" = אזור סטטיסטי ספציפי | "city" = ממוצע עירוני */
  precision:   "high" | "city";
  statArea:    number | null;
  pop:         number | null;
  density:     number | null;
  ageMedian:   number | null;
  age0_19:     number;
  age20_64:    number;
  age65:       number;
  academicPct: number;
  medWage:     number | null;
  ownPct:      number;
  /** ממוצע עירוני — לפרספקטיבה */
  cityMedWage: number | null;
}

// ───────── static neighborhood → stat-area map ─────────

/** מיפוי שכונה → רשימת אזורים סטטיסטיים. null = השתמש בממוצע עירוני. */
const NH_MAP: Record<string, number[] | null> = {
  "קריית צאנז": [223],   // ודאי: מאפיינים דמוגרפיים ייחודיים חרדיים
};

// ───────── data loading ─────────

let _data: { city: CbsRaw | null; statAreas: CbsRaw[] } | null = null;

async function loadData() {
  if (_data) return _data;
  try {
    const raw = await fs.readFile(
      path.join(process.cwd(), "data", "cbs-netanya.json"),
      "utf8",
    );
    _data = JSON.parse(raw);
  } catch {
    _data = { city: null, statAreas: [] };
  }
  return _data!;
}

// ───────── scoring ─────────

/**
 * ציון חברתי-כלכלי 1–10 לפי שכר חציוני + השכלה אקדמית.
 * מכויל לטווח נתניה (שכר: 64K–178K, השכלה: 5%–44%).
 */
function computeScore(wage: number | null, academic: number): number {
  const MIN_WAGE = 64_000, MAX_WAGE = 178_000;
  const MIN_ACAD = 5,      MAX_ACAD = 44;

  const wScore = wage != null
    ? (wage - MIN_WAGE) / (MAX_WAGE - MIN_WAGE) * 10
    : 5;
  const aScore = (academic - MIN_ACAD) / (MAX_ACAD - MIN_ACAD) * 10;

  const raw = 0.6 * wScore + 0.4 * aScore;
  return Math.max(1, Math.min(10, Math.round(raw * 2) / 2));
}

/** ממוצע משוקלל של מספר אזורים סטטיסטיים לפי גודל אוכלוסייה */
function aggregateSAs(areas: CbsRaw[]): CbsRaw {
  const totalPop = areas.reduce((s, a) => s + (a.pop ?? 0), 0) || 1;
  const w = (a: CbsRaw) => (a.pop ?? 0) / totalPop;
  return {
    statArea:    areas[0].statArea,
    statAreaCmb: areas.map((a) => a.statArea).join("+"),
    pop:         areas.reduce((s, a) => s + (a.pop ?? 0), 0),
    density:     null,
    ageMedian:   Math.round(areas.reduce((s, a) => s + (a.ageMedian ?? 0) * w(a), 0)),
    age0_19:     +areas.reduce((s, a) => s + a.age0_19 * w(a), 0).toFixed(1),
    age20_64:    +areas.reduce((s, a) => s + a.age20_64 * w(a), 0).toFixed(1),
    age65:       +areas.reduce((s, a) => s + a.age65 * w(a), 0).toFixed(1),
    academicPct: +areas.reduce((s, a) => s + a.academicPct * w(a), 0).toFixed(1),
    medWage:     Math.round(areas.reduce((s, a) => s + (a.medWage ?? 0) * w(a), 0)) || null,
    ownPct:      +areas.reduce((s, a) => s + a.ownPct * w(a), 0).toFixed(1),
    wrkPct:      +areas.reduce((s, a) => s + a.wrkPct * w(a), 0).toFixed(1),
  };
}

// ───────── main export ─────────

export async function getNeighborhoodProfile(
  neighborhood: string | null,
): Promise<CbsProfile | null> {
  const data = await loadData();
  if (!data.city && !data.statAreas.length) return null;

  const cityRaw = data.city;

  // חפש מיפוי ספציפי לשכונה
  const mapped = neighborhood ? NH_MAP[neighborhood] : undefined;

  let raw: CbsRaw | null = null;
  let precision: "high" | "city" = "city";

  if (mapped !== undefined && mapped !== null) {
    // אזורים סטטיסטיים ספציפיים
    const areas = data.statAreas.filter((a) => mapped.includes(a.statArea ?? -1));
    if (areas.length) {
      raw = areas.length === 1 ? areas[0] : aggregateSAs(areas);
      precision = "high";
    }
  }

  // fallback: ממוצע עירוני
  if (!raw) raw = cityRaw;
  if (!raw) return null;

  return {
    score:       computeScore(raw.medWage, raw.academicPct),
    precision,
    statArea:    raw.statArea,
    pop:         raw.pop,
    density:     raw.density ?? cityRaw?.density ?? null,
    ageMedian:   raw.ageMedian,
    age0_19:     raw.age0_19,
    age20_64:    raw.age20_64,
    age65:       raw.age65,
    academicPct: raw.academicPct,
    medWage:     raw.medWage,
    ownPct:      raw.ownPct,
    cityMedWage: cityRaw?.medWage ?? null,
  };
}
