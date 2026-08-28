/**
 * lib/__tests__/streetIdentityPolicy.test.ts — Wave 0G-19 Phase 17 focused
 * tests for the zero-neighborhoodId acceptance policy (classifyRowIdentity).
 * Letters A-M map to the wave's own required test list.
 */
import { describe, it, expect } from "vitest";
import { classifyRowIdentity, summarizeRowIdentityDecisions } from "../streetIdentityPolicy";
import { transactionKey, dedupByTransactionKey, toShadowDeal } from "../shadowRebuild";
import type { Neighborhood } from "../types";

const PARENT = "65209683";
const STREET_ID = "74001232";
const STREET_NAME = "בני רייך";

describe("A — matching parent id accepted", () => {
  it("accepts a row whose neighborhoodId matches the requested parent entity", () => {
    const result = classifyRowIdentity({ neighborhoodId: PARENT, streetCode: STREET_ID, address: `${STREET_NAME} 4` }, PARENT, STREET_ID, STREET_NAME);
    expect(result.decision).toBe("ACCEPT_PARENT_MATCH");
  });
});

describe("B — zero id with proven street evidence accepted", () => {
  it("accepts neighborhoodId=0 when BOTH streetCode and address text match the request (the real Wave 0G-19 pattern, 20/20 observed)", () => {
    const result = classifyRowIdentity({ neighborhoodId: 0, streetCode: 74001232, address: "בני רייך 4" }, PARENT, STREET_ID, STREET_NAME);
    expect(result.decision).toBe("ACCEPT_ZERO_ID_EVIDENCE");
  });

  it("real captured example (טום לנטוס) also accepts", () => {
    const result = classifyRowIdentity({ neighborhoodId: 0, streetCode: 74001260, address: "טום לנטוס 71" }, PARENT, "74001260", "טום לנטוס");
    expect(result.decision).toBe("ACCEPT_ZERO_ID_EVIDENCE");
  });
});

describe("C — zero id lacking required evidence rejected", () => {
  it("rejects neighborhoodId=0 when streetCode is missing entirely", () => {
    const result = classifyRowIdentity({ neighborhoodId: "0", address: `${STREET_NAME} 4` }, PARENT, STREET_ID, STREET_NAME);
    expect(result.decision).toBe("REJECT_ZERO_ID_INSUFFICIENT_EVIDENCE");
  });

  it("rejects neighborhoodId=0 when address is missing entirely", () => {
    const result = classifyRowIdentity({ neighborhoodId: "0", streetCode: STREET_ID }, PARENT, STREET_ID, STREET_NAME);
    expect(result.decision).toBe("REJECT_ZERO_ID_INSUFFICIENT_EVIDENCE");
  });
});

describe("D — foreign non-zero id rejected even when street name matches", () => {
  it("rejects a different official entity id regardless of matching address text or streetCode — CLASS C stays closed per Wave 0G-19 Phase 9", () => {
    const result = classifyRowIdentity({ neighborhoodId: "65210241", streetCode: STREET_ID, address: `${STREET_NAME} 4` }, PARENT, STREET_ID, STREET_NAME);
    expect(result.decision).toBe("REJECT_FOREIGN_NONZERO");
  });

  it("does not treat street-name match as sufficient to override a foreign id — no loosening for CLASS C this wave", () => {
    const result = classifyRowIdentity({ neighborhoodId: "1", streetCode: STREET_ID, address: `${STREET_NAME} 99` }, PARENT, STREET_ID, STREET_NAME);
    expect(result.decision).toBe("REJECT_FOREIGN_NONZERO");
  });
});

