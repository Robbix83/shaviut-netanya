/**
 * lib/mavat.ts
 * MAVAT (מערכת מידע תכנוני) — תכניות בנייה פעילות וייעודי קרקע לכתובת נתונה.
 * שירות: PlanningPublic/Xplan/MapServer (ags.iplan.gov.il)
 * Layer 1: תכניות (קוים כחולים)   Layer 3: ישויות פוליגונליות   Layer 4: יעודי קרקע
 */

const BASE = "https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/Xplan/MapServer";
const HEADERS = {
  "User-Agent":        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Referer":           "https://mavat.iplan.gov.il/",
  "Origin":            "https://mavat.iplan.gov.il",
  "Accept":            "application/json",
  "X-Requested-With":  "XMLHttpRequest",
};

// ────────────────────────── types ──────────────────────────

export type PlanStatus = "תקפה" | "הופקדה" | "אושרה" | "בהכנה" | "נדחתה" | "בוטלה" | "אחר";

export interface PlanEntry {
  id:          string;
  name:        string;
  number:      string;
  type:        string;  // תכנית מפורטת / מיתאר / etc.
  status:      PlanStatus;
  statusRaw:   string;
  newUnits:    number | null; // quantity_delta_105 — יח"ד מגורים נוספות
  landUse:     string | null;
  objectives:  string | null;
  url:         string | null;
  lastUpdated: string | null;
}

export interface DemolitionEntity {
  planName:   string;
  planNumber: string;
  entityType: string; // mavat_name
  status:     string;
}

export interface LandUseZone {
  planName:   string;
  zoneCode:   number;
  zoneName:   string;
  status:     string;
}

export interface MavatData {
  x: number;
  y: number;
  plans:       PlanEntry[];
  demolitions: DemolitionEntity[];
  landUses:    LandUseZone[];
  /** עלייה פוטנציאלית בערך: יש תכנית עם יח"ד חדשות באזור */
  potentialValueIncrease: boolean;
  hasDemolition:          boolean;
  mavat_url:              string;
}

// ────────────────────────── cache ──────────────────────────

const _cache = new Map<string, { at: number; val: MavatData }>();
const TTL = 1000 * 60 * 60 * 6; // 6 שעות — נתוני תכנון משתנים לאט

function cacheKey(x: number, y: number) {
  return `${Math.round(x / 100) * 100},${Math.round(y / 100) * 100}`; // רזולוציה 100 מ'
}

// ────────────────────────── helpers ──────────────────────────

function normalizeStatus(s: string | null): PlanStatus {
  if (!s) return "אחר";
  if (s.includes("תקפ")) return "תקפה";
  if (s.includes("הופקד")) return "הופקדה";
  if (s.includes("אושר")) return "אושרה";
  if (s.includes("הכנה") || s.includes("עבודה")) return "בהכנה";
  if (s.includes("נדח")) return "נדחתה";
  if (s.includes("בוטל")) return "בוטלה";
  return "אחר";
}

function isoDate(ts: number | null): string | null {
  if (!ts) return null;
  return new Date(ts).toISOString().slice(0, 10);
}

async function queryLayer(layer: number, x: number, y: number, fields: string, radius = 800): Promise<any[]> {
  const geom = encodeURIComponent(JSON.stringify({ x, y, spatialReference: { wkid: 2039 } }));
  const url =
    `${BASE}/${layer}/query?f=json` +
    `&geometry=${geom}&geometryType=esriGeometryPoint&inSR=2039` +
    `&spatialRel=esriSpatialRelIntersects&distance=${radius}&units=esriSRUnit_Meter` +
    `&outFields=${encodeURIComponent(fields)}&returnGeometry=false&resultRecordCount=15`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return [];
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("json")) return [];
    const j = await res.json();
    if (j?.error) return [];
    return j.features ?? [];
  } catch {
    return [];
  }
}

// ────────────────────────── main export ──────────────────────────

export async function fetchMavatData(x: number, y: number): Promise<MavatData | null> {
  const key = cacheKey(x, y);
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.val;

  // שלושת ה-layers במקביל
  const [rawPlans, rawPoly, rawLandUse] = await Promise.all([
    queryLayer(1, x, y,
      "pl_name,pl_number,entity_subtype_desc,internet_short_status,station_desc,pl_url,quantity_delta_105,pl_objectives,pl_landuse_string,last_update_date",
      800,
    ),
    queryLayer(3, x, y, "pl_name,pl_number,mavat_name,mavat_code,station_desc", 500),
    queryLayer(4, x, y, "pl_name,mavat_code,mavat_name,station_desc", 500),
  ]);

  if (!rawPlans.length && !rawPoly.length && !rawLandUse.length) return null;

  // ── Layer 1: תכניות ──
  const plans: PlanEntry[] = rawPlans.map((f: any) => {
    const a = f.attributes;
    return {
      id:          String(a.pl_number ?? a.objectid ?? ""),
      name:        a.pl_name ?? "",
      number:      a.pl_number ?? "",
      type:        a.entity_subtype_desc ?? "",
      status:      normalizeStatus(a.internet_short_status ?? a.station_desc),
      statusRaw:   a.internet_short_status ?? a.station_desc ?? "",
      newUnits:    typeof a.quantity_delta_105 === "number" ? Math.round(a.quantity_delta_105) : null,
      landUse:     a.pl_landuse_string ?? null,
      objectives:  a.pl_objectives ?? null,
      url:         a.pl_url ?? null,
      lastUpdated: isoDate(a.last_update_date),
    };
  });

  // ── Layer 3: ישויות — הריסה / בנייה ──
  const demolitions: DemolitionEntity[] = rawPoly
    .filter((f: any) => {
      const name: string = f.attributes?.mavat_name ?? "";
      return /הריס|פינוי|בינוי/.test(name);
    })
    .map((f: any) => ({
      planName:   f.attributes.pl_name ?? "",
      planNumber: f.attributes.pl_number ?? "",
      entityType: f.attributes.mavat_name ?? "",
      status:     f.attributes.station_desc ?? "",
    }));

  // ── Layer 4: יעודי קרקע ──
  const seen = new Set<string>();
  const landUses: LandUseZone[] = rawLandUse
    .map((f: any) => ({
      planName: f.attributes.pl_name ?? "",
      zoneCode: f.attributes.mavat_code ?? 0,
      zoneName: f.attributes.mavat_name ?? "",
      status:   f.attributes.station_desc ?? "",
    }))
    .filter((z) => { const k = `${z.zoneCode}:${z.zoneName}`; if (seen.has(k)) return false; seen.add(k); return true; });

  const potentialValueIncrease = plans.some(
    (p) => (p.newUnits ?? 0) > 0 && (p.status === "תקפה" || p.status === "הופקדה" || p.status === "אושרה"),
  );
  const hasDemolition = demolitions.length > 0;

  const mavat_url = `https://mavat.iplan.gov.il/SV4/?x=${Math.round(x)}&y=${Math.round(y)}&zoom=7&background=1`;

  const val: MavatData = { x, y, plans, demolitions, landUses, potentialValueIncrease, hasDemolition, mavat_url };
  _cache.set(key, { at: Date.now(), val });
  return val;
}
