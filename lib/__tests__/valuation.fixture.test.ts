import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// Characterization fixtures: pin the CURRENT valuation outputs for fixed inputs so
// any change to the valuation mathematics shows up here.
// Runs in local mode (NODE_ENV=test → resolveDataSource returns "local"); reads data/*.json.
// No houseNumber/streetName → no network geocode.
// The clock is frozen: valuate() picks its deal windows relative to today, so without a
// fixed date the pinned numbers drift as time passes.
// Re-pinned 27.10.2026 after the backtest-calibrated range floor (apartment ±15%, house ±25%)
// and manual review for land — the middle estimate is unchanged by those (see fixture B).
process.env.DATA_SOURCE = "local";

import { valuate } from "@/lib/valuation";

const base = { plotSqm: null, yearBuilt: null, houseNumber: null, streetName: null, streetX: null, streetY: null };

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

describe("valuation math is unchanged (characterization)", () => {
  it("fixture A — אגמים, 4 rooms, 100 sqm", async () => {
    const v = await valuate({
      ...base,
      neighborhoodId: "66239255",
      neighborhood: "אגמים",
      propertyType: "apartment",
      rooms: 4,
      areaSqm: 100,
      floor: 3,
    } as any);
    expect(v).not.toBeNull();
    expect(v!.estimateLow).toBe(2128000);
    expect(v!.estimateMid).toBe(2504000);
    expect(v!.estimateHigh).toBe(2880000);
    expect(v!.basedOnDeals).toBe(4);
    expect(v!.confidence).toBe("low");
    expect(v!.pricePerSqmMid).toBe(25035);
  });

  it("fixture B — קריית השרון, 3 rooms, 80 sqm", async () => {
    const v = await valuate({
      ...base,
      neighborhoodId: "66239241",
      neighborhood: "קריית השרון",
      propertyType: "apartment",
      rooms: 3,
      areaSqm: 80,
      floor: 2,
    } as any);
    expect(v).not.toBeNull();
    expect(v!.estimateLow).toBe(1697000);
    expect(v!.estimateMid).toBe(1996000);
    expect(v!.estimateHigh).toBe(2295000);
    expect(v!.basedOnDeals).toBe(6);
    expect(v!.confidence).toBe("low");
    expect(v!.pricePerSqmMid).toBe(24948);
  });

  it("fixture C — פרדס הגדוד, plot 500 sqm → manual review, no number", async () => {
    const v = await valuate({
      ...base,
      neighborhoodId: "66239285",
      neighborhood: "פרדס הגדוד",
      propertyType: "land",
      rooms: null,
      areaSqm: null,
      floor: null,
      plotSqm: 500,
      streetX: 187525.5374,
      streetY: 694547.7756,
    } as any);
    expect(v).not.toBeNull();
    expect(v!.manualReview).toBe(true);
    expect(v!.estimateLow).toBe(0);
    expect(v!.estimateMid).toBe(0);
    expect(v!.estimateHigh).toBe(0);
    expect(v!.pricePerSqmMid).toBe(0);
    expect(v!.confidence).toBe("low");
    expect(v!.comparableDeals.length).toBeGreaterThan(0);
  });
});
