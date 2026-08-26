/**
 * lib/neighborhoodDiscovery.ts — Netanya neighborhood entity discovery for
 * scripts/harvest.ts (Wave 0G-11).
 *
 * Replaces the previous single-source, name-search-only discovery (GovMap
 * TldSearch against a fixed SEED_NAMES list, keeping only the first hit per
 * name) which silently missed entity 65210195 ("נוף הטיילת") — the entity
 * holding the 7 originally-missing Ben Ami 41 transactions, see
 * audit/wave0g4/CADASTRAL_ENTITY_RECONCILIATION.md — because that entity
 * shares its display name with a different, already-discovered id
 * (66239231), and the old "first hit by name" logic could only ever surface
 * one of the two.
 *
 * Layered discovery, identity always by upstream numeric id (never name):
 *   1. PRIMARY — nadlan.gov.il's own official entity catalog
 *      (lib/nadlanCatalog.ts::getOfficialNetanyaEntities), proven citywide-
 *      stable across independently-fetched entities (Wave 0G-6) and NOT
 *      dependent on name matching.
 *   2. FALLBACK — the original GovMap TldSearch name-based lookup, kept
 *      because Wave 0G-6 did not prove the official catalog is 100%
 *      exhaustive for every special-category entity (industrial/planning
 *      zones) — only that it is stable and citywide-shared where tested.
 *   3. LAST-RESORT MERGE — any id already recorded in data/neighborhoods.json
 *      that neither of the above rediscovers, preserving existing coverage.
 *
 * An id discovered by an earlier source is never overwritten or dropped by
 * a later, differently-sourced duplicate — first-found-by-id wins, matching
 * lib/nadlanCatalog.ts's own identity discipline.
 */
import { getOfficialNetanyaEntities, getNadlanEntityCoordinates } from "./nadlanCatalog";
import type { Neighborhood } from "./types";

const SETTLEMENT = "נתניה";
const ES_BASE = "https://es.govmap.gov.il/TldSearch";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.nadlan.gov.il/",
  Origin: "https://www.nadlan.gov.il",
};

/** 23 השכונות הרשמיות לפי עיריית נתניה + שכונות ידועות לפי ID — נשמר כגיבוי
 * (מקור 2 של הגילוי, לא הראשי יותר). ראו הערת המודול. */
export const SEED_NAMES = [
  "אגמים", "עין התכלת", "עיר ימים", "גלי ים", "גבעת האירוסים",
  "קריית השרון", "קריית נורדאו", "קריית רבין", "קריית צאנז",
  "אופק הים", "כוכב הצפון", "משכנות זבולון", "נאות גנים",
  "נאות הרצל", "נאות שקד", "נווה איתמר", "נוף השרון", "נוף הטיילת",
  "פרדס הגדוד", "רמת חן", "רמת אפרים",
  // מרכז העיר: nadlan מכיר "מרכז העיר צפון" (לא "צפון-מזרח") ו"מרכז העיר דרום"
  "מרכז העיר צפון", "מרכז העיר דרום",
];

export interface DiscoverNeighborhoodsOptions {
  /** Injectable fetch — defaults to the global `fetch`. Tests pass a fake. */
  fetchImpl?: typeof fetch;
  /** Existing data/neighborhoods.json contents, merged in as the last-resort
   * fallback. Defaults to empty (caller supplies real data in production). */
  existingNeighborhoods?: Neighborhood[];
  /** Politeness delay (ms) between official-catalog coordinate fetches —
   * plain JSON GETs, no reCAPTCHA, so this can be short. Tests pass 0. */
  catalogPoliteDelayMs?: number;
  /** Politeness delay (ms) between GovMap fallback requests — unchanged from
   * the original discoverNeighborhoods() behavior. Tests pass 0. */
  seedPoliteDelayMs?: number;
  /** Override the seed-name fallback list (mainly for tests). */
  seedNames?: string[];
  /** Optional logger — defaults to console.log. Tests can capture output. */
  onLog?: (msg: string) => void;
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/**
 * Discovers Netanya neighborhood entities via the layered strategy described
 * above. Never throws on a source-level failure (official catalog fetch
 * error, one GovMap lookup failing) — each source degrades independently and
 * the function always returns whatever was successfully discovered, same
 * fail-soft contract as the original discoverNeighborhoods().
 */
export async function discoverNeighborhoods(
  opts: DiscoverNeighborhoodsOptions = {},
): Promise<Neighborhood[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const existingNeighborhoods = opts.existingNeighborhoods ?? [];
  const catalogDelay = opts.catalogPoliteDelayMs ?? 300;
  const seedDelay = opts.seedPoliteDelayMs ?? 800;
  const seedNames = opts.seedNames ?? SEED_NAMES;
  const log = opts.onLog ?? ((m: string) => console.log(m));

  const out: Neighborhood[] = [];
  const seenIds = new Set<string>();

  // מקור 1 (ראשי): הקטלוג הרשמי של nadlan.gov.il עצמו.
  try {
    const officialEntities = await getOfficialNetanyaEntities(undefined, fetchImpl);
    log(`   📚 קטלוג רשמי: ${officialEntities.length} ישויות`);
    for (const entity of officialEntities) {
      if (seenIds.has(entity.sourceId)) continue;
      let x: number | null = null;
      let y: number | null = null;
      try {
        const coords = await getNadlanEntityCoordinates(entity.sourceId, fetchImpl);
        x = coords.x;
        y = coords.y;
      } catch {
        /* קואורדינטות אופציונליות — normalize() נופל חזרה על קואורדינטת רחוב */
      }
      out.push({ id: entity.sourceId, name: entity.name, settlement: SETTLEMENT, x, y });
      seenIds.add(entity.sourceId);
      await sleep(catalogDelay);
    }
  } catch (e) {
    log(`   ⚠️  קטלוג רשמי נכשל (${(e as Error).message}) — נופל חזרה על חיפוש-שם בלבד`);
  }

  // מקור 2 (גיבוי): חיפוש-שם ב-GovMap — השיטה הישנה, נשמרת למקרה שהקטלוג
  // הרשמי חסר ישות (לא הוכח ממצה ב-100% לכל הקטגוריות המיוחדות).
  for (const name of seedNames) {
    const url = `${ES_BASE}/api/DetailsByQuery?query=${encodeURIComponent(name + " נתניה")}&lyrs=4&gid=nadlan`;
    try {
      const res = await fetchImpl(url, { headers: HEADERS });
      if (!res.ok) continue;
      const ctype = res.headers.get("content-type") || "";
      if (!ctype.includes("json")) continue;
      const j: any = await res.json();
      const hit = j?.data?.NEIGHBORHOOD?.[0];
      if (hit?.ObjectID && !seenIds.has(String(hit.ObjectID))) {
        out.push({
          id: String(hit.ObjectID), name, settlement: SETTLEMENT,
          x: hit.X ?? null, y: hit.Y ?? null,
        });
        seenIds.add(String(hit.ObjectID));
      }
    } catch {
      /* דלג */
    }
    await sleep(seedDelay);
  }

  // מקור 3 (מיזוג אחרון): שכונות ידועות מ-neighborhoods.json הקיים שלא
  // נמצאו באף אחד מהמקורות לעיל.
  for (const n of existingNeighborhoods) {
    if (!seenIds.has(n.id)) {
      out.push(n);
      seenIds.add(n.id);
    }
  }

  return out;
}
