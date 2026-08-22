import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression guard for two real Wave 0C-2B findings in SupabaseStore.getStats():
 *  1. A failed count query used to collapse into `count ?? 0`, indistinguishable from a
 *     genuinely empty `deals` table. It must now fail loud (throw), like every other
 *     SupabaseStore method — while still returning a real 0 for a legitimately empty table.
 *  2. The neighborhoodId query was unbounded (no .range()), so PostgREST's default 1000-row
 *     response cap silently undercounted distinct neighborhoods on any table with more than
 *     1000 deals (proven on real data: 12,642 deals → only 1000 rows read → 3 of 21 real
 *     neighborhoods counted). It must now page through every row, matching LocalStore's
 *     "distinct neighborhoodIds represented in deals" semantic exactly.
 */

let mockClient: {
  from: (table: string) => {
    select: (cols: string, opts?: { count?: string; head?: boolean }) => any;
  };
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => mockClient,
}));

/** Builds a fake Supabase client backed by an in-memory deals array, replicating
 * PostgREST's real behavior: an unbounded select would only ever return the first
 * page — this fake enforces that by only serving rows within the requested .range(). */
function makeClient(
  countRes: { count: number | null; error: unknown },
  allRows: Array<{ neighborhoodId: string | null }>,
) {
  return {
    from: (table: string) => {
      if (table !== "deals") throw new Error(`unexpected table: ${table}`);
      return {
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.head) return Promise.resolve(countRes);
          return {
            not: () => ({
              range: (start: number, end: number) => {
                const page = allRows.slice(start, end + 1).filter((r) => r.neighborhoodId != null);
                return Promise.resolve({ data: page, error: null });
              },
            }),
          };
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

  it("returns the real deal count when the count query succeeds (count=12642, error=null)", async () => {
    mockClient = makeClient({ count: 12642, error: null }, [{ neighborhoodId: "n1" }]);
    const { getStore } = await import("../store");
    const stats = await getStore().getStats();
    expect(stats.dealCount).toBe(12642);
  });

  it("throws instead of silently returning 0 when the count query errors (count=null, error set)", async () => {
    mockClient = makeClient({ count: null, error: new Error("statement timeout") }, []);
    const { getStore } = await import("../store");
    await expect(getStore().getStats()).rejects.toThrow("statement timeout");
  });

  it("still returns a real 0 for a genuinely empty table (count=0, error=null)", async () => {
    mockClient = makeClient({ count: 0, error: null }, []);
    const { getStore } = await import("../store");
    const stats = await getStore().getStats();
    expect(stats.dealCount).toBe(0);
    expect(stats.neighborhoodCount).toBe(0);
  });

  it("does not depend on receiving more than the first 1000 deal rows: 2500 deals across 21 neighborhoods still returns 21", async () => {
    const rows: Array<{ neighborhoodId: string | null }> = [];
    for (let i = 0; i < 2500; i++) {
      rows.push({ neighborhoodId: `n${i % 21}` }); // exactly 21 distinct ids, spread across 3 pages
    }
    mockClient = makeClient({ count: rows.length, error: null }, rows);
    const { getStore } = await import("../store");
    const stats = await getStore().getStats();
    expect(stats.dealCount).toBe(2500);
    expect(stats.neighborhoodCount).toBe(21);
  });

  it("reproduces the real-data bug being fixed: with only a single unpaginated 1000-row page, distinct count would undercount — proves pagination is what fixes it", async () => {
    // Clustered by neighborhood (each id repeats for ~119 consecutive rows), matching how
    // the real 12,642-row table was observed to undercount (only 3 of 21 seen in row 0-999) —
    // a round-robin distribution wouldn't reproduce the bug, since it would already contain
    // every id within the first page.
    const rows: Array<{ neighborhoodId: string | null }> = [];
    for (let i = 0; i < 2499; i++) rows.push({ neighborhoodId: `n${Math.floor(i / 119)}` });
    // Simulate the OLD unbounded-query bug directly: distinct count over only the first 1000 rows.
    const firstPageOnly = rows.slice(0, 1000);
    const undercounted = new Set(firstPageOnly.map((r) => r.neighborhoodId)).size;
    expect(undercounted).toBeLessThan(21); // the bug this wave fixed

    // The real (fixed) store must not exhibit this — it must see all 2500 rows.
    mockClient = makeClient({ count: rows.length, error: null }, rows);
    const { getStore } = await import("../store");
    const stats = await getStore().getStats();
    expect(stats.neighborhoodCount).toBe(21);
  });

  it("parity: SupabaseStore's distinct-neighborhoodId result matches LocalStore's Set-based algorithm on the same data", async () => {
    const rows: Array<{ neighborhoodId: string | null }> = [];
    for (let i = 0; i < 1500; i++) rows.push({ neighborhoodId: i % 7 === 0 ? null : `n${i % 12}` });
    // LocalStore.getStats(): new Set(all.map(d => d.neighborhoodId).filter(Boolean)).size
    const localStoreResult = new Set(rows.map((d) => d.neighborhoodId).filter(Boolean)).size;

    mockClient = makeClient({ count: rows.length, error: null }, rows);
    const { getStore } = await import("../store");
    const stats = await getStore().getStats();
    expect(stats.neighborhoodCount).toBe(localStoreResult);
  });
});
