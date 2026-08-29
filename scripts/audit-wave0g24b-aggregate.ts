/**
 * scripts/audit-wave0g24b-aggregate.ts — Wave 0G-24B Phases 6-13: aggregates
 * the 374 per-(entity,street) result files produced by
 * scripts/audit-wave0g24-multi-entity-street-runner.ts's live run against
 * each of the 10 target entities' Wave 0G-16 baseline, and combines with the
 * 27 already-COMPLETE entities + Kiryat Hasharon's retained 5145/5640 result
 * into an updated citywide figure.
 *
 * Does NOT reimplement the transaction-identity dedup logic: imports and
 * reuses scripts/audit-wave0g18-aggregate.ts's exported
 * classifyTransactionGroups() UNCHANGED, exactly as Wave 0G-18 established
 * it for the Kiryat pilot — this is the same architecture applied per
 * entity, not a new one.
 *
 * Usage: npx tsx scripts/audit-wave0g24b-aggregate.ts
 */
import { promises as fs } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { assertSafeShadowOutputPath, type ShadowDeal } from "../lib/shadowRebuild";
import { detectAmbiguousCollisions, prevDealKey, type RawPrevDealEvent } from "./audit-wave0g16-citywide-shadow";
import { type StreetStatus, type StreetResult } from "./audit-wave0g18-street-runner";
import { classifyTransactionGroups } from "./audit-wave0g18-aggregate";
import { TARGET_ENTITIES, RUN_CONTRACT_VERSION } from "./audit-wave0g24-multi-entity-street-runner";

const SHADOW_DIR = path.join(process.cwd(), "audit/wave0g24/shadow");
const OUT_DIR_REL = "audit/wave0g24";
const OUT_DIR = path.join(process.cwd(), OUT_DIR_REL);
const BASELINE_DIR = path.join(process.cwd(), "audit/wave0g16/shadow-output");
const CITYWIDE_SUMMARY_PATH = path.join(process.cwd(), "audit/wave0g16/citywide_summary.json");
const KIRYAT_ATTRIBUTION_PATH = path.join(process.cwd(), "audit/wave0g23/attribution_summary.json");

const successStatuses: StreetStatus[] = ["SUCCESS_ROWS", "SUCCESS_MIXED_PARTIAL", "SUCCESS_EMPTY", "PARTIAL_MORE_FETCHES_INDICATED"];

