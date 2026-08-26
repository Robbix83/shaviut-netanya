/**
 * scripts/audit-wave0g16-citywide-shadow.ts — Wave 0G-16: citywide READ-ONLY
 * shadow coverage audit over all official nadlan.gov.il Netanya entities.
 *
 * For EACH entity, runs the coverage-driven acquisition sequence proven safe
 * across Waves 0G-12..0G-15: read official total_rows, try proven-safe
 * surfaces one at a time in a fixed priority order, stop the INSTANT the
 * running unique top-level count equals total_rows, fail closed the instant
 * it exceeds total_rows, and mark PARTIAL if every approved surface is
 * exhausted with a delta still remaining. Never fetch_number>=2 for anything
 * but the two date-sort directions; never fetch_number>=3 for anything.
 *
 * Reuses every already-proven/tested primitive — no new acquisition
 * technique, no new request shape, no invented sort value:
 *   discovery:      lib/nadlanCatalog.ts        (getOfficialNetanyaEntities)
 *   direct acquire:  lib/nadlanAcquisition.ts     (buildDirectNeighborhoodUrl,
 *                    assertDirectIdAcquisitionIdentity, decodeRequestEnvelope)
 *   normalization:   lib/dealNormalization.ts     (decodeDealData)
 *   shadow core:     lib/shadowRebuild.ts         (toShadowDeal,
 *                    dedupByTransactionKey, transactionKey,
 *                    parsePaginationContract, assertSafeShadowOutputPath)
 *
 * Safety:
 *  - NEVER writes data/deals.json, data/neighborhoods.json, or anything
 *    Supabase-shaped — every write goes through assertSafeShadowOutputPath().
 *  - Single persistent Chrome context reused across all 38 entities
 *    (politeness: no per-entity browser relaunch, concurrency=1 throughout —
 *    a browser page can only be in one place at a time, so this is the
 *    natural and only concurrency level, not a speculative choice).
 *  - Per-request timeout + bounded retry + backoff on every network wait.
 *  - One entity's failure (network error, identity mismatch, ambiguous
 *    collision) is caught and recorded as FAILED — it never aborts the run.
 *  - Resumable: each entity's result is written to its own JSON file tagged
 *    with sourceId + RUN_CONTRACT_VERSION; a terminal-status file matching
 *    both is reused on the next invocation instead of re-fetching live.
 *
 * Usage: npx tsx scripts/audit-wave0g16-citywide-shadow.ts [--limit N] [--only sourceId1,sourceId2]
 */
import { promises as fs } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { getOfficialNetanyaEntities, type NadlanEntity } from "../lib/nadlanCatalog";
import { buildDirectNeighborhoodUrl, assertDirectIdAcquisitionIdentity, decodeRequestEnvelope } from "../lib/nadlanAcquisition";
import { decodeDealData } from "../lib/dealNormalization";
import {
  toShadowDeal, dedupByTransactionKey, transactionKey, parsePaginationContract,
  assertSafeShadowOutputPath, type ShadowDeal, type PaginationContract,
} from "../lib/shadowRebuild";
import type { Neighborhood } from "../lib/types";

export const RUN_CONTRACT_VERSION = "wave0g16-v1";
const SHADOW_DIR_REL = "audit/wave0g16/shadow-output";
const SHADOW_DIR = path.join(process.cwd(), SHADOW_DIR_REL);
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

const PER_REQUEST_TIMEOUT_MS = 25_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [2000, 5000];
const INTER_ENTITY_DELAY_MS = 1200;
const POST_ACTION_SETTLE_MS = 6000;
const LOGIN_WALL_HITS_TO_ABORT_SURFACE = 3;
const DIALOG_DISMISS_ATTEMPT_CAP = 15;

