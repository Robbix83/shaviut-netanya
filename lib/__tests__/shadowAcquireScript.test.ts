import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Wave 0G-12 Phase 17 items B/C — structural guarantees about
 * scripts/audit-wave0g12-shadow-acquire.ts, tested the same way prior
 * waves' audit scripts were (source-text assertions), since the script
 * drives a real Playwright browser session and isn't practically unit-
 * testable by execution. Items D/E/F/G/H/I are covered by real execution
 * tests in shadowRebuild.test.ts; J/K are proven by the live pilot runs
 * documented in audit/wave0g12/SHADOW_REBUILD_V2_PILOT.md.
 */
const scriptSrc = readFileSync(
  path.join(__dirname, "..", "..", "scripts", "audit-wave0g12-shadow-acquire.ts"), "utf8",
);

describe("TEST B — no autocomplete or name re-resolution", () => {
  it("never fills a search input or interacts with an autocomplete suggestion", () => {
    expect(scriptSrc).not.toMatch(/myInput2|react-autosuggest/);
    expect(scriptSrc).not.toMatch(/\.fill\(/);
  });

  it("never queries GovMap/TldSearch in executable code — acquisition is direct-sourceId only (the header docstring's prose mentioning 'no GovMap fallback' is expected and excluded here)", () => {
    const executableSrc = scriptSrc
      .split("\n")
      .filter((l) => { const t = l.trim(); return !t.startsWith("*") && !t.startsWith("/**") && !t.startsWith("//"); })
      .join("\n");
    expect(executableSrc).not.toMatch(/govmap|TldSearch/i);
  });

  it("navigates ONLY via the proven direct-URL builder, never a constructed search query", () => {
    expect(scriptSrc).toMatch(/buildDirectNeighborhoodUrl\(/);
  });
});

describe("TEST C — a wrong-entity response fails the WHOLE acquisition, not filtered-and-continued", () => {
  it("calls the shared fail-closed identity check on every captured exchange", () => {
    expect(scriptSrc).toMatch(/assertDirectIdAcquisitionIdentity\(/);
  });

  it("an invalid identity check sets entityFailed=true rather than being silently dropped from allRawItems", () => {
    expect(scriptSrc).toMatch(/if\s*\(!identity\.valid\)\s*\{\s*\n\s*entityFailed\s*=\s*true;/);
  });

  it("a failed entity writes a failure record and exits non-zero, never silently produces a partial shadow file", () => {
    expect(scriptSrc).toMatch(/if\s*\(entityFailed\)\s*\{/);
    expect(scriptSrc).toMatch(/process\.exit\(1\)/);
    expect(scriptSrc).toMatch(/failed:\s*true/);
  });
});

describe("shadow output safety (Wave 0G-12 Phase 16, script-level)", () => {
  it("guards its output path via the shared assertSafeShadowOutputPath before any network I/O", () => {
    expect(scriptSrc).toMatch(/assertSafeShadowOutputPath\(/);
  });

  it("writes only under audit/wave0g12/shadow/", () => {
    expect(scriptSrc).toMatch(/OUT_DIR_REL\s*=\s*"audit\/wave0g12\/shadow"/);
  });

  it("has no Supabase client import or upsert call", () => {
    expect(scriptSrc).not.toMatch(/from\s+["']@supabase\/supabase-js["']/);
    expect(scriptSrc).not.toMatch(/createClient\s*\(/);
  });

  it("never references data/deals.json or data/neighborhoods.json as a write target", () => {
    const writeFileCalls = [...scriptSrc.matchAll(/fs\.writeFile\(([^)]*)\)/g)].map((m) => m[1]);
    expect(writeFileCalls.length).toBeGreaterThan(0);
    for (const call of writeFileCalls) {
      expect(call).not.toMatch(/deals\.json|neighborhoods\.json/);
    }
  });
});

describe("pagination depth discipline (Wave 0G-12 Phase 5)", () => {
  it("never attempts a click loop targeting fetch_number beyond 2 — only what prior waves proved safe", () => {
    expect(scriptSrc).not.toMatch(/fetchNumber\s*\?\?\s*0\)\s*>=\s*3/);
    expect(scriptSrc).toMatch(/fetchNumber\s*\?\?\s*0\)\s*>=\s*2/);
  });

  it("reads fetch_number from the decoded REQUEST envelope, never the response body", () => {
    expect(scriptSrc).toMatch(/decodeRequestEnvelope\(/);
    expect(scriptSrc).not.toMatch(/contract\.fetchNumber/);
  });
});
