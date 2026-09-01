/**
 * Wave 0G-L1D — validates the dealNormalization.ts id-scheme fix against
 * the FULL real citywide corpus that exposed the original defect (the
 * 59,305-row V2 union), entirely offline (reuses build-v2-launch-
 * candidate.ts's already-proven, already-committed reconstruction of
 * already-acquired Wave 0G artifacts — zero new network requests).
 *
 * The stored shadow-output JSON files carry `.id` fields baked in by
 * whichever normalizeDeal() version acquired them (the OLD, buggy
 * formula) — a code fix alone doesn't retroactively change already-
 * serialized JSON. So this script does not trust `row.id`; it RECOMPUTES
 * what each row's id would be under the fixed formula, from the row's own
 * parcelNum/dealDate/price/neighborhoodId fields (which are unaffected by
 * the fix and already present in the corpus), and checks for collisions
 * on that recomputed set.
 */
import { buildUnion } from "./build-v2-launch-candidate";
import { buildTransactionIdSuffix } from "../lib/dealNormalization";

async function main() {
  const { allRows } = await buildUnion();
  console.log(`TOTAL_ROWS=${allRows.length}`);

  const oldIdCounts = new Map<string, number>();
  const newIdCounts = new Map<string, number>();
  for (const row of allRows) {
    oldIdCounts.set(row.id, (oldIdCounts.get(row.id) ?? 0) + 1);
    const newId = `${row.neighborhoodId}-${buildTransactionIdSuffix(row.parcelNum, row.dealDate, row.price)}`;
    newIdCounts.set(newId, (newIdCounts.get(newId) ?? 0) + 1);
  }

  const oldDuplicates = [...oldIdCounts.values()].filter((c) => c > 1).length;
  const newDuplicates = [...newIdCounts.values()].filter((c) => c > 1).length;
  console.log(`OLD_FORMULA_DISTINCT_DUPLICATED_IDS=${oldDuplicates}`);
  console.log(`NEW_FORMULA_DISTINCT_DUPLICATED_IDS=${newDuplicates}`);
  console.log(`OLD_FORMULA_UNIQUE_TOTAL=${oldIdCounts.size}`);
  console.log(`NEW_FORMULA_UNIQUE_TOTAL=${newIdCounts.size}`);

  if (newDuplicates > 0) {
    const examples = [...newIdCounts.entries()].filter(([, c]) => c > 1).slice(0, 10);
    console.log("REMAINING_COLLISIONS=" + JSON.stringify(examples));
    for (const [id] of examples) {
      const rows = allRows.filter(
        (r) => `${r.neighborhoodId}-${buildTransactionIdSuffix(r.parcelNum, r.dealDate, r.price)}` === id,
      );
      console.log(JSON.stringify({ id, rows: rows.map((r) => ({ parcelNum: r.parcelNum, dealDate: r.dealDate, price: r.price })) }));
    }
  }
  console.log(newDuplicates === 0 ? "VALIDATION=PASS_ZERO_COLLISIONS" : "VALIDATION=FAIL_COLLISIONS_REMAIN");
}

main().catch((e) => {
  console.error("VALIDATION_ERROR:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
