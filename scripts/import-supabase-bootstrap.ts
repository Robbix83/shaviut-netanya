/**
 * scripts/import-supabase-bootstrap.ts  (Wave 0B-2)
 * Resumable, verify-first importer for neighborhoods.json + deals.json into the
 * new Supabase project. DEFAULTS TO DRY-RUN. Real writes require --write.
 *
 * NEVER imports data/leads.json. NEVER prints/stores the service-role key.
 * Credentials are read from the environment ONLY:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * (Falls back to reading those two keys from .env.local if present — gitignored.)
 *
 * Usage:
 *   npx tsx scripts/import-supabase-bootstrap.ts            # dry-run (no writes)
 *   npx tsx scripts/import-supabase-bootstrap.ts --write    # real import (initial)
 *   npx tsx scripts/import-supabase-bootstrap.ts --write --resume
 */
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import {
  EXPECTED_PROJECT_REF, assertTargetProject, projectNeighborhood, projectDeal,
  validateSource, batchRows, digestNeighborhoods, digestDeals, parseArgs,
  checkPreflight, validateResume, DEAL_COLUMNS, NEIGHBORHOOD_COLUMNS,
  formatSupabaseError, redactSecrets, interpretCountResult, type ResumeManifest,
} from "../lib/importBootstrap";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const AUDIT_DIR = path.join(ROOT, "audit", "wave0b2");
const MANIFEST_PATH = path.join(AUDIT_DIR, "MIGRATION_MANIFEST.json");

async function sha256File(p: string): Promise<string> {
  return createHash("sha256").update(await fs.readFile(p)).digest("hex");
}

