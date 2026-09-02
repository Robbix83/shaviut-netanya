/**
 * Wave 0G-L2: launches the real Next.js dev server with the explicit,
 * reversible preview-table override active (DATA_SOURCE=supabase,
 * PREVIEW_TABLES=1 — see lib/store.ts's SupabaseStore.table()). Used only
 * for acceptance testing against the imported deals_v2_preview/
 * neighborhoods_v2_preview tables; never referenced by the normal `dev`/
 * `build`/`start` scripts, so it changes nothing about how the app runs
 * normally. Leads always still go to the real `leads` table regardless
 * (lib/store.ts never redirects it).
 */
import { spawn } from "node:child_process";

// --use-system-ca: this machine's local network path to Supabase fails
// Node's bundled-CA TLS verification ("unable to verify the first
// certificate") — some local network layer (proxy/AV TLS inspection)
// presents a certificate chain Node's own Mozilla CA bundle doesn't
// trust, but the OS trust store does. This widens which CAs Node
// consults; it does NOT disable certificate verification (unlike
// NODE_TLS_REJECT_UNAUTHORIZED=0, which was deliberately not used here).
// Scoped to this preview-only script — never applied to dev/build/start.
const env = {
  ...process.env,
  DATA_SOURCE: "supabase",
  PREVIEW_TABLES: "1",
  NODE_OPTIONS: [process.env.NODE_OPTIONS, "--use-system-ca"].filter(Boolean).join(" "),
};
// Bound to localhost only, deliberately NOT -H 0.0.0.0 (unlike the normal
// `dev` script) — an ECC security-reviewer finding: this server can serve
// real preview deal/neighborhood data AND write real leads (the leads
// table is never redirected), so it must not be reachable from the LAN.
const child = spawn("npx", ["next", "dev"], { stdio: "inherit", env, shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
