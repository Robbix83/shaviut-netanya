/**
 * scripts/audit-wave0g18-street-runner.ts — Wave 0G-18: bounded, resumable
 * street-level acquisition pilot for ONE parent entity (קריית השרון,
 * sourceId=65209683) across all 70 of its officially enumerated streets.
 *
 * Builds on Wave 0G-17's proven direct street-query mechanism
 * (`?view=street&id={streetCode}&page=deals`, base_name="streetCode" —
 * see scripts/audit-wave0g17-street-fetch.ts, lib/nadlanAcquisition.ts) and
 * Wave 0G-16's citywide-runner shape (single persistent Chrome context,
 * sequential processing, per-item resumable result files, entity-identity
 * fail-closed checks) — applied here at STREET granularity instead of
 * entity granularity.
 *
 * Hard contract for this wave (do not weaken without a new wave's explicit
 * authorization):
 *   - fetch_number=1 ONLY for every live street request. A captured
 *     envelope with fetch_number>1 is treated as FAILED_OTHER for that
 *     street, never silently accepted.
 *   - No fetch_number=2 is ever attempted (no "הבא" click loop here, unlike
 *     the entity-level Wave 0G-16 runner).
 *   - A street reporting total_fetch>1 in its response is marked
 *     PARTIAL_MORE_FETCHES_INDICATED but its fetch-1 rows are KEPT for
 *     augmentation analysis, not discarded.
 *   - Wrong-PARENT-ENTITY contamination (any row whose own neighborhoodId
 *     is not sourceId) fails that street closed (assertDirectIdAcquisition
 *     Identity requires 100% match) — same-entity, different-street rows
 *     are not a failure, only reported.
 *   - Every write goes through assertSafeShadowOutputPath().
 *
 * Usage: npx tsx scripts/audit-wave0g18-street-runner.ts [--limit N]
 */
import { promises as fs } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { getOfficialEntityStreets, type NadlanStreet } from "../lib/nadlanCatalog";
import { decodeRequestEnvelope } from "../lib/nadlanAcquisition";
import { decodeDealData } from "../lib/dealNormalization";
import { toShadowDeal, parsePaginationContract, assertSafeShadowOutputPath, type ShadowDeal, type PaginationContract } from "../lib/shadowRebuild";
import { classifyRowForAcceptance, classifyBatchForAcceptance, classifyBatchStatus, type RowAcceptanceCounts } from "../lib/streetRowAcceptance";
import { extractPrevDealEvents, type RawPrevDealEvent } from "./audit-wave0g16-citywide-shadow";
import type { Neighborhood } from "../lib/types";

// Wave 0G-20 deliberately does NOT bump this: audit-wave0g18-aggregate.ts
// and audit-wave0g19-replay.ts both import this constant and compare it
// against the 70 already-committed street result files' own
// runContractVersion field — bumping it would break both of those
// already-working, already-committed scripts' ability to reprocess the
// existing artifacts. Resume-safety for the ONE status this wave actually
// changes (the old FAILED_IDENTITY, replaced by FAILED_NO_TRUSTED_ROWS) is
// unaffected either way: FAILED_* statuses were never in RESUMABLE_STATUSES
// to begin with, so they were always re-fetched fresh regardless of version
// string. The formerly-clean SUCCESS_ROWS/SUCCESS_EMPTY/
// PARTIAL_MORE_FETCHES_INDICATED results remain valid under the new logic
// unchanged (they were already 100% all-parent batches).
export const RUN_CONTRACT_VERSION = "wave0g18-v1";
export const PARENT_SOURCE_ID = "65209683"; // קריית השרון
const SHADOW_DIR_REL = "audit/wave0g18/shadow";
const SHADOW_DIR = path.join(process.cwd(), SHADOW_DIR_REL);
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

const PER_REQUEST_TIMEOUT_MS = 25_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [2000, 5000];
const INTER_STREET_DELAY_MS = 1200;
const POST_NAV_SETTLE_MS = 6000;

