import { describe, it, expect, afterEach } from "vitest";
import { MemoryStore, setStoreForTesting } from "@/lib/store";
import { valuate } from "@/lib/valuation";
import type { Deal } from "@/lib/types";

const deal = (o: Partial<Deal>): Deal =>
  ({
    id: Math.random().toString(36), neighborhoodId: "A", settlement: "נתניה", street: "הבדיקה", houseNumber: "10",
    propertyType: "apartment", rooms: 4, areaSqm: 100, floor: 3, yearBuilt: 1990, dealNature: "דירה בבית קומות",
    dealDate: "2026-01-01", price: 2_000_000, pricePerSqm: 20_000, x: null, y: null, ...o,
  }) as Deal;

const three = (o: Partial<Deal>, ppsqm: number, firstHouse = 10) =>
  [0, 1, 2].map((i) => deal({ ...o, houseNumber: String(firstHouse + i * 2), pricePerSqm: ppsqm + i, price: (ppsqm + i) * 100 }));

async function valued(deals: Deal[], at: { x: number; y: number } | null = null) {
  setStoreForTesting(new MemoryStore(deals, []));
  return (await valuate({
    neighborhoodId: "A", neighborhood: null, propertyType: "apartment", rooms: 4, areaSqm: 100, plotSqm: null, floor: 3,
    yearBuilt: null, houseNumber: "10", streetName: "הבדיקה", streetX: at?.x ?? null, streetY: at?.y ?? null, asOf: "2026-06-01",
  } as any))!;
}

async function value(deals: Deal[]) {
  const v = await valued(deals);
  return (v.pricePerSqmLow + v.pricePerSqmHigh) / 2;
}

afterEach(() => setStoreForTesting(null as any));

describe("which deals are compared", () => {
  it("keeps the street's deals from the neighbourhood across it", async () => {
    const ppsqm = await value(three({ neighborhoodId: "B" }, 20_000).concat(deal({ street: "אחר", pricePerSqm: 40_000 })));
    expect(ppsqm).toBeGreaterThan(19_000);
    expect(ppsqm).toBeLessThan(21_500);
  });

  it("ignores offices and shops marked as apartments", async () => {
    const ppsqm = await value(three({}, 20_000).concat(three({ dealNature: "משרד" }, 40_000), three({ dealNature: "חנות" }, 40_000)));
    expect(ppsqm).toBeLessThan(21_500);
  });

  it("ignores new sales from a developer when a resale apartment is valued", async () => {
    const ppsqm = await value(three({}, 20_000).concat(three({ yearBuilt: 2026 }, 40_000, 16), three({ yearBuilt: 2027 }, 41_000, 16)));
    expect(ppsqm).toBeLessThan(21_500);
  });

  it("keeps deals with no location out of a street search", async () => {
    const at = { x: 186000, y: 692000 };
    const near = three({ x: at.x + 10, y: at.y + 10 }, 20_000, 12);
    const nowhere = three({ street: "0", houseNumber: null as any, x: null, y: null }, 40_000);
    const v = await valued(near.concat(nowhere), at);
    expect((v.pricePerSqmLow + v.pricePerSqmHigh) / 2).toBeLessThan(21_500);
    expect(v.comparableDeals.every((c) => c.street !== "0")).toBe(true);
  });

  it("falls back to new sales when nothing else exists", async () => {
    expect(await value(three({ yearBuilt: 2026 }, 30_000))).toBeGreaterThan(28_000);
  });
});
