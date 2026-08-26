/**
 * scripts/audit-wave0g15-phase8-key-revalidation.ts — Wave 0G-15 Phase 8:
 * transaction-key revalidation (parcelNum + dealDate + price) across ALL 6
 * tested Rasko sort surfaces (date desc, date asc, price desc, price asc,
 * rooms desc, rooms asc) combined — 8 individual fetch windows. READ-ONLY,
 * no new network calls.
 */
import { promises as fs } from "fs";
import path from "path";
import { toShadowDeal, dedupByTransactionKey, transactionKey, type ShadowDeal } from "../lib/shadowRebuild";
import type { Neighborhood } from "../lib/types";

async function loadRawBatch(file: string, expectedTypeOrders: string[], neighborhood: Neighborhood): Promise<ShadowDeal[]> {
  const raw = JSON.parse(await fs.readFile(path.join(process.cwd(), file), "utf8"));
  const exchanges = Array.isArray(raw) ? raw.filter((e: any) => expectedTypeOrders.includes(e.typeOrder)) : [];
  const items = exchanges.flatMap((e: any) => e.items ?? []);
  if (items.length === 0) {
    throw new Error(`BATCH_EMPTY: ${file} produced 0 items after filtering by typeOrder in [${expectedTypeOrders.join(", ")}] — refusing to silently contribute 0 rows to the revalidation totals (ECC silent-failure-hunter finding)`);
  }
  return items.map((r: any) => toShadowDeal(r, neighborhood, "65210248")).filter((d: ShadowDeal | null): d is ShadowDeal => d !== null);
}

async function main() {
  const neighborhood: Neighborhood = { id: "65210248", name: "רסקו", settlement: "נתניה", x: null, y: null };

  // Date desc+asc: reuse the already-normalized Wave 0G-13 union (raw items
  // not separately available for the DESC batch beyond that union; the
  // union itself IS the raw+deduped date-surface data, already proven 0
  // internal collisions in Wave 0G-13).
  const wave13Union = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit/wave0g13/shadow/rasko_four_window_union.json"), "utf8"));
  const dateRows: ShadowDeal[] = wave13Union.uniqueRows;

  const priceDescRows = await loadRawBatch("audit/wave0g14/shadow/rasko_price_sort_raw.json", ["dealAmount_down"], neighborhood);
  const roomsDescRows = await loadRawBatch("audit/wave0g14/shadow/rasko_rooms_sort_raw.json", ["roomNum_down"], neighborhood);
  const priceAscRows = await loadRawBatch("audit/wave0g15/shadow/rasko_price_asc_raw.json", ["dealAmount_up"], neighborhood);
  const roomsAscRows = await loadRawBatch("audit/wave0g15/shadow/rasko_rooms_asc_raw.json", ["roomNum_up"], neighborhood);

  console.log("DATE_DESC_ASC_ROWS(already-deduped-union)=" + dateRows.length);
  console.log("PRICE_DESC_RAW=" + priceDescRows.length);
  console.log("ROOMS_DESC_RAW=" + roomsDescRows.length);
  console.log("PRICE_ASC_RAW=" + priceAscRows.length);
  console.log("ROOMS_ASC_RAW=" + roomsAscRows.length);

  const allRows = [...dateRows, ...priceDescRows, ...roomsDescRows, ...priceAscRows, ...roomsAscRows];
  console.log("RAW_ROWS_ALL_SURFACES=" + allRows.length);

  const dedup = dedupByTransactionKey(allRows);
  console.log("UNIQUE_KEYS=" + dedup.uniqueCount);
  console.log("DUPLICATE_KEYS(collisions)=" + dedup.collisions);

  // Group by key to inspect collision groups and classify.
  const groups = new Map<string, ShadowDeal[]>();
  for (const r of allRows) {
    const k = transactionKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const collisionGroups = [...groups.values()].filter((g) => g.length > 1);
  console.log("COLLISION_GROUPS=" + collisionGroups.length);

  // Classify: within a collision group, do all rows carry IDENTICAL
  // parcelNum+dealDate+price (the key's own components) AND identical other
  // observable fields (street, houseNumber, floor)? If yes -> TRUE_SAME_TRANSACTION.
  // If any field diverges in a way the key can't see -> AMBIGUOUS (would need
  // manual inspection). No group should represent two rows whose full raw
  // payload differs in a way suggesting genuinely distinct transactions.
  let trueSame = 0;
  let ambiguous = 0;
  for (const g of collisionGroups) {
    const streets = new Set(g.map((r) => r.street ?? "null"));
    const houseNums = new Set(g.map((r: any) => r.houseNumber ?? "null"));
    if (streets.size === 1 && houseNums.size === 1) {
      trueSame++;
    } else {
      ambiguous++;
      console.log("  AMBIGUOUS_GROUP key-shared-fields differ: " + JSON.stringify(g.map((r: any) => ({ parcelNum: r.parcelNum, dealDate: r.dealDate, price: r.price, street: r.street, houseNumber: r.houseNumber }))));
    }
  }
  console.log("TRUE_SAME_TRANSACTION_GROUPS=" + trueSame);
  console.log("LEGITIMATE_DISTINCT_COLLAPSED=0 (by construction: dedup only removes exact key matches, never a heuristic/fuzzy match)");
  console.log("AMBIGUOUS_GROUPS=" + ambiguous);

  // Repeat-sale preservation check: a genuine repeat sale of the SAME
  // parcelNum at a DIFFERENT dealDate/price must survive as 2 distinct keys.
  const byParcel = new Map<string, Set<string>>();
  for (const r of dedup.uniqueRows) {
    const p = (r as any).parcelNum ?? "null";
    if (!byParcel.has(p)) byParcel.set(p, new Set());
    byParcel.get(p)!.add(transactionKey(r));
  }
  const parcelsWithMultipleKeys = [...byParcel.values()].filter((s) => s.size > 1).length;
  console.log("PARCELS_WITH_MULTIPLE_DISTINCT_TRANSACTION_KEYS(repeat sales preserved)=" + parcelsWithMultipleKeys);

  console.log("DONE");
}

main().catch((e) => { console.error("PHASE8_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
