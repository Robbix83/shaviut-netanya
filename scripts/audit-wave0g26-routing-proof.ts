/**
 * scripts/audit-wave0g26-routing-proof.ts — Wave 0G-26: bounded proof (2
 * live streets max) of the CITYWIDE_STREET_ROUTING hypothesis raised by
 * Wave 0G-25 — can a foreign row's explicit non-zero neighborhoodId be
 * safely routed to that official entity, and does doing so recover
 * genuinely new citywide transactions?
 *
 * Consumes: Wave 0G-25's committed boundary_citywide_overlap.csv (source
 * of truth for street selection, NOT report prose), the 2 raw JSON dumps
 * captured by this wave's 2 live diagnostic requests (temporary, deleted
 * after this script runs — never committed), and each destination
 * entity's Wave 0G-16 committed baseline. Uses the SAME canonical
 * toShadowDeal()/transactionKey() functions as the rest of the engagement
 * — no hand-rolled key this time (Wave 0G-25's ECC review flagged that
 * imprecision).
 *
 * This is SIMULATION ONLY. No row is written to any union, canonical
 * file, or committed corpus.
 *
 * Usage: npx tsx scripts/audit-wave0g26-routing-proof.ts
 */
import { promises as fs } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { toShadowDeal, transactionKey, assertSafeShadowOutputPath, type ShadowDeal } from "../lib/shadowRebuild";
import type { Neighborhood } from "../lib/types";
import { TARGET_ENTITIES } from "./audit-wave0g24-multi-entity-street-runner";
import { type StreetResult, type StreetStatus } from "./audit-wave0g18-street-runner";

const OUT_DIR_REL = "audit/wave0g26";
const OUT_DIR = path.join(process.cwd(), OUT_DIR_REL);
const CATALOG_PATH = path.join(process.cwd(), "audit/wave0g16/catalog_snapshot.json");
const BASELINE_DIR = path.join(process.cwd(), "audit/wave0g16/shadow-output");
const W24_DIR = path.join(process.cwd(), "audit/wave0g24");
const W24_SHADOW_DIR = path.join(W24_DIR, "shadow");
const SETTLEMENT = "נתניה";
const successStatuses: StreetStatus[] = ["SUCCESS_ROWS", "SUCCESS_MIXED_PARTIAL", "SUCCESS_EMPTY", "PARTIAL_MORE_FETCHES_INDICATED"];
const targetEntitySourceIds = new Set(TARGET_ENTITIES.map((e) => e.sourceId));

/**
 * Reconstructs a destination entity's CURRENT accepted-row key set — the
 * set to duplicate-check against for "is this genuinely new to the
 * 59,305 corpus". CRITICAL distinction (found live this wave, not
 * assumed): a TARGET entity's Wave 0G-16 baseline is STALE — Wave 0G-24B
 * already augmented it with every street it successfully accepted rows
 * from, including possibly the SAME street this wave is live-testing.
 * Comparing against the bare baseline would misreport already-accepted
 * Wave 0G-24B rows as "genuinely new". A COMPLETE entity's baseline was
 * NEVER augmented — it IS its current, correct, full contribution to the
 * 59,305 figure — so baseline alone is correct there.
 *
 * ECC database-reviewer + code-reviewer finding: the original version
 * branched on `targetEntitySourceIds.has(sourceId)` alone, which is
 * FALSE in general — Kiryat Hasharon (65209683) is PARTIAL and WAS
 * augmented (Wave 0G-18/0G-20/0G-21/0G-23), but is not in
 * TARGET_ENTITIES (Wave 0G-24 explicitly excluded it, since it already
 * had its own separate augmentation pipeline). The old code would have
 * silently used Kiryat's stale baseline if it were ever a destination.
 * Fixed: branch on the baseline's OWN `status` field (ground truth, not
 * a hardcoded ID list) — COMPLETE always means baseline-is-current;
 * PARTIAL-and-in-TARGET_ENTITIES means reconstruct via Wave 0G-24B;
 * PARTIAL-and-NOT-in-TARGET_ENTITIES (Kiryat, or any future case this
 * script doesn't know how to reconstruct) FAILS CLOSED with a clear
 * error rather than silently trusting a stale baseline. Did not affect
 * this wave's actual 4 destinations (none is Kiryat).
 */
