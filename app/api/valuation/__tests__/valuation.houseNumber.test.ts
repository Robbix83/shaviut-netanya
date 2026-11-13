import { describe, it, expect, vi } from "vitest";

/**
 * TEST D/E (Wave 0E-2B): the valuation API must independently reject a missing
 * house number for apartment/house — UI validation alone is insufficient. Mocks
 * resolveAndValuate() so we can assert it is (or is not) invoked, matching the
 * mocking pattern already used in app/api/lead/__tests__/lead.valuation.test.ts.
 */

const { resolveAndValuate } = vi.hoisted(() => ({
  resolveAndValuate: vi.fn(async (_input: any): Promise<any> => ({
    ok: true,
    valuation: { estimateLow: 1, estimateHigh: 2, comparableDeals: [] },
    neighborhoodId: "N1",
    neighborhoodName: "test",
  })),
}));

vi.mock("@/lib/valuationService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/valuationService")>();
  return { ...actual, resolveAndValuate };
});

import { POST } from "@/app/api/valuation/route";

function makeReq(body: unknown) {
  return { json: async () => body } as any;
}

describe("POST /api/valuation — server-side house number enforcement", () => {
  it("TEST D — apartment, missing houseNumber -> 4xx, resolveAndValuate never called", async () => {
    resolveAndValuate.mockClear();
    const res = await POST(makeReq({ neighborhoodId: "N1", propertyType: "apartment", houseNumber: "" }));
    expect(res.status).toBe(422);
    const j = await res.json();
    expect(j.error).toBe("house_number_required");
    expect(resolveAndValuate).not.toHaveBeenCalled();
  });

  it("TEST D — house, whitespace-only houseNumber -> 4xx, no valuation execution", async () => {
    resolveAndValuate.mockClear();
    const res = await POST(makeReq({ neighborhoodId: "N1", propertyType: "house", houseNumber: "   " }));
    expect(res.status).toBe(422);
    expect(resolveAndValuate).not.toHaveBeenCalled();
  });

  it("TEST D — propertyType omitted (defaults to apartment), missing houseNumber -> 4xx", async () => {
    resolveAndValuate.mockClear();
    const res = await POST(makeReq({ neighborhoodId: "N1" }));
    expect(res.status).toBe(422);
    expect(resolveAndValuate).not.toHaveBeenCalled();
  });

  it("TEST E — apartment, houseNumber='92' -> accepted, preserved as string, resolveAndValuate called", async () => {
    resolveAndValuate.mockClear();
    const res = await POST(
      makeReq({ neighborhoodId: "N1", propertyType: "apartment", houseNumber: "92", streetName: "ויצמן" }),
    );
    expect(res.status).toBe(200);
    expect(resolveAndValuate).toHaveBeenCalledTimes(1);
    const calledWith = resolveAndValuate.mock.calls[0][0];
    expect(calledWith.houseNumber).toBe("92");
    expect(typeof calledWith.houseNumber).toBe("string");
  });

  it("TEST H — land, missing houseNumber -> accepted (existing behavior retained)", async () => {
    resolveAndValuate.mockClear();
    const res = await POST(makeReq({ neighborhoodId: "N1", propertyType: "land" }));
    expect(res.status).toBe(200);
    expect(resolveAndValuate).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/valuation — no valuation without a street name", () => {
  it("apartment with a house number but no street -> 422 street_required, no valuation", async () => {
    resolveAndValuate.mockClear();
    const res = await POST(makeReq({ neighborhoodId: "N1", propertyType: "apartment", houseNumber: "11" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("street_required");
    expect(resolveAndValuate).not.toHaveBeenCalled();
  });

  it("digits or one letter are not a street", async () => {
    for (const streetName of ["11", "--", "א 5"]) {
      resolveAndValuate.mockClear();
      const res = await POST(makeReq({ neighborhoodId: "N1", propertyType: "house", houseNumber: "3", streetName }));
      expect(res.status).toBe(422);
      expect(resolveAndValuate).not.toHaveBeenCalled();
    }
  });

  it("land needs no street", async () => {
    resolveAndValuate.mockClear();
    const res = await POST(makeReq({ neighborhoodId: "N1", propertyType: "land" }));
    expect(res.status).toBe(200);
  });

  it("a neighbourhood-level estimate is never labelled high confidence", async () => {
    resolveAndValuate.mockResolvedValueOnce({
      ok: true,
      valuation: { estimateLow: 1, estimateHigh: 2, comparableDeals: [], confidence: "high", compSearchScope: "neighborhood" },
      neighborhoodId: "N1",
      neighborhoodName: "test",
    });
    const res = await POST(makeReq({ neighborhoodId: "N1", propertyType: "apartment", houseNumber: "11", streetName: "רחוב לא קיים" }));
    expect((await res.json()).valuation.confidence).toBe("medium");
  });
  // מצב סקר עסקאות: הסכום שחושב לנכס לא יוצא מהשרת, אלא אם SHOW_ESTIMATE=1
  it("does not send the computed estimate to the browser unless SHOW_ESTIMATE=1", async () => {
    const req = () => POST(makeReq({ neighborhoodId: "N1", propertyType: "apartment", houseNumber: "11", streetName: "ויצמן" }));
    const v = (await (await req()).json()).valuation;
    expect(v).toMatchObject({ estimateLow: 0, estimateHigh: 0, manualReview: true, manualReviewReason: "survey", comparableDeals: [] });
    vi.stubEnv("SHOW_ESTIMATE", "1");
    expect((await (await req()).json()).valuation).toMatchObject({ estimateLow: 1, estimateHigh: 2 });
    vi.unstubAllEnvs();
  });
});