describe("E — mixed batch classifies each row correctly", () => {
  it("classifies a realistic mixed batch (parent + zero-evidence + zero-no-evidence + foreign) into 4 distinct outcomes", () => {
    const batch = [
      { neighborhoodId: PARENT, streetCode: STREET_ID, address: `${STREET_NAME} 1` },
      { neighborhoodId: 0, streetCode: 74001232, address: "בני רייך 4" },
      { neighborhoodId: "0", streetCode: 999, address: "רחוב אחר 5" },
      { neighborhoodId: "65210241", streetCode: STREET_ID, address: `${STREET_NAME} 1` },
    ];
    const decisions = batch.map((r) => classifyRowIdentity(r, PARENT, STREET_ID, STREET_NAME).decision);
    expect(decisions).toEqual(["ACCEPT_PARENT_MATCH", "ACCEPT_ZERO_ID_EVIDENCE", "REJECT_ZERO_ID_INSUFFICIENT_EVIDENCE", "REJECT_FOREIGN_NONZERO"]);
    const summary = summarizeRowIdentityDecisions(decisions);
    expect(summary).toEqual({ acceptedParent: 1, acceptedZero: 1, rejectedForeign: 1, rejectedZeroInsufficientEvidence: 1, rejectedOther: 0 });
  });
});

describe("REGRESSION (ECC code-reviewer finding): a bare prefix match must not false-positive on a different real street whose name is a prefix of another", () => {
  it("rejects an address on the real street 'הרב שלום איפרגן' when the request is for 'הרב שלום' (a true prefix collision, per kiryat_hasharon_street_manifest.csv row 2)", () => {
    const result = classifyRowIdentity({ neighborhoodId: 0, streetCode: "OTHER_ID", address: "הרב שלום איפרגן 5" }, PARENT, "REQUESTED_ID", "הרב שלום");
    expect(result.decision).toBe("REJECT_ZERO_ID_INSUFFICIENT_EVIDENCE");
  });

  it("still accepts the exact requested street name with a house number appended", () => {
    const result = classifyRowIdentity({ neighborhoodId: 0, streetCode: STREET_ID, address: `${STREET_NAME} 12` }, PARENT, STREET_ID, STREET_NAME);
    expect(result.decision).toBe("ACCEPT_ZERO_ID_EVIDENCE");
  });
});

describe("H — wrong street evidence rejects", () => {
  it("rejects a zero-id row whose streetCode belongs to a DIFFERENT street even if the neighborhoodId happens to be 0", () => {
    const result = classifyRowIdentity({ neighborhoodId: 0, streetCode: 74001260, address: `${STREET_NAME} 4` }, PARENT, STREET_ID, STREET_NAME); // streetCode is the OTHER probed street's id
    expect(result.decision).toBe("REJECT_ZERO_ID_INSUFFICIENT_EVIDENCE");
  });

  it("rejects a zero-id row whose address text names a different street even with the correct streetCode", () => {
    const result = classifyRowIdentity({ neighborhoodId: 0, streetCode: STREET_ID, address: "רחוב אחר לגמרי 4" }, PARENT, STREET_ID, STREET_NAME);
    expect(result.decision).toBe("REJECT_ZERO_ID_INSUFFICIENT_EVIDENCE");
  });
});

describe("I — ambiguous identity fails closed", () => {
  it("a row with no neighborhoodId at all is rejected, never defaulted to accepted", () => {
    const result = classifyRowIdentity({ streetCode: STREET_ID, address: `${STREET_NAME} 4` }, PARENT, STREET_ID, STREET_NAME);
    expect(result.decision).toBe("REJECT_MISSING_IDENTITY");
  });
});

const NEIGHBORHOOD: Neighborhood = { id: PARENT, name: "קריית השרון", settlement: "נתניה", x: null, y: null };
function rawItem(overrides: any = {}) {
  return { dealAmount: 2000000, dealDate: "2024-05-01", address: `${STREET_NAME} 4`, roomNum: 4, assetArea: 90, floor: 2, dealNature: "דירה", parcelNum: "9904-76-9", ...overrides };
}

describe("F — same transaction parent-id vs zero-id collapses safely (composition with the shared, already-tested dedup)", () => {
  it("an accepted zero-id row re-attributed to the parent sourceId collapses with an identical parent-tagged row via the same transactionKey()", () => {
    const acceptedZero = toShadowDeal(rawItem({ neighborhoodId: 0 }), NEIGHBORHOOD, PARENT)!; // re-attributed to PARENT per the policy decision
    const parentCopy = toShadowDeal(rawItem({ neighborhoodId: PARENT }), NEIGHBORHOOD, PARENT)!;
    expect(transactionKey(acceptedZero)).toBe(transactionKey(parentCopy));
    const dedup = dedupByTransactionKey([parentCopy, acceptedZero]);
    expect(dedup.uniqueCount).toBe(1);
  });
});

