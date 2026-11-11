import { describe, it, expect } from "vitest";

// Robustness of the apartment comparison (appraiseApartment), after a real complaint:
// יהושע טהון 13, 90 m², 4th floor (November 2026) — one 100 m² sale from 2022 decided the whole estimate
// because every other sale on the street was a 51 m² flat whose weight had decayed to almost nothing.
process.env.DATA_SOURCE = "local";

import { appraiseApartment } from "@/lib/valuation";

const comp = (o: any) => ({
  id: Math.random().toString(36).slice(2), dealDate: "2026-01-01", price: 0, areaSqm: 100, pricePerSqm: 20_000,
  floor: 3, houseNumber: "7", street: "יהושע טהון", ...o,
});
const subject = { areaSqm: 90, floor: 4, houseNumber: "13", streetName: "יהושע טהון" };

describe("appraiseApartment robustness", () => {
  it("one similar-sized sale cannot decide the estimate alone", () => {
    // ten small flats at ~25,000/m² once adjusted to 90 m², one 100 m² sale at 31,600/m²
    const small = Array.from({ length: 10 }, (_, i) =>
      comp({ areaSqm: 51, pricePerSqm: 33_000 + i * 100, houseNumber: i % 2 ? "14" : "22" }));
    const big = comp({ areaSqm: 100, pricePerSqm: 31_600, dealDate: "2025-06-01" });
    const r = appraiseApartment([...small, big] as any, subject, "2026-11-01", 8000)!;
    // before the fix the result was the big sale's value (≈33,300/m² after the size adjustment)
    expect(r.ppsqm).toBeLessThan(30_000);
    expect(r.ppsqm).toBeGreaterThan(24_000);
  });

  it("a deal at the same house number on another street is not 'the same building'", () => {
    const onStreet = [0, 1, 2, 3].map((i) => comp({ pricePerSqm: 20_000 + i * 10, areaSqm: 90 }));
    const elsewhere = [0, 1, 2].map((i) => comp({ street: "הרצל", houseNumber: "13", areaSqm: 90, pricePerSqm: 30_000 + i }));
    const r = appraiseApartment([...onStreet, ...elsewhere] as any, subject, "2026-11-01", 8000)!;
    // 4 street sales vs 3 others: without a false same-building bonus the street sales carry the median
    expect(r.ppsqm).toBeLessThan(25_000);
  });

  it("a one-floor change moves the estimate by about one floor step, not by a different pool", () => {
    const deals = [1, 2, 3, 4, 5, 6].map((f) => comp({ floor: f, areaSqm: 85 + f * 3, pricePerSqm: 24_000 + f * 150 }));
    const a = appraiseApartment(deals as any, { ...subject, floor: 4 }, "2026-11-01", 8000)!;
    const b = appraiseApartment(deals as any, { ...subject, floor: 3 }, "2026-11-01", 8000)!;
    expect(Math.abs(a.ppsqm / b.ppsqm - 1)).toBeLessThan(0.03);
  });
});
