import { describe, it, expect } from "vitest";
import { normalizeDeal, classifyPropertyType, parseAddress, parseFloor, num, buildTransactionIdSuffix, mergeIncrementalDeals } from "../dealNormalization";
import type { Neighborhood, Deal } from "../types";

/**
 * Regression coverage for the Wave 0G-12 extraction of scripts/harvest.ts's
 * inline normalize()/helpers into this shared module. Confirms the
 * behavior is unchanged (same logic, moved, streetCoords now a parameter).
 */

const NEIGHBORHOOD: Neighborhood = { id: "65210195", name: "נוף הטיילת", settlement: "נתניה", x: 100, y: 200 };

describe("normalizeDeal — unchanged behavior after extraction from scripts/harvest.ts", () => {
  it("keeps raw dealNature AND derives propertyType — both coexist", () => {
    const deal = normalizeDeal({ dealAmount: 2650000, dealDate: "2026-01-29", assetArea: 65, dealNature: "דירת נופש" }, NEIGHBORHOOD)!;
    expect(deal.dealNature).toBe("דירת נופש");
    expect(deal.propertyType).toBe("apartment");
  });

  it("rejects a row with no usable price", () => {
    expect(normalizeDeal({ dealDate: "2024-01-01" }, NEIGHBORHOOD)).toBeNull();
  });

  it("falls back to the neighborhood's own x/y when no street coordinate is known", () => {
    const deal = normalizeDeal({ dealAmount: 1000000, dealDate: "2024-01-01", assetArea: 50 }, NEIGHBORHOOD, {})!;
    expect(deal).toMatchObject({ x: 100, y: 200 });
  });

  it("prefers a street-level coordinate when available", () => {
    const deal = normalizeDeal(
      { dealAmount: 1000000, dealDate: "2024-01-01", assetArea: 50, streetName: "הרצל" },
      NEIGHBORHOOD,
      { הרצל: { x: 999, y: 888 } },
    )!;
    expect(deal).toMatchObject({ x: 999, y: 888 });
  });

  it("classifies land vs apartment vs house from dealNature text", () => {
    expect(classifyPropertyType("מגרש לבנייה")).toBe("land");
    expect(classifyPropertyType("דירה בבית קומות")).toBe("apartment");
    expect(classifyPropertyType("בית דו משפחתי")).toBe("house");
  });

  it("parses street + house number out of a combined address string", () => {
    expect(parseAddress("עובד בן עמי 41")).toEqual({ street: "עובד בן עמי", houseNumber: "41" });
  });

  it("converts Hebrew floor words to numbers", () => {
    expect(parseFloor("שביעית")).toBe(7);
    expect(parseFloor("קרקע")).toBe(0);
    expect(parseFloor(3)).toBe(3);
  });

  it("cleans a currency-formatted number string", () => {
    expect(num("3,251,000 ₪")).toBe(3251000);
  });
});

/**
 * Regression coverage for Wave 0G-L1D: the id-fallback formula used to be
 * dealDate+price+area only (no parcelNum), which collided at V2's ~59k-row
 * citywide scale (116 rows / 103 distinct ids — see
 * audit/launch/L1_SUPABASE_V2_PREVIEW_IMPORT.md). Fixed by reusing the
 * already-proven parcelNum+dealDate+dealAmount transaction key from
 * lib/shadowRebuild.ts's transactionKey() (Wave 0G-10/0G-12).
 */
