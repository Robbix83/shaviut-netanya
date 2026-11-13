/**
 * lib/streetName.ts — the one street-name normaliser used by the engine, the store, the alias
 * dedup and the market panel. Strips a leading type word so "שד ויצמן" / "שדרות ויצמן" / "ויצמן"
 * compare equal. Each prefix must be a whole word: "שדרות ירושלים" → "ירושלים" (not "רות ירושלים"),
 * and "רחובות" / "שדה התעופה" stay as they are.
 */
const STREET_PREFIX = /^(שדרות|שדרת|שד'|שד(?=\s)|רחוב(?=\s)|רח'|דרך(?=\s))\s*/i;

export function normalizeStreetName(s: string): string {
  return s.replace(STREET_PREFIX, "").trim();
}