/** Load the two required env vars; fall back to parsing .env.local (values never logged). */
async function loadEnv(): Promise<{ url?: string; key?: string }> {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if ((!url || !key) && (await exists(path.join(ROOT, ".env.local")))) {
    const raw = await fs.readFile(path.join(ROOT, ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const v = m[2].replace(/^["']|["']$/g, "");
      if (m[1] === "NEXT_PUBLIC_SUPABASE_URL" && !url) url = v;
      if (m[1] === "SUPABASE_SERVICE_ROLE_KEY" && !key) key = v;
    }
  }
  return { url, key };
}
async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

function log(msg: string) { console.log(msg); }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  log(`\n=== Supabase bootstrap import — mode: ${args.dryRun ? "DRY-RUN (no writes)" : "WRITE"}${args.resume ? " +RESUME" : ""}, batchSize=${args.batchSize} ===`);

  // --- env + target project pin ---
  const { url, key } = await loadEnv();
  const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean);
  if (missing.length) {
    log(`STOP: missing required env var(s): ${missing.join(", ")}. Set them for this session (never commit them).`);
    process.exitCode = 2; return;
  }
  const target = assertTargetProject(url);
  log(`target project ref: ${target.ref ?? "?"} (expected ${EXPECTED_PROJECT_REF})`);
  if (!target.ok) { log(`STOP: ${target.error}`); process.exitCode = 2; return; }

  // --- load + validate source (never touch leads.json) ---
  const neighborhoods = JSON.parse(await fs.readFile(path.join(DATA_DIR, "neighborhoods.json"), "utf8"));
  const deals = JSON.parse(await fs.readFile(path.join(DATA_DIR, "deals.json"), "utf8"));
  const sv = validateSource(neighborhoods, deals);
  log(`source: ${sv.neighborhoodCount} neighborhoods, ${sv.dealCount} deals`);
  if (!sv.ok) { log(`STOP: source validation failed:\n - ${sv.errors.join("\n - ")}`); process.exitCode = 2; return; }

  const nSha = await sha256File(path.join(DATA_DIR, "neighborhoods.json"));
  const dSha = await sha256File(path.join(DATA_DIR, "deals.json"));
  const localNDigest = digestNeighborhoods(neighborhoods);
  const localDDigest = digestDeals(deals);
  log(`source sha256: neighborhoods=${nSha.slice(0, 12)}… deals=${dSha.slice(0, 12)}…`);
  log(`local digests: neighborhoods=${localNDigest.digest} deals=${localDDigest.digest}`);

  const projectedNeigh = neighborhoods.map(projectNeighborhood);
  const projectedDeals = deals.map(projectDeal);
  const dealBatches = batchRows(projectedDeals, args.batchSize);
  log(`projection: neighborhoods→${NEIGHBORHOOD_COLUMNS.length} cols, deals→${DEAL_COLUMNS.length} cols; deal batches=${dealBatches.length}`);

  // --- Supabase client (service role) ---
  // Match the verified-good server-side config exactly. autoRefreshToken:false is
  // required in Node: with the default (true), GoTrueClient starts a background
  // setInterval auto-refresh ticker that lingers as an open handle — which, together
  // with the old process.exit() teardown, produced the libuv UV_HANDLE_CLOSING crash
  // that masked the preflight result. A server service-role client needs no refresh.
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });

  // --- remote preflight (read-only) ---
  // Run the counts SEQUENTIALLY (one in-flight request at a time), matching the
  // verified-good standalone single-call test — avoids any shared-client concurrent-HEAD
  // quirk and never abandons an in-flight handle. 0 rows is a valid, expected result.
  let nCount: number, dCount: number, lCount: number;
  try {
    nCount = await countRows(sb, "neighborhoods");
    dCount = await countRows(sb, "deals");
    lCount = await countRows(sb, "leads");
  } catch (e: any) {
    log("STOP: remote preflight failed (no writes performed):");
    log(`  - ${redactSecrets(String(e?.message ?? e))}`);
    log("  (0 rows is expected and valid; a failure here means a real Supabase error or a missing count.)");
    process.exitCode = 1; return;
  }
  log(`remote before: neighborhoods=${nCount}, deals=${dCount}, leads=${lCount}`);
  const pf = checkPreflight({ neighborhoods: nCount, deals: dCount, leads: lCount }, { resume: args.resume });
  if (!pf.ok) { log(`STOP: ${pf.stop}`); process.exitCode = 2; return; }

  if (args.resume) {
    const prior = (await exists(MANIFEST_PATH)) ? (JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8")) as ResumeManifest) : null;
    const rv = validateResume(prior, { ref: target.ref!, neighborhoodsSha: nSha, dealsSha: dSha, leads: lCount });
    if (!rv.ok) { log(`STOP: ${rv.error}`); process.exitCode = 2; return; }
    log("resume validated against prior manifest (same project + identical source hashes).");
  }

  // --- DRY-RUN stops here ---
  if (args.dryRun) {
    log("\nDRY-RUN plan:");
    log(`  1. upsert ${projectedNeigh.length} neighborhoods (by id)`);
    log(`  2. upsert ${projectedDeals.length} deals (by id) in ${dealBatches.length} batches of ≤${args.batchSize}`);
    log("  leads: NEVER imported (public.leads must remain 0).");
    log("DRY-RUN complete — NO writes performed. Re-run with --write to execute.\n");
    return;
  }

  // --- REAL IMPORT ---
  const startTime = new Date().toISOString();
  // Write an in-progress manifest BEFORE any write so a mid-import crash has a
  // clean --resume path (resume validates project ref + source hashes against it).
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  await fs.writeFile(MANIFEST_PATH, JSON.stringify({
    status: "in_progress", targetProjectRef: target.ref,
    sourceNeighborhoodsSha256: nSha, sourceDealsSha256: dSha, startTime,
  }, null, 2), "utf8");
  log("\nimporting neighborhoods (1 upsert)…");
  await withRetry(() => upsert(sb, "neighborhoods", projectedNeigh), "neighborhoods");
  let written = projectedNeigh.length;

  log("importing deals (sequential batches)…");
  const batchLog: { batch: number; rows: number; ok: boolean; ms: number }[] = [];
  for (let i = 0; i < dealBatches.length; i++) {
    const t0 = Date.now();
    await withRetry(() => upsert(sb, "deals", dealBatches[i]), `deals batch ${i + 1}/${dealBatches.length}`);
    const ms = Date.now() - t0;
    written += dealBatches[i].length;
    batchLog.push({ batch: i + 1, rows: dealBatches[i].length, ok: true, ms });
    if ((i + 1) % 5 === 0 || i === dealBatches.length - 1) {
      log(`  batch ${i + 1}/${dealBatches.length} — ${dealBatches[i].length} rows (${ms}ms), total written=${written}`);
    }
  }
  const endTime = new Date().toISOString();

  // --- read-back verification ---
  log("\nverifying remote…");
  const nAfter = await countRows(sb, "neighborhoods");
  const dAfter = await countRows(sb, "deals");
  const lAfter = await countRows(sb, "leads");
  const remoteNeigh = await selectAll(sb, "neighborhoods", NEIGHBORHOOD_COLUMNS);
  const remoteDeals = await selectAll(sb, "deals", DEAL_COLUMNS);
  const remoteNDigest = digestNeighborhoods(remoteNeigh);
  const remoteDDigest = digestDeals(remoteDeals);

  const parity = {
    counts: { neighborhoods: nAfter === sv.neighborhoodCount, deals: dAfter === sv.dealCount, leadsZero: lAfter === 0 },
    digests: {
      neighborhoods: remoteNDigest.digest === localNDigest.digest,
      deals: remoteDDigest.digest === localDDigest.digest,
    },
  };
  log(`remote after: neighborhoods=${nAfter}, deals=${dAfter}, leads=${lAfter}`);
  log(`digest parity: neighborhoods=${parity.digests.neighborhoods}, deals=${parity.digests.deals}`);

  // --- source-unchanged proof ---
  const nShaAfter = await sha256File(path.join(DATA_DIR, "neighborhoods.json"));
  const dShaAfter = await sha256File(path.join(DATA_DIR, "deals.json"));
  const sourceUnchanged = nShaAfter === nSha && dShaAfter === dSha;

  // --- manifest (no secrets) — overwrites the in-progress manifest ---
  const manifest = {
    status: "complete",
    targetProjectRef: target.ref,
    sourceNeighborhoodsSha256: nSha,
    sourceDealsSha256: dSha,
    sourceCounts: { neighborhoods: sv.neighborhoodCount, deals: sv.dealCount },
    startTime, endTime, batchSize: args.batchSize, dealBatches: dealBatches.length,
    rowsWritten: written,
    remoteBefore: { neighborhoods: nCount, deals: dCount, leads: lCount },
    remoteFinal: { neighborhoods: nAfter, deals: dAfter, leads: lAfter },
    localDigests: { neighborhoods: localNDigest.digest, deals: localDDigest.digest },
    remoteDigests: { neighborhoods: remoteNDigest.digest, deals: remoteDDigest.digest },
    parity, sourceUnchanged, batchLog,
  };
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");
  log(`\nmanifest written: ${path.relative(ROOT, MANIFEST_PATH)}`);

  const allGood = parity.counts.neighborhoods && parity.counts.deals && parity.counts.leadsZero &&
    parity.digests.neighborhoods && parity.digests.deals && sourceUnchanged;
  log(allGood ? "✅ IMPORT VERIFIED — full parity, leads=0, source unchanged." : "❌ PARITY/SAFETY CHECK FAILED — see manifest.");
  if (!allGood) process.exitCode = 1;
}

