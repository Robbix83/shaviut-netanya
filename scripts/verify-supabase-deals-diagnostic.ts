/**
 * scripts/verify-supabase-deals-diagnostic.ts  (Wave 0C-2B deal-count diagnosis)
 *
 * READ-ONLY. Reproduces the exact two queries lib/store.ts SupabaseStore.getStats()
 * issues against `deals` — but unlike getStats(), surfaces `error` explicitly instead
 * of silently collapsing it via `?? 0` / `?? []`. This distinguishes:
 *   "the deals table genuinely has 0 rows" (real remote discrepancy) from
 *   "the count query errored and getStats() silently reported 0" (unchecked-error bug).
 *
 * Also calls the real getStore().getStats() (the exact method the app and
 * verify-supabase-readonly.ts use) so the raw query result and the application-level
 * result can be compared directly.
 *
 * No writes. No OTP/notification calls. Never logs URL or key values.
 * Uses head:true / limit(1) only — never downloads the deals table.
 */
import { resolveDataSource } from "../lib/config";

async function main() {
  const mode = resolveDataSource({
    DATA_SOURCE: process.env.DATA_SOURCE,
    NODE_ENV: process.env.NODE_ENV,
  });
  if (mode !== "supabase") {
    console.log("ERROR=DATA_SOURCE did not resolve to supabase - set DATA_SOURCE=supabase and re-run.");
    process.exitCode = 2;
    return;
  }

  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // Exact same query getStats() issues for dealCount — but error is surfaced, not swallowed.
  const countRes = await sb.from("deals").select("id", { count: "exact", head: true });
  console.log(`DEALS_COUNT_RAW=${countRes.count ?? "null"}`);
  console.log(`DEALS_COUNT_ERROR=${countRes.error ? countRes.error.message : "null"}`);

  // Exact same neighborhoodId-not-null query getStats() issues for neighborhoodCount.
  const neighRes = await sb
    .from("deals")
    .select("neighborhoodId")
    .not("neighborhoodId", "is", null)
    .limit(1);
  console.log(`DEALS_NEIGHFIELD_ERROR=${neighRes.error ? neighRes.error.message : "null"}`);

  // Trivial single-row probe (limit 1, no bulk download) to confirm the table itself
  // is reachable and see whether any row exists at all.
  const probe = await sb.from("deals").select("*").limit(1);
  console.log(`DEALS_PROBE_ROWS=${probe.data ? probe.data.length : "null"}`);
  console.log(`DEALS_PROBE_ERROR=${probe.error ? probe.error.message : "null"}`);

  // The actual application-level call: getStore().getStats(), the exact method the
  // real app (and verify-supabase-readonly.ts) uses. Compares against the raw queries above.
  try {
    const { getStore } = await import("../lib/store");
    const stats = await getStore().getStats();
    console.log(`GETSTATS_DEALS=${stats.dealCount}`);
    console.log(`GETSTATS_NEIGHBORHOODS=${stats.neighborhoodCount}`);
    console.log("GETSTATS_ERROR=null");
  } catch (e) {
    console.log("GETSTATS_DEALS=unknown");
    console.log("GETSTATS_NEIGHBORHOODS=unknown");
    console.log(`GETSTATS_ERROR=${e instanceof Error ? e.message : String(e)}`);
  }
}

main();
