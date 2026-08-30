/**
 * scripts/__tests__/buildV2LaunchCandidate.test.ts — Wednesday Launch
 * Sprint L0, focused tests for build-v2-launch-candidate.ts's pure,
 * reusable schema-conversion helper (toPureDeal). The script's I/O
 * (reconstructing the 59,305-row union from Wave 0G artifacts, writing
 * data/v2-candidate/*) was validated live — see
 * audit/launch/L0_V2_LAUNCH_CANDIDATE.md — this file covers only the
 * pure function, importable without triggering the live build (guarded
 * by the same isDirectExecution pattern every audit script in this repo
 * uses).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { toPureDeal, DEAL_FIELDS } from "../build-v2-launch-candidate";
import type { ShadowDeal } from "../../lib/shadowRebuild";

describe("REGRESSION — importing this module for its pure function must never run the live build", () => {
  it("main() is guarded by the isDirectExecution check", () => {
    const src = readFileSync(path.join(__dirname, "..", "build-v2-launch-candidate.ts"), "utf8");
    expect(src).toMatch(/const isDirectExecution = typeof process\.argv\[1\] === "string" && import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href;/);
    expect(src).toMatch(/if \(isDirectExecution\) \{\s*main\(\)/);
  });
});

function shadowRow(overrides: Partial<ShadowDeal> = {}): ShadowDeal {
  return {
    id: "65209683-2024-01-01-1000000-80", dealDate: "2024-01-01", price: 1000000, propertyType: "apartment",
    rooms: 3, areaSqm: 80, plotSqm: null, floor: 2, yearBuilt: 2000, dealNature: "דירה בבית קומות",
    address: "רחוב 1", street: "רחוב", houseNumber: "1", neighborhoodId: "65209683", neighborhood: "קריית השרון",
    settlement: "נתניה", x: null, y: null, pricePerSqm: 12500,
    sourceId: "65209683", parcelNum: "1234-56-7", rawDealNature: "דירה בבית קומות",
    ...overrides,
  };
}

describe("toPureDeal", () => {
  it("produces EXACTLY the 18 production Deal keys — no more, no less", () => {
    const pure = toPureDeal(shadowRow());
    expect(Object.keys(pure).sort()).toEqual([...DEAL_FIELDS].sort());
  });

  it("strips all 3 ShadowDeal-only fields (sourceId, parcelNum, rawDealNature)", () => {
    const pure: any = toPureDeal(shadowRow());
    expect(pure.sourceId).toBeUndefined();
    expect(pure.parcelNum).toBeUndefined();
    expect(pure.rawDealNature).toBeUndefined();
  });

  it("preserves every base Deal field's value unchanged", () => {
    const shadow = shadowRow({ price: 2500000, rooms: 4, floor: null, street: "אחר" });
    const pure = toPureDeal(shadow);
    expect(pure.price).toBe(2500000);
    expect(pure.rooms).toBe(4);
    expect(pure.floor).toBeNull();
    expect(pure.street).toBe("אחר");
    expect(pure.neighborhoodId).toBe("65209683");
  });

  it("does not mutate the input ShadowDeal", () => {
    const shadow = shadowRow();
    const before = JSON.stringify(shadow);
    toPureDeal(shadow);
    expect(JSON.stringify(shadow)).toBe(before);
  });
});
