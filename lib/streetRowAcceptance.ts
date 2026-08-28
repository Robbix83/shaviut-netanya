/**
 * lib/streetRowAcceptance.ts — Wave 0G-20: per-row identity acceptance for
 * a direct source-native street request, replacing Wave 0G-18's whole-batch
 * fail-closed rule (scripts/audit-wave0g18-street-runner.ts's original
 * classifyStreetExchange: one conflicting row failed the ENTIRE street,
 * discarding valid explicit-parent rows along with it).
 *
 * NARROW ON PURPOSE. Only an explicit, exact row-level neighborhoodId match
 * to the requested parent entity is ever accepted. This module's own type
 * union has NO "accept zero" or "accept foreign" variant — Wave 0G-19 left
 * ZERO_ID_SEMANTICS=UNRESOLVED and ZERO_NEIGHBORHOOD_POLICY=PARTIAL, so this
 * wave does not adopt or import that unresolved policy (lib/streetIdentityPolicy.ts
 * remains separate, untouched, and still not wired into any live path).
 * Foreign non-zero ids stay rejected unconditionally, same as before.
 */

export type RowAcceptanceDecision =
  | "ACCEPT_PARENT"
  | "REJECT_ZERO"
  | "REJECT_FOREIGN"
  | "REJECT_MISSING"
  | "REJECT_MALFORMED";

export interface RawRowIdentityFields {
  neighborhoodId?: unknown;
}

/**
 * Classifies ONE raw row's neighborhoodId against the requested parent
 * entity. Pure, no I/O. The ONLY path that returns an "accept" decision is
 * an exact string match to parentSourceId — every other case (including
 * "0", a different non-zero id, missing, or a non-numeric/malformed value)
 * is rejected, unconditionally, with no street-name or address inference
 * of any kind (explicitly forbidden this wave).
 */
export function classifyRowForAcceptance(raw: RawRowIdentityFields, parentSourceId: string): RowAcceptanceDecision {
  const nidRaw = raw.neighborhoodId;
  if (nidRaw == null) return "REJECT_MISSING";
  const nid = String(nidRaw).trim();
  if (nid === "") return "REJECT_MISSING";
  if (nid === parentSourceId) return "ACCEPT_PARENT";
  if (nid === "0") return "REJECT_ZERO";
  if (!/^\d+$/.test(nid)) return "REJECT_MALFORMED";
  return "REJECT_FOREIGN";
}

export interface RowAcceptanceCounts {
  rawRows: number;
  acceptedParent: number;
  rejectedZero: number;
  rejectedForeign: number;
  rejectedMissing: number;
  rejectedMalformed: number;
}

/**
 * Classifies an entire batch of raw rows and returns exact counts, with a
 * hard accounting-invariant assertion (Wave 0G-20 Phase 6): every row must
 * land in exactly one bucket, and the buckets must sum to rawRows. Throws
 * (never silently continues) if that invariant is ever violated — a row
 * cannot disappear or double-count.
 */
export function classifyBatchForAcceptance(rawRows: RawRowIdentityFields[], parentSourceId: string): RowAcceptanceCounts {
  const counts: RowAcceptanceCounts = { rawRows: rawRows.length, acceptedParent: 0, rejectedZero: 0, rejectedForeign: 0, rejectedMissing: 0, rejectedMalformed: 0 };
  for (const raw of rawRows) {
    const decision = classifyRowForAcceptance(raw, parentSourceId);
    if (decision === "ACCEPT_PARENT") counts.acceptedParent++;
    else if (decision === "REJECT_ZERO") counts.rejectedZero++;
    else if (decision === "REJECT_FOREIGN") counts.rejectedForeign++;
    else if (decision === "REJECT_MISSING") counts.rejectedMissing++;
    else counts.rejectedMalformed++;
  }
  const sum = counts.acceptedParent + counts.rejectedZero + counts.rejectedForeign + counts.rejectedMissing + counts.rejectedMalformed;
  if (sum !== counts.rawRows) {
    throw new Error(`ROW_ACCOUNTING_INVARIANT_VIOLATED: rawRows=${counts.rawRows} but classified sum=${sum} — a row was lost or double-counted`);
  }
  return counts;
}

export type MixedBatchStatus =
  | "SUCCESS_ALL_PARENT"
  | "SUCCESS_MIXED_PARTIAL"
  | "SUCCESS_EMPTY"
  | "FAILED_NO_TRUSTED_ROWS";

/**
 * Derives the batch-level status from row counts alone (Wave 0G-20 Phase
 * 5). A batch with ANY accepted-parent rows is a (possibly mixed) success —
 * it must never be silently reported as a clean all-parent success when it
 * actually contained rejected rows too.
 */
export function classifyBatchStatus(counts: RowAcceptanceCounts): MixedBatchStatus {
  if (counts.rawRows === 0) return "SUCCESS_EMPTY";
  if (counts.acceptedParent === counts.rawRows) return "SUCCESS_ALL_PARENT";
  if (counts.acceptedParent > 0) return "SUCCESS_MIXED_PARTIAL";
  return "FAILED_NO_TRUSTED_ROWS";
}
