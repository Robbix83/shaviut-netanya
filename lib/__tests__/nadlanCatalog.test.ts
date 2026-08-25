import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  parseNadlanCatalog,
  getOfficialNetanyaEntities,
  buildNadlanNeighborhoodPageUrl,
  inferEntityCategoryHint,
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
    // 5 correct rows buried among 495 contaminated ones as a full match. The
    // fixed version must compare a per-row match count against the total.
    expect(shadowSrc).not.toMatch(/distinctUpstreamIds\.includes\(sourceId\)/);
    expect(shadowSrc).toMatch(/matchingRowCount\s*!==\s*normalized\.length/);
  });

  it("all fs.writeFile calls target only the wave0g7 output directory", () => {
    const writeFileCalls = [...shadowSrc.matchAll(/fs\.writeFile\(([^)]*)\)/g)].map((m) => m[1]);
    expect(writeFileCalls.length).toBeGreaterThan(0);
    for (const call of writeFileCalls) {
      expect(call).toMatch(/OUT_DIR/);
    }
  });
});

describe("TEST I — production harvest path is untouched by this wave's additive discovery module", () => {
  it("scripts/harvest.ts does not import the new nadlanCatalog module (additive, not wired in, this wave)", () => {
    const harvestSrc = readFileSync(path.join(__dirname, "..", "..", "scripts", "harvest.ts"), "utf8");
    expect(harvestSrc).not.toMatch(/nadlanCatalog/);
  });

  it("lib/nadlanCatalog.ts is not imported by any production (non-test, non-audit) application file", () => {
    // A lightweight, dependency-free repo scan (pure fs, no shell/grep): any
    // .ts/.tsx file outside __tests__ under lib/app/components that imports
    // nadlanCatalog would indicate this wave's additive module got silently
    // wired into the live app/harvest path.
    const fs = require("fs") as typeof import("fs");
    const repoRoot = path.join(__dirname, "..", "..");
    const dirsToScan = ["lib", "app", "components"];
    const offenders: string[] = [];

    function walk(dir: string) {
      let entries: import("fs").Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__" || entry.name === "node_modules") continue;
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name) && full !== path.join(repoRoot, "lib", "nadlanCatalog.ts")) {
          const content = fs.readFileSync(full, "utf8");
          if (/nadlanCatalog/.test(content)) offenders.push(path.relative(repoRoot, full));
        }
      }
    }

    for (const d of dirsToScan) walk(path.join(repoRoot, d));
    expect(offenders).toEqual([]);
  });
});
