/**
 * scripts/audit-wave0g13-rasko-merge.ts — Wave 0G-13 Phase 4: merges Rasko's
 * already-captured DESC fetch1+2 (Wave 0G-12) with this wave's new ASC
 * fetch1+2, using the shared transaction-safe dedup key, and reconciles
 * against the official total_rows=2012. READ-ONLY analysis only.
 */
import { promises as fs } from "fs";
import path from "path";
import { toShadowDeal, dedupByTransactionKey, transactionKey, type ShadowDeal } from "../lib/shadowRebuild";
import type { Neighborhood } from "../lib/types";

async function main() {
  const neighborhood: Neighborhood = { id: "65210248", name: "רסקו", settlement: "נתניה", x: null, y: null };

  // DESC fetch1+2 — reuse Wave 0G-12's already-normalized, already-deduped output.
  const descData = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit/wave0g12/shadow/rasko.json"), "utf8"));
  if (descData.sourceId !== "65210248") {
    throw new Error(`SOURCE_ID_MISMATCH in wave0g12/shadow/rasko.json: expected 65210248, got ${descData.sourceId} — refusing to merge mismatched entity data`);
  }
  const descRows: ShadowDeal[] = descData.uniqueRows;

  // ASC fetch1+2 — this wave's new raw capture, normalize the same way.
  const ascRaw = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit/wave0g13/shadow/rasko_ascending_raw.json"), "utf8"));
  const ascMeta = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit/wave0g13/shadow/rasko_ascending_meta.json"), "utf8"));
  if (ascMeta.sourceId !== "65210248" || ascMeta.entityFailed) {
    throw new Error(`ASC_DATA_UNSAFE: sourceId=${ascMeta.sourceId} entityFailed=${ascMeta.entityFailed} — refusing to merge`);
  }
  const ascExchanges = ascRaw.filter((e: any) => e.typeOrder === "dealDate_up");
  const ascRawItems = ascExchanges.flatMap((e: any) => e.items);
  const ascRows: ShadowDeal[] = ascRawItems
    .map((raw: any) => toShadowDeal(raw, neighborhood, "65210248"))
    .filter((d: ShadowDeal | null): d is ShadowDeal => d !== null);

  console.log("DESC_UNIQUE=" + descRows.length);
  console.log("ASC_RAW=" + ascRawItems.length);
  const ascDedup = dedupByTransactionKey(ascRows);
  console.log("ASC_UNIQUE=" + ascDedup.uniqueCount + " (raw=" + ascDedup.rawCount + " collisions=" + ascDedup.collisions + ")");

  const ascDates = ascRows.map((r) => r.dealDate).filter(Boolean).sort();
  console.log("ASC_FETCH_1_RANGE=(first 500 of ascending, oldest-first)");
  console.log("ASC_OVERALL_RANGE=" + ascDates[0] + " .. " + ascDates[ascDates.length - 1]);

  // Four-window union.
  const allRows = [...descRows, ...ascRows];
  console.log("RAW_ROWS_TOTAL=" + allRows.length);
  const union = dedupByTransactionKey(allRows);
  console.log("FOUR_WINDOW_UNIQUE=" + union.uniqueCount);
  console.log("FOUR_WINDOW_COLLISIONS=" + union.collisions);

  const descKeys = new Set(descRows.map(transactionKey));
  const ascKeys = new Set(ascRows.map(transactionKey));
  let overlap = 0;
  for (const k of descKeys) if (ascKeys.has(k)) overlap++;
  console.log("DESC_ASC_OVERLAP=" + overlap);

  const officialTotal = 2012;
  console.log("OFFICIAL_TOTAL_ROWS=" + officialTotal);
  console.log("DELTA_TO_OFFICIAL=" + (officialTotal - union.uniqueCount));

  const unionDates = union.uniqueRows.map((r) => r.dealDate).filter(Boolean).sort();
  console.log("UNION_EARLIEST=" + unionDates[0]);
  console.log("UNION_LATEST=" + unionDates[unionDates.length - 1]);

  const descDates = descRows.map((r) => r.dealDate).filter(Boolean).sort();
  console.log("DESC_EARLIEST=" + descDates[0] + " DESC_LATEST=" + descDates[descDates.length - 1]);
  console.log("ASC_EARLIEST=" + ascDates[0] + " ASC_LATEST=" + ascDates[ascDates.length - 1]);

  await fs.mkdir(path.join(process.cwd(), "audit/wave0g13"), { recursive: true });
  await fs.writeFile(
    path.join(process.cwd(), "audit/wave0g13/shadow/rasko_four_window_union.json"),
    JSON.stringify({ descCount: descRows.length, ascCount: ascRows.length, unionCount: union.uniqueCount, overlap, officialTotal, delta: officialTotal - union.uniqueCount, uniqueRows: union.uniqueRows }, null, 2),
  );
  console.log("DONE");
}

main().catch((e) => { console.error("MERGE_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
