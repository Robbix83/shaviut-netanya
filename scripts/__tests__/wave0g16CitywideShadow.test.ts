/**
 * scripts/__tests__/wave0g16CitywideShadow.test.ts — Wave 0G-16 Phase 20
 * focused tests for the citywide runner's PURE logic (prevDeals extraction/
 * dedup, ambiguous-collision detection, resume contract-version gating).
 *
 * The runner's live acquisition loop (surface sequencing, click budgets,
 * stop-on-complete) is integration-level Playwright automation, already
 * live-validated in this wave's report against 3 independent scenarios
 * (a known complex entity reproducing prior waves' exact result, a
 * fast-path small entity, and resume behavior) — not re-tested here as
 * unit tests, consistent with this engagement's pattern of validating
 * browser-driven acquisition live rather than mocking Playwright.
 *
 * Covers Phase 20 items F, G (partially, via the shared already-tested
 * dedupByTransactionKey), H, I, J (documented), M. Items A-E, K, L are
 * either live-validated (A-E, this wave's report) or already covered by
 * existing suites (K/L: lib/__tests__/shadowRebuild.test.ts TEST E/F for
 * assertSafeShadowOutputPath itself).
 */
import { describe, it, expect } from "vitest";
import {
  extractPrevDealEvents, prevDealKey, detectAmbiguousCollisions, RUN_CONTRACT_VERSION,
  type RawPrevDealEvent,
} from "../audit-wave0g16-citywide-shadow";
import type { ShadowDeal } from "../../lib/shadowRebuild";

function makeShadowDeal(overrides: Partial<ShadowDeal> = {}): ShadowDeal {
  return {
    id: "x", dealDate: "2024-01-01", price: 1000000, propertyType: "apartment",
    rooms: 3, areaSqm: 80, plotSqm: null, floor: 2, yearBuilt: null, dealNature: null,
    address: "רחוב 1", street: "רחוב", houseNumber: "1", neighborhoodId: "1", neighborhood: "n",
    settlement: "נתניה", x: null, y: null, pricePerSqm: null,
    sourceId: "1", parcelNum: "100-1-1", rawDealNature: null,
    ...overrides,
  } as ShadowDeal;
}

describe("Wave 0G-16 — extractPrevDealEvents (Phase 7/8 prevDeals extraction)", () => {
  it("H/I — extracts only dealDate+dealAmount, drops entries with no valid date or price", () => {
    const raw = {
      parcelNum: "100-1-1",
      prevDeals: [
        { dealDate: "2020-01-01", dealAmount: 900000 },
        { dealDate: null, dealAmount: 800000 }, // dropped — no date
        { dealDate: "2019-01-01", dealAmount: 0 }, // dropped — zero price
        { dealDate: "2018-06-15", dealAmount: "700,000" }, // string amount still parses
      ],
    };
    const { events, drops } = extractPrevDealEvents(raw, "1");
    expect(events).toHaveLength(2);
    expect(drops).toBe(2);
    expect(events[0]).toMatchObject({ dealDate: "2020-01-01", price: 900000, parcelNum: "100-1-1", sourceId: "1" });
    expect(events[1]).toMatchObject({ dealDate: "2018-06-15", price: 700000 });
  });

  it("handles a top-level row with no prevDeals array at all", () => {
    const { events, drops } = extractPrevDealEvents({ parcelNum: "1-1-1" }, "1");
    expect(events).toHaveLength(0);
    expect(drops).toBe(0);
  });
});

