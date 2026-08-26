import { describe, it, expect } from "vitest";
import {
  toShadowDeal,
  parsePaginationContract,
  dedupByTransactionKey,
  transactionKey,
  assertSafeShadowOutputPath,
  type ShadowDeal,
} from "../shadowRebuild";
import type { Neighborhood } from "../types";

const NEIGHBORHOOD: Neighborhood = { id: "65210195", name: "נוף הטיילת", settlement: "נתניה", x: 100, y: 200 };

function rawItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    dealAmount: 2650000,
    dealDate: "2026-01-29",
    assetArea: 65,
    roomNum: 0,
    dealNature: "דירת נופש",
    parcelNum: "8252-156-59",
    address: "עובד בן עמי 41",
    neighborhoodId: 65210195,
    ...overrides,
  };
}

describe("TEST I — raw dealNature survives normalization into the shadow shape (Phase 12)", () => {
  it("preserves rawDealNature separately from the derived propertyType", () => {
    const shadow = toShadowDeal(rawItem({ dealNature: "דירת נופש" }), NEIGHBORHOOD, "65210195")!;
    expect(shadow.rawDealNature).toBe("דירת נופש");
    expect(shadow.dealNature).toBe("דירת נופש"); // base Deal field also preserved
    expect(shadow.propertyType).toBe("apartment"); // derived — both coexist, neither overwrites the other
  });

  it("carries parcelNum and sourceId through unchanged", () => {
    const shadow = toShadowDeal(rawItem({ parcelNum: "8252-156-60" }), NEIGHBORHOOD, "65210195")!;
    expect(shadow.parcelNum).toBe("8252-156-60");
    expect(shadow.sourceId).toBe("65210195");
  });

  it("maps a missing parcelNum to null, never to a fabricated placeholder", () => {
    const shadow = toShadowDeal(rawItem({ parcelNum: undefined }), NEIGHBORHOOD, "65210195")!;
    expect(shadow.parcelNum).toBeNull();
  });

  it("returns null (fails closed) for a row with no usable price, same as the shared normalizeDeal", () => {
    expect(toShadowDeal(rawItem({ dealAmount: null }), NEIGHBORHOOD, "65210195")).toBeNull();
  });
});

describe("TEST D — runtime pagination contract is read, never hardcoded", () => {
  it("reads total_rows/total_fetch/total_page from data.* (the actual response field set)", () => {
    const decoded = { data: { total_rows: 1276, total_fetch: 3, total_page: 128, items: [] } };
    expect(parsePaginationContract(decoded, "65210195")).toEqual({
      sourceId: "65210195", totalRows: 1276, totalFetch: 3, totalPage: 128,
    });
  });

  it("maps missing/non-numeric fields to null rather than a guessed default (e.g. never defaults to 500)", () => {
    expect(parsePaginationContract({ data: {} }, "65210195")).toEqual({
      sourceId: "65210195", totalRows: null, totalFetch: null, totalPage: null,
    });
    expect(parsePaginationContract({ data: { total_rows: "1276" } }, "65210195").totalRows).toBeNull();
  });

  it("tolerates a response with no data wrapper at all", () => {
    expect(parsePaginationContract(null, "65210195")).toEqual({
      sourceId: "65210195", totalRows: null, totalFetch: null, totalPage: null,
    });
  });

  it("does NOT read fetch_number from the response — that field only exists on the request, never the response (Wave 0G-12 finding)", () => {
    const decoded = { data: { total_rows: 500, total_fetch: 1, total_page: 50, fetch_number: 1, items: [] } };
    const contract = parsePaginationContract(decoded, "65210195") as any;
    expect(contract.fetchNumber).toBeUndefined();
  });
});

describe("TEST G/H — dedup preserves repeat sales, collapses true duplicates", () => {
  it("TEST H: collapses identical rows re-seen through overlapping fetch/sort windows", () => {
    const row = toShadowDeal(rawItem(), NEIGHBORHOOD, "65210195")!;
    const result = dedupByTransactionKey([row, { ...row }, { ...row }]);
    expect(result.rawCount).toBe(3);
    expect(result.uniqueCount).toBe(1);
    expect(result.collisions).toBe(2);
  });

  it("TEST G: preserves two legitimate sales of the SAME property on different dates/prices", () => {
    const sale1 = toShadowDeal(rawItem({ parcelNum: "8247-229-80", dealDate: "2013-07-08", dealAmount: 1550000 }), NEIGHBORHOOD, "65210195")!;
    const sale2 = toShadowDeal(rawItem({ parcelNum: "8247-229-80", dealDate: "2026-01-29", dealAmount: 2650000 }), NEIGHBORHOOD, "65210195")!;
    const result = dedupByTransactionKey([sale1, sale2]);
    expect(result.uniqueCount).toBe(2); // NOT collapsed just because parcelNum matches
    expect(result.collisions).toBe(0);
  });

  it("does not use parcelNum alone as the key — two DIFFERENT properties sold same-day-same-price must NOT collapse if parcelNum differs", () => {
    const a = toShadowDeal(rawItem({ parcelNum: "8231-1-1", dealDate: "2024-01-01", dealAmount: 1000000 }), NEIGHBORHOOD, "65210195")!;
    const b = toShadowDeal(rawItem({ parcelNum: "8231-1-2", dealDate: "2024-01-01", dealAmount: 1000000 }), NEIGHBORHOOD, "65210195")!;
    expect(transactionKey(a)).not.toBe(transactionKey(b));
    expect(dedupByTransactionKey([a, b]).uniqueCount).toBe(2);
  });
});

