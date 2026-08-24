/**
 * lib/comparableAddress.ts
 * Wave 0F-2C: presentation-only rule for the comparable-card address line.
 * Proven in Wave 0F-2A: 2,608 imported deal rows carry the literal string
 * "0" in both `street` and `address` (a pre-existing data-import artifact —
 * not touched here, not mutated, not cleaned). CompDealCard's prior logic
 * only guarded against null/empty values, so "0" (a truthy string) rendered
 * unchanged as a fake address. This never happens for `houseNumber`
 * (verified: 0 deals anywhere have houseNumber === "0"), so house-number
 * handling is intentionally left untouched.
 */

export type ComparableTier = "building" | "street" | "radius" | "neighborhood" | null | undefined;

export interface ComparableAddressDisplay {
  text: string;
  /** true = a genuine address derived from source data; false = a truthful
   *  tier-based fallback label (no real address is displayable). */
  isRealAddress: boolean;
}

const TIER_FALLBACK_LABEL: Record<string, string> = {
  building: "עסקה בבניין",
  street: "עסקה ברחוב",
  radius: "עסקה בסביבה הקרובה",
  neighborhood: "עסקה בשכונה",
};
const NEUTRAL_FALLBACK_LABEL = "עסקה באזור";

/** The proven placeholder convention: null/undefined, empty after trim, or
 * the literal string "0" — nothing broader (no numeric-street heuristics,
 * no placeholder dictionary). */
function isUsableAddressField(v: string | null | undefined): boolean {
  if (v == null) return false;
  const t = v.trim();
  return t.length > 0 && t !== "0";
}

function hasHouseNumber(v: string | null | undefined): boolean {
  return v != null && v.trim().length > 0;
}

/** Never invents a street, never infers one from another comparable, never
 * rewrites source data — only decides what's safe to show from the fields
 * already on this one comparable. */
export function formatComparableAddress(
  street: string | null | undefined,
  address: string | null | undefined,
  houseNumber: string | null | undefined,
  tier: ComparableTier,
): ComparableAddressDisplay {
  if (isUsableAddressField(address)) {
    const stripped = address!.replace(/,?\s*נתניה$/i, "").trim();
    if (isUsableAddressField(stripped)) {
      return { text: stripped, isRealAddress: true };
    }
  }
  if (isUsableAddressField(street)) {
    const hn = hasHouseNumber(houseNumber) ? ` ${houseNumber!.trim()}` : "";
    return { text: `רח' ${street!.trim()}${hn}`, isRealAddress: true };
  }
  const label = (tier && TIER_FALLBACK_LABEL[tier]) || NEUTRAL_FALLBACK_LABEL;
  return { text: label, isRealAddress: false };
}
