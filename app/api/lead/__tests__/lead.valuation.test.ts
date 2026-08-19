import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.OTP_SECRET = "test-secret-0123456789abcdef0123456789abcdef";

const { insertLead, notifyNewLead, resolveAndValuate } = vi.hoisted(() => ({
  insertLead: vi.fn(async (lead: any) => ({ ...lead, id: "lead_test" })),
  notifyNewLead: vi.fn(async (_lead: any, _valuation: any) => {}),
  resolveAndValuate: vi.fn(async (_input: any): Promise<any> => undefined),
}));

vi.mock("@/lib/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/store")>();
  return { ...actual, getStore: () => ({ insertLead }) };
});
vi.mock("@/lib/notify", () => ({ notifyNewLead }));
vi.mock("@/lib/valuationService", () => ({ resolveAndValuate }));

import { POST } from "@/app/api/lead/route";
import { signLeadProof } from "@/lib/otp";

// The authoritative server result the recompute returns.
const SERVER_VALUATION = {
  estimateLow: 2_500_000,
  estimateMid: 2_550_000,
  estimateHigh: 2_600_000,
  neighborhood: "אגמים-server",
  confidence: "medium",
  scope: "neighborhood",
  basedOnDeals: 10,
  pricePerSqmMid: 25_000,
  comparableDeals: [{ street: "server-st", price: 2_500_000 }],
};

let ipCounter = 0;
function makeReq(body: unknown, cookie?: string) {
  const ip = `10.1.0.${++ipCounter}`;
  return {
    json: async () => body,
    headers: new Headers({ "content-type": "application/json", "x-forwarded-for": ip }),
    cookies: {
      get: (name: string) => (cookie && name === "lead_proof" ? { name, value: cookie } : undefined),
    },
    nextUrl: new URL("http://localhost/api/lead"),
  } as any;
}

const proof = () => signLeadProof("0501234567");

// A body where the client tries to inject its own (fraudulent) valuation OUTPUTS.
const tamperedBody = {
  name: "בדיקה בדיקה",
  phone: "0501234567",
  consentReport: true,
  propertyType: "apartment",
  neighborhood: "client-tampered-neighborhood",
  // Client-supplied OUTPUTS that must be IGNORED:
  valuation: {
    estimateLow: 1,
    estimateHigh: 999_999_999,
    confidence: "high",
    comparableDeals: [{ street: "FAKE", price: 999_999_999 }],
    neighborhood: "client-tampered-neighborhood",
  },
  estimateLow: 1,
  estimateHigh: 999_999_999,
  // Legitimate INPUTS the server uses to recompute:
  valuationInput: { neighborhoodId: "66239255", propertyType: "apartment", rooms: 4, areaSqm: 100 },
};

describe("POST /api/lead — server-owned valuation (client outputs ignored)", () => {
  beforeEach(() => {
    insertLead.mockClear();
    notifyNewLead.mockClear();
    resolveAndValuate.mockReset();
    resolveAndValuate.mockResolvedValue({
      ok: true,
      valuation: SERVER_VALUATION,
      neighborhoodId: "66239255",
      neighborhoodName: "אגמים-server",
    });
  });

  it("1. persists SERVER estimates, not client estimateLow=1 / estimateHigh=999999999", async () => {
    const res = await POST(makeReq(tamperedBody, proof()));
    expect(res.status).toBe(200);
    const lead = insertLead.mock.calls[0][0];
    expect(lead.estimateLow).toBe(2_500_000);
    expect(lead.estimateHigh).toBe(2_600_000);
    expect(lead.estimateLow).not.toBe(1);
    expect(lead.estimateHigh).not.toBe(999_999_999);
  });

  it("2+3. notification uses SERVER valuation (tampered confidence/comparables ignored)", async () => {
    await POST(makeReq(tamperedBody, proof()));
    const notifiedValuation = notifyNewLead.mock.calls[0][1];
    expect(notifiedValuation).toBe(SERVER_VALUATION);
    expect(notifiedValuation.confidence).toBe("medium"); // not client "high"
    expect(notifiedValuation.comparableDeals[0].street).toBe("server-st"); // not "FAKE"
  });

  it("4. stored neighborhood comes from server computation, not client display string", async () => {
    await POST(makeReq(tamperedBody, proof()));
    const lead = insertLead.mock.calls[0][0];
    expect(lead.neighborhood).toBe("אגמים-server");
    expect(lead.neighborhood).not.toBe("client-tampered-neighborhood");
  });

  it("5. server recompute is invoked with the validated input (single authoritative path)", async () => {
    await POST(makeReq(tamperedBody, proof()));
    expect(resolveAndValuate).toHaveBeenCalledTimes(1);
    const passedInput = resolveAndValuate.mock.calls[0][0];
    expect(passedInput.neighborhoodId).toBe("66239255");
    expect(passedInput.areaSqm).toBe(100);
  });

  it("6. invalid property inputs (no valuationInput) → 422 before persistence", async () => {
    const { valuationInput, ...noInput } = tamperedBody;
    const res = await POST(makeReq(noInput, proof()));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("invalid_valuation_input");
    expect(insertLead).not.toHaveBeenCalled();
    expect(resolveAndValuate).not.toHaveBeenCalled();
  });

  it("7a. recompute unavailable (insufficient_data) → lead saved with null estimates (option B)", async () => {
    resolveAndValuate.mockResolvedValueOnce({ ok: false, error: "insufficient_data" });
    const res = await POST(makeReq(tamperedBody, proof()));
    expect(res.status).toBe(200);
    const lead = insertLead.mock.calls[0][0];
    expect(lead.estimateLow).toBeNull();
    expect(lead.estimateHigh).toBeNull();
    // never the client value
    expect(lead.estimateLow).not.toBe(1);
  });

  it("7b. recompute throws → lead still saved with null estimates, client value never used", async () => {
    resolveAndValuate.mockRejectedValueOnce(new Error("boom"));
    const res = await POST(makeReq(tamperedBody, proof()));
    expect(res.status).toBe(200);
    const lead = insertLead.mock.calls[0][0];
    expect(lead.estimateLow).toBeNull();
    expect(lead.estimateHigh).toBeNull();
  });

  it("8. missing OTP proof → 401 before any valuation work", async () => {
    const res = await POST(makeReq(tamperedBody)); // no cookie
    expect(res.status).toBe(401);
    expect(resolveAndValuate).not.toHaveBeenCalled();
    expect(insertLead).not.toHaveBeenCalled();
  });
});