/** Fixed, coverage-driven surface priority — never reordered per entity. */
interface SurfaceSpec {
  key: string;
  typeOrder: string;
  fetchNumber: 1 | 2;
  kind: "desc_baseline" | "desc_next" | "select_sort" | "sort_next";
  uiLabel?: string; // for select_sort kind
}
const SURFACE_PLAN: SurfaceSpec[] = [
  { key: "date_desc_1", typeOrder: "dealDate_down", fetchNumber: 1, kind: "desc_baseline" },
  { key: "date_desc_2", typeOrder: "dealDate_down", fetchNumber: 2, kind: "desc_next" },
  { key: "date_asc_1", typeOrder: "dealDate_up", fetchNumber: 1, kind: "select_sort", uiLabel: "תאריך עסקה - סדר עולה" },
  { key: "date_asc_2", typeOrder: "dealDate_up", fetchNumber: 2, kind: "sort_next" },
  { key: "price_desc_1", typeOrder: "dealAmount_down", fetchNumber: 1, kind: "select_sort", uiLabel: "מחיר העסקה - סדר יורד" },
  { key: "price_asc_1", typeOrder: "dealAmount_up", fetchNumber: 1, kind: "select_sort", uiLabel: "מחיר העסקה - סדר עולה" },
  { key: "rooms_desc_1", typeOrder: "roomNum_down", fetchNumber: 1, kind: "select_sort", uiLabel: "מס' חדרים - סדר יורד" },
  { key: "rooms_asc_1", typeOrder: "roomNum_up", fetchNumber: 1, kind: "select_sort", uiLabel: "מס' חדרים - סדר עולה" },
];
/** Every OTHER surface's type_order — used to detect a misclick landing on
 * a different known sort than the one intended for the current step. */
const ALL_TYPE_ORDERS = SURFACE_PLAN.map((s) => s.typeOrder);

export interface RawPrevDealEvent {
  dealDate: string;
  price: number;
  parcelNum: string | null;
  sourceId: string;
}

interface ExchangeCapture {
  seq: number;
  typeOrder: string | null;
  fetchNumber: number | null;
  contract: PaginationContract;
  identityValid: boolean;
  identityError: string | null;
  items: any[];
}

type EntityStatus = "COMPLETE" | "PARTIAL" | "FAILED";

interface EntityResult {
  sourceId: string;
  name: string;
  runContractVersion: string;
  status: EntityStatus;
  failureReason: string | null;
  officialTotalRows: number | null;
  officialTotalFetch: number | null;
  surfacesUsed: string[];
  rawTopLevelRows: number;
  normalizedTopLevelRows: number;
  normalizationDrops: number;
  uniqueTopLevel: number;
  delta: number | null;
  earliestDate: string | null;
  latestDate: string | null;
  minusZeroRows: number;
  minusZeroCollisions: number;
  ambiguousCollisions: number;
  rawPrevDealEvents: number;
  uniquePrevDealEvents: number;
  prevDealNormalizationDrops: number;
  validAddressRows: number;
  streetZeroRows: number;
  missingHouseRows: number;
  dealNatureCounts: Record<string, number>;
  networkRequests: number;
  elapsedSeconds: number;
  finishedAt: string;
  // Full row data kept locally for downstream aggregation/comparison; never
  // committed (this whole directory is shadow-only, excluded from git add).
  uniqueRows: ShadowDeal[];
  uniquePrevDeals: RawPrevDealEvent[];
}

function log(msg: string) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      log(`  [retry] ${label} attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${(e as Error).message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt] ?? 5000));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT: ${label} exceeded ${ms}ms`)), ms)),
  ]);
}

/** Extracts prevDeals events from a raw top-level item. Wave 0G-13 proved
 * these carry ONLY dealDate/dealAmount (never any other field, 362/362
 * tested) — this normalizer does not invent fields beyond that finding. */
export function extractPrevDealEvents(raw: any, sourceId: string): { events: RawPrevDealEvent[]; drops: number } {
  const list = Array.isArray(raw?.prevDeals) ? raw.prevDeals : [];
  const events: RawPrevDealEvent[] = [];
  let drops = 0;
  for (const ev of list) {
    const dateRaw = ev?.dealDate;
    const amountRaw = ev?.dealAmount;
    const dealDate = dateRaw ? new Date(dateRaw).toISOString().slice(0, 10) : "";
    const price = typeof amountRaw === "number" ? amountRaw : Number(String(amountRaw ?? "").replace(/[^\d.]/g, ""));
    if (!dealDate || !Number.isFinite(price) || price <= 0) { drops++; continue; }
    events.push({ dealDate, price, parcelNum: raw?.parcelNum != null ? String(raw.parcelNum) : null, sourceId });
  }
  return { events, drops };
}

