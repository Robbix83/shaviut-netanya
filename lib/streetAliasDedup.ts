/**
 * lib/streetAliasDedup.ts
 * Wave 0F-1: groups street-index entries that are proven aliases of the same
 * physical street, so autocomplete can show one canonical suggestion instead
 * of one row per raw spelling (e.g. "ויצמן" / "שד ויצמן" — Wave 0E-3A).
 *
 * Deliberately narrow identity rule — see groupStreetAliases() below. Pure,
 * dependency-free, so it's directly unit-testable without mocking fs/Next.
 */

export interface StreetIndexEntry {
  street: string;
  /** Official municipal street code, when the entry comes from the real registry. */
  code: number | null;
  neighborhoodId: string;
  neighborhoodName: string;
  x: number | null;
  y: number | null;
}

export interface StreetAliasGroup {
  /** The entry chosen as the single user-facing suggestion for this group. */
  canonical: StreetIndexEntry;
  /** All entries in the group, including the canonical one — every member's
   *  raw street string must still match search queries against itself. */
  members: StreetIndexEntry[];
}

// Same prefix set/regex as lib/valuation.ts's normalizeStreet() — kept in sync
// deliberately (not imported from lib/valuation.ts, to avoid this route pulling
// in any part of the valuation module; the pattern is a fixed constant, not
// business logic that could drift).
const STREET_PREFIX = /^(שד'?|שדרות|רחוב|רח')\s*/i;

export function normalizeStreetForAlias(s: string): string {
  return s.replace(STREET_PREFIX, "").trim();
}

/** Two entries are the same physical street only when BOTH share a proven
 * identity: an exactly-equal municipal code, or (when a code is missing on
 * either side) exactly-equal coordinates. No fuzzy/distance matching, no
 * neighborhoodId-based matching (neighborhoodId is not a canonical street
 * identifier — two distinct streets can share a neighborhood). */
function samePhysicalStreet(a: StreetIndexEntry, b: StreetIndexEntry): boolean {
  if (a.code != null && b.code != null) return a.code === b.code;
  const aHasCoords = a.x != null && a.y != null;
  const bHasCoords = b.x != null && b.y != null;
  if (aHasCoords && bHasCoords) return a.x === b.x && a.y === b.y;
  return false; // insufficient evidence — never merge on name similarity alone
}

/** The officially-coded entry is preferred as the canonical display row;
 * otherwise the first-encountered entry is kept (stable, deterministic). */
function isMoreCanonical(candidate: StreetIndexEntry, current: StreetIndexEntry): boolean {
  return candidate.code != null && current.code == null;
}

/**
 * Groups street-index entries into alias groups.
 *
 * Step 1 buckets by normalized name only as a CANDIDATE filter (matching
 * normalized text alone is not sufficient proof of identity — see Wave 0F-1
 * report: two genuinely different streets could theoretically normalize to
 * the same text).
 * Step 2, within each bucket, only merges entries that ALSO pass
 * samePhysicalStreet() — proven code or coordinate identity.
 */
export function groupStreetAliases(entries: StreetIndexEntry[]): StreetAliasGroup[] {
  const byName = new Map<string, StreetIndexEntry[]>();
  for (const e of entries) {
    const norm = normalizeStreetForAlias(e.street);
    const bucket = byName.get(norm);
    if (bucket) bucket.push(e);
    else byName.set(norm, [e]);
  }

  const groups: StreetAliasGroup[] = [];
  for (const bucket of byName.values()) {
    const used = new Array(bucket.length).fill(false);
    for (let i = 0; i < bucket.length; i++) {
      if (used[i]) continue;
      const cluster = [bucket[i]];
      used[i] = true;
      for (let j = i + 1; j < bucket.length; j++) {
        if (!used[j] && samePhysicalStreet(bucket[i], bucket[j])) {
          cluster.push(bucket[j]);
          used[j] = true;
        }
      }
      let canonical = cluster[0];
      for (const e of cluster) if (isMoreCanonical(e, canonical)) canonical = e;
      groups.push({ canonical, members: cluster });
    }
  }
  return groups;
}

/** Convenience lookup: raw street string -> its group's canonical entry. */
export function buildCanonicalStreetMap(entries: StreetIndexEntry[]): Map<string, StreetIndexEntry> {
  const map = new Map<string, StreetIndexEntry>();
  for (const group of groupStreetAliases(entries)) {
    for (const member of group.members) map.set(member.street, group.canonical);
  }
  return map;
}
