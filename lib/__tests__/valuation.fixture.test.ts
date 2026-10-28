import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// Characterization fixtures: pin the CURRENT valuation outputs for fixed inputs so
// any change to the valuation mathematics shows up here.
// Runs in local mode (NODE_ENV=test → resolveDataSource returns "local"); reads data/*.json.
// No houseNumber/streetName → no network geocode.
// The clock is frozen: valuate() picks its deal windows relative to today, so without a
// fixed date the pinned numbers drift as time passes.
// Re-pinned 27.10.2026 (VE-1) after changes measured with scripts/backtest: comparables are
// adjusted to the valuation date by the neighbourhood's ₪/m² trend (capped ±5%/yr), and the
// apartment range floor is ±20% (house ±25%); land returns no number (manual review).
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
    expect(v!.estimateLow).toBe(2006000);
    expect(v!.estimateMid).toBe(2507000);
    expect(v!.estimateHigh).toBe(3008000);
    expect(v!.basedOnDeals).toBe(4);
    expect(v!.confidence).toBe("low");
    expect(v!.pricePerSqmMid).toBe(25066);
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
    expect(v!.estimateLow).toBe(1611000);
    expect(v!.estimateMid).toBe(2014000);
    expect(v!.estimateHigh).toBe(2417000);
    expect(v!.basedOnDeals).toBe(6);
    expect(v!.confidence).toBe("low");
    expect(v!.pricePerSqmMid).toBe(25178);
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

  const agamim = {
    ...base, neighborhoodId: "66239255", neighborhood: "אגמים", propertyType: "apartment",
    rooms: 4, areaSqm: 100, floor: 3,
  };

  it("fixture D — build year after the valuation year → off-plan manual review, no number", async () => {
    const v = await valuate({ ...agamim, yearBuilt: 2027 } as any);
    expect(v).not.toBeNull();
    expect(v!.manualReview).toBe(true);
    expect(v!.manualReviewReason).toBe("off_plan");
    expect(v!.estimateMid).toBe(0);
    expect(v!.pricePerSqmMid).toBe(0);
  });

  it("fixture E — build year equal to the valuation year still gets a number", async () => {
    const v = await valuate({ ...agamim, yearBuilt: 2026 } as any);
    expect(v).not.toBeNull();
    expect(v!.manualReview).toBe(false);
    expect(v!.estimateMid).toBeGreaterThan(0);
  });
});
