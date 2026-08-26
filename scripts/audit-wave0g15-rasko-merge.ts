/**
 * scripts/audit-wave0g15-rasko-merge.ts — Wave 0G-15 Phase 2/4/5/6/7:
 * reconstructs the current proven 2005-row Rasko union (Wave 0G-13's
 * 2000-row DESC+ASC date union + Wave 0G-14's 5 new price/rooms-descending
 * rows), then merges in this wave's new ascending-sort batch(es), and
 * reconciles against official total_rows=2012. READ-ONLY analysis only —
 * no new network calls.
 *
 * Usage: npx tsx scripts/audit-wave0g15-rasko-merge.ts <phase>
 *   phase=price   — merge price-ascending batch only (Phase 4/5)
 *   phase=rooms   — merge price-ascending AND rooms-ascending batches (Phase 6/7)
 */
import { promises as fs } from "fs";
import path from "path";
import { toShadowDeal, dedupByTransactionKey, transactionKey, assertSafeShadowOutputPath, type ShadowDeal } from "../lib/shadowRebuild";
import type { Neighborhood } from "../lib/types";

const OUT_DIR_REL = "audit/wave0g15/shadow";
const MISSING_GAP_START = "2016-06-06";
const MISSING_GAP_END = "2016-09-07";

async function loadBatch(name: string, expectedTypeOrder: string, neighborhood: Neighborhood): Promise<{ rows: ShadowDeal[]; rawCount: number }> {
  const raw = JSON.parse(await fs.readFile(path.join(process.cwd(), `audit/wave0g15/shadow/${name}_raw.json`), "utf8"));
  const meta = JSON.parse(await fs.readFile(path.join(process.cwd(), `audit/wave0g15/shadow/${name}_meta.json`), "utf8"));
  if (meta.sourceId !== "65210248" || meta.entityFailed) {
    throw new Error(`${name.toUpperCase()}_DATA_UNSAFE: sourceId=${meta.sourceId} entityFailed=${meta.entityFailed} — refusing to merge`);
  }
  const exchanges = raw.filter((e: any) => e.typeOrder === expectedTypeOrder);
  const rawItems = exchanges.flatMap((e: any) => e.items);
  if (rawItems.length === 0) {
    throw new Error(`${name.toUpperCase()}_BATCH_EMPTY: no ${expectedTypeOrder} items found after filtering — the sort click may have silently failed; refusing to report a false result`);
  }
  const rows: ShadowDeal[] = rawItems
    .map((r: any) => toShadowDeal(r, neighborhood, "65210248"))
    .filter((d: ShadowDeal | null): d is ShadowDeal => d !== null);
  return { rows, rawCount: rawItems.length };
}

