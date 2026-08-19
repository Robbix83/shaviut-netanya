# 02 — SUPABASE REAL SCHEMA CONTRACT (Wave 0A-3) — HIGH PRIORITY

**Access:** No authorized read-only connection to the **live** Supabase DB (no service key, no MCP). Therefore the **production schema is UNKNOWN**. The only schema artifact in the repo is the committed **`supabase/schema.sql`** (intended schema). This document compares the **application's write expectation** against **`supabase/schema.sql`** and classifies each column. Production reality must be verified by the operator.

---

## 🔴 CRITICAL FINDING (CONDITIONAL) — `leads` table is missing columns the app writes

`SupabaseStore.insertLead` (`lib/store.ts`) does `sb.from("leads").insert(lead)` with the **entire `Lead` object**. The object built in `app/api/lead/route.ts` always sets 10 fields that **do not exist** in the committed `leads` table. PostgREST rejects inserts containing columns absent from the table schema (error `PGRST204`), which would make `insertLead` **throw → route returns 500 `save_failed` → the lead is lost.**

**If the production `leads` table matches `supabase/schema.sql` unchanged, the production lead pipeline is broken (every submission fails).** This is **CONDITIONAL** because the operator may have altered the production table; it cannot be confirmed without DB access.

### `leads` column comparison (app writes vs committed schema.sql)
| Column app writes | In schema.sql `leads`? | Verdict |
|-------------------|------------------------|---------|
| name, phone, email, address, neighborhood | ✅ | MATCH |
| propertyType, rooms, areaSqm, plotSqm | ✅ | MATCH |
| estimateLow, estimateHigh | ✅ (bigint) | MATCH |
| source, consent, status, id, createdAt | ✅ | MATCH |
| **floor** | ❌ | **MISSING_COLUMN** |
| **houseNumber** | ❌ | **MISSING_COLUMN** |
| **yearBuilt** | ❌ (not written by lead route, but in Lead type) | MISSING_COLUMN (unused on insert) |
| **sellTiming** | ❌ | **MISSING_COLUMN** |
| **consentReport** | ❌ | **MISSING_COLUMN** |
| **consentMarketing** | ❌ | **MISSING_COLUMN** |
| **consentWordingVersion** | ❌ | **MISSING_COLUMN** |
| **consentAt** | ❌ | **MISSING_COLUMN** |
| **optOutAt** | ❌ | **MISSING_COLUMN** |
| **alertOptIn** | ❌ | **MISSING_COLUMN** |
| **lastAlertAt** | ❌ | **MISSING_COLUMN** |
| **tabuStatus / tabuOrderedAt / tabuNotes** | ❌ | **MISSING_COLUMN** (written by `updateTabuStatus`) |

10 columns are written by `insertLead`; **all 10 are absent** from the committed table. `updateTabuStatus` writes 3 more absent columns → admin tabu updates would also fail against the committed schema.

---

## `deals` and `neighborhoods` (committed schema)
- **neighborhoods**: `id text pk, name text not null, settlement text default 'נתניה', x/y double precision`. Matches app usage (`Neighborhood` type). MATCH.
- **deals**: `id text pk, dealDate date, price bigint, propertyType, rooms/areaSqm/plotSqm numeric, floor int, yearBuilt int, dealNature, address, street, neighborhoodId (fk→neighborhoods), neighborhood, settlement, x/y, pricePerSqm`. Matches `Deal` type. Indexes: `idx_deals_neigh(neighborhoodId)`, `idx_deals_date(dealDate)`. MATCH.

## Constraints / keys / RLS (from committed schema.sql)
| Item | Value |
|------|-------|
| PKs | `neighborhoods.id`, `deals.id` (text); `leads.id` (uuid, `gen_random_uuid()`) |
| FKs | `deals.neighborhoodId → neighborhoods.id` |
| Unique constraints | **NONE** on any table. **No phone uniqueness on `leads`.** |
| Indexes | `idx_deals_neigh`, `idx_deals_date` only (none on leads) |
| Defaults | `leads.createdAt = now()`, `leads.status = 'new'`, `leads.consent = false`, `leads.id = gen_random_uuid()` |
| RLS | **ENABLED** on all three tables; **no policies** defined → only the service role (server) can read/write; anon has no access. |
| created_at/updated_at | `createdAt` via `now()` default; **no `updated_at`**, no triggers. |

**Phone uniqueness:** does NOT exist in the committed schema. (Wave 1 must NOT assume it should — see `06_WAVE1_DECISION.md`.)

---

## Overall schema verdict
| Table | Verdict |
|-------|---------|
| neighborhoods | MATCH (committed schema) |
| deals | MATCH (committed schema) |
| **leads** | **MISMATCH — 10+ MISSING_COLUMN** vs app writes (CONDITIONAL P0 if prod == committed schema) |
| Production reality (all tables) | **UNKNOWN** — no live DB access |

**Operator action (read-only):** in Supabase → Table editor / SQL, confirm the production `leads` table actually contains `floor, houseNumber, sellTiming, consentReport, consentMarketing, consentWordingVersion, consentAt, optOutAt, alertOptIn, lastAlertAt, tabuStatus, tabuOrderedAt, tabuNotes`. If any are missing, lead inserts are failing in production. **Do not add columns as part of this wave** — this is a report, not a migration.
