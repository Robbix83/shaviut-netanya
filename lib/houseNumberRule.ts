/**
 * lib/houseNumberRule.ts
 * Wave 0E-2B: single source of truth for the "house number is mandatory for
 * apartment/house valuations" rule and the evaluated-address display string.
 * Pure, dependency-free functions — safe to import from both the client
 * ("use client" wizard) and the server (API routes), so the two never drift.
 */

export type PropertyTypeForValuation = "apartment" | "house" | "land";

export const HOUSE_NUMBER_REQUIRED_MESSAGE =
  "יש להזין מספר בית כדי שנוכל להתבסס קודם על עסקאות מהבניין עצמו.";

/** Land listings in the imported tax-authority data don't carry a meaningful
 * house-number semantic; apartment/house valuations do (this is what let the
 * Wave 0E building-comparables bug hide undetected). */
export function isHouseNumberRequired(propertyType?: PropertyTypeForValuation | null): boolean {
  return (propertyType ?? "apartment") !== "land";
}

export function isValidHouseNumber(
  propertyType: PropertyTypeForValuation | null | undefined,
  houseNumber: string | null | undefined,
): boolean {
  if (!isHouseNumberRequired(propertyType)) return true;
  return !!(houseNumber ?? "").trim();
}

/** Formats the evaluated property's full address for the result screen, from the
 * exact street/houseNumber the user selected/entered — never reconstructed from
 * comparable deal rows, never a different normalized/deal address. */
export function formatEvaluatedAddress(
  street: string | null | undefined,
  houseNumber: string | null | undefined,
  city = "נתניה",
): string | null {
  if (!street) return null;
  const hn = (houseNumber ?? "").trim();
  return `הערכת שווי — ${street}${hn ? ` ${hn}` : ""}, ${city}`;
}
