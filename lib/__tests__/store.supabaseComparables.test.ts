import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression guard for the Wave 0E-1B/0E-2A SupabaseStore comparable-selection bug:
 *  - getDealsByNeighborhood() silently truncated at PostgREST's ~1000-row default
 *    response cap (no pagination) — proven on a real 3,010-row neighborhood
 *    (Weizmann's), which made a real exact-building match invisible to the selector.
 *  - getAllDeals() returned only {id,neighborhoodId,x,y}, stripping `street`/
 *    `houseNumber` — silently disabling every city-wide fallback in
 *    lib/valuation.ts that lib/valuationService.ts's resolveAndValuate() depends on
 *    (proven on a real address whose deals are split across two neighborhoodIds,
 *    Hartom's).
 *
 * These tests exercise the real production seam (resolveAndValuate() -> valuate())
 * against a mocked Supabase client that faithfully replicates PostgREST's actual
 * filter/order/range semantics — not a standalone pagination helper in isolation.
 */

// ---------- minimal in-memory PostgREST-like query builder ----------

function makeSupabaseMock(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      const rows: any[] = tables[table] ?? [];
      const state: {
        filters: Array<(r: any) => boolean>;
        order: string | null;
        orderDesc: boolean;
        rangeStart: number | null;
        rangeEnd: number | null;
        limitN: number | null;
        maybeSingle: boolean;
        selectOpts: { count?: string; head?: boolean } | undefined;
      } = { filters: [], order: null, orderDesc: false, rangeStart: null, rangeEnd: null, limitN: null, maybeSingle: false, selectOpts: undefined };

      const builder: any = {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          state.selectOpts = opts;
          return builder;
        },
        eq(col: string, val: unknown) {
          state.filters.push((r) => r[col] === val);
          return builder;
        },
        gte(col: string, val: string | number) {
          state.filters.push((r) => r[col] != null && r[col] >= val);
          return builder;
        },
        lte(col: string, val: string | number) {
          state.filters.push((r) => r[col] != null && r[col] <= val);
          return builder;
        },
        not(col: string, op: string, val: unknown) {
          if (op === "is" && val === null) state.filters.push((r) => r[col] != null);
          return builder;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          state.order = col;
          state.orderDesc = opts?.ascending === false;
          return builder;
        },
        range(a: number, b: number) {
          state.rangeStart = a;
          state.rangeEnd = b;
          return builder;
        },
        limit(n: number) {
          state.limitN = n;
          return builder;
        },
        maybeSingle() {
          state.maybeSingle = true;
          return builder;
        },
        then(resolve: (v: any) => void, reject?: (e: any) => void) {
          try {
            let result = rows.filter((r) => state.filters.every((f) => f(r)));
            if (state.order) {
              const col = state.order;
              result = [...result].sort((a, b) => {
                if (a[col] < b[col]) return state.orderDesc ? 1 : -1;
                if (a[col] > b[col]) return state.orderDesc ? -1 : 1;
                return 0;
              });
            }
            if (state.selectOpts?.head) {
              resolve({ count: result.length, data: null, error: null });
              return;
            }
            if (state.rangeStart != null) {
              result = result.slice(state.rangeStart, (state.rangeEnd ?? result.length) + 1);
            } else if (state.limitN != null) {
              result = result.slice(0, state.limitN);
            }
            if (state.maybeSingle) {
              resolve({ data: result[0] ?? null, error: null });
              return;
            }
            resolve({ data: result, error: null, count: result.length });
          } catch (e) {
            if (reject) reject(e);
            else throw e;
          }
        },
      };
      return builder;
    },
  };
}

function makeDeal(overrides: Partial<Record<string, unknown>>) {
  return {
    id: overrides.id,
    dealDate: "2025-01-15",
    price: 2000000,
    propertyType: "apartment",
    rooms: 4,
    areaSqm: 90,
    plotSqm: null,
    floor: 3,
    yearBuilt: 2000,
    dealNature: "דירה בבית קומות",
    address: null,
    houseNumber: "1",
    street: "רחוב הבדיקה",
    neighborhoodId: "N1",
    neighborhood: "שכונת בדיקה",
    settlement: "נתניה",
    x: 100000,
    y: 100000,
    pricePerSqm: Math.round(2000000 / 90),
    ...overrides,
  };
}

let mockClient: ReturnType<typeof makeSupabaseMock>;

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => mockClient,
}));

