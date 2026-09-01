# Wave 0G-L1E — Fix `scripts/harvest.ts`'s id-format-cutover merge bug

**Verdict: DONE (local-JSON path), with two related, NOT-fixed gaps
disclosed below** rather than silently left for someone to discover the
hard way. `data/deals.json` is unchanged, as required. No network requests
or Supabase writes were made — every change was verified with pure,
in-memory unit tests and a static typecheck/build.

## The problem (from `audit/wave0g-l1d/ID_SCHEME_FIX.md`)

Wave 0G-L1D fixed `Deal.id`'s collision-prone fallback formula. That fix
had a real downstream consequence: `scripts/harvest.ts`'s incremental
merge (`HARVEST_ONLY`/`HARVEST_STREET` modes) dedupes freshly-normalized
deals against `existingDeals` (loaded from `data/deals.json`) by `id`
alone. All 12,642 existing production rows carry the OLD-format id — a
re-harvested version of an already-stored transaction now gets a
DIFFERENT (new, parcelNum-based) id, so plain id-equality no longer
recognizes it as already present, and it would be silently re-added as a
duplicate.

## Fix

`lib/dealNormalization.ts`: new exported `mergeIncrementalDeals(existingDeals, freshDeals)`
and a private `legacyMatchKey(d)` helper. Design:

- `existingDeals` is **never** filtered, reordered, or modified — every
  row that was already there stays, unconditionally, at the front of the
  result.
- A fresh row is skipped only if it matches an **existing** row's `id` OR
  its `legacyMatchKey()` (`neighborhoodId|dealDate|price|propertyType|areaSqm-or-plotSqm`
  — the content the OLD id fallback used to key on directly, present on
  every `Deal` regardless of which formula produced its `id`).
- Two **fresh** rows are compared to each other by `id` only — never
  `legacyMatchKey()`. Fresh rows all carry the new, collision-resistant
  parcelNum-based id (Wave 0G-L1D), so they need no lossy secondary check.

`scripts/harvest.ts`: both merge sites (`HARVEST_STREET` single-street
mode, and the general `HARVEST_ONLY`-aware merge) now call this function
instead of the old single-pass `Set`-based `d.id`-only filter, and log
`skippedDuplicateCount` when nonzero. The "N new this round" log now uses
the function's accurate post-dedup `addedCount` instead of the previous
code's raw pre-dedup scraped count (a minor, incidental accuracy fix).

## A real bug caught and fixed during ECC review

**ECC planner finding, applied:** the first version of this fix ran
`legacyMatchKey()` against already-accepted **fresh** rows too, not just
existing ones. Since fresh rows all carry new-format, collision-resistant
ids, applying the lossy legacy key there would have reintroduced the exact
V2-scale collision class Wave 0G-L1D just fixed — on a full citywide run
(`existingDeals=[]`, ~59k fresh rows), this would have silently dropped
the ~94 genuinely-different transactions L1D's own investigation already
proved collide under `neighborhoodId+dealDate+price+area`. Fixed by
restricting `legacyMatchKey()` comparison to existing-vs-fresh only; a new
regression test (`REGRESSION (ECC planner finding)`) proves two distinct
fresh transactions sharing that content, with distinct new-format ids, are
both kept.

**ECC silent-failure-hunter finding, applied:** `legacyMatchKey()` didn't
include `propertyType`. A `land` row always has `areaSqm: null` (keyed on
`plotSqm`), and a house/apartment row missing built area also falls back
to `plotSqm` — the file's own L1D-era documentation already established
this exact key class collided 116 times at V2 scale, so a land parcel and
a house sharing `neighborhoodId+dealDate+price+plotSqm` could be falsely
treated as the same transaction. Fixed by adding `propertyType` to the
key; a new test confirms a land/house pair with matching plotSqm are no
longer falsely merged.

## Tests

