/**
 * lib/streetIdentityPolicy.ts — Wave 0G-19: an identity-classification rule
 * for a raw row returned by a direct source-native street request
 * (`?view=street&id={streetCode}`, see lib/nadlanAcquisition.ts /
 * scripts/audit-wave0g18-street-runner.ts).
 *
 * STATUS: PARTIAL / NOT independently confirmed. This module implements the
 * Wave 0G-19 "Policy 2" rule and is fully tested on its own terms, but the
 * underlying real-world claim it encodes — that a `neighborhoodId="0"` row
 * with a matching streetCode+address genuinely belongs to the requested
 * parent entity — is NOT proven. It is not wired into any live acquisition
 * path; scripts/audit-wave0g18-street-runner.ts is unchanged and still uses
 * the stricter, all-or-nothing assertDirectIdAcquisitionIdentity. Treat this
 * as investigation tooling, not an adopted acceptance rule, until a future
 * wave resolves the open question below.
 *
 * Evidence gathered (Wave 0G-19, live-reprobed, fetch_number=1 only):
 *   - 20 zero-id rows examined across 2 streets (בני רייך, טום לנטוס), but
 *     ALL 20 are repeat sales of just 2 physical addresses (בני רייך 4 ×12,
 *     טום לנטוס 71 ×8) — the effective independent sample is 2, not 20.
 *   - Every one of the 20 carries neighborhoodName=null (not another
 *     entity's real name), its own streetCode matching the request, and an
 *     address that parses to exactly the requested street name.
 *   - COUNTER-EVIDENCE (found on ECC review, not resolved): the 2 zero-id
 *     addresses sit in cadastral block 9904-76, while every EXPLICITLY
 *     parent-tagged row on the SAME streets sits in different blocks (9905-
 *     88/89 for בני רייך; 13 distinct blocks, none 9904-76, for טום לנטוס).
 *     Wave 0G-18 already proved a single street CAN genuinely span more
 *     than one official entity (2 of its 7 mixed streets did). A distinct
 *     cadastral cluster is therefore consistent with EITHER "a real parcel
 *     group whose neighborhood tag was simply never backfilled" OR "a
 *     genuinely different administrative area that merely fronts the same
 *     street name" — the evidence gathered this wave does not distinguish
 *     between these two interpretations.
 *   - None of the 20 rows were found in the existing entity-level baseline
 *     corpus (0/20), so there is no cross-surface reconciliation proof
 *     either — only within-response internal consistency.
 *
 * This module implements exactly the narrow rule investigated (nothing
 * broader):
 *   - an explicit parent-id match is always accepted (unchanged baseline behavior)
 *   - a `neighborhoodId="0"` row is accepted ONLY when its OWN streetCode
 *     matches the requested street AND its OWN address parses to exactly
 *     the requested street name — both signals, not either alone
 *   - ANY other non-zero, non-parent neighborhoodId remains rejected
 *     unconditionally (CLASS C — foreign-entity contamination was NOT
 *     investigated this wave and must stay rejected until it is)
 *   - every decision carries an explicit, human-readable reason — no
 *     silent broadening, no blanket "accept any neighborhoodId=0"
 */

export type RowIdentityDecision =
  | "ACCEPT_PARENT_MATCH"
  | "ACCEPT_ZERO_ID_EVIDENCE"
  | "REJECT_ZERO_ID_INSUFFICIENT_EVIDENCE"
  | "REJECT_FOREIGN_NONZERO"
  | "REJECT_MISSING_IDENTITY";

export interface RowIdentityResult {
  decision: RowIdentityDecision;
  reason: string;
}

export interface RawStreetRowIdentityFields {
  neighborhoodId?: unknown;
  streetCode?: unknown;
  address?: unknown;
}

/**
 * Classifies ONE raw row from a direct street-scoped response. Pure, no
 * I/O. `requestedStreetName` must be the OFFICIAL street name exactly as
 * returned by the street catalog (lib/nadlanCatalog.ts's NadlanStreet.name)
 * — the same string the address field is compared against.
 */
