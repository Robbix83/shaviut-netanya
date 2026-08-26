import { describe, it, expect } from "vitest";
import { normalizeDeal, classifyPropertyType, parseAddress, parseFloor, num } from "../dealNormalization";
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
