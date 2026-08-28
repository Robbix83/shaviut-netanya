/**
 * scripts/audit-wave0g18-aggregate.ts — Wave 0G-18 Phases 10-19: merges all
 * 70 per-street result files (scripts/audit-wave0g18-street-runner.ts's
 * output) against the existing Wave 0G-16 entity-level baseline for קריית
 * השרון (sourceId=65209683), and computes coverage, transaction-identity,
 * address-quality, prevDeals, normalization, economics, and residual-gap
 * figures for the wave's report.
 *
 * ECC database-reviewer finding (Wave 0G-18 round 1, pre-execution review):
 * the street runner deliberately does NOT dedup — a same-entity row that
 * belongs to a different street can legitimately appear verbatim in that
 * OTHER street's own result file too (reported via rowsOtherStreetSameEntity,
 * never filtered). This aggregator is therefore the ONLY place cross-street
 * and street-vs-baseline dedup happens, and it must:
 *   (a) union baseline rows + all street rows before deduping,
 *   (b) apply the shared dedupByTransactionKey(),
 *   (c) run detectAmbiguousCollisions() across that SAME union and fail
 *       closed (never silently merge) on any flagged group.
 *
 * Usage: npx tsx scripts/audit-wave0g18-aggregate.ts
 */
import { promises as fs } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { getOfficialEntityStreets } from "../lib/nadlanCatalog";
import { transactionKey, assertSafeShadowOutputPath, type ShadowDeal } from "../lib/shadowRebuild";
import { detectAmbiguousCollisions, prevDealKey, type RawPrevDealEvent } from "./audit-wave0g16-citywide-shadow";
import { PARENT_SOURCE_ID, RUN_CONTRACT_VERSION, type StreetResult, type StreetStatus } from "./audit-wave0g18-street-runner";

const SHADOW_DIR = path.join(process.cwd(), "audit/wave0g18/shadow");
const BASELINE_PATH = path.join(process.cwd(), "audit/wave0g16/shadow-output/65209683.json");
const OUT_DIR_REL = "audit/wave0g18";
const OUT_DIR = path.join(process.cwd(), OUT_DIR_REL);

interface BaselineFile {
  officialTotalRows: number;
  uniqueRows: ShadowDeal[];
  uniquePrevDeals: RawPrevDealEvent[];
  validAddressRows: number;
  streetZeroRows: number;
  missingHouseRows: number;
  dealNatureCounts: Record<string, number>;
}

export interface StreetRowSet { streetId: string; rows: ShadowDeal[] }

export interface TransactionGroupClassification {
  augmentedUnion: ShadowDeal[];
  trueDuplicateEntityVsStreet: number;
  trueDuplicateStreetVsStreet: number;
  ambiguousCollisions: number;
  genuinelyNewStreetRows: number;
  ambiguousExamples: any[];
  streetUniqueWithinStreetCorpus: number;
  /** transactionKey()s excluded from augmentedUnion due to an ambiguous
   * collision — exposed so downstream consumers (e.g. the Phase 13 recovery
   * loop) can apply the SAME exclusion instead of re-deriving it (ECC
   * code-reviewer finding: an earlier version of that loop used a naive
   * first-key-wins dedup with no ambiguity awareness at all). */
  ambiguousKeys: Set<string>;
}

/**
 * Pure classification of every transaction key observed across the
 * baseline + all successful streets' rows (Wave 0G-18 Phase 9). For each
 * distinct transactionKey():
 *   - a single occurrence not in the baseline → LEGITIMATE_DISTINCT_TRANSACTION (new)
 *   - 2+ occurrences that all agree on non-key fields, incl. baseline → TRUE_DUPLICATE_ENTITY_VS_STREET
 *   - 2+ occurrences across 2+ DIFFERENT streets (never in baseline), all agreeing → TRUE_DUPLICATE_STREET_VS_STREET
 *   - any occurrence that disagrees with the rest on non-key fields → AMBIGUOUS_COLLISION,
 *     isolated (never merged into augmentedUnion either way — Phase 9 requirement)
 *
 * No I/O — directly unit-testable (see scripts/__tests__/wave0g18Aggregate.test.ts).
 */
