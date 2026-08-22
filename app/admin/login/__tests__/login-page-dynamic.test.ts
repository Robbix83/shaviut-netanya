import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Regression guard for a real Vercel build blocker (Wave 0C-2A):
 * app/admin/login/page.tsx contains an inline Server Action (signIn via
 * "use server"), which makes it a static+action hybrid route. Without
 * `export const dynamic = "force-dynamic"`, `vercel build` failed with
 * "Unable to find lambda for route: /admin/login" (NEXT_MISSING_LAMBDA) —
 * reproduced and fixed by forcing the page dynamic. If this directive is
 * ever removed, the build blocker would silently return.
 */
describe("admin/login page stays dynamic (Vercel build regression guard)", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../page.tsx"),
    "utf8",
  );

  it("exports dynamic = 'force-dynamic'", () => {
    expect(source).toMatch(/export const dynamic\s*=\s*["']force-dynamic["']/);
  });

  it("still contains the inline Server Action this fix protects against", () => {
    expect(source).toMatch(/"use server"/);
  });
});
