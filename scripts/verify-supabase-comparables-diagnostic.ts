/**
 * scripts/verify-supabase-comparables-diagnostic.ts  (Wave 0E-1B)
 *
 * READ-ONLY. Confirms or refutes a specific, source-proven hypothesis: that
 * SupabaseStore.getAllDeals() returns a minimal {id,neighborhoodId,x,y} projection
 * (unlike LocalStore.getAllDeals(), which returns full Deal objects), silently
 * disabling every city-wide fallback in lib/valuation.ts on Supabase-backed
 * environments — and that SupabaseStore.getDealsByNeighborhood() has no pagination,
 * so any neighborhood exceeding PostgREST's default 1000-row response cap is
 * silently truncated.
 *
 * Calls ONLY existing read-only Store methods and the real resolveAndValuate()
 * seam the app itself uses — no writes, no OTP, no notification providers.
 * Never logs credential values.
 */
import { resolveDataSource } from "../lib/config";

function safeError(e: unknown): string {
  if (e && typeof e === "object" && "message" in (e as any) && typeof (e as any).message === "string") {
    return (e as any).message;
  }
  return e instanceof Error ? e.message : String(e);
}

async function main() {
  const mode = resolveDataSource({ DATA_SOURCE: process.env.DATA_SOURCE, NODE_ENV: process.env.NODE_ENV });
  console.log(`STORE_MODE=${mode}`);
  if (mode !== "supabase") {
    console.log("ERROR=DATA_SOURCE did not resolve to supabase - set DATA_SOURCE=supabase and re-run.");
    process.exitCode = 2;
    return;
  }

  const { getStore } = await import("../lib/store");
  const { resolveAndValuate } = await import("../lib/valuationService");
  const store = getStore();

  // 1) getAllDeals() field-completeness check
  try {
    const all = await store.getAllDeals();
    const first = all.find((d) => d.neighborhoodId === "66239254") ?? all[0];
    console.log(`GETALLDEALS_COUNT=${all.length}`);
    console.log(`GETALLDEALS_SAMPLE_HAS_STREET=${first && "street" in (first as any) && (first as any).street != null}`);
    console.log(`GETALLDEALS_SAMPLE_HAS_HOUSENUMBER=${first && "houseNumber" in (first as any) && (first as any).houseNumber != null}`);
    console.log(`GETALLDEALS_SAMPLE_HAS_PRICE=${first && "price" in (first as any) && (first as any).price != null}`);
  } catch (e) {
    console.log(`GETALLDEALS_ERROR=${safeError(e)}`);
  }

  // 2) getDealsByNeighborhood() truncation check — Weizmann's neighborhood (known locally: 3010 rows, > 1000 cap)
  try {
    const weizmannNeigh = await store.getDealsByNeighborhood("66239254", {});
    console.log(`WEIZMANN_NEIGHBORHOOD_ROW_COUNT=${weizmannNeigh.length}`);
    const has92 = weizmannNeigh.some((d) => d.street === "ויצמן" && parseInt(d.houseNumber ?? "") === 92);
    console.log(`WEIZMANN_92_PRESENT_IN_NEIGHBORHOOD_POOL=${has92}`);
  } catch (e) {
    console.log(`WEIZMANN_NEIGHBORHOOD_ERROR=${safeError(e)}`);
  }

  // 3) Hartom's two relevant neighborhoods (known locally: 500 rows each, under the cap either way)
  try {
    const hartomOwnNeigh = await store.getDealsByNeighborhood("66239241", {}); // where house 30's rows actually live
    const hartomResolvedNeigh = await store.getDealsByNeighborhood("65867903", {}); // where the app resolves the street to
    console.log(`HARTOM_OWN_NEIGHBORHOOD_ROW_COUNT=${hartomOwnNeigh.length}`);
    console.log(`HARTOM_RESOLVED_NEIGHBORHOOD_ROW_COUNT=${hartomResolvedNeigh.length}`);
    const has30InOwn = hartomOwnNeigh.some((d) => d.street === "הרב שמואל הרטום" && parseInt(d.houseNumber ?? "") === 30);
    const has30InResolved = hartomResolvedNeigh.some((d) => d.street === "הרב שמואל הרטום" && parseInt(d.houseNumber ?? "") === 30);
    console.log(`HARTOM_30_PRESENT_IN_OWN_NEIGHBORHOOD=${has30InOwn}`);
    console.log(`HARTOM_30_PRESENT_IN_RESOLVED_NEIGHBORHOOD=${has30InResolved}`);
  } catch (e) {
    console.log(`HARTOM_NEIGHBORHOOD_ERROR=${safeError(e)}`);
  }

  // 4) The ultimate proof: call the REAL app seam with the exact captured Wave 0E-1A runtime inputs.
  try {
    const hartom = await resolveAndValuate({
      neighborhoodId: "65867903",
      propertyType: "apartment",
      rooms: 4,
      areaSqm: 90,
      houseNumber: "30",
      streetName: "הרב שמואל הרטום",
      streetX: 188367.912,
      streetY: 690681.882,
    });
    if (hartom.ok) {
      const top3 = hartom.valuation.comparableDeals.slice(0, 3).map((c) => `${c.street} ${c.houseNumber} [${c.tier}]`);
      console.log(`HARTOM_RESULT_TOP3=${JSON.stringify(top3)}`);
    } else {
      console.log(`HARTOM_RESULT_ERROR=${hartom.error}`);
    }
  } catch (e) {
    console.log(`HARTOM_VALUATE_ERROR=${safeError(e)}`);
  }

  try {
    const weizmann = await resolveAndValuate({
      neighborhoodId: "66239254",
      propertyType: "apartment",
      rooms: 4,
      areaSqm: 107,
      houseNumber: "92",
      streetName: "ויצמן",
      streetX: 187067.163,
      streetY: 694046.39,
    });
    if (weizmann.ok) {
      const top3 = weizmann.valuation.comparableDeals.slice(0, 3).map((c) => `${c.street} ${c.houseNumber} [${c.tier}]`);
      console.log(`WEIZMANN_RESULT_TOP3=${JSON.stringify(top3)}`);
    } else {
      console.log(`WEIZMANN_RESULT_ERROR=${weizmann.error}`);
    }
  } catch (e) {
    console.log(`WEIZMANN_VALUATE_ERROR=${safeError(e)}`);
  }

  console.log("ERROR=null");
}

main();
