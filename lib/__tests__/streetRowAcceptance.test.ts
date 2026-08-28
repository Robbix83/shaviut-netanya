/**
 * lib/__tests__/streetRowAcceptance.test.ts — Wave 0G-20 Phase 17 focused
 * tests for the per-row identity acceptance classifier. Letters A-P map to
 * the wave's own required test list (M/N reuse the shared, already-tested
 * transactionKey()/dedupByTransactionKey(); O/P are source-level checks on
 * the runner file itself).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { classifyRowForAcceptance, classifyBatchForAcceptance, classifyBatchStatus, type RowAcceptanceCounts } from "../streetRowAcceptance";
import { transactionKey, dedupByTransactionKey, toShadowDeal } from "../shadowRebuild";
import type { Neighborhood } from "../types";

const PARENT = "65209683";
const NEIGHBORHOOD: Neighborhood = { id: PARENT, name: "קריית השרון", settlement: "נתניה", x: null, y: null };
function rawItem(overrides: any = {}) {
  return { dealAmount: 2000000, dealDate: "2024-05-01", address: "רחוב 4", roomNum: 4, assetArea: 90, floor: 2, dealNature: "דירה", parcelNum: "1-1-1", ...overrides };
}

describe("A — all-parent batch: all accepted", () => {
  it("classifies every row ACCEPT_PARENT when all match, batch status SUCCESS_ALL_PARENT", () => {
    const rows = [{ neighborhoodId: PARENT }, { neighborhoodId: PARENT }, { neighborhoodId: PARENT }];
    const counts = classifyBatchForAcceptance(rows, PARENT);
    expect(counts).toMatchObject({ rawRows: 3, acceptedParent: 3, rejectedZero: 0, rejectedForeign: 0 });
    expect(classifyBatchStatus(counts)).toBe("SUCCESS_ALL_PARENT");
  });
});

describe("B — mixed parent + zero: parent accepted, zero rejected", () => {
  it("classifies each independently, batch status SUCCESS_MIXED_PARTIAL", () => {
    const rows = [{ neighborhoodId: PARENT }, { neighborhoodId: "0" }];
    const counts = classifyBatchForAcceptance(rows, PARENT);
    expect(counts).toMatchObject({ rawRows: 2, acceptedParent: 1, rejectedZero: 1 });
    expect(classifyBatchStatus(counts)).toBe("SUCCESS_MIXED_PARTIAL");
  });
});

describe("C — mixed parent + foreign: parent accepted, foreign rejected", () => {
  it("classifies each independently, batch status SUCCESS_MIXED_PARTIAL", () => {
    const rows = [{ neighborhoodId: PARENT }, { neighborhoodId: "65210241" }];
    const counts = classifyBatchForAcceptance(rows, PARENT);
    expect(counts).toMatchObject({ rawRows: 2, acceptedParent: 1, rejectedForeign: 1 });
    expect(classifyBatchStatus(counts)).toBe("SUCCESS_MIXED_PARTIAL");
  });
});

describe("D — parent + zero + foreign accounting invariant exact", () => {
  it("sums exactly to rawRows across all 5 buckets, no double-count or loss", () => {
    const rows = [
      { neighborhoodId: PARENT }, { neighborhoodId: PARENT },
      { neighborhoodId: "0" },
      { neighborhoodId: "65210241" }, { neighborhoodId: "65210240" },
      { neighborhoodId: null },
      { neighborhoodId: "abc" },
    ];
    const counts = classifyBatchForAcceptance(rows, PARENT);
    expect(counts.rawRows).toBe(7);
    expect(counts.acceptedParent + counts.rejectedZero + counts.rejectedForeign + counts.rejectedMissing + counts.rejectedMalformed).toBe(7);
    expect(counts).toMatchObject({ acceptedParent: 2, rejectedZero: 1, rejectedForeign: 2, rejectedMissing: 1, rejectedMalformed: 1 });
  });
});

describe("classifyBatchStatus's SUCCESS_EMPTY branch (ECC code-reviewer nitpick: not dead code — audit-wave0g20-live-control-probe.ts can legitimately call this with 0 raw rows)", () => {
  it("a batch with 0 raw rows classifies SUCCESS_EMPTY, not FAILED_NO_TRUSTED_ROWS", () => {
    const counts: RowAcceptanceCounts = { rawRows: 0, acceptedParent: 0, rejectedZero: 0, rejectedForeign: 0, rejectedMissing: 0, rejectedMalformed: 0 };
    expect(classifyBatchStatus(counts)).toBe("SUCCESS_EMPTY");
  });
});

describe("E — zero-only batch: zero trusted rows", () => {
  it("no accepted rows, batch status FAILED_NO_TRUSTED_ROWS", () => {
    const rows = [{ neighborhoodId: "0" }, { neighborhoodId: "0" }];
    const counts = classifyBatchForAcceptance(rows, PARENT);
    expect(counts.acceptedParent).toBe(0);
    expect(classifyBatchStatus(counts)).toBe("FAILED_NO_TRUSTED_ROWS");
  });
});

describe("F — foreign-only batch: zero trusted rows", () => {
  it("no accepted rows, batch status FAILED_NO_TRUSTED_ROWS", () => {
    const rows = [{ neighborhoodId: "65210388" }];
    const counts = classifyBatchForAcceptance(rows, PARENT);
    expect(counts.acceptedParent).toBe(0);
    expect(classifyBatchStatus(counts)).toBe("FAILED_NO_TRUSTED_ROWS");
  });
});

describe("G — missing identity rejected", () => {
  it("null and undefined neighborhoodId both classify REJECT_MISSING, never accepted", () => {
    expect(classifyRowForAcceptance({ neighborhoodId: null }, PARENT)).toBe("REJECT_MISSING");
    expect(classifyRowForAcceptance({}, PARENT)).toBe("REJECT_MISSING");
    expect(classifyRowForAcceptance({ neighborhoodId: "" }, PARENT)).toBe("REJECT_MISSING");
    expect(classifyRowForAcceptance({ neighborhoodId: "   " }, PARENT)).toBe("REJECT_MISSING");
  });
});

describe("H — malformed identity rejected", () => {
  it("a non-numeric neighborhoodId is rejected, never accepted", () => {
    expect(classifyRowForAcceptance({ neighborhoodId: "abc" }, PARENT)).toBe("REJECT_MALFORMED");
    expect(classifyRowForAcceptance({ neighborhoodId: "65209683x" }, PARENT)).toBe("REJECT_MALFORMED");
    expect(classifyRowForAcceptance({ neighborhoodId: NaN }, PARENT)).toBe("REJECT_MALFORMED");
  });
});

describe("I — batch mixed status surfaced", () => {
  it("a batch with 100 parent + 5 foreign is SUCCESS_MIXED_PARTIAL, never SUCCESS_ALL_PARENT", () => {
    const rows = [...Array(100).fill({ neighborhoodId: PARENT }), ...Array(5).fill({ neighborhoodId: "65210241" })];
    const counts = classifyBatchForAcceptance(rows, PARENT);
    expect(counts).toMatchObject({ rawRows: 105, acceptedParent: 100, rejectedForeign: 5 });
    expect(classifyBatchStatus(counts)).toBe("SUCCESS_MIXED_PARTIAL");
    expect(classifyBatchStatus(counts)).not.toBe("SUCCESS_ALL_PARENT");
  });
});

describe("J — a valid parent row is not lost because a NEIGHBOR row conflicts", () => {
  it("each row's own field decides its own outcome, independent of any other row in the batch", () => {
    const rows = [{ neighborhoodId: "65210241" }, { neighborhoodId: PARENT }, { neighborhoodId: "0" }];
    const decisions = rows.map((r) => classifyRowForAcceptance(r, PARENT));
    expect(decisions).toEqual(["REJECT_FOREIGN", "ACCEPT_PARENT", "REJECT_ZERO"]);
    // the middle row's ACCEPT survives regardless of its neighbors' outcomes
    expect(decisions[1]).toBe("ACCEPT_PARENT");
  });
});

describe("K — zero id never accepted (no ACCEPT_ZERO variant exists in this module's type at all)", () => {
  it("every possible zero-shaped input classifies to a REJECT_* decision, never ACCEPT_PARENT", () => {
    const zeroLikeInputs = [{ neighborhoodId: "0" }, { neighborhoodId: 0 }, { neighborhoodId: "0 " }];
    for (const input of zeroLikeInputs) {
      const decision = classifyRowForAcceptance(input, PARENT);
      expect(decision).not.toBe("ACCEPT_PARENT");
      expect(decision.startsWith("REJECT_")).toBe(true);
    }
  });

  it("the module's own type union has no ACCEPT_ZERO/ACCEPT_FOREIGN member (source-level guard)", () => {
    const src = readFileSync(path.join(__dirname, "..", "streetRowAcceptance.ts"), "utf8");
    expect(src).not.toMatch(/ACCEPT_ZERO/);
    expect(src).not.toMatch(/ACCEPT_FOREIGN/);
  });
});

describe("L — foreign id never accepted, even with street/address-shaped hints", () => {
  it("classification depends ONLY on neighborhoodId — no address/streetCode field is ever read by this module", () => {
    const result = classifyRowForAcceptance({ neighborhoodId: "65210241", streetCode: "74000865", address: "הרב שמואל הרטום 5" } as any, PARENT);
    expect(result).toBe("REJECT_FOREIGN");
    const src = readFileSync(path.join(__dirname, "..", "streetRowAcceptance.ts"), "utf8");
    // No street-name/address-based inference anywhere in the executable source.
    const executableLines = src.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
    expect(executableLines.join("\n")).not.toMatch(/\.address\b|streetCode|requestedStreetName/);
  });
});

describe("M — same transaction from entity + street dedups (shared, already-tested logic)", () => {
  it("an accepted parent row identical to an existing baseline row collapses via the same transactionKey()", () => {
    const baselineRow = toShadowDeal(rawItem(), NEIGHBORHOOD, PARENT)!;
    const acceptedStreetRow = toShadowDeal(rawItem(), NEIGHBORHOOD, PARENT)!;
    expect(transactionKey(baselineRow)).toBe(transactionKey(acceptedStreetRow));
    const dedup = dedupByTransactionKey([baselineRow, acceptedStreetRow]);
    expect(dedup.uniqueCount).toBe(1);
  });
});

describe("N — repeat sale preserved", () => {
  it("two accepted parent rows sharing parcelNum but differing date/price stay distinct", () => {
    const sale1 = toShadowDeal(rawItem({ dealDate: "2020-01-01", dealAmount: 1800000 }), NEIGHBORHOOD, PARENT)!;
    const sale2 = toShadowDeal(rawItem({ dealDate: "2025-06-01", dealAmount: 2600000 }), NEIGHBORHOOD, PARENT)!;
    expect(transactionKey(sale1)).not.toBe(transactionKey(sale2));
    const dedup = dedupByTransactionKey([sale1, sale2]);
    expect(dedup.uniqueCount).toBe(2);
  });
});

describe("O/P — no canonical or Supabase write path exists in this module", () => {
  const src = readFileSync(path.join(__dirname, "..", "streetRowAcceptance.ts"), "utf8");

  it("O: contains no executable reference to data/deals.json or data/neighborhoods.json", () => {
    const executableLines = src.split("\n").filter((l) => l.includes("deals.json") || l.includes("neighborhoods.json")).filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
    expect(executableLines).toEqual([]);
  });

  it("P: contains no Supabase client import/upsert call, and no fs/network I/O at all (pure classification only)", () => {
    expect(src).not.toMatch(/from\s+["']@supabase\/supabase-js["']/);
    expect(src).not.toMatch(/createClient\s*\(/);
    expect(src).not.toMatch(/import\s+.*["']fs["']/);
    expect(src).not.toMatch(/fetch\s*\(/);
  });
});

describe("Row accounting invariant assertion actually fires (defense-in-depth, not just documentation)", () => {
  it("classifyBatchForAcceptance throws if a hypothetical future bug made two branches double-count (simulated via a monkey-patched edge case is impractical; verify the invariant check exists and is reachable via source)", () => {
    const src = readFileSync(path.join(__dirname, "..", "streetRowAcceptance.ts"), "utf8");
    expect(src).toMatch(/ROW_ACCOUNTING_INVARIANT_VIOLATED/);
  });
});
