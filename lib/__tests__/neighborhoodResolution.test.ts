import { describe, it, expect } from "vitest";
import { MemoryStore } from "@/lib/store";
import { resolveDatasetNeighborhood } from "@/lib/neighborhoodResolution";
import { annualTrend } from "@/lib/valuation";
import { drawSample, ineligibleReason } from "../../scripts/backtest/core";

const deal = (o: Partial<any>): any => ({
  id: o.id ?? Math.random().toString(36).slice(2), dealDate: "2025-01-01", price: 2_000_000, propertyType: "apartment",
  rooms: 4, areaSqm: 100, plotSqm: null, floor: 2, yearBuilt: 2000, dealNature: "דירה בבית קומות",
  address: null, street: "הרצל", houseNumber: "10", neighborhoodId: "V2-A", neighborhood: "א", settlement: "נתניה",
  x: 187000, y: 692000, pricePerSqm: 20_000, ...o,
});
const hoods = [
  { id: "V2-A", name: "א", settlement: "נתניה", x: null, y: null },
  { id: "V2-B", name: "ב", settlement: "נתניה", x: null, y: null },
] as any[];
const known = new Set(hoods.map((n) => n.id));

describe("resolveDatasetNeighborhood — V1 ids from street-index on a V2 dataset", () => {
  const store = new MemoryStore(
    [
      deal({ id: "1", street: "שד' ניצה", houseNumber: "20", neighborhoodId: "V2-B", x: 185000, y: 693000 }),
      deal({ id: "2", street: "שד' ניצה", houseNumber: "20", neighborhoodId: "V2-B", x: 185000, y: 693000 }),
      deal({ id: "3", street: "שד' ניצה", houseNumber: "80", neighborhoodId: "V2-A", x: 185100, y: 694500 }),
      deal({ id: "4", street: "הרצל", houseNumber: "5", neighborhoodId: "V2-A" }),
    ],
    hoods,
  );

  it("keeps a client id the dataset knows", async () => {
    expect(await resolveDatasetNeighborhood({ neighborhoodId: "V2-A", streetName: "ניצה" }, known, store))
      .toEqual({ id: "V2-A", source: "client" });
  });

  it("replaces an unknown (V1) id with the neighbourhood of the same building", async () => {
    expect(await resolveDatasetNeighborhood({ neighborhoodId: "66239255", streetName: "ניצה", houseNumber: "20" }, known, store))
      .toEqual({ id: "V2-B", source: "building" });
  });

  it("uses the nearest deal on a street that crosses neighbourhoods", async () => {
    expect(await resolveDatasetNeighborhood(
      { neighborhoodId: "66239255", streetName: "ניצה", houseNumber: "70", streetX: 185100, streetY: 694400 }, known, store,
    )).toEqual({ id: "V2-A", source: "street_nearest" });
  });

  it("returns none when the street has no deals", async () => {
    expect((await resolveDatasetNeighborhood({ neighborhoodId: "x", streetName: "רחוב שלא קיים" }, known, store)).id).toBeNull();
  });

  it("never looks at deals on or after asOf", async () => {
    const r = await resolveDatasetNeighborhood({ neighborhoodId: "x", streetName: "ניצה", houseNumber: "20", asOf: "2024-01-01" }, known, store);
    expect(r.id).toBeNull();
  });

  it("trusts the client id when the neighbourhood list is empty (misconfiguration, not 'all ids invalid')", async () => {
    expect((await resolveDatasetNeighborhood({ neighborhoodId: "Q" }, new Set(), store)).id).toBe("Q");
  });
});

describe("annualTrend", () => {
  const series = (g: number) =>
    Array.from({ length: 30 }, (_, i) => {
      const yr = 2021 + i / 6;
      const date = new Date(Date.UTC(2021, 0, 1) + (i / 6) * 365.25 * 864e5).toISOString().slice(0, 10);
      return deal({ dealDate: date, pricePerSqm: Math.round(20_000 * Math.pow(1 + g, yr - 2021)) });
    });
  it("recovers a steady 3%/yr rise", () => expect(annualTrend(series(0.03), 8000)).toBeCloseTo(0.03, 2));
  it("caps runaway trends at ±5%/yr", () => expect(annualTrend(series(0.2), 8000)).toBeCloseTo(0.05, 5));
  it("is 0 with fewer than 20 deals", () => expect(annualTrend(series(0.03).slice(0, 10), 8000)).toBe(0));
});

describe("backtest sample", () => {
  const deals = Array.from({ length: 200 }, (_, i) =>
    deal({ id: `d${i}`, dealDate: `2026-0${1 + (i % 6)}-15`, houseNumber: String(i) }));
  it("is deterministic for a seed and independent of input order", () => {
    const spec = { lastDate: "2026-07-01", split: "all" as const, size: 50, seed: 7 };
    const a = drawSample(deals, spec).rows.map((d) => d.id);
    const b = drawSample([...deals].reverse(), spec).rows.map((d) => d.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(50);
  });
  it("splits the evaluation year by date (dev = first half, test = second half)", () => {
    const dev = drawSample(deals, { lastDate: "2026-07-01", split: "dev", size: "all", seed: 1 });
    expect(dev.rows.every((d) => d.dealDate <= dev.splitISO)).toBe(true);
    const test = drawSample(deals, { lastDate: "2026-07-01", split: "test", size: "all", seed: 1 });
    expect(test.rows.every((d) => d.dealDate > test.splitISO)).toBe(true);
  });
  it("excludes sales a seller could not type in", () => {
    expect(ineligibleReason(deal({ street: "0" }))).toBe("no_full_address");
    expect(ineligibleReason(deal({ dealNature: "משרד" }))).toBe("non_residential_nature");
    expect(ineligibleReason(deal({ price: 500_000 }))).toBe("ppsqm_below_floor");
    expect(ineligibleReason(deal({}))).toBeNull();
  });
});
