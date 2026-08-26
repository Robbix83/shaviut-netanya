import { describe, it, expect } from "vitest";
import { toShadowDeal, dedupByTransactionKey } from "../shadowRebuild";
import type { Neighborhood } from "../types";

/**
 * Wave 0G-13 regression anchors — real examples discovered this wave,
 * captured as tests so future changes to lib/shadowRebuild.ts can't
 * silently regress the behavior this wave's live investigation depended on.
 * No new reusable logic was added this wave (only existing shared functions
 * were reused), so these tests exercise the EXISTING dedup/normalize path
 * against the specific real-world shapes this wave found.
 */

const NEIGHBORHOOD: Neighborhood = { id: "65210195", name: "נוף הטיילת", settlement: "נתניה", x: null, y: null };

describe("TEST A — DESC + ASC windows dedup safely (real Rasko example, Wave 0G-13)", () => {
  it("two non-overlapping sort-direction windows (zero shared transactions) union to the sum of both, no false collapse", () => {
    const descRow = toShadowDeal({ dealAmount: 2660000, dealDate: "2024-01-16", assetArea: 100, parcelNum: "8274-516-132" }, NEIGHBORHOOD, "65210248")!;
    const ascRow = toShadowDeal({ dealAmount: 1550000, dealDate: "2018-05-29", assetArea: 107.63, parcelNum: "8274-118-10" }, NEIGHBORHOOD, "65210248")!;
    const result = dedupByTransactionKey([descRow, ascRow]);
    expect(result.uniqueCount).toBe(2);
    expect(result.collisions).toBe(0);
  });

  it("the SAME transaction re-seen via both a descending and ascending fetch collapses to one", () => {
    const seenDesc = toShadowDeal({ dealAmount: 500000, dealDate: "2020-01-01", assetArea: 50, parcelNum: "8231-1-1" }, NEIGHBORHOOD, "65210248")!;
    const seenAsc = toShadowDeal({ dealAmount: 500000, dealDate: "2020-01-01", assetArea: 50, parcelNum: "8231-1-1" }, NEIGHBORHOOD, "65210248")!;
    const result = dedupByTransactionKey([seenDesc, seenAsc]);
    expect(result.uniqueCount).toBe(1);
    expect(result.collisions).toBe(1);
  });
});

describe("TEST E — a '-0' parcelNum with two prevDeals-flattened events on the SAME date but different amounts does not false-merge (real example: 8252-109-0, Wave 0G-13 Phase 11)", () => {
  it("preserves both events distinctly because dealAmount differs, even though parcelNum and dealDate are identical", () => {
    // Real data: parcelNum 8252-109-0 has prevDeals [{1999-12-29, 4805000}, {1999-12-29, 788000}] —
    // a genuine same-day, same-parcel, different-price pair (likely a parcel-level
    // aggregate row, per Wave 0G-10's "-0 rows are ambiguous" caveat).
    const event1 = toShadowDeal({ dealAmount: 4805000, dealDate: "1999-12-29", assetArea: 100, parcelNum: "8252-109-0" }, NEIGHBORHOOD, "65210195")!;
    const event2 = toShadowDeal({ dealAmount: 788000, dealDate: "1999-12-29", assetArea: 100, parcelNum: "8252-109-0" }, NEIGHBORHOOD, "65210195")!;
    const result = dedupByTransactionKey([event1, event2]);
    expect(result.uniqueCount).toBe(2); // NOT false-merged
    expect(result.collisions).toBe(0);
  });

  it("would WRONGLY collapse the same pair if dealAmount were dropped from the key (documents why dealAmount is required, not optional)", () => {
    // Demonstrates the risk directly against the SAME two real rows used
    // above (event1/event2 genuinely differ only in dealAmount) — not a
    // separate hardcoded pair, so this actually exercises their real field
    // values rather than being tautological (ECC code-reviewer finding).
    const event1 = toShadowDeal({ dealAmount: 4805000, dealDate: "1999-12-29", assetArea: 100, parcelNum: "8252-109-0" }, NEIGHBORHOOD, "65210195")!;
    const event2 = toShadowDeal({ dealAmount: 788000, dealDate: "1999-12-29", assetArea: 100, parcelNum: "8252-109-0" }, NEIGHBORHOOD, "65210195")!;
    const keyWithoutAmount = (row: typeof event1) => `${row.parcelNum}|${row.dealDate}`;
    expect(keyWithoutAmount(event1)).toBe(keyWithoutAmount(event2)); // proves the weaker key WOULD collide on these real rows
    expect(event1.price).not.toBe(event2.price); // confirms they really are distinct transactions, not a redundant pair
  });
});

describe("TEST D — a unique prevDeals-derived historical sale survives normalization (real example: parcelNum 8247-229-80, Wave 0G-10/0G-13)", () => {
  it("a prevDeals entry, once flattened and inheriting the parent's parcelNum, normalizes to a valid ShadowDeal distinct from the current sale", () => {
    const currentSale = toShadowDeal({ dealAmount: 2650000, dealDate: "2026-01-29", assetArea: 65, parcelNum: "8247-229-80", dealNature: "דירת נופש" }, NEIGHBORHOOD, "65210195")!;
    const flattenedPrevDeal = toShadowDeal({ dealAmount: 1550000, dealDate: "2013-07-08", parcelNum: "8247-229-80" }, NEIGHBORHOOD, "65210195")!;
    expect(currentSale).not.toBeNull();
    expect(flattenedPrevDeal).not.toBeNull();
    const result = dedupByTransactionKey([currentSale, flattenedPrevDeal]);
    expect(result.uniqueCount).toBe(2); // both survive as distinct genuine sales
  });
});
