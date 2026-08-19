import { describe, it, expect } from "vitest";
import { isAdminAuthorized } from "@/lib/adminAuth";

describe("isAdminAuthorized (admin sign-in seam)", () => {
  it("authorizes only the exact configured ADMIN_EMAIL", () => {
    const env = { adminEmail: "owner@example.com", isProduction: true };
    expect(isAdminAuthorized("owner@example.com", env)).toBe(true);
    expect(isAdminAuthorized("someone-else@gmail.com", env)).toBe(false);
    expect(isAdminAuthorized(null, env)).toBe(false);
    expect(isAdminAuthorized(undefined, env)).toBe(false);
  });

  it("FAILS CLOSED in production when ADMIN_EMAIL is unset (no silent authorization)", () => {
    const env = { adminEmail: undefined, isProduction: true };
    expect(isAdminAuthorized("anyone@gmail.com", env)).toBe(false);
    expect(isAdminAuthorized("", env)).toBe(false);
  });

  it("stays convenient in development when ADMIN_EMAIL is unset", () => {
    const env = { adminEmail: undefined, isProduction: false };
    expect(isAdminAuthorized("dev@localhost", env)).toBe(true);
  });

  it("ignores surrounding whitespace in ADMIN_EMAIL", () => {
    const env = { adminEmail: "  owner@example.com  ", isProduction: true };
    expect(isAdminAuthorized("owner@example.com", env)).toBe(true);
  });
});
