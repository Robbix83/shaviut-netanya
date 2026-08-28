/**
 * scripts/audit-wave0g24-multi-entity-street-runner.ts — Wave 0G-24: scales
 * out Wave 0G-18's proven, committed street-augmentation architecture from
 * ONE entity (קריית השרון) to the OTHER 10 Wave 0G-16 PARTIAL entities.
 *
 * Does NOT reimplement the core identity/accounting logic: imports and
 * reuses scripts/audit-wave0g18-street-runner.ts's exported
 * `classifyStreetExchange` UNCHANGED (already parameterized by
 * parentSourceId/neighborhood, so it needed zero modification to be
 * entity-generic). Only the orchestration (multi-entity looping, live
 * fetch dedup, resume/manifest bookkeeping) is new — necessarily, since
 * the Kiryat runner's own orchestration is hardcoded to one entity — but
 * mirrors its exact constants, retry/timeout values, resumability
 * pattern, and status taxonomy. Same hard contract: fetch_number=1 only,
 * no fetch2, no fetch3, per-row identity acceptance, fail-closed
 * accounting.
 *
 * Request-efficiency note: 36 of the 374 official street listings across
 * the 10 target entities share a streetId with another target entity
 * (boundary streets). This runner fetches each DISTINCT streetId's raw
 * batch at most ONCE, then classifies that same raw batch against every
 * entity that lists it — never re-fetching a streetId already captured
 * for a sibling entity. 338 distinct streetIds, not 374 live requests.
 *
 * Usage: npx tsx scripts/audit-wave0g24-multi-entity-street-runner.ts [--limit N]
 */
import { promises as fs } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import type { NadlanStreet } from "../lib/nadlanCatalog";
import { decodeRequestEnvelope } from "../lib/nadlanAcquisition";
import { decodeDealData } from "../lib/dealNormalization";
import { assertSafeShadowOutputPath } from "../lib/shadowRebuild";
import { classifyStreetExchange, type StreetStatus, type StreetResult } from "./audit-wave0g18-street-runner";
import type { Neighborhood } from "../lib/types";

export const RUN_CONTRACT_VERSION = "wave0g24-v1";
const SHADOW_DIR_REL = "audit/wave0g24/shadow";
const SHADOW_DIR = path.join(process.cwd(), SHADOW_DIR_REL);
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

const PER_REQUEST_TIMEOUT_MS = 25_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [2000, 5000];
const INTER_STREET_DELAY_MS = 1200;
const POST_NAV_SETTLE_MS = 6000;

