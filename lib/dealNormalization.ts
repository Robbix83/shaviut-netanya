/**
 * lib/dealNormalization.ts — shared raw-nadlan-row → Deal normalization.
 *
 * Extracted from scripts/harvest.ts (Wave 0G-12) so both the production
 * harvester and the Shadow Rebuild V2 pilot (audit/wave0g12/) share ONE
 * normalization implementation — this wave's instructions explicitly
 * prohibit a second, copy-pasted normalization path. Byte-for-byte the same
 * logic scripts/harvest.ts used inline before this extraction, with two
 * deliberate changes (ECC code-reviewer flagged the second as
 * under-documented — noting both here):
 *  1. `streetCoords` is now a parameter instead of a module-level mutable
 *     variable, for testability.
 *  2. `settlement` is read from the passed-in `Neighborhood.settlement`
 *     instead of a hardcoded "נתניה" constant. Every current Neighborhood
 *     producer (lib/neighborhoodDiscovery.ts, scripts/harvest.ts,
 *     scripts/audit-wave0g12-shadow-acquire.ts) already sets that field to
 *     "נתניה", so output is unchanged today — but a future caller with a
 *     different settlement would now get it right instead of silently
 *     mislabeled.
 */
import type { Deal, Neighborhood, PropertyType } from "./types";

/** Sentinel for a missing parcelNum in the transaction-identity key below.
 * Every observed real parcelNum is a gush-helka-subparcel string of digits
 * and hyphens only (e.g. "8252-156-59") — this sentinel and the "|"
 * delimiter use characters that never appear in that format, so a real
 * parcelNum can never collide with it. Kept in sync with (and originally
 * copied from) lib/shadowRebuild.ts's own copy of this same constant. */
const NULL_PARCEL_SENTINEL = "∅NULL_PARCEL∅";

/**
 * The shared, best-evidenced transaction-identity key: parcelNum + dealDate
 * + dealAmount. Canonical docs (evidence, null/empty-date handling, honest
 * residual limit) live on lib/shadowRebuild.ts's transactionKey(), which
 * now delegates here — this is the single implementation, not a second copy.
 *
 * Wave 0G-L1D fix: the OLDER `Deal.id` fallback (dealDate+price+area, no
 * parcelNum) collides at V2's ~59k-row citywide scale — 116 rows across 103
 * distinct ids, 94 genuinely different real transactions, not acquisition
 * duplicates (audit/launch/L1_SUPABASE_V2_PREVIEW_IMPORT.md). `street`+
 * `houseNumber` alone only resolves 73/94; this key resolves all of them
 * (validated: scripts/validate-id-fix-wave0g-l1d.ts, 0 collisions across
 * all 59,305 real rows, vs. 103 under the old formula).
 */
export function buildTransactionIdSuffix(parcelNum: string | null, dealDate: string, price: number): string {
  const parcel = parcelNum ?? NULL_PARCEL_SENTINEL;
  const hasDate = dealDate ? "1" : "0";
  return `${parcel}|${hasDate}:${dealDate}|${price}`;
}

/** מפענח את גוף /deal-data (מחרוזת base64+gzip) למבנה {data:{items:[...]}} */
export function decodeDealData(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    /* לא JSON גולמי — ננסה base64+gzip */
  }
  try {
    const zlib = require("zlib") as typeof import("zlib");
    const buf = Buffer.from(text.replace(/^"|"$/g, ""), "base64");
    const unz = zlib.gunzipSync(buf).toString("utf8");
    return JSON.parse(unz);
  } catch {
    return null;
  }
}

/** מנקה מספר ממחרוזת ("3,251,000 ₪" → 3251000) */
export function num(v: any): number {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[^\d.]/g, "");
  return cleaned ? parseFloat(cleaned) : NaN;
}

/** ממיר קומה עברית למספר: "שישית" → 6, "קרקע" → 0 */
export const HEBREW_FLOOR: Record<string, number> = {
  מרתף: -1, מרתפית: -1, קרקע: 0, קרקעית: 0,
  ראשונה: 1, ראשון: 1, שנייה: 2, שניה: 2, שני: 2,
  שלישית: 3, שלישי: 3, רביעית: 4, רביעי: 4,
  חמישית: 5, חמישי: 5, שישית: 6, שישי: 6,
  שביעית: 7, שביעי: 7, שמינית: 8, שמיני: 8,
  תשיעית: 9, תשיעי: 9, עשירית: 10, עשירי: 10,
};
export function parseFloor(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return HEBREW_FLOOR[s] ?? null;
}

