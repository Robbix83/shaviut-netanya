# Wave 0G-11 (informal) — discoverNeighborhoods() fix

Development work, done informally per user direction (no full phase/ECC
template this wave — see the earlier conversational agreement to continue
"without the rigid template").

## What changed

`scripts/harvest.ts`'s `discoverNeighborhoods()` previously discovered
Netanya neighborhood entities by querying a fixed `SEED_NAMES` list against
GovMap's `TldSearch/api/DetailsByQuery`, keeping only the first hit per name
(`j?.data?.NEIGHBORHOOD?.[0]`). This silently missed entity `65210195`
("נוף הטיילת") — a second, differently-id'd polygon sharing a display name
with an already-discovered id (`66239231`) — because "first hit by name" can
only ever surface one of two same-named entities. That entity holds the 7
originally-missing Ben Ami 41 transactions (see
`audit/wave0g4/CADASTRAL_ENTITY_RECONCILIATION.md`, and the Wave 0G-10
addendum in `audit/wave0g10/PAGINATION_DEPTH_AND_TRANSACTION_IDENTITY.md`
which re-confirmed those 7 rows are plain top-level `/deal-data` rows for
this exact entity, still absent from canonical data).

Fix: layered discovery, identity always by upstream numeric id, never name:

1. **New primary source** — `lib/nadlanCatalog.ts::getOfficialNetanyaEntities()`
   (nadlan.gov.il's own entity catalog, proven citywide-stable in Wave 0G-6),
   with per-entity geographic coordinates fetched from each entity's own
   page (`getNadlanEntityCoordinates()`, new export added this wave —
   `parseNadlanEntityCoordinates` + `getNadlanEntityCoordinates` in
   `lib/nadlanCatalog.ts`).
2. **Fallback, unchanged in spirit** — the original GovMap name-search,
   kept because Wave 0G-6 did not prove the official catalog is 100%
   exhaustive for every special-category entity.
3. **Last-resort merge** — existing `data/neighborhoods.json` entries not
   rediscovered by either source above.

An id found by an earlier source is never overwritten by a later,
differently-sourced duplicate.

## New files

- `lib/neighborhoodDiscovery.ts` — the extracted, testable discovery module
  (`discoverNeighborhoods(opts)`, dependency-injectable `fetchImpl` for
  testing, matching `lib/nadlanCatalog.ts`'s own DI pattern).
- `lib/__tests__/neighborhoodDiscovery.test.ts` — 7 tests, including the
  central regression proof: entity `65210195` survives even when a mocked
  GovMap lookup for the same name resolves to the old, different id
  (`66239231`) — reproducing and closing the exact Wave 0G-4 defect class.
- `scripts/audit-wave0g11-catalog-check.ts` — small, bounded (1 network
  call) live-verification script; not a harvest, writes nothing.

## Modified files

- `lib/nadlanCatalog.ts` — added `parseNadlanEntityCoordinates()` and
  `getNadlanEntityCoordinates()` (per-entity x/y, needed because
  `NadlanEntity` itself carries no coordinates — `Neighborhood.x`/`.y` are
  used downstream by `normalize()` as a fallback when no street-level
  coordinate exists).
- `scripts/harvest.ts` — `discoverNeighborhoods()` now delegates to
  `lib/neighborhoodDiscovery.ts`; removed the now-dead inline `SEED_NAMES`/
  `ES_BASE`/`HEADERS` copies (moved into the new module). No other function
  in `harvest.ts` was touched — `harvestNeighborhood()`,
  `harvestByStreets()`, `normalize()`, and `main()`'s write/Supabase paths
  are unchanged.
- `lib/__tests__/nadlanCatalog.test.ts` — added coordinate-parsing tests;
  updated the existing "TEST I" guardrail (previously asserted
  `scripts/harvest.ts` does NOT import `nadlanCatalog` — an intentional
  invariant from Wave 0G-7 that this wave deliberately reverses). It now
  asserts the opposite: that harvest.ts DOES route through the layered
  discovery module, that the GovMap fallback is still present (not fully
  replaced), that the discovery module makes no canonical/Supabase writes,
  and that `nadlanCatalog.ts` is imported by exactly one sanctioned caller
  (`lib/neighborhoodDiscovery.ts`), not scattered across the app.

## Verification

- Full test suite: 248/248 pass (was 233 before this wave; +14 new
  `nadlanCatalog` tests, +7 new `neighborhoodDiscovery` tests, minus a few
  consolidated/rewritten assertions in the updated guardrail test).
- `npx tsc --noEmit`: clean.
- `npm run build`: succeeds, all 25 routes.
- Bounded live verification (`scripts/audit-wave0g11-catalog-check.ts`,
  1 network call, 0.5s): `CATALOG_ROWS=38`, entity `65210195` present with
  name `נוף הטיילת`, `sourceId` preserved unchanged.
- `data/deals.json`: unchanged. SHA-256 before and after:
  `18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f`.
  Row count unchanged: 12,642.
- No Supabase writes, no importer run, no deployment. `scripts/harvest.ts`'s
  `main()` was never invoked this wave.

## Known limitation, disclosed not fixed

`discoverNeighborhoods()`'s network-call pattern is fully sequential: 1
catalog fetch, then up to 38 per-entity coordinate fetches (300ms delay
each), then up to 23 GovMap fallback fetches (800ms delay each) — roughly
45–90 seconds end-to-end in the normal case. This matches the original
script's deliberate "polite pacing" design for a low-volume monthly job, but
the new 38-entity coordinate-enrichment loop is added overhead that did not
exist before. Not optimized this wave, per explicit instruction not to.

## An unrelated incident during this wave, for the record

An early live-verification attempt used `npx tsx -e "<script>"`, which is
invalid usage — tsx does not support `-e` the way `node` does, and instead
entered its interactive REPL (confirmed via `patch-repl.cjs` in the process
tree), which then blocked indefinitely with zero output because no
interactive terminal was attached to consume it. This ran for
~1 hour 50 minutes before being identified and killed (3 processes
terminated: the `npx` wrapper, the `tsx` CLI process, and the underlying
`node` process with tsx's loader hooks). It never executed any of the
discovery code, created no files, and made no network calls — the hang was
entirely a CLI-invocation mistake, not a defect in
`lib/neighborhoodDiscovery.ts`. The subsequent bounded verification (a
proper `.ts` file run via `npx tsx <file>` with an explicit timeout)
completed normally in 0.5 seconds.