interface BaselineFile {
  officialTotalRows: number;
  uniqueRows: ShadowDeal[];
  uniquePrevDeals: RawPrevDealEvent[];
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function loadEntityStreetIds(sourceId: string): Promise<string[]> {
  const manifestPath = path.join(OUT_DIR, `street_manifest_${sourceId}.json`);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const streets = manifest.streets as { streetId: string }[];
  if (!Array.isArray(streets) || streets.length === 0) throw new Error(`EMPTY_STREET_MANIFEST: ${sourceId}`);
  return streets.map((s) => s.streetId);
}

async function loadResult(sourceId: string, streetId: string): Promise<StreetResult> {
  const p = path.join(SHADOW_DIR, `street_${sourceId}_${streetId}.json`);
  let raw: StreetResult;
  try {
    raw = JSON.parse(await fs.readFile(p, "utf8")) as StreetResult;
  } catch (e) {
    throw new Error(`MISSING_OR_INVALID_STREET_RESULT: sourceId=${sourceId} streetId=${streetId} (${(e as Error).message})`);
  }
  if (raw.runContractVersion !== RUN_CONTRACT_VERSION || raw.parentSourceId !== sourceId || raw.streetId !== streetId) {
    throw new Error(`CONTRACT_MISMATCH: sourceId=${sourceId} streetId=${streetId} — got parentSourceId=${raw.parentSourceId} streetId=${raw.streetId} version=${raw.runContractVersion}`);
  }
  return raw;
}

async function main() {
  console.log("=== WAVE 0G-24B AGGREGATION (Phases 6-13) ===");

  const entityResults: any[] = [];
  const allEntityStreetResults: StreetResult[] = [];
  // Economics must be counted PER DISTINCT streetId, not per (entity,street)
  // record — a shared boundary street's ONE real live fetch is duplicated
  // across every referencing entity's own result file (same networkRequests/
  // retries/elapsedSeconds values copied onto each), so summing across all
  // 374 records would over-count the 338 real HTTP exchanges that occurred.
  // ECC database-reviewer + code-reviewer finding: this dedup is only safe
  // WITHIN one execution (the runner fetches a streetId once, then
  // classifies that SAME raw batch per entity). A future resumed run could
  // in principle fetch a shared streetId's data at two different times for
  // two different entities (if one was cached and the other wasn't), giving
  // genuinely different economics per entity — collapsing to first-write
  // would then silently discard that divergence. Collect every record per
  // streetId and assert they agree before trusting the collapsed value.
  const streetEconomicsRecords = new Map<string, { networkRequests: number; retries: number; elapsedSeconds: number }[]>();
  const paginationCandidates: { entity: string; streetName: string; streetId: string; totalRows: number | null; totalFetch: number | null; fetch1Rows: number; status: StreetStatus }[] = [];
  const allFailedRefs: { entity: string; streetName: string; streetId: string; status: StreetStatus; failureReason: string | null }[] = [];

  // ECC planner finding (C1): this is summed per (entity,street) REFERENCE
  // (374 records), not deduped per distinct streetId — intentionally, since
  // row acceptance is legitimately entity-relative for a shared boundary
  // street (the same raw batch can be ACCEPT_PARENT for one entity and
  // REJECT_FOREIGN for another). A shared street's raw rows are therefore
  // counted once per referencing entity, so this total must never be
  // described as "distinct rows fetched" — it is an accounting-invariant
  // sum, not a physical-row count. The invariant (raw=parent+zero+foreign
  // +other) still holds because it holds per-record and summation of a
  // per-record identity is itself an identity.
  let sumRawAcceptance = { rawRows: 0, acceptedParent: 0, rejectedZero: 0, rejectedForeign: 0, rejectedMissing: 0, rejectedMalformed: 0 };
  let statusCounts: Record<string, number> = {};

  for (const entity of TARGET_ENTITIES) {
    const baselinePath = path.join(BASELINE_DIR, `${entity.sourceId}.json`);
    const baseline: BaselineFile = JSON.parse(await fs.readFile(baselinePath, "utf8"));
    if (baseline.officialTotalRows !== entity.officialTotal || baseline.uniqueRows.length !== entity.baselineUnique) {
      throw new Error(`BASELINE_MISMATCH for ${entity.name}: expected official=${entity.officialTotal} baseline=${entity.baselineUnique}, got official=${baseline.officialTotalRows} baseline=${baseline.uniqueRows.length}`);
    }
    const baselineUnique = baseline.uniqueRows;

    const streetIds = await loadEntityStreetIds(entity.sourceId);
    const streetResults: StreetResult[] = [];
    for (const streetId of streetIds) {
      const r = await loadResult(entity.sourceId, streetId);
      streetResults.push(r);
      allEntityStreetResults.push(r);
      statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
      if (!streetEconomicsRecords.has(streetId)) streetEconomicsRecords.set(streetId, []);
      streetEconomicsRecords.get(streetId)!.push({ networkRequests: r.networkRequests, retries: r.retries, elapsedSeconds: r.elapsedSeconds });
      if (r.rowAcceptanceCounts) {
        sumRawAcceptance.rawRows += r.rowAcceptanceCounts.rawRows;
        sumRawAcceptance.acceptedParent += r.rowAcceptanceCounts.acceptedParent;
        sumRawAcceptance.rejectedZero += r.rowAcceptanceCounts.rejectedZero;
        sumRawAcceptance.rejectedForeign += r.rowAcceptanceCounts.rejectedForeign;
        sumRawAcceptance.rejectedMissing += r.rowAcceptanceCounts.rejectedMissing;
        sumRawAcceptance.rejectedMalformed += r.rowAcceptanceCounts.rejectedMalformed;
      }
      if (r.totalFetchIfExposed != null && r.totalFetchIfExposed > 1) {
        paginationCandidates.push({ entity: entity.name, streetName: r.streetName, streetId: r.streetId, totalRows: r.totalRowsIfExposed, totalFetch: r.totalFetchIfExposed, fetch1Rows: r.rowsReturned, status: r.status });
      }
      if (!successStatuses.includes(r.status)) {
        allFailedRefs.push({ entity: entity.name, streetName: r.streetName, streetId: r.streetId, status: r.status, failureReason: r.failureReason });
      }
    }

    const successfulResults = streetResults.filter((r) => successStatuses.includes(r.status));
    const failedResults = streetResults.filter((r) => !successStatuses.includes(r.status));

    const classification = classifyTransactionGroups(baselineUnique, successfulResults.map((r) => ({ streetId: r.streetId, rows: r.rows })));
    const { augmentedUnion, trueDuplicateEntityVsStreet, trueDuplicateStreetVsStreet, ambiguousCollisions, genuinelyNewStreetRows, ambiguousExamples } = classification;

    // Independent cross-check, same pattern as Wave 0G-18's aggregator.
    const allRowsFlat = [...baselineUnique, ...successfulResults.flatMap((r) => r.rows)];
    const crossCheck = detectAmbiguousCollisions(allRowsFlat);
    if (crossCheck.ambiguousCount !== ambiguousCollisions) {
      throw new Error(`INTEGRITY_FAIL for ${entity.name}: ambiguous-collision cross-check mismatch — classifyTransactionGroups=${ambiguousCollisions}, detectAmbiguousCollisions=${crossCheck.ambiguousCount}`);
    }

    const augmentedUnique = augmentedUnion.length;
    if (augmentedUnique > entity.officialTotal) {
      throw new Error(`INTEGRITY_FAIL for ${entity.name}: AUGMENTED_UNIQUE (${augmentedUnique}) exceeds OFFICIAL_TOTAL (${entity.officialTotal})`);
    }

    const deltaAfter = entity.officialTotal - augmentedUnique;
    const coverageBefore = (baselineUnique.length / entity.officialTotal) * 100;
    const coverageAfter = (augmentedUnique / entity.officialTotal) * 100;

    // COMPLETE requires exact official reconciliation AND no integrity
    // violation AND no street this entity couldn't classify cleanly.
    // FAILED is reserved for an actual integrity violation (ambiguous
    // collision) — NOT for a legitimate FAILED_NO_TRUSTED_ROWS boundary-
    // street rejection, which is the correctly-working fail-closed design
    // excluding 0 rows from the union, not an unresolved data-safety
    // threat. Those are surfaced separately (failedResults) for
    // transparency, never hidden. Note: an overshoot (augmentedUnique >
    // officialTotal) is NOT checked again here — it already threw,
    // unconditionally, a few lines above, so this function can never reach
    // this point with an overshoot (ECC planner finding C5a: the prior
    // version re-checked it here too, which was dead code).
    let status: "COMPLETE" | "PARTIAL" | "FAILED";
    if (ambiguousCollisions > 0) status = "FAILED";
    else if (augmentedUnique === entity.officialTotal && failedResults.length === 0) status = "COMPLETE";
    else status = "PARTIAL";

    // prevDeals
    const rawPrevDealEvents = successfulResults.reduce((s, r) => s + r.prevDealEvents.length, 0);
    const allPrevDeals = successfulResults.flatMap((r) => r.prevDealEvents);
    const uniquePrevDealMap = new Map<string, RawPrevDealEvent>();
    for (const ev of allPrevDeals) { const k = prevDealKey(ev); if (!uniquePrevDealMap.has(k)) uniquePrevDealMap.set(k, ev); }
    const uniquePrevDeals = [...uniquePrevDealMap.values()];
    const baselinePrevDealKeys = new Set(baseline.uniquePrevDeals.map((ev) => prevDealKey(ev)));
    const newHistoricalPrevDeals = uniquePrevDeals.filter((ev) => !baselinePrevDealKeys.has(prevDealKey(ev))).length;

    entityResults.push({
      name: entity.name, sourceId: entity.sourceId, officialTotal: entity.officialTotal,
      baselineUnique: baselineUnique.length, streetCount: streetIds.length,
      parentRows: successfulResults.reduce((s, r) => s + (r.rowAcceptanceCounts?.acceptedParent ?? 0), 0),
      newRows: genuinelyNewStreetRows, augmentedUnique, delta: deltaAfter,
      coverageBefore, coverageAfter, status,
      streetsFailed: failedResults.length, trueDuplicateEntityVsStreet, trueDuplicateStreetVsStreet, ambiguousCollisions,
      rawStreetPrevDealEvents: rawPrevDealEvents, uniqueStreetPrevDealEvents: uniquePrevDeals.length, newHistoricalPrevDeals,
      ambiguousExamples,
    });

    console.log(`${entity.name} (${entity.sourceId}): official=${entity.officialTotal} baseline=${baselineUnique.length} augmented=${augmentedUnique} delta=${deltaAfter} coverage=${coverageBefore.toFixed(2)}%->${coverageAfter.toFixed(2)}% status=${status} failed=${failedResults.length} ambiguous=${ambiguousCollisions}`);
  }

  // --- Phase 6: execution accounting ---
  const streetsEnumerated = entityResults.reduce((s, e) => s + e.streetCount, 0);
  const distinctStreetIds = streetEconomicsRecords.size;
  // ECC database-reviewer + code-reviewer finding: verify every entity that
  // shares a streetId actually reports IDENTICAL economics before
  // collapsing to one value per streetId — a real divergence here would
  // mean two different physical fetches happened for the "same" street
  // (e.g. across a resumed run), which the old first-write-wins collapse
  // would have silently hidden.
  const divergentStreetEconomics: string[] = [];
  const distinctStreetEconomics = new Map<string, { networkRequests: number; retries: number; elapsedSeconds: number }>();
  for (const [streetId, records] of streetEconomicsRecords) {
    const first = records[0];
    const allAgree = records.every((r) => r.networkRequests === first.networkRequests && r.retries === first.retries && r.elapsedSeconds === first.elapsedSeconds);
    if (!allAgree) divergentStreetEconomics.push(streetId);
    distinctStreetEconomics.set(streetId, first);
  }
  if (divergentStreetEconomics.length > 0) {
    throw new Error(`INTEGRITY_FAIL: streetId(s) [${divergentStreetEconomics.join(",")}] report DIFFERENT economics (networkRequests/retries/elapsedSeconds) across the entities that reference them — expected identical values since they should all derive from the SAME physical live fetch. This likely means the streetId was fetched at two different times (e.g. a partially-resumed run) and the two per-entity result files disagree; investigate before trusting NETWORK_REQUESTS/RETRIES/ELAPSED_SECONDS below.`);
  }
  const totalNetworkRequests = [...distinctStreetEconomics.values()].reduce((s, v) => s + v.networkRequests, 0);
  const totalRetries = [...distinctStreetEconomics.values()].reduce((s, v) => s + v.retries, 0);
  const totalElapsedSeconds = [...distinctStreetEconomics.values()].reduce((s, v) => s + v.elapsedSeconds, 0);
  const rawAcctSum = sumRawAcceptance.acceptedParent + sumRawAcceptance.rejectedZero + sumRawAcceptance.rejectedForeign + sumRawAcceptance.rejectedMissing + sumRawAcceptance.rejectedMalformed;
  if (rawAcctSum !== sumRawAcceptance.rawRows) {
    throw new Error(`INTEGRITY_FAIL: citywide RAW=PARENT+ZERO+FOREIGN+OTHER invariant violated — raw=${sumRawAcceptance.rawRows} sum=${rawAcctSum}`);
  }
  // ECC planner finding (C3): pagination candidates are collected by
  // totalFetchIfExposed>1 directly (entity-street REFERENCES, 16 in this
  // run), independent of status — do NOT conflate this with
  // STATUS_COUNTS.PARTIAL_MORE_FETCHES_INDICATED, which undercounts
  // because classifyStreetExchange gives identity-mixing status priority
  // over the orthogonal pagination signal (a paginated street can show as
  // SUCCESS_MIXED_PARTIAL instead). Report the distinct-STREET count too,
  // since a shared boundary street with total_fetch>1 is counted once per
  // referencing entity above.
  const distinctPaginatedStreetIds = new Set(paginationCandidates.map((p) => p.streetId)).size;
  console.log(`\nSTREETS_ENUMERATED=${streetsEnumerated}`);
  console.log(`DISTINCT_STREET_IDS=${distinctStreetIds}`);
  console.log(`STREETS_ATTEMPTED_ENTITY_REFS=${allEntityStreetResults.length}`);
  console.log(`STATUS_COUNTS=${JSON.stringify(statusCounts)}`);
  console.log(`NETWORK_REQUESTS=${totalNetworkRequests}`);
  console.log(`RETRIES=${totalRetries}`);
  console.log(`ELAPSED_SECONDS=${totalElapsedSeconds.toFixed(1)}`);
  console.log(`RAW=${sumRawAcceptance.rawRows} PARENT=${sumRawAcceptance.acceptedParent} ZERO=${sumRawAcceptance.rejectedZero} FOREIGN=${sumRawAcceptance.rejectedForeign} OTHER=${sumRawAcceptance.rejectedMissing + sumRawAcceptance.rejectedMalformed} (per entity-street REFERENCE, not deduped by street — see code comment)`);

  // --- Phase 9: citywide combination ---
  const citywide = JSON.parse(await fs.readFile(CITYWIDE_SUMMARY_PATH, "utf8"));
  const kiryat = JSON.parse(await fs.readFile(KIRYAT_ATTRIBUTION_PATH, "utf8"));
  // ECC planner finding (C4): assert TARGET_ENTITIES (this wave's 10) plus
  // Kiryat's own sourceId together account for EXACTLY the 11 PARTIAL
  // entities citywide_summary.json lists — if a PARTIAL entity were ever
  // dropped from TARGET_ENTITIES, the complete27 computation below
  // (official - partialSum) would silently absorb it into the "complete"
  // bucket without this catching it, since that guard only checks internal
  // self-consistency (official===shadow), not membership.
  const KIRYAT_SOURCE_ID = "65209683";
  const partialSourceIds = new Set<string>(citywide.partialEntitiesDetail.map((p: any) => p.SOURCE_ID));
  const expectedPartialSourceIds = new Set<string>([...TARGET_ENTITIES.map((e) => e.sourceId), KIRYAT_SOURCE_ID]);
  const missingFromTargets = [...partialSourceIds].filter((id) => !expectedPartialSourceIds.has(id));
  const unexpectedInTargets = [...expectedPartialSourceIds].filter((id) => !partialSourceIds.has(id));
  if (missingFromTargets.length > 0 || unexpectedInTargets.length > 0) {
    throw new Error(`INTEGRITY_FAIL: TARGET_ENTITIES + Kiryat does not exactly match citywide_summary.json's 11 PARTIAL entities — missing=[${missingFromTargets.join(",")}] unexpected=[${unexpectedInTargets.join(",")}]. The complete27 sum below would silently misclassify any PARTIAL entity not accounted for here.`);
  }

  const partialOfficialSum = citywide.partialEntitiesDetail.reduce((s: number, p: any) => s + p.OFFICIAL_TOTAL, 0);
  const partialShadowSum = citywide.partialEntitiesDetail.reduce((s: number, p: any) => s + p.SHADOW_UNIQUE, 0);
  const complete27OfficialSum = citywide.officialTopLevelRowsSum - partialOfficialSum;
  const complete27ShadowSum = citywide.shadowTopLevelUniqueSum - partialShadowSum;
  if (complete27OfficialSum !== complete27ShadowSum) {
    throw new Error(`INTEGRITY_FAIL: 27-COMPLETE-entity sum mismatch — official=${complete27OfficialSum} shadow=${complete27ShadowSum} (should be equal, since COMPLETE means official===shadow)`);
  }
  // ECC database-reviewer finding: pin the expected value too (mirroring
  // the Kiryat guard below), not just internal self-consistency — a
  // regenerated Wave 0G-16 dataset with a different COMPLETE/PARTIAL split
  // would otherwise pass the check above while silently changing this sum.
  if (complete27ShadowSum !== 25110) {
    throw new Error(`INTEGRITY_FAIL: 27-COMPLETE-entity sum drifted from its expected value — expected 25110, got ${complete27ShadowSum}. Re-verify audit/wave0g16/citywide_summary.json before trusting any citywide figure.`);
  }
  if (kiryat.officialTotal !== 5640 || kiryat.finalUnique !== 5145) {
    throw new Error(`INTEGRITY_FAIL: Kiryat retained figures drifted from audit/wave0g23 — expected 5640/5145, got ${kiryat.officialTotal}/${kiryat.finalUnique}`);
  }

  const targetOfficialSum = entityResults.reduce((s, e) => s + e.officialTotal, 0);
  const targetBaselineSum = entityResults.reduce((s, e) => s + e.baselineUnique, 0);
  const targetAugmentedSum = entityResults.reduce((s, e) => s + e.augmentedUnique, 0);
  const updatedShadowTopLevelUnique = complete27ShadowSum + kiryat.finalUnique + targetAugmentedSum;
  const officialTopLevelRowsSum = citywide.officialTopLevelRowsSum;
  const updatedDelta = officialTopLevelRowsSum - updatedShadowTopLevelUnique;
  const updatedCoverage = (updatedShadowTopLevelUnique / officialTopLevelRowsSum) * 100;
  const netNewVsWave0G16 = updatedShadowTopLevelUnique - citywide.shadowTopLevelUniqueSum;
  // ECC planner finding (C2): netNewVsWave0G16 (9584) is the delta since
  // Wave 0G-16's ORIGINAL baseline measurement, and includes Kiryat's
  // 2,627-row gain that was already earned and committed in Waves
  // 0G-18/0G-20/0G-21/0G-23 — Kiryat was NOT rerun this wave, it is only
  // being folded into the updated citywide total for completeness. This
  // wave's OWN acquisition contribution is the 10 target entities' own
  // growth only.
  const thisWaveOwnContribution = targetAugmentedSum - targetBaselineSum;

  console.log(`\nOFFICIAL_TOP_LEVEL_ROWS_SUM=${officialTopLevelRowsSum}`);
  console.log(`COMPLETE_27_SUM=${complete27ShadowSum}`);
  console.log(`KIRYAT_RETAINED=${kiryat.finalUnique}/${kiryat.officialTotal} (NOT rerun this wave — retained from Wave 0G-23)`);
  console.log(`TARGET_10_OFFICIAL_SUM=${targetOfficialSum}`);
  console.log(`TARGET_10_BASELINE_SUM=${targetBaselineSum}`);
  console.log(`TARGET_10_AUGMENTED_SUM=${targetAugmentedSum}`);
  console.log(`UPDATED_SHADOW_TOP_LEVEL_UNIQUE=${updatedShadowTopLevelUnique}`);
  console.log(`UPDATED_DELTA=${updatedDelta}`);
  console.log(`UPDATED_CITYWIDE_COVERAGE=${updatedCoverage.toFixed(2)}%`);
  console.log(`NET_NEW_VS_WAVE_0G16=${netNewVsWave0G16} (citywide total since the 0G-16 baseline measurement, includes Kiryat's already-committed prior-wave gain)`);
  console.log(`THIS_WAVE_OWN_CONTRIBUTION=${thisWaveOwnContribution} (10 target entities' own augmented growth this wave, excludes Kiryat)`);
  console.log(`BASELINE_WAVE_0G16=${citywide.shadowTopLevelUniqueSum}/${officialTopLevelRowsSum}=${((citywide.shadowTopLevelUniqueSum / officialTopLevelRowsSum) * 100).toFixed(2)}%`);

  // --- Phase 8: pagination observation ---
  console.log(`\nSTREETS_TOTAL_FETCH_GT_1_ENTITY_REFS=${paginationCandidates.length}`);
  console.log(`STREETS_TOTAL_FETCH_GT_1_DISTINCT=${distinctPaginatedStreetIds}`);
  for (const p of paginationCandidates) console.log(`  ${p.entity} / ${p.streetName} (${p.streetId}): total_rows=${p.totalRows} total_fetch=${p.totalFetch} fetch1_rows=${p.fetch1Rows} status=${p.status}`);
  console.log(`FETCH2_EXECUTED=NO`);

  // --- Phase 11: failures ---
  console.log(`\nFAILED_REFS=${allFailedRefs.length}`);
  for (const f of allFailedRefs) console.log(`  ${f.entity} / ${f.streetName} (${f.streetId}): ${f.status} — ${f.failureReason}`);

  // --- persist artifacts ---
  await fs.mkdir(OUT_DIR, { recursive: true });

  const entityLines = ["ENTITY,SOURCE_ID,OFFICIAL_TOTAL,BASELINE_UNIQUE,STREET_COUNT,PARENT_ROWS,NEW_ROWS,AUGMENTED_UNIQUE,DELTA,COVERAGE_BEFORE,COVERAGE_AFTER,STATUS,STREETS_FAILED,AMBIGUOUS_COLLISIONS"];
  for (const e of entityResults) {
    entityLines.push([csvEscape(e.name), e.sourceId, e.officialTotal, e.baselineUnique, e.streetCount, e.parentRows, e.newRows, e.augmentedUnique, e.delta, e.coverageBefore.toFixed(2), e.coverageAfter.toFixed(2), e.status, e.streetsFailed, e.ambiguousCollisions].join(","));
  }
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/entity_outcomes.csv`);
  await fs.writeFile(path.join(OUT_DIR, "entity_outcomes.csv"), entityLines.join("\n") + "\n");

  // ECC planner finding (C5b): STATUS is included so a reader can see that
  // an entity-street ref with total_fetch>1 but a non-success STATUS (e.g.
  // FAILED_NO_TRUSTED_ROWS) has zero accepted rows for THAT entity — the
  // "more data exists behind fetch2" signal is real for the physical
  // street, but not actionable for an entity that accepted nothing there.
  const paginationLines = ["ENTITY,STREET_NAME,STREET_ID,TOTAL_ROWS,TOTAL_FETCH,FETCH1_ROWS,STATUS"];
  for (const p of paginationCandidates) paginationLines.push([csvEscape(p.entity), csvEscape(p.streetName), p.streetId, p.totalRows, p.totalFetch, p.fetch1Rows, p.status].join(","));
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/pagination_observation.csv`);
  await fs.writeFile(path.join(OUT_DIR, "pagination_observation.csv"), paginationLines.join("\n") + "\n");