const TARGET_ENTITIES: { name: string; sourceId: string; officialTotal: number; baselineUnique: number }[] = [
  { name: "אזור תעשיה פנחס ספי", sourceId: "65209689", officialTotal: 1021, baselineUnique: 1000 }, // ECC finding: matches audit/wave0g16/citywide_summary.json's canonical NAME exactly
  { name: "עיר ימים", sourceId: "65209703", officialTotal: 3060, baselineUnique: 2325 },
  { name: "קריית נורדאו", sourceId: "65209705", officialTotal: 3281, baselineUnique: 2265 },
  { name: "מרכז העיר", sourceId: "65209717", officialTotal: 9972, baselineUnique: 3282 },
  { name: "חוף הים והמלונות", sourceId: "65209727", officialTotal: 2612, baselineUnique: 2343 },
  { name: "רמת אפרים", sourceId: "65209736", officialTotal: 2266, baselineUnique: 2082 },
  { name: 'מע"ר - מרכז עירוני ר', sourceId: "65210243", officialTotal: 3273, baselineUnique: 2329 },
  { name: "אבו שדיד", sourceId: "65210245", officialTotal: 3082, baselineUnique: 2292 },
  { name: "רסקו", sourceId: "65210248", officialTotal: 2012, baselineUnique: 2010 },
  { name: "מכנס", sourceId: "65210752", officialTotal: 2375, baselineUnique: 2165 },
];
const SETTLEMENT = "נתניה";

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT: ${label} exceeded ${ms}ms`)), ms)),
  ]);
}

function resultPath(entitySourceId: string, streetId: string): string {
  return path.join(SHADOW_DIR, `street_${entitySourceId}_${streetId}.json`);
}
function resultPathRel(entitySourceId: string, streetId: string): string {
  return `${SHADOW_DIR_REL}/street_${entitySourceId}_${streetId}.json`;
}

async function loadExistingResult(entitySourceId: string, streetId: string): Promise<StreetResult | null> {
  try {
    const raw = await fs.readFile(resultPath(entitySourceId, streetId), "utf8");
    const parsed: StreetResult = JSON.parse(raw);
    if (parsed.runContractVersion !== RUN_CONTRACT_VERSION) return null;
    if (parsed.parentSourceId !== entitySourceId) return null;
    if (parsed.streetId !== streetId) return null;
    const RESUMABLE: StreetStatus[] = ["SUCCESS_ROWS", "SUCCESS_MIXED_PARTIAL", "SUCCESS_EMPTY", "PARTIAL_MORE_FETCHES_INDICATED"];
    if (!RESUMABLE.includes(parsed.status)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveResult(entitySourceId: string, result: StreetResult) {
  assertSafeShadowOutputPath(resultPathRel(entitySourceId, result.streetId));
  await fs.writeFile(resultPath(entitySourceId, result.streetId), JSON.stringify(result, null, 2));
}

async function readRunManifest(): Promise<Record<string, StreetStatus>> {
  try {
    return JSON.parse(await fs.readFile(path.join(SHADOW_DIR, "street_run_manifest.json"), "utf8"));
  } catch { return {}; }
}
async function writeRunManifest(m: Record<string, StreetStatus>) {
  const rel = `${SHADOW_DIR_REL}/street_run_manifest.json`;
  assertSafeShadowOutputPath(rel);
  await fs.writeFile(path.join(SHADOW_DIR, "street_run_manifest.json"), JSON.stringify(m, null, 2));
}

/** One live fetch for ONE streetId (used by whichever entity requests it first). Mirrors the Kiryat runner's processStreet capture loop exactly. */
async function liveFetchStreet(page: any, streetId: string, streetName: string): Promise<{ envelope: ReturnType<typeof decodeRequestEnvelope>; items: any[]; decoded: any; networkRequests: number; retries: number; navFailureReason: string | null; hadAnyResponse: boolean }> {
  let networkRequests = 0;
  let retries = 0;
  let captured: { envelope: ReturnType<typeof decodeRequestEnvelope>; items: any[]; decoded: any } | null = null;
  let rejected: { envelope: ReturnType<typeof decodeRequestEnvelope>; items: any[]; decoded: any } | null = null;
  let navFailureReason: string | null = null;

  const handler = async (resp: any) => {
    const u = resp.url();
    if (!u.includes("/deal-data")) return;
    try {
      const body = await resp.text();
      const decoded = decodeDealData(body);
      const items = decoded?.data?.items ?? decoded?.items ?? [];
      const req = resp.request();
      const envelope = decodeRequestEnvelope(req.postData());
      networkRequests++;
      if (captured) return;
      const isMatch = envelope?.base_name === "streetCode" && (envelope.base_id == null || String(envelope.base_id) === streetId);
      if (isMatch) captured = { envelope, items, decoded };
      else rejected = { envelope, items, decoded };
    } catch (e) {
      log(`  [parse error] ${(e as Error).message}`);
    }
  };
  page.on("response", handler);

  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      captured = null; rejected = null;
      try {
        const url = `https://www.nadlan.gov.il/?view=street&id=${streetId}&page=deals`;
        await withTimeout(page.goto(url, { waitUntil: "domcontentloaded", timeout: PER_REQUEST_TIMEOUT_MS }), PER_REQUEST_TIMEOUT_MS + 5000, "goto");
        await page.waitForTimeout(POST_NAV_SETTLE_MS);
        if (captured) break;
        throw new Error("NO_DEAL_DATA_RESPONSE_CAPTURED");
      } catch (e) {
        navFailureReason = (e as Error).message;
        if (attempt < MAX_RETRIES) {
          retries++;
          log(`  [retry] ${streetName} (${streetId}) attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${navFailureReason}`);
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt] ?? 5000));
        }
      }
    }
  } finally {
    page.off("response", handler);
  }

  const winner = captured ?? rejected;
  // ECC code-reviewer finding: distinguish "no /deal-data response ever
  // arrived" (winner is null — matches the original processStreet's
  // `!captured && !rejected` check exactly) from "a response arrived but
  // its envelope/body failed to decode" (winner is non-null with null
  // envelope/decoded) — the latter must still flow through
  // classifyStreetExchange (which reports it as FAILED_OTHER:
  // UNDECODABLE_ENVELOPE) rather than being reported as the generic,
  // less-accurate FAILED_NETWORK.
  return { envelope: winner?.envelope ?? null, items: winner?.items ?? [], decoded: winner?.decoded ?? null, networkRequests, retries, navFailureReason: winner ? null : navFailureReason, hadAnyResponse: winner != null };
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  let limit = Infinity;
  if (limitIdx >= 0) {
    const parsed = parseInt(args[limitIdx + 1], 10);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`INVALID_ARG: --limit requires a positive integer, got ${JSON.stringify(args[limitIdx + 1])}`);
    limit = parsed;
  }

  await fs.mkdir(SHADOW_DIR, { recursive: true });
  log(`=== WAVE 0G-24 MULTI-ENTITY STREET RUNNER (contract=${RUN_CONTRACT_VERSION}) ===`);

  // Build the deduped work list: streetId -> [{entity, street}] from the
  // Phase-3-committed manifests (never refetched here — discovery already done).
  const streetToEntities = new Map<string, { entity: typeof TARGET_ENTITIES[number]; street: NadlanStreet }[]>();
  for (const entity of TARGET_ENTITIES) {
    const manifestPath = path.join(process.cwd(), "audit/wave0g24", `street_manifest_${entity.sourceId}.json`);
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const streets: NadlanStreet[] = manifest.streets;
    if (!Array.isArray(streets) || streets.length === 0) throw new Error(`EMPTY_STREET_MANIFEST: ${entity.name} (${entity.sourceId})`);
    for (const street of streets) {
      if (!streetToEntities.has(street.streetId)) streetToEntities.set(street.streetId, []);
      streetToEntities.get(street.streetId)!.push({ entity, street });
    }
  }
  const distinctStreetIds = [...streetToEntities.keys()].slice(0, limit);
  log(`DISTINCT_STREET_IDS=${distinctStreetIds.length} (of ${streetToEntities.size} total; --limit applied: ${limit !== Infinity})`);

  const manifest = await readRunManifest();

  const headless = process.env.HARVEST_HEADLESS === "true";
  const { chromium: pwChromium } = await import("playwright");
  const ctx = await pwChromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless, slowMo: headless ? 0 : 50,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  let page: any;
  try {
    page = await ctx.newPage();
    await page.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });

    let idx = 0;
    for (const streetId of distinctStreetIds) {
      idx++;
      const refs = streetToEntities.get(streetId)!;
      // Skip the live fetch entirely if every entity referencing this
      // streetId already has a resumable cached result.
      const existingByEntity = new Map<string, StreetResult>();
      for (const { entity } of refs) {
        const existing = await loadExistingResult(entity.sourceId, streetId);
        if (existing) existingByEntity.set(entity.sourceId, existing);
      }
      const missingRefs = refs.filter((r) => !existingByEntity.has(r.entity.sourceId));
      if (missingRefs.length === 0) {
        log(`[${idx}/${distinctStreetIds.length}] streetId=${streetId} (${refs.map((r) => r.entity.name).join("+")}) — ALL RESUMED (cached)`);
        for (const { entity } of refs) manifest[`${entity.sourceId}_${streetId}`] = existingByEntity.get(entity.sourceId)!.status;
        continue;
      }

      // ECC silent-failure-hunter finding: record the already-cached entities'
      // statuses too, not just the newly-processed ones — otherwise a mixed
      // cached/uncached streetId under-reports progress in the manifest even
      // though the underlying result files are correct.
      for (const [sourceId, existing] of existingByEntity) manifest[`${sourceId}_${streetId}`] = existing.status;

      const label = refs[0].street.name;
      log(`[${idx}/${distinctStreetIds.length}] streetId=${streetId} "${label}" — starting live acquisition (needed by: ${missingRefs.map((r) => r.entity.name).join(", ")})`);
      const t0 = Date.now();
      const fetchResult = await liveFetchStreet(page, streetId, label);
      const elapsedSeconds = Number(((Date.now() - t0) / 1000).toFixed(1));

      for (const { entity, street } of refs) {
        if (existingByEntity.has(entity.sourceId)) continue; // already resumed for this entity
        const neighborhood: Neighborhood = { id: entity.sourceId, name: entity.name, settlement: SETTLEMENT, x: null, y: null };
        let result: StreetResult;
        if (!fetchResult.hadAnyResponse) {
          result = {
            streetId, streetName: street.name, parentSourceId: entity.sourceId, runContractVersion: RUN_CONTRACT_VERSION,
            status: "FAILED_NETWORK",
            failureReason: fetchResult.navFailureReason ?? "NO_DEAL_DATA_RESPONSE_CAPTURED",
            fetchNumberUsed: null, rowsReturned: 0, totalRowsIfExposed: null, totalFetchIfExposed: null,
            normalizedRows: 0, normalizationDrops: 0, rowsMatchingRequestedStreet: 0, rowsOtherStreetSameEntity: 0, rowsOtherEntity: 0, rowAcceptanceCounts: null,
            earliestDate: null, latestDate: null, networkRequests: fetchResult.networkRequests, retries: fetchResult.retries, elapsedSeconds,
            finishedAt: new Date().toISOString(), rows: [], prevDealEvents: [], prevDealNormalizationDrops: 0,
          };
        } else {
          const classified = classifyStreetExchange(street, entity.sourceId, neighborhood, fetchResult.envelope, fetchResult.items, fetchResult.decoded);
          const dates = classified.rows.map((r) => r.dealDate).filter(Boolean).sort();
          result = {
            streetId, streetName: street.name, parentSourceId: entity.sourceId, runContractVersion: RUN_CONTRACT_VERSION,
            status: classified.status, failureReason: classified.failureReason, fetchNumberUsed: classified.fetchNumberUsed,
            rowsReturned: fetchResult.items.length, totalRowsIfExposed: classified.contract.totalRows, totalFetchIfExposed: classified.contract.totalFetch,
            normalizedRows: classified.rows.length, normalizationDrops: classified.normalizationDrops,
            rowsMatchingRequestedStreet: classified.rowsMatchingRequestedStreet, rowsOtherStreetSameEntity: classified.rowsOtherStreetSameEntity, rowsOtherEntity: classified.rowsOtherEntity,
            rowAcceptanceCounts: classified.rowAcceptanceCounts,
            earliestDate: dates[0] ?? null, latestDate: dates[dates.length - 1] ?? null,
            networkRequests: fetchResult.networkRequests, retries: fetchResult.retries, elapsedSeconds,
            finishedAt: new Date().toISOString(), rows: classified.rows,
            prevDealEvents: classified.prevDealEvents, prevDealNormalizationDrops: classified.prevDealNormalizationDrops,
          };
        }
        try {
          await saveResult(entity.sourceId, result);
          manifest[`${entity.sourceId}_${streetId}`] = result.status;
        } catch (e) {
          log(`  [WARNING] failed to persist result for ${entity.sourceId}_${streetId}: ${(e as Error).message} — continuing run`);
        }
        log(`  -> ${entity.name}: ${result.status} rows=${result.normalizedRows} totalFetch=${result.totalFetchIfExposed}`);
      }
      try { await writeRunManifest(manifest); } catch (e) { log(`  [WARNING] manifest write failed: ${(e as Error).message}`); }

      await page.waitForTimeout(INTER_STREET_DELAY_MS);
    }
  } finally {
    await ctx.close();
  }

  try { await writeRunManifest(manifest); } catch (e) { log(`  [WARNING] failed to flush final manifest: ${(e as Error).message}`); }
  log("=== MULTI-ENTITY STREET RUNNER COMPLETE ===");
}

const isDirectExecution = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  main().catch((e) => { console.error("RUNNER_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
}
