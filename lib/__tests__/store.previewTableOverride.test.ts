import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Wave 0G-L2: regression coverage for SupabaseStore's PREVIEW_TABLES
 * override (lib/store.ts's private `table()` helper). Off by default —
 * every existing call site must be unaffected unless the flag is
 * explicitly set. Leads must NEVER be redirected, regardless of the flag,
 * per this wave's explicit lead-safety requirement (acceptance testing
 * exercises deals/neighborhoods, never lead capture's data sink).
 */

const calledTables: string[] = [];

function makeTrackingMock() {
  return {
    from(table: string) {
      calledTables.push(table);
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        range: () => builder,
        limit: () => builder,
        not: () => builder,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: (v: any) => void) => resolve({ data: [], error: null, count: 0 }),
      };
      return builder;
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => makeTrackingMock(),
}));

describe("SupabaseStore PREVIEW_TABLES override (Wave 0G-L2)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    calledTables.length = 0;
    process.env.DATA_SOURCE = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("defaults to the real 'deals'/'neighborhoods' tables when PREVIEW_TABLES is unset", async () => {
    delete process.env.PREVIEW_TABLES;
    const { getStore } = await import("../store");
    await getStore().getAllDeals();
    await getStore().listNeighborhoods("נתניה");
    expect(calledTables).toContain("deals");
    expect(calledTables).toContain("neighborhoods");
    expect(calledTables).not.toContain("deals_v2_preview");
    expect(calledTables).not.toContain("neighborhoods_v2_preview");
  });

  it("redirects to the _v2_preview tables when PREVIEW_TABLES=1", async () => {
    process.env.PREVIEW_TABLES = "1";
    const { getStore } = await import("../store");
    await getStore().getAllDeals();
    await getStore().listNeighborhoods("נתניה");
    expect(calledTables).toContain("deals_v2_preview");
    expect(calledTables).toContain("neighborhoods_v2_preview");
    expect(calledTables).not.toContain("deals");
    expect(calledTables).not.toContain("neighborhoods");
  });

  it("NEVER redirects leads, even with PREVIEW_TABLES=1 (explicit lead-safety requirement)", async () => {
    process.env.PREVIEW_TABLES = "1";
    const { getStore } = await import("../store");
    await getStore().countLeads();
    expect(calledTables).toContain("leads");
    expect(calledTables).not.toContain("leads_v2_preview");
  });

  it("refuses to start with PREVIEW_TABLES=1 in a production NODE_ENV (fail loud, not silent)", async () => {
    process.env.PREVIEW_TABLES = "1";
    (process.env as Record<string, string>).NODE_ENV = "production";
    const { getStore } = await import("../store");
    await expect(getStore().getAllDeals()).rejects.toThrow(/PREVIEW_TABLES=1 is set in a production environment/);
  });
});