export function classifyRowIdentity(
  raw: RawStreetRowIdentityFields,
  parentSourceId: string,
  requestedStreetId: string,
  requestedStreetName: string,
): RowIdentityResult {
  const nid = raw.neighborhoodId != null ? String(raw.neighborhoodId) : null;

  if (nid === parentSourceId) {
    return { decision: "ACCEPT_PARENT_MATCH", reason: `neighborhoodId matches requested parent entity ${parentSourceId}` };
  }

  if (nid === "0") {
    const streetIdMatch = raw.streetCode != null && String(raw.streetCode) === requestedStreetId;
    const addr = typeof raw.address === "string" ? raw.address : "";
    // ECC code-reviewer finding: a bare `startsWith` false-positives on a
    // real street whose name is a PREFIX of another (e.g. "הרב שלום" vs the
    // real street "הרב שלום איפרגן" — see kiryat_hasharon_street_manifest.csv
    // row 2). Extract the street portion the same way lib/dealNormalization.ts's
    // parseAddress() does (strip a trailing house-number token) and compare
    // EXACTLY, not by prefix.
    const m = addr.trim().match(/^(.+?)\s+(\d+[א-ת]?)$/);
    const parsedStreet = m ? m[1] : addr.trim();
    const nameMatch = parsedStreet === requestedStreetName;
    if (streetIdMatch && nameMatch) {
      return {
        decision: "ACCEPT_ZERO_ID_EVIDENCE",
        reason: `neighborhoodId=0 but streetCode=${String(raw.streetCode)} matches requested street ${requestedStreetId} AND address "${addr}" parses to exactly the requested street name "${requestedStreetName}" — within-response evidence only (Wave 0G-19 Phase 13 Policy 2). NOT independently confirmed against an external source; observed on 2 addresses (12+8 repeat-sale rows) across 2 streets — see the wave's report for the disclosed cadastral-block counter-evidence.`,
      };
    }
    return {
      decision: "REJECT_ZERO_ID_INSUFFICIENT_EVIDENCE",
      reason: `neighborhoodId=0 but insufficient evidence: streetIdMatch=${streetIdMatch} nameMatch=${nameMatch} (address="${addr}", parsedStreet="${parsedStreet}")`,
    };
  }

  if (nid == null) {
    return { decision: "REJECT_MISSING_IDENTITY", reason: "row carries no neighborhoodId at all" };
  }

  return {
    decision: "REJECT_FOREIGN_NONZERO",
    reason: `neighborhoodId=${nid} is a different, non-zero official entity — remains rejected (Wave 0G-19 Phase 9: foreign non-zero ids were NOT investigated this wave and stay rejected until independently proven)`,
  };
}

/** Aggregate decision counts for a batch — surfaces the visibility Phase 16 requires. */
export interface RowIdentityBatchCounts {
  acceptedParent: number;
  acceptedZero: number;
  rejectedForeign: number;
  rejectedZeroInsufficientEvidence: number;
  rejectedOther: number;
}

export function summarizeRowIdentityDecisions(decisions: RowIdentityDecision[]): RowIdentityBatchCounts {
  const counts: RowIdentityBatchCounts = { acceptedParent: 0, acceptedZero: 0, rejectedForeign: 0, rejectedZeroInsufficientEvidence: 0, rejectedOther: 0 };
  for (const d of decisions) {
    if (d === "ACCEPT_PARENT_MATCH") counts.acceptedParent++;
    else if (d === "ACCEPT_ZERO_ID_EVIDENCE") counts.acceptedZero++;
    else if (d === "REJECT_FOREIGN_NONZERO") counts.rejectedForeign++;
    else if (d === "REJECT_ZERO_ID_INSUFFICIENT_EVIDENCE") counts.rejectedZeroInsufficientEvidence++;
    else counts.rejectedOther++;
  }
  return counts;
}
