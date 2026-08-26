# Wave 0G-18 — Kiryat Hasharon Full Street Augmentation Pilot

**Entity:** קריית השרון, sourceId=65209683
**Scope:** all 70 officially enumerated streets of this ONE entity, fetch_number=1 only, no citywide scale-up.

## 1. Baseline (reused, not refetched)

- Official top-level total_rows: **5,640**
- Wave 0G-16 entity-level shadow unique: **2,518**
- Baseline delta: **3,122**
- Baseline coverage: **44.65%**

## 2. Street enumeration (Phase 3)

`getOfficialEntityStreets()` (new, `lib/nadlanCatalog.ts`) fetched `otherNeighborhoodStreets` from the same safe, unauthenticated `data.nadlan.gov.il/api/pages/neighborhood/buy/{id}.json` endpoint already used for entity discovery.

- OFFICIAL_STREET_COUNT = **70**
- UNIQUE_STREET_IDS = **70** (no duplicates — parser fails closed on any)
- UNIQUE_STREET_NAMES = **70**

Manifest: [`kiryat_hasharon_street_manifest.csv`](kiryat_hasharon_street_manifest.csv).

## 3. Live acquisition (Phases 4-8)

All 70 streets were attempted exactly once (no duplicate execution), fetch_number=1 only, single sequential Chrome context, 6s settle + bounded retry/backoff per street. 448.0s elapsed, 74 total `/deal-data` responses captured (some streets fired more than one exchange; only the correctly-matched one was used per street), 0 retries needed, 0 `FAILED_NETWORK`.

| Status | Count |
|---|---|
| SUCCESS_ROWS | 29 |
| SUCCESS_EMPTY | 32 |
| PARTIAL_MORE_FETCHES_INDICATED | 2 |
| FAILED_IDENTITY | 7 |
| FAILED_NETWORK / FAILED_NORMALIZATION / FAILED_OTHER | 0 |