export type StreetStatus =
  | "SUCCESS_ROWS" // all rows in the batch were explicit parent-id matches (formerly the ONLY success shape)
  | "SUCCESS_MIXED_PARTIAL" // Wave 0G-20 NEW: batch had SOME accepted parent rows AND some rejected (zero/foreign/missing/malformed) rows — never silently reported as SUCCESS_ROWS
  | "SUCCESS_EMPTY"
  | "PARTIAL_MORE_FETCHES_INDICATED"
  | "FAILED_NETWORK"
  | "FAILED_NO_TRUSTED_ROWS" // Wave 0G-20: replaces the old whole-batch FAILED_IDENTITY — the batch had rows, but NONE were an explicit parent-id match (all zero/foreign/missing/malformed)
  | "FAILED_NORMALIZATION"
  | "FAILED_OTHER";

export interface StreetResult {
  streetId: string;
  streetName: string;
  parentSourceId: string;
  runContractVersion: string;
  status: StreetStatus;
  failureReason: string | null;
  fetchNumberUsed: number | null;
  rowsReturned: number;
  totalRowsIfExposed: number | null;
  totalFetchIfExposed: number | null;
  normalizedRows: number;
  normalizationDrops: number;
  rowsMatchingRequestedStreet: number;
  rowsOtherStreetSameEntity: number;
  rowsOtherEntity: number;
  // Wave 0G-20: per-row identity accounting for THIS street's batch. Always
  // populated when rowsReturned>0 (null for a pre-classification failure
  // like a network/envelope error, where classification never ran).
  rowAcceptanceCounts: RowAcceptanceCounts | null;
  earliestDate: string | null;
  latestDate: string | null;
  networkRequests: number;
  retries: number;
  elapsedSeconds: number;
  finishedAt: string;
  // Kept for downstream aggregation only — never committed (this whole
  // directory stays uncommitted, same pattern as prior waves' shadow dirs).
  rows: ShadowDeal[];
  prevDealEvents: RawPrevDealEvent[];
  prevDealNormalizationDrops: number;
}

