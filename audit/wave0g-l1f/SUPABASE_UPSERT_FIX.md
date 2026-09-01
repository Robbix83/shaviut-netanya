# Wave 0G-L1F — Fix `scripts/harvest.ts`'s Supabase upsert blindness

**Verdict: DONE**, with one behavior loss and one pre-existing gap
explicitly disclosed below (not silently fixed away). Verified with a
live, read-only call against the real Supabase project (immediately
deleted after use) — zero writes anywhere this session. `data/deals.json`
unchanged.

## The problem (from `audit/wave0g-l1e/HARVEST_MERGE_FIX.md`)

Wave 0G-L1E fixed the LOCAL-JSON incremental merge to recognize an
already-stored transaction even after Wave 0G-L1D changed the `Deal.id`
formula. It explicitly disclosed the same blindness applied to the
Supabase upsert path: `existingDeals` was only ever loaded from
`data/deals.json`, never from Supabase, so `DATA_SOURCE=supabase` runs
(both full and incremental) had zero visibility into what the live
`deals` table already contains — a re-harvested transaction would be
upserted as a genuine duplicate row.

## Fix

`scripts/harvest.ts`:
- New exported `loadExistingDealsFromSupabase(sb)` — a read-only,
  paginated (1000-row pages) `select("*")` of the entire `deals` table,
  mirroring `lib/store.ts`'s `SupabaseStore.getAllDeals()` pagination
  pattern for this exact table.
- The Supabase client and this read now happen **before** the scrape loop
  starts (moved from after `browser.close()`), for both a full citywide
  run and an incremental `HARVEST_ONLY` run — a full run's exposure was
  actually larger, since every neighborhood's already-stored transactions
  would get a duplicate upserted.
- The result feeds the same `mergeIncrementalDeals()` from Wave 0G-L1E.
  The upsert now pushes only `added` (the rows the merge actually
  identified as new) instead of re-pushing the full merged set.
- `mergeIncrementalDeals()`'s return type gained an explicit `added: Deal[]`
  field (previously only `addedCount`) so the caller doesn't need to infer
  which rows were added by slicing.

## A real bug caught by ECC review and fixed before commit

**ECC planner finding, applied:** the first version of this fix created
the Supabase client and ran the existing-deals read **after** the entire
scrape loop and `browser.close()` — meaning a bad credential or a
transient read failure would abort the run only after potentially tens of
minutes of scraping, discarding the whole result with no fallback. Fixed
by moving client creation and the read to before the scrape loop starts,
so a credential or connectivity problem fails fast, before any scrape
time is spent.

**ECC planner finding, applied:** every other `isDirectExecution`-guarded
script in this repo (`build-v2-launch-candidate.ts`,
`audit-wave0g18-aggregate.ts`) has a regression test asserting the guard
is present — `harvest.ts` didn't, even though losing it here is uniquely
severe (a live browser launch and real scraping, not just a wasted
rebuild). Added `scripts/__tests__/harvestGuard.test.ts`.

## A necessary, safety-critical enabling fix, disclosed as in-scope

`scripts/harvest.ts` had **no guard** around its `main()` call — the file
unconditionally ran `main().catch(...)` at module-import time. This
session needed to `import` the file to test `loadExistingDealsFromSupabase`
in isolation, which would have launched a real Playwright browser and
started live scraping immediately. Fixed by adding the same
`isDirectExecution` guard already established in
`scripts/build-v2-launch-candidate.ts`. Verified twice: once via a
temporary throwaway import script (confirmed instant, no side effects,
deleted after use) and implicitly by every subsequent test run in this
session importing the file without incident. Confirmed the guard
condition is correct for the real invocation path (`npm run harvest` →
`tsx scripts/harvest.ts` → `argv[1]` resolves to the file → `main()`
still runs, unchanged from before).

## Validation

`scripts/__tests__/harvestSupabaseMerge.test.ts` (4 tests, mocked
`@supabase/supabase-js`, no live credentials): single-page read;
exhaustive pagination past 1000 rows; empty-table handling; fail-closed
on a query error (never silently returns partial data).

