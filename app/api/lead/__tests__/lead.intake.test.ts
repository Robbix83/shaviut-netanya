import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// In-memory leads table so the 24h dedupe runs against real lookups, without touching disk/network.
// vi.hoisted so these exist before the hoisted vi.mock factories run.
const { rows, insertLead, findRecentLead, notifyNewLead } = vi.hoisted(() => {
  const rows: any[] = [];
  return {
    rows,
    insertLead: vi.fn(async (lead: any) => {
      const saved = { ...lead, id: `lead_${rows.length + 1}`, createdAt: new Date().toISOString() };
      rows.push(saved);
      return saved;
    }),
    findRecentLead: vi.fn(
      async (key: { phone: string; address: string | null; houseNumber: string | null }, sinceISO: string) =>
        rows.find(
          (l) =>
            l.phone === key.phone &&
            l.address === key.address &&
            l.houseNumber === key.houseNumber &&
            l.createdAt >= sinceISO,
        ) ?? null,
    ),
    notifyNewLead: vi.fn(async () => {}),
  };
});

vi.mock("@/lib/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/store")>();
  return { ...actual, getStore: () => ({ insertLead, findRecentLead }) };
});
vi.mock("@/lib/notify", () => ({ notifyNewLead }));
// Isolate intake tests from the valuation seam (its own tests cover recompute).
vi.mock("@/lib/valuationService", () => ({
  resolveAndValuate: vi.fn(async () => ({
    ok: true,
    valuation: { estimateLow: 1_000_000, estimateHigh: 1_500_000, neighborhood: "אגמים" },
    neighborhoodId: "66239255",
    neighborhoodName: "אגמים",
  })),
}));

import { POST, normalizeMobile } from "@/app/api/lead/route";

let ipCounter = 0;
function makeReq(body: unknown, ip = `10.0.0.${++ipCounter}`) {
  // Unique IP per call by default so the per-IP rate limiter never cross-contaminates tests.
  const headers = new Headers({ "content-type": "application/json", "x-forwarded-for": ip });
  return {
    json: async () => body,
    headers,
    cookies: { get: () => undefined },
    nextUrl: new URL("http://localhost/api/lead"),
  } as any;
}

const validBody = {
  name: "בדיקה בדיקה",
  phone: "050-123 4567",
  address: "רחוב בדיקה",
  houseNumber: "1",
  consentReport: true,
  propertyType: "apartment",
  valuationInput: { neighborhoodId: "66239255", propertyType: "apartment", rooms: 4, areaSqm: 100, houseNumber: "1" },
};

beforeEach(() => {
  rows.length = 0;
  insertLead.mockClear();
  findRecentLead.mockClear();
  notifyNewLead.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/lead — no OTP step", () => {
  it("saves the lead with no proof cookie and sends no notification", async () => {
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.id).toBe("lead_1");
    expect(json.ref).toBe("LEAD1"); // short ref from the saved id, shown to the visitor and the admin
    expect(insertLead).toHaveBeenCalledTimes(1);
    expect(insertLead.mock.calls[0][0].phone).toBe("0501234567"); // stored without dashes/spaces
    expect(notifyNewLead).not.toHaveBeenCalled();
  });

  it("still enforces the required consent", async () => {
    const res = await POST(makeReq({ ...validBody, consentReport: false }));
    expect(res.status).toBe(422);
    expect(insertLead).not.toHaveBeenCalled();
  });
});

describe("server phone rule — Israeli mobile 05 + 8 digits", () => {
  it("normalizeMobile accepts mobiles with dashes/spaces and rejects everything else", () => {
    expect(normalizeMobile("0501234567")).toBe("0501234567");
    expect(normalizeMobile("050-1234567")).toBe("0501234567");
    expect(normalizeMobile(" 052 123 45 67 ")).toBe("0521234567");
    expect(normalizeMobile("091234567")).toBeNull(); // landline
    expect(normalizeMobile("03-1234567")).toBeNull(); // landline
    expect(normalizeMobile("050123456")).toBeNull(); // too short
    expect(normalizeMobile("05012345678")).toBeNull(); // too long
    expect(normalizeMobile("+972501234567")).toBeNull();
    expect(normalizeMobile("05O1234567")).toBeNull(); // letter O
    expect(normalizeMobile(undefined)).toBeNull();
    expect(normalizeMobile(501234567)).toBeNull();
  });

  it.each(["091234567", "050123456", "0501234567890", "abc", ""])(
    "rejects %j with 422 and a Hebrew message, nothing saved",
    async (phone) => {
      const res = await POST(makeReq({ ...validBody, phone }));
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error).toBe("invalid_phone");
      expect(json.message).toMatch(/נייד/);
      expect(insertLead).not.toHaveBeenCalled();
    },
  );
});

describe("honeypot", () => {
  it("filled hidden field → success response, nothing saved", async () => {
    const res = await POST(makeReq({ ...validBody, website: "http://spam.example" }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(insertLead).not.toHaveBeenCalled();
    expect(findRecentLead).not.toHaveBeenCalled();
  });

  it("empty hidden field → saved normally", async () => {
    const res = await POST(makeReq({ ...validBody, website: "" }));
    expect(res.status).toBe(200);
    expect(insertLead).toHaveBeenCalledTimes(1);
  });
});

describe("rate limit — 10 per IP per hour", () => {
  it("allows 10 submissions from one IP, blocks the 11th, and resets after an hour", async () => {
    vi.useFakeTimers();
    const ip = "10.9.9.9";
    for (let i = 0; i < 10; i++) {
      const res = await POST(makeReq({ ...validBody, phone: `05000000${String(i).padStart(2, "0")}` }, ip));
      expect(res.status).toBe(200);
    }
    const blocked = await POST(makeReq({ ...validBody, phone: "0509999999" }, ip));
    expect(blocked.status).toBe(429);
    expect(insertLead).toHaveBeenCalledTimes(10);

    // Another IP is unaffected.
    expect((await POST(makeReq({ ...validBody, phone: "0508888888" }))).status).toBe(200);

    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect((await POST(makeReq({ ...validBody, phone: "0507777777" }, ip))).status).toBe(200);
  });
});

describe("24h dedupe — same phone + same address (street + house number)", () => {
  it("a repeat within 24h returns the existing lead and writes no new row", async () => {
    const first = await (await POST(makeReq(validBody))).json();
    // Same number typed differently still counts as the same phone.
    const res = await POST(makeReq({ ...validBody, phone: "0501234567" }));
    expect(res.status).toBe(200);
    const again = await res.json();
    expect(again.id).toBe(first.id);
    expect(again.ref).toBe(first.ref);
    expect(rows).toHaveLength(1);
  });

  it("a different street, house number or phone is a new lead", async () => {
    await POST(makeReq(validBody));
    await POST(makeReq({ ...validBody, address: "רחוב אחר" }));
    await POST(makeReq({ ...validBody, houseNumber: "2" }));
    await POST(makeReq({ ...validBody, phone: "0527654321" }));
    expect(rows).toHaveLength(4);
  });

  it("the same phone + address after 24h is a new lead", async () => {
    vi.useFakeTimers();
    await POST(makeReq(validBody));
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1000);
    await POST(makeReq(validBody));
    expect(rows).toHaveLength(2);
  });
});

describe("dedupe lookup failure", () => {
  it("still saves the lead when the lookup throws", async () => {
    findRecentLead.mockRejectedValueOnce(new Error("db down"));
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(200);
    expect(insertLead).toHaveBeenCalledTimes(1);
  });
});
