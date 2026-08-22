/**
 * scripts/verify-supabase-readonly.ts  (Wave 0C-2B)
 *
 * STRICTLY READ-ONLY proof that the application's real data-access path
 * (getStore() -> SupabaseStore) is genuinely Supabase-backed, using ONLY
 * existing app code (lib/store.ts, lib/config.ts) — no raw REST bypass for
 * the primary check, no OTP/notification providers, no writes.
 *
 * Requires the OPERATOR's real credentials in the current shell session:
 *   DATA_SOURCE=supabase (this process only)
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (already in the operator's env)
 *
 * NEVER prints secret values. Only counts / booleans / error messages.
 * Calls ONLY: getStats(), listNeighborhoods(), countLeads() — all read-only
 * on the Store interface. No insertLead/updateLeadStatus/updateTabuStatus/
 * optOutByPhone call exists anywhere in this script.
 */
import { resolveDataSource } from "../lib/config";

async function main() {
  // 1) Prove the resolver itself picks Supabase for this explicit, correct value —
  //    using the REAL resolveDataSource() function, not a re-implementation.
  const mode = resolveDataSource({
    DATA_SOURCE: process.env.DATA_SOURCE,
    NODE_ENV: process.env.NODE_ENV,
  });
  console.log(`STORE_MODE=${mode}`);
  if (mode !== "supabase") {
    console.log("ERROR=DATA_SOURCE did not resolve to supabase - set DATA_SOURCE=supabase and re-run.");
    process.exitCode = 2;
    return;
  }

  // 2) getStore() is the app's real singleton factory — same one every API route uses.
  const { getStore } = await import("../lib/store");
  const store = getStore();

  try {
    // Read-only calls only, exactly as the app's own routes use them.
    const stats = await store.getStats(); // { dealCount, neighborhoodCount }
    const neighborhoods = await store.listNeighborhoods("נתניה"); // same literal every real route uses
    const leadCount = await store.countLeads();

    const orphans = neighborhoods.filter((n) => !n.id || !n.name).length;

    console.log(`NEIGHBORHOODS=${neighborhoods.length}`);
    console.log(`DEALS=${stats.dealCount}`);
    console.log(`LEADS=${leadCount}`);
    console.log(`ORPHANS=${orphans}`);
    console.log("ERROR=null");
  } catch (e) {
    console.log("NEIGHBORHOODS=unknown");
    console.log("DEALS=unknown");
    console.log("LEADS=unknown");
    console.log("ORPHANS=unknown");
    console.log(`ERROR=${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}

main();
