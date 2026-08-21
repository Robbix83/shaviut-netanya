import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Static guard: the bootstrap SQL must contain every column the application
// persists/reads/updates via SupabaseStore (camelCase, quoted). Prevents the
// Wave 0A-3 class of bug (schema missing app-written columns) from recurring.

const sql = readFileSync(path.resolve(__dirname, "../../supabase/bootstrap_v1.sql"), "utf8");
// SQL with `--` line comments stripped, for assertions about actual statements
// (comments legitimately mention things like "UNIQUE(phone)" while explaining why NOT to use them).
const sqlNoComments = sql
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");

/** columns the app writes/reads on `leads` (from lead route insert + store updates + Lead type) */
const LEADS_COLUMNS = [
  "id", "createdAt", "name", "phone", "email", "address", "neighborhood",
  "propertyType", "rooms", "areaSqm", "plotSqm", "floor", "houseNumber",
  "estimateLow", "estimateHigh", "source", "consent", "sellTiming",
  "consentReport", "consentMarketing", "consentWordingVersion", "consentAt",
  "optOutAt", "alertOptIn", "lastAlertAt", "status",
  "tabuStatus", "tabuOrderedAt", "tabuNotes",
];

/** columns the app reads/filters on `deals` (Deal type + SupabaseStore selects/filters) */
const DEALS_COLUMNS = [
  "id", "dealDate", "price", "propertyType", "rooms", "areaSqm", "plotSqm",
  "floor", "yearBuilt", "dealNature", "address", "houseNumber", "street",
  "neighborhoodId", "neighborhood", "settlement", "x", "y", "pricePerSqm",
];

const NEIGHBORHOODS_COLUMNS = ["id", "name", "settlement", "x", "y"];

/** Extract the column block for a given table from the bootstrap SQL. */
function tableBlock(table: string): string {
  const m = sql.match(new RegExp(`create table public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, "i"));
  if (!m) throw new Error(`table ${table} not found in bootstrap SQL`);
  return m[1];
}

/** A column is present if its name appears either quoted ("col") or bare (col) as an identifier. */
function hasColumn(block: string, col: string): boolean {
  const quoted = new RegExp(`"${col}"`);
  const bare = new RegExp(`(^|\\n)\\s*${col}\\s`, "m");
  return quoted.test(block) || bare.test(block);
}

describe("bootstrap_v1.sql covers the application data contract", () => {
  it("leads has all 29 app-written columns", () => {
    const block = tableBlock("leads");
    const missing = LEADS_COLUMNS.filter((c) => !hasColumn(block, c));
    expect(missing).toEqual([]);
    expect(LEADS_COLUMNS.length).toBe(29);
  });

  it("deals has all app columns including houseNumber (which the old schema lacked)", () => {
    const block = tableBlock("deals");
    const missing = DEALS_COLUMNS.filter((c) => !hasColumn(block, c));
    expect(missing).toEqual([]);
    expect(hasColumn(block, "houseNumber")).toBe(true);
  });

  it("neighborhoods has all app columns", () => {
    const block = tableBlock("neighborhoods");
    const missing = NEIGHBORHOODS_COLUMNS.filter((c) => !hasColumn(block, c));
    expect(missing).toEqual([]);
  });

  it("uses camelCase (quoted) column names, not snake_case", () => {
    expect(sql).toContain(`"neighborhoodId"`);
    expect(sql).toContain(`"createdAt"`);
    expect(sql).toContain(`"estimateLow"`);
    expect(sql).not.toMatch(/neighborhood_id|created_at|estimate_low/);
  });

  it("enables RLS on all three tables and does NOT create UNIQUE(phone)", () => {
    expect(sql).toMatch(/alter table public\.leads\s+enable row level security/i);
    expect(sql).toMatch(/alter table public\.deals\s+enable row level security/i);
    expect(sql).toMatch(/alter table public\.neighborhoods\s+enable row level security/i);
    // no actual UNIQUE(phone) constraint in real statements (comments may mention it)
    expect(sqlNoComments.toLowerCase()).not.toMatch(/unique\s*\(\s*phone/);
  });

  it("revokes table privileges from anon/authenticated on ALL three tables", () => {
    expect(sql).toMatch(/revoke all on public\.neighborhoods\s+from anon, authenticated/i);
    expect(sql).toMatch(/revoke all on public\.deals\s+from anon, authenticated/i);
    expect(sql).toMatch(/revoke all on public\.leads\s+from anon, authenticated/i);
  });

  it("grants explicit service_role privileges (auto-expose OFF): USAGE + SELECT/INSERT/UPDATE, no DELETE", () => {
    expect(sql).toMatch(/grant usage on schema public to service_role/i);
    for (const t of ["neighborhoods", "deals", "leads"]) {
      expect(sql).toMatch(new RegExp(`grant select, insert, update on public\\.${t}\\s+to service_role`, "i"));
    }
    // never grant DELETE (the Store never deletes) and never grant to anon/authenticated
    expect(sqlNoComments.toLowerCase()).not.toMatch(/grant[^;]*delete/);
    expect(sqlNoComments.toLowerCase()).not.toMatch(/grant[^;]*to\s+(anon|authenticated)/);
  });
});