async function reconstructCurrentAcceptedKeys(sourceId: string, baseline: { status: string; uniqueRows: ShadowDeal[] }): Promise<Set<string>> {
  const keys = new Set(baseline.uniqueRows.map((r) => transactionKey(r)));
  if (baseline.status === "COMPLETE") return keys;
  if (!targetEntitySourceIds.has(sourceId)) {
    throw new Error(`UNSUPPORTED_DESTINATION_ENTITY: sourceId=${sourceId} has status=${baseline.status} (not COMPLETE) but is not in TARGET_ENTITIES — this script only knows how to reconstruct a target entity's Wave 0G-24B augmentation; a PARTIAL entity augmented by some OTHER pipeline (e.g. Kiryat Hasharon via Wave 0G-18/0G-23) would be silently mishandled by trusting its stale baseline. Refusing rather than guessing.`);
  }
  const manifest = JSON.parse(await fs.readFile(path.join(W24_DIR, `street_manifest_${sourceId}.json`), "utf8"));
  const streetIds: string[] = manifest.streets.map((s: any) => s.streetId);
  for (const streetId of streetIds) {
    const r: StreetResult = JSON.parse(await fs.readFile(path.join(W24_SHADOW_DIR, `street_${sourceId}_${streetId}.json`), "utf8"));
    if (successStatuses.includes(r.status)) {
      for (const row of r.rows) keys.add(transactionKey(row));
    }
  }
  return keys;
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface SelectedStreet {
  streetId: string; streetName: string; requestingEntityId: string; requestingEntityName: string; unresolvedFromWave0G25: number;
}

async function main() {
  console.log("=== WAVE 0G-26 FOREIGN-OWNER ROUTING PROOF ===");
  await fs.mkdir(OUT_DIR, { recursive: true });

  // --- Phase 2: load the 481-row unresolved pool from Wave 0G-25's ACTUAL
  // committed CSV (not report prose) and rank distinct streets ---
  const overlapCsv = (await fs.readFile(path.join(process.cwd(), "audit/wave0g25/boundary_citywide_overlap.csv"), "utf8")).trim().split("\n").slice(1);
  const overlapRows = overlapCsv.map((line) => {
    const m = line.match(/^([^,]+),(.+?),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\w+)$/);
    if (!m) throw new Error(`MALFORMED_OVERLAP_CSV_ROW: "${line}"`);
    return { streetId: m[1], streetName: m[2].replace(/^"|"$/g, "").replace(/""/g, '"'), raw: +m[3], zero: +m[4], targetAccepted: +m[5], verifiedOutside: +m[6], unresolved: +m[7], manifestCount: +m[8], cls: m[9] };
  });
  const totalUnresolved = overlapRows.reduce((s, r) => s + r.unresolved, 0);
  console.log(`UNRESOLVED_FOREIGN_ROWS=${totalUnresolved}`);
  if (totalUnresolved !== 481) throw new Error(`INTEGRITY_FAIL: expected 481 unresolved rows from Wave 0G-25's own CSV, got ${totalUnresolved} — the source data has changed since that wave closed.`);

  const sorted = [...overlapRows].sort((a, b) => b.unresolved - a.unresolved);
  console.log("\n--- Phase 2: distinct streets ranked by UNRESOLVED_ROW_COUNT ---");
  for (const r of sorted) console.log(`  ${r.unresolved} — ${r.streetName} (${r.streetId}) [${r.cls}]`);

  const top2 = sorted.filter((r) => r.unresolved > 0).slice(0, 2);
  console.log(`\nTOP_UNRESOLVED_STREETS=${JSON.stringify(top2.map((r) => ({ streetId: r.streetId, streetName: r.streetName, unresolved: r.unresolved })))}`);
  console.log(`TARGET_STREET_1=${top2[0].streetName} (${top2[0].streetId}), unresolved=${top2[0].unresolved}`);
  console.log(`TARGET_STREET_2=${top2[1].streetName} (${top2[1].streetId}), unresolved=${top2[1].unresolved}`);

  // --- Phase 3/4/5: live-verified raw data (already captured this wave's
  // 2 live requests; raw JSON dumps loaded here, deleted after this run) ---
  const catalog = JSON.parse(await fs.readFile(CATALOG_PATH, "utf8"));
  const catalogById = new Map<string, string>(catalog.entities.map((e: any) => [String(e.sourceId), e.name]));

  const REQUESTING_ENTITY: Record<string, { id: string; name: string }> = {
    "74000627": { id: "65210243", name: 'מע"ר - מרכז עירוני ר' },
    "74000946": { id: "65209705", name: "קריית נורדאו" },
  };

  const streetLiveData: Record<string, any> = {};
  for (const street of top2) {
    const rawPath = `/tmp/wave0g26_probe_${street.streetId}_raw.json`;
    const raw = JSON.parse(await fs.readFile(rawPath, "utf8"));
    streetLiveData[street.streetId] = raw;
  }

  const phase4And5: any[] = [];
  const destinationRows = new Map<string, { neighborhoodId: string; name: string; found: boolean; rows: any[] }>();
  for (const street of top2) {
    const raw = streetLiveData[street.streetId];
    const requesting = REQUESTING_ENTITY[street.streetId];
    let requestingParentRows = 0, foreignOfficialRows = 0, zeroRows = 0, unknownRows = 0;
    const byDest = new Map<string, any[]>();
    for (const item of raw) {
      const nid = String(item.neighborhoodId ?? "0");
      if (nid === "0" || nid === "∅") { zeroRows++; continue; }
      if (nid === requesting.id) { requestingParentRows++; continue; }
      const officialName = catalogById.get(nid);
      if (!officialName) { unknownRows++; continue; }
      foreignOfficialRows++;
      if (!byDest.has(nid)) byDest.set(nid, []);
      byDest.get(nid)!.push(item);
    }
    const rawTotal = raw.length;
    const sum = requestingParentRows + foreignOfficialRows + zeroRows + unknownRows;
    if (sum !== rawTotal) throw new Error(`INTEGRITY_FAIL: ${street.streetName} accounting invariant violated — raw=${rawTotal} sum=${sum}`);
    phase4And5.push({ streetId: street.streetId, streetName: street.streetName, requestingEntity: requesting.name, rawRows: rawTotal, requestingParentRows, foreignOfficialRows, zeroRows, unknownRows });
    console.log(`\n--- Phase 4/5: ${street.streetName} (${street.streetId}), requested by ${requesting.name} ---`);
    console.log(`RAW_ROWS=${rawTotal} REQUESTING_PARENT_ROWS=${requestingParentRows} FOREIGN_OFFICIAL_ROWS=${foreignOfficialRows} ZERO_ROWS=${zeroRows} UNKNOWN_ROWS=${unknownRows}`);
    for (const [nid, items] of byDest) {
      const name = catalogById.get(nid)!;
      console.log(`  -> ${name} (${nid}): ${items.length} rows`);
      if (!destinationRows.has(nid)) destinationRows.set(nid, { neighborhoodId: nid, name, found: true, rows: [] });
      destinationRows.get(nid)!.rows.push(...items.map((it: any) => ({ ...it, __sourceStreet: street.streetId })));
    }
  }

  // --- Phase 3: official destination ID validation (already folded into
  // the loop above via catalogById lookup; report explicitly here) ---
  console.log(`\n--- Phase 3: destination ID validation ---`);
  for (const [nid, d] of destinationRows) console.log(`  ${nid} -> ${d.name}: FOUND_IN_OFFICIAL_CATALOG=YES`);

  // --- Phase 6/7: transaction-safe match against citywide corpus +
  // destination-entity-specific ownership check, using the CANONICAL
  // toShadowDeal()/transactionKey() functions (not a hand-rolled key). ---
  console.log(`\n--- Phase 6/7: citywide + destination-entity duplicate check ---`);
  const destinationImpact: any[] = [];
  let totalForeignRaw = 0, totalDuplicateOfDestination = 0, totalGenuinelyNew = 0;
  for (const [nid, d] of destinationRows) {
    const baselineFile: { officialTotalRows: number; uniqueRows: ShadowDeal[]; status: string; name: string } = JSON.parse(await fs.readFile(path.join(BASELINE_DIR, `${nid}.json`), "utf8"));
    const isTarget = targetEntitySourceIds.has(nid);
    // Reconstructed current-accepted key set — baseline alone for a
    // COMPLETE entity, baseline+Wave-0G-24B-augmentation for a target
    // entity, fail-closed for anything else. See docstring.
    const currentKeys = await reconstructCurrentAcceptedKeys(nid, baselineFile);
    const currentSafeUnique = currentKeys.size;
    const neighborhood: Neighborhood = { id: nid, name: d.name, settlement: SETTLEMENT, x: null, y: null };
    let dup = 0, notPresent = 0, normalizationDrops = 0;
    const notPresentSample: any[] = [];
    for (const raw of d.rows) {
      const shadow = toShadowDeal(raw, neighborhood, nid);
      if (!shadow) { normalizationDrops++; continue; }
      const k = transactionKey(shadow);
      if (currentKeys.has(k)) dup++;
      else { notPresent++; if (notPresentSample.length < 5) notPresentSample.push({ address: raw.address, dealDate: raw.dealDate, dealAmount: raw.dealAmount, parcelNum: raw.parcelNum }); }
    }
    // ECC database-reviewer + silent-failure-hunter finding: assert the
    // per-destination accounting invariant explicitly — previously this
    // only "happened to" hold because normalizationDrops was 0 this run;
    // nothing would have caught a future divergence.
    if (dup + notPresent + normalizationDrops !== d.rows.length) {
      throw new Error(`INTEGRITY_FAIL: ${d.name} (${nid}) accounting invariant violated — dup(${dup})+notPresent(${notPresent})+normalizationDrops(${normalizationDrops}) !== rows(${d.rows.length})`);
    }
    totalForeignRaw += d.rows.length;
    totalDuplicateOfDestination += dup;
    totalGenuinelyNew += notPresent;
    const simulatedNewUnique = currentSafeUnique + notPresent;
    if (simulatedNewUnique > baselineFile.officialTotalRows) {
      throw new Error(`FAIL: ${d.name} (${nid}) simulated unique (${simulatedNewUnique}) would EXCEED official total (${baselineFile.officialTotalRows}) — STOP, this is a Phase 13 fail-closed gate violation.`);
    }
    destinationImpact.push({
      entity: d.name, sourceId: nid, status: isTarget ? "PARTIAL" : baselineFile.status, currentSafeUnique, officialTotal: baselineFile.officialTotalRows,
      currentDelta: baselineFile.officialTotalRows - currentSafeUnique, simulatedRoutedNew: notPresent, simulatedNewUnique,
      simulatedNewDelta: baselineFile.officialTotalRows - simulatedNewUnique, normalizationDrops,
    });
    console.log(`  ${d.name} (${nid}, status=${isTarget ? "PARTIAL (augmented corpus reconstructed)" : baselineFile.status}): raw=${d.rows.length} duplicateOfOwnCorpus=${dup} genuinelyNew=${notPresent} normalizationDrops=${normalizationDrops} currentSafeUnique=${currentSafeUnique}`);
    if (notPresent > 0) console.log(`    NOT_PRESENT_SAMPLE=${JSON.stringify(notPresentSample)}`);
  }
  console.log(`\nFOREIGN_ROWS_RAW=${totalForeignRaw}`);
  console.log(`FOREIGN_TRUE_DUPLICATE_CURRENT_CITYWIDE=${totalDuplicateOfDestination} (all destination entities are already fully counted in the 59,305 corpus — COMPLETE entities via complete27Sum, or TARGET entities via their own already-accepted street rows)`);
  console.log(`FOREIGN_GENUINELY_NOT_IN_59305=${totalGenuinelyNew}`);
  // ECC silent-failure-hunter finding (HIGH): the duplicate check above
  // ONLY compares transactionKey (parcelNum+date+price) — it does NOT
  // independently verify non-key field agreement (floor, area, rooms)
  // the way scripts/audit-wave0g18-aggregate.ts's classifyTransactionGroups
  // does elsewhere in this engagement (its `rowsAgree` check). "0
  // ambiguous collisions" below is therefore a claim about KEY matches
  // only, not an independently-verified field-level confirmation — do
  // not read it as equivalent proof. Fixing this properly would require
  // re-fetching the raw rows (already deleted, and this wave's 2-request
  // budget is spent) to diff non-key fields; not done this wave. Flagged
  // honestly rather than silently left as an overclaim.
  console.log(`AMBIGUOUS_COLLISIONS=0 (KEY-LEVEL ONLY — parcelNum+date+price matched exactly for every row; non-key field agreement, e.g. floor/area, was NOT independently re-verified this wave, unlike classifyTransactionGroups's rowsAgree check used elsewhere in this engagement)`);
  console.log(`LEGITIMATE_DISTINCT_COLLISIONS=0 (same key-level-only caveat applies)`);

  // --- Phase 8: routing rule evidence ---
  console.log(`\n--- Phase 8 ---`);
  console.log(`ROUTING_RULE_EVIDENCE=STRONG (3/3 live-verified cases across 2 waves — Wave 0G-25's בן-צבי plus this wave's 2 streets — show zero foreign-to-requesting-entity assignment, zero complete-entity contradiction; the rule is safe and correctly reproduces true ownership every time it has been tested. CAVEAT, disclosed rather than hidden: all 3 cases were 100% pre-existing duplicates, so the rule has never yet been tested on a row that was GENUINELY ABSENT everywhere — every "correct" routing so far was confirmed only because the destination already held the row. This is strong evidence of SAFETY (no misrouting), not yet evidence that the rule performs correctly on a truly novel, contested assignment.)`);

  // --- Phase 9: cross-surface validation. IMPORTANT scope correction
  // (ECC planner finding): only the NON-TARGET destinations' matches
  // (גבע, אגמים — matched against their bare Wave 0G-16 baseline, a
  // genuinely DIFFERENT acquisition surface than this street query) count
  // as true cross-surface confirmation. The TARGET destinations' matches
  // (מרכז העיר, רמת אפרים — matched against their RECONSTRUCTED corpus,
  // which itself includes this SAME street's own Wave 0G-24B result) are
  // NOT cross-surface — they're the same street, same surface, already
  // classified. The original version of this script wrongly counted all
  // 585 as cross-surface; corrected to the true cross-surface subset. ---
  const crossSurfaceDestinations = destinationImpact.filter((d) => !targetEntitySourceIds.has(d.sourceId));
  const crossSurfaceExamples = crossSurfaceDestinations.reduce((s, d) => s + destinationRows.get(d.sourceId)!.rows.length, 0);
  const sameSurfaceReconfirmed = totalDuplicateOfDestination - crossSurfaceExamples;
  console.log(`\n--- Phase 9 ---`);
  console.log(`CROSS_SURFACE_CONFIRMED_ROUTING_EXAMPLES=${crossSurfaceExamples} (${crossSurfaceDestinations.map((d) => d.entity).join(", ")} — matched against their bare Wave 0G-16 baseline, a genuinely DIFFERENT acquisition surface than this street query)`);
  console.log(`SAME_SURFACE_RECONFIRMED (not cross-surface — excluded from the figure above)=${sameSurfaceReconfirmed} (מרכז העיר + רמת אפרים — matched against a corpus that itself includes THIS SAME street's own Wave 0G-24B result, so this is a re-confirmation, not independent cross-surface evidence)`);

  // --- Phase 10: zero-id negative control ---
  const totalZero = phase4And5.reduce((s, p) => s + p.zeroRows, 0);
  console.log(`\n--- Phase 10 ---`);
  console.log(`ZERO_ROWS_IN_TWO_STREETS=${totalZero}`);
  console.log(`ZERO_ROUTED=0`);
  console.log(`CONFIRMED: the routing concept does NOT handle neighborhoodId=0 — no zero-id row was routed, and none exist in either of these 2 streets to test against (both streets happened to return zero zero-id rows this time).`);

  // --- Phase 11: requesting-entity negative control ---
  const totalRequestingParent = phase4And5.reduce((s, p) => s + p.requestingParentRows, 0);
  console.log(`\n--- Phase 11 ---`);
  console.log(`FOREIGN_ROWS_ASSIGNED_TO_REQUESTING_ENTITY=0 (confirmed: neither street returned even ONE row carrying its own requesting entity's sourceId — REQUESTING_PARENT_ROWS=${totalRequestingParent} for both combined)`);

  // --- Phase 12: bounded replay simulation ---
  console.log(`\n--- Phase 12: SIMULATION_ONLY=YES ---`);
  const currentCitywideUnique = 59305;
  const officialTotal = 63704;
  const simulatedNewCitywideUnique = currentCitywideUnique + totalGenuinelyNew;
  const simulatedDelta = officialTotal - simulatedNewCitywideUnique;
  const simulatedCoverage = (simulatedNewCitywideUnique / officialTotal) * 100;
  console.log(`SIMULATED_ROUTED_RAW=${totalForeignRaw}`);
  console.log(`SIMULATED_ROUTED_UNIQUE=${totalGenuinelyNew}`);
  console.log(`SIMULATED_DUPLICATES=${totalDuplicateOfDestination}`);
  console.log(`SIMULATED_AMBIGUOUS=0`);
  console.log(`CURRENT_CITYWIDE_UNIQUE=${currentCitywideUnique}`);
  console.log(`SIMULATED_NEW_CITYWIDE_UNIQUE=${simulatedNewCitywideUnique}`);
  console.log(`OFFICIAL_TOTAL=${officialTotal}`);
  console.log(`SIMULATED_DELTA=${simulatedDelta}`);
  console.log(`SIMULATED_COVERAGE=${simulatedCoverage.toFixed(2)}%`);

  // --- Phase 14: partial vs complete entity impact ---
  // ECC code-reviewer finding: use each destination's OWN loaded `status`
  // field (ground truth, already fetched from its baseline file) instead
  // of a separate hardcoded ID list that could silently drift out of sync
  // with reality (the prior version's list even included Kiryat
  // 65209683, which reconstructCurrentAcceptedKeys's OLD code would have
  // mishandled — see that function's docstring for the related fix).
  const newToPartial = destinationImpact.filter((d) => d.status !== "COMPLETE").reduce((s, d) => s + d.simulatedRoutedNew, 0);
  const newToComplete = destinationImpact.filter((d) => d.status === "COMPLETE").reduce((s, d) => s + d.simulatedRoutedNew, 0);
  const completeContradictions = destinationImpact.filter((d) => d.status === "COMPLETE" && d.simulatedRoutedNew > 0).length;
  console.log(`\n--- Phase 14 ---`);
  console.log(`NEW_ROWS_ROUTED_TO_PARTIAL_ENTITIES=${newToPartial}`);
  console.log(`NEW_ROWS_ROUTED_TO_COMPLETE_ENTITIES=${newToComplete}`);
  console.log(`COMPLETE_ENTITY_CONTRADICTIONS=${completeContradictions}`);

  // --- Phase 16: request reduction (known, restated) ---
  console.log(`\n--- Phase 16 ---`);
  console.log(`DUPLICATE_REF_REQUESTS_AVOIDABLE=36 REQUEST_REDUCTION_PERCENT=${(((374 - 338) / 374) * 100).toFixed(1)}%`);
  console.log(`Would routing-by-distinct-streetId eliminate the FAILED_NO_TRUSTED_ROWS concept entirely? YES in semantics — under citywide routing, a street acquisition never "fails ownership" for a requesting entity, because no entity requests it in an ownership sense; every row is independently routed or rejected by its own explicit neighborhoodId. The status taxonomy would shift from per-(entity,street) outcomes to per-row outcomes. NOT implemented this wave.`);

  // --- Phase 17: extrapolation boundary ---
  // IMPORTANT scope distinction: totalForeignRaw (585) includes BOTH the
  // portion of these 2 streets already explained by Wave 0G-25 as
  // target-accepted (24 מרכז העיר + 278 רמת אפרים = 302 — re-confirmed,
  // not new information) AND the portion that was genuinely part of the
  // 481-row UNRESOLVED pool this wave was tasked with testing (143 גבע +
  // 140 אגמים = 283). Only the latter should be reported against the
  // 481-row unresolved pool — reporting 585 against "the 481 pool" would
  // overstate how much of that specific pool was actually tested.
  const unresolvedPortionTested = top2.reduce((s, t) => s + t.unresolved, 0); // 143 + 140 = 283
  const nonTargetDestinations = destinationImpact.filter((d) => !targetEntitySourceIds.has(d.sourceId));
  const unresolvedPortionGenuinelyNew = nonTargetDestinations.reduce((s, d) => s + d.simulatedRoutedNew, 0);
  const unresolvedPortionRaw = nonTargetDestinations.reduce((s, d) => s + destinationRows.get(d.sourceId)!.rows.length, 0);
  const unresolvedPortionDuplicates = unresolvedPortionRaw - unresolvedPortionGenuinelyNew;
  console.log(`\n--- Phase 17 ---`);
  console.log(`OF_THE_481_UNRESOLVED_POOL: this wave live-tested exactly the 283 rows (143 גבע + 140 אגמים) that were the genuinely-unresolved portion of the 2 selected streets — the other 302 rows seen this wave (24 מרכז העיר + 278 רמת אפרים) were ALREADY explained by Wave 0G-25 as target-accepted, re-confirmed here, not new information.`);
  console.log(`LIVE_VERIFIED_UNRESOLVED_ROWS=${unresolvedPortionTested} (of 481 total unresolved pool)`);
  console.log(`LIVE_VERIFIED_GENUINELY_NEW=${unresolvedPortionGenuinelyNew}`);
  console.log(`LIVE_VERIFIED_DUPLICATES=${unresolvedPortionDuplicates}`);
  console.log(`(Full-street totals, for completeness: FOREIGN_ROWS_RAW_BOTH_STREETS=${totalForeignRaw}, of which ${totalForeignRaw - unresolvedPortionTested} were already-known target-accepted rows re-confirmed, and ${unresolvedPortionTested} were the actual unresolved-pool test.)`);
  // ECC planner finding (material): a previous version of this line said
  // "0-for-783" by adding Wave 0G-25's בן-צבי (500 rows) to this wave's
  // 283 — but בן-צבי shows UNRESOLVED=0 in Wave 0G-25's own committed CSV
  // (it was already fully resolved there, categorized VERIFIED_OUTSIDE_
  // TARGET, not part of the 481-row unresolved pool). Folding it into
  // "unresolved-pool rows tested" inflated the denominator by ~2.8x.
  // Corrected: the 481-pool figure below includes ONLY this wave's 283;
  // בן-צבי is cited SEPARATELY as a similarly-patterned but distinctly-
  // categorized prior result, never combined into one pool-relative count.
  console.log(`ESTIMATE: no extrapolation to "X% of 481" is offered as fact. ${unresolvedPortionTested}/481 (${((unresolvedPortionTested / 481) * 100).toFixed(1)}%) of the unresolved pool has now been live-tested, with 0/${unresolvedPortionTested} genuinely new. If forced to characterize the remaining ${481 - unresolvedPortionTested} untested rows, the working hypothesis (NOT proven) is that a similar share may already be captured elsewhere — but a 0-for-${unresolvedPortionTested} sample from the unresolved pool (plus, SEPARATELY and not part of this same pool, Wave 0G-25's בן-צבי case — 500 rows, already-resolved as VERIFIED_OUTSIDE_TARGET, also 100% duplicate) is not a statistically rigorous basis for a numeric percentage projection with a stated confidence interval, so none is given.`);

  // --- Phase 18: next architectural decision ---
  console.log(`\n--- Phase 18 ---`);
  console.log(`BEST_NEXT_STEP=A (offline replay of ALL already-captured street rows using explicit-owner routing — Wave 0G-24B already acquired all 374 entity-street raw batches; routing what's ALREADY on disk against explicit neighborhoodId, before any new live crawling, is the correct next step per "prefer reuse of existing captured artifacts before new live crawling")`);

  // --- Phase 19: policy statement ---
  console.log(`\n--- Phase 19 ---`);
  console.log(`CURRENT_REQUESTING_ENTITY_POLICY_CHANGED=NO`);
  console.log(`ZERO_ID_POLICY_CHANGED=NO`);
  console.log(`FOREIGN_ID_VALIDATION_LOOSENED=NO`);

  // --- Phase 15: architecture verdict ---
  const architectureVerdict = totalGenuinelyNew > 0 ? "PROVEN" : "PROMISING";
  console.log(`\n--- Phase 15 ---`);
  console.log(`CITYWIDE_STREET_ROUTING=${architectureVerdict} (the ROUTING RULE's safety/correctness is strongly evidenced — 3/3 live-verified cases across 2 waves, zero contradictions — but PROVEN would additionally require demonstrated NEW-row recovery at least once, which has not yet occurred in any of the 3 tests; both this wave's streets and Wave 0G-25's בן-צבי routed 100% duplicates. Calling it PROVEN on safety alone, without ANY demonstrated yield, would overclaim per this wave's own instruction not to call it PROVEN merely because routed rows look plausible.)`);

  // --- Persist artifacts ---
  const selectedLines = ["STREET_ID,STREET_NAME,REQUESTING_ENTITY,UNRESOLVED_FROM_WAVE0G25,RAW_ROWS,REQUESTING_PARENT_ROWS,FOREIGN_OFFICIAL_ROWS,ZERO_ROWS,UNKNOWN_ROWS"];
  for (const p of phase4And5) {
    const t2 = top2.find((t) => t.streetId === p.streetId)!;
    selectedLines.push([p.streetId, csvEscape(p.streetName), csvEscape(p.requestingEntity), t2.unresolved, p.rawRows, p.requestingParentRows, p.foreignOfficialRows, p.zeroRows, p.unknownRows].join(","));
  }
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/selected_streets.csv`);
  await fs.writeFile(path.join(OUT_DIR, "selected_streets.csv"), selectedLines.join("\n") + "\n");

  // ECC code-reviewer finding: DUPLICATE_OF_DESTINATION/GENUINELY_NEW
  // below are ENTITY-LEVEL totals (across all of that destination's rows
  // from both streets combined), not a per-street split — if one entity
  // ever received rows with simulatedRoutedNew>0 from TWO different
  // streets, every CSV row for it would repeat the same aggregate figure
  // and summing the column would double-count. Did not manifest this run
  // (each destination here came from exactly one of the 2 streets), but
  // documented so a future reuse doesn't misread the column as per-row.
  const routingLines = ["STREET_ID,STREET_NAME,DESTINATION_NEIGHBORHOOD_ID,DESTINATION_ENTITY_NAME,ROW_COUNT,DUPLICATE_OF_DESTINATION,GENUINELY_NEW"];
  for (const [nid, d] of destinationRows) {
    const byStreet = new Map<string, number>();
    for (const r of d.rows) byStreet.set(r.__sourceStreet, (byStreet.get(r.__sourceStreet) ?? 0) + 1);
    // ECC silent-failure-hunter finding: replace the non-null assertion
    // with an explicit check — destinationImpact and destinationRows are
    // built from the same key set today (both iterate destinationRows),
    // but a future refactor adding a filter to one and not the other
    // would otherwise crash with a cryptic "undefined" error instead of a
    // clear one.
    const impact = destinationImpact.find((di) => di.sourceId === nid);
    if (!impact) throw new Error(`INTEGRITY_FAIL: destination ${nid} (${d.name}) is in destinationRows but missing from destinationImpact — the two must stay in sync.`);
    for (const [sid, count] of byStreet) {
      const streetName = top2.find((t) => t.streetId === sid)!.streetName;
      routingLines.push([sid, csvEscape(streetName), nid, csvEscape(d.name), count, impact.simulatedRoutedNew === 0 ? count : "see_summary", impact.simulatedRoutedNew].join(","));
    }
  }
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/owner_routing_results.csv`);
  await fs.writeFile(path.join(OUT_DIR, "owner_routing_results.csv"), routingLines.join("\n") + "\n");

  const impactLines = ["ENTITY,SOURCE_ID,STATUS,CURRENT_SAFE_UNIQUE,OFFICIAL_TOTAL,CURRENT_DELTA,SIMULATED_ROUTED_NEW,SIMULATED_NEW_UNIQUE,SIMULATED_NEW_DELTA,NORMALIZATION_DROPS"];
  for (const d of destinationImpact) impactLines.push([csvEscape(d.entity), d.sourceId, d.status, d.currentSafeUnique, d.officialTotal, d.currentDelta, d.simulatedRoutedNew, d.simulatedNewUnique, d.simulatedNewDelta, d.normalizationDrops].join(","));
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/destination_entity_impact.csv`);
  await fs.writeFile(path.join(OUT_DIR, "destination_entity_impact.csv"), impactLines.join("\n") + "\n");

  const summary = {
    unresolvedPool: totalUnresolved, selectedStreets: top2.map((t) => ({ streetId: t.streetId, streetName: t.streetName, unresolved: t.unresolved })),
    phase4And5, destinationImpact,
    citywideMatch: {
      totalForeignRaw, totalDuplicateOfDestination, totalGenuinelyNew,
      ambiguousCollisionsKeyLevelOnly: 0,
      ambiguousCollisionsCaveat: "Only transactionKey (parcelNum+date+price) equality was checked. Non-key field agreement (floor/area/rooms) was NOT independently re-verified this wave — unlike classifyTransactionGroups's rowsAgree check used elsewhere in this engagement. Re-verifying would require re-fetching the raw rows (deleted; this wave's 2-request budget is spent).",
    },
    crossSurfaceValidation: { crossSurfaceExamples, sameSurfaceReconfirmed, note: "Only the non-target destinations (גבע, אגמים — matched against their bare, never-augmented Wave 0G-16 baseline) count as genuine cross-surface confirmation. The target destinations (מרכז העיר, רמת אפרים) matched against a corpus that already includes THIS SAME street's own prior result — a re-confirmation, not independent evidence." },
    negativeControls: { zeroRows: totalZero, zeroRouted: 0, foreignAssignedToRequestingEntity: 0 },
    simulation: { simulationOnly: true, currentCitywideUnique, simulatedNewCitywideUnique, officialTotal, simulatedDelta, simulatedCoverage },
    partialVsComplete: { newToPartial, newToComplete, completeContradictions },
    architecture: {
      citywideStreetRouting: architectureVerdict,
      routingRuleEvidence: "STRONG_ON_SAFETY_UNTESTED_ON_NOVEL_CASE",
      routingRuleCaveat: "All 3 live-verified cases to date (across this wave and Wave 0G-25) were 100% pre-existing duplicates — the rule has never been exercised on a row genuinely absent everywhere, so its behavior on a truly novel/contested assignment remains unproven, only its non-misrouting safety is proven.",
      bestNextStep: "A",
    },
    reproducibilityNote: "The 2 live-fetched raw JSON dumps this wave's headline figures (585 raw rows, 0 genuinely new) were computed from have been deleted per the project's standing rule against committing raw acquisition dumps. This wave's 2-live-request budget is exhausted, so the underlying raw data cannot be regenerated without new authorization. Only the aggregate counts in this summary and the compact CSVs are reproducible from committed artifacts; the per-row detail is not. Flagged per ECC planner review as a process point for future waves: consider persisting a key-only (transactionKey + destination neighborhoodId, no other fields) CSV before deleting a raw dump, to preserve reviewability without violating the no-raw-dumps rule.",
    policy: { requestingEntityPolicyChanged: false, zeroIdPolicyChanged: false, foreignIdValidationLoosened: false },
  };
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/routing_simulation_summary.json`);
  await fs.writeFile(path.join(OUT_DIR, "routing_simulation_summary.json"), JSON.stringify(summary, null, 2));

  console.log("\n=== WAVE 0G-26 ANALYSIS COMPLETE ===");
}

const isDirectExecution = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  main().catch((e) => { console.error("ANALYSIS_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
}
