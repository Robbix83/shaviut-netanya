import { describe, it, expect } from "vitest";
import { formatComparableAddress } from "../comparableAddress";

/**
 * Wave 0F-2C: presentation-only rule proven by Wave 0F-2A's real-data finding
 * (2,608 deals city-wide carry the literal string "0" in both `street` and
 * `address`; houseNumber is never literally "0" anywhere — confirmed by
 * direct inspection of data/deals.json, which is why houseNumber handling is
 * untouched here). This function is what components/ValuationWizard.tsx's
 * CompDealCard imports directly — same function under test, not a re-implementation.
 */

describe("formatComparableAddress — TEST A/B/C: placeholder and empty values are never shown", () => {
  it("TEST A — literal street '0', no address, no house number, neighborhood tier -> truthful fallback, not '0'", () => {
    const r = formatComparableAddress("0", null, null, "neighborhood");
    expect(r.text).not.toBe("0");
    expect(r.text).toBe("עסקה בשכונה");
    expect(r.isRealAddress).toBe(false);
  });

  it("TEST B — literal preformatted address '0' (even with a differing street) -> safe fallback, not '0'", () => {
    const r = formatComparableAddress(null, "0", null, "street");
    expect(r.text).not.toBe("0");
    expect(r.text).toBe("עסקה ברחוב");
    expect(r.isRealAddress).toBe(false);
  });

  it("TEST B variant — address '0' even when street also happens to be usable falls through to the street", () => {
    // proves address='0' is rejected on its own terms, not merely because street was also bad
    const r = formatComparableAddress("ויצמן", "0", "92", "building");
    expect(r.text).toBe("רח' ויצמן 92");
    expect(r.isRealAddress).toBe(true);
  });

  it("TEST C — empty/whitespace-only street and address -> safe tier-based fallback", () => {
    const r1 = formatComparableAddress("", "", null, "radius");
    expect(r1.text).toBe("עסקה בסביבה הקרובה");
    expect(r1.isRealAddress).toBe(false);

    const r2 = formatComparableAddress("   ", "   ", null, "building");
    expect(r2.text).toBe("עסקה בבניין");
    expect(r2.isRealAddress).toBe(false);
  });

  it("null/undefined street and address -> safe fallback", () => {
    const r = formatComparableAddress(null, undefined, null, "neighborhood");
    expect(r.text).toBe("עסקה בשכונה");
    expect(r.isRealAddress).toBe(false);
  });
});

describe("formatComparableAddress — TEST D/E: valid addresses render exactly as before", () => {
  it("TEST D — street + house number", () => {
    const r = formatComparableAddress("ויצמן", null, "92", "building");
    expect(r.text).toBe("רח' ויצמן 92");
    expect(r.isRealAddress).toBe(true);
  });

  it("TEST E — street without house number is not fabricated", () => {
    const r = formatComparableAddress("ויצמן", null, null, "street");
    expect(r.text).toBe("רח' ויצמן");
    expect(r.text).not.toContain("undefined");
    expect(r.text).not.toContain("null");
    expect(r.isRealAddress).toBe(true);
  });

  it("a preformatted, real address is preferred over street/houseNumber and has the neighborhood suffix stripped", () => {
    const r = formatComparableAddress("ויצמן", "ויצמן 92, נתניה", "92", "building");
    expect(r.text).toBe("ויצמן 92");
    expect(r.isRealAddress).toBe(true);
  });
});

describe("formatComparableAddress — TEST F/G: real-case regressions unchanged", () => {
  it("TEST F — Hartom 30", () => {
    const r = formatComparableAddress("הרב שמואל הרטום", null, "30", "building");
    expect(r.text).toBe("רח' הרב שמואל הרטום 30");
    expect(r.isRealAddress).toBe(true);
  });

  it("TEST G — Ben Ami street deal", () => {
    const r = formatComparableAddress("עובד בן עמי", "עובד בן עמי 2", "2", "street");
    expect(r.text).toBe("עובד בן עמי 2");
    expect(r.isRealAddress).toBe(true);
  });
});

describe("formatComparableAddress — TEST H: every real tier maps to a truthful fallback label", () => {
  it("building", () => {
    expect(formatComparableAddress(null, null, null, "building").text).toBe("עסקה בבניין");
  });
  it("street", () => {
    expect(formatComparableAddress(null, null, null, "street").text).toBe("עסקה ברחוב");
  });
  it("radius", () => {
    expect(formatComparableAddress(null, null, null, "radius").text).toBe("עסקה בסביבה הקרובה");
  });
  it("neighborhood", () => {
    expect(formatComparableAddress(null, null, null, "neighborhood").text).toBe("עסקה בשכונה");
  });
  it("no tier at all -> neutral fallback", () => {
    expect(formatComparableAddress(null, null, null, undefined).text).toBe("עסקה באזור");
    expect(formatComparableAddress(null, null, null, null).text).toBe("עסקה באזור");
  });
});
