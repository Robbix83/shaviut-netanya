-- ============================================================================
-- shaviut-netanya — Supabase BOOTSTRAP schema v1
-- Derived from CURRENT application code at HEAD (Wave 0B-1). One-time bootstrap
-- for a BRAND-NEW, EMPTY Supabase project. NOT executed by this wave.
--
-- Naming: the application (lib/store.ts SupabaseStore) sends/selects/filters
-- using camelCase keys (e.g. "neighborhoodId", "dealDate", "createdAt",
-- "optOutAt", "consentMarketing"). PostgreSQL folds unquoted identifiers to
-- lowercase, so every camelCase column MUST be quoted here and forever. No
-- snake_case mapper is introduced (would require an app refactor).
--
-- Access model: the app connects ONLY with the service role from server-side
-- code (lib/store.ts client() uses SUPABASE_SERVICE_ROLE_KEY). Browsers/anon
-- never talk to Supabase directly. RLS is enabled with NO policies (deny-all to
-- anon/authenticated). NOTE: this project has "Automatically expose new tables"
-- = OFF, so new public tables receive NO implicit Data API grants — and
-- service_role's BYPASSRLS does NOT confer PostgreSQL *table privileges*.
-- Therefore this bootstrap grants table privileges to service_role EXPLICITLY
-- (SELECT/INSERT/UPDATE, no DELETE) and revokes all table privileges from
-- anon/authenticated on every table (least privilege + PII defense-in-depth).
--
-- Run order note: create neighborhoods before deals (deals.neighborhoodId FK).
-- gen_random_uuid() is built into PostgreSQL 13+ (Supabase) — no extension needed.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- neighborhoods  (5 columns) — the geographic unit valuation is computed on
-- ---------------------------------------------------------------------------
create table public.neighborhoods (
  id           text primary key,                       -- Neighborhood.id (nadlan UNIQ_ID)
  name         text not null,                           -- Neighborhood.name
  settlement   text not null default 'נתניה',           -- listNeighborhoods filters by settlement
  x            double precision,                        -- ITM easting (nullable — some lack coords)
  y            double precision                         -- ITM northing
);

-- ---------------------------------------------------------------------------
-- deals  (19 columns) — normalized real-estate transactions (rashut hamisim)
--   NOTE vs old schema.sql: adds "houseNumber" (present in Deal type + used by
--   building-level comparable matching in lib/valuation.ts).
-- ---------------------------------------------------------------------------
create table public.deals (
  id             text primary key,                      -- Deal.id (composite stable id)
  "dealDate"     date,                                  -- filtered (gte) + ordered (desc) by store
  price          bigint,                                -- Deal.price (shekels)
  "propertyType" text default 'apartment',              -- apartment|house|land
  rooms          numeric,                               -- filtered (gte/lte) by store; may be fractional
  "areaSqm"      numeric,                               -- built area
  "plotSqm"      numeric,                               -- plot area (house/land)
  floor          int,
  "yearBuilt"    int,
  "dealNature"   text,                                  -- e.g. "דירה בבית קומות"
  address        text,
  "houseNumber"  text,                                  -- building-level matching (added vs old schema)
  street         text,
  "neighborhoodId" text references public.neighborhoods(id),  -- eq-filtered by store
  neighborhood   text,
  settlement     text default 'נתניה',
  x              double precision,                      -- ITM
  y              double precision,
  "pricePerSqm"  numeric
);
create index idx_deals_neighborhoodId on public.deals ("neighborhoodId"); -- getDealsByNeighborhood / getStats
create index idx_deals_dealDate       on public.deals ("dealDate");        -- monthsBack filter + dataAsOf order

-- ---------------------------------------------------------------------------
-- leads  (29 columns) — captured seller leads (PERSONAL DATA)
--   Complete field set derived from: app/api/lead/route.ts (insert),
--   lib/store.ts (updateLeadStatus / updateTabuStatus / optOutByPhone),
--   lib/alerts.ts (alertOptIn / lastAlertAt / optOutAt), admin PATCH route,
--   and the Lead interface in lib/types.ts.
--   (Lead has NO yearBuilt field — intentionally omitted; it exists only on Deal.)
-- ---------------------------------------------------------------------------
create table public.leads (
  id                     uuid primary key default gen_random_uuid(),  -- SupabaseStore relies on DB default
  "createdAt"            timestamptz default now(),                   -- ordered (desc) by getLeads
  name                   text not null,
  phone                  text not null,                               -- matched by optOutByPhone (NOT unique)
  email                  text,
  address                text,
  neighborhood           text,
  "propertyType"         text default 'apartment',
  rooms                  numeric,
  "areaSqm"              numeric,
  "plotSqm"              numeric,
  floor                  int,
  "houseNumber"          text,
  "estimateLow"          bigint,                                      -- server-computed valuation (nullable: Option B)
  "estimateHigh"         bigint,
  source                 text,                                        -- utm/campaign free text
  consent                boolean default false,                       -- app sets true (= consentReport, legacy)
  "sellTiming"           text,                                        -- now|year|curious
  "consentReport"        boolean default false,
  "consentMarketing"     boolean default false,                      -- cleared by optOutByPhone
  "consentWordingVersion" text,
  "consentAt"            timestamptz,
  "optOutAt"             timestamptz,                                 -- set by optOutByPhone / opt-out webhook
  "alertOptIn"           boolean default false,                      -- lib/alerts.ts market alerts
  "lastAlertAt"          timestamptz,                                 -- lib/alerts.ts dedup
  status                 text default 'new',                         -- new|contacted|in_progress|closed|not_relevant
  "tabuStatus"           text,                                        -- pending|ordered|clean|needs_review
  "tabuOrderedAt"        timestamptz,                                 -- set when tabuStatus -> ordered
  "tabuNotes"            text
);
create index idx_leads_createdAt on public.leads ("createdAt"); -- getLeads orders by createdAt desc (every admin load)
create index idx_leads_phone     on public.leads (phone);       -- optOutByPhone lookup
-- (No index on status: low cardinality on a small, slow-growing table — not justified.)
-- (No UNIQUE(phone): one person may legitimately submit multiple valuations over time.)

-- ---------------------------------------------------------------------------
-- Access control — RLS deny-all to anon/authenticated; explicit service_role grants.
-- (Required because "Automatically expose new tables" is OFF: no implicit grants,
--  and service_role BYPASSRLS does not confer table privileges.)
-- ---------------------------------------------------------------------------

-- 1) RLS enabled on all three tables. No policies are created → anon/authenticated
--    get ZERO rows. The server (service_role) bypasses RLS for all I/O.
alter table public.neighborhoods enable row level security;
alter table public.deals         enable row level security;
alter table public.leads         enable row level security;

-- 2) anon/authenticated receive NO direct table privileges on any table
--    (least privilege; PII defense-in-depth so a future accidental policy still
--     cannot expose rows without a grant). No anon/authenticated policies exist.
revoke all on public.neighborhoods from anon, authenticated;
revoke all on public.deals         from anon, authenticated;
revoke all on public.leads         from anon, authenticated;

-- 3) service_role receives EXPLICIT table privileges (SELECT/INSERT/UPDATE only —
--    the Store never deletes: no DELETE granted). USAGE on schema public so the
--    role can reach the tables when auto-expose is off.
grant usage on schema public to service_role;
grant select, insert, update on public.neighborhoods to service_role;
grant select, insert, update on public.deals         to service_role;
grant select, insert, update on public.leads         to service_role;
-- ============================================================================