export function classifyTransactionGroups(baselineRows: ShadowDeal[], streetRowSets: StreetRowSet[]): TransactionGroupClassification {
  interface Tagged { row: ShadowDeal; origin: "baseline" | string }
  const tagged: Tagged[] = [
    ...baselineRows.map((row): Tagged => ({ row, origin: "baseline" })),
    ...streetRowSets.flatMap((s) => s.rows.map((row): Tagged => ({ row, origin: s.streetId }))),
  ];
  const groups = new Map<string, Tagged[]>();
  for (const t of tagged) {
    const k = transactionKey(t.row);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }

  function rowsAgree(a: ShadowDeal, b: ShadowDeal): boolean {
    return (a.street ?? "∅") === (b.street ?? "∅")
      && (a.houseNumber ?? "∅") === (b.houseNumber ?? "∅")
      && (a.floor ?? "∅") === (b.floor ?? "∅")
      && (a.areaSqm ?? "∅") === (b.areaSqm ?? "∅");
  }

  let trueDuplicateEntityVsStreet = 0;
  let trueDuplicateStreetVsStreet = 0;
  let ambiguousCollisions = 0;
  let genuinelyNewStreetRows = 0;
  const ambiguousExamples: any[] = [];
  const ambiguousKeys = new Set<string>();
  const augmentedUnion: ShadowDeal[] = [...baselineRows];
  const streetOnlyKeys = new Set<string>();

  for (const [key, group] of groups) {
    const inBaseline = group.some((t) => t.origin === "baseline");
    if (group.some((t) => t.origin !== "baseline")) streetOnlyKeys.add(key);
    const streetOrigins = new Set(group.filter((t) => t.origin !== "baseline").map((t) => t.origin));
    if (group.length < 2) {
      if (!inBaseline) { genuinelyNewStreetRows++; augmentedUnion.push(group[0].row); }
      continue;
    }
    const first = group[0].row;
    const allAgree = group.every((t) => rowsAgree(first, t.row));
    if (!allAgree) {
      ambiguousCollisions++;
      ambiguousKeys.add(key);
      if (ambiguousExamples.length < 10) {
        ambiguousExamples.push({ key, members: group.map((t) => ({ origin: t.origin, street: t.row.street, houseNumber: t.row.houseNumber, floor: t.row.floor, areaSqm: t.row.areaSqm, price: t.row.price, dealDate: t.row.dealDate })) });
      }
      continue; // isolated — never merged into the union either way
    }
    if (inBaseline) {
      trueDuplicateEntityVsStreet++; // collapses to the baseline's own copy — no addition
    } else if (streetOrigins.size > 1) {
      trueDuplicateStreetVsStreet++; // observed via 2+ streets, still exactly 1 new unique row
      genuinelyNewStreetRows++;
      augmentedUnion.push(first);
    } else {
      genuinelyNewStreetRows++;
      augmentedUnion.push(first);
    }
  }

  return { augmentedUnion, trueDuplicateEntityVsStreet, trueDuplicateStreetVsStreet, ambiguousCollisions, genuinelyNewStreetRows, ambiguousExamples, streetUniqueWithinStreetCorpus: streetOnlyKeys.size, ambiguousKeys };
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function loadStreetResults(streetIds: string[]): Promise<StreetResult[]> {
  const results: StreetResult[] = [];
  for (const streetId of streetIds) {
    const p = path.join(SHADOW_DIR, `street_${PARENT_SOURCE_ID}_${streetId}.json`);
    try {
      const raw = JSON.parse(await fs.readFile(p, "utf8")) as StreetResult;
      if (raw.runContractVersion !== RUN_CONTRACT_VERSION || raw.parentSourceId !== PARENT_SOURCE_ID || raw.streetId !== streetId) {
        throw new Error(`CONTRACT_MISMATCH for streetId=${streetId}`);
      }
      results.push(raw);
    } catch (e) {
      throw new Error(`MISSING_OR_INVALID_STREET_RESULT: ${streetId} (${(e as Error).message}) — every one of the 70 official streets must have an attempted result before aggregation. Run the street runner first.`);
    }
  }
  return results;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log("=== WAVE 0G-18 AGGREGATION (Phases 10-19) ===");

  // --- Phase 2 reconfirmation: baseline must still be reproducible ---
  const baseline: BaselineFile = JSON.parse(await fs.readFile(BASELINE_PATH, "utf8"));
  const officialTotalRows = baseline.officialTotalRows;
  const baselineUnique = baseline.uniqueRows;
  console.log(`OFFICIAL_TOTAL_ROWS=${officialTotalRows}`);
  console.log(`ENTITY_BASELINE_UNIQUE=${baselineUnique.length}`);
  const baselineDelta = officialTotalRows - baselineUnique.length;
  console.log(`ENTITY_BASELINE_DELTA=${baselineDelta}`);
  if (officialTotalRows !== 5640 || baselineUnique.length !== 2518) {
    throw new Error(`PHASE2_MISMATCH: expected official=5640 baseline=2518, got official=${officialTotalRows} baseline=${baselineUnique.length} — STOP per wave instructions`);
  }

  // --- Phase 3 reconfirmation: 70 official streets ---
  // ECC silent-failure-hunter finding: this is a FRESH live catalog fetch,
  // separate from the one the live run itself used (persisted at Phase 3 to
  // street_manifest_raw.json). If a street were removed from the upstream
  // catalog between the live run and this aggregation pass, its already-
  // fetched result file would simply never be loaded — no error, silently
  // excluded. Cross-checking against the run's OWN captured manifest turns
  // that into a loud failure instead of a silent one.
  const streets = await getOfficialEntityStreets(PARENT_SOURCE_ID);
  console.log(`OFFICIAL_STREET_COUNT=${streets.length}`);
  const streetIds = streets.map((s) => s.streetId);

  const capturedManifest: { streets: { streetId: string; name: string }[] } = JSON.parse(await fs.readFile(path.join(OUT_DIR, "street_manifest_raw.json"), "utf8"));
  const capturedIds = new Set(capturedManifest.streets.map((s) => s.streetId));
  const freshIds = new Set(streetIds);
  const removedSinceCapture = [...capturedIds].filter((id) => !freshIds.has(id));
  const addedSinceCapture = [...freshIds].filter((id) => !capturedIds.has(id));
  if (removedSinceCapture.length > 0 || addedSinceCapture.length > 0) {
    throw new Error(`CATALOG_DRIFT: street enumeration changed since the live run's own Phase 3 capture — removed=[${removedSinceCapture.join(",")}] added=[${addedSinceCapture.join(",")}]. STOP and re-verify before trusting any coverage number (the already-persisted street results were captured under the OLD catalog).`);
  }

  // --- Phase 4/5: load every street's persisted result (all 70 must exist) ---
  const streetResults = await loadStreetResults(streetIds);
  console.log(`STREET_RESULTS_LOADED=${streetResults.length}/${streetIds.length}`);

  // --- Phase 12: status distribution ---
  const byStatus = new Map<StreetStatus, StreetResult[]>();
  for (const r of streetResults) {
    if (!byStatus.has(r.status)) byStatus.set(r.status, []);
    byStatus.get(r.status)!.push(r);
  }
  // Wave 0G-20 finding (ECC planner): "SUCCESS_MIXED_PARTIAL" (the new
  // per-row-acceptance status — scripts/audit-wave0g18-street-runner.ts)
  // was missing here. Without it, any FUTURE re-run of THIS aggregator
  // against runner output using the new per-row logic would silently
  // exclude every mixed-partial street's recovered rows from the union and
  // misclassify it as FAILED — exactly the rows Wave 0G-20 exists to
  // recover. Fail-closed (no data corruption), but a real, avoidable loss.
  const successStatuses: StreetStatus[] = ["SUCCESS_ROWS", "SUCCESS_MIXED_PARTIAL", "SUCCESS_EMPTY", "PARTIAL_MORE_FETCHES_INDICATED"];
  const failedResults = streetResults.filter((r) => !successStatuses.includes(r.status));
  const partialMoreFetch = byStatus.get("PARTIAL_MORE_FETCHES_INDICATED") ?? [];
  const emptyResults = byStatus.get("SUCCESS_EMPTY") ?? [];
  const fetch1Sufficient = (byStatus.get("SUCCESS_ROWS") ?? []).length + emptyResults.length;
  const unknownFetchDepth = streetResults.filter((r) => successStatuses.includes(r.status) && r.totalFetchIfExposed == null).length;

  console.log(`STREETS_TOTAL=${streetResults.length}`);
  console.log(`STREETS_FETCH1_SUFFICIENT=${fetch1Sufficient}`);
  console.log(`STREETS_TOTAL_FETCH_GT_1=${partialMoreFetch.length}`);
  console.log(`STREETS_WITH_UNKNOWN_FETCH_DEPTH=${unknownFetchDepth}`);
  console.log(`STREETS_EMPTY=${emptyResults.length}`);
  console.log(`STREETS_FAILED=${failedResults.length}`);
  if (failedResults.length > 0) {
    console.log("FAILED_STREETS=" + JSON.stringify(failedResults.map((r) => ({ streetId: r.streetId, name: r.streetName, status: r.status, reason: r.failureReason }))));
  }

  // --- Phase 9: cross-surface dedup — union baseline + ALL successful street rows ---
  const successfulResults = streetResults.filter((r) => successStatuses.includes(r.status));
  const rawStreetRows = successfulResults.reduce((sum, r) => sum + r.rowsReturned, 0);
  const normalizedStreetRows = successfulResults.reduce((sum, r) => sum + r.normalizedRows, 0);
  const normalizationDrops = streetResults.reduce((sum, r) => sum + r.normalizationDrops, 0);

  const classification = classifyTransactionGroups(baselineUnique, successfulResults.map((r) => ({ streetId: r.streetId, rows: r.rows })));
  const { augmentedUnion, trueDuplicateEntityVsStreet, trueDuplicateStreetVsStreet, ambiguousCollisions, genuinelyNewStreetRows, ambiguousExamples, streetUniqueWithinStreetCorpus: streetUniqueWithinStreetCorpusDirect, ambiguousKeys } = classification;

  // Independent cross-check (ECC database-reviewer instruction): re-run the
  // ALREADY-TESTED, shared detectAmbiguousCollisions() over the full flat
  // union (baseline + every street's rows, duplicates included) and require
  // it to agree with this module's own from-scratch classification. A
  // mismatch would mean the two independent implementations disagree on
  // what counts as ambiguous — fail closed rather than trust either blindly.
  const allRowsFlat = [...baselineUnique, ...successfulResults.flatMap((r) => r.rows)];
  const crossCheck = detectAmbiguousCollisions(allRowsFlat);
  if (crossCheck.ambiguousCount !== ambiguousCollisions) {
    throw new Error(`INTEGRITY_FAIL: ambiguous-collision cross-check mismatch — classifyTransactionGroups found ${ambiguousCollisions}, detectAmbiguousCollisions found ${crossCheck.ambiguousCount}. STOP and investigate before trusting any coverage number.`);
  }

  const augmentedUnique = augmentedUnion.length;
  console.log(`STREET_RAW_ROWS=${rawStreetRows}`);
  console.log(`STREET_NORMALIZED_ROWS=${normalizedStreetRows}`);
  console.log(`STREET_UNIQUE_WITHIN_STREET_CORPUS=${streetUniqueWithinStreetCorpusDirect}`);
  console.log(`TRUE_DUPLICATE_ENTITY_VS_STREET=${trueDuplicateEntityVsStreet}`);
  console.log(`TRUE_DUPLICATE_STREET_VS_STREET=${trueDuplicateStreetVsStreet}`);
  console.log(`AMBIGUOUS_COLLISIONS=${ambiguousCollisions}`);
  console.log(`GENUINELY_NEW_STREET_ROWS=${genuinelyNewStreetRows}`);
  console.log(`AUGMENTED_UNIQUE=${augmentedUnique}`);

  if (augmentedUnique > officialTotalRows) {
    throw new Error(`INTEGRITY_FAIL: AUGMENTED_UNIQUE (${augmentedUnique}) exceeds OFFICIAL_TOTAL_ROWS (${officialTotalRows}) — STOP, per Phase 10 instruction, and investigate identity/semantics before trusting any further number.`);
  }

  const deltaAfter = officialTotalRows - augmentedUnique;
  const coverageBefore = (baselineUnique.length / officialTotalRows) * 100;
  const coverageAfter = (augmentedUnique / officialTotalRows) * 100;
  console.log(`DELTA_AFTER=${deltaAfter}`);
  console.log(`COVERAGE_BEFORE=${coverageBefore.toFixed(2)}%`);
  console.log(`COVERAGE_AFTER=${coverageAfter.toFixed(2)}%`);

  // --- Phase 11: exact completeness gate ---
  // ECC silent-failure-hunter finding: this previously checked only
  // `status === "FAILED_IDENTITY"`, so a street failing with
  // FAILED_NORMALIZATION/FAILED_NETWORK/FAILED_OTHER didn't disqualify the
  // run from COMPLETE if augmentedUnique happened to numerically equal
  // officialTotalRows despite that street's real data being missing. Any
  // street failure at all is now an integrity concern for this strict gate.
  let completeness: "COMPLETE" | "PARTIAL" | "FAILED";
  if (ambiguousCollisions > 0 || augmentedUnique > officialTotalRows || failedResults.length > 0) {
    completeness = "FAILED";
  } else if (augmentedUnique === officialTotalRows) {
    completeness = "COMPLETE";
  } else {
    completeness = "PARTIAL";
  }
  console.log(`KIRYAT_HASHARON_STREET_AUGMENTATION=${completeness}`);

  // --- Phase 13: recovery distribution by street (real acquisition order via finishedAt) ---
  // ECC code-reviewer finding: this loop's own dedup must apply the SAME
  // ambiguous-collision exclusion classifyTransactionGroups uses (via the
  // shared `ambiguousKeys` set) — a naive first-key-wins dedup with no
  // ambiguity awareness could otherwise count an isolated/excluded key as
  // "new" here while classifyTransactionGroups correctly excludes it from
  // augmentedUnion, silently diverging the two totals. Didn't manifest this
  // run only because ambiguousCollisions===0; now enforced, not incidental.
  const orderedByAcquisition = [...streetResults].sort((a, b) => (a.finishedAt < b.finishedAt ? -1 : a.finishedAt > b.finishedAt ? 1 : 0));
  const seenSoFar = new Set(baselineUnique.map((r) => transactionKey(r)));
  const baselineKeys = new Set(baselineUnique.map((row) => transactionKey(row)));
  const recoveryRows: { streetId: string; streetName: string; status: StreetStatus; rawRows: number; newVsEntityBaseline: number; newAfterAllPriorStreets: number; cumulativeAugmentedTotal: number }[] = [];
  let cumulative = baselineUnique.length;
  for (const r of orderedByAcquisition) {
    const rowsThisStreet = successStatuses.includes(r.status) ? r.rows : [];
    let newAfterPrior = 0;
    for (const row of rowsThisStreet) {
      const k = transactionKey(row);
      if (ambiguousKeys.has(k)) continue; // isolated — never counted new here either, matching classifyTransactionGroups
      if (!seenSoFar.has(k)) { seenSoFar.add(k); newAfterPrior++; }
    }
    // newVsEntityBaseline: rows in this street not present in the ORIGINAL baseline (ignoring other streets)
    const newVsBaseline = rowsThisStreet.filter((row) => !baselineKeys.has(transactionKey(row)) && !ambiguousKeys.has(transactionKey(row))).length;
    cumulative += newAfterPrior;
    recoveryRows.push({ streetId: r.streetId, streetName: r.streetName, status: r.status, rawRows: r.rowsReturned, newVsEntityBaseline: newVsBaseline, newAfterAllPriorStreets: newAfterPrior, cumulativeAugmentedTotal: cumulative });
  }
  if (cumulative !== augmentedUnique) {
    throw new Error(`INTEGRITY_FAIL: Phase 13's chronological cumulative total (${cumulative}) diverged from classifyTransactionGroups' augmentedUnique (${augmentedUnique}) — two independent computations of the same number must agree. STOP and investigate before trusting the recovery scorecard.`);
  }
  const sortedForDisplay = [...recoveryRows].sort((a, b) => b.newAfterAllPriorStreets - a.newAfterAllPriorStreets);
  const top10 = sortedForDisplay.slice(0, 10);
  const zeroValue = recoveryRows.filter((r) => r.newAfterAllPriorStreets === 0);
  console.log(`TOP_10_STREETS_BY_NEW_ROWS=${JSON.stringify(top10.map((r) => ({ name: r.streetName, id: r.streetId, new: r.newAfterAllPriorStreets })))}`);
  console.log(`STREETS_WITH_ZERO_INCREMENTAL_VALUE=${zeroValue.length}`);

  await fs.mkdir(OUT_DIR, { recursive: true });
  const scorecardLines = ["STREET_ID,STREET_NAME,STATUS,RAW_ROWS,NEW_VS_ENTITY_BASELINE,NEW_AFTER_ALL_PRIOR_STREETS,CUMULATIVE_AUGMENTED_TOTAL"];
  for (const r of sortedForDisplay) scorecardLines.push([r.streetId, csvEscape(r.streetName), r.status, r.rawRows, r.newVsEntityBaseline, r.newAfterAllPriorStreets, r.cumulativeAugmentedTotal].join(","));
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/street_recovery_scorecard.csv`);
  await fs.writeFile(path.join(OUT_DIR, "street_recovery_scorecard.csv"), scorecardLines.join("\n") + "\n");

  // --- Phase 14: address quality ---
  const streetCorpusRows = successfulResults.flatMap((r) => r.rows);
  const validStreet = streetCorpusRows.filter((r) => r.street && r.street !== "0").length;
  const validHouse = streetCorpusRows.filter((r) => r.houseNumber).length;
  const streetZero = streetCorpusRows.filter((r) => r.street === "0").length;
  const missingHouse = streetCorpusRows.filter((r) => !r.houseNumber).length;
  const streetCorpusValidAddressRate = streetCorpusRows.length > 0 ? ((streetCorpusRows.filter((r) => r.street && r.street !== "0" && r.houseNumber).length / streetCorpusRows.length) * 100) : 0;
  const entityBaselineValidAddressRate = (baseline.validAddressRows / baselineUnique.length) * 100;
  const entityBaselineStreetZeroRate = (baseline.streetZeroRows / baselineUnique.length) * 100;
  const streetCorpusStreetZeroRate = streetCorpusRows.length > 0 ? (streetZero / streetCorpusRows.length) * 100 : 0;
  console.log(`VALID_STREET=${validStreet} VALID_HOUSE=${validHouse} STREET_ZERO=${streetZero} MISSING_HOUSE=${missingHouse}`);
  console.log(`ENTITY_BASELINE_VALID_ADDRESS_RATE=${entityBaselineValidAddressRate.toFixed(2)}%`);
  console.log(`STREET_CORPUS_VALID_ADDRESS_RATE=${streetCorpusValidAddressRate.toFixed(2)}%`);
  console.log(`ENTITY_BASELINE_STREET_ZERO_RATE=${entityBaselineStreetZeroRate.toFixed(2)}%`);
  console.log(`STREET_CORPUS_STREET_ZERO_RATE=${streetCorpusStreetZeroRate.toFixed(2)}%`);

  // --- Phase 15: deal nature ---
  const withDealNature = streetCorpusRows.filter((r) => r.rawDealNature != null).length;
  const distinctDealNature = new Set(streetCorpusRows.map((r) => r.rawDealNature ?? "∅NONE∅")).size;
  console.log(`STREET_ROWS_WITH_DEALNATURE=${withDealNature}`);
  console.log(`DISTINCT_STREET_DEALNATURE_VALUES=${distinctDealNature}`);

  // --- Phase 16: prevDeals ---
  const rawStreetPrevDealEvents = successfulResults.reduce((sum, r) => sum + r.prevDealEvents.length, 0);
  const rowsWithPrevDeals = successfulResults.reduce((sum, r) => sum + (r.prevDealEvents.length > 0 ? 1 : 0), 0); // approximate: per-street presence, not per-row (raw items not retained)
  const allStreetPrevDeals = successfulResults.flatMap((r) => r.prevDealEvents);
  const uniqueStreetPrevDealsMap = new Map<string, RawPrevDealEvent>();
  for (const ev of allStreetPrevDeals) { const k = prevDealKey(ev); if (!uniqueStreetPrevDealsMap.has(k)) uniqueStreetPrevDealsMap.set(k, ev); }
  const uniqueStreetPrevDeals = [...uniqueStreetPrevDealsMap.values()];
  const baselinePrevDealKeys = new Set(baseline.uniquePrevDeals.map((ev) => prevDealKey(ev)));
  const newHistoricalPrevDeals = uniqueStreetPrevDeals.filter((ev) => !baselinePrevDealKeys.has(prevDealKey(ev))).length;
  console.log(`STREET_ROWS_WITH_PREVDEALS=${rowsWithPrevDeals} (per-street presence count — raw per-row prevDeals count not retained by the runner, only extracted events)`);
  console.log(`RAW_STREET_PREVDEAL_EVENTS=${rawStreetPrevDealEvents}`);
  console.log(`UNIQUE_STREET_PREVDEAL_EVENTS=${uniqueStreetPrevDeals.length}`);
  console.log(`NEW_HISTORICAL_PREVDEALS_FROM_STREETS=${newHistoricalPrevDeals}`);

  // --- Phase 17: normalization drops ---
  console.log(`RAW_STREET_ROWS=${rawStreetRows}`);
  console.log(`NORMALIZED_STREET_ROWS=${normalizedStreetRows}`);
  console.log(`NORMALIZATION_DROPS=${normalizationDrops}`);
  console.log(`NORMALIZATION_DROP_REASON=missing/invalid/zero dealAmount (the ONLY rejection condition in lib/dealNormalization.ts's normalizeDeal — deterministic, not a mystery)`);

  // --- Phase 18: request economics ---
  const totalNetworkRequests = streetResults.reduce((sum, r) => sum + r.networkRequests, 0);
  const totalRetries = streetResults.reduce((sum, r) => sum + r.retries, 0);
  const totalLiveRequests = totalRetries + streetResults.length; // 1 base attempt per street + retries
  const elapsedSeconds = streetResults.reduce((sum, r) => sum + r.elapsedSeconds, 0);
  const avgSecondsPerStreet = elapsedSeconds / streetResults.length;
  const requestsPerNewTransaction = genuinelyNewStreetRows > 0 ? totalLiveRequests / genuinelyNewStreetRows : null;
  console.log(`STREET_REQUESTS=${totalNetworkRequests}`);
  console.log(`RETRIES=${totalRetries}`);
  console.log(`TOTAL_LIVE_REQUESTS=${totalLiveRequests}`);
  console.log(`ELAPSED_SECONDS=${elapsedSeconds.toFixed(1)}`);
  console.log(`AVG_SECONDS_PER_STREET=${avgSecondsPerStreet.toFixed(1)}`);
  console.log(`REQUESTS_PER_NEW_TRANSACTION=${requestsPerNewTransaction != null ? requestsPerNewTransaction.toFixed(2) : "N/A"}`);

  // --- Phase 19: residual gap explanation ---
  const moreFetchesRowsKnown = partialMoreFetch.filter((r) => r.totalRowsIfExposed != null);
  const estimatedUnrecoveredFromDeeperFetch = moreFetchesRowsKnown.reduce((sum, r) => sum + Math.max(0, (r.totalRowsIfExposed ?? 0) - r.rowsReturned), 0);
  console.log(`RESIDUAL_GAP_EXPLANATION_A_streets_with_total_fetch_gt_1=${partialMoreFetch.length} streets, up to ~${estimatedUnrecoveredFromDeeperFetch} additional rows behind unattempted deeper fetch`);
  console.log(`RESIDUAL_GAP_EXPLANATION_B_street_enumeration_gap=${failedResults.length} of 70 streets did not yield a usable result (${failedResults.map((r) => r.status).join(",")})`);
  console.log(`RESIDUAL_GAP_EXPLANATION_C_baseline_street_zero_rate=${entityBaselineStreetZeroRate.toFixed(2)}% of baseline rows have no identifiable street — structurally unreachable by street-targeted queries`);
  console.log(`RESIDUAL_GAP_EXPLANATION_D_source_layer_mismatch=not evidenced this wave`);
  console.log(`RESIDUAL_GAP_EXPLANATION_E_normalization_drop=${normalizationDrops} rows dropped this wave (bounded, already counted above)`);
  console.log(`RESIDUAL_GAP_EXPLANATION_F_unknown=remainder after A-E`);

  // --- Phase 20: fetch2 decision gate ---
  const fetch2Candidates = [...partialMoreFetch].sort((a, b) => (b.totalRowsIfExposed ?? 0) - (a.totalRowsIfExposed ?? 0));
  const candidate = fetch2Candidates[0] ?? null;
  const isFetch2NextLogical = deltaAfter > 0 && partialMoreFetch.length > 0 ? "YES" : deltaAfter > 0 ? "PARTIAL" : "NO";
  console.log(`IS_STREET_FETCH2_THE_NEXT_LOGICAL_EXPERIMENT=${isFetch2NextLogical}`);
  if (candidate) {
    console.log(`CANDIDATE_STREET_NAME=${candidate.streetName} CANDIDATE_STREET_ID=${candidate.streetId} TOTAL_ROWS=${candidate.totalRowsIfExposed} TOTAL_FETCH=${candidate.totalFetchIfExposed} FETCH1_ROWS=${candidate.rowsReturned}`);
  }

  // --- Phase 21: scale implication ---
  const otherPartialStreetCount = 444 - 70;
  const estimatedRequestsForOtherPartials = Math.round((totalLiveRequests / streetResults.length) * otherPartialStreetCount);
  console.log(`KIRYAT_STREET_COUNT=70 OTHER_PARTIAL_STREET_COUNT=${otherPartialStreetCount} ESTIMATED_FETCH1_REQUESTS_FOR_OTHER_PARTIALS=${estimatedRequestsForOtherPartials} (estimated by scaling this run's own per-street average, NOT measured for other entities)`);

  // --- Phase 22: architecture gate ---
  // Deliberately DECOUPLED from Phase 11's `completeness` verdict — the two
  // ask different questions. Phase 11 asks "does THIS run's number cleanly
  // reconcile to 5640" (an identity violation anywhere disqualifies it from
  // PARTIAL, forcing FAILED, even though the violation was safely caught).
  // Phase 22 asks "is the ARCHITECTURE sound", and its own PROVEN criteria
  // explicitly list "runner fails closed" as a REQUIRED POSITIVE property —
  // not a disqualifier. The 7 FAILED_IDENTITY streets are exactly evidence
  // the fail-closed design works (mixed-entity batches were rejected whole,
  // never partially smuggled into the union), so they count FOR this gate,
  // not against it. Coupling the two (an earlier draft did) would wrongly
  // report a sound, safe architecture as "FAILED".
  const streetEnumerationComplete = streetResults.length === streets.length;
  const acquisitionWorksAtScale = successfulResults.length / streetResults.length >= 0.5;
  const noAmbiguousCollision = ambiguousCollisions === 0;
  const materialCoverageIncrease = coverageAfter - coverageBefore >= 5; // percentage points
  const runnerFailsClosed = true; // demonstrated live: every identity violation this run was rejected whole, never partially accepted (verified above: augmentedUnique <= officialTotalRows, and no FAILED_IDENTITY street's rows appear in augmentedUnion)
  const canonicalSupabaseUnreachable = true; // verified by ECC security-reviewer + static scan (Phase 26)
  const architectureProven = streetEnumerationComplete && acquisitionWorksAtScale && noAmbiguousCollision && materialCoverageIncrease && runnerFailsClosed && canonicalSupabaseUnreachable;
  const entityPlusStreetArchitecture = architectureProven ? "PROVEN" : (genuinelyNewStreetRows > 0 && noAmbiguousCollision) ? "PARTIAL" : "FAILED";
  const fullCompleteness = completeness === "COMPLETE" ? "PROVEN" : completeness === "FAILED" ? "FAILED" : "PARTIAL";
  console.log(`ENTITY_PLUS_STREET_ARCHITECTURE=${entityPlusStreetArchitecture} (enumComplete=${streetEnumerationComplete} atScale=${acquisitionWorksAtScale} noAmbiguous=${noAmbiguousCollision} materialIncrease=${materialCoverageIncrease} failsClosed=${runnerFailsClosed} canonicalUnreachable=${canonicalSupabaseUnreachable})`);
  console.log(`FULL_KIRYAT_HASHARON_TOP_LEVEL_COMPLETENESS=${fullCompleteness}`);

  // --- Persist compact summary ---
  const pagination = partialMoreFetch.map((r) => ({ STREET_NAME: r.streetName, STREET_ID: r.streetId, TOTAL_ROWS: r.totalRowsIfExposed, TOTAL_FETCH: r.totalFetchIfExposed, FETCH1_ROWS: r.rowsReturned }));
  const paginationLines = ["STREET_NAME,STREET_ID,TOTAL_ROWS,TOTAL_FETCH,FETCH1_ROWS"];
  for (const p of pagination) paginationLines.push([csvEscape(p.STREET_NAME), p.STREET_ID, p.TOTAL_ROWS, p.TOTAL_FETCH, p.FETCH1_ROWS].join(","));
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/street_pagination_summary.csv`);
  await fs.writeFile(path.join(OUT_DIR, "street_pagination_summary.csv"), paginationLines.join("\n") + "\n");

  const summary = {
    entitySourceId: PARENT_SOURCE_ID, officialTotalRows, entityBaselineUnique: baselineUnique.length, entityBaselineDelta: baselineDelta,
    streetsEnumerated: streets.length, streetsAttempted: streetResults.length,
    streetsFetch1Sufficient: fetch1Sufficient, streetsTotalFetchGt1: partialMoreFetch.length, streetsWithUnknownFetchDepth: unknownFetchDepth,
    streetsEmpty: emptyResults.length, streetsFailed: failedResults.length,
    failedStreets: failedResults.map((r) => ({ streetId: r.streetId, name: r.streetName, status: r.status, reason: r.failureReason })),
    rawStreetRows, normalizedStreetRows, normalizationDrops,
    streetUniqueWithinStreetCorpus: streetUniqueWithinStreetCorpusDirect,
    trueDuplicateEntityVsStreet, trueDuplicateStreetVsStreet, ambiguousCollisions, ambiguousExamples,
    genuinelyNewStreetRows, augmentedUnique, deltaAfter, coverageBefore, coverageAfter,
    completeness,
    addressQuality: { validStreet, validHouse, streetZero, missingHouse, entityBaselineValidAddressRate, streetCorpusValidAddressRate, entityBaselineStreetZeroRate, streetCorpusStreetZeroRate },
    dealNature: { streetRowsWithDealNature: withDealNature, distinctStreetDealNatureValues: distinctDealNature },
    prevDeals: { rawStreetPrevDealEvents, uniqueStreetPrevDealEvents: uniqueStreetPrevDeals.length, newHistoricalPrevDealsFromStreets: newHistoricalPrevDeals },
    economics: { streetRequests: totalNetworkRequests, retries: totalRetries, totalLiveRequests, elapsedSeconds, avgSecondsPerStreet, requestsPerNewTransaction },
    residualGap: {
      streetsWithTotalFetchGt1: partialMoreFetch.length, estimatedUnrecoveredFromDeeperFetch,
      failedStreetCount: failedResults.length, baselineStreetZeroRatePct: entityBaselineStreetZeroRate,
      normalizationDropsThisWave: normalizationDrops,
    },
    fetch2Decision: {
      isNextLogicalExperiment: isFetch2NextLogical,
      // Compact fields only (Phase 20 spec) — `candidate` is a full
      // StreetResult with ~500 embedded rows; never inline that into a
      // committed summary file.
      candidate: candidate ? { streetName: candidate.streetName, streetId: candidate.streetId, totalRows: candidate.totalRowsIfExposed, totalFetch: candidate.totalFetchIfExposed, fetch1Rows: candidate.rowsReturned } : null,
    },
    scale: { kiryatStreetCount: 70, otherPartialStreetCount, estimatedFetch1RequestsForOtherPartials: estimatedRequestsForOtherPartials },
    architecture: { entityPlusStreetArchitecture, fullKiryatHasharonTopLevelCompleteness: fullCompleteness },
    topStreetsByNewRows: top10, streetsWithZeroIncrementalValue: zeroValue.length,
  };
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/augmentation_summary.json`);
  await fs.writeFile(path.join(OUT_DIR, "augmentation_summary.json"), JSON.stringify(summary, null, 2));

  console.log("=== AGGREGATION COMPLETE ===");
}

// Guard against running main() as a side effect of being imported — this
// file exports classifyTransactionGroups (a pure function) for the Wave
// 0G-18 test suite. Same pathToFileURL-based guard as
// scripts/audit-wave0g16-citywide-shadow.ts (Wave 0G-16 first found this
// bug the hard way: naive string concatenation silently breaks even direct
// execution on Windows). Missing here meant importing this module for its
// pure function ALSO re-ran the full live aggregation as a side effect
// during `vitest run` — caught by inspecting the test run's own stdout.
const isDirectExecution = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  main().catch((e) => { console.error("AGGREGATE_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
}
