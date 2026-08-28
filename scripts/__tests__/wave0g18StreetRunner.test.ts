/**
 * scripts/__tests__/wave0g18StreetRunner.test.ts — Wave 0G-18 Phase 23
 * focused tests for the street runner's PURE classification logic
 * (classifyStreetExchange) and its resume-safety contract. The live
 * Playwright acquisition loop (navigation, retry/backoff, response capture)
 * is integration-level browser automation, validated live against the real
 * site (see audit/wave0g18/KIRYAT_HASHARON_STREET_AUGMENTATION.md) —
 * consistent with this engagement's established pattern (Wave 0G-16's own
 * test file takes the identical approach for its entity-level runner).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { classifyStreetExchange, RUN_CONTRACT_VERSION, PARENT_SOURCE_ID } from "../audit-wave0g18-street-runner";
import type { NadlanStreet } from "../../lib/nadlanCatalog";
import type { Neighborhood } from "../../lib/types";

const STREET: NadlanStreet = { streetId: "74000847", name: "דגניה" };
const NEIGHBORHOOD: Neighborhood = { id: PARENT_SOURCE_ID, name: "קריית השרון", settlement: "נתניה", x: null, y: null };

function envelope(overrides: Partial<{ base_id: string; base_name: string; fetch_number: number; type_order: string }> = {}) {
  return { base_id: STREET.streetId, base_name: "streetCode", fetch_number: 1, type_order: "dealDate_down", domain: "d", credentialFieldsPresent: [], ...overrides };
}

function rawItem(overrides: any = {}) {
  return {
    neighborhoodId: PARENT_SOURCE_ID, dealAmount: 2000000, dealDate: "2024-05-01", address: "דגניה 5",
    roomNum: 4, assetArea: 90, floor: 2, dealNature: "דירה", parcelNum: "8252-100-1",
    ...overrides,
  };
}

function decodedResponse(items: any[], overrides: any = {}) {
  return { data: { items, total_rows: items.length, total_fetch: 1, total_page: 1, ...overrides } };
}

describe("A/H — 70-street manifest duplicate ID handling is enforced upstream (lib/nadlanCatalog.ts), not re-tested here", () => {
  it("RUN_CONTRACT_VERSION is a stable, non-empty tag distinct from prior waves", () => {
    expect(RUN_CONTRACT_VERSION).toBe("wave0g18-v1");
    expect(RUN_CONTRACT_VERSION).not.toBe("wave0g16-v1");
  });
});

describe("B — SUCCESS_EMPTY differs from a request failure", () => {
  it("classifies a legitimate 0-item response as SUCCESS_EMPTY, not FAILED_*", () => {
    const result = classifyStreetExchange(STREET, PARENT_SOURCE_ID, NEIGHBORHOOD, envelope(), [], decodedResponse([]));
    expect(result.status).toBe("SUCCESS_EMPTY");
    expect(result.failureReason).toBeNull();
  });
});

describe("C — fetch1-only contract rejects fetch_number>1 execution", () => {
  it("marks a captured fetch_number=2 envelope as FAILED_OTHER, never silently accepted into the union", () => {
    const items = [rawItem()];
    const result = classifyStreetExchange(STREET, PARENT_SOURCE_ID, NEIGHBORHOOD, envelope({ fetch_number: 2 }), items, decodedResponse(items));
    expect(result.status).toBe("FAILED_OTHER");
    expect(result.failureReason).toMatch(/UNEXPECTED_FETCH_NUMBER/);
    expect(result.rows).toHaveLength(0);
  });
});

describe("D — total_fetch>1 is surfaced as PARTIAL_MORE_FETCHES_INDICATED, fetch-1 rows kept", () => {
  it("keeps the fetched rows while flagging deeper pagination exists", () => {
    const items = [rawItem(), rawItem({ dealDate: "2024-06-01", parcelNum: "8252-100-2" })];
    const result = classifyStreetExchange(STREET, PARENT_SOURCE_ID, NEIGHBORHOOD, envelope(), items, decodedResponse(items, { total_fetch: 2, total_rows: 501 }));
    expect(result.status).toBe("PARTIAL_MORE_FETCHES_INDICATED");
    expect(result.rows).toHaveLength(2);
    expect(result.contract.totalFetch).toBe(2);
  });
});

describe("E/F — cross-surface duplicate collapse is delegated to dedupByTransactionKey (shared, already tested) — this module only classifies+normalizes", () => {
  it("normalizes valid rows into ShadowDeal shape with sourceId/parcelNum carried through", () => {
    const items = [rawItem()];
    const result = classifyStreetExchange(STREET, PARENT_SOURCE_ID, NEIGHBORHOOD, envelope(), items, decodedResponse(items));
    expect(result.status).toBe("SUCCESS_ROWS");
    expect(result.rows[0].sourceId).toBe(PARENT_SOURCE_ID);
    expect(result.rows[0].parcelNum).toBe("8252-100-1");
  });
});

describe("H — wrong parent identity (Wave 0G-20: PER-ROW acceptance, superseding Wave 0G-18's whole-batch rejection)", () => {
  it("a foreign-only batch (no parent rows at all) fails as FAILED_NO_TRUSTED_ROWS, not silently filtered — updated from Wave 0G-18's FAILED_IDENTITY, same safety property (0 rows accepted)", () => {
    const items = [rawItem({ neighborhoodId: "99999999" })];
    const result = classifyStreetExchange(STREET, PARENT_SOURCE_ID, NEIGHBORHOOD, envelope(), items, decodedResponse(items));
    expect(result.status).toBe("FAILED_NO_TRUSTED_ROWS");
    expect(result.rowsOtherEntity).toBe(1);
    expect(result.rows).toHaveLength(0);
  });

  it("Wave 0G-20 CHANGE: a MIXED batch (some correct, some wrong entity) now accepts the valid parent row and rejects the foreign one — status SUCCESS_MIXED_PARTIAL, never a clean SUCCESS_ROWS and never a whole-batch failure that would discard the valid row too", () => {
    const items = [rawItem(), rawItem({ neighborhoodId: "99999999", parcelNum: "9-9-9" })];
    const result = classifyStreetExchange(STREET, PARENT_SOURCE_ID, NEIGHBORHOOD, envelope(), items, decodedResponse(items));
    expect(result.status).toBe("SUCCESS_MIXED_PARTIAL");
    expect(result.rows).toHaveLength(1); // the valid parent row is preserved, not discarded
    expect(result.rows[0].parcelNum).toBe("8252-100-1");
    expect(result.rowsOtherEntity).toBe(1); // the foreign row is rejected, not silently accepted
    expect(result.rowAcceptanceCounts).toMatchObject({ rawRows: 2, acceptedParent: 1, rejectedForeign: 1 });
  });
});

describe("I — normalization drops are surfaced, not invisible", () => {
  it("reports normalizationDrops>0 when some rows fail normalizeDeal (e.g. missing price) but others survive", () => {
    const items = [rawItem(), rawItem({ dealAmount: null, parcelNum: "8252-100-3" })];
    const result = classifyStreetExchange(STREET, PARENT_SOURCE_ID, NEIGHBORHOOD, envelope(), items, decodedResponse(items));
    expect(result.status).toBe("SUCCESS_ROWS");
    expect(result.normalizationDrops).toBe(1);
    expect(result.rows).toHaveLength(1);
  });

  it("classifies a total normalization wipeout (all rows dropped) as FAILED_NORMALIZATION, not a false SUCCESS_EMPTY", () => {
    const items = [rawItem({ dealAmount: null }), rawItem({ dealAmount: 0, parcelNum: "8252-100-4" })];
    const result = classifyStreetExchange(STREET, PARENT_SOURCE_ID, NEIGHBORHOOD, envelope(), items, decodedResponse(items));
    expect(result.status).toBe("FAILED_NORMALIZATION");
    expect(result.failureReason).toMatch(/ALL_ACCEPTED_ROWS_DROPPED_BY_NORMALIZATION/);
  });
});

describe("Contamination classification (Phase 8) — same-entity/different-street rows are reported, not failed", () => {
  it("splits rowsMatchingRequestedStreet vs rowsOtherStreetSameEntity without failing the street", () => {
    const items = [rawItem({ address: "דגניה 5" }), rawItem({ address: "טבת 2", parcelNum: "8252-100-5" })];
    const result = classifyStreetExchange(STREET, PARENT_SOURCE_ID, NEIGHBORHOOD, envelope(), items, decodedResponse(items));
    expect(result.status).toBe("SUCCESS_ROWS");
    expect(result.rowsMatchingRequestedStreet).toBe(1);
    expect(result.rowsOtherStreetSameEntity).toBe(1);
    expect(result.rowsOtherEntity).toBe(0);
  });
});

describe("J — prevDeals are extracted but kept as a separate field, not folded into top-level rows", () => {
  it("extracts prevDeal events from a raw item's nested prevDeals array using the shared, already-tested extractor", () => {
    const items = [rawItem({ prevDeals: [{ dealDate: "2019-01-01", dealAmount: 1500000 }] })];
    const result = classifyStreetExchange(STREET, PARENT_SOURCE_ID, NEIGHBORHOOD, envelope(), items, decodedResponse(items));
    expect(result.status).toBe("SUCCESS_ROWS");
    expect(result.rows).toHaveLength(1);
    expect(result.prevDealEvents).toHaveLength(1);
    expect(result.prevDealEvents[0]).toMatchObject({ dealDate: "2019-01-01", price: 1500000 });
  });

  it("a street with zero prevDeals still classifies normally, with an empty prevDealEvents array", () => {
    const items = [rawItem()];
    const result = classifyStreetExchange(STREET, PARENT_SOURCE_ID, NEIGHBORHOOD, envelope(), items, decodedResponse(items));
    expect(result.prevDealEvents).toEqual([]);
  });
});

describe("K — resume contract mismatch refuses a stale result (source-level guard, same shape as Wave 0G-16's proven pattern)", () => {
  const src = readFileSync(path.join(__dirname, "..", "audit-wave0g18-street-runner.ts"), "utf8");

  it("loadExistingResult checks runContractVersion, parentSourceId, and streetId before ever reusing a cached result", () => {
    expect(src).toMatch(/parsed\.runContractVersion\s*!==\s*RUN_CONTRACT_VERSION\)\s*return null/);
    expect(src).toMatch(/parsed\.parentSourceId\s*!==\s*PARENT_SOURCE_ID\)\s*return null/);
    expect(src).toMatch(/parsed\.streetId\s*!==\s*streetId\)\s*return null/);
  });

  it("FAILED_* statuses are never resumed — RESUMABLE_STATUSES lists exactly the 4 terminal-success statuses (Wave 0G-20 added SUCCESS_MIXED_PARTIAL), no FAILED_* variant", () => {
    const decl = src.match(/const RESUMABLE_STATUSES:.*?\];/s)?.[0] ?? "";
    expect(decl).toMatch(/"SUCCESS_ROWS"/);
    expect(decl).toMatch(/"SUCCESS_MIXED_PARTIAL"/);
    expect(decl).toMatch(/"SUCCESS_EMPTY"/);
    expect(decl).toMatch(/"PARTIAL_MORE_FETCHES_INDICATED"/);
    expect(decl).not.toMatch(/FAILED_/);
  });
});

describe("L/M — the street runner cannot write canonical data or Supabase", () => {
  const src = readFileSync(path.join(__dirname, "..", "audit-wave0g18-street-runner.ts"), "utf8");

  it("L: contains no executable reference to data/deals.json or data/neighborhoods.json (comments are fine)", () => {
    const executableLines = src.split("\n")
      .filter((l) => l.includes("deals.json") || l.includes("neighborhoods.json"))
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
    expect(executableLines).toEqual([]);
  });

  it("M: contains no Supabase client import or upsert call", () => {
    expect(src).not.toMatch(/from\s+["']@supabase\/supabase-js["']/);
    expect(src).not.toMatch(/createClient\s*\(/);
    expect(src).not.toMatch(/\.from\([^)]*\)\.upsert\(/);
  });

  it("every write goes through assertSafeShadowOutputPath (no raw fs.writeFile bypassing the guard)", () => {
    expect(src).toMatch(/assertSafeShadowOutputPath\(/);
    const writeFileCalls = [...src.matchAll(/fs\.writeFile\(([^)]*)\)/gs)];
    // Every fs.writeFile call site must be preceded (within the same function)
    // by a call to assertSafeShadowOutputPath — approximated here by requiring
    // every write target to be one of the two guarded path-builder helpers.
    expect(writeFileCalls.length).toBeGreaterThan(0);
    for (const call of writeFileCalls) {
      expect(call[1]).toMatch(/resultPath\(|SHADOW_DIR/);
    }
  });
});

describe("WRONG_BASE_NAME guard — a mis-served baseline exchange is never mistaken for a street-scoped one", () => {
  it("classifies a neighborhoodId-based exchange (the page's own baseline re-fetch) as FAILED_OTHER, not SUCCESS", () => {
    const items = [rawItem()];
    const result = classifyStreetExchange(STREET, PARENT_SOURCE_ID, NEIGHBORHOOD, envelope({ base_name: "neighborhoodId" }), items, decodedResponse(items));
    expect(result.status).toBe("FAILED_OTHER");
    expect(result.failureReason).toMatch(/WRONG_BASE_NAME/);
  });

  it("classifies an undecodable envelope (null) as FAILED_OTHER", () => {
    const items = [rawItem()];
    const result = classifyStreetExchange(STREET, PARENT_SOURCE_ID, NEIGHBORHOOD, null, items, decodedResponse(items));
    expect(result.status).toBe("FAILED_OTHER");
    expect(result.failureReason).toMatch(/UNDECODABLE_ENVELOPE/);
  });
});

describe("REGRESSION (ECC round-1 finding, confirmed independently by planner/specialist/silent-failure-hunter): a streetCode exchange for a DIFFERENT street must never be silently accepted as this street's data", () => {
  it("rejects an exchange whose base_id does not match the requested street, even though base_name is correctly 'streetCode'", () => {
    const OTHER_STREET_ID = "74001224"; // טבת — a different real street
    const items = [rawItem()];
    const result = classifyStreetExchange(STREET, PARENT_SOURCE_ID, NEIGHBORHOOD, envelope({ base_id: OTHER_STREET_ID }), items, decodedResponse(items));
    expect(result.status).toBe("FAILED_OTHER");
    expect(result.failureReason).toMatch(/WRONG_STREET_ID/);
    expect(result.rows).toHaveLength(0);
  });

  it("accepts a matching base_id as before (no regression on the happy path)", () => {
    const items = [rawItem()];
    const result = classifyStreetExchange(STREET, PARENT_SOURCE_ID, NEIGHBORHOOD, envelope({ base_id: STREET.streetId }), items, decodedResponse(items));
    expect(result.status).toBe("SUCCESS_ROWS");
  });

  it("the runner's response handler only latches an exchange whose base_name AND base_id both match — verified by source inspection since this is integration-level Playwright logic", () => {
    const src = readFileSync(path.join(__dirname, "..", "audit-wave0g18-street-runner.ts"), "utf8");
    expect(src).toMatch(/envelope\?\.base_name === "streetCode" && \(envelope\.base_id == null \|\| String\(envelope\.base_id\) === street\.streetId\)/);
    // The original bug: an `else if (!captured)` branch performed the SAME
    // assignment as the "correct" branch, making the base_name check a
    // no-op — any first response latched in regardless of shape. Confirm
    // that dead-duplicate pattern is gone.
    expect(src).not.toMatch(/else if \(!captured\) \{\s*captured = /);
  });
});
