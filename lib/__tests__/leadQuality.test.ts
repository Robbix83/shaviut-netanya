import { describe, it, expect } from "vitest";
import { isTestLead } from "../leadQuality";

const lead = (name: string, phone: string, status = "new") => ({ name, phone, status }) as Parameters<typeof isTestLead>[0];

describe("isTestLead", () => {
  it("name says test", () => expect(isTestLead(lead("בדיקה 123", "0541234567"))).toBe(true));
  it("made-up phone", () => {
    expect(isTestLead(lead("דני", "0522222222"))).toBe(true);
    expect(isTestLead(lead("דני", "+972-54-222-1111"))).toBe(false); // 2221111: only 4 in a row after the prefix
  });
  it("marked not relevant in admin", () => expect(isTestLead(lead("דני", "0541234567", "not_relevant"))).toBe(true));
  it("ordinary lead", () => expect(isTestLead(lead("דנה כהן", "0541234567"))).toBe(false));
  it("a 5-digit run inside the prefix doesn't count", () => expect(isTestLead(lead("דני", "0555512345"))).toBe(false));
});
