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
-- code (lib/store.ts client() uses SUPABASE_SERVICE_ROLE_KEY). The service role
-- BYPASSES RLS. Browsers/anon never talk to Supabase directly. Therefore RLS is
-- enabled with NO policies (deny-all to anon/authenticated), and leads (PII) also
-- has table privileges revoked from anon/authenticated as defense-in-depth.
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
-- Row Level Security — deny-all to anon/authenticated; service role bypasses RLS.
-- ---------------------------------------------------------------------------
alter table public.neighborhoods enable row level security;
alter table public.deals         enable row level security;
alter table public.leads         enable row level security;
-- No policies are created: with RLS enabled and no policy, anon/authenticated
-- get ZERO rows. The server (service role) bypasses RLS and performs all I/O.

-- Defense-in-depth for PII: strip table privileges from the Data API roles on
-- leads, so even an accidental future policy cannot expose lead PII.
revoke all on public.leads from anon, authenticated;

-- deals/neighborhoods are public-record data but are still only served through
-- the app's server-side /api routes (never a direct browser->Supabase read), so
-- no anon SELECT policy is granted. Least privilege.
-- ============================================================================
