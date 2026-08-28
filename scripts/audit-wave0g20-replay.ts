/**
 * scripts/audit-wave0g20-replay.ts — Wave 0G-20 Phases 3 & 11: retrospective,
 * read-only replay recovering CLASS A (explicit parent-id) rows from the
 * mixed batches Wave 0G-18's whole-batch rejection discarded, using
 * lib/streetRowAcceptance.ts's per-row classifier.
 *
 * Real row-level raw data exists for 3 of the 7 mixed streets this wave
 * (91% of the 686 total CLASS A rows): בני רייך and טום לנטוס (Wave 0G-19
 * probes) plus הרב שמואל הרטום (this wave's own bounded Phase 18 live
 * control, moved earlier out of necessity — same pattern Wave 0G-19 used).
 * The other 4 streets' CLASS A rows (62 raw) have NO row-level data
 * available without a further live fetch, which this wave's budget does
 * not authorize beyond the one control fetch already used — they are
 * reported as an unverified, disclosed residual, never assumed recovered.
 *
 * Does NOT refetch any street beyond the one Phase 18 control fetch
 * already performed. Reuses the exact same transactionKey()/
 * classifyTransactionGroups() logic Wave 0G-18's aggregator used and
 * ECC-reviewed.
 */
import { promises as fs } from "fs";
import path from "path";
import { toShadowDeal, type ShadowDeal } from "../lib/shadowRebuild";
import { classifyRowForAcceptance, classifyBatchForAcceptance } from "../lib/streetRowAcceptance";
import { classifyTransactionGroups } from "./audit-wave0g18-aggregate";
import type { Neighborhood } from "../lib/types";
import type { StreetResult } from "./audit-wave0g18-street-runner";

const PARENT_SOURCE_ID = "65209683";
const OUT_DIR = path.join(process.cwd(), "audit/wave0g20");

// The 7 mixed batches Wave 0G-19 reconstructed, with their exact CLASS A
// (matching-parent) counts — re-verified against the same source files
// this script itself re-reads below, not hardcoded blindly.
const ALL_SEVEN_STREETS = [
  { id: "74000865", name: "הרב שמואל הרטום", classA: 134 },
  { id: "74001235", name: "הרב נרייה", classA: 16 },
  { id: "74000826", name: "הפארק", classA: 46 },
  { id: "74000153", name: "אריאל שרון", classA: 0 },
  { id: "74001232", name: "בני רייך", classA: 79 },
  { id: "74001260", name: "טום לנטוס", classA: 411 },
  { id: "74000607", name: 'האר"י', classA: 0 },
];

// Streets with real, live-captured row-level raw data available this wave.
const PROBED = [
  { id: "74001232", path: "audit/wave0g19/shadow/probe_74001232.json", itemsKey: "rawItems" },
  { id: "74001260", path: "audit/wave0g19/shadow/probe_74001260.json", itemsKey: "rawItems" },
  { id: "74000865", path: "audit/wave0g20/shadow/live_control_74000865.json", itemsKey: "rawItems" },
];

