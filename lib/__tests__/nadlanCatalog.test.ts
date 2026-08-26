import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  parseNadlanCatalog,
  getOfficialNetanyaEntities,
  buildNadlanNeighborhoodPageUrl,
  inferEntityCategoryHint,
  parseNadlanEntityCoordinates,
  getNadlanEntityCoordinates,
  parseNadlanStreetCatalog,
  getOfficialEntityStreets,
  type NadlanEntity,
} from "../nadlanCatalog";

/**
 * Wave 0G-7: official nadlan.gov.il discovery source. Identity is always the
 * upstream numeric id (sourceId) — never a name. TEST B specifically guards
 * against recreating the discoverNeighborhoods() defect (Wave 0G-4/0G-5) that
 * silently discarded a same-named, differently-id'd polygon.
 */

function page(overrides: Partial<{ settlementID: unknown; otherNeighborhoods: unknown }> = {}) {
  return {
    neighborhoodId: 65210195,
    neighborhoodName: "נוף הטיילת",
    settlementID: 7400,
    settlementName: "נתניה",
    otherNeighborhoods: [
      { title: "נוף הטיילת", id: 65210195 },
      { title: "רסקו", id: 65210248 },
      { title: "אגמים", id: 65210238 },
    ],
    ...overrides,
  };
}

describe("TEST A — parser preserves all ids", () => {
  it("returns one NadlanEntity per otherNeighborhoods entry, no loss", () => {
    const entities = parseNadlanCatalog(page());
    expect(entities.length).toBe(3);
    expect(entities.map((e) => e.sourceId).sort()).toEqual(["65210195", "65210238", "65210248"].sort());
  });

  it("preserves a large, realistic 38-entity catalog with zero loss", () => {
    const raw = JSON.parse(
      readFileSync(path.join(__dirname, "..", "..", "audit", "wave0g6", "control-raw.json"), "utf8").replace(/^﻿/, ""),
    );
    const entities = parseNadlanCatalog(raw);
    expect(entities.length).toBe(38);
    expect(new Set(entities.map((e) => e.sourceId)).size).toBe(38);
  });
});

describe("TEST B — same-name, different-id entities both survive", () => {
  it("does not collapse two entries sharing an identical name string", () => {
    const raw = page({
      otherNeighborhoods: [
        { title: "נוף הטיילת", id: 65210195 },
        { title: "נוף הטיילת", id: 66239231 }, // same display name, different upstream id
      ],
    });
    const entities = parseNadlanCatalog(raw);
    expect(entities.length).toBe(2);
    expect(entities.map((e) => e.sourceId).sort()).toEqual(["65210195", "66239231"]);
    expect(entities.every((e) => e.name === "נוף הטיילת")).toBe(true);
  });
});

describe("TEST C — empty/invalid catalog fails safely", () => {
  it("throws (does not silently return []) when otherNeighborhoods is missing", () => {
    expect(() => parseNadlanCatalog({ settlementID: 7400 })).toThrow(/EMPTY_CATALOG/);
  });

  it("throws when otherNeighborhoods is an empty array", () => {
    expect(() => parseNadlanCatalog(page({ otherNeighborhoods: [] }))).toThrow(/EMPTY_CATALOG/);
  });

  it("throws when raw is not an object", () => {
    expect(() => parseNadlanCatalog(null)).toThrow(/EMPTY_CATALOG/);
    expect(() => parseNadlanCatalog("not json")).toThrow(/EMPTY_CATALOG/);
  });

  it("throws on a structurally invalid entry (missing id)", () => {
    expect(() => parseNadlanCatalog(page({ otherNeighborhoods: [{ title: "X" }] }))).toThrow(/INVALID_ENTRY/);
  });

  it("throws on a structurally invalid entry (missing/blank title)", () => {
    expect(() => parseNadlanCatalog(page({ otherNeighborhoods: [{ id: 1 }] }))).toThrow(/INVALID_ENTRY/);
    expect(() => parseNadlanCatalog(page({ otherNeighborhoods: [{ id: 1, title: "  " }] }))).toThrow(/INVALID_ENTRY/);
  });

  it("throws on a duplicate id within the same response (would indicate an upstream anomaly, not a name collision)", () => {
    expect(() =>
      parseNadlanCatalog(page({ otherNeighborhoods: [{ id: 1, title: "A" }, { id: 1, title: "B" }] })),
    ).toThrow(/DUPLICATE_ID/);
  });

  it("throws on a settlement mismatch when a different settlementId was expected", () => {
    expect(() => parseNadlanCatalog(page(), { expectedSettlementId: "9999" })).toThrow(/SETTLEMENT_MISMATCH/);
  });
});