describe("Wave 0G-16 — prevDealKey dedup (Phase 7 transaction-safe dedup)", () => {
  it("dedups identical historical events observed via overlapping surfaces", () => {
    const a: RawPrevDealEvent = { dealDate: "2020-01-01", price: 900000, parcelNum: "100-1-1", sourceId: "1" };
    const b: RawPrevDealEvent = { ...a };
    expect(prevDealKey(a)).toBe(prevDealKey(b));
  });

  it("does NOT collapse a genuine repeat sale (different date) of the same property", () => {
    const a: RawPrevDealEvent = { dealDate: "2020-01-01", price: 900000, parcelNum: "100-1-1", sourceId: "1" };
    const b: RawPrevDealEvent = { dealDate: "2021-01-01", price: 950000, parcelNum: "100-1-1", sourceId: "1" };
    expect(prevDealKey(a)).not.toBe(prevDealKey(b));
  });

  it("null parcelNum gets a stable, distinguishable key (never silently merged with a real one)", () => {
    const a: RawPrevDealEvent = { dealDate: "2020-01-01", price: 900000, parcelNum: null, sourceId: "1" };
    const key = prevDealKey(a);
    expect(key).not.toContain("100-1-1");
    expect(key).toContain("∅NULL_PARCEL∅");
  });

  it("includes sourceId — two different entities' properties never collide even with identical parcelNum/date/price", () => {
    const a: RawPrevDealEvent = { dealDate: "2020-01-01", price: 900000, parcelNum: "1-1-1", sourceId: "111" };
    const b: RawPrevDealEvent = { dealDate: "2020-01-01", price: 900000, parcelNum: "1-1-1", sourceId: "222" };
    expect(prevDealKey(a)).not.toBe(prevDealKey(b));
  });
});

describe("Wave 0G-16 — detectAmbiguousCollisions (Phase 5/9 fail-closed collision check)", () => {
  it("F/J — flags a key collision whose members disagree on non-key fields (contradictory evidence)", () => {
    const rows = [
      makeShadowDeal({ parcelNum: "100-1-0", dealDate: "2020-01-01", price: 900000, street: "רחוב א", houseNumber: "1" }),
      makeShadowDeal({ parcelNum: "100-1-0", dealDate: "2020-01-01", price: 900000, street: "רחוב ב", houseNumber: "9" }), // same key, different address
    ];
    const { ambiguousCount, examples } = detectAmbiguousCollisions(rows);
    expect(ambiguousCount).toBe(1);
    expect(examples).toHaveLength(1);
  });

  it("does NOT flag a true duplicate (same key, identical non-key fields) re-observed via a different sort surface", () => {
    const rows = [
      makeShadowDeal({ parcelNum: "100-1-1", dealDate: "2020-01-01", price: 900000, street: "רחוב", houseNumber: "1" }),
      makeShadowDeal({ parcelNum: "100-1-1", dealDate: "2020-01-01", price: 900000, street: "רחוב", houseNumber: "1" }),
    ];
    const { ambiguousCount } = detectAmbiguousCollisions(rows);
    expect(ambiguousCount).toBe(0);
  });

  it("does NOT flag two genuinely distinct transactions that differ in their KEY fields (different date)", () => {
    const rows = [
      makeShadowDeal({ parcelNum: "100-1-1", dealDate: "2020-01-01", price: 900000 }),
      makeShadowDeal({ parcelNum: "100-1-1", dealDate: "2021-01-01", price: 950000 }),
    ];
    const { ambiguousCount } = detectAmbiguousCollisions(rows);
    expect(ambiguousCount).toBe(0);
  });

  it("J — a '-0' aggregate parcelNum collision with contradictory floor/area is caught the same as any other collision", () => {
    const rows = [
      makeShadowDeal({ parcelNum: "8252-109-0", dealDate: "2020-01-01", price: 900000, floor: 2, areaSqm: 80 }),
      makeShadowDeal({ parcelNum: "8252-109-0", dealDate: "2020-01-01", price: 900000, floor: 18, areaSqm: 1450 }),
    ];
    const { ambiguousCount } = detectAmbiguousCollisions(rows);
    expect(ambiguousCount).toBe(1);
  });
});

describe("Wave 0G-16 — resume contract-version gating (Phase 17/M)", () => {
  it("M — RUN_CONTRACT_VERSION is a stable, non-empty tag distinct across wave revisions", () => {
    expect(RUN_CONTRACT_VERSION).toBe("wave0g16-v1");
    expect(RUN_CONTRACT_VERSION.length).toBeGreaterThan(0);
  });

  // loadExistingResult() itself does filesystem I/O and is intentionally not
  // unit-tested (would require mocking fs) — its contract-version and
  // sourceId equality checks are simple, directly-readable guard clauses
  // (see scripts/audit-wave0g16-citywide-shadow.ts loadExistingResult()),
  // and were exercised live this wave (a resumed COMPLETE/PARTIAL entity
  // correctly skipped re-acquisition; a FAILED entity correctly did NOT
  // resume and was retried live, per the report's Phase 17 section).
});