const RESUMABLE_STATUSES: StreetStatus[] = ["SUCCESS_ROWS", "SUCCESS_MIXED_PARTIAL", "SUCCESS_EMPTY", "PARTIAL_MORE_FETCHES_INDICATED"];

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT: ${label} exceeded ${ms}ms`)), ms)),
  ]);
}

function resultPath(streetId: string): string {
  return path.join(SHADOW_DIR, `street_${PARENT_SOURCE_ID}_${streetId}.json`);
}
function resultPathRel(streetId: string): string {
  return `${SHADOW_DIR_REL}/street_${PARENT_SOURCE_ID}_${streetId}.json`;
}

async function loadExistingResult(streetId: string): Promise<StreetResult | null> {
  try {
    const raw = await fs.readFile(resultPath(streetId), "utf8");
    const parsed: StreetResult = JSON.parse(raw);
    if (parsed.runContractVersion !== RUN_CONTRACT_VERSION) return null;
    if (parsed.parentSourceId !== PARENT_SOURCE_ID) return null;
    if (parsed.streetId !== streetId) return null;
    // FAILED_* is deliberately never resumed (Wave 0G-16 precedent) — a
    // transient network/identity/normalization failure must not become
    // permanent just because a resume happened to land after it.
    if (!RESUMABLE_STATUSES.includes(parsed.status)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveResult(result: StreetResult) {
  assertSafeShadowOutputPath(resultPathRel(result.streetId));
  await fs.writeFile(resultPath(result.streetId), JSON.stringify(result, null, 2));
}

async function readRunManifest(): Promise<Record<string, { status: StreetStatus; runContractVersion: string }>> {
  try {
    const raw = await fs.readFile(path.join(SHADOW_DIR, "street_run_manifest.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
async function writeRunManifest(m: Record<string, { status: StreetStatus; runContractVersion: string }>) {
  const rel = `${SHADOW_DIR_REL}/street_run_manifest.json`;
  assertSafeShadowOutputPath(rel);
  await fs.writeFile(path.join(SHADOW_DIR, "street_run_manifest.json"), JSON.stringify(m, null, 2));
}

/**
 * Classifies + normalizes ONE captured /deal-data exchange for a single
 * street request. Pure function (no I/O) so it is directly unit-testable —
 * see scripts/__tests__/wave0g18StreetRunner.test.ts.
 */
export function classifyStreetExchange(
  street: NadlanStreet,
  parentSourceId: string,
  neighborhood: Neighborhood,
  envelope: ReturnType<typeof decodeRequestEnvelope>,
  respItems: any[],
  decoded: any,
): { status: StreetStatus; failureReason: string | null; fetchNumberUsed: number | null; rows: ShadowDeal[]; normalizationDrops: number; contract: PaginationContract; rowsMatchingRequestedStreet: number; rowsOtherStreetSameEntity: number; rowsOtherEntity: number; rowAcceptanceCounts: RowAcceptanceCounts | null; prevDealEvents: RawPrevDealEvent[]; prevDealNormalizationDrops: number } {
  const contract = parsePaginationContract(decoded, parentSourceId);
  const empty = { rows: [] as ShadowDeal[], normalizationDrops: 0, rowsMatchingRequestedStreet: 0, rowsOtherStreetSameEntity: 0, rowsOtherEntity: 0, rowAcceptanceCounts: null as RowAcceptanceCounts | null, prevDealEvents: [] as RawPrevDealEvent[], prevDealNormalizationDrops: 0 };

  if (!envelope) {
    return { status: "FAILED_OTHER", failureReason: "UNDECODABLE_ENVELOPE", fetchNumberUsed: null, contract, ...empty };
  }
  if (envelope.base_name !== "streetCode") {
    return { status: "FAILED_OTHER", failureReason: `WRONG_BASE_NAME: ${envelope.base_name}`, fetchNumberUsed: envelope.fetch_number ?? null, contract, ...empty };
  }
  // ECC finding (planner + specialist + silent-failure-hunter, all three
  // independently): base_name alone is not enough — a stray streetCode
  // exchange belonging to a DIFFERENT street (e.g. a late-arriving response
  // from the previous navigation) must be rejected too, or it would be
  // silently misattributed as this street's data.
  if (envelope.base_id != null && String(envelope.base_id) !== street.streetId) {
    return { status: "FAILED_OTHER", failureReason: `WRONG_STREET_ID: requested ${street.streetId}, exchange carries base_id=${envelope.base_id}`, fetchNumberUsed: envelope.fetch_number ?? null, contract, ...empty };
  }
  if (envelope.fetch_number != null && envelope.fetch_number !== 1) {
    return { status: "FAILED_OTHER", failureReason: `UNEXPECTED_FETCH_NUMBER: ${envelope.fetch_number} (this wave requests fetch_number=1 only)`, fetchNumberUsed: envelope.fetch_number, contract, ...empty };
  }
  if (respItems.length === 0) {
    return { status: "SUCCESS_EMPTY", failureReason: null, fetchNumberUsed: 1, contract, ...empty };
  }

  // Wave 0G-20: PER-ROW identity acceptance, replacing the old whole-batch
  // all-or-nothing check (assertDirectIdAcquisitionIdentity). One
  // conflicting row no longer discards the entire street — every row's own
  // neighborhoodId decides its own outcome. Throws (fail-closed) if the
  // accounting invariant is ever violated — see lib/streetRowAcceptance.ts.
  const rowAcceptanceCounts = classifyBatchForAcceptance(respItems, parentSourceId);
  const identityBatchStatus = classifyBatchStatus(rowAcceptanceCounts);
  const rowsOtherEntity = rowAcceptanceCounts.rejectedForeign;

  if (identityBatchStatus === "FAILED_NO_TRUSTED_ROWS") {
    // The batch had rows, but none were an explicit parent-id match — no
    // trusted data to keep. Zero-id and foreign rows stay rejected,
    // unconditionally, exactly as before (Wave 0G-19's unresolved zero-id
    // policy is NOT adopted here).
    return {
      status: "FAILED_NO_TRUSTED_ROWS",
      failureReason: `NO_TRUSTED_ROWS: 0/${rowAcceptanceCounts.rawRows} rows matched requested sourceId=${parentSourceId} (zero=${rowAcceptanceCounts.rejectedZero} foreign=${rowAcceptanceCounts.rejectedForeign} missing=${rowAcceptanceCounts.rejectedMissing} malformed=${rowAcceptanceCounts.rejectedMalformed})`,
      fetchNumberUsed: 1, contract, ...empty, rowsOtherEntity, rowAcceptanceCounts,
    };
  }

  // Keep ONLY the accepted (explicit-parent-match) raw rows for
  // normalization — rejected rows never reach toShadowDeal, never reach
  // prevDeals extraction, never reach the augmentation union. ECC finding
  // (specialist, silent-failure-hunter): call the SAME classifier used for
  // rowAcceptanceCounts above, rather than a hand-duplicated inline check —
  // the two were behaviorally identical today, but nothing enforced that.
  const acceptedRawItems = respItems.filter((r: any) => classifyRowForAcceptance(r, parentSourceId) === "ACCEPT_PARENT");
  const shadowRows = acceptedRawItems.map((r: any) => toShadowDeal(r, neighborhood, parentSourceId)).filter((d: ShadowDeal | null): d is ShadowDeal => d !== null);
  const normalizationDrops = acceptedRawItems.length - shadowRows.length;
  if (acceptedRawItems.length > 0 && shadowRows.length === 0) {
    return { status: "FAILED_NORMALIZATION", failureReason: `ALL_ACCEPTED_ROWS_DROPPED_BY_NORMALIZATION: ${acceptedRawItems.length} accepted rows, 0 survived`, fetchNumberUsed: 1, contract, ...empty, rowsOtherEntity, rowAcceptanceCounts, normalizationDrops };
  }

  const onStreet = shadowRows.filter((r) => r.street === street.name || (r.address ?? "").includes(street.name));
  const rowsMatchingRequestedStreet = onStreet.length;
  const rowsOtherStreetSameEntity = shadowRows.length - onStreet.length;

  // prevDeals (Phase 16, Wave 0G-18) — reuses Wave 0G-16's already-tested
  // extraction. Scoped to accepted rows only — a rejected (zero/foreign)
  // row's prevDeals are never extracted, consistent with rejecting the
  // whole row, not just its top-level identity.
  let prevDealEvents: RawPrevDealEvent[] = [];
  let prevDealNormalizationDrops = 0;
  for (const raw of acceptedRawItems) {
    const { events, drops } = extractPrevDealEvents(raw, parentSourceId);
    prevDealEvents.push(...events);
    prevDealNormalizationDrops += drops;
  }

  // Status resolution: identity-mixing takes priority for surfacing (Wave
  // 0G-20's own requirement — a mixed batch must never report as a clean
  // all-parent success), independent of the orthogonal pagination-depth
  // signal, which remains visible via totalFetchIfExposed regardless.
  let status: StreetStatus;
  let failureReason: string | null;
  if (identityBatchStatus === "SUCCESS_MIXED_PARTIAL") {
    status = "SUCCESS_MIXED_PARTIAL";
    failureReason = `MIXED_BATCH: ${rowAcceptanceCounts.acceptedParent}/${rowAcceptanceCounts.rawRows} rows accepted (parent match); rejected zero=${rowAcceptanceCounts.rejectedZero} foreign=${rowAcceptanceCounts.rejectedForeign} missing=${rowAcceptanceCounts.rejectedMissing} malformed=${rowAcceptanceCounts.rejectedMalformed}`;
  } else if (contract.totalFetch != null && contract.totalFetch > 1) {
    status = "PARTIAL_MORE_FETCHES_INDICATED";
    failureReason = `total_fetch=${contract.totalFetch} exceeds 1 — fetch-1 rows kept, deeper fetch NOT attempted this wave`;
  } else {
    status = shadowRows.length === 0 ? "SUCCESS_EMPTY" : "SUCCESS_ROWS";
    failureReason = null;
  }

  return { status, failureReason, fetchNumberUsed: 1, rows: shadowRows, normalizationDrops, contract, rowsMatchingRequestedStreet, rowsOtherStreetSameEntity, rowsOtherEntity, rowAcceptanceCounts, prevDealEvents, prevDealNormalizationDrops };
}

async function processStreet(page: any, street: NadlanStreet, neighborhood: Neighborhood): Promise<StreetResult> {
  const t0 = Date.now();
  let networkRequests = 0;
  let retries = 0;
  let captured: { envelope: ReturnType<typeof decodeRequestEnvelope>; items: any[]; decoded: any } | null = null;
  let navFailureReason: string | null = null;
  // Any /deal-data exchange that did NOT match this street's base_name+
  // base_id — kept ONLY as a diagnostic fallback if no correct exchange
  // ever arrives, so the failure reason is specific (e.g. WRONG_STREET_ID)
  // rather than a generic "no response" (ECC finding, three independent
  // reviewers: base_name alone previously let ANY first response latch in,
  // silently misattributing a stray/wrong-street exchange as this street's
  // data — fixed by requiring an exact base_name+base_id match to capture,
  // and by classifying rejected exchanges through the same pure function
  // so a genuine mismatch is reported by name, not swallowed).
  let rejected: { envelope: ReturnType<typeof decodeRequestEnvelope>; items: any[]; decoded: any } | null = null;

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
      if (captured) return; // already have the correct exchange for this attempt
      const isMatch = envelope?.base_name === "streetCode" && (envelope.base_id == null || String(envelope.base_id) === street.streetId);
      if (isMatch) {
        captured = { envelope, items, decoded };
      } else {
        rejected = { envelope, items, decoded }; // keep most recent for diagnostics only
      }
    } catch (e) {
      log(`  [parse error] ${(e as Error).message}`);
    }
  };
  page.on("response", handler);

  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      captured = null;
      rejected = null;
      try {
        const url = `https://www.nadlan.gov.il/?view=street&id=${street.streetId}&page=deals`;
        await withTimeout(page.goto(url, { waitUntil: "domcontentloaded", timeout: PER_REQUEST_TIMEOUT_MS }), PER_REQUEST_TIMEOUT_MS + 5000, "goto");
        await page.waitForTimeout(POST_NAV_SETTLE_MS);
        if (captured) break;
        throw new Error("NO_DEAL_DATA_RESPONSE_CAPTURED");
      } catch (e) {
        navFailureReason = (e as Error).message;
        if (attempt < MAX_RETRIES) {
          retries++;
          log(`  [retry] ${street.name} (${street.streetId}) attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${navFailureReason}`);
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt] ?? 5000));
        }
      }
    }
  } finally {
    page.off("response", handler);
  }

  // Neither a correct nor a diagnosable-wrong exchange ever arrived —
  // genuine network/timing failure, ambiguous vs. a transiently-empty
  // street (Wave 0G-17 disclosed limitation, unchanged this wave).
  if (!captured && !rejected) {
    return {
      streetId: street.streetId, streetName: street.name, parentSourceId: PARENT_SOURCE_ID, runContractVersion: RUN_CONTRACT_VERSION,
      status: "FAILED_NETWORK",
      failureReason: navFailureReason ?? "NO_DEAL_DATA_RESPONSE_CAPTURED (ambiguous: transient failure vs. genuinely empty street cannot be distinguished when no response arrives at all — Wave 0G-17 disclosed limitation, unchanged this wave)",
      fetchNumberUsed: null, rowsReturned: 0, totalRowsIfExposed: null, totalFetchIfExposed: null,
      normalizedRows: 0, normalizationDrops: 0, rowsMatchingRequestedStreet: 0, rowsOtherStreetSameEntity: 0, rowsOtherEntity: 0, rowAcceptanceCounts: null,
      earliestDate: null, latestDate: null, networkRequests, retries, elapsedSeconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
      finishedAt: new Date().toISOString(), rows: [], prevDealEvents: [], prevDealNormalizationDrops: 0,
    };
  }

  const { envelope, items, decoded } = (captured ?? rejected) as { envelope: ReturnType<typeof decodeRequestEnvelope>; items: any[]; decoded: any };
  const classified = classifyStreetExchange(street, PARENT_SOURCE_ID, neighborhood, envelope, items, decoded);
  const dates = classified.rows.map((r) => r.dealDate).filter(Boolean).sort();

  return {
    streetId: street.streetId, streetName: street.name, parentSourceId: PARENT_SOURCE_ID, runContractVersion: RUN_CONTRACT_VERSION,
    status: classified.status, failureReason: classified.failureReason, fetchNumberUsed: classified.fetchNumberUsed,
    rowsReturned: items.length, totalRowsIfExposed: classified.contract.totalRows, totalFetchIfExposed: classified.contract.totalFetch,
    normalizedRows: classified.rows.length, normalizationDrops: classified.normalizationDrops,
    rowsMatchingRequestedStreet: classified.rowsMatchingRequestedStreet, rowsOtherStreetSameEntity: classified.rowsOtherStreetSameEntity, rowsOtherEntity: classified.rowsOtherEntity,
    rowAcceptanceCounts: classified.rowAcceptanceCounts,
    earliestDate: dates[0] ?? null, latestDate: dates[dates.length - 1] ?? null,
    networkRequests, retries, elapsedSeconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
    finishedAt: new Date().toISOString(), rows: classified.rows,
    prevDealEvents: classified.prevDealEvents, prevDealNormalizationDrops: classified.prevDealNormalizationDrops,
  };
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
  log(`=== WAVE 0G-18 STREET RUNNER (contract=${RUN_CONTRACT_VERSION}, parent=${PARENT_SOURCE_ID}) ===`);

  const streets = await getOfficialEntityStreets(PARENT_SOURCE_ID);
  log(`OFFICIAL_STREET_COUNT=${streets.length}`);
  if (streets.length === 0) throw new Error("EMPTY_STREET_CATALOG: refusing to run — fail closed");
  const targetStreets = streets.slice(0, limit);

  const neighborhood: Neighborhood = { id: PARENT_SOURCE_ID, name: "קריית השרון", settlement: "נתניה", x: null, y: null };
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
    for (const street of targetStreets) {
      idx++;
      const existing = await loadExistingResult(street.streetId);
      if (existing) {
        log(`[${idx}/${targetStreets.length}] ${street.streetId} ${street.name} — RESUMED (${existing.status}, cached)`);
        manifest[street.streetId] = { status: existing.status, runContractVersion: RUN_CONTRACT_VERSION };
        continue;
      }

      log(`[${idx}/${targetStreets.length}] ${street.streetId} ${street.name} — starting live acquisition`);
      let result: StreetResult;
      try {
        result = await processStreet(page, street, neighborhood);
      } catch (e) {
        result = {
          streetId: street.streetId, streetName: street.name, parentSourceId: PARENT_SOURCE_ID, runContractVersion: RUN_CONTRACT_VERSION,
          status: "FAILED_OTHER", failureReason: `UNCAUGHT_ERROR: ${(e as Error).message}`,
          fetchNumberUsed: null, rowsReturned: 0, totalRowsIfExposed: null, totalFetchIfExposed: null,
          normalizedRows: 0, normalizationDrops: 0, rowsMatchingRequestedStreet: 0, rowsOtherStreetSameEntity: 0, rowsOtherEntity: 0, rowAcceptanceCounts: null,
          earliestDate: null, latestDate: null, networkRequests: 0, retries: 0, elapsedSeconds: 0,
          finishedAt: new Date().toISOString(), rows: [], prevDealEvents: [], prevDealNormalizationDrops: 0,
        };
      }
      try {
        await saveResult(result);
        manifest[street.streetId] = { status: result.status, runContractVersion: RUN_CONTRACT_VERSION };
        await writeRunManifest(manifest);
      } catch (e) {
        log(`  [WARNING] failed to persist result/manifest for ${street.streetId}: ${(e as Error).message} — continuing run`);
      }
      log(`[${idx}/${targetStreets.length}] ${street.streetId} ${street.name} — ${result.status} rows=${result.normalizedRows} totalFetch=${result.totalFetchIfExposed} reqs=${result.networkRequests} retries=${result.retries} elapsed=${result.elapsedSeconds}s`);

      await page.waitForTimeout(INTER_STREET_DELAY_MS);
    }
  } finally {
    await ctx.close();
  }

  // ECC code-reviewer finding: a resumed street only updated the IN-MEMORY
  // manifest (line 362), never persisted it — an all-resumed tail run would
  // leave street_run_manifest.json stale on disk. Resume correctness itself
  // never depended on the manifest (loadExistingResult reads the per-street
  // file directly), but the manifest is meant to be an accurate diagnostic
  // summary, so flush it unconditionally here too.
  try {
    await writeRunManifest(manifest);
  } catch (e) {
    log(`  [WARNING] failed to flush final manifest: ${(e as Error).message}`);
  }

  log("=== STREET RUNNER COMPLETE ===");
}

const isDirectExecution = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  main().catch((e) => { console.error("STREET_RUNNER_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
}