describe("SupabaseStore comparable-selection parity (Wave 0E-2A)", () => {
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

  // ---------- TEST A — pagination ----------
  it("getDealsByNeighborhood() exhaustively paginates past 1000 rows and includes a target building located after row 1000", async () => {
    const rows = [];
    for (let i = 0; i < 1200; i++) {
      rows.push(makeDeal({ id: `d${String(i).padStart(5, "0")}`, houseNumber: String(1 + (i % 50)) }));
    }
    // the target building's row is deliberately placed near the end (after row 1000 in id order)
    rows.push(makeDeal({ id: "d99999-target", houseNumber: "77", dealDate: "2025-06-01" }));
    mockClient = makeSupabaseMock({ deals: rows });

    const { getStore } = await import("../store");
    const store = getStore();
    const result = await store.getDealsByNeighborhood("N1", {});

    expect(result.length).toBe(1201);
    expect(result.some((d) => d.id === "d99999-target" && d.houseNumber === "77")).toBe(true);
  });

  // ---------- TEST B — getAllDeals field parity ----------
  it("getAllDeals() preserves street and houseNumber (and the full Deal shape), not a narrow projection", async () => {
    mockClient = makeSupabaseMock({
      deals: [makeDeal({ id: "d1", street: "ויצמן", houseNumber: "92" })],
    });
    const { getStore } = await import("../store");
    const store = getStore();
    const all = await store.getAllDeals();

    expect(all.length).toBe(1);
    expect(all[0].street).toBe("ויצמן");
    expect(all[0].houseNumber).toBe("92");
    expect(all[0].propertyType).toBe("apartment");
    expect(all[0].price).toBe(2000000);
  });

  // ---------- TEST C — getAllDeals pagination ----------
  it("getAllDeals() exhaustively paginates past 1000 city-wide rows", async () => {
    const rows = [];
    for (let i = 0; i < 1500; i++) {
      rows.push(makeDeal({ id: `d${String(i).padStart(5, "0")}` }));
    }
    mockClient = makeSupabaseMock({ deals: rows });
    const { getStore } = await import("../store");
    const store = getStore();
    const all = await store.getAllDeals();
    expect(all.length).toBe(1500);
  });

  // ---------- TEST D — exact-building fallback (Hartom-equivalent) ----------
  it("recovers an exact-building match that lives under a different neighborhood than the one resolved (Hartom scenario)", async () => {
    const targetStreet = "רחוב הבדיקה";
    // Neighborhood A: what address resolution picks — has same-street deals, but NOT the target house number
    const neighA = [
      makeDeal({ id: "a1", neighborhoodId: "A", houseNumber: "10", dealDate: "2026-01-01" }),
      makeDeal({ id: "a2", neighborhoodId: "A", houseNumber: "12", dealDate: "2025-12-01" }),
      makeDeal({ id: "a3", neighborhoodId: "A", houseNumber: "14", dealDate: "2025-11-01" }),
    ];
    // Neighborhood B: where the target building's real deals are actually tagged
    const neighB = [
      makeDeal({ id: "b1", neighborhoodId: "B", houseNumber: "30", dealDate: "2024-08-30", rooms: 4, areaSqm: 90.3 }),
      makeDeal({ id: "b2", neighborhoodId: "B", houseNumber: "30", dealDate: "2024-01-17", rooms: 4, areaSqm: 90.3 }),
      makeDeal({ id: "b3", neighborhoodId: "B", houseNumber: "30", dealDate: "2023-05-14", rooms: 3, areaSqm: 83.1 }),
    ];
    mockClient = makeSupabaseMock({ deals: [...neighA, ...neighB] });

    const { getStore } = await import("../store");
    const { resolveAndValuate } = await import("../valuationService");
    void getStore(); // establish singleton before resolveAndValuate resolves its own store

    const outcome = await resolveAndValuate({
      neighborhoodId: "A", // address resolution picked the wrong neighborhood, exactly like Hartom
      propertyType: "apartment",
      rooms: 4,
      areaSqm: 90,
      houseNumber: "30",
      streetName: targetStreet,
      // streetX/streetY are required for buildComparableDeals() to take the tier-aware
      // geographic branch at all (real requests always carry these once an address is
      // selected — confirmed via captured real payloads in Wave 0E-1A); the actual
      // per-deal x/y don't matter since same-street matches resolve via text first.
      streetX: 100000,
      streetY: 100000,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const top = outcome.valuation.comparableDeals[0];
    expect(top.houseNumber).toBe("30");
    expect(top.tier).toBe("building");
  });

  // ---------- TEST E — large neighborhood (Weizmann-equivalent) ----------
  it("ranks exact-building rows as building tier even when they occur after row 1000 in a >1000-row neighborhood (Weizmann scenario)", async () => {
    const rows = [];
    // 1100 filler deals on other house numbers, same neighborhood
    for (let i = 0; i < 1100; i++) {
      rows.push(
        makeDeal({
          id: `w${String(i).padStart(5, "0")}`,
          neighborhoodId: "W",
          street: "ויצמן",
          houseNumber: String(100 + (i % 20)), // never 92
          dealDate: "2026-01-01",
        }),
      );
    }
    // exact-building rows placed with ids that sort AFTER the filler (past the first 1000-row page)
    rows.push(
      makeDeal({ id: "w99991", neighborhoodId: "W", street: "ויצמן", houseNumber: "92", dealDate: "2023-11-21", rooms: 4, areaSqm: 107.3, price: 1800000 }),
      makeDeal({ id: "w99992", neighborhoodId: "W", street: "ויצמן", houseNumber: "92", dealDate: "2022-08-11", rooms: 3, areaSqm: 106, price: 2100000 }),
    );
    mockClient = makeSupabaseMock({ deals: rows });

    const { getStore } = await import("../store");
    const { resolveAndValuate } = await import("../valuationService");
    void getStore();

    const outcome = await resolveAndValuate({
      neighborhoodId: "W",
      propertyType: "apartment",
      rooms: 4,
      areaSqm: 107,
      houseNumber: "92",
      streetName: "ויצמן",
      streetX: 100000,
      streetY: 100000,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const top = outcome.valuation.comparableDeals[0];
    expect(top.houseNumber).toBe("92");
    expect(top.tier).toBe("building");
  });
});
