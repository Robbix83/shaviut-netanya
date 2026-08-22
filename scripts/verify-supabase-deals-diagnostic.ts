/**
 * scripts/verify-supabase-deals-diagnostic.ts  (Wave 0C-2B deal-count diagnosis)
 *
 * READ-ONLY. Tests each Supabase operation SupabaseStore.getStats() performs,
 * SEPARATELY, with safe structural error reporting (code/message/details/hint —
 * never credentials/headers/row data). No writes. No OTP/notification calls.
 *
 * IMPORTANT: getStats()'s real neighborhoodId query is UNBOUNDED (no .limit()) —
 * it fetches one column across every row where neighborhoodId is not null. An
 * earlier version of this script tested that query with `.limit(1)`, which is NOT
 * the same query and can silently pass while the real unbounded query fails (e.g.
 * a statement timeout or row-egress cap that only triggers at full result size).
 * This version runs the exact unbounded query getStats() runs, plus keeps the
 * limit(1) probe separately labeled for comparison.
 */
import { resolveDataSource } from "../lib/config";

function safeError(e: unknown): { code: string | null; message: string | null; details: string | null; hint: string | null } {
  const obj = e && typeof e === "object" ? (e as Record<string, unknown>) : {};
  const pick = (k: string) => (typeof obj[k] === "string" ? (obj[k] as string) : null);
  return {
    code: pick("code"),
    message: pick("message") ?? (e == null ? null : e instanceof Error ? e.message : null),
    details: pick("details"),
    hint: pick("hint"),
  };
}

function printResult(label: string, extra: Record<string, string | number | null>, error: unknown) {
  console.log(`QUERY=${label}`);
  for (const [k, v] of Object.entries(extra)) {
    console.log(`${k}=${v === null ? "null" : v}`);
  }
  const s = safeError(error);
  console.log(`ERROR_CODE=${s.code ?? "null"}`);
  console.log(`ERROR_MESSAGE=${s.message ?? "null"}`);
  console.log(`ERROR_DETAILS=${s.details ?? "null"}`);
  console.log(`ERROR_HINT=${s.hint ?? "null"}`);
  console.log("---");
}

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
  let sb: ReturnType<typeof createClient>;
  try {
    sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
  } catch (e) {
    printResult("create_client", {}, e);
    process.exitCode = 1;
    return;
  }

  // 1) Exact query getStats() issues for dealCount.
  const countRes = await sb.from("deals").select("id", { count: "exact", head: true });
  printResult("deal_count_headtrue", { COUNT: countRes.count ?? null }, countRes.error);

  // 2) The exact UNBOUNDED query getStats() issues for neighborhoodCount — no .limit().
  //    This is the real suspect: an earlier limit(1) version of this probe passed,
  //    which does not prove the real (full-table) query also succeeds.
  const neighFull = await sb.from("deals").select("neighborhoodId").not("neighborhoodId", "is", null);
  printResult("neighborhoodId_full_unbounded", { ROWS: neighFull.data ? neighFull.data.length : null }, neighFull.error);

  // 3) Same query, but limited to 1 row — kept for comparison only (NOT equivalent to getStats()).
  const neighLimit1 = await sb.from("deals").select("neighborhoodId").not("neighborhoodId", "is", null).limit(1);
  printResult("neighborhoodId_limit1_reference_only", { ROWS: neighLimit1.data ? neighLimit1.data.length : null }, neighLimit1.error);

  // 4) Trivial single-row probe confirming the table itself is reachable.
  const probe = await sb.from("deals").select("*").limit(1);
  printResult("deals_probe_limit1", { ROWS: probe.data ? probe.data.length : null }, probe.error);

  // 5) The actual application-level call: getStore().getStats() — the exact method
  //    the real app and verify-supabase-readonly.ts use.
  try {
    const { getStore } = await import("../lib/store");
    const stats = await getStore().getStats();
    printResult("getstats_direct", { GETSTATS_DEALS: stats.dealCount, GETSTATS_NEIGHBORHOODS: stats.neighborhoodCount }, null);
  } catch (e) {
    printResult("getstats_direct", { GETSTATS_DEALS: "unknown", GETSTATS_NEIGHBORHOODS: "unknown" }, e);
  }
}

main();