**Additionally validated live** (via a temporary script, created and
`rm -f`'d in the same session — confirmed absent from `git status` and
never committed): `loadExistingDealsFromSupabase` correctly read all
12,642 real production `deals` rows against the actual Supabase project,
exactly matching the already-known count. Re-verified afterward that
`deals_v2_preview`/`neighborhoods_v2_preview` (from an unrelated earlier
wave) remain at 0 rows and `data/deals.json`'s SHA-256 is unchanged —
confirming zero writes occurred anywhere this session.

```
npx tsc --noEmit   -> clean
npx vitest run     -> 34 files, 412 tests passing, 5 skipped (unrelated, gated live-DB test)
npm run build      -> compiled successfully, 25 routes generated
data/deals.json SHA -> unchanged (18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f)
Supabase deals table -> unchanged (12,642 rows, read-only access only)
```

## Disclosed, NOT fixed in this wave

**1. A real, narrow behavior loss (ECC planner finding).** Before Wave
0G-L1D, a re-harvested row whose `id` matched an existing row's exactly
would still get re-upserted (harmless — same id, same content, or a
genuine field correction like an updated price or refreshed
`street-index.json` coordinate would silently take effect). After L1D
changed the id formula, that exact-id-match refresh path was already
mostly dead (a freshly re-normalized row almost never has the same id as
an old-format existing row). This wave's fix upserts only genuinely-new
rows (`added`), so a field correction on an already-matched (by
`legacyMatchKey`) row can now never reach Supabase via a normal harvest
run. Not fixed here — closing it would mean either always re-upserting
every legacy-matched row (defeats the point of this fix, re-pushes
thousands of rows every run) or adding a deliberate opt-in refresh mode
(e.g. `HARVEST_FORCE_REFRESH`) — a new feature, not a bug fix, and out of
this wave's scope.

**2. `HARVEST_STREET` + `DATA_SOURCE=supabase` still writes to the wrong
place (re-confirmed, not fixed — same gap Wave 0G-L1E disclosed).** That
branch has no Supabase-writing code at all; it unconditionally writes to
the local `data/deals.json` file regardless of `DATA_SOURCE`, and returns
before ever reaching this wave's fix. "Fix the Supabase upsert path" was
scoped to the actual `sb.from("deals").upsert(...)` call and its
blindness to existing rows — the only place that call exists — not to
adding Supabase-write support to a branch that structurally never had it.

## Security / production safety

```
data/deals.json CHANGED = NO (SHA verified unchanged)
data/neighborhoods.json CHANGED = NO
Supabase deals table CHANGED = NO (read-only access only, confirmed by exact row-count match)
Network requests made = read-only Supabase SELECT only (one live verification, immediately cleaned up)
SECRET_EXPOSURE = NO (ECC security-reviewer verdict)
Temporary verification script = confirmed deleted, absent from git status, never committed, no credential value baked in anywhere
```

## ECC review (3 reviewers)

- **planner** — confirmed the full-table-read design is sound at current
  scale (12,642 rows, decades of headroom at current growth rate);
  confirmed upserting only `added` is correct with the one disclosed
  behavior loss noted above; confirmed the `isDirectExecution` guard is
  correctly scoped and in the right place; caught the real fail-fast
  ordering bug (fixed) and the missing guard-regression test (added);
  confirmed deferring the `HARVEST_STREET` gap is the right scope call.
- **silent-failure-hunter** — confirmed the pagination logic is
  byte-identical to `lib/store.ts`'s established pattern; confirmed a
  Supabase read failure propagates correctly to `main().catch()` (no
  silent fallback to an empty existing-set); re-confirmed the
  `HARVEST_STREET`+Supabase gap independently; noted `sb: any` has no
  compile-time safety for future callers (accepted — matches this
  script's existing convention throughout).
- **security-reviewer** — `SECRET_EXPOSURE=NO`; confirmed
  `loadExistingDealsFromSupabase` is read-only from source (no
  insert/upsert/update/delete); confirmed the guard doesn't change normal
  `npm run harvest` behavior; confirmed the temporary live-verification
  script left no trace anywhere.

## Commit

Changed: `scripts/harvest.ts`, `lib/dealNormalization.ts` (added `added`
to `MergeIncrementalDealsResult`). New:
`scripts/__tests__/harvestSupabaseMerge.test.ts`,
`scripts/__tests__/harvestGuard.test.ts`, this report. Never touched:
`data/deals.json`, `data/neighborhoods.json`, any Supabase table (beyond
the one live read-only verification, immediately cleaned up).
