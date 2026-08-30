/**
 * scripts/audit-wave0g25-boundary-analysis.ts — Wave 0G-25: offline
 * reconciliation of the 12 FAILED_NO_TRUSTED_ROWS entity-street references
 * from Wave 0G-24B. Read-only: consumes only already-committed/already-
 * persisted Wave 0G-24/0G-24B artifacts (the 10 street manifests, the 374
 * per-(entity,street) result files, the Wave 0G-16 citywide summary, and
 * each of the 10 target entities' Wave 0G-16 baseline). Makes ZERO network
 * requests.
 *
 * Usage: npx tsx scripts/audit-wave0g25-boundary-analysis.ts
 */
import { promises as fs } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { transactionKey, assertSafeShadowOutputPath, type ShadowDeal } from "../lib/shadowRebuild";
import { type StreetStatus, type StreetResult } from "./audit-wave0g18-street-runner";
import { TARGET_ENTITIES, RUN_CONTRACT_VERSION } from "./audit-wave0g24-multi-entity-street-runner";

const OUT_DIR_REL = "audit/wave0g25";
const OUT_DIR = path.join(process.cwd(), OUT_DIR_REL);
const W24_DIR = path.join(process.cwd(), "audit/wave0g24");
const SHADOW_DIR = path.join(W24_DIR, "shadow");
const BASELINE_DIR = path.join(process.cwd(), "audit/wave0g16/shadow-output");
const CITYWIDE_SUMMARY_PATH = path.join(process.cwd(), "audit/wave0g16/citywide_summary.json");

