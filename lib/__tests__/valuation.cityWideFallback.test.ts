import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Wave 0F-2B regression guard: the city-wide street-name rescue in
 * lib/valuation.ts (the "שלב טקסטואלי עירוני" block) used to gate on
 * `geoPool.length < MIN_DEALS_FOR_ROOM_FILTER` — the raw size of the
 * RESOLVED (possibly wrong) neighborhood's pool — instead of whether any
 * RELEVANT (building/street) candidates were actually found there. A
 * populous-but-wrong neighborhood (proven real case: "עובד בן עמי" 45 —
 * neighborhoodId 66239231 has 500 unrelated deals, while all 65 real
 * Ben-Ami-street deals live under neighborhoodId 66239254) silently
 * suppressed the rescue even though it exists specifically to recover this
 * scenario (the same mechanism that already rescues Hartom).
 *
 * The fix reuses the EXISTING MIN_DEALS_FOR_ESTIMATE-based tier cascade
 * result (compSearchScope still being "neighborhood" at that point already
 * means every local text tier failed that threshold) instead of a second,
 * arbitrary pool-size threshold.
 *
 * These tests exercise the real resolveAndValuate() -> valuate() seam
 * against a mocked Supabase client, matching the pattern established in
 * lib/__tests__/store.supabaseComparables.test.ts.
 */

