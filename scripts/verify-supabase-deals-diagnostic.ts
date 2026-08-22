/**
 * scripts/verify-supabase-deals-diagnostic.ts  (Wave 0C-2B deal/neighborhood-count diagnosis)
 *
 * READ-ONLY. Tests each Supabase operation SupabaseStore.getStats() performs,
 * SEPARATELY, with safe structural error reporting (code/message/details/hint —
 * never credentials/headers/row data). No writes. No OTP/notification calls.
 *
 * Distinguishes four different numbers that are easy to conflate:
 *   RAW_DEALS_COUNT          — deals table row count (head:true, exact)
 *   RAW_NEIGHBORHOODS_COUNT  — neighborhoods table row count (head:true, exact)
 *   GETSTATS_DEALS           — getStore().getStats().dealCount (should equal RAW_DEALS_COUNT)
 *   GETSTATS_NEIGHBORHOODS   — getStore().getStats().neighborhoodCount: distinct
 *                               neighborhoodIds represented in deals (LocalStore's semantic,
 *                               NOT the same concept as RAW_NEIGHBORHOODS_COUNT, though in a
 *                               fully-covered dataset they should numerically agree)
 *
 * Also keeps `neighborhoodId_unbounded_PROVEN_DEFECTIVE` — the query getStats() used to run
 * before this wave's fix. It is silently capped at PostgREST's default 1000-row response
 * limit and WILL undercount on any table with more than 1000 matching rows (proven on real
 * data: 12,642 deals -> only 1000 rows read -> 3 of 21 real neighborhoods counted). It is
 * kept here ONLY as evidence of the fixed bug — it is NOT a valid counting strategy and
 * getStats() no longer uses it (see lib/store.ts, which now paginates with .range()).
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

  // 1) RAW_DEALS_COUNT — deals table row count.
  const countRes = await sb.from("deals").select("id", { count: "exact", head: true });
  printResult("raw_deals_count", { RAW_DEALS_COUNT: countRes.count ?? null }, countRes.error);

  // 2) RAW_NEIGHBORHOODS_COUNT — neighborhoods table row count (a different table/concept
  //    than "distinct neighborhoodIds in deals" — see header comment).
  const neighTableRes = await sb.from("neighborhoods").select("id", { count: "exact", head: true });
  printResult("raw_neighborhoods_table_count", { RAW_NEIGHBORHOODS_COUNT: neighTableRes.count ?? null }, neighTableRes.error);

  // 3) PROVEN DEFECTIVE — kept only as evidence of the bug this wave fixed. Do NOT use
  //    this pattern: a single unbounded select is silently capped at ~1000 rows by
  //    PostgREST, which undercounts distinct neighborhoodIds on any larger deals table.
  const neighUnbounded = await sb.from("deals").select("neighborhoodId").not("neighborhoodId", "is", null);
  printResult(
    "neighborhoodId_unbounded_PROVEN_DEFECTIVE",
    { ROWS: neighUnbounded.data ? neighUnbounded.data.length : null },
    neighUnbounded.error,
  );

  // 4) Trivial single-row probe confirming the deals table itself is reachable.
  const probe = await sb.from("deals").select("*").limit(1);
  printResult("deals_probe_limit1", { ROWS: probe.data ? probe.data.length : null }, probe.error);

  // 5) The actual application-level call: getStore().getStats() — the exact (now paginated,
  //    fixed) method the real app and verify-supabase-readonly.ts use.
  try {
    const { getStore } = await import("../lib/store");
    const stats = await getStore().getStats();
    printResult("getstats_direct", { GETSTATS_DEALS: stats.dealCount, GETSTATS_NEIGHBORHOODS: stats.neighborhoodCount }, null);
  } catch (e) {
    printResult("getstats_direct", { GETSTATS_DEALS: "unknown", GETSTATS_NEIGHBORHOODS: "unknown" }, e);
  }
}

main();
