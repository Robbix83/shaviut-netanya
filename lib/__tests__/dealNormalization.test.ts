import { describe, it, expect } from "vitest";
import { normalizeDeal, classifyPropertyType, parseAddress, parseFloor, num, buildTransactionIdSuffix } from "../dealNormalization";
import type { Neighborhood } from "../types";

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
