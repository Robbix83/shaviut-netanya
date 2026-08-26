/**
 * lib/nadlanCatalog.ts — official nadlan.gov.il neighborhood-entity discovery.
 *
 * Replaces GovMap TldSearch-derived neighborhood discovery (scripts/harvest.ts's
 * discoverNeighborhoods()) as a DISCOVERY SOURCE ONLY. Proven in Wave 0G-5/0G-6:
 * nadlan.gov.il's own https://data.nadlan.gov.il/api/pages/neighborhood/buy/{id}.json
 * endpoint exposes a stable `otherNeighborhoods` catalog, and GovMap-sourced ids
 * (data/neighborhoods.json) have ZERO overlap with nadlan's own internal id space.
 *
 * Identity model: every entity is identified ONLY by its upstream numeric id
 * (`sourceId`). Names are display metadata, never an identity key — no
 * Map<name, entity> / Set<name> / first-hit-by-name collapsing is used anywhere
 * in this module, precisely to avoid recreating the discoverNeighborhoods() defect
 * that discarded a duplicate-named-but-differently-id'd polygon (nof hatayelet
 * 66239231 vs the official 65210195 — see audit/wave0g4, audit/wave0g5).
 *
 * This module does NOT write canonical data, does NOT touch Supabase, and does
 * NOT reuse or reinterpret the existing application `neighborhoodId` domain —
 * see audit/wave0g7/OFFICIAL_DISCOVERY_IMPLEMENTATION.md Phase 12 for the
 * identifier-domain-safety analysis and why `sourceId` is deliberately kept
 * separate from the app's existing `Deal.neighborhoodId`/`Neighborhood.id`.
 */

export type NadlanSource = "nadlan";

/** A neighborhood entity as nadlan.gov.il's own catalog identifies it —
 * deliberately NOT the same domain as the app's existing neighborhoodId. */
export interface NadlanEntity {
  sourceId: string;
  name: string;
  source: NadlanSource;
  settlementId: string;
}

const NETANYA_SETTLEMENT_ID = "7400";
/** A known-good, previously-proven entity id used only to bootstrap discovery
 * (the catalog endpoint requires an existing valid id to query at all — there
 * is no "list everything with no starting point" upstream call). */
const DEFAULT_BOOTSTRAP_SOURCE_ID = "65210195"; // נוף הטיילת, proven Wave 0G-4/0G-5/0G-6

interface RawOtherNeighborhoodEntry {
  id?: unknown;
  title?: unknown;
}

interface RawNeighborhoodPage {
  settlementID?: unknown;
  settlementName?: unknown;
  otherNeighborhoods?: unknown;
}

export function buildNadlanNeighborhoodPageUrl(sourceId: string): string {
  return `https://data.nadlan.gov.il/api/pages/neighborhood/buy/${sourceId}.json`;
}

/**
 * Parses a raw nadlan.gov.il neighborhood-page JSON payload into a validated,
 * id-preserving entity list. Throws on structurally invalid input rather than
 * silently returning a partial/empty result — callers must handle the error,
 * not receive a falsely-successful empty catalog.
 */