async function main() {
  const phase = process.argv[2] ?? "price";
  const neighborhood: Neighborhood = { id: "65210248", name: "רסקו", settlement: "נתניה", x: null, y: null };

  // --- Phase 2: reconstruct the proven 2005-row union (existing artifacts, no refetch) ---
  const wave13Union = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit/wave0g13/shadow/rasko_four_window_union.json"), "utf8"));
  const dateDescAscRows: ShadowDeal[] = wave13Union.uniqueRows;
  console.log("DATE_DESC_ASC_ROWS=" + dateDescAscRows.length);
  if (dateDescAscRows.length !== 2000) throw new Error(`UNEXPECTED_WAVE13_UNION_SIZE: expected 2000, got ${dateDescAscRows.length}`);

  const wave14Merge = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit/wave0g14/shadow/rasko_final_merge.json"), "utf8"));
  const priceRoomsNewRows: ShadowDeal[] = wave14Merge.newRows;
  console.log("PRICE_DESC_ROOM_DESC_NEW_ROWS=" + priceRoomsNewRows.length);
  if (priceRoomsNewRows.length !== 5) throw new Error(`UNEXPECTED_WAVE14_NEW_ROWS: expected 5, got ${priceRoomsNewRows.length}`);

  const existingRows = [...dateDescAscRows, ...priceRoomsNewRows];
  const existingDedup = dedupByTransactionKey(existingRows);
  console.log("RAW_ROWS(reconstructed)=" + existingRows.length);
  console.log("UNIQUE_ROWS(reconstructed)=" + existingDedup.uniqueCount);
  console.log("DELTA(reconstructed)=" + (2012 - existingDedup.uniqueCount));
  if (existingDedup.uniqueCount !== 2005) {
    throw new Error(`RECONSTRUCTION_MISMATCH: expected 2005 unique, got ${existingDedup.uniqueCount} — STOPPING per Phase 2 instructions`);
  }
  const existingKeys = new Set(existingDedup.uniqueRows.map(transactionKey));

  // --- Phase 4/6: merge new ascending batch(es) ---
  const seenNewKeys = new Set<string>();
  const newRows: ShadowDeal[] = [];
  let alreadyKnown = 0;
  const perBatch: Record<string, { rawCount: number; dedupCount: number; newCount: number }> = {};

  const priceAsc = await loadBatch("rasko_price_asc", "dealAmount_up", neighborhood);
  const priceAscDedup = dedupByTransactionKey(priceAsc.rows);
  console.log("PRICE_ASC_RAW_ROWS=" + priceAsc.rawCount);
  console.log("PRICE_ASC_UNIQUE_WITHIN_BATCH=" + priceAscDedup.uniqueCount);
  let priceAscNewCount = 0;
  for (const r of priceAsc.rows) {
    const k = transactionKey(r);
    if (existingKeys.has(k)) { alreadyKnown++; continue; }
    if (seenNewKeys.has(k)) continue;
    seenNewKeys.add(k);
    newRows.push(r);
    priceAscNewCount++;
  }
  perBatch.priceAsc = { rawCount: priceAsc.rawCount, dedupCount: priceAscDedup.uniqueCount, newCount: priceAscNewCount };
  console.log("PRICE_ASC_NEW_ROWS=" + priceAscNewCount);

  let unionAfterPriceAsc = dedupByTransactionKey([...existingDedup.uniqueRows, ...newRows]);
  console.log("NEW_UNIQUE_TOTAL_AFTER_PRICE_ASC=" + unionAfterPriceAsc.uniqueCount);
  console.log("DELTA_TO_2012_AFTER_PRICE_ASC=" + (2012 - unionAfterPriceAsc.uniqueCount));

  if (phase === "rooms") {
    const roomsAsc = await loadBatch("rasko_rooms_asc", "roomNum_up", neighborhood);
    const roomsAscDedup = dedupByTransactionKey(roomsAsc.rows);
    console.log("ROOMS_ASC_RAW_ROWS=" + roomsAsc.rawCount);
    console.log("ROOMS_ASC_UNIQUE_WITHIN_BATCH=" + roomsAscDedup.uniqueCount);
    let roomsAscNewCount = 0;
    for (const r of roomsAsc.rows) {
      const k = transactionKey(r);
      if (existingKeys.has(k)) { alreadyKnown++; continue; }
      if (seenNewKeys.has(k)) continue;
      seenNewKeys.add(k);
      newRows.push(r);
      roomsAscNewCount++;
    }
    perBatch.roomsAsc = { rawCount: roomsAsc.rawCount, dedupCount: roomsAscDedup.uniqueCount, newCount: roomsAscNewCount };
    console.log("ROOMS_ASC_NEW_ROWS=" + roomsAscNewCount);
  }

  const finalUnion = dedupByTransactionKey([...existingDedup.uniqueRows, ...newRows]);
  console.log("FINAL_UNIQUE=" + finalUnion.uniqueCount);
  console.log("FINAL_COLLISIONS=" + finalUnion.collisions);
  const officialTotal = 2012;
  const delta = officialTotal - finalUnion.uniqueCount;
  console.log("OFFICIAL_TOTAL_ROWS=" + officialTotal);
  console.log("DELTA_TO_OFFICIAL=" + delta);

  if (finalUnion.uniqueCount > officialTotal) {
    console.log("STOP_CONDITION_TRIGGERED=UNION_EXCEEDS_OFFICIAL_TOTAL — refusing to force reconciliation, classify FAIL, do not trim rows");
  }

  const gapRows = newRows.filter((r) => r.dealDate && r.dealDate >= MISSING_GAP_START && r.dealDate <= MISSING_GAP_END);
  console.log("NEW_ROWS_IN_KNOWN_GAP_WINDOW(" + MISSING_GAP_START + ".." + MISSING_GAP_END + ")=" + gapRows.length);
  const newDates = newRows.map((r) => r.dealDate).filter(Boolean).sort();
  if (newDates.length) console.log("NEW_ROWS_DATE_RANGE=" + newDates[0] + " .. " + newDates[newDates.length - 1]);

  const minusZeroNew = newRows.filter((r) => (r as any).parcelNum && String((r as any).parcelNum).endsWith("-0"));
  console.log("NEW_MINUS_ZERO_ROWS=" + minusZeroNew.length);
  let minusZeroCollisions = 0;
  if (minusZeroNew.length > 1) {
    const seen = new Set<string>();
    for (const r of minusZeroNew) {
      const k = `${r.dealDate}|${r.price}`;
      if (seen.has(k)) minusZeroCollisions++;
      seen.add(k);
    }
  }
  console.log("COLLISIONS_AMONG_MINUS_ZERO=" + minusZeroCollisions);

  for (const r of newRows) {
    console.log(`  NEW_ROW: parcelNum=${(r as any).parcelNum ?? "null"} dealDate=${r.dealDate} price=${r.price} street=${r.street ?? "?"} houseNumber=${(r as any).houseNumber ?? "?"}`);
  }

  await fs.mkdir(path.join(process.cwd(), OUT_DIR_REL), { recursive: true });
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/rasko_final_merge.json`);
  await fs.writeFile(
    path.join(process.cwd(), OUT_DIR_REL, "rasko_final_merge.json"),
    JSON.stringify({
      phase, preWaveUnique: existingDedup.uniqueCount, perBatch, alreadyKnown,
      newRowsCount: newRows.length, finalUnionCount: finalUnion.uniqueCount, officialTotal, delta,
      gapRowsCount: gapRows.length, minusZeroNewCount: minusZeroNew.length, minusZeroCollisions,
      newRows, gapRows,
    }, null, 2),
  );
  console.log("DONE");
}

main().catch((e) => { console.error("MERGE_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