  const failedLines = ["ENTITY,STREET_NAME,STREET_ID,STATUS,FAILURE_REASON"];
  for (const f of allFailedRefs) failedLines.push([csvEscape(f.entity), csvEscape(f.streetName), f.streetId, f.status, csvEscape(f.failureReason ?? "")].join(","));
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/failed_street_refs.csv`);
  await fs.writeFile(path.join(OUT_DIR, "failed_street_refs.csv"), failedLines.join("\n") + "\n");

  const summary = {
    streetsEnumerated, distinctStreetIds, streetsAttemptedEntityRefs: allEntityStreetResults.length,
    statusCounts, networkRequests: totalNetworkRequests, retries: totalRetries, elapsedSeconds: totalElapsedSeconds,
    rowAccountingScopeNote: "sumRawAcceptance is per (entity,street) REFERENCE (374), not deduped per distinct streetId — a shared boundary street is counted once per referencing entity since row acceptance is legitimately entity-relative. Do not read rawRows as a distinct-physical-row count.",
    rowAccounting: sumRawAcceptance,
    citywide: {
      officialTopLevelRowsSum, complete27Sum: complete27ShadowSum, kiryatRetained: { unique: kiryat.finalUnique, official: kiryat.officialTotal, rerunThisWave: false },
      target10OfficialSum: targetOfficialSum, target10BaselineSum: targetBaselineSum, target10AugmentedSum: targetAugmentedSum,
      updatedShadowTopLevelUnique, updatedDelta, updatedCoveragePct: updatedCoverage,
      netNewVsWave0G16: netNewVsWave0G16, thisWaveOwnContribution,
      baselineWave0G16: { unique: citywide.shadowTopLevelUniqueSum, coveragePct: (citywide.shadowTopLevelUniqueSum / officialTopLevelRowsSum) * 100 },
    },
    entityResults: entityResults.map((e) => ({ ...e, ambiguousExamples: e.ambiguousExamples.length > 0 ? e.ambiguousExamples : undefined })),
    pagination: { entityRefCount: paginationCandidates.length, distinctStreetCount: distinctPaginatedStreetIds, candidates: paginationCandidates },
    failedRefs: allFailedRefs,
  };
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/wave0g24b_aggregation_summary.json`);
  await fs.writeFile(path.join(OUT_DIR, "wave0g24b_aggregation_summary.json"), JSON.stringify(summary, null, 2));

  console.log("\n=== AGGREGATION COMPLETE ===");
}

const isDirectExecution = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  main().catch((e) => { console.error("AGGREGATE_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
}
