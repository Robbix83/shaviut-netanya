/**
 * lib/nadlanAcquisition.ts — direct-ID acquisition helpers (Wave 0G-8).
 *
 * Separate from lib/nadlanCatalog.ts (DISCOVERY — enumerating entities) by
 * design: this module is ACQUISITION-time identity verification for a single,
 * already-known sourceId. Wave 0G-7 proved that a name-typed search box
 * cannot be trusted to reach a specific discovered entity (requesting
 * sourceId=65210195 returned an unrequested entity's data). Wave 0G-8 proved
 * a direct URL — `https://www.nadlan.gov.il/?view=neighborhood&id={sourceId}&page=deals`
 * — reaches the correct entity with zero autocomplete/name-search involved.
 *
 * This module holds the pure, unit-testable pieces of that proof: the URL
 * builder, and a fail-closed identity assertion that requires EVERY returned
 * row to carry the requested id — not merely "at least one" (a mixed batch,
 * e.g. 5 correct rows buried in 495 wrong ones, must NOT pass).
 */

export function buildDirectNeighborhoodUrl(sourceId: string): string {
  return `https://www.nadlan.gov.il/?view=neighborhood&id=${sourceId}&page=deals`;
}

export interface RawDealItem {
  neighborhoodId?: unknown;
}

export interface IdentityCheckResult {
  valid: boolean;
  error: string | null;
  matchingCount: number;
  totalCount: number;
  distinctIds: string[];
}

/**
 * Fail-closed identity check: valid=true ONLY when at least one item was
 * returned AND every single item carries the requested sourceId as its own
 * `neighborhoodId`. Never treats "some rows match" as success — a mixed
 * batch fails exactly like a fully-wrong batch, because a diagnostic tool
 * whose job is to catch silent mismatches must not have its own silent
 * mismatch blind spot.
 */
export function assertDirectIdAcquisitionIdentity(
  items: RawDealItem[] | null | undefined,
  requestedSourceId: string,
): IdentityCheckResult {
  // Defensive: fail closed rather than throw on a malformed (non-array)
  // input — a future caller passing through an un-guaranteed decoded
  // response should get a clean rejection, not an unhandled exception.
  if (!Array.isArray(items) || items.length === 0) {
    return { valid: false, error: "EMPTY_RESULT", matchingCount: 0, totalCount: 0, distinctIds: [] };
  }

  const ids = items.map((it) => (it != null && typeof it === "object" && it.neighborhoodId != null ? String(it.neighborhoodId) : null));
  const distinctIds = [...new Set(ids.filter((x): x is string => x != null))];

  if (distinctIds.length === 0) {
    return { valid: false, error: "MISSING_IDENTITY", matchingCount: 0, totalCount: items.length, distinctIds: [] };
  }

  const matchingCount = ids.filter((id) => id === requestedSourceId).length;
  if (matchingCount !== items.length) {
    return {
      valid: false,
      error: `ID_MISMATCH: ${matchingCount}/${items.length} items match requested sourceId=${requestedSourceId} (distinct ids present: ${distinctIds.join(",")})`,
      matchingCount,
      totalCount: items.length,
      distinctIds,
    };
  }

  return { valid: true, error: null, matchingCount, totalCount: items.length, distinctIds };
}

export interface RequestEnvelope {
  base_id?: string;
  base_name?: string;
  fetch_number?: number;
  type_order?: string;
  domain?: string;
  /** Field NAMES only — never values. This is a passive, non-cryptographic
   * reversal+base64 decode of the request's own opaque `##` payload (the
   * technique reviewed safe in Wave 0G-5): it exposes the request's own
   * non-secret routing claims, never the session-bound sk/token/exp VALUES,
   * which are recorded here only as presence flags. */
  credentialFieldsPresent: string[];
}

/**
 * Passively decodes a captured /deal-data request body's non-credential
 * fields — `fetch_number` in particular is a REQUEST-side field the
 * response body never echoes back (confirmed empirically across every
 * Wave 0G-9/0G-10/0G-12 capture: response `data` keys are exactly
 * `total_rows`/`total_fetch`/`total_page`/`items`, never `fetch_number`).
 * Extracted from the reversal+base64 pattern first used in Wave 0G-9's
 * continuation/sort probes and Wave 0G-10's fetch-depth probe, which had
 * each re-implemented it inline — Wave 0G-12 centralizes it here so no
 * caller duplicates the decode logic again.
 */
export function decodeRequestEnvelope(postData: string | null | undefined): RequestEnvelope | null {
  if (!postData) return null;
  try {
    const parsed = JSON.parse(postData);
    const opaque = parsed["##"];
    if (typeof opaque !== "string") return null;
    const reversed = opaque.split("").reverse().join("");
    const parts = reversed.split(".");
    if (parts.length < 2) return null;
    const b64url = (s: string) => {
      const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "===".slice((b64.length + 3) % 4);
      return Buffer.from(padded, "base64").toString("utf8");
    };
    const payload = JSON.parse(b64url(parts[1]));
    const credentialFieldsPresent: string[] = [];
    for (const f of ["sk", "token", "exp"]) if (payload[f] !== undefined) credentialFieldsPresent.push(f);
    return {
      base_id: payload.base_id, base_name: payload.base_name,
      fetch_number: payload.fetch_number, type_order: payload.type_order,
      domain: payload.domain, credentialFieldsPresent,
    };
  } catch {
    return null;
  }
}