export function parseNadlanCatalog(
  raw: unknown,
  opts?: { expectedSettlementId?: string | null },
): NadlanEntity[] {
  if (raw == null || typeof raw !== "object") {
    throw new Error("EMPTY_CATALOG: response body is not an object");
  }
  const page = raw as RawNeighborhoodPage;
  const list = page.otherNeighborhoods;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("EMPTY_CATALOG: otherNeighborhoods is missing, not an array, or empty");
  }

  const expectedSettlementId = opts?.expectedSettlementId === undefined
    ? NETANYA_SETTLEMENT_ID
    : opts.expectedSettlementId;
  const settlementIdRaw = page.settlementID;
  const settlementId = settlementIdRaw != null ? String(settlementIdRaw) : expectedSettlementId ?? "";
  if (expectedSettlementId != null && settlementIdRaw != null && String(settlementIdRaw) !== expectedSettlementId) {
    throw new Error(
      `SETTLEMENT_MISMATCH: expected settlementID ${expectedSettlementId}, got ${settlementIdRaw}`,
    );
  }

  const seenIds = new Set<string>();
  const entities: NadlanEntity[] = [];
  for (const entry of list as RawOtherNeighborhoodEntry[]) {
    if (entry == null || typeof entry !== "object") {
      throw new Error("INVALID_ENTRY: non-object entry in otherNeighborhoods");
    }
    const idVal = entry.id;
    const nameVal = entry.title;
    if (idVal == null || (typeof idVal !== "number" && typeof idVal !== "string")) {
      throw new Error(`INVALID_ENTRY: missing or invalid id (${JSON.stringify(entry)})`);
    }
    if (typeof nameVal !== "string" || nameVal.trim().length === 0) {
      throw new Error(`INVALID_ENTRY: missing or invalid title (${JSON.stringify(entry)})`);
    }
    const sourceId = String(idVal);
    // Identity is source-native id ONLY. Never dedupe/collapse by name — a
    // duplicate NAME with a distinct id must survive (this is exactly the
    // regression class the wave's own duplicate-polygon discovery exposed).
    if (seenIds.has(sourceId)) {
      throw new Error(`DUPLICATE_ID: sourceId ${sourceId} appears more than once in this catalog response`);
    }
    seenIds.add(sourceId);
    entities.push({ sourceId, name: nameVal.trim(), source: "nadlan", settlementId });
  }

  return entities;
}

/**
 * Fetches nadlan.gov.il's own neighborhood-entity catalog via a known bootstrap
 * entity id and returns the full entity list it exposes. Proven citywide-stable
 * across two independent standard-residential entities (Wave 0G-6); NOT yet
 * proven for every special-category entity, and NOT assumed to be forever fixed
 * at any particular size — callers must not hardcode an expected count.
 */
export async function getOfficialNetanyaEntities(
  bootstrapSourceId: string = DEFAULT_BOOTSTRAP_SOURCE_ID,
  fetchImpl: typeof fetch = fetch,
): Promise<NadlanEntity[]> {
  const url = buildNadlanNeighborhoodPageUrl(bootstrapSourceId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    throw new Error(`FETCH_FAILED: GET ${url} -> HTTP ${res.status}`);
  }
  const raw = await res.json();
  return parseNadlanCatalog(raw);
}

export interface NadlanEntityCoordinates {
  x: number | null;
  y: number | null;
}

/**
 * Parses the geographic-center `x`/`y` fields carried by a neighborhood-page
 * response (sibling fields to `otherNeighborhoods`, proven present in every
 * captured response — see audit/wave0g6/control-raw.json). Unlike
 * parseNadlanCatalog, a missing/non-numeric x or y is not fatal — it maps to
 * `null`, since coordinates are a display/fallback convenience for
 * normalize(), not an identity-bearing field.
 */
export function parseNadlanEntityCoordinates(raw: unknown): NadlanEntityCoordinates {
  if (raw == null || typeof raw !== "object") {
    throw new Error("EMPTY_PAGE: response body is not an object");
  }
  const page = raw as { x?: unknown; y?: unknown };
  return {
    x: typeof page.x === "number" ? page.x : null,
    y: typeof page.y === "number" ? page.y : null,
  };
}

/**
 * Fetches a SINGLE entity's own neighborhood-page response (by its own
 * sourceId, not the bootstrap id) and returns its geographic center. Reuses
 * the same plain, unauthenticated GET proven safe in Wave 0G-6 — no
 * reCAPTCHA, no browser automation required.
 */
