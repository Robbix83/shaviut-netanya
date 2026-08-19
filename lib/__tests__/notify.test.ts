import { describe, it, expect } from "vitest";
import { buildLeadMessage, buildReportMessage, appendToSheet } from "@/lib/notify";
import type { Lead, Valuation } from "@/lib/types";

const lead: Lead = {
  name: "דנה כהן",
  phone: "0501234567",
  address: "רחוב הרצל 10",
  neighborhood: "אגמים",
  propertyType: "apartment",
  rooms: 4,
  areaSqm: 100,
  estimateLow: null,
  estimateHigh: null,
  source: "test",
  consent: true,
  consentMarketing: false,
};

const valuation = {
  estimateLow: 2_425_000,
  estimateHigh: 2_516_000,
  estimateMid: 2_498_000,
  pricePerSqmMid: 24_977,
  basedOnDeals: 7,
  neighborhood: "אגמים",
  comparableDeals: [{ street: "הרצל", rooms: 4, areaSqm: 100, price: 2_500_000 }],
  confidence: "low",
} as unknown as Valuation;

const NO_MISLEAD = (s: string) => {
  expect(s).not.toMatch(/NaN|undefined|null/);
  expect(s).not.toMatch(/₪0(\D|$)/); // no ₪0
};

describe("Option B — null valuation renders honestly", () => {
  it("agent message: with valuation shows the estimate", () => {
    const m = buildLeadMessage(lead, valuation);
    expect(m).toContain("💰 אומדן:");
    NO_MISLEAD(m);
  });

  it("agent message: WITHOUT valuation shows an explicit manual-review flag, no fake estimate", () => {
    const m = buildLeadMessage(lead, null);
    expect(m).toContain("נדרשת בדיקה ידנית");
    expect(m).not.toContain("אומדן:");
    NO_MISLEAD(m);
  });

  it("user report: with valuation says 'here is the report' and shows the range", () => {
    const m = buildReportMessage(lead, valuation);
    expect(m).toContain("הנה דוח השווי שביקשת");
    expect(m).toContain("טווח שווי משוער");
    expect(m).toContain("₪2,425,000");
    NO_MISLEAD(m);
  });

  it("user report: WITHOUT valuation does NOT claim a report exists and shows no price", () => {
    const m = buildReportMessage(lead, null);
    expect(m).not.toContain("הנה דוח השווי שביקשת"); // not misleading
    expect(m).toContain("קיבלנו את בקשתך"); // honest acknowledgement
    expect(m).toContain("מכינים עבורך"); // preparing manually
    expect(m).not.toMatch(/₪[\d,]+/); // no fabricated price at all
    NO_MISLEAD(m);
  });
});
