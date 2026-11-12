import type { ValuationInput } from "@/lib/valuationService";
import type { Valuation } from "@/lib/types";

/** שורה בטבלת searches: מה נבדק באתר, בלי שום פרט מזהה של המבקר. */
export interface SearchRow {
  id?: number;
  createdAt?: string;
  source: string | null;
  propertyType: string | null;
  street: string | null;
  houseNumber: string | null;
  neighborhood: string | null;
  rooms: number | null;
  areaSqm: number | null;
  plotSqm: number | null;
  floor: number | null;
  yearBuilt: number | null;
  outcome: "ok" | "no_match" | "insufficient_data" | "house_number_required";
  estimateLow: number | null;
  estimateHigh: number | null;
  confidence: string | null;
  basedOnDeals: number | null;
}

function enabled(): boolean {
  return process.env.DATA_SOURCE === "supabase" && !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

async function client() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 80) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export function buildSearchRow(
  input: ValuationInput & { source?: unknown },
  outcome: SearchRow["outcome"],
  valuation: Valuation | null,
  neighborhoodName: string | null = null,
): SearchRow {
  return {
    source: str(input.source, 200),
    propertyType: str(input.propertyType, 20),
    street: str(input.streetName),
    houseNumber: str(input.houseNumber, 12),
    neighborhood: valuation?.neighborhood ?? neighborhoodName,
    rooms: num(input.rooms),
    areaSqm: num(input.areaSqm),
    plotSqm: num(input.plotSqm),
    floor: num(input.floor),
    yearBuilt: num(input.yearBuilt),
    outcome,
    estimateLow: valuation ? Math.round(valuation.estimateLow) : null,
    estimateHigh: valuation ? Math.round(valuation.estimateHigh) : null,
    confidence: valuation?.confidence ?? null,
    basedOnDeals: valuation?.basedOnDeals ?? null,
  };
}

/** שומר חיפוש. אף פעם לא זורק: שמירה שנכשלה לא פוגעת בבדיקת השווי. */
export async function logSearch(row: SearchRow): Promise<void> {
  if (!enabled()) return;
  try {
    const sb = await client();
    const { error } = await sb.from("searches").insert(row);
    if (error) console.error("searches insert failed:", error.message);
  } catch (e) {
    console.error("searches insert failed:", e instanceof Error ? e.message : e);
  }
}

export async function listSearches(limit = 300): Promise<{ rows: SearchRow[]; error: string | null }> {
  if (!enabled()) return { rows: [], error: "השמירה פעילה רק בפרודקשן (Supabase)" };
  const sb = await client();
  const { data, error } = await sb.from("searches").select("*").order("createdAt", { ascending: false }).limit(limit);
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as SearchRow[], error: null };
}
