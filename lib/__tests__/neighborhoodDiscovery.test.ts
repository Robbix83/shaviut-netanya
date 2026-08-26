import { describe, it, expect, vi } from "vitest";
import { discoverNeighborhoods } from "../neighborhoodDiscovery";

/**
 * Wave 0G-11: discoverNeighborhoods() now layers the official nadlan.gov.il
 * catalog (primary) over the original GovMap name-search (fallback) over
 * data/neighborhoods.json (last-resort merge). TEST A is the central
 * regression proof — entity 65210195 ("נוף הטיילת") must survive even
 * though a GovMap name-search for "נוף הטיילת" would return a DIFFERENT id
 * (66239231), reproducing the exact defect class the old
 * discoverNeighborhoods() had (audit/wave0g4).
 */

function catalogPage(overrides: Partial<{ x: unknown; y: unknown; otherNeighborhoods: unknown }> = {}) {
  return {
    neighborhoodId: 65210195,
    neighborhoodName: "נוף הטיילת",
    settlementID: 7400,
    settlementName: "נתניה",
    x: 185657.03,
    y: 690599.2,
    otherNeighborhoods: [
      { title: "נוף הטיילת", id: 65210195 },
      { title: "רסקו", id: 65210248 },
    ],
    ...overrides,
  };
}

/** Builds a fake fetch that serves the official catalog + per-entity coordinate
 * pages from nadlan, and a configurable GovMap name-search response. */
function makeFakeFetch(opts: {
  entityPages?: Record<string, unknown>;
  govmapHits?: Record<string, { ObjectID: number; X?: number; Y?: number } | null>;
} = {}) {
  const entityPages = opts.entityPages ?? {};
  const govmapHits = opts.govmapHits ?? {};
  const calls: string[] = [];
  const fakeFetch = (async (url: string) => {
    calls.push(url);
    if (url.includes("data.nadlan.gov.il")) {
      const id = url.match(/buy\/(\d+)\.json/)?.[1];
      const page = id && entityPages[id] ? entityPages[id] : catalogPage();
      return { ok: true, json: async () => page } as unknown as Response;
    }
    if (url.includes("es.govmap.gov.il")) {
      const nameMatch = decodeURIComponent(url).match(/query=([^&]+)/);
      const queried = nameMatch ? nameMatch[1].replace(/\s*נתניה$/, "") : "";
      const hit = govmapHits[queried];
      return {
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ data: { NEIGHBORHOOD: hit ? [hit] : [] } }),
      } as unknown as Response;
    }
    return { ok: false, status: 404 } as unknown as Response;
  }) as typeof fetch;
  return { fakeFetch, calls };
}

describe("TEST A — official-catalog entity survives even when GovMap name-search would return a different id (the core Wave 0G-4 regression)", () => {
  it("includes sourceId 65210195 even though the GovMap fallback for the same name resolves to a different id", async () => {
    const { fakeFetch } = makeFakeFetch({
      govmapHits: { "נוף הטיילת": { ObjectID: 66239231, X: 1, Y: 2 } }, // the OLD, wrong id for the same name
    });
    const result = await discoverNeighborhoods({
      fetchImpl: fakeFetch,
      catalogPoliteDelayMs: 0,
      seedPoliteDelayMs: 0,
      seedNames: ["נוף הטיילת"],
    });
    const ids = result.map((n) => n.id);
    expect(ids).toContain("65210195"); // from the official catalog
    // The GovMap-resolved 66239231 is a DIFFERENT id and must ALSO survive —
    // this module never drops a name-search hit just because the official
    // catalog already covered that display name under a different id.
    expect(ids).toContain("66239231");
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
  });
});