describe("G — zero-id genuinely new transaction survives", () => {
  it("an accepted zero-id row with a key seen nowhere else is preserved through dedup, not accidentally dropped", () => {
    const acceptedZero = toShadowDeal(rawItem({ neighborhoodId: 0, parcelNum: "9904-76-999" }), NEIGHBORHOOD, PARENT)!;
    const dedup = dedupByTransactionKey([acceptedZero]);
    expect(dedup.uniqueCount).toBe(1);
    expect(dedup.uniqueRows[0].parcelNum).toBe("9904-76-999");
  });
});

describe("J — transaction key preserves repeat sales", () => {
  it("two accepted zero-id rows sharing a parcelNum but differing dealDate/price stay distinct, not collapsed", () => {
    const sale1 = toShadowDeal(rawItem({ neighborhoodId: 0, parcelNum: "9904-76-9", dealDate: "2020-01-01", dealAmount: 1800000 }), NEIGHBORHOOD, PARENT)!;
    const sale2 = toShadowDeal(rawItem({ neighborhoodId: 0, parcelNum: "9904-76-9", dealDate: "2025-06-01", dealAmount: 2600000 }), NEIGHBORHOOD, PARENT)!;
    expect(transactionKey(sale1)).not.toBe(transactionKey(sale2));
    const dedup = dedupByTransactionKey([sale1, sale2]);
    expect(dedup.uniqueCount).toBe(2);
  });
});

describe("K — prevDeals remain separate", () => {
  it("classifyRowIdentity's decision is independent of prevDeals — accepting a row never merges its prevDeals into top-level reconciliation", () => {
    const raw = rawItem({ neighborhoodId: 0, streetCode: STREET_ID, prevDeals: [{ dealDate: "2019-01-01", dealAmount: 1500000 }] });
    const result = classifyRowIdentity(raw, PARENT, STREET_ID, STREET_NAME);
    expect(result.decision).toBe("ACCEPT_ZERO_ID_EVIDENCE");
    // toShadowDeal's ShadowDeal shape has no prevDeals field at all — proves
    // it never leaks into the top-level 5640 reconciliation via this path.
    const shadow = toShadowDeal(raw, NEIGHBORHOOD, PARENT)!;
    expect((shadow as any).prevDeals).toBeUndefined();
  });
});

describe("L/M — no canonical or Supabase write path exists in this module", () => {
  it("L: contains no executable reference to data/deals.json or data/neighborhoods.json", () => {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const src = fs.readFileSync(path.join(__dirname, "..", "streetIdentityPolicy.ts"), "utf8");
    const executableLines = src.split("\n").filter((l) => l.includes("deals.json") || l.includes("neighborhoods.json")).filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
    expect(executableLines).toEqual([]);
  });

  it("M: contains no Supabase client import or upsert call, and no fs/network I/O at all (pure classification only)", () => {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const src = fs.readFileSync(path.join(__dirname, "..", "streetIdentityPolicy.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']@supabase\/supabase-js["']/);
    expect(src).not.toMatch(/createClient\s*\(/);
    expect(src).not.toMatch(/import\s+.*["']fs["']/);
    expect(src).not.toMatch(/fetch\s*\(/);
  });
});

describe("No blanket zero-id acceptance — the policy never accepts on neighborhoodId alone", () => {
  it("the function's own source never returns ACCEPT for a bare neighborhoodId===0 check without the two evidence conditions", () => {
    // Behavioral proof, not a source-text guess: neither evidence flag present -> rejected.
    const result = classifyRowIdentity({ neighborhoodId: 0 }, PARENT, STREET_ID, STREET_NAME);
    expect(result.decision).toBe("REJECT_ZERO_ID_INSUFFICIENT_EVIDENCE");
  });
});
