import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.OTP_SECRET = "test-secret-0123456789abcdef0123456789abcdef";

// Track lead inserts without touching disk/network.
// vi.hoisted so these exist before the hoisted vi.mock factories run.
const { insertLead, notifyNewLead } = vi.hoisted(() => ({
  insertLead: vi.fn(async (lead: any) => ({ ...lead, id: "lead_test" })),
  notifyNewLead: vi.fn(async () => {}),
}));

// Partial mock: keep the REAL normalizePhone (otp.ts depends on it), override getStore only.
vi.mock("@/lib/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/store")>();
  return { ...actual, getStore: () => ({ insertLead }) };
});
vi.mock("@/lib/notify", () => ({ notifyNewLead }));

import { POST } from "@/app/api/lead/route";
import { signLeadProof } from "@/lib/otp";

let ipCounter = 0;
function makeReq(body: unknown, cookie?: string) {
  // Unique IP per call so the per-IP rate limiter never cross-contaminates tests.
  const ip = `10.0.0.${++ipCounter}`;
  const headers = new Headers({ "content-type": "application/json", "x-forwarded-for": ip });
  return {
    json: async () => body,
    headers,
    cookies: {
      get: (name: string) =>
        cookie && name === "lead_proof" ? { name, value: cookie } : undefined,
    },
    nextUrl: new URL("http://localhost/api/lead"),
  } as any;
}

const validBody = {
  name: "בדיקה בדיקה",
  phone: "0501234567",
  consentReport: true,
  propertyType: "apartment",
};

describe("POST /api/lead — server-enforced OTP proof", () => {
  beforeEach(() => {
    insertLead.mockClear();
    notifyNewLead.mockClear();
  });

  it("1+2. rejects when NO proof cookie is present (no OTP flow / send-but-no-verify)", async () => {
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("otp_verification_required");
    expect(insertLead).not.toHaveBeenCalled();
  });

  it("4. rejects an expired proof", async () => {
    vi.useFakeTimers();
    const proof = signLeadProof("0501234567");
    vi.advanceTimersByTime(15 * 60 * 1000 + 1000);
    const res = await POST(makeReq(validBody, proof));
    vi.useRealTimers();
    expect(res.status).toBe(401);
    expect(insertLead).not.toHaveBeenCalled();
  });

  it("5. rejects proof for phone A when submitting phone B", async () => {
    const proofA = signLeadProof("0501234567");
    const res = await POST(makeReq({ ...validBody, phone: "0509999999" }, proofA));
    expect(res.status).toBe(401);
    expect(insertLead).not.toHaveBeenCalled();
  });

  it("8. rejects a malformed proof", async () => {
    const res = await POST(makeReq(validBody, "garbage.token.value"));
    expect(res.status).toBe(401);
    expect(insertLead).not.toHaveBeenCalled();
  });

  it("6. accepts a valid proof for the matching phone and inserts the lead", async () => {
    const proof = signLeadProof("0501234567");
    const res = await POST(makeReq(validBody, proof));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(insertLead).toHaveBeenCalledTimes(1);
  });

  it("still enforces existing validation (missing consent) even with a valid proof", async () => {
    const proof = signLeadProof("0501234567");
    const res = await POST(makeReq({ ...validBody, consentReport: false }, proof));
    expect(res.status).toBe(422);
    expect(insertLead).not.toHaveBeenCalled();
  });
});
