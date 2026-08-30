-- Wednesday Launch Sprint L1 — isolated V2 preview tables.
-- Run this manually in Supabase Studio > SQL Editor. This session's REST-only
-- (service-role via @supabase/supabase-js) client cannot execute DDL — no
-- exec_sql RPC exists, information_schema/pg_catalog are not exposed via
-- PostgREST, and no direct Postgres connection string is configured in this
-- environment. This file is the exact, reviewed DDL needed to unblock L1's
-- next phase; it creates NEW tables only and never touches deals/
-- neighborhoods/leads.
--
-- Column shape for deals_v2_preview mirrors the LIVE production `deals`
-- table (19 columns, confirmed via a live read on 2026-08-31). This matches
-- supabase/bootstrap_v1.sql (the authoritative, already-committed source for
-- this shape, including "houseNumber") rather than the older, now-stale
-- supabase/schema.sql (18 columns — missing "houseNumber").
--
-- Access control mirrors bootstrap_v1.sql exactly: this project has
-- "Automatically expose new tables" = OFF, so service_role's BYPASSRLS does
-- NOT by itself grant table privileges on a newly created table — explicit
-- GRANTs are required below, or every future import write against these
-- tables will fail with a permissions error even though this same
-- service-role key can already read/write production deals/neighborhoods.

create table if not exists neighborhoods_v2_preview (
  id text primary key,
  name text not null,
  settlement text not null default 'נתניה',
  x double precision,
  y double precision
);

create table if not exists deals_v2_preview (
  id text primary key,
  "dealDate" date,
  price bigint,
  "propertyType" text default 'apartment',
  rooms numeric,
  "areaSqm" numeric,
  "plotSqm" numeric,
  floor int,
  "yearBuilt" int,
  "dealNature" text,
  address text,
  "houseNumber" text,
  street text,
  "neighborhoodId" text references neighborhoods_v2_preview(id),
  neighborhood text,
  settlement text default 'נתניה',
  x double precision,
  y double precision,
  "pricePerSqm" numeric
);
create index if not exists idx_deals_v2_preview_neigh on deals_v2_preview ("neighborhoodId");
create index if not exists idx_deals_v2_preview_date on deals_v2_preview ("dealDate");

-- RLS: same shape as the production tables — enabled, no policies, so
-- anon/authenticated get zero rows by default.
alter table neighborhoods_v2_preview enable row level security;
alter table deals_v2_preview enable row level security;

-- Explicit grants (bootstrap_v1.sql's pattern, required because "Automatically
-- expose new tables" is OFF on this project): REVOKE-FIRST then GRANT, so
-- service_role ends with exactly SELECT/INSERT/UPDATE — no DELETE, matching
-- the production SERVICE_ROLE_DELETE=NO posture — and anon/authenticated get
-- nothing.
revoke all on neighborhoods_v2_preview, deals_v2_preview from anon, authenticated;
revoke all privileges on table neighborhoods_v2_preview, deals_v2_preview from service_role;
grant select, insert, update on neighborhoods_v2_preview to service_role;
grant select, insert, update on deals_v2_preview to service_role;

-- Rollback (only ever needed if this preview effort is abandoned): these
-- tables are net-new and isolated, so rollback is a straight drop with zero
-- impact on production data.
-- drop table if exists deals_v2_preview;
-- drop table if exists neighborhoods_v2_preview;