describe("TEST B — official catalog is the primary source and attaches coordinates per-entity", () => {
  it("fetches each entity's OWN coordinate page (not the bootstrap entity's) and attaches x/y", async () => {
    const { fakeFetch, calls } = makeFakeFetch({
      entityPages: {
        "65210195": catalogPage({ x: 100, y: 200 }),
        "65210248": catalogPage({ x: 300, y: 400 }),
      },
    });
    const result = await discoverNeighborhoods({
      fetchImpl: fakeFetch, catalogPoliteDelayMs: 0, seedPoliteDelayMs: 0, seedNames: [],
    });
    const a = result.find((n) => n.id === "65210195");
    const b = result.find((n) => n.id === "65210248");
    expect(a).toMatchObject({ x: 100, y: 200 });
    expect(b).toMatchObject({ x: 300, y: 400 });
    // one catalog fetch (bootstrap) + one coordinate fetch per entity
    expect(calls.filter((u) => u.includes("data.nadlan.gov.il")).length).toBe(3);
  });

  it("still includes the entity (with null coordinates) if its per-entity coordinate fetch fails", async () => {
    const fakeFetch = (async (url: string) => {
      if (url.includes("buy/65210248")) return { ok: false, status: 500 } as unknown as Response;
      if (url.includes("data.nadlan.gov.il")) return { ok: true, json: async () => catalogPage() } as unknown as Response;
      return { ok: true, headers: { get: () => "application/json" }, json: async () => ({ data: { NEIGHBORHOOD: [] } }) } as unknown as Response;
    }) as typeof fetch;
    const result = await discoverNeighborhoods({
      fetchImpl: fakeFetch, catalogPoliteDelayMs: 0, seedPoliteDelayMs: 0, seedNames: [],
    });
    const rasko = result.find((n) => n.id === "65210248");
    expect(rasko).toBeDefined();
    expect(rasko!.x).toBeNull();
    expect(rasko!.y).toBeNull();
  });
});

describe("TEST C — official catalog failure degrades to GovMap fallback, not a thrown error", () => {
  it("returns GovMap-sourced entities when the official catalog fetch fails entirely", async () => {
    const fakeFetch = (async (url: string) => {
      if (url.includes("data.nadlan.gov.il")) return { ok: false, status: 500 } as unknown as Response;
      if (url.includes("es.govmap.gov.il")) {
        return {
          ok: true, headers: { get: () => "application/json" },
          json: async () => ({ data: { NEIGHBORHOOD: [{ ObjectID: 999, X: 1, Y: 2 }] } }),
        } as unknown as Response;
      }
      return { ok: false, status: 404 } as unknown as Response;
    }) as typeof fetch;
    const result = await discoverNeighborhoods({
      fetchImpl: fakeFetch, catalogPoliteDelayMs: 0, seedPoliteDelayMs: 0, seedNames: ["אגמים"],
    });
    expect(result.map((n) => n.id)).toEqual(["999"]);
  });
});

describe("TEST D — last-resort merge preserves existing neighborhoods.json ids not rediscovered elsewhere", () => {
  it("keeps an existing entity whose id neither the catalog nor GovMap surfaced", async () => {
    const fakeFetch = (async () => ({ ok: false, status: 500 }) as unknown as Response) as typeof fetch;
    const result = await discoverNeighborhoods({
      fetchImpl: fakeFetch,
      catalogPoliteDelayMs: 0, seedPoliteDelayMs: 0, seedNames: [],
      existingNeighborhoods: [{ id: "12345", name: "ישות ישנה", settlement: "נתניה", x: 1, y: 2 }],
    });
    expect(result).toEqual([{ id: "12345", name: "ישות ישנה", settlement: "נתניה", x: 1, y: 2 }]);
  });

  it("does not let the last-resort merge overwrite an id already found by the catalog", async () => {
    const { fakeFetch } = makeFakeFetch();
    const result = await discoverNeighborhoods({
      fetchImpl: fakeFetch, catalogPoliteDelayMs: 0, seedPoliteDelayMs: 0, seedNames: [],
      existingNeighborhoods: [{ id: "65210195", name: "שם ישן שגוי", settlement: "נתניה", x: -1, y: -1 }],
    });
    const entity = result.find((n) => n.id === "65210195");
    expect(entity!.name).toBe("נוף הטיילת"); // from the catalog, not the stale existing entry
  });
});

describe("TEST E — no network calls target Supabase or canonical data from within discovery", () => {
  it("the module source never imports Supabase or references data/deals.json", () => {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const src = fs.readFileSync(path.join(__dirname, "..", "neighborhoodDiscovery.ts"), "utf8");
    expect(src).not.toMatch(/supabase/i);
    expect(src).not.toMatch(/deals\.json/);
  });
});
