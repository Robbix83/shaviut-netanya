import { describe, it, expect, afterAll } from "vitest";

// Off-plan apartments and detached houses (improvement round, 12.11.2026).
// - Off-plan with sales of its own project ("building" pool) gets a number (backtest: 7.5% median error);
//   a project with no sales of its own is compared with older buildings and stays on manual review.
// - Houses use the weighted comparison on built area, so a smaller comparable sells for more per m².
process.env.DATA_SOURCE = "local";

import { MemoryStore, setStoreForTesting } from "@/lib/store";
import { valuate } from "@/lib/valuation";
import type { Deal } from "@/lib/types";

let n = 0;
const deal = (o: Partial<Deal>): Deal => {
  const d: Deal = {
    id: `t${n++}`, dealDate: "2025-06-01", price: 0, propertyType: "apartment", rooms: 4, areaSqm: 100, plotSqm: null,
    floor: 3, yearBuilt: 2010, dealNature: "דירה בבית קומות", address: null, houseNumber: "10", street: "הרצל",
    neighborhoodId: "N1", neighborhood: "שכונה", settlement: "נתניה", x: null, y: null, pricePerSqm: 25_000, ...o,
  };
  d.price = Math.round((d.pricePerSqm ?? 0) * (d.areaSqm ?? 0));
  return d;
};
const subject = {
  neighborhoodId: "N1", neighborhood: "שכונה", propertyType: "apartment", rooms: 4, areaSqm: 100, plotSqm: null,
  floor: 3, streetX: null, streetY: null, asOf: "2026-06-01",
} as const;

afterAll(() => setStoreForTesting(null));

describe("off-plan apartments", () => {
  it("get a number when their own project already has sales", async () => {
    const project = [0, 1, 2, 3, 4, 5].map((i) =>
      deal({ houseNumber: "40", yearBuilt: 2028, dealDate: `2025-0${i + 1}-15`, pricePerSqm: 30_000 + i * 100 }));
    const older = [0, 1, 2, 3].map((i) => deal({ houseNumber: String(30 + i), pricePerSqm: 22_000 }));
    setStoreForTesting(new MemoryStore([...project, ...older], []));
    const v = (await valuate({ ...subject, houseNumber: "40", streetName: "הרצל", yearBuilt: 2028 } as any))!;
    expect(v.manualReview).toBe(false);
    expect(v.compSearchScope).toBe("building");
    expect(v.estimateMid).toBeGreaterThan(2_700_000);
  });

  it("stay on manual review when the project has no sales of its own", async () => {
    const older = [0, 1, 2, 3, 4, 5].map((i) => deal({ houseNumber: String(30 + i), pricePerSqm: 22_000 }));
    setStoreForTesting(new MemoryStore(older, []));
    const v = (await valuate({ ...subject, houseNumber: "40", streetName: "הרצל", yearBuilt: 2028 } as any))!;
    expect(v.manualReview).toBe(true);
    expect(v.manualReviewReason).toBe("off_plan");
    expect(v.estimateMid).toBe(0);
  });
});

describe("houses", () => {
  it("adjust larger comparables up per m² (weighted comparison, not the raw median)", async () => {
    const big = [0, 1, 2, 3, 4, 5].map((i) =>
      deal({ propertyType: "house", dealNature: "קוטג' חד משפחתי", floor: null, areaSqm: 240, pricePerSqm: 20_000 + i * 50, houseNumber: String(i + 1) }));
    setStoreForTesting(new MemoryStore(big, []));
    const v = (await valuate({ ...subject, propertyType: "house", floor: null, areaSqm: 160, houseNumber: "20", streetName: "הרצל", yearBuilt: null } as any))!;
    // (240/160)^0.5 ≈ 1.22 → about 24,500/m² before the size weight, not the raw 20,000
    expect(v.pricePerSqmMid).toBeGreaterThan(23_000);
  });
});