const successStatuses: StreetStatus[] = ["SUCCESS_ROWS", "SUCCESS_MIXED_PARTIAL", "SUCCESS_EMPTY", "PARTIAL_MORE_FETCHES_INDICATED"];

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  console.log("=== WAVE 0G-25 BOUNDARY-STREET IDENTITY RECONCILIATION (offline) ===");
  await fs.mkdir(OUT_DIR, { recursive: true });

  // --- Load the 10 committed manifests: streetId -> Set(entitySourceId) ---
  const manifestByEntity = new Map<string, Set<string>>(); // entitySourceId -> Set(streetId)
  const streetToManifestEntities = new Map<string, Set<string>>(); // streetId -> Set(entitySourceId)
  for (const entity of TARGET_ENTITIES) {
    const manifest = JSON.parse(await fs.readFile(path.join(W24_DIR, `street_manifest_${entity.sourceId}.json`), "utf8"));
    const streetIds: string[] = manifest.streets.map((s: any) => s.streetId);
    manifestByEntity.set(entity.sourceId, new Set(streetIds));
    for (const sid of streetIds) {
      if (!streetToManifestEntities.has(sid)) streetToManifestEntities.set(sid, new Set());
      streetToManifestEntities.get(sid)!.add(entity.sourceId);
    }
  }
  const nameBySourceId = new Map(TARGET_ENTITIES.map((e) => [e.sourceId, e.name]));

  // --- Load ALL 374 result files ---
  // ECC database-reviewer finding: validate each file's own
  // runContractVersion/parentSourceId/streetId against what its filename
  // implies before trusting it — a stale/mismatched file (e.g. left over
  // from an interrupted earlier run) would otherwise silently corrupt this
  // entire analysis. Mirrors Wave 0G-24B's own loadResult() validation.
  const allResults: StreetResult[] = [];
  const resultsByStreetId = new Map<string, StreetResult[]>();
  for (const entity of TARGET_ENTITIES) {
    const streetIds = [...manifestByEntity.get(entity.sourceId)!];
    for (const streetId of streetIds) {
      const p = path.join(SHADOW_DIR, `street_${entity.sourceId}_${streetId}.json`);
      const r: StreetResult = JSON.parse(await fs.readFile(p, "utf8"));
      if (r.runContractVersion !== RUN_CONTRACT_VERSION || r.parentSourceId !== entity.sourceId || r.streetId !== streetId) {
        throw new Error(`CONTRACT_MISMATCH: expected sourceId=${entity.sourceId} streetId=${streetId} version=${RUN_CONTRACT_VERSION}, got parentSourceId=${r.parentSourceId} streetId=${r.streetId} version=${r.runContractVersion} (file: ${p})`);
      }
      allResults.push(r);
      if (!resultsByStreetId.has(streetId)) resultsByStreetId.set(streetId, []);
      resultsByStreetId.get(streetId)!.push(r);
    }
  }
  console.log(`LOADED_RESULTS=${allResults.length} (expected 374)`);

  const failedResults = allResults.filter((r) => !successStatuses.includes(r.status));
  console.log(`FAILED_REF_COUNT=${failedResults.length}`);
  if (failedResults.length !== 12) {
    console.log(`WARNING: expected 12 failed refs, found ${failedResults.length}`);
  }

  // --- Phase 2: enumerate the 12 failures exactly ---
  const phase2Rows = failedResults.map((r) => {
    const rac = r.rowAcceptanceCounts;
    return {
      entity: r.parentSourceId, entityName: nameBySourceId.get(r.parentSourceId) ?? r.parentSourceId,
      streetName: r.streetName, streetId: r.streetId,
      rawRows: rac?.rawRows ?? 0, parentRows: rac?.acceptedParent ?? 0, zeroRows: rac?.rejectedZero ?? 0,
      foreignRows: rac?.rejectedForeign ?? 0, otherRows: (rac?.rejectedMissing ?? 0) + (rac?.rejectedMalformed ?? 0),
      totalRowsIfKnown: r.totalRowsIfExposed, totalFetchIfKnown: r.totalFetchIfExposed,
    };
  });
  console.log("\n--- Phase 2: the 12 failures ---");
  for (const r of failedResults) {
    // ECC silent-failure-hunter finding: a missing/malformed
    // rowAcceptanceCounts must not be silently treated as "verified zero"
    // via the `?? 0` fallback used for display below — check the raw field
    // itself first, so a genuinely corrupted result file is a loud failure,
    // not a false confirmation.
    if (r.rowAcceptanceCounts == null) {
      throw new Error(`MISSING_ROW_ACCEPTANCE_COUNTS: ${nameBySourceId.get(r.parentSourceId)}/${r.streetName} has status=${r.status} but no rowAcceptanceCounts at all — cannot verify PARENT_ROWS=0, this is unreadable data, not a confirmed zero. STOP.`);
    }
  }
  for (const p of phase2Rows) {
    console.log(`${p.entityName} (${p.entity}) / ${p.streetName} (${p.streetId}): raw=${p.rawRows} parent=${p.parentRows} zero=${p.zeroRows} foreign=${p.foreignRows} other=${p.otherRows} totalRows=${p.totalRowsIfKnown} totalFetch=${p.totalFetchIfKnown}`);
    if (p.parentRows !== 0) throw new Error(`ACCOUNTING_DEFECT: ${p.entityName}/${p.streetName} has PARENT_ROWS=${p.parentRows} but status is not a success status — prior classification is wrong. STOP.`);
  }

  // --- Phase 3: distinct street count + manifest membership ---
  const distinctFailedStreetIds = [...new Set(failedResults.map((r) => r.streetId))];
  console.log(`\n--- Phase 3: distinct streets ---`);
  console.log(`FAILED_ENTITY_STREET_REFS=${failedResults.length}`);
  console.log(`DISTINCT_FAILED_STREET_IDS=${distinctFailedStreetIds.length}`);
  console.log(`DISTINCT_FAILED_STREET_NAMES=${new Set(failedResults.map((r) => r.streetName)).size}`);

  const phase3: any[] = [];
  for (const sid of distinctFailedStreetIds) {
    const manifestEntities = [...(streetToManifestEntities.get(sid) ?? new Set())];
    const streetName = failedResults.find((r) => r.streetId === sid)!.streetName;
    phase3.push({ streetId: sid, streetName, manifestEntityIds: manifestEntities, manifestEntityNames: manifestEntities.map((id) => nameBySourceId.get(id)) });
    console.log(`  ${streetName} (${sid}): listed by [${manifestEntities.map((id) => nameBySourceId.get(id)).join(", ")}]`);
  }
  const sharedCount = phase3.filter((p) => p.manifestEntityIds.length > 1).length;
  console.log(`HOW_MANY_FAILED_STREETS_SHARED_BY_MULTIPLE_TARGET_MANIFESTS=${sharedCount}/${distinctFailedStreetIds.length}`);

  // --- Phase 4 + 6: for each failed streetId, does ANY target entity (among
  // the 10) have accepted (acceptedParent>0) rows on that SAME streetId? ---
  console.log(`\n--- Phase 4/6: dominant-entity analysis (within the 10-target universe) ---`);
  const phase6: any[] = [];
  for (const sid of distinctFailedStreetIds) {
    const allRefsForStreet = resultsByStreetId.get(sid) ?? [];
    const streetName = allRefsForStreet[0]?.streetName ?? "?";
    // Every entity that references this streetId (whether failed or not)
    const entityBreakdown = allRefsForStreet.map((r) => ({
      entity: r.parentSourceId, entityName: nameBySourceId.get(r.parentSourceId),
      status: r.status, acceptedParent: r.rowAcceptanceCounts?.acceptedParent ?? 0,
      rawRows: r.rowAcceptanceCounts?.rawRows ?? 0,
    }));
    const withOwnership = entityBreakdown.filter((e) => e.acceptedParent > 0).sort((a, b) => b.acceptedParent - a.acceptedParent);
    const dominantOwner = withOwnership[0] ?? null;
    const runnerUp = withOwnership[1] ?? null;
    // ECC silent-failure-hunter finding: "dominant" is misleading language
    // when the margin over the runner-up is thin (e.g. 51.4% vs 48.6%) or
    // an exact tie — flag it explicitly rather than presenting every case
    // with the same confident tone as a 91.6% landslide.
    const isExactTie = dominantOwner != null && runnerUp != null && dominantOwner.acceptedParent === runnerUp.acceptedParent;
    const isNearTie = !isExactTie && dominantOwner != null && runnerUp != null && (dominantOwner.acceptedParent - runnerUp.acceptedParent) / (dominantOwner.acceptedParent + runnerUp.acceptedParent) < 0.2;
    const failedRefsForThisStreet = failedResults.filter((r) => r.streetId === sid);
    for (const failedRef of failedRefsForThisStreet) {
      const requestedEntityName = nameBySourceId.get(failedRef.parentSourceId);
      const rawTotal = failedRef.rowAcceptanceCounts?.rawRows ?? 0;
      const dominantShare = dominantOwner && rawTotal > 0 ? (dominantOwner.acceptedParent / rawTotal) * 100 : null;
      const dominantAlsoListsStreet = dominantOwner ? (streetToManifestEntities.get(sid)?.has(dominantOwner.entity) ?? false) : null;
      phase6.push({
        streetId: sid, streetName,
        requestedEntity: requestedEntityName, requestedEntitySourceId: failedRef.parentSourceId,
        dominantReturnedEntity: dominantOwner?.entityName ?? "UNKNOWN_OUTSIDE_10_TARGETS",
        dominantShare: dominantShare != null ? dominantShare.toFixed(1) + "%" : "N/A",
        allReturnedEntities: entityBreakdown.map((e) => `${e.entityName}:${e.status}:accepted=${e.acceptedParent}`).join(" | "),
        dominantAlsoListsStreet: dominantAlsoListsStreet === null ? "N/A" : (dominantAlsoListsStreet ? "YES" : "NO"),
        resolvedOffline: dominantOwner != null,
        isExactTie, isNearTie,
      });
      console.log(`  ${requestedEntityName} / ${streetName}: dominant=${dominantOwner?.entityName ?? "UNKNOWN (outside our 10 targets)"} share=${dominantShare != null ? dominantShare.toFixed(1) + "%" : "N/A"} alsoListsStreet=${dominantAlsoListsStreet === null ? "N/A" : dominantAlsoListsStreet}${isExactTie ? " [EXACT TIE with runner-up]" : isNearTie ? " [NEAR-TIE with runner-up]" : ""}`);
    }
  }

  const resolvedOfflineCount = phase6.filter((p) => p.resolvedOffline).length;
  const unresolvedOffline = phase6.filter((p) => !p.resolvedOffline);
  console.log(`\nRESOLVED_OFFLINE_VIA_TARGET_MANIFEST=${resolvedOfflineCount}/${phase6.length}`);
  console.log(`UNRESOLVED_WITHIN_10_TARGET_UNIVERSE=${unresolvedOffline.length}/${phase6.length}`);
  for (const u of unresolvedOffline) console.log(`  UNRESOLVED: ${u.requestedEntity} / ${u.streetName} (${u.streetId}) — no target entity claims ownership; true owner is outside the 10-entity universe (a COMPLETE entity, Kiryat, or genuinely uncatalogued)`);

  // --- Phase 9: transaction-safe dedup against the 59,305 citywide union ---
  // Rebuild the citywide accepted-row union from the same sources Wave
  // 0G-24B used: 10 target entities' augmented unions (recomputed the same
  // way) + Kiryat's retained final union (not re-derivable offline without
  // its own raw rows, so we approximate via key-membership using its
  // committed baseline+street layer where available) — for THIS wave's
  // purpose (checking whether a REJECTED row's transaction key already
  // exists somewhere accepted), we build the union from the 10 target
  // entities' ACCEPTED rows (baseline ∪ all successful street rows), which
  // is the part of the 59,305 union we can independently reconstruct here.
  const acceptedUnionKeys = new Set<string>();
  for (const entity of TARGET_ENTITIES) {
    const baseline: { uniqueRows: ShadowDeal[] } = JSON.parse(await fs.readFile(path.join(BASELINE_DIR, `${entity.sourceId}.json`), "utf8"));
    for (const row of baseline.uniqueRows) acceptedUnionKeys.add(transactionKey(row));
    const entityResults = resultsByStreetId;
    for (const [, refs] of entityResults) {
      for (const r of refs) {
        if (r.parentSourceId === entity.sourceId && successStatuses.includes(r.status)) {
          for (const row of r.rows) acceptedUnionKeys.add(transactionKey(row));
        }
      }
    }
  }
  console.log(`\nACCEPTED_UNION_KEYS_RECONSTRUCTED (10 target entities only, excludes Kiryat/27-complete)=${acceptedUnionKeys.size}`);

  // Since rejected (zero/foreign) raw rows were never persisted per-row by
  // the runner (only aggregate counts), we cannot compute per-row
  // transaction keys for the 12 failed refs' rejected rows offline — this
  // is the one genuine gap Phase 9 hits. Documented, not fabricated.
  console.log(`NOTE: Phase 9's per-row duplicate-check against the rejected rows themselves is NOT computable offline — the runner persists only accepted rows (r.rows) and aggregate rowAcceptanceCounts, never the raw rejected items. This is disclosed, not worked around.`);

  // --- Phase 7: same streetId across requesting entities — direct proof
  // from already-captured data that a direct streetId acquisition returns
  // the SAME raw batch regardless of which parent entity's manifest led to
  // it (zero/raw counts must be IDENTICAL across every referencing entity
  // for a given streetId; only acceptedParent/foreign shift per entity).
  // ECC database-reviewer finding: this MUST run — and hard-assert, not
  // just log — BEFORE Phase 6's streetBreakdown trusts refs[0]'s raw/zero
  // as representative of the whole street. Moved earlier and upgraded from
  // a diagnostic log to a throwing invariant for exactly that reason.
  console.log(`\n--- Phase 7: same streetId, different requesting entities (identity-stability check) ---`);
  for (const sid of distinctFailedStreetIds) {
    const refs = resultsByStreetId.get(sid) ?? [];
    if (refs.length < 2) continue;
    const raws = new Set(refs.map((r) => r.rowAcceptanceCounts?.rawRows ?? -1));
    const zeros = new Set(refs.map((r) => r.rowAcceptanceCounts?.rejectedZero ?? -1));
    console.log(`  ${refs[0].streetName} (${sid}): ${refs.length} requesting entities, RAW identical=${raws.size === 1} (${[...raws]}), ZERO identical=${zeros.size === 1} (${[...zeros]}) -> streetId is a stable, entity-independent acquisition key`);
    if (raws.size !== 1 || zeros.size !== 1) {
      throw new Error(`INTEGRITY_FAIL: streetId=${sid} (${refs[0].streetName}) shows DIVERGENT raw/zero counts across its ${refs.length} referencing entities (raw=${[...raws]}, zero=${[...zeros]}) — the assumption that a shared streetId's physical fetch is identical for every entity (relied on by Phase 6's streetBreakdown) does not hold here. STOP and investigate before trusting any downstream figure for this street.`);
    }
  }

  // --- Phase 6 (full breakdown, all 9 distinct streets): raw = zero +
  // sum(all target-entity accepted shares) + unexplained remainder. This
  // makes explicit, for every street, exactly how much of its raw batch is
  // accounted for by our own 10-entity universe vs genuinely outside it.
  // Safe to use refs[0]'s raw/zero as representative of the whole street
  // ONLY because Phase 7 (above) just asserted they're identical across
  // every referencing entity.
  console.log(`\n--- Phase 6 full breakdown (raw = zero + target-accepted + unexplained) ---`);
  const streetBreakdown: any[] = [];
  for (const sid of distinctFailedStreetIds) {
    const refs = resultsByStreetId.get(sid) ?? [];
    const streetName = refs[0]?.streetName ?? "?";
    const raw = refs[0]?.rowAcceptanceCounts?.rawRows ?? 0;
    const zero = refs[0]?.rowAcceptanceCounts?.rejectedZero ?? 0;
    const targetAccepted = refs.filter((r) => (r.rowAcceptanceCounts?.acceptedParent ?? 0) > 0)
      .map((r) => ({ entity: nameBySourceId.get(r.parentSourceId), accepted: r.rowAcceptanceCounts!.acceptedParent }));
    const sumTargetAccepted = targetAccepted.reduce((s, t) => s + t.accepted, 0);
    const unexplained = raw - zero - sumTargetAccepted;
    streetBreakdown.push({ streetId: sid, streetName, raw, zero, targetAccepted, sumTargetAccepted, unexplained });
    console.log(`  ${streetName} (${sid}): raw=${raw} zero=${zero} targetAccepted=[${targetAccepted.map((t) => `${t.entity}:${t.accepted}`).join(",")}]=${sumTargetAccepted} unexplained(outside 10-target universe)=${unexplained}`);
  }

  // --- Phase 8: street request contract recheck ---
  console.log(`\n--- Phase 8 ---`);
  console.log(`STREET_QUERY_SCOPED_BY=STREET_ONLY (URL: https://www.nadlan.gov.il/?view=street&id={streetId}&page=deals — no parent-entity parameter anywhere in the request; confirmed by lib/nadlanAcquisition.ts's decodeRequestEnvelope, which reports base_name="streetCode"/base_id=streetId only, and independently reconfirmed live this wave via the בן-צבי probe)`);

  // --- Phase 9-13: בן-צבי (74000609) — EMPIRICALLY VERIFIED this wave via
  // 2 live diagnostic requests (read-only; not merged into any union; no
  // acceptance policy touched). All other 8 distinct failed streets are
  // NOT empirically verified at the raw-row level — the runner never
  // persisted rejected rows' bodies, only aggregate counts, and this
  // wave's live-request budget (max 2, both spent on בן-צבי, the highest-
  // volume and explicitly wave-prioritized מע"ר case) was intentionally
  // not spent elsewhere. Reported as UNRESOLVED for those, with the
  // בן-צבי finding offered only as informative context, never generalized.
  const benTsviVerified = {
    streetId: "74000609", streetName: "בן-צבי", requestedBy: "מע\"ר - מרכז עירוני ר",
    rawRows: 500,
    neighborhoodIdDistribution: [
      { neighborhoodId: "65209688", name: "רמת יגאל ידין - דורה", rows: 52, entityStatus: "COMPLETE (Wave 0G-16)" },
      { neighborhoodId: "65210192", name: "נאות שקד", rows: 158, entityStatus: "COMPLETE (Wave 0G-16)" },
      { neighborhoodId: "65210194", name: "נווה אוז", rows: 13, entityStatus: "COMPLETE (Wave 0G-16)" },
      { neighborhoodId: "65210238", name: "אגמים", rows: 258, entityStatus: "COMPLETE (Wave 0G-16)" },
      { neighborhoodId: "65210242", name: "רמת חן", rows: 19, entityStatus: "COMPLETE (Wave 0G-16)" },
    ],
    duplicateOfAcceptedCitywide: 500, notPresentInAcceptedCitywide: 0,
    // ECC database-reviewer finding: this used a hand-rolled key
    // (parcelNum|hasDate-flag|dealAmount, applied identically to both the
    // raw probe items and the committed ShadowDeal rows) — consistent with
    // the same 3 fields as lib/shadowRebuild.ts's canonical transactionKey()
    // (parcelNum|hasDate:date|price), but not a literal call to that
    // shared function (the ad-hoc verification script has since been
    // deleted, per the standing rule against committing temporary probes).
    // The comparison is still valid because the SAME derivation was
    // applied uniformly to both sides — raw items use the field name
    // `dealAmount`, committed ShadowDeal rows use the normalized field
    // name `price`, and both refer to the same deal amount.
    verificationMethod: "hand-rolled key (parcelNum|hasDate-flag|dealAmount≡price), applied identically to both sides, consistent with but not literally lib/shadowRebuild.ts's transactionKey()",
    conclusion: "100% of this street's 500 raw rows are pre-existing, already-captured, already-COMPLETE transactions under 5 DIFFERENT official entities, none of which is מע\"ר. Zero rows are missing citywide; zero recovery opportunity for מע\"ר from this street specifically.",
  };
  console.log(`\n--- Phase 9-13: בן-צבי live-verified finding ---`);
  console.log(JSON.stringify(benTsviVerified, null, 2));

  // --- Phase 17: request economics (already known from Wave 0G-24B) ---
  console.log(`\n--- Phase 17 ---`);
  console.log(`DUPLICATE_STREET_REFS=36 (374 refs - 338 distinct)`);
  console.log(`CURRENT_REF_COUNT=374 DISTINCT_STREET_COUNT=338 REQUEST_REDUCTION=${(374 - 338)} refs (${(((374 - 338) / 374) * 100).toFixed(1)}%) — already realized in Wave 0G-24B's runner design (streetId-dedup), not a new proposal`);

  // --- Phase 18: residual gap impact ---
  // IMPORTANT scope distinction (the same accounting-scope pitfall Wave
  // 0G-24B's ECC review caught): summing rawRows over the 12 entity-street
  // REFERENCES double/quadruple-counts a street that failed for multiple
  // requesting entities (בן-גוריון failed for 4 entities on the SAME 240
  // raw rows — summing per-ref counts it 4x = 960, not 240). The physically
  // correct basis for gap arithmetic is the 9 DISTINCT streets' raw rows.
  const boundaryFailedRefRawRowsPerRef = phase2Rows.reduce((s, p) => s + p.rawRows, 0);
  const boundaryFailedRawRowsPerDistinctStreet = streetBreakdown.reduce((s, b) => s + b.raw, 0);
  const totalZero = streetBreakdown.reduce((s, b) => s + b.zero, 0);
  const totalTargetAccepted = streetBreakdown.reduce((s, b) => s + b.sumTargetAccepted, 0);
  const verifiedAlreadyCaptured = 500; // בן-צבי only, live-verified
  const genuinelyUnresolved = boundaryFailedRawRowsPerDistinctStreet - totalZero - totalTargetAccepted - verifiedAlreadyCaptured;
  console.log(`\n--- Phase 18 ---`);
  console.log(`BOUNDARY_FAILED_REF_ROWS (per entity-street REFERENCE, over-counts shared streets)=${boundaryFailedRefRawRowsPerRef}`);
  console.log(`BOUNDARY_FAILED_ROWS (per DISTINCT street — the correct physical basis)=${boundaryFailedRawRowsPerDistinctStreet}`);
  console.log(`OF_WHICH_ZERO_ID=${totalZero}`);
  console.log(`OF_WHICH_ALREADY_CAPTURED_UNDER_CORRECT_TARGET_ENTITY=${totalTargetAccepted} (already counted in the 29,050/59,305 union under the entity that actually owns them — not missing, not a gap)`);
  console.log(`OF_WHICH_VERIFIED_ALREADY_CAPTURED_OUTSIDE_TARGET_UNIVERSE=${verifiedAlreadyCaptured} (בן-צבי only, live-verified — already captured under 5 already-COMPLETE entities, none a target)`);
  console.log(`OF_WHICH_GENUINELY_UNRESOLVED=${genuinelyUnresolved} (הלילך 70 + שלום עליכם 140 + the un-owned remainders of בן-גוריון/בן-אב"י/הרצל/פתח תקווה — NOT live-verified this wave; pattern from בן-צבי suggests likely also already-captured elsewhere, but this is NOT proven)`);
  console.log(`PROVEN_RECOVERABLE_WITHOUT_POLICY_LOOSENING=0 (no evidence supports adding ANY row to ANY of the 10 target entities beyond what per-row identity already accepted)`);

  // --- Phase 12: per-entity impact table ---
  const entityImpact: any[] = [];
  for (const entity of TARGET_ENTITIES) {
    const fromShared = streetBreakdown.flatMap((b) => b.targetAccepted.filter((t: any) => t.entity === entity.name).map((t: any) => t.accepted));
    const total = fromShared.reduce((s: number, v: number) => s + v, 0);
    entityImpact.push({ entity: entity.name, sourceId: entity.sourceId, foreignRowsFromFailedRefsBelongingToThisEntity: total, ofWhichAlreadyPresent: total, ofWhichNotPresent: 0 });
  }
  console.log(`\n--- Phase 12: per-entity impact (rows from shared boundary streets that explicitly belong to this entity) ---`);
  for (const e of entityImpact) console.log(`  ${e.entity}: ${e.foreignRowsFromFailedRefsBelongingToThisEntity} rows (all already present in its own Wave 0G-24B augmented total — zero new/unmerged)`);

  // ECC database-reviewer finding: self-check that Phase 12's per-entity
  // sum agrees with Phase 18's totalTargetAccepted — both are derived from
  // the same streetBreakdown array today, so a future refactor that
  // desyncs them would otherwise go undetected.
  const entityImpactSum = entityImpact.reduce((s, e) => s + e.foreignRowsFromFailedRefsBelongingToThisEntity, 0);
  const totalTargetAcceptedCheck = streetBreakdown.reduce((s, b) => s + b.sumTargetAccepted, 0);
  if (entityImpactSum !== totalTargetAcceptedCheck) {
    throw new Error(`INTEGRITY_FAIL: Phase 12's per-entity impact sum (${entityImpactSum}) diverged from Phase 18's totalTargetAccepted (${totalTargetAcceptedCheck}) — two independent views of the same figure must agree.`);
  }

  // --- Phase 13: מע"ר focus ---
  const maarRefs = phase2Rows.filter((p) => p.entity === "65210243");
  const maarRawSum = maarRefs.reduce((s, p) => s + p.rawRows, 0);
  console.log(`\n--- Phase 13: מע"ר focus ---`);
  console.log(`REQUESTED_MAAR_FAILED_REFS=${maarRefs.length}`);
  console.log(`RAW_ROWS=${maarRawSum}`);
  console.log(`MAAR_DELTA=814 (from Wave 0G-24B entity_outcomes.csv)`);
  console.log(`FAILED_REF_ROWS_PLAUSIBLY_RELEVANT_TO_MAAR=0 (structurally guaranteed: FAILED_NO_TRUSTED_ROWS means PARENT_ROWS=0 for מע"ר on every one of these 4 streets by definition — a row could only be "relevant" to מע"ר if it carried מע"ר's own sourceId, which would have made it ACCEPT_PARENT, not rejected)`);
  console.log(`PROVEN_MAAR_RECOVERY_OPPORTUNITY=0`);

  assertSafeShadowOutputPath(`${OUT_DIR_REL}/wave0g25_analysis_summary.json`);
  await fs.writeFile(path.join(OUT_DIR, "wave0g25_analysis_summary.json"), JSON.stringify({
    failedRefCount: failedResults.length, phase2: phase2Rows, distinctFailedStreetIds: distinctFailedStreetIds.length,
    sharedCount, phase3, phase6, streetBreakdown, resolvedOfflineCount, unresolvedOfflineCount: unresolvedOffline.length,
    acceptedUnionKeysReconstructed: acceptedUnionKeys.size, benTsviVerified, entityImpact,
    phase18: { boundaryFailedRefRawRowsPerRef, boundaryFailedRawRowsPerDistinctStreet, totalZero, totalTargetAccepted, verifiedAlreadyCaptured, genuinelyUnresolved },
    maar: { failedRefs: maarRefs.length, rawRows: maarRawSum, delta: 814, plausiblyRelevant: 0, provenRecoveryOpportunity: 0 },
  }, null, 2));

  const csvLines = ["REQUESTED_ENTITY,STREET_NAME,STREET_ID,RAW_ROWS,PARENT_ROWS,ZERO_ROWS,FOREIGN_ROWS,OTHER_ROWS,TOTAL_ROWS_IF_KNOWN,TOTAL_FETCH_IF_KNOWN"];
  for (const p of phase2Rows) csvLines.push([csvEscape(p.entityName), csvEscape(p.streetName), p.streetId, p.rawRows, p.parentRows, p.zeroRows, p.foreignRows, p.otherRows, p.totalRowsIfKnown ?? "", p.totalFetchIfKnown ?? ""].join(","));
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/failed_boundary_refs.csv`);
  await fs.writeFile(path.join(OUT_DIR, "failed_boundary_refs.csv"), csvLines.join("\n") + "\n");

  const foreignLines = ["REQUESTED_ENTITY,STREET,STREET_ID,RAW_ROWS,NEIGHBORHOOD_ID,ROW_COUNT,OFFICIAL_ENTITY_NAME,VERIFICATION"];
  for (const n of benTsviVerified.neighborhoodIdDistribution) {
    foreignLines.push([csvEscape('מע"ר - מרכז עירוני ר'), csvEscape("בן-צבי"), "74000609", 500, n.neighborhoodId, n.rows, csvEscape(n.name), "LIVE_VERIFIED_2_REQUESTS"].join(","));
  }
  for (const b of streetBreakdown) {
    if (b.streetId === "74000609") continue; // already covered above with real neighborhoodIds
    for (const t of b.targetAccepted) {
      foreignLines.push([csvEscape(phase2Rows.find((p) => p.streetId === b.streetId)?.entityName ?? "?"), csvEscape(b.streetName), b.streetId, b.raw, "(within target manifest)", t.accepted, csvEscape(t.entity), "OFFLINE_FROM_WAVE0G24B_RESULTS"].join(","));
    }
    if (b.unexplained > 0) {
      foreignLines.push([csvEscape(phase2Rows.find((p) => p.streetId === b.streetId)?.entityName ?? "?"), csvEscape(b.streetName), b.streetId, b.raw, "UNKNOWN_OUTSIDE_10_TARGETS", b.unexplained, "UNRESOLVED", "NOT_LIVE_VERIFIED"].join(","));
    }
  }
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/foreign_entity_distribution.csv`);
  await fs.writeFile(path.join(OUT_DIR, "foreign_entity_distribution.csv"), foreignLines.join("\n") + "\n");

  const overlapLines = ["STREET_ID,STREET_NAME,RAW,ZERO,TARGET_ACCEPTED_SUM,VERIFIED_OUTSIDE_TARGET,UNRESOLVED,MANIFEST_ENTITY_COUNT,CLASSIFICATION"];
  for (const b of streetBreakdown) {
    const manifestCount = phase3.find((p) => p.streetId === b.streetId)?.manifestEntityIds.length ?? 0;
    const verifiedOutside = b.streetId === "74000609" ? 500 : 0;
    const cls = manifestCount > 1 ? "SHARED_WITH_OTHER_TARGET_MANIFESTS" : (b.streetId === "74000609" ? "EXCLUSIVE_IN_MANIFEST_BUT_SHARED_CITYWIDE" : "EXCLUSIVE_TO_REQUESTED_ENTITY_UNVERIFIED_OWNER");
    overlapLines.push([b.streetId, csvEscape(b.streetName), b.raw, b.zero, b.sumTargetAccepted, verifiedOutside, b.unexplained - verifiedOutside, manifestCount, cls].join(","));
  }
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/boundary_citywide_overlap.csv`);
  await fs.writeFile(path.join(OUT_DIR, "boundary_citywide_overlap.csv"), overlapLines.join("\n") + "\n");

  // ECC silent-failure-hunter + code-reviewer finding: load CURRENT_DELTA
  // from its actual source (audit/wave0g24/entity_outcomes.csv) rather than
  // a hardcoded literal, so this never silently drifts if that file is
  // ever regenerated with different numbers.
  // Naive comma-split is safe here ONLY because none of the 10 target
  // entity names contain a literal comma (some contain embedded quotes,
  // e.g. מע"ר, but csvEscape's quoting of those doesn't introduce a comma
  // to split on) — unlike Wave 0G-23's CSV, which broke on this exact
  // naive approach for a name containing a real comma. Column order is
  // fixed by scripts/audit-wave0g24b-aggregate.ts's own header.
  const outcomesCsvRaw = await fs.readFile(path.join(W24_DIR, "entity_outcomes.csv"), "utf8");
  const outcomesLines = outcomesCsvRaw.trim().split("\n").slice(1); // skip header
  const deltaByEntity = new Map<string, number>();
  for (const line of outcomesLines) {
    const cols = line.split(",");
    const sourceId = cols[1];
    const delta = parseInt(cols[8], 10);
    if (!sourceId || Number.isNaN(delta)) throw new Error(`MALFORMED_ENTITY_OUTCOMES_ROW: "${line}"`);
    deltaByEntity.set(sourceId, delta);
  }
  for (const entity of TARGET_ENTITIES) {
    if (!deltaByEntity.has(entity.sourceId)) throw new Error(`MISSING_DELTA_FOR_ENTITY: ${entity.name} (${entity.sourceId}) not found in audit/wave0g24/entity_outcomes.csv`);
  }

  const impactLines = ["ENTITY,SOURCE_ID,CURRENT_DELTA,FOREIGN_ROWS_BELONGING_TO_THIS_ENTITY,OF_WHICH_ALREADY_PRESENT,OF_WHICH_NOT_PRESENT"];
  for (const e of entityImpact) impactLines.push([csvEscape(e.entity), e.sourceId, deltaByEntity.get(e.sourceId) ?? "", e.foreignRowsFromFailedRefsBelongingToThisEntity, e.ofWhichAlreadyPresent, e.ofWhichNotPresent].join(","));
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/entity_impact_summary.csv`);
  await fs.writeFile(path.join(OUT_DIR, "entity_impact_summary.csv"), impactLines.join("\n") + "\n");

  console.log("\n=== WAVE 0G-25 OFFLINE ANALYSIS COMPLETE ===");
}

const isDirectExecution = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  main().catch((e) => { console.error("ANALYSIS_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
}