**A real correctness bug was found and fixed before this run**, by three independent ECC reviewers (planner, specialist, silent-failure-hunter) reviewing the same code: the response-capture handler's `base_name==="streetCode"` check was a no-op (both branches of an `if/else` performed the identical assignment), and `base_id` was never verified against the requested street — meaning a stray or wrong-street exchange could have been silently accepted as the current street's data. Fixed by requiring an exact `base_name==="streetCode"` **and** `base_id===street.streetId` match before capturing, with a new `WRONG_STREET_ID` classification and a regression test. Two further ECC findings (code-reviewer) were also fixed pre-execution: `rowsOtherEntity` was overcounting on mixed-contamination batches (now uses the identity check's own matching/total counts), and a resumed-only tail run could leave the diagnostic manifest stale (now flushed unconditionally at the end of every run).

### The 7 identity failures are a genuine, disclosed finding, not a bug

The fail-closed design (`assertDirectIdAcquisitionIdentity` — requires **100%** of a batch's rows to carry the requested `neighborhoodId`) worked exactly as the wave's Phase 8 requires: it rejected every batch containing wrong-entity rows **whole**, never silently keeping only the matching subset.

| Street | Rows returned | Matching sourceId | Other ids present |
|---|---|---|---|
| אריאל שרון | 5 | 0 | 65210388 (100% other-entity) |
| האר"י | 237 | 0 | 65210244, 65210242 (100% other-entity) |
| הפארק | 217 | 46 | 65210240 (mixed) |
| הרב שמואל הרטום | 481 | 134 | 65210241 (mixed) |
| בני רייך | 91 | 79 | `0` (mixed — untagged neighborhoodId) |
| הרב נרייה | 17 | 16 | `0` (mixed) |
| טום לנטוס | 419 | 411 | `0` (mixed) |

This is new evidence about the mechanism proven in Wave 0G-17: street-level querying is **not** always cleanly single-entity-scoped — a streetCode listed in one entity's own catalog can return rows genuinely tagged with a *different* neighborhoodId (a real administrative-boundary or catalog inconsistency, plausibly related to the neighborhood-label mismatches Wave 0G-16 already documented at the entity level — 2 streets, אריאל שרון and האר"י, were 100% a different entity), or with `neighborhoodId="0"` (analogous to the already-documented `street="0"` untagged-address phenomenon — 5 streets showed this mixed pattern). The conservative, fail-closed choice discarded real rows on the mixed streets rather than risk accepting any contamination — correct per this wave's explicit instruction, but it does mean the coverage figures below are a **lower bound**, not the maximum this mechanism could theoretically yield with a less conservative (and unproven-safe) partial-acceptance policy.

**Quantifying that lower bound:** across the 5 mixed streets, **686 rows** (134+46+79+16+411) actually matched sourceId=65209683 but were discarded whole because their batch also contained non-matching rows. That is **15× larger** than the ~34-row opportunity behind the unattempted fetch-2 pages (§11) — this is the single largest lever left on the table, and it splits into two structurally different open questions, not one: (a) *foreign-entity contamination* (a real different sourceId present) is a genuine identity conflict that should stay fail-closed; (b) *`neighborhoodId="0"`* is an untagged-id sentinel, not evidence of a different entity — whether it is safe to treat those specific rows as belonging to the requested entity is a policy question a future wave could investigate deliberately, not something this wave's blanket fail-closed rule was designed to distinguish.

## 4. Coverage after augmentation (Phases 9-11)

Aggregation (`scripts/audit-wave0g18-aggregate.ts`, new) unions the baseline's 2,518 rows with every successful street's rows, deduplicates by the shared `transactionKey()` (parcelNum+dealDate+price), and classifies every collision — cross-checked by re-running the already-tested `detectAmbiguousCollisions()` over the same union using the same 4-field (street/houseNumber/floor/areaSqm) agreement criterion; the two separately-coded implementations agreed exactly (0), which catches a coding bug in either module but would not catch a blind spot shared by both agreement definitions.

- STREET_RAW_ROWS = 3,986 · STREET_NORMALIZED_ROWS = 3,986 · NORMALIZATION_DROPS = 0
- STREET_UNIQUE_WITHIN_STREET_CORPUS = 3,986 (no street/street exact duplicates without a baseline match — TRUE_DUPLICATE_STREET_VS_STREET = 0)
- TRUE_DUPLICATE_ENTITY_VS_STREET = 1,673 (already in baseline, correctly not double-counted)
- AMBIGUOUS_COLLISIONS = **0** (confirmed twice, independently)
- **GENUINELY_NEW_STREET_ROWS = 2,313 — closes 74.1% of the original 3,122-row baseline gap**
- **AUGMENTED_UNIQUE = 4,831** (≤ 5,640 official — no overflow)
- DELTA_AFTER = **809** (down from 3,122)
- **COVERAGE_AFTER = 85.66%** (up from 44.65%)

**KIRYAT_HASHARON_STREET_AUGMENTATION = FAILED** — per Phase 11's own strict definition, any street failure anywhere in the run disqualifies it from PARTIAL and forces FAILED, even though every failure was safely caught and excluded (see §13, Architecture gate, for why this does **not** mean the mechanism itself is unsound).

Scorecard: [`street_recovery_scorecard.csv`](street_recovery_scorecard.csv) (sorted by most new rows; real acquisition order — via each street's `finishedAt` timestamp — was preserved for the underlying cumulative computation, not altered by the display sort).

**Top 10 streets by new rows:** אברהם שפיגלמן (304), דגניה (299), ד"ר יהודה פרח (158), אשר (155), יוסף (139), ברוש (123), תאשור (122), נופר (114), זאב ליבר (106), אייר (90).
**41 of 70 streets contributed zero incremental new rows** (already fully represented via baseline/earlier streets, or empty/failed).

## 5. Address quality (Phase 14)

| | Baseline | Street corpus |
|---|---|---|
| Valid address rate | 89.00% | **100.00%** |
| street="0" rate | 11.00% | **0.00%** (structurally impossible — a street-targeted query can't return an untagged-street row) |

## 6. Deal nature (Phase 15)

3,945 of 3,986 street-corpus rows carry a raw `dealNature`; **18 real distinct values** observed among them (the reported count of 19 includes the sentinel used for the 41 rows with none). Raw `dealNature` and normalized `propertyType` remain separate fields, unchanged classification logic.

## 7. PrevDeals (Phase 16)

2,659 raw prevDeal events extracted from street responses, all unique (no collisions), of which **1,639 are new** vs. the baseline's own historical tier. Kept entirely outside the top-level 5,640 reconciliation, as instructed.

## 8. Normalization (Phase 17)

0 drops this wave. `normalizeDeal()`'s only rejection condition is a missing/invalid/zero `dealAmount` — deterministic, not observed on any street-corpus row.

**Disclosed limitation:** this figure is the runner's own per-street count, summed by the aggregator — the aggregator does not (and cannot, since raw pre-normalization items aren't persisted in the committed street-result files) independently re-derive it from raw data, unlike the ambiguous-collision count, which IS cross-checked by a second implementation (§4). A runner-side undercount would propagate as a false "0 drops" with no independent check to catch it. Not observed as a problem this run — flagged as a structural gap in the verification chain, not a suspected error.

## 9. Request economics (Phase 18)

74 `/deal-data` responses captured, 0 retries, 70 total live attempts, 448.0s elapsed (6.4s/street average), **0.03 requests per genuinely-new transaction** (2,313 new rows for 70 requests).

## 10. Residual gap explanation (Phase 19)

Of the 809 rows still missing after augmentation:

- **(A)** 2 streets (דגניה, אברהם שפיגלמן) report `total_fetch=2` — up to ~34 additional rows sit behind an unattempted second fetch (not attempted this wave, per the hard boundary).
- **(B)** 7 of 70 streets yielded no usable rows (all `FAILED_IDENTITY`, §3) — a real, bounded enumeration gap, not silently absorbed.
- **(C)** 11.00% of the baseline's own rows have no identifiable street (`street="0"`) — structurally unreachable by any street-targeted query, regardless of depth.
- **(D)** No source-layer mismatch evidenced this wave.
- **(E)** 0 normalization drops.
- **(F)** Remainder unattributed — plausibly a mix of (A)-(C) plus streets/entities never targeted at all.

## 11. Street fetch-2 decision gate (Phase 20) — **NOT executed**

`IS_STREET_FETCH2_THE_NEXT_LOGICAL_EXPERIMENT = YES` — two streets exposed `total_fetch>1` with real remaining delta.

**Preferred candidate:** אברהם שפיגלמן (streetId=74000875), total_rows=533, total_fetch=2, fetch1_rows=500.

No live fetch2 request was made.

## 12. Scale implication (Phase 21) — estimated only, not executed

KIRYAT_STREET_COUNT=70, OTHER_PARTIAL_STREET_COUNT=374 (of the 444 measured in Wave 0G-17), ESTIMATED_FETCH1_REQUESTS_FOR_OTHER_PARTIALS ≈ **374** (scaling by this run's 70 base attempts, 1 per street — not measured for any other entity, and other entities' contamination/empty rates may differ). Note: this run actually captured 74 `/deal-data` exchanges (§9) for 70 streets, since a handful fired more than one; scaling from that observed rate instead gives ≈396 — both are estimates, not measurements, and the true figure for other entities is unknown until run.

## 13. Architecture gate (Phase 22)

**ENTITY_PLUS_STREET_ARCHITECTURE = PROVEN.**

This is deliberately decoupled from §4's FAILED completeness verdict — the two ask different questions. Phase 11 asks "does *this run's* number cleanly reconcile to 5,640" (any street failure forces FAILED there, even a safely-caught one). Phase 22 asks "is the *architecture* sound", and its own PROVEN criteria explicitly require "runner fails closed" as a positive property — exactly what the 7 FAILED_IDENTITY streets demonstrate (contamination detected and excluded whole, never partially smuggled in). Of the 6 PROVEN criteria: four are measured from this run's own numbers (street enumeration complete — 70/70 attempted; acquisition works at scale — 63/70 non-failed; no ambiguous collision; material coverage increase — +41 points); the other two (runner fails closed; canonical/Supabase unreachable) are properties of the code itself, verified by construction and by ECC code + security review rather than computed as run-time metrics — stated as such, not implied to be measurements.

**FULL_KIRYAT_HASHARON_TOP_LEVEL_COMPLETENESS = FAILED** (mirrors §4 — this specific run did not cleanly reconcile to 5,640/5,640, due to the disclosed identity violations, not an unproven mechanism).

## 14. Tests (Phase 23)

- `lib/__tests__/nadlanCatalog.test.ts` — 46 tests (new "TEST K" block: street-catalog parser, duplicate/invalid-entry rejection, no hardcoded 70).
- `scripts/__tests__/wave0g18StreetRunner.test.ts` — 22 tests: SUCCESS_EMPTY vs failure, fetch1-only rejection, PARTIAL_MORE_FETCHES_INDICATED row retention, wrong-parent-identity fails closed (incl. mixed-batch), normalization-wipeout classification, contamination reporting, resume-contract-mismatch source checks, canonical/Supabase unreachability, and a dedicated regression test for the base_id capture bug found in ECC round 1.
- `scripts/__tests__/wave0g18Aggregate.test.ts` — 8 tests: entity/street duplicate collapse, street/street duplicate collapse, ambiguous collision isolation (both street/street and baseline/street cases), legitimate repeat-sale preservation, and a regression test for a second direct-execution-guard bug found while writing these tests (the aggregator's `main()` ran as an import side effect during `vitest run` — same bug class Wave 0G-16 first hit, fixed the same way).

## 15. Quality gates (Phase 24)

- Full suite: **348/348 passing**
- `npx tsc --noEmit`: clean
- `npm run build`: clean

## 16. Canonical safety (Phase 25)

- ROWS BEFORE = 12,642, ROWS AFTER = 12,642
- SHA BEFORE = SHA AFTER = `18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f`
- Supabase writes = 0, importer runs = 0, deployments = 0

## 17. Security gate (Phase 26)

Repo-wide grep of every new/tracked file for token/auth/cookie/session/credential-value patterns: **0 matches**. Every persisted street result carries only decoded, non-credential envelope fields (`base_id`/`base_name`/`fetch_number`) and normalized deal rows — never raw request bodies, headers, or the opaque `##` payload. **SECURITY_SCAN = PASS.**

## 18. ECC review — two rounds

**Round 1 (pre-execution, runner + catalog code only — the aggregator did not exist yet):** planner, specialist, database-reviewer, silent-failure-hunter, security-reviewer, code-reviewer. Found and fixed one CONFIRMED, real correctness bug (independently flagged by three reviewers): the response-capture handler's `base_name==="streetCode"` check was a no-op — both branches of an if/else performed the identical assignment — and `base_id` was never checked, so a stray or wrong-street exchange could have been silently captured as the current street's data. Fixed by requiring an exact `base_name`+`base_id` match, with a new `WRONG_STREET_ID` classification and a dedicated regression test. Also fixed: `rowsOtherEntity` overcounting on mixed-contamination batches, and a resumed-only tail run leaving the diagnostic manifest stale.

**Round 2 (post-execution, full final state including the newly-written aggregator and this report):** same 6 roles. All 6 verdicts: **PASS**. Findings and fixes:
- (silent-failure-hunter, CONFIRMED) the completeness gate (§4) checked only `status==="FAILED_IDENTITY"`, not any failure — a street failing with `FAILED_NORMALIZATION`/`FAILED_NETWORK`/`FAILED_OTHER` could theoretically let a broken run report COMPLETE. Fixed to `failedResults.length > 0`.
- (silent-failure-hunter, CONFIRMED) the aggregator re-fetched the street catalog live rather than trusting the run's own Phase 3 capture — a street removed from the catalog between the live run and aggregation would be silently excluded with no error. Fixed with an explicit drift check against the persisted `street_manifest_raw.json`, failing loudly on any mismatch.
- (code-reviewer, should-fix) the Phase 13 recovery-distribution loop used a naive dedup with no ambiguous-collision awareness, which could diverge from `classifyTransactionGroups`' own union under a future run with `ambiguousCollisions>0` — not manifested this run (0 collisions) but not enforced either. Fixed by sharing the same `ambiguousKeys` exclusion set and adding a `cumulative === augmentedUnique` fail-closed assertion.
- (code-reviewer, nitpicks) two unnecessary `any` casts and a Set recreated inside a loop — both fixed.
- (planner) a real miscount (§6, now corrected to 18 real values + 1 sentinel), a broken cross-reference (§4, now points to §13), a missing headline percentage (§4, now states 74.1%), and the most substantive finding — quantifying that 686 of the 809-row residual gap is discarded-but-matching data from mixed-contamination streets, not truly unreachable (now in §3).
- (database-reviewer) confirmed the aggregator's arithmetic identity and 3-way-collision handling are correct by code inspection; recommended softening "confirmed twice, independently" since both cross-check implementations share the same 4-field agreement definition (now reworded, §4).
- (security-reviewer) full PASS — 0 credential/token/session values found across all 13 files about to be committed; confirmed all quoted entity/street ids are public catalog metadata, not secrets.
- (specialist) full PASS — all technical claims about the mechanism (base_name/base_id/fetch_number contract, total_fetch semantics, the `neighborhoodId="0"` pattern) verified against the raw evidence.

Every code-level fix from both rounds was re-verified: `npx tsc --noEmit` clean, full test suite passing, the aggregator re-run producing byte-identical coverage numbers (no `INTEGRITY_FAIL`, no `CATALOG_DRIFT` thrown).

## 19. Graphify boundary check

Confirmed by source inspection (not just by absence of writes this run): neither `audit-wave0g18-street-runner.ts` nor `audit-wave0g18-aggregate.ts` references `deals.json`, `neighborhoods.json`, `supabase`, or `createClient` anywhere in executable code; every persisted write passes through `assertSafeShadowOutputPath()`, which itself was not modified this wave.

- CANONICAL_WRITE_REACHABLE = **NO**
- SUPABASE_WRITE_REACHABLE = **NO**
- VALUATION_MUTATION_REACHABLE = **NO**
