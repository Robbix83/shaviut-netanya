# SUPABASE SCHEMA CONTRACT (Wave 0B-1)

**Bootstrap SQL:** `supabase/bootstrap_v1.sql` · **Mode:** schema generation only, **not executed**.
**Source of truth:** current HEAD code (`lib/types.ts`, `lib/store.ts` SupabaseStore, `app/api/lead/route.ts`, `app/api/admin/leads/**`, `app/api/webhook/green`, `lib/alerts.ts`, `lib/notify.ts`, `lib/valuation.ts`, `lib/valuationService.ts`).

## Naming convention — camelCase (quoted), verified
SupabaseStore filters/selects/inserts with camelCase keys: `.eq("neighborhoodId")`, `.gte("dealDate")`, `.order("createdAt")`, `.update({optOutAt, consentMarketing})`, `insert(lead)` (camelCase Lead keys). PostgreSQL lowercases unquoted identifiers, so **every camelCase column is quoted** in the bootstrap. **No snake_case mapper** is introduced (would require an app refactor — out of scope).

---

## `public.neighborhoods` (5 columns)
| Column | PG type | Null | Default | PK/Index | Callers | Rationale |
|--------|---------|------|---------|----------|---------|-----------|
| id | text | no | — | **PK** | getNeighborhood/listNeighborhoods; deals FK | nadlan UNIQ_ID |
| name | text | no | — | — | listNeighborhoods (order), valuation display | required |
| settlement | text | no | `'נתניה'` | — | listNeighborhoods `.eq("settlement")` | filter |
| x | double precision | yes | — | — | address resolution (itmDistance) | ITM easting; some null |
| y | double precision | yes | — | — | address resolution | ITM northing |

No index: 21 rows, `.eq("settlement")` scan is trivial.

## `public.deals` (19 columns)
| Column | PG type | Null | Default | PK/Index | Callers | Rationale |
|--------|---------|------|---------|----------|---------|-----------|
| id | text | no | — | **PK** | — | composite stable id |
| "dealDate" | date | yes | — | **idx** | `.gte` (monthsBack), `.order desc` (dataAsOf) | time filter/order |
| price | bigint | yes | — | — | valuation | shekels |
| "propertyType" | text | yes | `'apartment'` | — | valuation | apartment/house/land |
| rooms | numeric | yes | — | — | `.gte/.lte` rooms; valuation | fractional allowed |
| "areaSqm" | numeric | yes | — | — | valuation | built area |
| "plotSqm" | numeric | yes | — | — | valuation (composite) | plot area |
| floor | int | yes | — | — | valuation (floor ±2) | |
| "yearBuilt" | int | yes | — | — | valuation (age filter) | |
| "dealNature" | text | yes | — | — | valuation/display | |
| address | text | yes | — | — | display | |
| **"houseNumber"** | text | yes | — | — | **valuation building match**; ComparableDeal | **ADDED vs old schema** |
| street | text | yes | — | — | valuation street match; display | |
| "neighborhoodId" | text | yes | — | **idx**, FK→neighborhoods | `.eq` (getDealsByNeighborhood/getStats) | primary filter |
| neighborhood | text | yes | — | — | alerts match; display | |
| settlement | text | yes | `'נתניה'` | — | — | |
| x | double precision | yes | — | — | geo comp radius | ITM |
| y | double precision | yes | — | — | geo comp radius | ITM |
| "pricePerSqm" | numeric | yes | — | — | valuation | derived |

Indexes: `idx_deals_neighborhoodId`, `idx_deals_dealDate` (both directly back store query paths).

