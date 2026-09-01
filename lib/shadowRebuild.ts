/**
 * lib/shadowRebuild.ts — reusable, testable core for the Wave 0G-12
 * Shadow Rebuild V2 pilot (audit/wave0g12/).
 *
 * Deliberately reuses the already-proven production acquisition components
 * rather than reimplementing them:
 *   - discovery/identity: lib/nadlanCatalog.ts (getOfficialNetanyaEntities)
 *   - direct-ID acquisition + fail-closed identity check:
 *     lib/nadlanAcquisition.ts (buildDirectNeighborhoodUrl,
 *     assertDirectIdAcquisitionIdentity)
 *   - response decoding + row normalization: lib/dealNormalization.ts
 *     (decodeDealData, normalizeDeal)
 *
 * This module adds only what those don't already provide: a ShadowDeal
 * shape carrying the raw parcelNum + official sourceId (kept OUT of the
 * shared Deal type so this pilot cannot leak fields into the production
 * schema), a runtime pagination-contract reader, a transaction-safe dedup
 * function, and an output-path guard that refuses to ever target canonical
 * data or Supabase.
 *
 * Transaction identity (Wave 0G-10, re-confirmed not re-derived here):
 *   - parcelNum alone is PROPERTY/UNIT identity, not transaction identity —
 *     the official API nests a property's OLDER sales under the CURRENT
 *     row's `prevDeals`, so parcelNum never repeats among TOP-LEVEL rows
 *     within one fetch window, but WOULD collide if used alone across a
 *     flattened (top-level + prevDeals) transaction set.
 *   - best-evidenced key: parcelNum + dealDate + dealAmount — zero
 *     collisions observed across ~1,362 tested transactions in 2
 *     neighborhoods, NOT proven citywide. This module treats it as
 *     best-evidenced-not-yet-falsified, never as a guaranteed-unique
 *     official transaction id (no such field exists in the schema).
 */
import type { Deal, Neighborhood } from "./types";
import { normalizeDeal, buildTransactionIdSuffix } from "./dealNormalization";

/** A Deal plus the two shadow-only fields needed for transaction-safe
 * dedup and official-identity traceability. NOT part of the production
 * Deal type — this shape never reaches data/deals.json or Supabase. */
export interface ShadowDeal extends Deal {
  /** The official nadlan.gov.il sourceId this row was acquired under —
   * distinct from `neighborhoodId`, which stays in the legacy GovMap-ish
   * domain for backward compatibility with existing Deal consumers. */
  sourceId: string;
  /** Raw parcelNum (gush-helka-subparcel) exactly as returned — property
   * identity, not transaction identity (see module docstring). */
  parcelNum: string | null;
  /** Raw dealNature exactly as returned, preserved separately from the
   * derived `propertyType` on the base Deal (Phase 12: both must coexist). */
  rawDealNature: string | null;
}

/** Converts one raw /deal-data item into a ShadowDeal, or null if the row
 * fails the shared normalizeDeal() validation (e.g. missing/invalid price).
 * Never invents a parcelNum or sourceId — both are read directly from the
 * raw item / caller-supplied context. */
export function toShadowDeal(
  raw: any,
  neighborhood: Neighborhood,
  sourceId: string,
  streetCoords: Record<string, { x: number; y: number }> = {},
): ShadowDeal | null {
  const base = normalizeDeal(raw, neighborhood, streetCoords);
  if (!base) return null;
  return {
    ...base,
    sourceId,
    parcelNum: raw.parcelNum != null ? String(raw.parcelNum) : null,
    rawDealNature: raw.dealNature != null ? String(raw.dealNature) : null,
  };
}

export interface PaginationContract {
  sourceId: string;
  totalRows: number | null;
  totalFetch: number | null;
  totalPage: number | null;
}

/**
 * Reads the runtime pagination contract from an already-decoded
 * /deal-data RESPONSE — never invents a value, never hardcodes 500 or any
 * fetch count. Missing fields map to null, not a guessed default.
 *
 * Deliberately does NOT read `fetch_number` — every captured nadlan
 * response's `data` object has exactly the keys `total_rows`/`total_fetch`/
 * `total_page`/`items` (confirmed across every Wave 0G-9/0G-10/0G-12
 * capture); `fetch_number` is a REQUEST-side field the response never
 * echoes back. Callers that need it must decode the originating request
 * with lib/nadlanAcquisition.ts's `decodeRequestEnvelope()`.
 */
export function parsePaginationContract(decoded: any, sourceId: string): PaginationContract {
  const data = decoded?.data ?? decoded ?? {};
  const toIntOrNull = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    sourceId,
    totalRows: toIntOrNull(data.total_rows),
    totalFetch: toIntOrNull(data.total_fetch),
    totalPage: toIntOrNull(data.total_page),
  };
}

