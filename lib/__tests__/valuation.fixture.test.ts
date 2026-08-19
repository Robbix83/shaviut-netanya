import { describe, it, expect } from "vitest";

// Characterization fixtures: pin the CURRENT valuation outputs for fixed inputs so
// the Wave 0A-2 trust-ownership change is proven NOT to alter valuation mathematics.
// Values captured from the real local dataset before the refactor. Runs in local mode
// (NODE_ENV=test → resolveDataSource returns "local"); reads data/*.json.
// No houseNumber/streetName → no network geocode.
process.env.DATA_SOURCE = "local";

import { valuate } from "@/lib/valuation";

describe("valuation math is unchanged (characterization)", () => {
  it("fixture A — אגמים, 4 rooms, 100 sqm", async () => {
    const v = await valuate({
      neighborhoodId: "66239255",
      neighborhood: "אגמים",
      propertyType: "apartment",
      rooms: 4,
      areaSqm: 100,
      plotSqm: null,
      floor: 3,
      yearBuilt: null,
      houseNumber: null,
      streetName: null,
      streetX: null,
      streetY: null,
    } as any);
    expect(v).not.toBeNull();
    expect(v!.estimateLow).toBe(2425000);
    expect(v!.estimateMid).toBe(2498000);
    expect(v!.estimateHigh).toBe(2516000);
    expect(v!.basedOnDeals).toBe(7);
    expect(v!.confidence).toBe("low");
    expect(v!.pricePerSqmMid).toBe(24977);
  });

  it("fixture B — קריית השרון, 3 rooms, 80 sqm", async () => {
    const v = await valuate({
      neighborhoodId: "66239241",
      neighborhood: "קריית השרון",
      propertyType: "apartment",
      rooms: 3,
      areaSqm: 80,
      plotSqm: null,
      floor: 2,
      yearBuilt: null,
      houseNumber: null,
      streetName: null,
      streetX: null,
      streetY: null,
    } as any);
    expect(v).not.toBeNull();
    expect(v!.estimateLow).toBe(1967000);
    expect(v!.estimateMid).toBe(1996000);
    expect(v!.estimateHigh).toBe(2055000);
    expect(v!.basedOnDeals).toBe(6);
    expect(v!.confidence).toBe("low");
    expect(v!.pricePerSqmMid).toBe(24948);
  });
});