describe("normalizeDeal id fallback — parcelNum-based transaction key (Wave 0G-L1D fix)", () => {
  it("two DIFFERENT real transactions with identical date/price/area now get DISTINCT ids when parcelNum differs (the actual bug this fixes)", () => {
    // Real case found in production data: 65209703, 2012-02-16, ₪2,900,000, 140sqm —
    // two genuinely different sales, disambiguated only by parcelNum.
    const a = normalizeDeal(
      { dealAmount: 2900000, dealDate: "2012-02-16", assetArea: 140, parcelNum: "9039-18-101" },
      NEIGHBORHOOD,
    )!;
    const b = normalizeDeal(
      { dealAmount: 2900000, dealDate: "2012-02-16", assetArea: 140, parcelNum: "9041-12-5" },
      NEIGHBORHOOD,
    )!;
    expect(a.id).not.toBe(b.id);
  });

  it("still resolves the case where street/houseNumber are unusable (street='0', no house number) — parcelNum alone disambiguates it", () => {
    const a = normalizeDeal(
      { dealAmount: 2900000, dealDate: "2012-02-16", assetArea: 140, parcelNum: "9039-18-101", address: "0" },
      NEIGHBORHOOD,
    )!;
    const b = normalizeDeal(
      { dealAmount: 2900000, dealDate: "2012-02-16", assetArea: 140, parcelNum: "9041-12-5", address: "0" },
      NEIGHBORHOOD,
    )!;
    expect(a.street).toBe("0");
    expect(a.houseNumber).toBeNull();
    expect(a.id).not.toBe(b.id);
  });

  it("two rows with the SAME parcelNum/date/price still get the SAME id (a true duplicate, not a regression)", () => {
    const a = normalizeDeal({ dealAmount: 1000000, dealDate: "2024-01-01", assetArea: 50, parcelNum: "8231-1-1" }, NEIGHBORHOOD)!;
    const b = normalizeDeal({ dealAmount: 1000000, dealDate: "2024-01-01", assetArea: 50, parcelNum: "8231-1-1" }, NEIGHBORHOOD)!;
    expect(a.id).toBe(b.id);
  });

  it("still produces a stable id when parcelNum is absent (null-parcel sentinel path)", () => {
    const deal = normalizeDeal({ dealAmount: 1000000, dealDate: "2024-01-01", assetArea: 50 }, NEIGHBORHOOD)!;
    expect(deal.id).toBe(`${NEIGHBORHOOD.id}-${buildTransactionIdSuffix(null, "2024-01-01", 1000000)}`);
  });

  it("prefers raw.keyValue/raw.dealId over the parcelNum-based fallback when the source actually provides one", () => {
    const deal = normalizeDeal({ dealAmount: 1000000, dealDate: "2024-01-01", assetArea: 50, keyValue: "REAL-SOURCE-KEY-123" }, NEIGHBORHOOD)!;
    expect(deal.id).toBe(`${NEIGHBORHOOD.id}-REAL-SOURCE-KEY-123`);
  });

  it("the hasDate flag reaches through normalizeDeal() — a missing dealDate never silently matches a present one at the same price/no-parcelNum", () => {
    const noDate = normalizeDeal({ dealAmount: 1000000, assetArea: 50 }, NEIGHBORHOOD)!; // dealDate becomes ""
    const withDate = normalizeDeal({ dealAmount: 1000000, dealDate: "2024-01-01", assetArea: 50 }, NEIGHBORHOOD)!;
    expect(noDate.dealDate).toBe("");
    expect(noDate.id).not.toBe(withDate.id);
  });

  it("every generated id keeps the neighborhoodId prefix, unchanged by this fix", () => {
    const deal = normalizeDeal({ dealAmount: 1000000, dealDate: "2024-01-01", assetArea: 50, parcelNum: "8231-1-1" }, NEIGHBORHOOD)!;
    expect(deal.id.startsWith(`${NEIGHBORHOOD.id}-`)).toBe(true);
  });
});

/**
 * Regression coverage for Wave 0G-L1E: scripts/harvest.ts's incremental
 * merge (HARVEST_ONLY/HARVEST_STREET) used to dedupe existing+fresh deals
 * by `id` alone. After Wave 0G-L1D changed the id fallback to a
 * parcelNum-based key, existing rows (harvested before that fix, OLD-
 * format id) would no longer be recognized as already-present when the
 * SAME real transaction is re-normalized under the NEW formula — silently
 * re-added as a duplicate. mergeIncrementalDeals() fixes this with a
 * secondary, format-independent content match.
 */
function dealFixture(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "OLD-FORMAT-ID",
    dealDate: "2024-01-01",
    price: 1000000,
    propertyType: "apartment",
    rooms: 3,
    areaSqm: 80,
    plotSqm: null,
    floor: 2,
    yearBuilt: 2000,
    dealNature: "דירה בבית קומות",
    address: "רחוב הבדיקה 1",
    houseNumber: "1",
    street: "רחוב הבדיקה",
    neighborhoodId: "65210195",
    neighborhood: "נוף הטיילת",
    settlement: "נתניה",
    x: 100,
    y: 200,
    pricePerSqm: 12500,
    ...overrides,
  };
}

