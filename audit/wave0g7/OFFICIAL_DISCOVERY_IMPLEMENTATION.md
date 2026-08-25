# Wave 0G-7 — Official Nadlan Discovery Implementation + Shadow Validation

Status: IMPLEMENTATION + SHADOW-VALIDATION. No canonical data rebuild, no
`data/deals.json` rewrite, no Supabase writes, no citywide harvest, no
Production update, no valuation logic change.

## Phase 1 — Baseline

```
BASELINE_HEAD  = 77c64cb235ca5eed5c30fa3d0424c82cc742af91
CANONICAL_ROWS   = 12,642
CANONICAL_SHA256  = 18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
```

Both confirmed unchanged at close (Phase 16).

## Phase 2 — Current discovery contract

```
CURRENT_DISCOVERY_SOURCE  = es.govmap.gov.il/TldSearch/api/DetailsByQuery
                            (scripts/harvest.ts:31, 89)
CURRENT_IDENTIFIER_SYSTEM   = GovMap "ObjectID" (harvest.ts:97-99) — proven
                            (Waves 0G-5/0G-6) to have ZERO overlap with
                            nadlan.gov.il's own internal neighborhoodId space
CURRENT_DEDUP_RULE           = dedup by constructed Deal `id`
                            (`${n.id}-${keyValue-or-composite}`), not by
                            entity identity at discovery time
CURRENT_FIRST_HIT_RULE        = discoverNeighborhoods(), harvest.ts:96:
                            `const hit = j?.data?.NEIGHBORHOOD?.[0];` — keeps
                            only the first geocoding hit per SEED_NAMES entry
CURRENT_OUTPUT_SHAPE          = Neighborhood[] (lib/types.ts:31-38), written
                            to data/neighborhoods.json by scripts/harvest.ts's
                            main() (line 533) on a full (non-HARVEST_ONLY) run
```

GovMap ids enter the harvest flow at exactly one point:
`discoverNeighborhoods()` (`scripts/harvest.ts:65-120`), called once at the
top of `main()` (`scripts/harvest.ts:381`); every downstream function
(`harvestNeighborhood()`, `harvestByStreets()`, `normalize()`) receives and
trusts whatever `Neighborhood` objects this function returns.

## Phase 3 — Official catalog discovery module

Implemented: [lib/nadlanCatalog.ts](../../lib/nadlanCatalog.ts) — a pure,
dependency-free module (no imports from `lib/types.ts`, no GovMap code, no
app-level neighborhood model, confirmed by the specialist and planner
reviews below).

```ts
export interface NadlanEntity {
  sourceId: string;
  name: string;
  source: "nadlan";
  settlementId: string;
}
```

`getOfficialNetanyaEntities(bootstrapSourceId?, fetchImpl?)` fetches
`https://data.nadlan.gov.il/api/pages/neighborhood/buy/{id}.json` (the
endpoint proven stable/invariant in Wave 0G-6) and returns the full parsed
entity list via `parseNadlanCatalog()`. Official source ids are never
reinterpreted as our existing application `neighborhoodId` — see Phase 12.

## Phase 4 — No name-based collapsing