// Includes sourceId (ECC database-reviewer finding): correctness previously
// relied only on the caller's dedup Map being scoped fresh per entity, not
// on the key itself — safe today, but fragile against a future caller (e.g.
// an aggregation step) that merges events across entities, where two
// different entities' properties could otherwise coincidentally collide on
// parcelNum+dealDate+price.
export function prevDealKey(e: RawPrevDealEvent): string {
  return `${e.sourceId}|${e.parcelNum ?? "∅NULL_PARCEL∅"}|${e.dealDate}|${e.price}`;
}

/** Detects collision groups whose members disagree on fields OUTSIDE the
 * transaction key (street/houseNumber/floor/areaSqm) — the signal that a
 * key collision may be hiding two genuinely distinct transactions rather
 * than the same one re-observed through an overlapping sort window. */
export function detectAmbiguousCollisions(rows: ShadowDeal[]): { ambiguousCount: number; examples: any[] } {
  const groups = new Map<string, ShadowDeal[]>();
  for (const r of rows) {
    const k = transactionKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  let ambiguousCount = 0;
  const examples: any[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const streets = new Set(g.map((r) => r.street ?? "∅"));
    const houseNums = new Set(g.map((r) => r.houseNumber ?? "∅"));
    const floors = new Set(g.map((r) => r.floor ?? "∅"));
    const areas = new Set(g.map((r) => r.areaSqm ?? "∅"));
    if (streets.size > 1 || houseNums.size > 1 || floors.size > 1 || areas.size > 1) {
      ambiguousCount++;
      if (examples.length < 5) {
        examples.push(g.map((r) => ({ parcelNum: (r as any).parcelNum, dealDate: r.dealDate, price: r.price, street: r.street, houseNumber: r.houseNumber, floor: r.floor, areaSqm: r.areaSqm })));
      }
    }
  }
  return { ambiguousCount, examples };
}

async function readManifest(): Promise<Record<string, { status: EntityStatus; runContractVersion: string }>> {
  try {
    const raw = await fs.readFile(path.join(SHADOW_DIR, "manifest.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeManifest(manifest: Record<string, { status: EntityStatus; runContractVersion: string }>) {
  assertSafeShadowOutputPath(`${SHADOW_DIR_REL}/manifest.json`);
  await fs.writeFile(path.join(SHADOW_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
}

async function loadExistingResult(sourceId: string): Promise<EntityResult | null> {
  try {
    const raw = await fs.readFile(path.join(SHADOW_DIR, `${sourceId}.json`), "utf8");
    const parsed: EntityResult = JSON.parse(raw);
    // Never resume data from a different request-contract version silently.
    if (parsed.runContractVersion !== RUN_CONTRACT_VERSION) return null;
    if (parsed.sourceId !== sourceId) return null;
    // FAILED is deliberately NOT resumable (ECC planner finding): a
    // transient network/IO error would otherwise become a PERMANENT result
    // that a re-run can never retry. Only genuinely terminal outcomes
    // (COMPLETE/PARTIAL, both requiring a real reconciled comparison against
    // official total_rows) are cached; a FAILED entity is always re-attempted.
    if (parsed.status === "COMPLETE" || parsed.status === "PARTIAL") return parsed;
    return null;
  } catch {
    return null;
  }
}

async function saveResult(result: EntityResult) {
  assertSafeShadowOutputPath(`${SHADOW_DIR_REL}/${result.sourceId}.json`);
  await fs.writeFile(path.join(SHADOW_DIR, `${result.sourceId}.json`), JSON.stringify(result, null, 2));
}

async function processEntity(page: any, entity: NadlanEntity): Promise<EntityResult> {
  const sourceId = entity.sourceId;
  const neighborhood: Neighborhood = { id: sourceId, name: entity.name, settlement: "נתניה", x: null, y: null };
  const t0 = Date.now();

  const exchanges: ExchangeCapture[] = [];
  let seq = 0;
  let networkRequests = 0;
  let entityFailed = false;
  let failureReason: string | null = null;

  const captureHandler = async (resp: any) => {
    const u = resp.url();
    if (!u.includes("/deal-data")) return;
    try {
      const body = await resp.text();
      const decoded = decodeDealData(body);
      const items = decoded?.data?.items ?? decoded?.items ?? [];
      seq++;
      networkRequests++;
      const contract = parsePaginationContract(decoded, sourceId);
      const req = resp.request();
      const envelope = decodeRequestEnvelope(req.postData());

      // Surface-aware depth guard (ECC planner + specialist finding): only
      // the two DATE sort directions were ever proven safe at fetch_number=2
      // (Wave 0G-13). Every other surface (price/rooms, either direction) is
      // proven ONLY at fetch_number=1 — a flat ">2" check would silently
      // accept an unproven fetch_number=2 response from an alternate-sort
      // surface into the union without ever tripping this tripwire.
      const isDateSurface = envelope?.type_order === "dealDate_down" || envelope?.type_order === "dealDate_up";
      const maxProvenFetchNumber = isDateSurface ? 2 : 1;
      if (!envelope) {
        entityFailed = true;
        failureReason = `UNDECODABLE_REQUEST_ENVELOPE at exchange ${seq}`;
      } else if (envelope.fetch_number != null && envelope.fetch_number > maxProvenFetchNumber) {
        entityFailed = true;
        failureReason = `UNSUPPORTED_FETCH_DEPTH at exchange ${seq}: fetch_number=${envelope.fetch_number} type_order=${envelope.type_order} (max proven for this surface is ${maxProvenFetchNumber})`;
      }

      const identity = assertDirectIdAcquisitionIdentity(items, sourceId);
      if (!identity.valid) {
        entityFailed = true;
        failureReason = `IDENTITY_FAIL at exchange ${seq}: ${identity.error}`;
      }

      exchanges.push({
        seq, typeOrder: envelope?.type_order ?? null, fetchNumber: envelope?.fetch_number ?? null,
        contract, identityValid: identity.valid, identityError: identity.error,
        items: identity.valid && !entityFailed ? items : [],
      });
    } catch (e) {
      log(`  [response parse error] ${(e as Error).message}`);
    }
  };
  page.on("response", captureHandler);

  const surfacesUsed: string[] = [];
  let officialTotalRows: number | null = null;
  let officialTotalFetch: number | null = null;
  let currentUnion: ShadowDeal[] = [];
  let currentUniqueCount = 0;

  function recomputeUnion(): void {
    const allRaw = exchanges.flatMap((e) => e.items);
    const shadowRows = allRaw
      .map((r) => toShadowDeal(r, neighborhood, sourceId))
      .filter((d): d is ShadowDeal => d !== null);
    const dedup = dedupByTransactionKey(shadowRows);
    currentUnion = dedup.uniqueRows;
    currentUniqueCount = dedup.uniqueCount;
  }

  function updateContractFromLatest(): void {
    const latest = [...exchanges].reverse().find((e) => e.contract.totalRows != null);
    if (latest) {
      officialTotalRows = latest.contract.totalRows;
      officialTotalFetch = latest.contract.totalFetch;
    }
  }

  try {
    // --- SURFACE 1: date_desc_1 (baseline page load) ---
    // Retried as a unit that must OBSERVE a captured total_rows, not merely
    // complete without throwing — a `goto` that resolves before the page's
    // own async data fetch completes is a real, previously-observed
    // transient failure mode, not an exception `withRetry` alone would catch.
    const url = buildDirectNeighborhoodUrl(sourceId);
    await withRetry("navigate+observe-baseline", async () => {
      await withTimeout(page.goto(url, { waitUntil: "domcontentloaded", timeout: PER_REQUEST_TIMEOUT_MS }), PER_REQUEST_TIMEOUT_MS + 5000, "goto");
      await page.waitForTimeout(POST_ACTION_SETTLE_MS);
      updateContractFromLatest();
      if (officialTotalRows == null) {
        throw new Error("NO_TOTAL_ROWS_OBSERVED_AFTER_BASELINE_LOAD");
      }
    });
    surfacesUsed.push("date_desc_1");
    recomputeUnion();

    for (const surface of SURFACE_PLAN.slice(1)) {
      if (entityFailed) break;
      if (officialTotalRows != null && currentUniqueCount >= officialTotalRows) break; // stop condition
      if (officialTotalRows != null && officialTotalRows <= 500 && (surface.kind === "desc_next")) continue; // fetch2 pointless if <=500 rows total
      if (officialTotalFetch != null && officialTotalFetch <= 1 && (surface.kind === "desc_next" || surface.kind === "sort_next")) continue;

      const exCountBefore = exchanges.length;
      try {

      if (surface.kind === "desc_next" || surface.kind === "sort_next") {
        // Proven pattern (Wave 0G-12/0G-13): "הבא" paginates the UI in small
        // (~10-row) increments while the underlying fetch stays at
        // fetch_number=1 — reaching fetch_number=2's real network exchange
        // requires MANY repeated clicks, not one. A single click only
        // advances the on-screen page within the already-fetched batch.
        const nextButton = page.locator("button, a").filter({ hasText: "הבא" }).first();
        const nextCount = await nextButton.count();
        if (nextCount === 0) { log(`  NO_NEXT_BUTTON for ${surface.key} — skipping surface`); continue; }
        const latestContract = [...exchanges].reverse().find((e) => e.contract.totalRows != null)?.contract;
        const rowsPerPage = latestContract?.totalRows && latestContract?.totalPage
          ? Math.round(latestContract.totalRows / latestContract.totalPage) : 10;
        const clickBudget = Math.ceil(500 / rowsPerPage) + 3;
        log(`  ${surface.key}: CLICK_BUDGET=${clickBudget} rowsPerPage=${rowsPerPage} (targeting fetch_number=${surface.fetchNumber})`);
        let loginWallHits = 0;
        let dismissAttempts = 0;
        let reachedTarget = false;
        for (let i = 1; i <= clickBudget; i++) {
          reachedTarget = exchanges.some((e) => e.typeOrder === surface.typeOrder && (e.fetchNumber ?? 0) >= surface.fetchNumber);
          if (reachedTarget) { log(`  ${surface.key}: FETCH_NUMBER_${surface.fetchNumber}_REACHED_AT_CLICK=${i - 1}`); break; }
          try {
            await withTimeout(nextButton.click({ timeout: 5000 }), 8000, "next-click");
          } catch {
            dismissAttempts++;
            const dlg = page.locator("div.modal.show, div[class*='contanctModal']").first();
            if (await dlg.count().catch(() => 0)) {
              const html = await dlg.evaluate((el: any) => el.outerHTML).catch(() => "");
              if (/התחברות|לצפייה בנתונים נוספים/.test(html)) loginWallHits++;
            }
            if (loginWallHits >= LOGIN_WALL_HITS_TO_ABORT_SURFACE) { log(`  LOGIN_WALL on ${surface.key} — abandoning this surface only`); break; }
            if (dismissAttempts > DIALOG_DISMISS_ATTEMPT_CAP) break;
            const closeSelectors = [
              "button.closeModalBtnContainer", "div[role='dialog'] button.close", "div[role='dialog'] [aria-label='Close']",
              "div[role='dialog'] .btn-close", "div[role='dialog'] button[class*='close']",
              "div.modal.show button[class*='close']", "div.modal.show [aria-label='סגור']",
            ];
            for (const sel of closeSelectors) {
              const closeBtn = page.locator(sel).first();
              if (await closeBtn.count().catch(() => 0)) {
                try { await closeBtn.click({ timeout: 2000 }); break; } catch { /* try next */ }
              }
            }
            await page.keyboard.press("Escape").catch(() => {});
            await page.waitForTimeout(300);
            continue;
          }
          await page.waitForTimeout(500);
        }
        reachedTarget = exchanges.some((e) => e.typeOrder === surface.typeOrder && (e.fetchNumber ?? 0) >= surface.fetchNumber);
        if (!reachedTarget) { log(`  ${surface.key}: CLICK_BUDGET_EXHAUSTED_WITHOUT_REACHING_TARGET — skipping surface`); continue; }
        await page.waitForTimeout(POST_ACTION_SETTLE_MS);
      } else if (surface.kind === "select_sort") {
        // The sort-menu UI is flaky under repeated automation (a locator
        // that reports visible=true can lose visibility by click time, a
        // real race observed live) — retry with a FRESH toggle+option
        // re-query each attempt rather than reusing stale locator state.
        let selected = false;
        for (let attempt = 1; attempt <= 3 && !selected; attempt++) {
          try {
            const sortWords = await page.locator("text=מיון").all();
            let toggle: any = null;
            for (const el of sortWords) { if (await el.isVisible().catch(() => false)) { toggle = el; break; } }
            if (!toggle) { log(`  NO_SORT_TOGGLE for ${surface.key} (attempt ${attempt})`); await page.waitForTimeout(500); continue; }
            await toggle.click({ timeout: 5000 });
            await page.waitForTimeout(1000);
            const option = page.locator("*", { hasText: surface.uiLabel! }).last();
            if (!(await option.isVisible().catch(() => false))) { log(`  OPTION_NOT_VISIBLE: ${surface.uiLabel} (attempt ${attempt})`); await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(500); continue; }
            await withTimeout(option.click({ timeout: 5000 }), 8000, `select-${surface.key}`);
            selected = true;
          } catch (e) {
            log(`  select_sort attempt ${attempt} failed for ${surface.key}: ${(e as Error).message}`);
            await page.keyboard.press("Escape").catch(() => {});
            await page.waitForTimeout(500);
          }
        }
        if (!selected) { log(`  ${surface.key}: SELECT_SORT_EXHAUSTED_RETRIES — skipping surface`); continue; }
        await page.waitForTimeout(POST_ACTION_SETTLE_MS);
      }

      const newExchange = exchanges.slice(exCountBefore).find((e) => e.typeOrder === surface.typeOrder && (e.fetchNumber ?? 0) === surface.fetchNumber)
        ?? exchanges.find((e) => e.typeOrder === surface.typeOrder && (e.fetchNumber ?? 0) === surface.fetchNumber); // desc_next/sort_next: target exchange may have arrived before exCountBefore's snapshot within the click loop
      if (!newExchange) {
        // No matching exchange captured — surface produced nothing usable
        // this attempt. Check for a misclick onto a DIFFERENT known surface.
        const wrongSurface = exchanges.slice(exCountBefore).find((e) => e.typeOrder && ALL_TYPE_ORDERS.includes(e.typeOrder) && e.typeOrder !== surface.typeOrder);
        if (wrongSurface) log(`  WRONG_SURFACE_OBSERVED for ${surface.key}: got ${wrongSurface.typeOrder}`);
        continue;
      }
      surfacesUsed.push(surface.key);
      updateContractFromLatest();
      recomputeUnion();

      if (officialTotalRows != null && currentUniqueCount > officialTotalRows) {
        entityFailed = true;
        failureReason = `UNIQUE_EXCEEDS_OFFICIAL_TOTAL: ${currentUniqueCount} > ${officialTotalRows} after ${surface.key}`;
        break;
      }
      } catch (e) {
        // A single surface's UI flakiness (stale locator, transient
        // timeout) must not fail the whole entity — log and move to the
        // next surface. Only identity/depth/collision checks (handled
        // above, inside captureHandler, or in the ambiguity check below)
        // are allowed to set entityFailed=true.
        log(`  SURFACE_ERROR on ${surface.key}: ${(e as Error).message} — skipping surface, entity continues`);
      }
    }
  } catch (e) {
    entityFailed = true;
    failureReason = `RUNNER_ERROR: ${(e as Error).message}`;
  } finally {
    page.off("response", captureHandler);
  }

  // --- Ambiguous-collision check (Phase 5) ---
  const allRawItems = exchanges.flatMap((e) => e.items);
  const allShadowRows = allRawItems.map((r) => toShadowDeal(r, neighborhood, sourceId)).filter((d): d is ShadowDeal => d !== null);
  const ambiguity = entityFailed ? { ambiguousCount: 0, examples: [] } : detectAmbiguousCollisions(allShadowRows);
  if (ambiguity.ambiguousCount > 0 && !entityFailed) {
    entityFailed = true;
    failureReason = `AMBIGUOUS_TRANSACTION_COLLISION: ${ambiguity.ambiguousCount} collision group(s) disagree on non-key fields`;
  }

  // --- "-0" parcelNum tracking (Phase 6) ---
  const minusZeroRows = currentUnion.filter((r) => (r as any).parcelNum && String((r as any).parcelNum).endsWith("-0"));
  let minusZeroCollisions = 0;
  {
    const seen = new Map<string, number>();
    for (const r of minusZeroRows) {
      const base = String((r as any).parcelNum).replace(/-0$/, "");
      seen.set(base, (seen.get(base) ?? 0) + 1);
    }
    minusZeroCollisions = [...seen.values()].filter((c) => c > 1).length;
  }

  // --- prevDeals (Phase 7) ---
  let rawPrevDealEvents = 0;
  let prevDealDrops = 0;
  const allPrevDeals: RawPrevDealEvent[] = [];
  for (const raw of allRawItems) {
    const { events, drops } = extractPrevDealEvents(raw, sourceId);
    rawPrevDealEvents += events.length;
    prevDealDrops += drops;
    allPrevDeals.push(...events);
  }
  const prevDealSeen = new Map<string, RawPrevDealEvent>();
  for (const ev of allPrevDeals) { const k = prevDealKey(ev); if (!prevDealSeen.has(k)) prevDealSeen.set(k, ev); }
  const uniquePrevDeals = [...prevDealSeen.values()];

  // --- Normalization safety (Phase 8) ---
  const rawTopLevelRows = allRawItems.length;
  const normalizedTopLevelRows = allShadowRows.length;
  const normalizationDrops = rawTopLevelRows - normalizedTopLevelRows;

  // --- Address quality (Phase 10) ---
  const validAddressRows = currentUnion.filter((r) => r.street && r.street !== "0" && r.houseNumber).length;
  const streetZeroRows = currentUnion.filter((r) => r.street === "0").length;
  const missingHouseRows = currentUnion.filter((r) => !r.houseNumber).length;

  // --- Property semantics (Phase 11) ---
  const dealNatureCounts: Record<string, number> = {};
  for (const r of currentUnion) {
    const dn = (r as any).rawDealNature ?? "∅NONE∅";
    dealNatureCounts[dn] = (dealNatureCounts[dn] ?? 0) + 1;
  }

  const dates = currentUnion.map((r) => r.dealDate).filter(Boolean).sort();

  let status: EntityStatus;
  if (entityFailed) status = "FAILED";
  else if (officialTotalRows != null && currentUniqueCount === officialTotalRows) status = "COMPLETE";
  else status = "PARTIAL";

  const result: EntityResult = {
    sourceId, name: entity.name, runContractVersion: RUN_CONTRACT_VERSION,
    status, failureReason,
    officialTotalRows, officialTotalFetch,
    surfacesUsed, rawTopLevelRows, normalizedTopLevelRows, normalizationDrops,
    uniqueTopLevel: currentUniqueCount,
    delta: officialTotalRows != null ? officialTotalRows - currentUniqueCount : null,
    earliestDate: dates[0] ?? null, latestDate: dates[dates.length - 1] ?? null,
    minusZeroRows: minusZeroRows.length, minusZeroCollisions,
    ambiguousCollisions: ambiguity.ambiguousCount,
    rawPrevDealEvents, uniquePrevDealEvents: uniquePrevDeals.length, prevDealNormalizationDrops: prevDealDrops,
    validAddressRows, streetZeroRows, missingHouseRows,
    dealNatureCounts,
    networkRequests, elapsedSeconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
    finishedAt: new Date().toISOString(),
    uniqueRows: currentUnion, uniquePrevDeals: uniquePrevDeals,
  };
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  let limit = Infinity;
  if (limitIdx >= 0) {
    const parsed = parseInt(args[limitIdx + 1], 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`INVALID_ARG: --limit requires a positive integer, got ${JSON.stringify(args[limitIdx + 1])}`);
    }
    limit = parsed;
  }
  const onlyIdx = args.indexOf("--only");
  let only: Set<string> | null = null;
  if (onlyIdx >= 0) {
    const raw = args[onlyIdx + 1];
    if (!raw || raw.startsWith("--")) {
      throw new Error("INVALID_ARG: --only requires a comma-separated list of sourceIds");
    }
    only = new Set(raw.split(","));
  }

  await fs.mkdir(SHADOW_DIR, { recursive: true });
  log(`=== WAVE 0G-16 CITYWIDE SHADOW COVERAGE AUDIT (contract=${RUN_CONTRACT_VERSION}) ===`);

  const entities = await getOfficialNetanyaEntities();
  log(`CATALOG_ENTITY_COUNT=${entities.length}`);
  if (entities.length === 0) throw new Error("EMPTY_CATALOG: refusing to run — fail closed per Phase 2");

  const manifest = await readManifest();
  const targetEntities = (only ? entities.filter((e) => only.has(e.sourceId)) : entities).slice(0, limit);
  if (only && targetEntities.length === 0) {
    throw new Error(`INVALID_ARG: --only sourceId(s) [${[...only].join(",")}] matched none of the ${entities.length} catalog entities`);
  }
  log(`TARGET_ENTITY_COUNT=${targetEntities.length}`);

  const headless = process.env.HARVEST_HEADLESS === "true";
  const { chromium: pwChromium } = await import("playwright");
  const ctx = await pwChromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless, slowMo: headless ? 0 : 50,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  let page: any;
  try {
    page = await ctx.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    let idx = 0;
    for (const entity of targetEntities) {
      idx++;
      const existing = await loadExistingResult(entity.sourceId);
      if (existing) {
        log(`[${idx}/${targetEntities.length}] ${entity.sourceId} ${entity.name} — RESUMED (${existing.status}, cached)`);
        manifest[entity.sourceId] = { status: existing.status, runContractVersion: RUN_CONTRACT_VERSION };
        continue;
      }

      log(`[${idx}/${targetEntities.length}] ${entity.sourceId} ${entity.name} — starting live acquisition`);
      let result: EntityResult;
      try {
        result = await processEntity(page, entity);
      } catch (e) {
        result = {
          sourceId: entity.sourceId, name: entity.name, runContractVersion: RUN_CONTRACT_VERSION,
          status: "FAILED", failureReason: `UNCAUGHT_ERROR: ${(e as Error).message}`,
          officialTotalRows: null, officialTotalFetch: null, surfacesUsed: [],
          rawTopLevelRows: 0, normalizedTopLevelRows: 0, normalizationDrops: 0, uniqueTopLevel: 0, delta: null,
          earliestDate: null, latestDate: null, minusZeroRows: 0, minusZeroCollisions: 0, ambiguousCollisions: 0,
          rawPrevDealEvents: 0, uniquePrevDealEvents: 0, prevDealNormalizationDrops: 0,
          validAddressRows: 0, streetZeroRows: 0, missingHouseRows: 0, dealNatureCounts: {},
          networkRequests: 0, elapsedSeconds: 0, finishedAt: new Date().toISOString(),
          uniqueRows: [], uniquePrevDeals: [],
        };
      }
      // Entity-level I/O (ECC planner + code-reviewer finding): a transient
      // disk/fs error here must not abort the remaining 37 entities. Caught
      // and logged; the entity's in-memory result is still reported below
      // even if persistence failed, so the run continues either way.
      try {
        await saveResult(result);
        manifest[entity.sourceId] = { status: result.status, runContractVersion: RUN_CONTRACT_VERSION };
        await writeManifest(manifest);
      } catch (e) {
        log(`  [WARNING] failed to persist result/manifest for ${entity.sourceId}: ${(e as Error).message} — continuing run`);
      }
      log(`[${idx}/${targetEntities.length}] ${entity.sourceId} ${entity.name} — ${result.status} unique=${result.uniqueTopLevel} official=${result.officialTotalRows} delta=${result.delta} reqs=${result.networkRequests} elapsed=${result.elapsedSeconds}s`);

      await page.waitForTimeout(INTER_ENTITY_DELAY_MS);
    }
  } finally {
    await ctx.close();
  }

  log("=== CITYWIDE RUN COMPLETE ===");
}

// Guard against running main() as a side effect of being imported (this
// file exports pure helpers for the Wave 0G-16 test suite) — only execute
// the live citywide run when invoked directly via `npx tsx <this file>`.
// Uses pathToFileURL (not manual string concatenation) for correct
// cross-platform file:// URL formation — a Windows path needs a THIRD
// leading slash before the drive letter (file:///C:/...) that naive
// concatenation drops, which silently broke this guard on first attempt.
const isDirectExecution = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  main().catch((e) => { console.error("CITYWIDE_RUNNER_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
}
