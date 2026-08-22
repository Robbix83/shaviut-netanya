import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression guard for a real Wave 0C-2B finding: SupabaseStore.getStats() used to
 * collapse a failed count query into `count ?? 0`, which is indistinguishable from a
 * genuinely empty `deals` table. It must now fail loud (throw) on a query error, like
 * every other SupabaseStore method, while still returning a real 0 for a legitimately
 * empty table.
 */

let mockClient: {
  from: (table: string) => {
    select: (cols: string, opts?: { count?: string; head?: boolean }) => any;
  };
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => mockClient,
}));

function makeClient(
  countRes: { count: number | null; error: unknown },
  neighRes: { data: Array<{ neighborhoodId: string }> | null; error: unknown },
) {
  return {
    from: (table: string) => {
      if (table !== "deals") throw new Error(`unexpected table: ${table}`);
      return {
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.head) return Promise.resolve(countRes);
          return { not: () => Promise.resolve(neighRes) };
        },
      };
    },
  };
}

describe("SupabaseStore.getStats", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.DATA_SOURCE = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns the real count when the count query succeeds (count=12642, error=null)", async () => {
    mockClient = makeClient(
      { count: 12642, error: null },
      { data: [{ neighborhoodId: "n1" }], error: null },
    );
    const { getStore } = await import("../store");
    const stats = await getStore().getStats();
    expect(stats.dealCount).toBe(12642);
  });

  it("throws instead of silently returning 0 when the count query errors (count=null, error set)", async () => {
    mockClient = makeClient(
      { count: null, error: new Error("statement timeout") },
      { data: [], error: null },
    );
    const { getStore } = await import("../store");
    await expect(getStore().getStats()).rejects.toThrow("statement timeout");
  });

  it("still returns a real 0 for a genuinely empty table (count=0, error=null)", async () => {
    mockClient = makeClient({ count: 0, error: null }, { data: [], error: null });
    const { getStore } = await import("../store");
    const stats = await getStore().getStats();
    expect(stats.dealCount).toBe(0);
  });
});
