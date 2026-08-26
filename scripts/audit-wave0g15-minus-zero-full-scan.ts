/**
 * scripts/audit-wave0g15-minus-zero-full-scan.ts — Wave 0G-15 follow-up
 * check (prompted by ECC planner finding): scan the FULL 2010-row final
 * union (not just this wave's 5 newly recovered rows) for "-0" parcelNum
 * rows, to see whether the delta=2 residual has any concrete footprint of
 * the key-collision risk (two distinct same-building transactions sharing
 * parcelNum+dealDate+price) rather than being purely hypothetical.
 * READ-ONLY, no new network calls.
 */
import { promises as fs } from "fs";
import path from "path";
import { toShadowDeal, dedupByTransactionKey, type ShadowDeal } from "../lib/shadowRebuild";
import type { Neighborhood } from "../lib/types";

async function loadRawBatch(file: string, expectedTypeOrders: string[], neighborhood: Neighborhood): Promise<ShadowDeal[]> {
  const raw = JSON.parse(await fs.readFile(path.join(process.cwd(), file), "utf8"));
  const exchanges = Array.isArray(raw) ? raw.filter((e: any) => expectedTypeOrders.includes(e.typeOrder)) : [];
  const items = exchanges.flatMap((e: any) => e.items ?? []);
  return items.map((r: any) => toShadowDeal(r, neighborhood, "65210248")).filter((d: ShadowDeal | null): d is ShadowDeal => d !== null);
}

async function main() {
  const neighborhood: Neighborhood = { id: "65210248", name: "רסקו", settlement: "נתניה", x: null, y: null };

  const wave13Union = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit/wave0g13/shadow/rasko_four_window_union.json"), "utf8"));
  const dateRows: ShadowDeal[] = wave13Union.uniqueRows;
  const priceDescRows = await loadRawBatch("audit/wave0g14/shadow/rasko_price_sort_raw.json", ["dealAmount_down"], neighborhood);
  const roomsDescRows = await loadRawBatch("audit/wave0g14/shadow/rasko_rooms_sort_raw.json", ["roomNum_down"], neighborhood);
  const priceAscRows = await loadRawBatch("audit/wave0g15/shadow/rasko_price_asc_raw.json", ["dealAmount_up"], neighborhood);
  const roomsAscRows = await loadRawBatch("audit/wave0g15/shadow/rasko_rooms_asc_raw.json", ["roomNum_up"], neighborhood);

  const allRows = [...dateRows, ...priceDescRows, ...roomsDescRows, ...priceAscRows, ...roomsAscRows];
  const dedup = dedupByTransactionKey(allRows);
  console.log("FULL_UNION_SIZE=" + dedup.uniqueCount);

  const minusZeroRows = dedup.uniqueRows.filter((r: any) => r.parcelNum && String(r.parcelNum).endsWith("-0"));
  console.log("TOTAL_MINUS_ZERO_ROWS_IN_FULL_UNION=" + minusZeroRows.length);

  // Group minus-zero rows by their base parcel (gush-helka, stripping the
  // "-0" subparcel suffix) to see if the SAME building/aggregate parcel has
  // multiple distinct top-level transactions — the exact scenario where a
  // date+price coincidence could theoretically cause an undetected collapse.
  const byBaseParcel = new Map<string, ShadowDeal[]>();
  for (const r of minusZeroRows) {
    const base = String((r as any).parcelNum).replace(/-0$/, "");
    if (!byBaseParcel.has(base)) byBaseParcel.set(base, []);
    byBaseParcel.get(base)!.push(r);
  }
  const multiTransactionBaseParcel = [...byBaseParcel.entries()].filter(([, rows]) => rows.length > 1);
  console.log("BASE_PARCELS_WITH_MULTIPLE_MINUS_ZERO_TRANSACTIONS=" + multiTransactionBaseParcel.length);
  for (const [base, rows] of multiTransactionBaseParcel) {
    console.log(`  BASE_PARCEL=${base} COUNT=${rows.length}`);
    for (const r of rows) console.log(`    dealDate=${r.dealDate} price=${r.price} street=${r.street ?? "?"}`);
  }

  if (minusZeroRows.length > 0 && multiTransactionBaseParcel.length === 0) {
    console.log("FINDING=Minus-zero rows exist in the union but none share a base parcel with another minus-zero row — no concrete evidence of a collapsed collision this wave, though the theoretical risk (two DIFFERENT base parcels each ending -0, or two same-base-parcel transactions with a DIFFERENT date/price that a future acquisition might reveal) remains unaddressed by this key design.");
  } else if (minusZeroRows.length === 0) {
    console.log("FINDING=No minus-zero parcelNum rows present anywhere in the full 2010-row Rasko union — the collision-risk theory has zero concrete footprint in this entity's tested data.");
  }

  console.log("DONE");
}

main().catch((e) => { console.error("SCAN_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
