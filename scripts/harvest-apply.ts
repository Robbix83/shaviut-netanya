/**
 * scripts/harvest-apply.ts — step 3 of the safe data refresh (docs/HARVEST.md). Run only after
 * reading report.md from step 2.
 *
 *   npx tsx scripts/harvest-apply.ts data/harvest/2026-11            # dry run: checks only
 *   npx tsx scripts/harvest-apply.ts data/harvest/2026-11 --confirm  # inserts added.json
 *
 * - inserts ONLY the rows in added.json into the table production reads (DATA_TABLES=v2 →
 *   deals_v2_preview); existing rows are never updated or deleted (ignoreDuplicates on id)
 * - refuses if the live table's row count isn't the base the comparison was made against
 * - verifies the row count afterwards
 * Then rebuild the market index from merged.json (printed at the end).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Deal } from "../lib/types";

const dir = process.argv[2];
const confirm = process.argv.includes("--confirm");
if (!dir || !existsSync(path.join(dir, "added.json"))) {
  console.error("usage: npx tsx scripts/harvest-apply.ts <harvest dir with added.json> [--confirm]");
  process.exit(1);
}

function loadEnvLocal() {
  const p = path.resolve(__dirname, "..", ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

async function main() {
  loadEnvLocal();
  const TABLE = "deals_v2_preview"; // = resolveDataTables({ DATA_TABLES: "v2" }).deals, what Vercel production reads
  const added = JSON.parse(readFileSync(path.join(dir, "added.json"), "utf8")) as Deal[];
  const baseCount = (JSON.parse(readFileSync(path.resolve(__dirname, "..", "data/v2-candidate/deals-v2.json"), "utf8")) as unknown[]).length;

  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const count = async () => {
    const r = await sb.from(TABLE).select("id", { count: "exact", head: true });
    if (r.error) throw new Error(`count failed: ${r.error.message}`);
    return r.count ?? -1;
  };

  const before = await count();
  console.log(`${TABLE}: ${before} rows live · base file: ${baseCount} · to insert: ${added.length}`);
  if (before !== baseCount) {
    console.error("Live table is not the base the comparison used. Re-run harvest-compare against current data first. Nothing written.");
    process.exit(1);
  }
  if (!confirm) {
    console.log("Dry run OK. Re-run with --confirm to insert.");
    return;
  }

  for (let i = 0; i < added.length; i += 500) {
    const { error } = await sb.from(TABLE).upsert(added.slice(i, i + 500), { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error(`insert failed at row ${i}: ${error.message} (rows before this batch are in; re-running is safe)`);
  }
  const after = await count();
  console.log(`${TABLE}: ${before} → ${after} rows (+${after - before}, expected +${added.length}).`);
  console.log(`Next: npx tsx scripts/build-market-index.ts --data ${path.join(dir, "merged.json")}  then commit data/market-index.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