async function countRows(sb: any, table: string): Promise<number> {
  // Exactly the verified-good call shape: select("*", { count: "exact", head: true }).
  // interpretCountResult treats count===0 as a valid success; fails only on a real
  // error or a genuinely missing count.
  const result = await sb.from(table).select("*", { count: "exact", head: true });
  return interpretCountResult(table, result);
}
async function upsert(sb: any, table: string, rows: Record<string, unknown>[]): Promise<void> {
  const { error } = await sb.from(table).upsert(rows, { onConflict: "id" });
  if (error) throw Object.assign(new Error(formatSupabaseError(`upsert(${table})`, error)), { code: error.code });
}
async function selectAll(sb: any, table: string, columns: readonly string[]): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb.from(table).select(columns.join(",")).order("id", { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw Object.assign(new Error(formatSupabaseError(`select(${table})`, error)), { code: error.code });
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

/** Bounded retry: only for transient transport / 429 / 5xx. Deterministic 4xx (schema/type/permission) → no retry. */
async function withRetry(fn: () => Promise<void>, label: string, max = 3): Promise<void> {
  let lastErr: any;
  for (let attempt = 1; attempt <= max; attempt++) {
    try { return await fn(); }
    catch (e: any) {
      lastErr = e;
      const code = String(e?.code ?? "");
      const msg = String(e?.message ?? "");
      // Retry ONLY clearly transient failures: HTTP 429/5xx or transport errors.
      // Everything else (4xx, PostgREST PGRST*, PG classes 22/23/42) is deterministic → abort now.
      const retryable = code === "429" || /^5\d\d$/.test(code) || /fetch failed|ECONN|ETIMEDOUT|network|socket hang/i.test(msg);
      if (!retryable || attempt === max) {
        throw new Error(`${label}: aborting after attempt ${attempt} (${e?.message ?? e})`);
      }
      const delay = 500 * 2 ** (attempt - 1);
      log(`  ${label}: transient error, retry ${attempt}/${max} in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// No process.exit() from async paths: set exitCode and let the event loop drain so
// in-flight fetch/undici handles close normally (avoids the libuv UV_HANDLE_CLOSING assert).
main().catch((e) => {
  console.error("FATAL:", redactSecrets(String(e?.message ?? e)));
  process.exitCode = 1;
});
