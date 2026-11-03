import { describe, it, expect } from "vitest";
import { toWaNumber, buildWaLink, leadRef, reportRequestText } from "@/lib/whatsapp";

describe("toWaNumber", () => {
  it("converts Israeli local formats to 972…", () => {
    expect(toWaNumber("0501234567")).toBe("972501234567");
    expect(toWaNumber("050-123-4567")).toBe("972501234567");
    expect(toWaNumber(" 050 123 4567 ")).toBe("972501234567");
    expect(toWaNumber("+972-50-1234567")).toBe("972501234567");
    expect(toWaNumber("972501234567")).toBe("972501234567");
    expect(toWaNumber("09-8765432")).toBe("97298765432"); // landline still a valid wa.me target
  });
  it("returns null when unset or malformed", () => {
    expect(toWaNumber(undefined)).toBeNull();
    expect(toWaNumber(null)).toBeNull();
    expect(toWaNumber("")).toBeNull();
    expect(toWaNumber("abc")).toBeNull();
    expect(toWaNumber("05012")).toBeNull();
    expect(toWaNumber("1501234567")).toBeNull();
  });
});

describe("buildWaLink", () => {
  it("builds a wa.me link with the text URL-encoded", () => {
    const url = buildWaLink("050-1234567", 'היי, 4 חד\', 95 מ"ר. מס\' פנייה: AB12&?')!;
    expect(url.startsWith("https://wa.me/972501234567?text=")).toBe(true);
    const text = new URL(url).searchParams.get("text");
    expect(text).toBe('היי, 4 חד\', 95 מ"ר. מס\' פנייה: AB12&?');
    expect(url).not.toMatch(/\s/); // spaces encoded
    expect(url.split("?")).toHaveLength(2); // the "?" inside the text is encoded
    expect(url).not.toMatch(/&/); // so is the "&"
  });
  it("is null (button hidden) when the agent number is unset or invalid", () => {
    expect(buildWaLink(undefined, "x")).toBeNull();
    expect(buildWaLink("", "x")).toBeNull();
    expect(buildWaLink("not-a-number", "x")).toBeNull();
  });
});

describe("leadRef", () => {
  it("takes the last 6 alphanumerics, upper-cased", () => {
    expect(leadRef("lead_1793739493907")).toBe("493907");
    expect(leadRef("3f2a9c1e-7b4d-4e2a-9c1e-0a1b2c3d4e5f")).toBe("3D4E5F");
  });
  it("is null without an id", () => {
    expect(leadRef(undefined)).toBeNull();
    expect(leadRef("")).toBeNull();
    expect(leadRef("---")).toBeNull();
  });
});

describe("reportRequestText", () => {
  const base = { street: "הרצל", houseNumber: "10", rooms: 4, areaSqm: 95, plotSqm: null, ref: "493907" };
  it("apartment: address, rooms, area and ref — no name or phone", () => {
    expect(reportRequestText({ ...base, propertyType: "apartment" })).toBe(
      'היי, ביקשתי הערכת שווי לדירה בהרצל 10, 4 חד\', 95 מ"ר. מס\' פנייה: 493907',
    );
  });
  it("land: plot size only", () => {
    expect(
      reportRequestText({ ...base, propertyType: "land", houseNumber: null, rooms: null, areaSqm: null, plotSqm: 500 }),
    ).toBe('היי, ביקשתי הערכת שווי למגרש בהרצל, מגרש 500 מ"ר. מס\' פנייה: 493907');
  });
  it("skips missing pieces", () => {
    expect(
      reportRequestText({ propertyType: "house", street: null, houseNumber: null, rooms: null, areaSqm: null, plotSqm: null, ref: null }),
    ).toBe("היי, ביקשתי הערכת שווי לבית.");
  });
});
