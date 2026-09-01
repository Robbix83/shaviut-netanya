import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Wave 0G-L1F: regression guard for scripts/harvest.ts's isDirectExecution
 * check. This is the ONE script in this repo where losing the guard means
 * a real Playwright browser launch and live scraping the moment anything
 * imports the file — not just a wasted rebuild like the audit scripts this
 * pattern was first proven on (see buildV2LaunchCandidate.test.ts). An ECC
 * planner finding: every other guarded script already has this exact test;
 * harvest.ts didn't.
 */
describe("REGRESSION — importing scripts/harvest.ts must never launch a browser or start scraping", () => {
  it("main() is guarded by the isDirectExecution check", () => {
    const src = readFileSync(path.join(__dirname, "..", "harvest.ts"), "utf8");
    expect(src).toMatch(/const isDirectExecution = typeof process\.argv\[1\] === "string" && import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href;/);
    expect(src).toMatch(/if \(isDirectExecution\) \{\s*main\(\)/);
  });
});
