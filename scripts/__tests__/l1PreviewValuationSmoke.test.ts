/**
 * Wednesday Launch Sprint L1 — live valuation/comparable-selection smoke
 * test against the real, imported V2 preview tables (deals_v2_preview /
 * neighborhoods_v2_preview), not fixture data.
 *
 * Approach: the REAL, unmodified lib/store.ts (SupabaseStore) and
 * lib/valuation.ts / lib/valuationService.ts are exercised exactly as
 * committed — no application code is changed for this test. Only the
 * low-level `@supabase/supabase-js` `createClient` is wrapped so that
 * `.from("deals")` / `.from("neighborhoods")` transparently redirect to
 * the `_v2_preview` tables; every other call passes straight through to a
 * real, live Supabase client. This mirrors the existing mocking pattern
 * in lib/__tests__/store.supabaseComparables.test.ts, but against a real
 * network connection and real imported data instead of an in-memory fixture.
 *
 * SKIPPED BY DEFAULT — requires live Supabase credentials and a populated
 * preview import; must not run in normal `npx vitest run` (no credentials
 * assumed, no live-DB dependency for the standard suite). Opt in with:
 *   L1_PREVIEW_SMOKE=1 npx vitest run scripts/__tests__/l1PreviewValuationSmoke.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const RUN = process.env.L1_PREVIEW_SMOKE === "1";

function loadEnvLocal() {
  const content = readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

vi.mock("@supabase/supabase-js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/supabase-js")>();
  const TABLE_MAP: Record<string, string> = {
    deals: "deals_v2_preview",
    neighborhoods: "neighborhoods_v2_preview",
  };
  return {
    ...actual,
    createClient: (url: string, key: string, opts?: unknown) => {
      const real = actual.createClient(url, key, opts as any);
      return new Proxy(real, {
        get(target, prop, receiver) {
          if (prop === "from") {
            return (table: string) => (target as any).from(TABLE_MAP[table] ?? table);
          }
          return Reflect.get(target, prop, receiver);
        },
      });
    },
  };
});

describe.skipIf(!RUN)("L1 preview-table valuation smoke (live, real V2 data)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    const env = loadEnvLocal();
    process.env.DATA_SOURCE = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("getStats() reports the full imported preview counts", async () => {
    const { getStore } = await import("../../lib/store");
    const stats = await getStore().getStats();
    expect(stats.dealCount).toBe(59305);
    expect(stats.neighborhoodCount).toBeGreaterThan(0);
  }, 30000); // ~60 paginated round-trips over a real network connection — vitest's 5s default is a test-harness limit, not a functional issue (independently verified via a standalone script first)

  it("getAllDeals() exhaustively paginates past 1000 rows against the real preview table", async () => {
    const { getStore } = await import("../../lib/store");
    const all = await getStore().getAllDeals();
    expect(all.length).toBe(59305);
    // full projection, not a narrow one (Wave 0E-1B regression class)
    expect(all[0]).toHaveProperty("street");
    expect(all[0]).toHaveProperty("houseNumber");
  }, 30000);

  it("getDealsByNeighborhood() returns rows for a real, high-volume V2 entity (מרכז העיר, 65209717)", async () => {
    const { getStore } = await import("../../lib/store");
    const rows = await getStore().getDealsByNeighborhood("65209717");
    expect(rows.length).toBeGreaterThan(1000); // exercises pagination past PostgREST's page cap
  });

  it("listNeighborhoods()/getNeighborhood() see all 38 imported V2 entities", async () => {
    const { getStore } = await import("../../lib/store");
    const list = await getStore().listNeighborhoods("נתניה");
    expect(list.length).toBe(38);
    const one = await getStore().getNeighborhood("65209683"); // קריית השרון
    expect(one?.name).toBe("קריית השרון");
  });

  it("resolveAndValuate() runs the real comparable-selection/valuation algorithm end-to-end against live preview data (real building case: הבשן 1, קריית השרון)", async () => {
    const { resolveAndValuate } = await import("../../lib/valuationService");
    const outcome = await resolveAndValuate({
      neighborhoodId: "65209683",
      propertyType: "apartment",
      rooms: 4,
      areaSqm: 91.5,
      houseNumber: "1",
      streetName: "הבשן",
      streetX: 185000,
      streetY: 690000,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.valuation.comparableDeals.length).toBeGreaterThan(0);
    expect(outcome.valuation.estimateLow).toBeGreaterThan(0);
    expect(outcome.valuation.estimateHigh).toBeGreaterThanOrEqual(outcome.valuation.estimateLow);
  });
});
