/**
 * Wednesday Launch Sprint L1 — import the frozen V2 launch candidate into
 * the isolated deals_v2_preview / neighborhoods_v2_preview tables (created
 * manually by the operator via supabase/l1_preview_tables.sql). Never
 * writes to deals/neighborhoods/leads. Bounded batches, fail-closed: any
 * batch error stops the import immediately with no further writes.
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";

const FROZEN_V2_SHA256 = "8bb6770525894cd2053293d0c60acb877e6acd77d81bdd30c02200e5e6c34bf0";
const EXPECTED_DEALS = 59305;
const EXPECTED_NEIGHBORHOODS = 38;
const BATCH_SIZE = 500;

function loadEnvLocal() {
  const content = readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function main() {
  loadEnvLocal();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  // ---- Phase: load + verify the frozen candidate, unchanged since L0 ----
  const dealsPath = path.resolve(process.cwd(), "data", "v2-candidate", "deals-v2.json");
  const neighPath = path.resolve(process.cwd(), "data", "v2-candidate", "neighborhoods-v2.json");
  const dealsBuf = readFileSync(dealsPath);
  const actualSha = sha256(dealsBuf);
  if (actualSha !== FROZEN_V2_SHA256) {
    throw new Error(`SHA_MISMATCH: expected ${FROZEN_V2_SHA256}, got ${actualSha} — refusing to import a changed candidate`);
  }
  const deals: any[] = JSON.parse(dealsBuf.toString("utf8"));
  const neighborhoods: any[] = JSON.parse(readFileSync(neighPath, "utf8"));
  console.log(`SOURCE_SHA256=${actualSha}`);
  console.log(`SOURCE_DEALS=${deals.length}`);
  console.log(`SOURCE_NEIGHBORHOODS=${neighborhoods.length}`);
  if (deals.length !== EXPECTED_DEALS) throw new Error(`SOURCE_COUNT_MISMATCH:deals:${deals.length}!=${EXPECTED_DEALS}`);
  if (neighborhoods.length !== EXPECTED_NEIGHBORHOODS) throw new Error(`SOURCE_COUNT_MISMATCH:neighborhoods:${neighborhoods.length}!=${EXPECTED_NEIGHBORHOODS}`);

  // ---- Defensive pre-import validation (fail-closed on any structural issue) ----
  // Scans every row for every check before deciding whether to proceed — throwing on
  // the FIRST problem found would hide any other defect category lurking later in the
  // file, giving a false "only this one issue" impression.
  const neighIds = new Set(neighborhoods.map((n) => n.id));
  const seenIds = new Set<string>();
  const duplicateIds = new Set<string>();
  const orphanedFk: string[] = [];
  const invalidPrice: string[] = [];
  const unexpectedPrevDeals: string[] = [];
  for (const d of deals) {
    if (seenIds.has(d.id)) duplicateIds.add(d.id);
    seenIds.add(d.id);
    if (!d.neighborhoodId || d.neighborhoodId === "0" || !neighIds.has(d.neighborhoodId)) {
      orphanedFk.push(d.id);
    }
    if (d.price == null || !Number.isFinite(d.price) || d.price <= 0) {
      invalidPrice.push(d.id);
    }
    if ("prevDeals" in d || "uniquePrevDeals" in d) {
      unexpectedPrevDeals.push(d.id);
    }
  }
  if (duplicateIds.size || orphanedFk.length || invalidPrice.length || unexpectedPrevDeals.length) {
    console.log(`VALIDATION_DUPLICATE_IDS=${duplicateIds.size}`);
    console.log(`VALIDATION_ORPHANED_FK=${orphanedFk.length}`);
    console.log(`VALIDATION_INVALID_PRICE=${invalidPrice.length}`);
    console.log(`VALIDATION_UNEXPECTED_PREVDEALS=${unexpectedPrevDeals.length}`);
    throw new Error(
      `PRE_IMPORT_VALIDATION_FAILED:duplicateIds=${duplicateIds.size}:orphanedFk=${orphanedFk.length}:invalidPrice=${invalidPrice.length}:unexpectedPrevDeals=${unexpectedPrevDeals.length}`
    );
  }
  console.log("PRE_IMPORT_VALIDATION=PASS");

  // ---- Confirm target tables are currently empty (clean-slate import, not upsert) ----
  for (const t of ["neighborhoods_v2_preview", "deals_v2_preview"]) {
    const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
    if (error) throw new Error(`PRECHECK_FAILED:${t}:${error.code}:${error.message}`);
    if (count !== 0) throw new Error(`TABLE_NOT_EMPTY:${t}:${count} — refusing to import on top of existing rows`);
  }
  console.log("PREVIEW_TABLES_EMPTY_PRECHECK=PASS");

  // ---- Import neighborhoods (must precede deals — FK) ----
  {
    const { error } = await sb.from("neighborhoods_v2_preview").insert(neighborhoods);
    if (error) throw new Error(`NEIGHBORHOOD_IMPORT_FAILED:${error.code}:${error.message}`);
    console.log(`NEIGHBORHOODS_IMPORTED=${neighborhoods.length}`);
  }

  // ---- Prove UPDATE grant with a real, semantically-identical no-op write ----
  // `.update()` alone returns error:null even when zero rows matched (wrong id, RLS
  // silently filtering) — that would falsely "prove" the grant. Require .select() to
  // come back with exactly the one row updated.
  {
    const probe = neighborhoods[0];
    const { data, error } = await sb
      .from("neighborhoods_v2_preview")
      .update({ settlement: probe.settlement })
      .eq("id", probe.id)
      .select("id");
    if (error) throw new Error(`UPDATE_GRANT_PROBE_FAILED:${error.code}:${error.message}`);
    if (!data || data.length !== 1) {
      throw new Error(`UPDATE_GRANT_PROBE_INCONCLUSIVE:matched=${data?.length ?? 0}:expected=1`);
    }
    console.log(`SERVICE_ROLE_UPDATE_PROBE=PASS (no-op update on ${probe.id}, confirmed 1 row matched)`);
  }

  // ---- Import deals in bounded batches, fail-closed ----
  let imported = 0;
  for (let offset = 0; offset < deals.length; offset += BATCH_SIZE) {
    const batch = deals.slice(offset, offset + BATCH_SIZE);
    const { error } = await sb.from("deals_v2_preview").insert(batch);
    if (error) {
      throw new Error(
        `DEAL_BATCH_IMPORT_FAILED:offset=${offset}:batchSize=${batch.length}:imported_before_failure=${imported}:${error.code}:${error.message}`
      );
    }
    imported += batch.length;
    if (offset % 10000 === 0) console.log(`DEALS_IMPORTED_SO_FAR=${imported}/${deals.length}`);
  }
  console.log(`DEALS_IMPORTED=${imported}`);

  // ---- Post-import count reconciliation ----
  for (const [t, expected] of [
    ["neighborhoods_v2_preview", EXPECTED_NEIGHBORHOODS],
    ["deals_v2_preview", EXPECTED_DEALS],
  ] as const) {
    const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
    if (error) throw new Error(`POSTCHECK_FAILED:${t}:${error.code}:${error.message}`);
    console.log(`${t.toUpperCase()}_FINAL_COUNT=${count}`);
    if (count !== expected) throw new Error(`POST_IMPORT_COUNT_MISMATCH:${t}:${count}!=${expected}`);
  }
  console.log("IMPORT_DONE=YES");
}

main().catch((e) => {
  console.error("IMPORT_FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