describe("TEST D — catalog size can legitimately change without runtime failure", () => {
  it("accepts a 1-entity catalog", () => {
    expect(parseNadlanCatalog(page({ otherNeighborhoods: [{ id: 1, title: "Solo" }] })).length).toBe(1);
  });

  it("accepts a catalog larger than the currently-observed 38", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, title: `שכונה ${i + 1}` }));
    expect(parseNadlanCatalog(page({ otherNeighborhoods: many })).length).toBe(100);
  });

  it("does not hardcode an expected count of 38 anywhere in the parser", () => {
    const src = readFileSync(path.join(__dirname, "..", "nadlanCatalog.ts"), "utf8");
    expect(src).not.toMatch(/===\s*38|length\s*===\s*38|!==\s*38/);
  });
});

describe("TEST G — Nof Hatayelet official id produces the correct request shape", () => {
  it("builds the exact proven URL for id=65210195", () => {
    expect(buildNadlanNeighborhoodPageUrl("65210195")).toBe(
      "https://data.nadlan.gov.il/api/pages/neighborhood/buy/65210195.json",
    );
  });

  it("builds the correct URL for an arbitrary id", () => {
    expect(buildNadlanNeighborhoodPageUrl("65210248")).toBe(
      "https://data.nadlan.gov.il/api/pages/neighborhood/buy/65210248.json",
    );
  });
});

describe("TEST H — GovMap id/source is not used by the new discovery path", () => {
  it("lib/nadlanCatalog.ts's EXECUTABLE code never references GovMap/TldSearch/ObjectID (the header docstring explains why it replaces GovMap, which is expected)", () => {
    const src = readFileSync(path.join(__dirname, "..", "nadlanCatalog.ts"), "utf8");
    const executableSrc = src
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("*") && !t.startsWith("/**") && !t.startsWith("//");
      })
      .join("\n");
    expect(executableSrc).not.toMatch(/govmap|TldSearch|ObjectID/i);
  });

  it("getOfficialNetanyaEntities never hits es.govmap.gov.il, only data.nadlan.gov.il", async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => page(),
      } as unknown as Response;
    }) as typeof fetch;
    await getOfficialNetanyaEntities("65210195", fakeFetch);
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("data.nadlan.gov.il");
    expect(calls[0]).not.toContain("govmap");
  });

  it("propagates a clear error on a non-OK HTTP response, without silently returning an empty catalog", async () => {
    const fakeFetch = (async () => ({ ok: false, status: 403 }) as unknown as Response) as typeof fetch;
    await expect(getOfficialNetanyaEntities("65210195", fakeFetch)).rejects.toThrow(/FETCH_FAILED/);
  });
});

