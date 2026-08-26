/**
 * scripts/audit-wave0g14-rasko-merge.ts — Wave 0G-14 Phase 7/9: merges the
 * existing proven 2000-row Rasko DESC+ASC date-sort union (Wave 0G-13) with
 * this wave's two new alternate-sort fetch_number=1 batches — price-descending
 * (Phase 6/7, 500 rows) and room-count-descending (Phase 8, 500 rows) — dedups
 * by the shared transaction-safe key, and reconciles against official
 * total_rows=2012. READ-ONLY analysis only — no new network calls.
 */
import { promises as fs } from "fs";
import path from "path";
import { toShadowDeal, dedupByTransactionKey, transactionKey, assertSafeShadowOutputPath, type ShadowDeal } from "../lib/shadowRebuild";
import type { Neighborhood } from "../lib/types";

const OUT_DIR_REL = "audit/wave0g14/shadow";

const MISSING_GAP_START = "2016-06-06";
const MISSING_GAP_END = "2016-09-07";

async function main() {
  const neighborhood: Neighborhood = { id: "65210248", name: "רסקו", settlement: "נתניה", x: null, y: null };

  // Existing proven 2000-row DESC+ASC union (Wave 0G-13).
  const unionData = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit/wave0g13/shadow/rasko_four_window_union.json"), "utf8"));
  const existingRows: ShadowDeal[] = unionData.uniqueRows;
  console.log("EXISTING_DESC_ASC_UNIQUE=" + existingRows.length);
  if (existingRows.length !== 2000) throw new Error(`UNEXPECTED_EXISTING_UNION_SIZE: expected 2000, got ${existingRows.length}`);

  // New price-descending fetch_number=1 batch (Phase 6/7, this wave).
  const priceRaw = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit/wave0g14/shadow/rasko_price_sort_raw.json"), "utf8"));
  const priceMeta = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit/wave0g14/shadow/rasko_price_sort_meta.json"), "utf8"));
  if (priceMeta.sourceId !== "65210248" || priceMeta.entityFailed) {
    throw new Error(`PRICE_DATA_UNSAFE: sourceId=${priceMeta.sourceId} entityFailed=${priceMeta.entityFailed} — refusing to merge`);
  }
  const priceExchanges = priceRaw.filter((e: any) => e.typeOrder === "dealAmount_down");
  const priceRawItems = priceExchanges.flatMap((e: any) => e.items);
  console.log("ALT_SORT_1_PRICE_RAW_ROWS=" + priceRawItems.length);
  if (priceRawItems.length === 0) {
    throw new Error("PRICE_BATCH_EMPTY: no dealAmount_down items found after filtering — the sort click may have silently failed to trigger a new fetch; refusing to report a false '0 new rows' result");
  }

  const priceRows: ShadowDeal[] = priceRawItems
    .map((raw: any) => toShadowDeal(raw, neighborhood, "65210248"))
    .filter((d: ShadowDeal | null): d is ShadowDeal => d !== null);

  const priceDedup = dedupByTransactionKey(priceRows);
  console.log("ALT_SORT_1_PRICE_UNIQUE_WITHIN_BATCH=" + priceDedup.uniqueCount + " (raw=" + priceDedup.rawCount + " collisions=" + priceDedup.collisions + ")");

  const priceDates = priceRows.map((r) => r.dealDate).filter(Boolean).sort();
  console.log("ALT_SORT_1_PRICE_DATE_RANGE=" + priceDates[0] + " .. " + priceDates[priceDates.length - 1]);

  // New room-count-descending fetch_number=1 batch (Phase 8, this wave).
  const roomsRaw = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit/wave0g14/shadow/rasko_rooms_sort_raw.json"), "utf8"));
  const roomsMeta = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit/wave0g14/shadow/rasko_rooms_sort_meta.json"), "utf8"));
  if (roomsMeta.sourceId !== "65210248" || roomsMeta.entityFailed) {
    throw new Error(`ROOMS_DATA_UNSAFE: sourceId=${roomsMeta.sourceId} entityFailed=${roomsMeta.entityFailed} — refusing to merge`);
  }
  const roomsExchanges = roomsRaw.filter((e: any) => e.typeOrder === "roomNum_down");
  const roomsRawItems = roomsExchanges.flatMap((e: any) => e.items);
  console.log("ALT_SORT_2_ROOMS_RAW_ROWS=" + roomsRawItems.length);
  if (roomsRawItems.length === 0) {
    throw new Error("ROOMS_BATCH_EMPTY: no roomNum_down items found after filtering — the sort click may have silently failed to trigger a new fetch; refusing to report a false '0 new rows' result");
  }

  const roomsRows: ShadowDeal[] = roomsRawItems
    .map((raw: any) => toShadowDeal(raw, neighborhood, "65210248"))
    .filter((d: ShadowDeal | null): d is ShadowDeal => d !== null);

  const roomsDedup = dedupByTransactionKey(roomsRows);
  console.log("ALT_SORT_2_ROOMS_UNIQUE_WITHIN_BATCH=" + roomsDedup.uniqueCount + " (raw=" + roomsDedup.rawCount + " collisions=" + roomsDedup.collisions + ")");

  const roomsDates = roomsRows.map((r) => r.dealDate).filter(Boolean).sort();
  console.log("ALT_SORT_2_ROOMS_DATE_RANGE=" + roomsDates[0] + " .. " + roomsDates[roomsDates.length - 1]);

  // Cross-reference each alt-sort batch against the existing union, but
  // combine them into ONE new-rows set via a shared seen-key accumulator so
  // rows found by BOTH price and rooms sorts are not double counted.
  const existingKeys = new Set(existingRows.map(transactionKey));
  const seenNewKeys = new Set<string>();
  const newRows: ShadowDeal[] = [];
  let alreadyKnown = 0;
  for (const r of [...priceRows, ...roomsRows]) {
    const k = transactionKey(r);
    if (existingKeys.has(k)) { alreadyKnown++; continue; }
    if (seenNewKeys.has(k)) continue; // recovered by both alt sorts — count once
    seenNewKeys.add(k);
    newRows.push(r);
  }
  console.log("ALREADY_KNOWN=" + alreadyKnown + " (combined, non-unique-count: rows from either alt-sort batch already present in the existing 2000-row union)");
  console.log("NEW_ROWS=" + newRows.length + " (combined, deduped across both alt sorts)");

  // Full union.
  const allRows = [...existingRows, ...newRows];
  const finalUnion = dedupByTransactionKey(allRows);
  console.log("FINAL_UNIQUE=" + finalUnion.uniqueCount);
  console.log("FINAL_COLLISIONS=" + finalUnion.collisions);

  const officialTotal = 2012;
  const delta = officialTotal - finalUnion.uniqueCount;
  console.log("OFFICIAL_TOTAL_ROWS=" + officialTotal);
  console.log("DELTA_TO_OFFICIAL=" + delta);

  if (finalUnion.uniqueCount > officialTotal) {
    console.log("STOP_CONDITION_TRIGGERED=UNION_EXCEEDS_OFFICIAL_TOTAL — transaction key may be insufficient, refusing to force reconciliation");
  }

  // New rows falling within the known 12-row gap window.
  const gapRows = newRows.filter((r) => r.dealDate && r.dealDate >= MISSING_GAP_START && r.dealDate <= MISSING_GAP_END);
  console.log("NEW_ROWS_IN_KNOWN_GAP_WINDOW(" + MISSING_GAP_START + ".." + MISSING_GAP_END + ")=" + gapRows.length);
  for (const r of newRows.slice(0, 20)) {
    console.log(`  NEW_ROW: parcelNum=${(r as any).parcelNum ?? "null"} dealDate=${r.dealDate} price=${r.price} street=${r.street ?? "?"} houseNumber=${(r as any).houseNumber ?? "?"}`);
  }
  if (newRows.length > 20) console.log(`  ... and ${newRows.length - 20} more new rows (full list in output file)`);

  await fs.mkdir(path.join(process.cwd(), OUT_DIR_REL), { recursive: true });
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/rasko_final_merge.json`);
  await fs.writeFile(
    path.join(process.cwd(), OUT_DIR_REL, "rasko_final_merge.json"),
    JSON.stringify({
      existingCount: existingRows.length,
      priceRawCount: priceRawItems.length, priceDedupCount: priceDedup.uniqueCount,
      roomsRawCount: roomsRawItems.length, roomsDedupCount: roomsDedup.uniqueCount,
      altSortCombinedRawCount: priceRawItems.length + roomsRawItems.length,
      alreadyKnown, newRowsCount: newRows.length,
      finalUnionCount: finalUnion.uniqueCount, officialTotal, delta, gapRowsCount: gapRows.length,
      newRows, gapRows,
    }, null, 2),
  );
  console.log("DONE");
}

main().catch((e) => { console.error("MERGE_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
