/**
 * scripts/audit-wave0g19-replay.ts — Wave 0G-19 Phase 14: retrospective,
 * read-only, CONDITIONAL replay of Wave 0G-18's already-captured data plus
 * the 20 zero-id rows from the 2 probed streets (Phase 12), under the
 * investigated POLICY 2 (accept zero-id only when BOTH source-native
 * streetCode match AND exact address-text match to the requested street are
 * present — lib/streetIdentityPolicy.ts).
 *
 * IMPORTANT: this replay answers "what WOULD the numbers be IF Policy 2
 * were adopted" — it is NOT a validated new coverage figure. ECC review
 * found real counter-evidence (a distinct cadastral block shared by the
 * accepted rows, absent from every parent-tagged row on the same streets)
 * that the wave's evidence does not resolve — see the report's §3. Policy 2
 * is NOT wired into any live acquisition path; Wave 0G-18's own 4,831/
 * 85.66% remains the actual, adopted figure.
 *
 * Does NOT refetch any street. Reuses the exact same transactionKey()/
 * classifyTransactionGroups() logic Wave 0G-18's aggregator already used and
 * ECC-reviewed, so this replay's arithmetic is directly comparable, not a
 * parallel reimplementation that could silently diverge.
 *
 * The 1 remaining zero-id row (הרב נרייה, streetId=74001235) was NOT
 * re-probed this wave (2-street bound) — deliberately left UNRESOLVED, not
 * silently included.
 */
import { promises as fs } from "fs";
import path from "path";
import { toShadowDeal, transactionKey, type ShadowDeal } from "../lib/shadowRebuild";
import { classifyTransactionGroups } from "./audit-wave0g18-aggregate";
import { classifyRowIdentity } from "../lib/streetIdentityPolicy";
import type { Neighborhood } from "../lib/types";
import type { StreetResult } from "./audit-wave0g18-street-runner";

const PARENT_SOURCE_ID = "65209683";
const OUT_DIR = path.join(process.cwd(), "audit/wave0g19");

async function main() {
  console.log("=== WAVE 0G-19 PHASE 14: RETROSPECTIVE REPLAY (read-only) ===");

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
  const augmentedUniqueOld = oldClassification.augmentedUnion.length;
  console.log(`AUGMENTED_UNIQUE_OLD=${augmentedUniqueOld}`);
  if (augmentedUniqueOld !== 4831) throw new Error(`RECONSTRUCTION_MISMATCH: expected 4831, got ${augmentedUniqueOld} — STOP`);

  const oldUnionKeys = new Set(oldClassification.augmentedUnion.map((r) => transactionKey(r)));

  // --- Load the 20 evidence-backed zero-id rows (Phase 12 probes) ---
  const probe1 = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit/wave0g19/shadow/probe_74001232.json"), "utf8"));
  const probe2 = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit/wave0g19/shadow/probe_74001260.json"), "utf8"));
  const neighborhood: Neighborhood = { id: PARENT_SOURCE_ID, name: "קריית השרון", settlement: "נתניה", x: null, y: null };

  const candidateRows: { streetId: string; streetName: string; row: ShadowDeal }[] = [];
  for (const probe of [probe1, probe2]) {
    for (const raw of probe.rawItems) {
      // ECC database-reviewer finding: this used to reimplement the evidence
      // gate inline, duplicating lib/streetIdentityPolicy.ts's logic — a
      // drift risk if the policy module ever changed without this script
      // being updated in lockstep. Now calls the SAME shared classifier the
      // rest of the wave (and its own tests) exercise, so there is exactly
      // one place the acceptance rule lives.
      const { decision } = classifyRowIdentity(raw, PARENT_SOURCE_ID, probe.streetId, probe.streetName);
      if (decision !== "ACCEPT_ZERO_ID_EVIDENCE") continue; // ACCEPT_PARENT_MATCH rows are already in the old union; everything else stays rejected
      // Re-attribution: accepted under the proven policy, tagged to the
      // PARENT entity's sourceId — this IS the policy decision, made
      // explicit, not a silent default.
      const shadowRow = toShadowDeal(raw, neighborhood, PARENT_SOURCE_ID);
      if (shadowRow) candidateRows.push({ streetId: probe.streetId, streetName: probe.streetName, row: shadowRow });
    }
  }
  console.log(`ZERO_ROWS_NEWLY_ACCEPTED_CANDIDATES=${candidateRows.length}`);

  // --- Dedup candidates against the OLD union (baseline + Wave 0G-18 street rows) ---
  let trueDuplicates = 0, genuinelyNew = 0;
  const newRows: ShadowDeal[] = [];
  const seenThisPass = new Set<string>();
  for (const { row } of candidateRows) {
    const key = transactionKey(row);
    if (oldUnionKeys.has(key) || seenThisPass.has(key)) { trueDuplicates++; continue; }
    seenThisPass.add(key);
    genuinelyNew++;
    newRows.push(row);
  }
  console.log(`ZERO_ROWS_TRUE_DUPLICATES=${trueDuplicates}`);
  console.log(`ZERO_ROWS_GENUINELY_NEW=${genuinelyNew}`);

  const replayAugmentedUnique = augmentedUniqueOld + genuinelyNew;
  const officialTotalRows = 5640;
  if (replayAugmentedUnique > officialTotalRows) {
    throw new Error(`INTEGRITY_FAIL: REPLAY_AUGMENTED_UNIQUE (${replayAugmentedUnique}) exceeds official total (${officialTotalRows}) — STOP`);
  }
  const replayDelta = officialTotalRows - replayAugmentedUnique;
  const replayCoverage = (replayAugmentedUnique / officialTotalRows) * 100;
  console.log(`REPLAY_AUGMENTED_UNIQUE=${replayAugmentedUnique}`);
  console.log(`REPLAY_DELTA_TO_5640=${replayDelta}`);
  console.log(`REPLAY_COVERAGE=${replayCoverage.toFixed(2)}%`);

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "policy_replay_summary.json"), JSON.stringify({
    augmentedUniqueOld, zeroRowsCandidates: candidateRows.length, zeroRowsTrueDuplicates: trueDuplicates,
    zeroRowsGenuinelyNew: genuinelyNew, replayAugmentedUnique, officialTotalRows, replayDelta, replayCoverage,
    unresolvedZeroIdRowsNotReprobed: 1, // הרב נרייה, streetId=74001235
    newRowsAccepted: newRows.map((r) => ({ parcelNum: (r as any).parcelNum, dealDate: r.dealDate, price: r.price, street: r.street, houseNumber: r.houseNumber })),
  }, null, 2));

  console.log("=== REPLAY COMPLETE ===");
}

main().catch((e) => { console.error("REPLAY_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