describe("TEST J — per-entity coordinate parsing (Wave 0G-11)", () => {
  it("extracts real numeric x/y from an actual captured nadlan.gov.il response", () => {
    const raw = JSON.parse(
      readFileSync(path.join(__dirname, "..", "..", "audit", "wave0g6", "control-raw.json"), "utf8").replace(/^﻿/, ""),
    );
    expect(parseNadlanEntityCoordinates(raw)).toEqual({ x: 185657.03695409032, y: 690599.2005000003 });
  });

  it("extracts x/y when present alongside other fields", () => {
    expect(parseNadlanEntityCoordinates(page({ x: 100, y: 200 } as any))).toEqual({ x: 100, y: 200 });
  });

  it("maps a missing or non-numeric x/y to null rather than throwing (coordinates are a display fallback, not an identity field)", () => {
    expect(parseNadlanEntityCoordinates({})).toEqual({ x: null, y: null });
    expect(parseNadlanEntityCoordinates({ x: "185657", y: null })).toEqual({ x: null, y: null });
  });

  it("throws EMPTY_PAGE on a non-object response (unlike x/y absence, a wholly invalid body is still fatal)", () => {
    expect(() => parseNadlanEntityCoordinates(null)).toThrow(/EMPTY_PAGE/);
    expect(() => parseNadlanEntityCoordinates("not json")).toThrow(/EMPTY_PAGE/);
  });

  it("getNadlanEntityCoordinates fetches the requested entity's OWN page, not a bootstrap entity's", async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => ({ x: 42, y: 43 }) } as unknown as Response;
    }) as typeof fetch;
    const coords = await getNadlanEntityCoordinates("65210248", fakeFetch);
    expect(coords).toEqual({ x: 42, y: 43 });
    expect(calls).toEqual(["https://data.nadlan.gov.il/api/pages/neighborhood/buy/65210248.json"]);
  });

  it("propagates a clear error on a non-OK HTTP response", async () => {
    const fakeFetch = (async () => ({ ok: false, status: 404 }) as unknown as Response) as typeof fetch;
    await expect(getNadlanEntityCoordinates("65210195", fakeFetch)).rejects.toThrow(/FETCH_FAILED/);
  });
});

describe("TEST K — official street catalog parsing (Wave 0G-18 Phase 3)", () => {
  function streetPage(streets: unknown = [
    { id: 74000847, title: "דגניה" },
    { id: 74001224, title: "טבת" },
    { id: 74001205, title: "הר שגיא" },
  ]) {
    return { ...page(), otherNeighborhoodStreets: streets };
  }

  it("returns one NadlanStreet per otherNeighborhoodStreets entry, identity is streetId not name", () => {
    const streets = parseNadlanStreetCatalog(streetPage());
    expect(streets.length).toBe(3);
    expect(streets.map((s) => s.streetId).sort()).toEqual(["74000847", "74001205", "74001224"].sort());
    expect(streets.find((s) => s.streetId === "74000847")?.name).toBe("דגניה");
  });

  it("throws (does not silently return []) when otherNeighborhoodStreets is missing", () => {
    expect(() => parseNadlanStreetCatalog(page())).toThrow(/EMPTY_STREET_CATALOG/);
  });

  it("throws when otherNeighborhoodStreets is an empty array", () => {
    expect(() => parseNadlanStreetCatalog(streetPage([]))).toThrow(/EMPTY_STREET_CATALOG/);
  });

  it("throws when raw is not an object", () => {
    expect(() => parseNadlanStreetCatalog(null)).toThrow(/EMPTY_STREET_CATALOG/);
  });

  it("throws on a structurally invalid entry (missing id or blank title)", () => {
    expect(() => parseNadlanStreetCatalog(streetPage([{ title: "X" }]))).toThrow(/INVALID_STREET_ENTRY/);
    expect(() => parseNadlanStreetCatalog(streetPage([{ id: 1 }]))).toThrow(/INVALID_STREET_ENTRY/);
    expect(() => parseNadlanStreetCatalog(streetPage([{ id: 1, title: "  " }]))).toThrow(/INVALID_STREET_ENTRY/);
  });

  it("throws on a duplicate streetId within the same response — never silently collapsed", () => {
    expect(() =>
      parseNadlanStreetCatalog(streetPage([{ id: 1, title: "A" }, { id: 1, title: "B" }])),
    ).toThrow(/DUPLICATE_STREET_ID/);
  });

  it("does NOT collapse two streets sharing an identical name string but different ids", () => {
    const streets = parseNadlanStreetCatalog(streetPage([
      { id: 1, title: "הרצל" },
      { id: 2, title: "הרצל" },
    ]));
    expect(streets.length).toBe(2);
    expect(streets.map((s) => s.streetId).sort()).toEqual(["1", "2"]);
  });

  it("accepts a catalog larger than the currently-observed 70 for this entity (no hardcoded count)", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, title: `רחוב ${i + 1}` }));
    expect(parseNadlanStreetCatalog(streetPage(many)).length).toBe(100);
    const src = readFileSync(path.join(__dirname, "..", "nadlanCatalog.ts"), "utf8");
    expect(src).not.toMatch(/===\s*70|length\s*===\s*70|!==\s*70/);
  });

  it("getOfficialEntityStreets fetches the requested entity's OWN page, not a bootstrap entity's", async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => streetPage() } as unknown as Response;
    }) as typeof fetch;
    const streets = await getOfficialEntityStreets("65209683", fakeFetch);
    expect(streets.length).toBe(3);
    expect(calls).toEqual(["https://data.nadlan.gov.il/api/pages/neighborhood/buy/65209683.json"]);
  });

  it("propagates a clear error on a non-OK HTTP response, without silently returning an empty street list", async () => {
    const fakeFetch = (async () => ({ ok: false, status: 500 }) as unknown as Response) as typeof fetch;
    await expect(getOfficialEntityStreets("65209683", fakeFetch)).rejects.toThrow(/FETCH_FAILED/);
  });
});

