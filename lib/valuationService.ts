/**
 * lib/valuationService.ts
 * Server-side valuation seam shared by POST /api/valuation and POST /api/lead.
 * This is the SINGLE server-authoritative valuation path — the browser is never
 * trusted for calculated outputs. Logic is extracted verbatim from the original
 * /api/valuation handler (neighborhood resolution → optional geocode → valuate);
 * the valuation mathematics in lib/valuation.ts is unchanged.
 */
import { resolvePoint, itmDistance } from "@/lib/govmap";
import { valuate } from "@/lib/valuation";
import { getStore } from "@/lib/store";
import type { Neighborhood, Valuation } from "@/lib/types";

export interface ValuationInput {
  query?: string | null; // free-text address/neighborhood (fallback resolution)
  neighborhoodId?: string | null; // preferred: resolved neighborhood id
  propertyType?: "apartment" | "house" | "land";
  rooms?: number | null;
  areaSqm?: number | null;
  plotSqm?: number | null;
  floor?: number | null;
  yearBuilt?: number | null;
  houseNumber?: string | null;
  streetName?: string | null;
  streetX?: number | null;
  streetY?: number | null;
}

export type ValuationOutcome =
  | { ok: true; valuation: Valuation; neighborhoodId: string; neighborhoodName: string | null }
  | { ok: false; error: "no_match" | "insufficient_data" };

/** מזהה שכונה + (אופציונלי) גיאוקוד + חישוב שווי — מסלול יחיד, סמכותי בצד-שרת. */
export async function resolveAndValuate(input: ValuationInput): Promise<ValuationOutcome> {
  const store = getStore();
  const neighborhoods = await store.listNeighborhoods("נתניה");

  // 1) זיהוי השכונה
  let neighborhoodId = input.neighborhoodId || null;
  let neighborhoodName: string | null = null;

  if (!neighborhoodId && input.query) {
    neighborhoodId = await resolveNeighborhoodId(input.query, neighborhoods);
  }
  if (neighborhoodId) {
    neighborhoodName = neighborhoods.find((n) => n.id === neighborhoodId)?.name ?? null;
  }
  if (!neighborhoodId) return { ok: false, error: "no_match" };

  // 2) קואורדינטות: גיאוקוד מדויק כשיש מספר בית + שם רחוב
  let streetX = input.streetX ?? null;
  let streetY = input.streetY ?? null;
  if (input.houseNumber && input.streetName) {
    const fullAddr = `${input.streetName} ${input.houseNumber} נתניה`;
    const precise = await resolvePoint(fullAddr);
    if (precise) {
      streetX = precise.x;
      streetY = precise.y;
    }
  }

  // 3) חישוב השווי (המתמטיקה ב-lib/valuation.ts — ללא שינוי)
  const valuation = await valuate({
    neighborhoodId,
    neighborhood: neighborhoodName,
    propertyType: input.propertyType ?? "apartment",
    rooms: input.rooms ?? null,
    areaSqm: input.areaSqm ?? null,
    plotSqm: input.plotSqm ?? null,
    floor: input.floor ?? null,
    yearBuilt: input.yearBuilt ?? null,
    houseNumber: input.houseNumber ?? null,
    streetName: input.streetName ?? null,
    streetX,
    streetY,
  });

  if (!valuation) return { ok: false, error: "insufficient_data" };
  return { ok: true, valuation, neighborhoodId, neighborhoodName };
}

/** ממפה טקסט כתובת/שכונה למזהה שכונה מה-DB שלנו */
async function resolveNeighborhoodId(
  query: string,
  neighborhoods: Neighborhood[],
): Promise<string | null> {
  // א) לפי קואורדינטות → השכונה הקרובה ביותר
  const pt = await resolvePoint(query);
  if (pt) {
    let best: { id: string; dist: number } | null = null;
    for (const n of neighborhoods) {
      if (n.x == null || n.y == null) continue;
      const dist = itmDistance(pt.x, pt.y, n.x, n.y);
      if (!best || dist < best.dist) best = { id: n.id, dist };
    }
    if (best) return best.id;
  }
  // ב) נפילה לאחור: התאמת שם שכונה לפי טקסט
  const cleaned = query.replace(/,?\s*נתניה\s*$/, "").trim();
  const byName = neighborhoods.find(
    (n) => n.name === cleaned || query.includes(n.name) || n.name.includes(cleaned),
  );
  return byName?.id ?? null;
}
