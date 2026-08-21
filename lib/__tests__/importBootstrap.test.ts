import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  EXPECTED_PROJECT_REF, deriveProjectRef, assertTargetProject, projectNeighborhood,
  projectDeal, validateSource, batchRows, digestDeals, digestNeighborhoods,
  parseArgs, checkPreflight, validateResume, NEIGHBORHOOD_COLUMNS, DEAL_COLUMNS,
} from "@/lib/importBootstrap";

const N = (o: any = {}) => ({ id: "n1", name: "א", settlement: "נתניה", x: 1, y: 2, ...o });
const D = (o: any = {}) => ({
  id: "d1", dealDate: "2024-01-01", price: 1000000, propertyType: "apartment",
  rooms: 4, areaSqm: 100, plotSqm: null, floor: 3, yearBuilt: 0, dealNature: "x",
  address: "a", houseNumber: "10", street: "s", neighborhoodId: "n1",
  neighborhood: "א", settlement: "נתניה", x: 1, y: 2, pricePerSqm: 10000, ...o,
});

describe("target project pinning", () => {
  it("derives the ref from the supabase URL", () => {
    expect(deriveProjectRef("https://sddtjsojbdxtakpwpqlz.supabase.co")).toBe("sddtjsojbdxtakpwpqlz");
  });
  it("accepts ONLY the expected project ref", () => {
    expect(assertTargetProject("https://sddtjsojbdxtakpwpqlz.supabase.co").ok).toBe(true);
  });
  it("hard-stops on a wrong project ref", () => {
    const r = assertTargetProject("https://someotherproject.supabase.co");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/refusing/);
  });
  it("hard-stops on unparseable URL", () => {
    expect(assertTargetProject(undefined).ok).toBe(false);
    expect(assertTargetProject("not-a-url").ok).toBe(false);
  });
  it("expected ref constant is the authorized project", () => {
    expect(EXPECTED_PROJECT_REF).toBe("sddtjsojbdxtakpwpqlz");
  });
});

describe("serializers", () => {
  it("neighborhood projection keeps exactly 5 columns and drops unknown fields", () => {
    const p = projectNeighborhood(N({ EVIL: "x", dealCount: 9 }));
    expect(Object.keys(p).sort()).toEqual([...NEIGHBORHOOD_COLUMNS].sort());
    expect(p).not.toHaveProperty("EVIL");
    expect(p).not.toHaveProperty("dealCount");
  });
  it("deal projection keeps exactly 19 columns and drops unknown fields", () => {
    const p = projectDeal(D({ EVIL: "x", extra: 1 }));
    expect(Object.keys(p).sort()).toEqual([...DEAL_COLUMNS].sort());
    expect(p).not.toHaveProperty("EVIL");
  });
  it("undefined → null (never leaves undefined)", () => {
    const p = projectDeal({ id: "d9", neighborhoodId: "n1", propertyType: "land" });
    expect(p.rooms).toBeNull();
    expect(p.plotSqm).toBeNull();
    expect(Object.values(p).every((v) => v !== undefined)).toBe(true);
  });
});

describe("source validation (reject-only, no cleaning)", () => {
  it("passes clean source", () => {
    expect(validateSource([N()], [D()]).ok).toBe(true);
  });
  it("rejects duplicate Deal ids", () => {
    const r = validateSource([N()], [D(), D()]);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/duplicate Deal ids/);
  });
  it("rejects orphan neighborhoodId", () => {
    const r = validateSource([N()], [D({ neighborhoodId: "ZZZ" })]);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/orphan/);
  });
  it("rejects bad propertyType", () => {
    expect(validateSource([N()], [D({ propertyType: "villa" })]).ok).toBe(false);
  });
  it("rejects unparseable dealDate", () => {
    expect(validateSource([N()], [D({ dealDate: "not-a-date" })]).ok).toBe(false);
  });
  it("does NOT reject yearBuilt=0 / rooms=0 / null fields (no cleaning)", () => {
    expect(validateSource([N()], [D({ yearBuilt: 0, rooms: 0, plotSqm: null, floor: null })]).ok).toBe(true);
  });
});

