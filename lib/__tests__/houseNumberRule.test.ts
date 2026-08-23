import { describe, it, expect } from "vitest";
import {
  isHouseNumberRequired,
  isValidHouseNumber,
  formatEvaluatedAddress,
  HOUSE_NUMBER_REQUIRED_MESSAGE,
} from "../houseNumberRule";

/**
 * Wave 0E-2B: these are the pure, dependency-free functions that gate the wizard's
 * "המשך"/"חשב שווי" buttons AND the server-side /api/valuation and /api/lead
 * validation (the exact same functions are imported by both — see
 * components/ValuationWizard.tsx, components/AddressSearch.tsx,
 * app/api/valuation/route.ts, app/api/lead/route.ts). This repo has no DOM/React
 * component-testing infrastructure (no jsdom environment, no @testing-library/react,
 * no .test.tsx precedent) — introducing one would be a new-architecture change this
 * micro-wave's scope explicitly forbids. Testing the shared rule functions directly
 * is the faithful, minimal-blast-radius equivalent of "UI cannot calculate" /
 * "result header shows X" without a browser harness.
 */

describe("isHouseNumberRequired (Wave 0E-2B property-type exception)", () => {
  it("apartment requires a house number", () => {
    expect(isHouseNumberRequired("apartment")).toBe(true);
  });
  it("house requires a house number", () => {
    expect(isHouseNumberRequired("house")).toBe(true);
  });
  it("land does NOT require a house number (existing behavior retained)", () => {
    expect(isHouseNumberRequired("land")).toBe(false);
  });
  it("defaults to required (apartment) when propertyType is missing", () => {
    expect(isHouseNumberRequired(undefined)).toBe(true);
    expect(isHouseNumberRequired(null)).toBe(true);
  });
});

describe("isValidHouseNumber — TEST A/B/C: apartment/house without a valid house number", () => {
  it("TEST A — apartment, houseNumber='' is invalid (UI cannot calculate)", () => {
    expect(isValidHouseNumber("apartment", "")).toBe(false);
  });
  it("TEST B — house, houseNumber='' is invalid (same as apartment)", () => {
    expect(isValidHouseNumber("house", "")).toBe(false);
  });
  it("TEST C — whitespace-only house number is invalid", () => {
    expect(isValidHouseNumber("apartment", "   ")).toBe(false);
    expect(isValidHouseNumber("house", "\t\n")).toBe(false);
  });
  it("apartment/house with a real house number is valid — string form preserved by caller", () => {
    expect(isValidHouseNumber("apartment", "92")).toBe(true);
    expect(isValidHouseNumber("house", "30")).toBe(true);
  });
  it("does not silently invent or trim-and-accept a default", () => {
    expect(isValidHouseNumber("apartment", null)).toBe(false);
    expect(isValidHouseNumber("apartment", undefined)).toBe(false);
  });
  it("TEST H — land: missing house number does not regress (still valid)", () => {
    expect(isValidHouseNumber("land", "")).toBe(true);
    expect(isValidHouseNumber("land", null)).toBe(true);
  });
  it("does not impose an unnecessary integer-only rule — letter suffixes remain valid", () => {
    expect(isValidHouseNumber("apartment", "30א")).toBe(true);
    expect(isValidHouseNumber("house", "12ב")).toBe(true);
  });
});

describe("HOUSE_NUMBER_REQUIRED_MESSAGE", () => {
  it("is the approved Hebrew copy, shared by UI and server error responses", () => {
    expect(HOUSE_NUMBER_REQUIRED_MESSAGE).toBe(
      "יש להזין מספר בית כדי שנוכל להתבסס קודם על עסקאות מהבניין עצמו.",
    );
  });
});

describe("formatEvaluatedAddress — TEST F/G: result header", () => {
  it("TEST F — Weizmann 92: rendered header contains the full evaluated address", () => {
    const s = formatEvaluatedAddress("ויצמן", "92");
    expect(s).toContain("ויצמן 92");
    expect(s).toContain("נתניה");
  });
  it("TEST G — Hartom 30: rendered header contains the full evaluated address", () => {
    const s = formatEvaluatedAddress("הרב שמואל הרטום", "30");
    expect(s).toContain("הרב שמואל הרטום 30");
  });
  it("uses the exact evaluated street/houseNumber, not a reconstructed/normalized value", () => {
    expect(formatEvaluatedAddress("ויצמן", "92")).toBe("הערכת שווי — ויצמן 92, נתניה");
  });
  it("omits a dangling house number when none was entered (land)", () => {
    expect(formatEvaluatedAddress("שדרות בן גוריון", "")).toBe("הערכת שווי — שדרות בן גוריון, נתניה");
  });
  it("returns null when no street is known (neighborhood-only fallback) — never invents one", () => {
    expect(formatEvaluatedAddress(null, "92")).toBeNull();
    expect(formatEvaluatedAddress(undefined, "")).toBeNull();
  });
});