8 new tests in `lib/__tests__/dealNormalization.test.ts` (23 total in that
file now): existing rows are never dropped; a genuinely new transaction is
added; the actual bug (old-id existing row vs. new-id re-harvested version
of the same transaction) is caught; intra-run fresh-vs-fresh exact
duplicates are still caught; the honest existing-vs-fresh residual limit
is documented (not hidden); existing-row order is preserved; the
fresh-vs-fresh false-collision regression is proven fixed; the
land/house `propertyType` disambiguation is proven.

```
npx tsc --noEmit   -> clean
npx vitest run     -> 32 files, 407 tests passing, 5 skipped (unrelated, gated live-DB test)
npm run build      -> compiled successfully, 25 routes generated
data/deals.json SHA -> unchanged (18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f)
```

## Disclosed, NOT fixed in this wave

**1. The Supabase upsert path has essentially the same problem, unfixed.**
`existingDeals` is only ever loaded from the local `data/deals.json` file
(gated by `DATA_SOURCE !== "supabase"`), so in Supabase mode
`existingDeals` is always `[]` and this fix's protection never engages. A
re-harvested transaction already sitting in Supabase's `deals` table under
an old-format id would still get `upsert`'d as a brand-new duplicate row —
`upsert` only recognizes matches by primary key, and this fix has no
visibility into what Supabase already contains. This applies to both
incremental and full-citywide Supabase-mode runs; a full run is actually
worse exposure, since every neighborhood's already-stored transactions
would get a fresh new-format-id row upserted alongside the old one (upsert
never deletes rows absent from its payload). Not fixed here: closing it
requires a live, read-only Supabase query before computing the merge — a
larger, riskier change to the actual DB-write path than this wave's scope
("fix scripts/harvest.ts's id-cutover issue," which was specifically
disclosed and documented against the local-JSON merge). Confirmed
low-urgency right now: `.env.local`'s `DATA_SOURCE=local` — Supabase is
not the active mode in this environment today — but this needs its own
wave before `DATA_SOURCE=supabase` is ever used for a real harvest.

**2. A separate, pre-existing bug on a line this wave touched (ECC
planner finding):** in the `HARVEST_STREET` branch, if `DATA_SOURCE=supabase`
is set, `existingDeals` stays `[]` (loading is gated to non-Supabase mode)
and the branch unconditionally writes the merged result to the **local**
`data/deals.json` file, never upserting to Supabase at all — meaning
`HARVEST_STREET=X DATA_SOURCE=supabase` silently writes only that street's
data to the wrong place and loses it from Supabase's perspective. This
predates this wave (unrelated to the id-cutover issue; this wave changed
only the merge computation, not the write-target logic) and was not
touched, to keep this diff focused on the disclosed problem.

## Security / production safety

```
data/deals.json CHANGED = NO (SHA verified unchanged)
data/neighborhoods.json CHANGED = NO
Supabase written to = NO
Network requests made = NO (only tsc/vitest/npm build — all local/offline)
SECRET_EXPOSURE = NO (ECC security-reviewer verdict)
```

## ECC review (3 reviewers)

- **planner** — confirmed the core mechanism is sound; caught the real
  fresh-vs-fresh false-collision regression (fixed); confirmed deferring
  the Supabase-path fix is the right scope call given `DATA_SOURCE=local`
  is the active mode today; surfaced the separate pre-existing
  `HARVEST_STREET`+Supabase write-target bug (disclosed above, not fixed).
- **silent-failure-hunter** — found the missing `propertyType` in
  `legacyMatchKey()` (fixed); confirmed no stale-variable leftover from
  the refactor at either call site; confirmed the Supabase upsert call
  correctly consumes the new merge output.
- **security-reviewer** — `SECRET_EXPOSURE=NO`; confirmed the new function
  is pure/synchronous/in-memory with no network or file I/O; confirmed
  the write call sites (`upsert`, `writeFile`) are otherwise untouched and
  can only reduce or match the previous row count, never inflate it.

## Commit

Changed: `lib/dealNormalization.ts`, `scripts/harvest.ts`,
`lib/__tests__/dealNormalization.test.ts`. New: this report. Never
touched: `data/deals.json`, `data/neighborhoods.json`, any Supabase table,
any network endpoint.