describe("TEST E/F — output-path guard refuses canonical data and Supabase", () => {
  it("TEST E: throws on data/deals.json in any path form", () => {
    expect(() => assertSafeShadowOutputPath("data/deals.json")).toThrow(/UNSAFE_OUTPUT_PATH/);
    expect(() => assertSafeShadowOutputPath("C:\\leads\\data\\deals.json")).toThrow(/UNSAFE_OUTPUT_PATH/);
    expect(() => assertSafeShadowOutputPath("./audit/../data/deals.json")).toThrow(/UNSAFE_OUTPUT_PATH/);
  });

  it("also refuses data/neighborhoods.json", () => {
    expect(() => assertSafeShadowOutputPath("data/neighborhoods.json")).toThrow(/UNSAFE_OUTPUT_PATH/);
  });

  it("TEST F: throws on any Supabase-shaped path", () => {
    expect(() => assertSafeShadowOutputPath("audit/wave0g12/supabase-export.json")).toThrow(/UNSAFE_OUTPUT_PATH/);
  });

  it("throws on an empty or non-string path rather than silently no-op-ing", () => {
    expect(() => assertSafeShadowOutputPath("")).toThrow(/UNSAFE_OUTPUT_PATH/);
    expect(() => assertSafeShadowOutputPath(undefined as unknown as string)).toThrow(/UNSAFE_OUTPUT_PATH/);
  });

  it("accepts a legitimate audit/ shadow output path", () => {
    expect(() => assertSafeShadowOutputPath("audit/wave0g12/shadow/nof_hatayelet.json")).not.toThrow();
  });

  it("refuses a path outside audit/ or tmp/scratch (shadow output must be explicit and isolated)", () => {
    expect(() => assertSafeShadowOutputPath("lib/somewhere.json")).toThrow(/UNSAFE_OUTPUT_PATH/);
  });

  it("resolves traversal segments before checking — a label like '../../data/deals' cannot pass by containing the literal text 'audit/' from a fixed prefix (Wave 0G-12 hardening)", () => {
    expect(() => assertSafeShadowOutputPath("audit/wave0g12/shadow/../../../data/deals.json")).toThrow(/UNSAFE_OUTPUT_PATH/);
    expect(() => assertSafeShadowOutputPath("audit/../data/neighborhoods.json")).toThrow(/UNSAFE_OUTPUT_PATH/);
  });
});

describe("dedup diagnostic counts (Wave 0G-12 hardening — ECC database-reviewer finding)", () => {
  it("reports nullParcelNumCount/emptyDealDateCount so the edge case is visible, not silently possible", () => {
    const withParcel = toShadowDeal({ dealAmount: 1000000, dealDate: "2024-01-01", assetArea: 50, parcelNum: "8231-1-1" }, NEIGHBORHOOD, "65210195")!;
    const noParcel = toShadowDeal({ dealAmount: 2000000, dealDate: "2024-01-02", assetArea: 60 }, NEIGHBORHOOD, "65210195")!;
    const result = dedupByTransactionKey([withParcel, noParcel]);
    expect(result.nullParcelNumCount).toBe(1);
    expect(result.emptyDealDateCount).toBe(0);
  });

  it("a real parcelNum (digits and hyphens only) can never equal or be confused with the null sentinel", () => {
    // Every observed real parcelNum matches this shape; the sentinel deliberately uses characters outside it.
    const realParcelShape = /^[0-9]+-[0-9]+-[0-9]+$/;
    const a = toShadowDeal({ dealAmount: 1000000, dealDate: "2024-01-01", assetArea: 50, parcelNum: "8231-1-1" }, NEIGHBORHOOD, "65210195")!;
    expect(realParcelShape.test(a.parcelNum!)).toBe(true);
    expect(a.parcelNum).not.toMatch(/∅|NULL_PARCEL/);
  });

  it("two rows with null parcelNum, empty dealDate, and the same price no longer silently collapse (hasDate flag distinguishes them if dates differ even as empty-vs-present)", () => {
    const noDate1 = toShadowDeal({ dealAmount: 1000000, assetArea: 50 }, NEIGHBORHOOD, "65210195")!; // dealDate becomes ""
    const noDate2 = toShadowDeal({ dealAmount: 1000000, assetArea: 60 }, NEIGHBORHOOD, "65210195")!; // also ""
    // These two genuinely CANNOT be distinguished by any field this schema carries
    // (both null parcelNum, both empty date, same price) — documenting the known
    // residual limit rather than claiming it's solved: this pair DOES still collapse.
    const result = dedupByTransactionKey([noDate1, noDate2]);
    expect(result.emptyDealDateCount).toBe(2);
    expect(result.nullParcelNumCount).toBe(2);
    expect(result.uniqueCount).toBe(1); // honest residual limit: these DO still collapse
    // The diagnostic counts make this visible; a caller can refuse to trust an
    // entity with a non-zero count instead of it passing silently unnoticed.
    // None of this wave's 3 pilot entities had any such row (0/2384 total).
  });
});