function makeSupabaseMock(tables: Record<string, any[]>, queryLog: { hadNeighborhoodIdFilter: boolean }[]) {
  return {
    from(table: string) {
      const rows: any[] = tables[table] ?? [];
      const state: {
        filters: Array<(r: any) => boolean>;
        hadNeighborhoodIdFilter: boolean;
        order: string | null;
        orderDesc: boolean;
        rangeStart: number | null;
        rangeEnd: number | null;
        limitN: number | null;
        maybeSingle: boolean;
      } = {
        filters: [],
        hadNeighborhoodIdFilter: false,
        order: null,
        orderDesc: false,
        rangeStart: null,
        rangeEnd: null,
        limitN: null,
        maybeSingle: false,
      };

      const builder: any = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          if (col === "neighborhoodId") state.hadNeighborhoodIdFilter = true;
          state.filters.push((r) => r[col] === val);
          return builder;
        },
        gte(col: string, val: string | number) {
          state.filters.push((r) => r[col] != null && r[col] >= val);
          return builder;
        },
        lt(col: string, val: string | number) {
          state.filters.push((r) => r[col] != null && r[col] < val);
          return builder;
        },
        // PostgREST ILIKE as SupabaseStore.getDealsByStreet uses it: "%text%", with \ escaping % _ \
        ilike(col: string, pattern: string) {
          const needle = pattern.slice(1, -1).replace(/\\(.)/g, "$1").toLowerCase();
          state.filters.push((r) => r[col] != null && String(r[col]).toLowerCase().includes(needle));
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
            // Only log bulk deal-listing queries (what getDealsByNeighborhood()/
            // getAllDeals() issue) — not the unrelated single-row dataAsOf()
            // lookup (.limit(1).maybeSingle()), which is pre-existing and
            // orthogonal to the city-wide rescue this suite is guarding.
            if (table === "deals" && !state.maybeSingle && state.limitN == null) {
              queryLog.push({ hadNeighborhoodIdFilter: state.hadNeighborhoodIdFilter });
            }
            let result = rows.filter((r) => state.filters.every((f) => f(r)));
            if (state.order) {
              const col = state.order;
              result = [...result].sort((a, b) => {
                if (a[col] < b[col]) return state.orderDesc ? 1 : -1;
                if (a[col] > b[col]) return state.orderDesc ? -1 : 1;
                return 0;
              });
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
    areaSqm: 100,
    plotSqm: null,
    floor: 3,
    yearBuilt: null,
    dealNature: "דירה בבית קומות",
    address: null,
    houseNumber: "1",
    street: "רחוב לא-רלוונטי",
    neighborhoodId: "A",
    neighborhood: "שכונה A",
    settlement: "נתניה",
    // Far outside BUILDING_RADIUS(60m)/STREET_RADIUS(350m) from the query's
    // streetX/streetY (100000,100000) in every test below — keeps the
    // geographic radius stage a no-op so these tests isolate the TEXTUAL
    // building/street/city-wide cascade under test, not geo-proximity.
    x: 900000,
    y: 900000,
    pricePerSqm: Math.round(2000000 / 100),
    ...overrides,
  };
}

let mockClient: ReturnType<typeof makeSupabaseMock>;
let queryLog: { hadNeighborhoodIdFilter: boolean }[];

// govmap geocoding is network — keep these tests offline and deterministic
vi.mock("@/lib/govmap", async (orig) => ({
  ...(await orig<typeof import("@/lib/govmap")>()),
  resolvePoint: async () => null,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => mockClient,
}));

describe("city-wide street fallback — relevant-candidate gate (Wave 0F-2B)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    queryLog = [];
    process.env.DATA_SOURCE = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ---------- TEST A — Ben Ami equivalent ----------
  it("recovers same-street deals from a populous but wrong neighborhood (Ben Ami scenario) — old geoPool<6 gate would have failed this", async () => {
    const rows: any[] = [];
    // Neighborhood A (resolved): populous (>6), zero deals on the target street.
    for (let i = 0; i < 10; i++) {
      rows.push(makeDeal({ id: `a${i}`, neighborhoodId: "A", street: "רחוב אחר לגמרי", houseNumber: String(1 + i) }));
    }
    // Neighborhood B: real target-street deals, none at the exact house number.
    for (let i = 0; i < 5; i++) {
      rows.push(
        makeDeal({
          id: `b${i}`,
          neighborhoodId: "B",
          street: "עובד בן עמי",
          houseNumber: String(2 + i * 2),
          dealDate: "2024-06-01",
        }),
      );
    }
    mockClient = makeSupabaseMock({ deals: rows }, queryLog);

    const { getStore } = await import("../store");
    const { resolveAndValuate } = await import("../valuationService");
    void getStore();

    const outcome = await resolveAndValuate({
      neighborhoodId: "A",
      propertyType: "apartment",
      rooms: 4,
      areaSqm: 100,
      houseNumber: "45",
      streetName: "עובד בן עמי",
      streetX: 100000,
      streetY: 100000,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.valuation.compSearchScope).toBe("street");
    expect(outcome.valuation.comparableDeals.every((c) => c.street === "עובד בן עמי")).toBe(true);
  });

  // ---------- TEST B — Hartom equivalent (still works) ----------
  it("still recovers an exact-building match from a different (small) neighborhood — no regression", async () => {
    const rows: any[] = [];
    // Neighborhood A (resolved): small pool, same-street but wrong house numbers —
    // deliberately BELOW MIN_DEALS_FOR_ESTIMATE(3) locally, so the local textual
    // cascade can't claim "street" tier on its own and mask the real building match.
    for (let i = 0; i < 2; i++) {
      rows.push(makeDeal({ id: `a${i}`, neighborhoodId: "A", street: "הרב שמואל הרטום", houseNumber: String(10 + i) }));
    }
    // Neighborhood B: exact building match.
    for (let i = 0; i < 3; i++) {
      rows.push(
        makeDeal({ id: `b${i}`, neighborhoodId: "B", street: "הרב שמואל הרטום", houseNumber: "30", dealDate: "2024-03-01" }),
      );
    }
    mockClient = makeSupabaseMock({ deals: rows }, queryLog);

    const { getStore } = await import("../store");
    const { resolveAndValuate } = await import("../valuationService");
    void getStore();

    const outcome = await resolveAndValuate({
      neighborhoodId: "A",
      propertyType: "apartment",
      rooms: 4,
      areaSqm: 100,
      houseNumber: "30",
      streetName: "הרב שמואל הרטום",
      streetX: 100000,
      streetY: 100000,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.valuation.compSearchScope).toBe("building");
    expect(outcome.valuation.comparableDeals[0].houseNumber).toBe("30");
  });

  // ---------- TEST C — normal healthy neighborhood: no city-wide scan ----------
  it("does NOT invoke the city-wide scan when the resolved neighborhood already has an exact-building match", async () => {
    const rows: any[] = [];
    // Neighborhood A directly contains an exact house-number match on the target
    // street — building tier succeeds purely from the local cascade. Using an
    // exact match (not just a street-tier match) also keeps the separate,
    // pre-existing "city-wide exact-building display augmentation" (lib/valuation.ts
    // ~line 419, unrelated to this wave's fallback-gate fix) from firing either,
    // giving a clean signal that isolates ONLY the fallback gate under test.
    for (let i = 0; i < 5; i++) {
      rows.push(
        makeDeal({ id: `a${i}`, neighborhoodId: "A", street: "רחוב הבדיקה", houseNumber: "1", dealDate: "2024-05-01" }),
      );
    }
    mockClient = makeSupabaseMock({ deals: rows }, queryLog);

    const { getStore } = await import("../store");
    const { resolveAndValuate } = await import("../valuationService");
    void getStore();

    const outcome = await resolveAndValuate({
      neighborhoodId: "A",
      propertyType: "apartment",
      rooms: 4,
      areaSqm: 100,
      houseNumber: "1",
      streetName: "רחוב הבדיקה",
      streetX: 100000,
      streetY: 100000,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.valuation.compSearchScope).toBe("building");
    // No bulk deals query should have been unscoped (neighborhoodId-filtered
    // only) — an unscoped one would mean the city-wide rescue/augmentation ran.
    expect(queryLog.length).toBeGreaterThan(0);
    expect(queryLog.every((q) => q.hadNeighborhoodIdFilter)).toBe(true);
  });

  // ---------- TEST D — thin relevant sample: existing MIN_DEALS_FOR_ESTIMATE rule, not a new threshold ----------
  it("widens city-wide when only 1-2 local street matches exist (below the existing MIN_DEALS_FOR_ESTIMATE=3), recovering enough via city-wide search", async () => {
    const rows: any[] = [];
    // Neighborhood A: populous, only 2 same-street matches locally (below 3).
    for (let i = 0; i < 8; i++) {
      rows.push(makeDeal({ id: `a-filler${i}`, neighborhoodId: "A", street: "רחוב שכיח", houseNumber: String(1 + i) }));
    }
    rows.push(makeDeal({ id: "a-target0", neighborhoodId: "A", street: "רחוב היעד", houseNumber: "50", dealDate: "2024-01-01" }));
    rows.push(makeDeal({ id: "a-target1", neighborhoodId: "A", street: "רחוב היעד", houseNumber: "52", dealDate: "2024-02-01" }));
    // Neighborhood B: one more same-street deal — combined city-wide total reaches 3.
    rows.push(makeDeal({ id: "b-target0", neighborhoodId: "B", street: "רחוב היעד", houseNumber: "60", dealDate: "2024-03-01" }));
    mockClient = makeSupabaseMock({ deals: rows }, queryLog);

    const { getStore } = await import("../store");
    const { resolveAndValuate } = await import("../valuationService");
    void getStore();

    const outcome = await resolveAndValuate({
      neighborhoodId: "A",
      propertyType: "apartment",
      rooms: 4,
      areaSqm: 100,
      houseNumber: "45",
      streetName: "רחוב היעד",
      streetX: 100000,
      streetY: 100000,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.valuation.compSearchScope).toBe("street");
    expect(outcome.valuation.comparableDeals.length).toBeGreaterThanOrEqual(3);
    expect(outcome.valuation.comparableDeals.every((c) => c.street === "רחוב היעד")).toBe(true);
  });

  // ---------- TEST E — no street data anywhere: no invented candidates ----------
  it("falls through truthfully to neighborhood tier when the target street has zero deals anywhere in the city", async () => {
    const rows: any[] = [];
    for (let i = 0; i < 8; i++) {
      rows.push(makeDeal({ id: `a${i}`, neighborhoodId: "A", street: "רחוב אחר", houseNumber: String(1 + i) }));
    }
    mockClient = makeSupabaseMock({ deals: rows }, queryLog);

    const { getStore } = await import("../store");
    const { resolveAndValuate } = await import("../valuationService");
    void getStore();

    const outcome = await resolveAndValuate({
      neighborhoodId: "A",
      propertyType: "apartment",
      rooms: 4,
      areaSqm: 100,
      houseNumber: "1",
      streetName: "רחוב שלא קיים באף עסקה",
      streetX: 100000,
      streetY: 100000,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.valuation.compSearchScope).toBe("neighborhood");
    expect(outcome.valuation.comparableDeals.every((c) => c.tier !== "building" && c.tier !== "street")).toBe(true);
  });
});