## `public.leads` (29 columns)
| Column | PG type | Null | Default | PK/Index | Callers | Rationale |
|--------|---------|------|---------|----------|---------|-----------|
| id | uuid | no | `gen_random_uuid()` | **PK** | insert relies on DB default; update `.eq("id")` | |
| "createdAt" | timestamptz | yes | `now()` | **idx** | getLeads `.order desc`; sheet | every admin load |
| name | text | **no** | — | — | insert; notify | validated ≥2 |
| phone | text | **no** | — | **idx** | insert; optOutByPhone match | NOT unique |
| email | text | yes | — | — | insert; sheet | |
| address | text | yes | — | — | insert; notify | |
| neighborhood | text | yes | — | — | insert (server-authoritative); alerts | |
| "propertyType" | text | yes | `'apartment'` | — | insert; alerts | |
| rooms | numeric | yes | — | — | insert; alerts (±1) | |
| "areaSqm" | numeric | yes | — | — | insert; notify | |
| "plotSqm" | numeric | yes | — | — | insert | |
| floor | int | yes | — | — | insert | |
| "houseNumber" | text | yes | — | — | insert | |
| "estimateLow" | bigint | yes | — | — | insert (server-computed); sheet | null on Option B |
| "estimateHigh" | bigint | yes | — | — | insert; sheet | |
| source | text | yes | — | — | insert; sheet | utm/campaign |
| consent | boolean | yes | `false` | — | insert (=true) | legacy = consentReport |
| "sellTiming" | text | yes | — | — | insert; notify (hot lead) | now/year/curious |
| "consentReport" | boolean | yes | `false` | — | insert (=true) | legal (required) |
| "consentMarketing" | boolean | yes | `false` | — | insert; optOutByPhone (→false) | legal (optional) |
| "consentWordingVersion" | text | yes | — | — | insert | legal audit |
| "consentAt" | timestamptz | yes | — | — | insert | legal timestamp |
| "optOutAt" | timestamptz | yes | — | — | optOutByPhone/opt-out webhook; alerts skip | spam law |
| "alertOptIn" | boolean | yes | `false` | — | insert; alerts eligibility | market alerts |
| "lastAlertAt" | timestamptz | yes | — | — | alerts dedup (send-alerts writes) | |
| status | text | yes | `'new'` | — | getLeads `.eq`; updateLeadStatus; admin PATCH | new/contacted/… |
| "tabuStatus" | text | yes | — | — | updateTabuStatus; admin PATCH | pending/ordered/clean/needs_review |
| "tabuOrderedAt" | timestamptz | yes | — | — | updateTabuStatus (on 'ordered') | |
| "tabuNotes" | text | yes | — | — | updateTabuStatus; admin PATCH | broker notes |

Indexes: `idx_leads_createdAt` (ordering), `idx_leads_phone` (opt-out lookup). **No `status` index** (low cardinality, small/slow table). **No `UNIQUE(phone)`** (one person → multiple valuations over time).

> **Lead has NO `yearBuilt`** — the Wave prompt listed it "where applicable", but source shows `yearBuilt` exists only on `Deal`/`PropertyInput`, not `Lead`. Intentionally omitted from `leads`.

---

## RLS / grants (least privilege)
- RLS **enabled** on all three tables; **no policies** → anon/authenticated get zero rows. The server uses the **service role** (bypasses RLS) for all I/O (`SupabaseStore.client()` → `SUPABASE_SERVICE_ROLE_KEY`).
- `revoke all on public.leads from anon, authenticated` — defense-in-depth so lead **PII** cannot leak even via a future accidental policy.
- deals/neighborhoods: no anon policies — served only through server `/api` routes, never a direct browser→Supabase read. Least privilege.

## Constraints
- PKs: `leads.id` (uuid), `deals.id` (text), `neighborhoods.id` (text).
- FK: `deals.neighborhoodId → neighborhoods.id` (load neighborhoods first).
- **No** UNIQUE(phone). **No** invented deal-dedup uniqueness (would risk rejecting legitimate same-building/same-day transactions — see Wave 0R `23_DUPLICATE_IDENTITY`).

## Differences vs old `supabase/schema.sql`
1. **leads: +13 columns** the app writes but the old schema lacked — `floor, houseNumber, sellTiming, consentReport, consentMarketing, consentWordingVersion, consentAt, optOutAt, alertOptIn, lastAlertAt, tabuStatus, tabuOrderedAt, tabuNotes`. (Root cause of the Wave 0A-3 CONDITIONAL P0.)
2. **deals: +`houseNumber`** (present in `Deal` type + used by building-level comparable matching; absent from old schema).
3. **leads indexes:** old schema had none; bootstrap adds `createdAt` + `phone` (evidence-backed).
4. **PII hardening:** explicit `revoke` on leads for anon/authenticated (old schema relied on RLS-no-policy only).
5. Everything else (neighborhoods, deals base columns, RLS-enabled, camelCase, `gen_random_uuid`, `now()` defaults) matches the old schema's intent.

## Validation
`lib/__tests__/schema-contract.test.ts` statically asserts the bootstrap contains all 29 lead columns, all 19 deal columns (incl. `houseNumber`), all 5 neighborhood columns, camelCase quoting (no snake_case), RLS on all tables, no `UNIQUE(phone)`, and the leads privilege revoke. `npm test` 57 passed, `tsc` clean, `next build` exit 0, `valuation.ts` byte-identical. No application behavior changed.