export async function getNadlanEntityCoordinates(
  sourceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NadlanEntityCoordinates> {
  const url = buildNadlanNeighborhoodPageUrl(sourceId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    throw new Error(`FETCH_FAILED: GET ${url} -> HTTP ${res.status}`);
  }
  const raw = await res.json();
  return parseNadlanEntityCoordinates(raw);
}

/** A street belonging to one entity, as nadlan.gov.il's own catalog exposes
 * it via `otherNeighborhoodStreets` (Wave 0G-17 discovery). Identity is the
 * upstream numeric streetId — never the name, for the same reason
 * NadlanEntity's identity is sourceId, not name (see module docstring). */
export interface NadlanStreet {
  streetId: string;
  name: string;
}

interface RawStreetEntry {
  id?: unknown;
  title?: unknown;
}

interface RawNeighborhoodPageWithStreets extends RawNeighborhoodPage {
  otherNeighborhoodStreets?: unknown;
}

/**
 * Parses the `otherNeighborhoodStreets` field of a neighborhood-page
 * response into a validated, id-preserving street list for that one entity.
 * Same fail-closed shape as parseNadlanCatalog: throws (never silently
 * returns a partial/empty list) on a missing/empty field, an invalid entry,
 * or a duplicate streetId — Wave 0G-18 Phase 3 explicitly requires "no
 * duplicate source IDs, no silent name-based collapse".
 */
export function parseNadlanStreetCatalog(raw: unknown): NadlanStreet[] {
  if (raw == null || typeof raw !== "object") {
    throw new Error("EMPTY_STREET_CATALOG: response body is not an object");
  }
  const page = raw as RawNeighborhoodPageWithStreets;
  const list = page.otherNeighborhoodStreets;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("EMPTY_STREET_CATALOG: otherNeighborhoodStreets is missing, not an array, or empty");
  }

  const seenIds = new Set<string>();
  const streets: NadlanStreet[] = [];
  for (const entry of list as RawStreetEntry[]) {
    if (entry == null || typeof entry !== "object") {
      throw new Error("INVALID_STREET_ENTRY: non-object entry in otherNeighborhoodStreets");
    }
    const idVal = entry.id;
    const nameVal = entry.title;
    if (idVal == null || (typeof idVal !== "number" && typeof idVal !== "string")) {
      throw new Error(`INVALID_STREET_ENTRY: missing or invalid id (${JSON.stringify(entry)})`);
    }
    if (typeof nameVal !== "string" || nameVal.trim().length === 0) {
      throw new Error(`INVALID_STREET_ENTRY: missing or invalid title (${JSON.stringify(entry)})`);
    }
    const streetId = String(idVal);
    if (seenIds.has(streetId)) {
      throw new Error(`DUPLICATE_STREET_ID: streetId ${streetId} appears more than once in this catalog response`);
    }
    seenIds.add(streetId);
    streets.push({ streetId, name: nameVal.trim() });
  }

  return streets;
}

/**
 * Fetches ONE entity's own neighborhood-page response (same safe,
 * unauthenticated GET as getNadlanEntityCoordinates) and returns its
 * validated street list. Entity-scoped — a street enumerated here belongs
 * to THIS sourceId's own page, never merged across entities.
 */
export async function getOfficialEntityStreets(
  sourceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NadlanStreet[]> {
  const url = buildNadlanNeighborhoodPageUrl(sourceId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    throw new Error(`FETCH_FAILED: GET ${url} -> HTTP ${res.status}`);
  }
  const raw = await res.json();
  return parseNadlanStreetCatalog(raw);
}

/**
 * Best-effort, NAME-PATTERN-derived category hint for diagnostic/reporting use
 * only. nadlan's own catalog response carries no structured category/type
 * field for entities — this is NOT authoritative upstream data, just a display
 * aid so special-category entities (industrial/planning/CBD) can be surfaced
 * without being silently dropped or misclassified as ordinary residential.
 */
export type EntityCategoryHint = "industrial" | "planning" | "cbd" | "residential";

export function inferEntityCategoryHint(name: string): EntityCategoryHint {
  if (/אזור\s*תעשיה/.test(name)) return "industrial";
  if (/בתכנון/.test(name)) return "planning";
  if (/מע"ר|מרכז עירוני/.test(name)) return "cbd";
  return "residential";
}
