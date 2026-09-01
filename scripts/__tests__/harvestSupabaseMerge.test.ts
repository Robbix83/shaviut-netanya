/**
 * Wave 0G-L1F: regression coverage for scripts/harvest.ts's
 * loadExistingDealsFromSupabase() — the read that makes the Supabase
 * upsert path aware of transactions already in the `deals` table, closing
 * the gap Wave 0G-L1E disclosed (existingDeals was only ever loaded from
 * the local data/deals.json file, never for DATA_SOURCE=supabase).
 *
 * Mocks only the low-level @supabase/supabase-js client (a real,
 * unmodified harvest.ts function is exercised) — no network, no live
 * credentials. Importing scripts/harvest.ts is safe: its main() is now
 * guarded by an isDirectExecution check (this wave's own fix; see the
 * bottom of harvest.ts), so importing it here does not launch a browser
 * or start scraping.
 */
import { describe, it, expect, vi } from "vitest";

function makePaginatedDealsMock(allRows: any[]) {
  return {
    from(table: string) {
      if (table !== "deals") throw new Error(`UNEXPECTED_TABLE:${table}`);
      const state: { rangeStart: number | null; rangeEnd: number | null } = { rangeStart: null, rangeEnd: null };
      const builder: any = {
        select() {
          return builder;
        },
        order() {
          return builder;
        },
        range(a: number, b: number) {
          state.rangeStart = a;
          state.rangeEnd = b;
          return builder;
        },
        then(resolve: (v: any) => void) {
          const start = state.rangeStart ?? 0;
          const end = state.rangeEnd ?? allRows.length - 1;
          resolve({ data: allRows.slice(start, end + 1), error: null });
        },
      };
      return builder;
    },
  };
}

function dealRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: overrides.id,
    dealDate: "2024-01-01",
    price: 1000000,
    propertyType: "apartment",
    neighborhoodId: "65210195",
    areaSqm: 80,
    plotSqm: null,
    ...overrides,
  };
}

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

describe("loadExistingDealsFromSupabase — exhaustive pagination (Wave 0G-L1F)", () => {
  it("reads a small table (single page) in full", async () => {
    const { loadExistingDealsFromSupabase } = await import("../harvest");
    const rows = [dealRow({ id: "d1" }), dealRow({ id: "d2" })];
    const sb = makePaginatedDealsMock(rows);
    const result = await loadExistingDealsFromSupabase(sb);
    expect(result.length).toBe(2);
    expect(result.map((r: any) => r.id)).toEqual(["d1", "d2"]);
  });

  it("exhaustively paginates past PostgREST's ~1000-row page cap (the exact regression class Wave 0E-1B/0E-2A already proved matters for this table)", async () => {
    const { loadExistingDealsFromSupabase } = await import("../harvest");
    const rows: any[] = [];
    for (let i = 0; i < 1500; i++) rows.push(dealRow({ id: `d${String(i).padStart(5, "0")}` }));
    const sb = makePaginatedDealsMock(rows);
    const result = await loadExistingDealsFromSupabase(sb);
    expect(result.length).toBe(1500);
  });

  it("returns an empty array for an empty table, not an error", async () => {
    const { loadExistingDealsFromSupabase } = await import("../harvest");
    const sb = makePaginatedDealsMock([]);
    const result = await loadExistingDealsFromSupabase(sb);
    expect(result).toEqual([]);
  });

  it("throws (fail-closed) rather than silently returning partial data on a query error", async () => {
    const { loadExistingDealsFromSupabase } = await import("../harvest");
    const sb = {
      from() {
        const builder: any = {
          select: () => builder,
          order: () => builder,
          range: () => builder,
          then: (resolve: (v: any) => void) => resolve({ data: null, error: { code: "PGRST999", message: "boom" } }),
        };
        return builder;
      },
    };
    await expect(loadExistingDealsFromSupabase(sb)).rejects.toThrow(/SUPABASE_EXISTING_DEALS_READ_FAILED/);
  });
});
