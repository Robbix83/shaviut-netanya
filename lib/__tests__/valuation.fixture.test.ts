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
// Re-pinned 30.10.2026 (rc7): apartments use the adjusted, weighted comparison (appraiseApartment),
// with a range capped at ±10% and a ₪1M gap.
process.env.DATA_SOURCE = "local";

import { valuate, appraiseApartment, uniqueDeals } from "@/lib/valuation";

const base = { plotSqm: null, yearBuilt: null, houseNumber: null, streetName: null, streetX: null, streetY: null };

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

describe("apartment comparison approach", () => {
  const comp = (o: any) => ({
    id: "x", dealDate: "2026-01-01", price: 2_000_000, areaSqm: 100, pricePerSqm: 20_000, floor: 3,
    houseNumber: "5", street: "הרצל", ...o,
  });
  const subject = { areaSqm: 100, floor: 3, houseNumber: "5" };

  it("counts a deal listed twice once", () => {
    const deals = [comp({ id: "a" }), comp({ id: "b" }), comp({ id: "c", price: 2_100_000 })];
    expect(uniqueDeals(deals as any).map((d) => d.id)).toEqual(["a", "c"]);
  });

  it("agreeing comparables get the narrowest range", () => {
    const deals = [1, 2, 3, 4, 5].map((i) => comp({ id: String(i), price: 2_000_000 + i }));
    const r = appraiseApartment(deals as any, subject, "2026-06-01", 8000)!;
    expect(r.ppsqm).toBe(20_000);
    expect(r.half).toBe(0.12);
  });

  it("scattered comparables widen the range", () => {
    const deals = [12_000, 16_000, 20_000, 24_000, 28_000].map((p, i) => comp({ id: String(i), pricePerSqm: p, price: p * 100 }));
    expect(appraiseApartment(deals as any, subject, "2026-06-01", 8000)!.half).toBeGreaterThan(0.12);
  });

  it("a larger comparable sells for less per sqm, so it is adjusted up", () => {
    const deals = [0, 1, 2].map((i) => comp({ id: String(i), areaSqm: 121, price: 2_420_000 + i }));
    expect(appraiseApartment(deals as any, subject, "2026-06-01", 8000)!.ppsqm).toBeCloseTo(22_000, 0);
  });

  it("a closer-sized recent deal outweighs distant ones", () => {
    const deals = [
      comp({ id: "near1", pricePerSqm: 30_000, price: 3_000_000 }),
      comp({ id: "near2", pricePerSqm: 30_100, price: 3_010_000 }),
      comp({ id: "old1", dealDate: "2021-01-01", areaSqm: 100, pricePerSqm: 20_000 }),
      comp({ id: "old2", dealDate: "2021-02-01", areaSqm: 100, pricePerSqm: 20_100, price: 2_010_000 }),
      comp({ id: "old3", dealDate: "2021-03-01", areaSqm: 100, pricePerSqm: 20_200, price: 2_020_000 }),
    ];
    expect(appraiseApartment(deals as any, subject, "2026-06-01", 8000)!.ppsqm).toBeGreaterThanOrEqual(30_000);
  });

  it("needs at least three usable deals", () => {
    expect(appraiseApartment([comp({ id: "a" }), comp({ id: "b" })] as any, subject, "2026-06-01", 8000)).toBeNull();
  });
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
    expect(v!.estimateLow).toBe(2345000);
    expect(v!.estimateMid).toBe(2606000);
    expect(v!.estimateHigh).toBe(2867000);
    expect(v!.basedOnDeals).toBe(4);
    expect(v!.confidence).toBe("low");
    expect(v!.pricePerSqmMid).toBe(26061);
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
    expect(v!.estimateLow).toBe(1985000);
    expect(v!.estimateMid).toBe(2205000);
    expect(v!.estimateHigh).toBe(2426000);
    expect(v!.basedOnDeals).toBe(6);
    expect(v!.confidence).toBe("low");
    expect(v!.pricePerSqmMid).toBe(27566);
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
  it("apartment ranges never exceed ±10% or a ₪1M gap (MAX_RANGE_HALF, MAX_RANGE_SPAN_APARTMENT)", async () => {
    for (const [id, name] of [["66239255", "אגמים"], ["66239241", "קריית השרון"]]) {
      for (const rooms of [2, 3, 4, 5]) {
        const v = await valuate({ ...base, neighborhoodId: id, neighborhood: name, propertyType: "apartment", rooms, areaSqm: rooms * 25, floor: 2 } as any);
        if (!v || !v.estimateMid) continue;
        expect(v.estimateHigh - v.estimateMid).toBeLessThanOrEqual(v.estimateMid * 0.1 + 1000);
        expect(v.estimateMid - v.estimateLow).toBeLessThanOrEqual(v.estimateMid * 0.1 + 1000);
        expect(v.estimateHigh - v.estimateLow).toBeLessThanOrEqual(1_000_000);
      }
    }
  });
});
