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

/** Extracts safe structural fields from a thrown error — never credentials/headers/row data.
 * Supabase/PostgREST errors are plain objects, not `Error` instances, so `String(e)` on
 * them prints "[object Object]"; this reads their actual code/message/details/hint. */
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
    const s = safeError(e);
    console.log(`ERROR=${s.message ?? "unknown error (no message field)"}`);
    console.log(`ERROR_CODE=${s.code ?? "null"}`);
    console.log(`ERROR_DETAILS=${s.details ?? "null"}`);
    console.log(`ERROR_HINT=${s.hint ?? "null"}`);
    process.exitCode = 1;
  }
}

main();