async function main() {
  console.log("=== WAVE 0G-20 PHASES 3 & 11: RETROSPECTIVE CLASS A REPLAY (read-only) ===");

  // --- Reconstruct Wave 0G-18's exact augmentedUnion (old baseline) ---
  const baseline = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit/wave0g16/shadow-output/65209683.json"), "utf8"));
  const streetsDir = path.join(process.cwd(), "audit/wave0g18/shadow");
  const manifest = JSON.parse(await fs.readFile(path.join(streetsDir, "street_run_manifest.json"), "utf8"));
  const streetIds = Object.keys(manifest);
  const streetResults: StreetResult[] = [];
  for (const id of streetIds) {
    streetResults.push(JSON.parse(await fs.readFile(path.join(streetsDir, `street_${PARENT_SOURCE_ID}_${id}.json`), "utf8")));
  }
  const successStatuses = ["SUCCESS_ROWS", "SUCCESS_EMPTY", "PARTIAL_MORE_FETCHES_INDICATED"];
  const successfulResults = streetResults.filter((r) => successStatuses.includes(r.status));
  const oldClassification = classifyTransactionGroups(baseline.uniqueRows, successfulResults.map((r) => ({ streetId: r.streetId, rows: r.rows })));
  const oldAugmentedUnique = oldClassification.augmentedUnion.length;
  console.log(`OLD_ACCEPTED_UNIQUE=${oldAugmentedUnique}`);
  if (oldAugmentedUnique !== 4831) throw new Error(`RECONSTRUCTION_MISMATCH: expected 4831, got ${oldAugmentedUnique} — STOP`);

  // --- Recover CLASS A rows from the 3 streets with real raw data ---
  const neighborhood: Neighborhood = { id: PARENT_SOURCE_ID, name: "קריית השרון", settlement: "נתניה", x: null, y: null };
  const recoveredRows: ShadowDeal[] = [];
  const streetRowSets: { streetId: string; rows: ShadowDeal[] }[] = [];
  const perStreetRecovery: { streetId: string; name: string; rawParentRows: number; newRows: number | null; zeroRejected: number; foreignRejected: number; verified: boolean; finalBatchStatus: string }[] = [];
  let zeroRejectedTotal = 0, foreignRejectedTotal = 0;

  for (const p of PROBED) {
    const probe = JSON.parse(await fs.readFile(path.join(process.cwd(), p.path), "utf8"));
    const items = probe[p.itemsKey] as any[];
    // Re-verify accounting via the shared classifier (not just trust the
    // probe's own pre-recorded counts) — defense in depth.
    const counts = classifyBatchForAcceptance(items, PARENT_SOURCE_ID);
    console.log(`  ${p.id}: rawRows=${counts.rawRows} acceptedParent=${counts.acceptedParent} rejectedZero=${counts.rejectedZero} rejectedForeign=${counts.rejectedForeign}`);
    zeroRejectedTotal += counts.rejectedZero;
    foreignRejectedTotal += counts.rejectedForeign;
    // ECC finding (specialist, silent-failure-hunter): call the SAME
    // classifier used for `counts` above, not a hand-duplicated inline
    // check — closes the drift risk the runner's own equivalent fix closed.
    const acceptedItems = items.filter((it: any) => classifyRowForAcceptance(it, PARENT_SOURCE_ID) === "ACCEPT_PARENT");
    const streetRows: ShadowDeal[] = [];
    for (const raw of acceptedItems) {
      const shadowRow = toShadowDeal(raw, neighborhood, PARENT_SOURCE_ID);
      if (shadowRow) { recoveredRows.push(shadowRow); streetRows.push(shadowRow); }
    }
    streetRowSets.push({ streetId: p.id, rows: streetRows });
    const meta = ALL_SEVEN_STREETS.find((s) => s.id === p.id)!;
    perStreetRecovery.push({ streetId: p.id, name: meta.name, rawParentRows: counts.acceptedParent, newRows: null, zeroRejected: counts.rejectedZero, foreignRejected: counts.rejectedForeign, verified: true, finalBatchStatus: "SUCCESS_MIXED_PARTIAL (verified live)" });
    if (counts.acceptedParent !== meta.classA) {
      console.log(`  WARNING: ${p.id} live/probed acceptedParent=${counts.acceptedParent} differs from Wave 0G-19's earlier reconstruction=${meta.classA}`);
    }
  }
  // Unverified streets — no row-level data, reported as a disclosed residual, NOT included in any recovered count.
  const UNVERIFIED_META: Record<string, { zeroB: number; foreignC: number }> = {
    "74001235": { zeroB: 1, foreignC: 0 }, "74000826": { zeroB: 0, foreignC: 171 },
    "74000153": { zeroB: 0, foreignC: 5 }, "74000607": { zeroB: 0, foreignC: 237 },
  };
  for (const s of ALL_SEVEN_STREETS) {
    if (!PROBED.some((p) => p.id === s.id)) {
      const meta = UNVERIFIED_META[s.id] ?? { zeroB: 0, foreignC: 0 };
      const finalBatchStatus = s.classA > 0 ? "LIKELY SUCCESS_MIXED_PARTIAL (unverified — no row-level data)" : "FAILED_NO_TRUSTED_ROWS (0 parent rows even under new logic)";
      perStreetRecovery.push({ streetId: s.id, name: s.name, rawParentRows: s.classA, newRows: s.classA === 0 ? 0 : null, zeroRejected: meta.zeroB, foreignRejected: meta.foreignC, verified: false, finalBatchStatus });
    }
  }

  const rawClassAVerified = recoveredRows.length;
  console.log(`RAW_CLASS_A_VERIFIED=${rawClassAVerified} (from ${PROBED.length} of 7 streets with real row-level data)`);
  const rawClassAUnverified = ALL_SEVEN_STREETS.filter((s) => !PROBED.some((p) => p.id === s.id)).reduce((sum, s) => sum + s.classA, 0);
  console.log(`RAW_CLASS_A_UNVERIFIED_RESIDUAL=${rawClassAUnverified} (4 streets, no row-level data available — NOT included in any recovered total)`);

  // --- Dedup + ambiguity check: reuse classifyTransactionGroups (the SAME
  // field-agreement-aware function Wave 0G-18's own aggregator uses), not a
  // hand-rolled key-only dedup — ECC database-reviewer finding: a naive
  // first-key-wins check would silently merge two DISTINCT transactions
  // that happen to share a key, exactly the anti-pattern this function was
  // already built to guard against. Treat the 624 recovered rows as one
  // "virtual street" input.
  const newClassification = classifyTransactionGroups(oldClassification.augmentedUnion, [{ streetId: "WAVE_0G20_RECOVERED_CLASS_A", rows: recoveredRows }]);
  const duplicateVsOldUnion = newClassification.trueDuplicateEntityVsStreet;
  const genuinelyNew = newClassification.genuinelyNewStreetRows;
  const ambiguousCollisions = newClassification.ambiguousCollisions;
  console.log(`DUPLICATE_VS_OLD_UNION(entity_baseline_or_accepted_street_corpus)=${duplicateVsOldUnion}`);
  console.log(`DUPLICATE_WITHIN_CLASS_A_RECOVERED=${newClassification.trueDuplicateStreetVsStreet}`);
  console.log(`GENUINELY_NEW_CLASS_A=${genuinelyNew}`);
  console.log(`AMBIGUOUS_COLLISIONS=${ambiguousCollisions}`);
  if (ambiguousCollisions > 0) {
    throw new Error(`INTEGRITY_FAIL: ${ambiguousCollisions} ambiguous collision(s) found (field-agreement check, via classifyTransactionGroups) — STOP, per Phase 10 requirement (AMBIGUOUS_COLLISIONS must be 0). See newClassification.ambiguousExamples.`);
  }

  const newAugmentedUnique = newClassification.augmentedUnion.length;
  const officialTotal = 5640;
  if (newAugmentedUnique > officialTotal) {
    throw new Error(`INTEGRITY_FAIL: NEW_ACCEPTED_UNIQUE (${newAugmentedUnique}) exceeds official total (${officialTotal}) — STOP and investigate.`);
  }
  const newDelta = officialTotal - newAugmentedUnique;
  const newCoverage = (newAugmentedUnique / officialTotal) * 100;
  console.log(`NEW_ACCEPTED_UNIQUE=${newAugmentedUnique}`);
  console.log(`NEW_DELTA=${newDelta}`);
  console.log(`NEW_COVERAGE=${newCoverage.toFixed(2)}%`);

  // Per-street "genuinely new" breakdown: each verified street classified
  // independently against the SAME old union — valid decomposition since
  // duplicateWithinRecovered=0 (no overlap between the 3 streets' rows,
  // confirmed above by the combined classification), so per-street sums
  // reconcile exactly against the authoritative combined GENUINELY_NEW_CLASS_A.
  let perStreetNewSum = 0;
  for (const s of streetRowSets) {
    const c = classifyTransactionGroups(oldClassification.augmentedUnion, [s]);
    const entry = perStreetRecovery.find((r) => r.streetId === s.streetId)!;
    entry.newRows = c.genuinelyNewStreetRows;
    perStreetNewSum += c.genuinelyNewStreetRows;
  }
  if (perStreetNewSum !== genuinelyNew) {
    throw new Error(`INTEGRITY_FAIL: per-street genuinely-new sum (${perStreetNewSum}) does not reconcile with the combined GENUINELY_NEW_CLASS_A (${genuinelyNew}) — STOP and investigate.`);
  }

  // Sort per-street recovery by rawParentRows desc for the report/CSV.
  perStreetRecovery.sort((a, b) => b.rawParentRows - a.rawParentRows);
  const csvLines = ["STREET_ID,STREET_NAME,PARENT_ROWS_RAW,PARENT_ROWS_NEW,ZERO_REJECTED,FOREIGN_REJECTED,FINAL_BATCH_STATUS"];
  for (const r of perStreetRecovery) csvLines.push([r.streetId, `"${r.name}"`, r.rawParentRows, r.newRows === null ? "UNVERIFIED" : r.newRows, r.zeroRejected, r.foreignRejected, `"${r.finalBatchStatus}"`].join(","));
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "mixed_batch_recovery.csv"), csvLines.join("\n") + "\n");

  // ECC finding (planner): don't hardcode the still-rejected totals —
  // derive them from the same per-street evidence, verified where possible.
  const zeroRowsStillRejected = perStreetRecovery.reduce((s, r) => s + r.zeroRejected, 0);
  const foreignRowsStillRejected = perStreetRecovery.reduce((s, r) => s + r.foreignRejected, 0);

  const summary = {
    oldAcceptedUnique: oldAugmentedUnique,
    rawClassATotal: ALL_SEVEN_STREETS.reduce((s, x) => s + x.classA, 0),
    rawClassAVerified, rawClassAUnverifiedResidual: rawClassAUnverified,
    duplicateVsOldUnion, duplicateWithinRecovered: newClassification.trueDuplicateStreetVsStreet, genuinelyNewClassA: genuinelyNew,
    newAcceptedUnique: newAugmentedUnique, officialTotal, newDelta, newCoverage,
    ambiguousCollisions,
    perStreetRecovery,
    zeroRowsStillRejected, foreignRowsStillRejected,
  };
  await fs.writeFile(path.join(OUT_DIR, "kiryat_replay_summary.json"), JSON.stringify(summary, null, 2));

  console.log(`ZERO_ROWS_STILL_REJECTED=${zeroRowsStillRejected} (unchanged — this wave does not adopt Wave 0G-19's unresolved zero-id policy; ${zeroRejectedTotal} verified live, rest from Wave 0G-19's aggregate reconstruction)`);
  console.log(`FOREIGN_ROWS_STILL_REJECTED=${foreignRowsStillRejected} (unchanged — CLASS C rejection is unconditional this wave; ${foreignRejectedTotal} verified live, rest from Wave 0G-19's aggregate reconstruction)`);
  console.log("=== REPLAY COMPLETE ===");
}

main().catch((e) => { console.error("REPLAY_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
