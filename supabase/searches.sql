-- חיפושי שווי: כל בדיקה באתר, גם בלי השארת פרטים. בלי שם, טלפון או IP.
create table if not exists searches (
  id            bigint generated always as identity primary key,
  "createdAt"   timestamptz not null default now(),
  source        text,
  "propertyType" text,
  street        text,
  "houseNumber" text,
  neighborhood  text,
  rooms         numeric,
  "areaSqm"     numeric,
  "plotSqm"     numeric,
  floor         integer,
  "yearBuilt"   integer,
  outcome       text not null,          -- ok | no_match | insufficient_data | house_number_required
  "estimateLow"  bigint,
  "estimateHigh" bigint,
  confidence    text,
  "basedOnDeals" integer
);
create index if not exists searches_created_idx on searches ("createdAt" desc);
-- רק ה-service role (השרת) ניגש. אין policy ציבורית.
alter table searches enable row level security;