`parseNadlanCatalog()` identity is `sourceId` only (a `Set<string>` keyed by
id, `lib/nadlanCatalog.ts:86-108`) — no `Map<name,...>`, no `Set<name>`, no
first-hit-by-name logic anywhere in the module (independently confirmed by
the specialist review). TEST B
(`lib/__tests__/nadlanCatalog.test.ts`, "same-name, different-id entities
both survive") directly proves two entries sharing the identical display
name `"נוף הטיילת"` but different `sourceId`s (`65210195` and `66239231`)
both survive parsing.

## Phase 5 — Catalog invariance assertion

`parseNadlanCatalog()` validates:
- non-empty (`EMPTY_CATALOG` if `otherNeighborhoods` is missing/empty)
- unique ids (`DUPLICATE_ID` if the same `sourceId` appears twice)
- structurally valid entries (`INVALID_ENTRY` for missing/malformed id or title)
- settlement correspondence, when exposed and expected (`SETTLEMENT_MISMATCH`,
  optional/skippable via `expectedSettlementId: null` — confirmed by the
  specialist review not to be a footgun for entities where the field is absent)

No runtime code hardcodes "must equal 38." TEST D explicitly proves the
parser accepts catalogs of size 1 and size 100, and a source-text assertion
confirms no `=== 38` / `!== 38` literal exists anywhere in the parser.

## Phase 6 — Special-category entities

`inferEntityCategoryHint(name)` is a standalone, non-authoritative,
name-pattern-based labeling function (documented as such in its own doc
comment) — confirmed by the specialist review to never be called inside
`parseNadlanCatalog()`, so special-category entities (industrial/planning/CBD)
are never filtered or dropped during discovery. Nadlan's own catalog response
carries no structured category/type field at all (confirmed this wave); the
hint function exists purely so these entities can be labeled for reporting,
not to gate them.

## Phase 7 — Shadow-only harvest path

Implemented: [scripts/audit-wave0g7-shadow-harvest.ts](../../scripts/audit-wave0g7-shadow-harvest.ts) —
reuses the same real acquisition request/parser logic established across
Waves 0G-2 through 0G-5 (duplicated, not imported, since `scripts/harvest.ts`
has no exports and is a standalone script — this is the same shadow-diagnostic
pattern already used and ECC-approved multiple times this engagement, now
parameterized by an explicit official `sourceId` + name instead of a
hardcoded target). Writes only under `audit/wave0g7/`. Never opens or writes
`data/deals.json`, never imports or calls Supabase (confirmed by TEST E/F and
independently by the security-reviewer and code-reviewer passes).

## Phase 8 — Shadow sample 1: נוף הטיילת — RESULT: FAILED (important finding)

```
sourceId requested = 65210195
RAW_ROWS      = 500
UNIQUE_ROWS    = 500
EARLIEST_DATE   = 2024-12-01
LATEST_DATE      = 2026-06-23
BEN_AMI_41_ROWS   = 0
KNOWN_7_FOUND      = 0/7
```

**This did NOT match Wave 0G-5's expectation, and the discrepancy is itself
the wave's most important finding.** Every one of the 500 returned rows
carries `rawUpstreamNeighborhoodId: "65210243"` — a **third, completely
different** entity ("מע\"ר - מרכז עירוני ר", a CBD/central-urban-area
designation, per Wave 0G-5's catalog) — not the requested `65210195`, and not
even the previously-known "wrong" GovMap id `66239231`. Zero of the 500 rows
carry the requested id.

Root cause: the shadow script's actual query-triggering mechanism (typing
the entity NAME into nadlan.gov.il's search box and clicking a generic
"שכונה"-labeled autocomplete suggestion — the only general-purpose mechanism
proven controllable across this whole wave family) does not let a caller
force-target a *specific* discovered `sourceId` when the search text is
ambiguous. The `sourceId` parameter was accepted by the script and correctly
propagated into its diagnostic output labels (`sourceEntityId`), but it does
**not** control which entity the underlying UI search actually resolves to.

This was caught by this wave's own self-diagnostic check (added mid-wave,
see Phase 15/18): the script now compares every returned row's
`rawUpstreamNeighborhoodId` against the requested `sourceId` and reports
`requestValid: false` with an explicit `ID_MISMATCH` error rather than
silently reporting success — this is what the final, corrected shadow output
now shows.

## Phase 9 — Shadow sample 2: רסקו — RESULT: FAILED (different failure mode)

```
sourceId requested = 65210248
RAW_ROWS      = 0
UNIQUE_ROWS    = 0
EARLIEST_DATE   = null
LATEST_DATE      = null
DISTINCT_STREETS  = 0
```

No `/deal-data` response fired at all — the search box's autocomplete
returned **zero suggestions** for "רסקו נתניה" (confirmed via a
`SUGGESTIONS=` debug log showing only static footer links, no data
suggestion). "רסקו" is a real, catalog-listed entity (per Wave 0G-6), but is
not directly searchable by its exact catalog name through nadlan's own search
box. The script now reports `requestValid: false` with an explicit
`NO_SUGGESTION_OR_EMPTY_RESULT` error, rather than the misleading
`requestValid: true, rawRows: 0` a naive first-pass version produced.

**Purpose achieved despite the failure:** this does prove discovery/request
construction is not hardcoded to Nof Hatayelet — the script genuinely used
the "רסקו" parameter throughout, and failed for an honest, entity-specific
reason (no matching suggestion), not because the code silently ignored the
input. A third entity, "אגמים" (`sourceId=65210238`), was additionally run as
a positive control and succeeded cleanly: 500/500 rows correctly carrying
`rawUpstreamNeighborhoodId: "65210238"`, an exact match — proving the
mechanism genuinely works end-to-end for at least some real, non-ambiguous
catalog entities.

## Phase 10 — Shadow sample 3: one special-category entity