/** The single, shared transaction key: parcelNum + dealDate + dealAmount —
 * the best-evidenced candidate from Wave 0G-10 (zero collisions observed,
 * not proven citywide). A row with a null parcelNum still gets a stable,
 * distinguishable key (never silently merged with a real parcelNum's key).
 *
 * ECC database-reviewer finding (Wave 0G-12): a row with BOTH a null
 * parcelNum AND an empty dealDate (normalizeDeal maps a missing date to
 * `""`, not null) could theoretically collide with another such row at the
 * same price. Not observed in any of this wave's 3 pilot entities (zero
 * null-parcelNum or empty-dealDate rows across 2,384 total shadow rows —
 * see dedupByTransactionKey's diagnostic counts), but the key now includes
 * an explicit `hasDate` flag so an empty-string date can never silently
 * behave the same as a present one.
 *
 * Wave 0G-L1D: delegates to dealNormalization.ts's buildTransactionIdSuffix
 * (byte-identical formula, including the same NULL_PARCEL_SENTINEL) so this
 * codebase has exactly one implementation of this key, not two copies that
 * could drift — the same fix now also backs the base `Deal.id` fallback. */
export function transactionKey(row: ShadowDeal): string {
  return buildTransactionIdSuffix(row.parcelNum, row.dealDate, row.price);
}

export interface DedupResult {
  rawCount: number;
  uniqueCount: number;
  collisions: number;
  uniqueRows: ShadowDeal[];
  /** Diagnostic only — surfaces the edge case above so it's visible rather
   * than silently possible. A non-zero count here doesn't mean rows were
   * actually lost (transactionKey still distinguishes what it can), it
   * flags that this entity's data has rows too sparse to fully identify. */
  nullParcelNumCount: number;
  emptyDealDateCount: number;
}

/** Collapses exact-duplicate rows (same transaction re-seen through
 * overlapping fetch/sort windows) while preserving every DISTINCT
 * transaction — including legitimate repeat sales of the same property,
 * which differ in dealDate/price and therefore get a different key. */
export function dedupByTransactionKey(rows: ShadowDeal[]): DedupResult {
  const seen = new Map<string, ShadowDeal>();
  let nullParcelNumCount = 0;
  let emptyDealDateCount = 0;
  for (const row of rows) {
    if (!row.parcelNum) nullParcelNumCount++;
    if (!row.dealDate) emptyDealDateCount++;
    const key = transactionKey(row);
    if (!seen.has(key)) seen.set(key, row);
  }
  const uniqueRows = [...seen.values()];
  return {
    rawCount: rows.length,
    uniqueCount: uniqueRows.length,
    collisions: rows.length - uniqueRows.length,
    uniqueRows,
    nullParcelNumCount,
    emptyDealDateCount,
  };
}

/**
 * Guards every shadow-output write. Throws (never silently no-ops) if the
 * resolved path would touch canonical data or any Supabase-shaped target.
 * This is the ONLY function shadow scripts are meant to write through —
 * see lib/__tests__/shadowRebuild.test.ts TEST E/F.
 *
 * Resolves the path against cwd FIRST (ECC silent-failure-hunter finding,
 * Wave 0G-12): the original version matched substrings on the raw string,
 * which a `../` traversal segment could pass while still resolving outside
 * any allowed directory (e.g. a label containing "../../data/deals" would
 * contain the literal text "audit/" from a fixed prefix yet resolve
 * elsewhere). Checking the RESOLVED path closes that gap.
 */
export function assertSafeShadowOutputPath(outPath: string): void {
  if (!outPath || typeof outPath !== "string") {
    throw new Error("UNSAFE_OUTPUT_PATH: output path must be a non-empty string");
  }
  const path = require("path") as typeof import("path");
  const resolved = path.resolve(process.cwd(), outPath).replace(/\\/g, "/").toLowerCase();
  const cwd = process.cwd().replace(/\\/g, "/").toLowerCase();

  if (resolved === `${cwd}/data/deals.json`) {
    throw new Error("UNSAFE_OUTPUT_PATH: refusing to target canonical data/deals.json");
  }
  if (resolved === `${cwd}/data/neighborhoods.json`) {
    throw new Error("UNSAFE_OUTPUT_PATH: refusing to target canonical data/neighborhoods.json");
  }
  if (/supabase/.test(resolved)) {
    throw new Error("UNSAFE_OUTPUT_PATH: refusing a Supabase-shaped output target");
  }
  const isUnderAudit = resolved.startsWith(`${cwd}/audit/`);
  const isUnderTmp = resolved.startsWith(`${cwd}/tmp/`) || resolved.includes("/tmp/") || resolved.includes("scratchpad");
  if (!isUnderAudit && !isUnderTmp) {
    throw new Error(
      "UNSAFE_OUTPUT_PATH: shadow output must resolve under audit/ (or an explicit tmp/scratch path), got resolved path: " + resolved,
    );
  }
}
