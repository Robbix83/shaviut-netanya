import { describe, it, expect } from "vitest";
import { normalizeStreetForAlias, groupStreetAliases, buildCanonicalStreetMap, type StreetIndexEntry } from "../streetAliasDedup";

/**
 * Wave 0F-1: dedup identity is normalized-name match AND proven physical-identity
 * match (exact code, or exact coordinates when a code is missing on either side).
 * neighborhoodId is deliberately never used as identity evidence.
 */

function entry(overrides: Partial<StreetIndexEntry>): StreetIndexEntry {
  return {
    street: "רחוב הבדיקה",
    code: null,
    neighborhoodId: "N1",
    neighborhoodName: "שכונת בדיקה",
    x: 100000,
    y: 100000,
    ...overrides,
  };
}

describe("normalizeStreetForAlias", () => {
  it("strips the same prefix set as lib/valuation.ts's normalizeStreet", () => {
    expect(normalizeStreetForAlias("שד ויצמן")).toBe("ויצמן");
    expect(normalizeStreetForAlias("ויצמן")).toBe("ויצמן");
    // Alternation order quirk shared with lib/valuation.ts's identical regex:
    // "שד'?" matches before "שדרות" gets a chance, so only the "שד" prefix is
    // stripped — intentionally preserved here for exact behavioral parity.
    expect(normalizeStreetForAlias("שדרות בן גוריון")).toBe("רות בן גוריון");
    expect(normalizeStreetForAlias("רח' הרצל")).toBe("הרצל");
  });
});

describe("groupStreetAliases — TEST A/B: Weizmann pair collapses to one canonical group", () => {
  const weizmann = entry({ street: "ויצמן", code: null, neighborhoodId: "66239254", neighborhoodName: "מרכז העיר צפון", x: 186965, y: 693532 });
  const sdWeizmann = entry({ street: "שד ויצמן", code: 417, neighborhoodId: "66239254", neighborhoodName: "צפון מזרח מרכז העיר", x: 186965, y: 693532 });

  it("groups both entries into exactly one group", () => {
    const groups = groupStreetAliases([sdWeizmann, weizmann]);
    expect(groups.length).toBe(1);
    expect(groups[0].members.length).toBe(2);
  });

  it("TEST F — the officially coded entry (שד ויצמן, code 417) wins as canonical", () => {
    const groups = groupStreetAliases([weizmann, sdWeizmann]); // uncoded first in input order
    expect(groups[0].canonical.street).toBe("שד ויצמן");
    expect(groups[0].canonical.code).toBe(417);
  });

  it("TEST C — the alias raw string remains searchable via the canonical map", () => {
    const map = buildCanonicalStreetMap([weizmann, sdWeizmann]);
    expect(map.get("ויצמן")?.street).toBe("שד ויצמן");
    expect(map.get("שד ויצמן")?.street).toBe("שד ויצמן");
  });
});

describe("groupStreetAliases — TEST D: distinct streets with similar normalized names are NOT collapsed", () => {
  it("same normalized name, different (non-matching) coordinates, no codes -> stays separate", () => {
    const a = entry({ street: "שדרות הראשונים", code: null, x: 100000, y: 100000 });
    const b = entry({ street: "הראשונים", code: null, x: 250000, y: 400000 }); // genuinely different street, coincidentally same normalized text
    const groups = groupStreetAliases([a, b]);
    expect(groups.length).toBe(2);
  });
});

describe("groupStreetAliases — TEST E: same neighborhoodId is not enough evidence", () => {
  it("two entries share neighborhoodId but differ in coordinates and have no code -> NOT deduplicated", () => {
    const a = entry({ street: "רחוב האלון", neighborhoodId: "N9", x: 111111, y: 222222 });
    const b = entry({ street: "האלון", neighborhoodId: "N9", x: 333333, y: 444444 });
    const groups = groupStreetAliases([a, b]);
    expect(groups.length).toBe(2);
  });

  it("neighborhoodId alone, even if identical, never substitutes for code/coordinate identity", () => {
    const a = entry({ street: "שד האלון", neighborhoodId: "SAME", code: null, x: null, y: null });
    const b = entry({ street: "האלון", neighborhoodId: "SAME", code: null, x: null, y: null });
    // no coordinates on either side, no codes -> insufficient evidence, must not merge
    const groups = groupStreetAliases([a, b]);
    expect(groups.length).toBe(2);
  });
});

describe("groupStreetAliases — entries with equal codes merge even without coordinates", () => {
  it("same code, both present -> same group, regardless of coordinates", () => {
    const a = entry({ street: "שד הנשיא ווייצמן", code: 900, x: 1, y: 1 });
    const b = entry({ street: "הנשיא ווייצמן", code: 900, x: 9, y: 9 });
    const groups = groupStreetAliases([a, b]);
    expect(groups.length).toBe(1);
  });

  it("different codes -> never merged, even with identical coordinates", () => {
    const a = entry({ street: "רחוב זהה", code: 1, x: 5, y: 5 });
    const b = entry({ street: "זהה", code: 2, x: 5, y: 5 });
    const groups = groupStreetAliases([a, b]);
    expect(groups.length).toBe(2);
  });
});

describe("no fuzzy matching", () => {
  it("near-identical but not exactly equal coordinates are NOT merged (no distance threshold)", () => {
    const a = entry({ street: "שד קרוב", code: null, x: 100000, y: 100000 });
    const b = entry({ street: "קרוב", code: null, x: 100000.0001, y: 100000 });
    const groups = groupStreetAliases([a, b]);
    expect(groups.length).toBe(2);
  });
});