```
Entity: אזור תעשיה קריית אל (industrial zone, sourceId=65210388)
REQUEST_VALID   = NO
ROWS_RETURNED    = 0
ENTITY_TYPE       = industrial (via inferEntityCategoryHint)
ERROR              = NO_SUGGESTION_OR_EMPTY_RESULT — no matching autocomplete
                   suggestion found for this exact name
```

Per instruction, this zero-transaction result is NOT interpreted as a defect
in the entity itself (an industrial zone may legitimately have no or few
residential-style transactions) — but the underlying cause here is the same
"no autocomplete suggestion at all" failure mode as רסקו, not a genuine
zero-activity result, since no query was ever successfully constructed.
Plausible (not confirmed) contributing factor: this catalog title itself
appears truncated (~20 characters, per Wave 0G-5/0G-6's own finding), so the
exact string may not match the search box's own internal index even if a
fuller name would.

## Phase 11 — Old vs new discovery comparison

```
OLD_ENTITY_COUNT     = 21  (source = GovMap TldSearch, data/neighborhoods.json)
NEW_ENTITY_COUNT      = 38  (source = nadlan's own official catalog, Wave 0G-6)
ID_OVERLAP              = 0   (reconfirmed this wave, matches Wave 0G-5 exactly)
NEW_IDS_LOST_BY_NAME_DEDUP = 0 (matches expectation exactly — the 38-entity
                          official catalog has zero duplicate names within
                          itself, so a hypothetical old-style first-hit-by-name
                          rule would not have lost anything from THIS
                          specific catalog; the real defect it guards against
                          is the cross-system duplication already proven
                          between our 66239231 and nadlan's own 65210195)
```

## Phase 12 — Identifier domain safety

No schema change made this wave. Current usage of `neighborhoodId` was
documented, not migrated:

- `Deal.neighborhoodId: string` (`lib/types.ts:22`, comment: `"UNIQ_ID של
  נדל\"ן"` — this comment is misleading given this wave's findings, since the
  value is actually GovMap-sourced, not nadlan's own UNIQ_ID; left unchanged
  since correcting it is a separate, non-audit-only concern)
- `Neighborhood.id: string` (`lib/types.ts:32`) — `data/neighborhoods.json`'s
  own id space
- Supabase: `deals.neighborhoodId` FK → `neighborhoods.id`
  (`supabase/bootstrap_v1.sql:56`, confirmed unchanged this wave)
- `lib/valuation.ts`, `lib/store.ts`, `components/ValuationWizard.tsx`,
  `components/AddressSearch.tsx`, `app/api/autocomplete/route.ts`,
  `app/api/valuation/*`, `app/api/lead/*` all treat `neighborhoodId` as an
  opaque pass-through filter/join key — the database-reviewer confirmed no
  hardcoded neighborhoodId literals exist in any of this production code
  (only in test fixtures), so no application logic would break from an id
  *value* change, though the *meaning* users see (which polygon a given id
  now points to) would.

Recommendation (not implemented): if a future wave persists official-catalog
data, keep it under a distinctly-named field (e.g. `sourceEntityId` /
`nadlanCatalogSourceId`, as this wave's shadow script already does
diagnostically) rather than overloading `neighborhoodId` — both to avoid
silent join corruption (the two id spaces are proven numerically
incompatible) and, per the database-reviewer's specific naming-collision
concern, to avoid a future engineer conflating "nadlan's own id" (two
different things: the app's existing `neighborhoodId` doc-comment already
*claims* to be this) with the genuinely-new `NadlanEntity.sourceId`. A schema
migration is out of scope for this wave and was not performed.

## Phase 13 — Property semantics preservation

`scripts/audit-wave0g7-shadow-harvest.ts`'s `normalize()` preserves
`dealNature: raw.dealNature ?? null` verbatim (`scripts/audit-wave0g7-shadow-harvest.ts:99`),
identical to the pattern already proven correct in Waves 0G-2 through 0G-4.
This wave's own shadow captures (נוף הטיילת and אגמים) did not happen to
contain any `"נופש"`-labeled rows this run (a consequence of Phase 8's
id-mismatch — the actual target polygon containing the known Ben Ami 41
`"דירת נופש"` rows was never successfully reached this wave), so a fresh
live re-confirmation was not possible this run; the code-level preservation
is unchanged and structurally identical to the already-proven pattern, and
was independently re-confirmed via direct code reading rather than a fresh
live example.

## Phase 14 — Tests

All 9 required tests implemented in
[lib/__tests__/nadlanCatalog.test.ts](../../lib/__tests__/nadlanCatalog.test.ts)
(28 tests total, including sub-cases):

| Test | Result |
|---|---|
| A — official catalog parser preserves all ids | PASS (2 sub-cases: small fixture + real 38-entity catalog) |
| B — same-name/different-id entities both survive | PASS |
| C — empty/invalid catalog fails safely | PASS (6 sub-cases) |
| D — catalog size can legitimately change without runtime failure | PASS (3 sub-cases, including a no-hardcoded-38 source assertion) |
| E — shadow path cannot write canonical deals | PASS |
| F — shadow path cannot write Supabase | PASS (tightened mid-wave to check actual usage patterns, not the bare word "supabase," after an initial false-positive against a safe log line) |
| G — Nof Hatayelet official id produces correct request shape | PASS (2 sub-cases) |
| H — GovMap id is no longer used by NEW discovery path | PASS (3 sub-cases) |
| I — existing production/canonical path remains untouched unless explicitly using new shadow mode | PASS (2 sub-cases: `harvest.ts` doesn't import the new module; no production file under lib/app/components imports it either) |
| (added mid-wave) — mismatch check requires every row to match, not just some | PASS (regression guard for the HIGH-severity bug the code-reviewer caught and this wave fixed) |

## Phase 15 — Quality gates

```
Focused discovery tests (lib/__tests__/nadlanCatalog.test.ts) = 28/28 PASS
Full test suite (npx vitest run)                                 = 211/211 PASS (20 files)
Typecheck (npx tsc --noEmit)                                       = clean, zero errors
Production build (npm run build)                                     = SUCCESS
```

Lint remains pre-existing unavailable, per instruction — no ESLint migration
introduced.

## Phase 16 — Canonical immutability proof

```
data/deals.json SHA256 (before) = 18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
data/deals.json SHA256 (after)   = 18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
MATCH = YES

SUPABASE_WRITES              = 0 (no Supabase client exists in any new file; independently confirmed by database-reviewer, security-reviewer, and code-reviewer)
CANONICAL_CHECKPOINT_WRITES   = 0 (no write path to data/deals.json, data/neighborhoods.json, or any harvester checkpoint exists in any new file)
```

## Phase 17 — Graphify blast-radius review

Using the existing (pre-built) Graphify graph, cross-verified against source:

```
DISCOVERY_NODES               = discoverNeighborhoods() [scripts/harvest.ts:65]
                              (existing, unchanged) + getOfficialNetanyaEntities()/
                              parseNadlanCatalog() [lib/nadlanCatalog.ts] (new, additive)
HARVEST_REQUEST_NODES          = harvestNeighborhood(), harvestByStreets()
                              [scripts/harvest.ts] (existing, unchanged) +
                              shadowHarvestOne() [scripts/audit-wave0g7-shadow-harvest.ts]
                              (new, diagnostic-only, isolated)
PARSER_NODES                    = normalize() [scripts/harvest.ts:181] (existing,
                              unchanged) + normalize() [scripts/audit-wave0g7-shadow-harvest.ts]
                              (new, diagnostic-only, duplicated not shared)
MODEL_NODES                       = Deal, Neighborhood [lib/types.ts] (existing,
                              unchanged this wave) — a future migration would
                              need to touch these, but did not this wave
CANONICAL_OUTPUT_NODES              = data/deals.json write path [scripts/harvest.ts:535],
                              Supabase deals table [supabase/bootstrap_v1.sql]
                              (both existing, entirely untouched/unreachable
                              from any new code this wave)
VALUATION_DEPENDENCY_NODES            = lib/valuation.ts, lib/store.ts,
                              components/ValuationWizard.tsx (existing,
                              confirmed to treat neighborhoodId as opaque —
                              zero coupling to the new module)
```

Estimated future migration blast radius, if this discovery source is ever
wired into production: small for the discovery step itself (swap
`discoverNeighborhoods()`'s id source), but Phase 8's finding means the
ACQUISITION step (`harvestNeighborhood()`/`harvestByStreets()`) would need
its own, still-unsolved fix before any id-targeted rebuild could be trusted —
this is a materially larger, currently-unscoped piece of future work, not
addressed or estimated further this wave.

## Phase 18 — ECC final review

| ECC_REVIEWER | VERDICT | KEY_FINDING |
|---|---|---|
| planner | PARTIAL, not PASS | Independently found (before this wave's own fix was applied) that all 500 `נוף הטיילת` shadow rows carried `rawUpstreamNeighborhoodId: "65210243"` — a third, unrequested entity — calling this "stronger evidence of mistargeting" than the date-window heuristic first used to characterize it. Explicitly recommended against reporting "Nof Hatayelet shadow works" as a PASS criterion, and supplied the exact warning sentence now reflected in this report's framing (discovery is solved; targeted acquisition for a chosen id is not). Also flagged the `rasko_shadow.json` false-success pattern independently, which was fixed in parallel. |
| specialist (code-explorer) | CONFIRMED, all 5 tasks | Verified `parseNadlanCatalog()`'s sourceId-only identity model, the exact proven URL construction, the correctly-optional settlement check, the genuine `rawUpstreamNeighborhoodId`/`sourceEntityId` field separation in the shadow script's `normalize()`, and confirmed `inferEntityCategoryHint()` is never used to filter entities. |
| database-reviewer | CONFIRMED clean | Zero Supabase schema changes, zero `lib/types.ts` changes. Analyzed (without implementing) that a future persistence step would need only additive nullable columns — no NOT NULL/CHECK constraint changes forced. Flagged a naming-collision risk worth a future wave's attention: `Deal.neighborhoodId`'s doc-comment already (incorrectly) claims to be "nadlan's UNIQ_ID," which could confuse a future engineer into conflating it with the genuinely-new `NadlanEntity.sourceId`. |
| silent-failure-hunter | 2 CONFIRMED RISKS (both fixed before commit) | Independently reproduced the exact 500/500 id-mismatch in `nof_hatayelet_shadow.json` (dispatched against the pre-fix version) and confirmed no runtime signal existed anywhere warning that per-id acquisition was unproven — both directly validated the mid-wave fix (self-diagnosing `idMismatch`/`requestValid` check) as necessary, not optional. |
| security-reviewer | PASS, all 4 checks | Confirmed the shadow script's `response` handler never reads headers/cookies (only `resp.text()` body); confirmed zero secret-pattern strings in any of the 4 audit artifacts; confirmed `getOfficialNetanyaEntities()` performs a plain unauthenticated GET; confirmed no secret env vars are referenced by any new file. |
| code-reviewer | WARNING → fixed, then re-verified clean | Caught a real HIGH-severity gap in the first mismatch-detection fix: `.includes(sourceId)` would have silently accepted a MIXED batch (some correct rows buried among many contaminated ones) as a full match. Fixed to require `matchingRowCount === normalized.length` before this report was finalized, with a new regression test added and the full quality-gate re-run confirming the fix. Also noted a LOW-severity missing-timeout note on `getOfficialNetanyaEntities()`'s fetch call, which was also fixed (15s `AbortController` timeout added). |

## Phase 19 — Implementation verdict

```
OFFICIAL_DISCOVERY_IMPLEMENTATION = PARTIAL
```

PASS criteria met: official catalog fetched reliably (Phase 2/3, proven live
and via the committed Wave 0G-6 fixture); official source IDs preserved with
no name-based loss (Phase 4, TEST B); catalog invariance validated at the
seam without hardcoding (Phase 5, TEST D); one special entity handled safely,
with its zero-result honestly attributed to a real cause rather than
fabricated (Phase 10); canonical dataset unchanged (Phase 16); zero DB
writes (Phase 16); all quality gates green (Phase 15).

PASS criteria NOT met: "Nof Hatayelet shadow works" — it does not; the
shadow script, when asked for `sourceId=65210195`, returned 500 rows
belonging entirely to a different entity, and this wave's own honest
self-diagnostic now correctly reports that as a failure rather than
papering over it. "Rasko shadow works" — it does not either, for an
unrelated reason (no matching autocomplete suggestion exists for that exact
catalog name).

This is reported as PARTIAL rather than FAIL because the actually-scoped
deliverable — a pure, well-tested, additive DISCOVERY module — is solid and
meets every one of its own design goals. What remains unsolved, and should
not be mistaken for solved, is targeted ACQUISITION for a specific
discovered id: nadlan.gov.il's general-purpose name-typed search box is not
a reliable mechanism for this, as proven directly and repeatedly this wave.

## No rebuild performed

Per instruction, even though discovery itself is sound: no citywide harvest
of all 38 entities was run, `data/deals.json` was not replaced, Supabase was
not migrated, valuation logic was not altered, and nothing was deployed. The
next wave, if authorized, will need to separately address the targeted-
acquisition gap this wave surfaced before any rebuild architecture decision
can be made responsibly.