describe("mergeIncrementalDeals — id-format-aware incremental merge (Wave 0G-L1E fix)", () => {
  it("never drops an existing row, even one with no fresh counterpart", () => {
    const existing = [dealFixture({ id: "OLD-1" })];
    const result = mergeIncrementalDeals(existing, []);
    expect(result.merged).toEqual(existing);
    expect(result.addedCount).toBe(0);
    expect(result.skippedDuplicateCount).toBe(0);
  });

  it("adds a genuinely new fresh transaction (different content, different id)", () => {
    const existing = [dealFixture({ id: "OLD-1", price: 1000000 })];
    const fresh = [dealFixture({ id: "NEW-1", price: 2000000, dealDate: "2024-06-01" })];
    const result = mergeIncrementalDeals(existing, fresh);
    expect(result.merged.length).toBe(2);
    expect(result.addedCount).toBe(1);
    expect(result.skippedDuplicateCount).toBe(0);
  });

  it("THE ACTUAL BUG: recognizes a re-normalized existing transaction as a duplicate even though its id changed format (old id vs. new parcelNum-based id)", () => {
    // Existing row harvested before Wave 0G-L1D — OLD-format id, no parcelNum captured.
    const existing = [
      dealFixture({ id: "65210195-2024-01-01-1000000-80", neighborhoodId: "65210195", dealDate: "2024-01-01", price: 1000000, areaSqm: 80 }),
    ];
    // Same real transaction, re-harvested after the fix — NEW-format (parcelNum-based) id.
    const reharvested = [
      dealFixture({
        id: `65210195-${buildTransactionIdSuffix("8231-1-1", "2024-01-01", 1000000)}`,
        neighborhoodId: "65210195",
        dealDate: "2024-01-01",
        price: 1000000,
        areaSqm: 80,
      }),
    ];
    const result = mergeIncrementalDeals(existing, reharvested);
    expect(result.merged.length).toBe(1); // NOT silently duplicated
    expect(result.addedCount).toBe(0);
    expect(result.skippedDuplicateCount).toBe(1);
    expect(result.merged[0].id).toBe(existing[0].id); // the existing row's id is untouched
  });

  it("also dedupes fresh rows against each other (mirrors the old Set-based intra-run behavior)", () => {
    const dup = dealFixture({ id: "FRESH-1", price: 3000000, dealDate: "2024-09-01" });
    const result = mergeIncrementalDeals([], [dup, { ...dup }]);
    expect(result.merged.length).toBe(1);
    expect(result.addedCount).toBe(1);
    expect(result.skippedDuplicateCount).toBe(1);
  });

  it("REGRESSION (ECC planner finding): two genuinely DIFFERENT fresh transactions sharing neighborhoodId+dealDate+price+area are BOTH kept — fresh-vs-fresh comparison must use id only, never legacyMatchKey, since fresh ids are already collision-resistant (Wave 0G-L1D)", () => {
    const a = dealFixture({
      id: `65210195-${buildTransactionIdSuffix("8231-1-1", "2024-01-01", 1000000)}`,
      street: "רחוב א",
      houseNumber: "9",
    });
    const b = dealFixture({
      id: `65210195-${buildTransactionIdSuffix("8231-1-2", "2024-01-01", 1000000)}`,
      street: "רחוב א",
      houseNumber: "7",
    });
    expect(a.id).not.toBe(b.id); // distinct real transactions, distinct new-format ids
    const result = mergeIncrementalDeals([], [a, b]);
    expect(result.merged.length).toBe(2); // NOT collapsed by the lossy legacy key
    expect(result.addedCount).toBe(2);
    expect(result.skippedDuplicateCount).toBe(0);
  });

  it("legacyMatchKey includes propertyType — a land parcel and a house sharing neighborhoodId+dealDate+price+plotSqm do not falsely collide (ECC silent-failure-hunter finding)", () => {
    const existing = [
      dealFixture({ id: "OLD-LAND-1", propertyType: "land", areaSqm: null, plotSqm: 500, dealNature: "מגרש" }),
    ];
    const fresh = [
      dealFixture({ id: "NEW-HOUSE-1", propertyType: "house", areaSqm: null, plotSqm: 500, dealNature: "בית" }),
    ];
    const result = mergeIncrementalDeals(existing, fresh);
    expect(result.merged.length).toBe(2); // both kept — different propertyType, not a real duplicate
    expect(result.addedCount).toBe(1);
    expect(result.skippedDuplicateCount).toBe(0);
  });

  it("honest residual limit: two genuinely different transactions sharing neighborhoodId+dealDate+price+area are still treated as one (documented, not silently pretended away)", () => {
    const existing = [dealFixture({ id: "OLD-1", street: "רחוב א", houseNumber: "9" })];
    const fresh = [dealFixture({ id: "NEW-1", street: "רחוב א", houseNumber: "7" })]; // different building, same date/price/area
    const result = mergeIncrementalDeals(existing, fresh);
    expect(result.merged.length).toBe(1); // the genuinely different "houseNumber:7" transaction is skipped
    expect(result.skippedDuplicateCount).toBe(1);
  });

  it("preserves existing rows' relative order and keeps them ahead of newly-added rows", () => {
    const existing = [dealFixture({ id: "OLD-1", price: 1 }), dealFixture({ id: "OLD-2", price: 2 })];
    const fresh = [dealFixture({ id: "NEW-1", price: 3 })];
    const result = mergeIncrementalDeals(existing, fresh);
    expect(result.merged.map((d) => d.id)).toEqual(["OLD-1", "OLD-2", "NEW-1"]);
  });
});
