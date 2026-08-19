import { describe, it, expect } from "vitest";
import { resolveDataSource, isWebhookAuthorized } from "@/lib/config";

describe("resolveDataSource (production fail-closed)", () => {
  it("throws in production when DATA_SOURCE is missing", () => {
    expect(() => resolveDataSource({ NODE_ENV: "production" })).toThrow(/DATA_SOURCE/);
  });
  it("throws in production when DATA_SOURCE=local", () => {
    expect(() => resolveDataSource({ NODE_ENV: "production", DATA_SOURCE: "local" })).toThrow(/DATA_SOURCE/);
  });
  it("accepts supabase in production", () => {
    expect(resolveDataSource({ NODE_ENV: "production", DATA_SOURCE: "supabase" })).toBe("supabase");
  });
  it("defaults to local in development", () => {
    expect(resolveDataSource({ NODE_ENV: "development" })).toBe("local");
    expect(resolveDataSource({ NODE_ENV: "development", DATA_SOURCE: "local" })).toBe("local");
  });
  it("honors supabase in development", () => {
    expect(resolveDataSource({ NODE_ENV: "development", DATA_SOURCE: "supabase" })).toBe("supabase");
  });
  it("does not enforce during the production BUILD phase (next build must not break)", () => {
    // Local `next build` prerenders with DATA_SOURCE=local; enforcement is request-time only.
    expect(
      resolveDataSource({ NODE_ENV: "production", DATA_SOURCE: "local", NEXT_PHASE: "phase-production-build" }),
    ).toBe("local");
    // But request-time serving (no build phase) still fails closed:
    expect(() => resolveDataSource({ NODE_ENV: "production", DATA_SOURCE: "local" })).toThrow(/DATA_SOURCE/);
  });
});

describe("isWebhookAuthorized (Green webhook fail-closed)", () => {
  it("denies in production when no token is configured", () => {
    expect(isWebhookAuthorized({ expected: undefined, provided: null, isProduction: true })).toBe(false);
    expect(isWebhookAuthorized({ expected: undefined, provided: "anything", isProduction: true })).toBe(false);
  });
  it("rejects a wrong token", () => {
    expect(isWebhookAuthorized({ expected: "secret", provided: "wrong", isProduction: true })).toBe(false);
    expect(isWebhookAuthorized({ expected: "secret", provided: null, isProduction: true })).toBe(false);
  });
  it("accepts the correct token", () => {
    expect(isWebhookAuthorized({ expected: "secret", provided: "secret", isProduction: true })).toBe(true);
  });
  it("allows dev with no token configured", () => {
    expect(isWebhookAuthorized({ expected: undefined, provided: null, isProduction: false })).toBe(true);
  });
});