describe("inferEntityCategoryHint — diagnostic-only, non-authoritative", () => {
  it("flags industrial zones by name pattern", () => {
    expect(inferEntityCategoryHint("אזור תעשיה קריית אל")).toBe("industrial");
  });
  it("flags in-planning zones by name pattern", () => {
    expect(inferEntityCategoryHint("אגם 3 - בתכנון")).toBe("planning");
  });
  it("flags the CBD designation by name pattern", () => {
    expect(inferEntityCategoryHint('מע"ר - מרכז עירוני ר')).toBe("cbd");
  });
  it("defaults ordinary residential names to 'residential'", () => {
    expect(inferEntityCategoryHint("נוף הטיילת")).toBe("residential");
    expect(inferEntityCategoryHint("רסקו")).toBe("residential");
  });
});

describe("TEST E/F — shadow harvest script cannot write canonical data or Supabase", () => {
  const shadowSrc = readFileSync(
    path.join(__dirname, "..", "..", "scripts", "audit-wave0g7-shadow-harvest.ts"),
    "utf8",
  );

  it("TEST E: contains no executable reference to data/deals.json (comment mentions are fine)", () => {
    const executableLines = shadowSrc
      .split("\n")
      .filter((l) => l.includes("deals.json"))
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
    expect(executableLines).toEqual([]);
  });

  it("TEST F: contains no Supabase client import or upsert call (a reassuring log line mentioning the word 'Supabase' is fine — this checks actual usage, not the word)", () => {
    expect(shadowSrc).not.toMatch(/from\s+["']@supabase\/supabase-js["']/);
    expect(shadowSrc).not.toMatch(/createClient\s*\(/);
    expect(shadowSrc).not.toMatch(/\.from\([^)]*\)\.upsert\(/);
  });

  it("the id-mismatch check requires EVERY row to match, not just some (guards against a mixed-batch silently passing as clean)", () => {
    // A prior version used `.includes(sourceId)`, which would treat a batch of
    // 5 correct rows buried among 495 contaminated ones as a full match.
    // Wave 0G-8 extracted this logic into the shared, unit-tested
    // lib/nadlanAcquisition.ts helper (assertDirectIdAcquisitionIdentity) —
    // see lib/__tests__/nadlanAcquisition.test.ts's Phase 11 TEST C for the
    // direct behavioral proof; this check confirms the script actually CALLS
    // that shared helper rather than reintroducing an inline `.includes()` check.
    expect(shadowSrc).not.toMatch(/distinctUpstreamIds\.includes\(sourceId\)/);
    expect(shadowSrc).toMatch(/assertDirectIdAcquisitionIdentity\(/);
    const acquisitionSrc = readFileSync(path.join(__dirname, "..", "nadlanAcquisition.ts"), "utf8");
    expect(acquisitionSrc).toMatch(/matchingCount\s*!==\s*items\.length/);
    // Stronger than "the helper is called somewhere": confirm the script's
    // own `requestValid` flag is actually WIRED to `identity.valid`, not
    // just that assertDirectIdAcquisitionIdentity() is invoked for logging
    // while requestValid is computed some other, unverified way.
    expect(shadowSrc).toMatch(/requestValid\s*=\s*!last405\s*&&\s*!navigationError\s*&&\s*identity\.valid/);
  });

  it("all fs.writeFile calls target only the wave0g7 output directory", () => {
    const writeFileCalls = [...shadowSrc.matchAll(/fs\.writeFile\(([^)]*)\)/g)].map((m) => m[1]);
    expect(writeFileCalls.length).toBeGreaterThan(0);
    for (const call of writeFileCalls) {
      expect(call).toMatch(/OUT_DIR/);
    }
  });
});

describe("TEST I — production harvest now uses the official catalog as its primary discovery source, layered over the original fallback (Wave 0G-11)", () => {
  it("scripts/harvest.ts imports the layered discovery module, which itself uses the official nadlan catalog", () => {
    const harvestSrc = readFileSync(path.join(__dirname, "..", "..", "scripts", "harvest.ts"), "utf8");
    expect(harvestSrc).toMatch(/from\s+["']\.\.\/lib\/neighborhoodDiscovery["']/);
    expect(harvestSrc).toMatch(/discoverNeighborhoodsImpl\(/);
    const discoverySrc = readFileSync(path.join(__dirname, "..", "neighborhoodDiscovery.ts"), "utf8");
    expect(discoverySrc).toMatch(/from\s+["']\.\/nadlanCatalog["']/);
    expect(discoverySrc).toMatch(/getOfficialNetanyaEntities\(/);
  });

  it("the original GovMap name-search is kept as a fallback source, not fully replaced (Wave 0G-6 did not prove the official catalog is exhaustive for every special-category entity)", () => {
    const discoverySrc = readFileSync(path.join(__dirname, "..", "neighborhoodDiscovery.ts"), "utf8");
    expect(discoverySrc).toMatch(/es\.govmap\.gov\.il/);
    expect(discoverySrc).toMatch(/SEED_NAMES/);
  });

  it("neighborhoodDiscovery.ts does not itself write canonical data or Supabase — it only returns discovered entities for the caller to use", () => {
    const discoverySrc = readFileSync(path.join(__dirname, "..", "neighborhoodDiscovery.ts"), "utf8");
    expect(discoverySrc).not.toMatch(/from\s+["']@supabase\/supabase-js["']/);
    expect(discoverySrc).not.toMatch(/createClient\s*\(/);
    expect(discoverySrc).not.toMatch(/deals\.json/);
  });

  it("lib/nadlanCatalog.ts is not imported directly by any OTHER production application file — the layered discovery logic stays centralized in lib/neighborhoodDiscovery.ts, not scattered", () => {
    // A lightweight, dependency-free repo scan (pure fs, no shell/grep): any
    // .ts/.tsx file outside __tests__ under lib/app/components that IMPORTS
    // nadlanCatalog (an `import ... from ".../nadlanCatalog"` statement, not
    // merely a comment mentioning its name — lib/nadlanAcquisition.ts's own
    // header comment legitimately explains its relationship to nadlanCatalog.ts
    // without importing it) other than the one sanctioned caller
    // (lib/neighborhoodDiscovery.ts) would indicate the module got wired into
    // more than one place, diverging from the single discovery layer design.
    const fs = require("fs") as typeof import("fs");
    const repoRoot = path.join(__dirname, "..", "..");
    const dirsToScan = ["lib", "app", "components"];
    const offenders: string[] = [];
    const importPattern = /(?:from\s+["'][^"']*nadlanCatalog["']|require\(["'][^"']*nadlanCatalog["']\))/;
    const allowedImporters = new Set([
      path.join(repoRoot, "lib", "nadlanCatalog.ts"),
      path.join(repoRoot, "lib", "neighborhoodDiscovery.ts"),
    ]);

    function walk(dir: string) {
      let entries: import("fs").Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__" || entry.name === "node_modules") continue;
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !allowedImporters.has(full)) {
          const content = fs.readFileSync(full, "utf8");
          if (importPattern.test(content)) offenders.push(path.relative(repoRoot, full));
        }
      }
    }

    for (const d of dirsToScan) walk(path.join(repoRoot, d));
    expect(offenders).toEqual([]);
  });
});
