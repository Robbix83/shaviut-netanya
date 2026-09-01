/**
 * Wednesday Launch Sprint L1 — post-DDL verification of the preview tables
 * the operator created manually via supabase/l1_preview_tables.sql.
 *
 * Distinguishes UNPROVEN (this REST-only connection has no way to observe
 * the fact, e.g. anon/authenticated access — no anon key is configured in
 * this environment) from FAILED (actively contradicts the requirement).
 * Never attempts to mint or guess an anon/authenticated credential.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import path from "path";

function loadEnvLocal() {
  const content = readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const NEIGHBORHOOD_COLS = ["id", "name", "settlement", "x", "y"];
const DEAL_COLS = [
  "id", "dealDate", "price", "propertyType", "rooms", "areaSqm", "plotSqm", "floor",
  "yearBuilt", "dealNature", "address", "houseNumber", "street", "neighborhoodId",
  "neighborhood", "settlement", "x", "y", "pricePerSqm",
];

async function main() {
  loadEnvLocal();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  console.log("--- table existence ---");
  for (const t of ["neighborhoods_v2_preview", "deals_v2_preview"]) {
    const { error, count } = await sb.from(t).select("*", { count: "exact", head: true });
    console.log(`${t}_EXISTS=` + (error ? `FAILED (${error.code}:${error.message})` : "YES"));
    if (!error) console.log(`${t}_CURRENT_COUNT=${count}`);
  }

  console.log("--- column shape (validated by selecting explicit column lists on empty tables) ---");
  {
    const { error } = await sb.from("neighborhoods_v2_preview").select(NEIGHBORHOOD_COLS.join(",")).limit(1);
    console.log("NEIGHBORHOODS_V2_PREVIEW_SCHEMA=" + (error ? `FAILED (${error.code}:${error.message})` : "MATCHES_EXPECTED_5_COLS"));
  }
  {
    const quoted = DEAL_COLS.map((c) => `"${c}"`).join(",");
    const { error } = await sb.from("deals_v2_preview").select(quoted).limit(1);
    console.log("DEALS_V2_PREVIEW_SCHEMA=" + (error ? `FAILED (${error.code}:${error.message})` : "MATCHES_EXPECTED_19_COLS"));
  }

  console.log("--- service_role DELETE probe (must be rejected — tested on a nonexistent id, zero side effects either way) ---");
  {
    const { error, status } = await sb.from("deals_v2_preview").delete().eq("id", "__l1_delete_probe_nonexistent__");
    if (error && (error.code === "42501" || /permission denied/i.test(error.message))) {
      console.log("SERVICE_ROLE_DELETE=NO (permission denied, code=" + error.code + ")");
    } else if (error) {
      console.log("SERVICE_ROLE_DELETE=UNPROVEN (unexpected error, not a clear permission denial: " + error.code + ":" + error.message + ")");
    } else {
      console.log("SERVICE_ROLE_DELETE=FAILED_UNEXPECTED (delete call succeeded with no permission error, status=" + status + " — DELETE grant may be present)");
    }
  }

  console.log("--- anon / authenticated access (UNPROVEN via this connection — no anon/authenticated key is configured in this environment; only the service-role key is present) ---");
  console.log("ANON_ACCESS=UNPROVEN (no NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local — cannot make a live anon-role request)");
  console.log("AUTHENTICATED_ACCESS=UNPROVEN (no mechanism in this environment mints a Supabase authenticated-role JWT)");
  console.log("NOTE: supabase/l1_preview_tables.sql explicitly executed `revoke all ... from anon, authenticated` and the operator confirmed SUCCESS with no error; this is documentary evidence the intended posture was applied, not a live proof from this session.");
}

main();
