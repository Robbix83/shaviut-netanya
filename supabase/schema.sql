-- סכמת Supabase למערכת שווי דירה נתניה
-- הריצו ב-Supabase Studio > SQL Editor

-- שכונות
create table if not exists neighborhoods (
  id text primary key,
  name text not null,
  settlement text not null default 'נתניה',
  x double precision,
  y double precision
);

-- עסקאות (מנורמלות ממאגר רשות המסים)
create table if not exists deals (
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
  street text,
  "neighborhoodId" text references neighborhoods(id),
  neighborhood text,
  settlement text default 'נתניה',
  x double precision,
  y double precision,
  "pricePerSqm" numeric
);
create index if not exists idx_deals_neigh on deals ("neighborhoodId");
create index if not exists idx_deals_date on deals ("dealDate");

-- לידים
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  "createdAt" timestamptz default now(),
  name text not null,
  phone text not null,
  email text,
  address text,
  neighborhood text,
  "propertyType" text default 'apartment',
  rooms numeric,
  "areaSqm" numeric,
  "plotSqm" numeric,
  "estimateLow" bigint,
  "estimateHigh" bigint,
  source text,
  consent boolean default false,
  status text default 'new'
);

-- RLS: גישת קריאה/כתיבה רק דרך service role (מהשרת). אין גישה אנונימית.
alter table neighborhoods enable row level security;
alter table deals enable row level security;
alter table leads enable row level security;
-- (service role עוקף RLS אוטומטית — אין צורך ב-policies לגישת השרת)