/** מפרסר "שם רחוב 12" → { street, houseNumber } */
export function parseAddress(addr: string | null): { street: string | null; houseNumber: string | null } {
  if (!addr) return { street: null, houseNumber: null };
  const m = addr.trim().match(/^(.+?)\s+(\d+[א-ת]?)$/);
  if (m) return { street: m[1], houseNumber: m[2] };
  return { street: addr.trim(), houseNumber: null };
}

/** מסווג סוג נכס מתוך תיאור העסקה (dealNature) */
export function classifyPropertyType(dealNature: string | null): PropertyType {
  const s = (dealNature || "").trim();
  if (/מגרש|קרקע|מקרקעין|חקלאי|נחלה/.test(s)) return "land";
  if (/דיר[הת]/.test(s)) return "apartment"; // דירה בבית קומות, דירת גג, דירת גן — לפני בדיקת בית
  if (/קוטג|צמוד|דו ?משפחת|וילה|חד ?משפחת/.test(s)) return "house";
  return "apartment";
}

/** ממפה רשומת עסקה גולמית של נדל"ן ל-Deal מנורמל */
export function normalizeDeal(
  raw: any,
  n: Neighborhood,
  streetCoords: Record<string, { x: number; y: number }> = {},
): Deal | null {
  const price = num(raw.dealAmount ?? raw.DEALAMOUNT ?? raw.price);
  if (!price || !Number.isFinite(price)) return null;
  const builtArea = num(raw.assetArea ?? raw.ASSETAREA ?? raw.dealNatureArea);
  const plotArea = num(raw.plotArea ?? raw.landArea ?? raw.parcelArea ?? raw.gushArea);
  const rooms = num(raw.roomNum ?? raw.assetRoomNum);
  const dateRaw = raw.dealDate ?? raw.DEALDATETIME ?? raw.dealDateTime;
  const dealDate = dateRaw ? new Date(dateRaw).toISOString().slice(0, 10) : "";
  const propertyType = classifyPropertyType(raw.dealNature ?? null);

  // לקרקע: השטח הוא שטח המגרש; לדירה/בית: שטח בנוי (+ מגרש אם קיים).
  const isLand = propertyType === "land";
  const areaSqm = isLand ? null : Number.isFinite(builtArea) && builtArea > 0 ? builtArea : null;
  let plotSqm: number | null = Number.isFinite(plotArea) && plotArea > 0 ? plotArea : null;
  if (isLand && plotSqm == null && Number.isFinite(builtArea) && builtArea > 0) plotSqm = builtArea;

  // מחיר למ"ר: לקרקע לפי מגרש, אחרת לפי שטח בנוי
  const ppsqmBase = isLand ? plotSqm : areaSqm;
  const pricePerSqm = ppsqmBase && ppsqmBase > 0 ? Math.round(price / ppsqmBase) : null;

  // Guard against a non-scalar raw.parcelNum (e.g. an object/array from an
  // unexpected upstream shape) silently stringifying into a wrong-but-
  // truthy-looking key like "[object Object]" — fall back to the honest
  // null-parcel sentinel path instead.
  const parcelNumRaw = raw.parcelNum;
  const parcelNum =
    typeof parcelNumRaw === "string" || typeof parcelNumRaw === "number" ? String(parcelNumRaw) : null;
  return {
    id: `${n.id}-${raw.keyValue ?? raw.dealId ?? buildTransactionIdSuffix(parcelNum, dealDate, price)}`,
    dealDate,
    price,
    propertyType,
    rooms: !isLand && Number.isFinite(rooms) ? rooms : null,
    areaSqm,
    plotSqm,
    floor: parseFloor(raw.floor ?? raw.floorNo ?? raw.FLOORNO),
    yearBuilt: raw.yearBuilt != null ? Number(raw.yearBuilt) : raw.buildingYear != null ? Number(raw.buildingYear) : null,
    dealNature: raw.dealNature ?? null,
    // כתובת: השדה האמיתי הוא "address" בפורמט "שם רחוב מספר"
    ...(() => { const p = parseAddress(raw.address ?? null); return { address: raw.address ?? null, street: p.street, houseNumber: p.houseNumber }; })(),
    neighborhoodId: n.id,
    neighborhood: n.name,
    settlement: n.settlement,
    // קואורדינטות ברמת רחוב (אם ידועות) — חיוני לסינון בניין/רחוב בחישוב השווי
    ...(raw.streetName && streetCoords[raw.streetName]
      ? streetCoords[raw.streetName]
      : { x: n.x, y: n.y }),
    pricePerSqm,
  };
}