describe("batching produces every row exactly once", () => {
  it("concatenated batches equal the input, no dup/loss", () => {
    const rows = Array.from({ length: 1003 }, (_, i) => ({ id: `d${i}` }));
    const batches = batchRows(rows, 250);
    expect(batches.length).toBe(5);
    const flat = batches.flat();
    expect(flat.length).toBe(1003);
    expect(new Set(flat.map((r) => r.id)).size).toBe(1003);
    expect(flat.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });
});

describe("canonical parity normalizer is stable", () => {
  it("same rows in different order → same digest", () => {
    const a = digestDeals([D({ id: "d1" }), D({ id: "d2" })]);
    const b = digestDeals([D({ id: "d2" }), D({ id: "d1" })]);
    expect(a.digest).toBe(b.digest);
  });
  it("normalizes numeric string vs number equally (Postgres repr)", () => {
    const local = digestDeals([D({ price: 1000000, rooms: 3.5 })]);
    const remote = digestDeals([D({ price: "1000000", rooms: "3.5" })]); // as PostgREST may return
    expect(local.digest).toBe(remote.digest);
  });
  it("normalizes date to yyyy-mm-dd", () => {
    const local = digestDeals([D({ dealDate: "2024-01-01" })]);
    const remote = digestDeals([D({ dealDate: "2024-01-01T00:00:00" })]);
    expect(local.digest).toBe(remote.digest);
  });
  it("detects a real value difference", () => {
    const a = digestDeals([D({ price: 1000000 })]);
    const b = digestDeals([D({ price: 1000001 })]);
    expect(a.digest).not.toBe(b.digest);
  });
  it("neighborhood digest stable", () => {
    expect(digestNeighborhoods([N()]).digest).toBe(digestNeighborhoods([N()]).digest);
  });
});

describe("CLI mode + preflight + resume safety", () => {
  it("defaults to dry-run (no writes) without a flag", () => {
    expect(parseArgs([]).dryRun).toBe(true);
  });
  it("requires explicit --write for real writes", () => {
    expect(parseArgs(["--write"]).dryRun).toBe(false);
    expect(parseArgs(["--execute"]).dryRun).toBe(false);
  });
  it("stops when leads table is non-empty", () => {
    expect(checkPreflight({ neighborhoods: 0, deals: 0, leads: 1 }, { resume: false }).ok).toBe(false);
  });
  it("stops initial import when tables are non-empty (no --resume)", () => {
    expect(checkPreflight({ neighborhoods: 21, deals: 100, leads: 0 }, { resume: false }).ok).toBe(false);
  });
  it("allows resume on a non-empty table", () => {
    expect(checkPreflight({ neighborhoods: 21, deals: 100, leads: 0 }, { resume: true }).ok).toBe(true);
  });
  it("resume validates source hash against the manifest", () => {
    const manifest = { targetProjectRef: EXPECTED_PROJECT_REF, sourceNeighborhoodsSha256: "aaa", sourceDealsSha256: "bbb" };
    expect(validateResume(manifest, { ref: EXPECTED_PROJECT_REF, neighborhoodsSha: "aaa", dealsSha: "bbb", leads: 0 }).ok).toBe(true);
    expect(validateResume(manifest, { ref: EXPECTED_PROJECT_REF, neighborhoodsSha: "CHANGED", dealsSha: "bbb", leads: 0 }).ok).toBe(false);
    expect(validateResume(manifest, { ref: "otherproj", neighborhoodsSha: "aaa", dealsSha: "bbb", leads: 0 }).ok).toBe(false);
    expect(validateResume(null, { ref: EXPECTED_PROJECT_REF, neighborhoodsSha: "aaa", dealsSha: "bbb", leads: 0 }).ok).toBe(false);
  });
});

describe("NO lead import path exists", () => {
  const script = readFileSync(path.resolve(__dirname, "../../scripts/import-supabase-bootstrap.ts"), "utf8");
  // Strip block + line comments so we test actual CODE (comments legitimately warn "never import leads.json").
  const code = script.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  it("the importer code never reads or references leads.json (comments aside)", () => {
    expect(code).not.toMatch(/leads\.json/);
  });
  it("the importer never inserts/upserts into a leads table", () => {
    expect(script).not.toMatch(/from\(["']leads["']\)\.(insert|upsert)/);
    expect(script).not.toMatch(/upsert\(\s*sb\s*,\s*["']leads["']/);
  });
  it("only neighborhoods and deals are import targets", () => {
    // upsert(sb, "<table>", ...) calls in the real import
    const targets = [...script.matchAll(/upsert\(sb,\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(targets)).toEqual(new Set(["neighborhoods", "deals"]));
  });
});
