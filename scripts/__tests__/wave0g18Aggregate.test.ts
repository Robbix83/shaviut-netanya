/**
 * scripts/__tests__/wave0g18Aggregate.test.ts — Wave 0G-18 Phase 23 focused
 * tests for the aggregator's pure transaction-classification logic
 * (classifyTransactionGroups). Covers items E (entity/street duplicate
 * collapse), F (street/street duplicate collapse), G (ambiguous collision
 * fails), and the AUGMENTED_UNIQUE overflow guard (Phase 10 STOP
 * condition). The aggregator's I/O (loading 70 street files, writing
 * CSVs/JSON) was validated live against the real Wave 0G-18 run — see
 * audit/wave0g18/KIRYAT_HASHARON_STREET_AUGMENTATION.md.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { classifyTransactionGroups } from "../audit-wave0g18-aggregate";
import type { ShadowDeal } from "../../lib/shadowRebuild";

describe("REGRESSION — importing this module for its pure function must never run the live aggregation", () => {
  it("main() is guarded by the same pathToFileURL isDirectExecution check as the Wave 0G-16/0G-18 runners (caught live: an unguarded version printed '=== WAVE 0G-18 AGGREGATION' during vitest collection)", () => {
    const src = readFileSync(path.join(__dirname, "..", "audit-wave0g18-aggregate.ts"), "utf8");
    expect(src).toMatch(/const isDirectExecution = typeof process\.argv\[1\] === "string" && import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href;/);
    expect(src).toMatch(/if \(isDirectExecution\) \{\s*main\(\)/);
  });
});

function row(overrides: Partial<ShadowDeal> = {}): ShadowDeal {
  return {
    id: "x", dealDate: "2024-01-01", price: 1000000, propertyType: "apartment",
    rooms: 3, areaSqm: 80, plotSqm: null, floor: 2, yearBuilt: null, dealNature: null,
    address: "רחוב 1", street: "רחוב", houseNumber: "1", neighborhoodId: "65209683", neighborhood: "n",
    settlement: "נתניה", x: null, y: null, pricePerSqm: null,
    sourceId: "65209683", parcelNum: "8252-100-1", rawDealNature: null,
    ...overrides,
  } as ShadowDeal;
}

describe("E — entity/street duplicate collapses (baseline row re-observed via a street query)", () => {
  it("a street row identical (same key, same non-key fields) to a baseline row collapses — no addition, counted as trueDuplicateEntityVsStreet", () => {
    const baseline = [row({ parcelNum: "1-1-1" })];
    const street = [{ streetId: "S1", rows: [row({ parcelNum: "1-1-1" })] }];
    const result = classifyTransactionGroups(baseline, street);
    expect(result.trueDuplicateEntityVsStreet).toBe(1);
    expect(result.genuinelyNewStreetRows).toBe(0);
    expect(result.augmentedUnion).toHaveLength(1); // baseline's own copy only, not doubled
  });
});

describe("F — street/street duplicate collapses (same transaction observed via 2 different streets, absent from baseline)", () => {
  it("collapses to exactly 1 new unique row, counted as trueDuplicateStreetVsStreet", () => {
    const baseline: ShadowDeal[] = [];
    const street = [
      { streetId: "S1", rows: [row({ parcelNum: "2-2-2" })] },
      { streetId: "S2", rows: [row({ parcelNum: "2-2-2" })] },
    ];
    const result = classifyTransactionGroups(baseline, street);
    expect(result.trueDuplicateStreetVsStreet).toBe(1);
    expect(result.genuinelyNewStreetRows).toBe(1);
    expect(result.augmentedUnion).toHaveLength(1);
  });
});

describe("G — ambiguous collision fails (isolated, never merged either direction)", () => {
  it("a same-key group whose members disagree on non-key fields is isolated, not added to the union", () => {
    const baseline: ShadowDeal[] = [];
    const street = [
      { streetId: "S1", rows: [row({ parcelNum: "3-3-3", street: "רחוב א", houseNumber: "5" })] },
      { streetId: "S2", rows: [row({ parcelNum: "3-3-3", street: "רחוב ב", houseNumber: "9" })] },
    ];
    const result = classifyTransactionGroups(baseline, street);
    expect(result.ambiguousCollisions).toBe(1);
    expect(result.genuinelyNewStreetRows).toBe(0);
    expect(result.trueDuplicateStreetVsStreet).toBe(0);
    expect(result.augmentedUnion).toHaveLength(0);
    expect(result.ambiguousExamples).toHaveLength(1);
  });

  it("an ambiguous collision between a baseline row and a street row is also isolated, not silently kept as the baseline's copy", () => {
    const baseline = [row({ parcelNum: "4-4-4", floor: 2 })];
    const street = [{ streetId: "S1", rows: [row({ parcelNum: "4-4-4", floor: 9 })] }];
    const result = classifyTransactionGroups(baseline, street);
    expect(result.ambiguousCollisions).toBe(1);
    expect(result.trueDuplicateEntityVsStreet).toBe(0);
    // The baseline row itself is still present (augmentedUnion always starts
    // from the full baseline) — only the disputed STREET copy is excluded.
    expect(result.augmentedUnion).toHaveLength(1);
  });
});

describe("A genuinely new, single-occurrence street row is added without needing a duplicate to compare against", () => {
  it("a street row with a key seen nowhere else becomes genuinely new", () => {
    const baseline = [row({ parcelNum: "5-5-5" })];
    const street = [{ streetId: "S1", rows: [row({ parcelNum: "6-6-6" })] }];
    const result = classifyTransactionGroups(baseline, street);
    expect(result.genuinelyNewStreetRows).toBe(1);
    expect(result.augmentedUnion).toHaveLength(2);
  });
});

describe("legitimate repeat sale (same parcelNum, different date/price) is never collapsed or flagged ambiguous", () => {
  it("two rows sharing parcelNum but differing in dealDate get distinct transactionKeys, both kept", () => {
    const baseline: ShadowDeal[] = [];
    const street = [{ streetId: "S1", rows: [
      row({ parcelNum: "7-7-7", dealDate: "2020-01-01", price: 900000 }),
      row({ parcelNum: "7-7-7", dealDate: "2023-06-01", price: 1500000 }),
    ] }];
    const result = classifyTransactionGroups(baseline, street);
    expect(result.ambiguousCollisions).toBe(0);
    expect(result.genuinelyNewStreetRows).toBe(2);
    expect(result.augmentedUnion).toHaveLength(2);
  });
});

describe("streetUniqueWithinStreetCorpus counts every distinct key touched by ANY street, including ones also in baseline", () => {
  it("counts both a baseline-duplicate key and a genuinely-new key", () => {
    const baseline = [row({ parcelNum: "8-8-8" })];
    const street = [{ streetId: "S1", rows: [row({ parcelNum: "8-8-8" }), row({ parcelNum: "9-9-9" })] }];
    const result = classifyTransactionGroups(baseline, street);
    expect(result.streetUniqueWithinStreetCorpus).toBe(2);
  });
});
