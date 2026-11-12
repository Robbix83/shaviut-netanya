/**
 * Local dev server that reads the SAME deals as production (DATA_SOURCE=supabase),
 * so a valuation checked locally matches the live site.
 * - searches are not written (lib/searchLog.ts writes only when NODE_ENV=production)
 * - the Meta pixel does not load on localhost (components/Analytics.tsx)
 * - leads DO go to the real `leads` table: don't submit the form while testing,
 *   or mark the test lead "not relevant" in /admin.
 * Bound to localhost only (no -H 0.0.0.0): it serves real data and can write real leads.
 * --use-system-ca: see scripts/dev-preview.mjs (local TLS inspection; verification stays on).
 */
import { spawn } from "node:child_process";

const env = {
  ...process.env,
  DATA_SOURCE: "supabase",
  DATA_TABLES: "v2", // same as Vercel production (deals_v2_preview / neighborhoods_v2_preview)
  NODE_OPTIONS: [process.env.NODE_OPTIONS, "--use-system-ca"].filter(Boolean).join(" "),
};
const port = process.env.PORT || "3032";
const child = spawn("npx", ["next", "dev", "-p", port], { stdio: "inherit", env, shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
