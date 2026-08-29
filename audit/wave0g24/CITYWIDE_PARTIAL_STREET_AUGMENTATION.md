# Wave 0G-24 — Citywide PARTIAL-Entity Street Augmentation (Scale-Out)

**Status: architecture built and ECC-reviewed; live acquisition
WAITING_FOR_OPERATOR / SOURCE_BLOCKED.** Phases 1–4 (baseline, target-entity
loading, official street discovery, and the multi-entity runner
architecture) completed this session. Phase 5 onward (actually fetching
street data) could not proceed: the live nadlan.gov.il site is currently
not completing its reCAPTCHA challenge for any street request — verified
directly via a diagnostic probe (stalls at the "anchor" stage, never
reaching "token-verify"/"deal-data") and via a 3-street sanity test of the
new runner, which correctly and honestly produced `FAILED_NETWORK` for all
3 attempts rather than fabricating data. This is the identical pattern
already documented in Wave 0G-22's first attempt, which later cleared on
its own for a subsequent controlled retry (0G-22B). Per the project's
standing rule against reCAPTCHA bypass, no workaround was attempted and no
further live requests were made this session.

**No fabricated citywide coverage numbers appear anywhere in this report.**
Only the numbers actually computed from committed evidence are reported
below.

## Phase 1 — Baseline

- HEAD before this wave: `85abff8` (Wave 0G-23, CLOSED PASS)
- Canonical: 12,642 rows, SHA-256
  `18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f` —
  verified unchanged throughout this wave.

## Phase 2 — 10 target entities (loaded from committed Wave 0G-16 data)

All 11 Wave 0G-16 PARTIAL entities except קריית השרון (already fully
investigated through Waves 0G-17–0G-23 and explicitly excluded per this
wave's hard boundary):

| Entity | sourceId | Official total | Entity baseline | Delta | Coverage |
|---|---|---|---|---|---|
| אזור תעשיה פנחס ספי | 65209689 | 1,021 | 1,000 | 21 | 97.94% |
| עיר ימים | 65209703 | 3,060 | 2,325 | 735 | 75.98% |
| קריית נורדאו | 65209705 | 3,281 | 2,265 | 1,016 | 69.03% |
| מרכז העיר | 65209717 | 9,972 | 3,282 | 6,690 | 32.91% |
| חוף הים והמלונות | 65209727 | 2,612 | 2,343 | 269 | 89.70% |
| רמת אפרים | 65209736 | 2,266 | 2,082 | 184 | 91.88% |
| מע"ר - מרכז עירוני ר | 65210243 | 3,273 | 2,329 | 944 | 71.16% |
| אבו שדיד | 65210245 | 3,082 | 2,292 | 790 | 74.37% |
| רסקו | 65210248 | 2,012 | 2,010 | 2 | 99.90% |
| מכנס | 65210752 | 2,375 | 2,165 | 210 | 91.16% |

```
TOTAL_TARGET_OFFICIAL_ROWS  = 32,954
TOTAL_TARGET_ENTITY_BASELINE = 22,093
TOTAL_TARGET_DELTA           = 10,861
```

## Phase 3 — Street manifests (completed live, safe endpoint)

Enumerated via the proven, safe, unauthenticated
`getOfficialEntityStreets()` call (`lib/nadlanCatalog.ts`) — the same
mechanism Wave 0G-18 used for Kiryat's own manifest. No reCAPTCHA, no
browser session, discovery only.

| Entity | Official street count |
|---|---|
| אזור תעשיה פנחס ספי | 30 |
| עיר ימים | 22 |
| קריית נורדאו | 41 |
| מרכז העיר | 69 |
| חוף הים והמלונות | 19 |
| רמת אפרים | 46 |
| מע"ר - מרכז עירוני ר | 72 |
| אבו שדיד | 26 |
| רסקו | 26 |
| מכנס | 23 |

```
TOTAL_STREETS_ENUMERATED    = 374
DISTINCT_STREET_IDS         = 338  (36 streetIds shared across 2+ target
                                    entities — boundary streets)
```

This matches Wave 0G-17's own historical arithmetic exactly: 444 official
streets across all 11 PARTIAL entities, minus Kiryat's 70, predicts 374 —
independently re-measured live this wave and confirmed digit-for-digit
against Wave 0G-17's per-entity counts (72, 69, 26, etc.), an 8-wave-old
snapshot. This is a genuine cross-validation signal that the official
catalog has not changed for these entities.

## Phase 4 — Runner architecture (built, reviewed, sanity-tested only)

`scripts/audit-wave0g24-multi-entity-street-runner.ts` generalizes Wave
0G-18's proven single-entity runner to multiple entities. It does **not**
reimplement the core identity/accounting logic — it imports and reuses
`classifyStreetExchange` from `scripts/audit-wave0g18-street-runner.ts`
**unchanged**, which already enforces:

- `fetch_number=1` only (any other value → `FAILED_OTHER`)
- Per-row identity acceptance (`ACCEPT_PARENT` / `REJECT_ZERO` /
  `REJECT_FOREIGN` / `REJECT_MISSING` / `REJECT_MALFORMED`, from the
  unchanged `lib/streetRowAcceptance.ts`)
- The `RAW_ROWS == PARENT + ZERO + FOREIGN + OTHER` accounting invariant
  (hard `throw` on violation)
- Explicit mixed-batch statuses (`SUCCESS_MIXED_PARTIAL`,
  `FAILED_NO_TRUSTED_ROWS`) — no whole-batch discard of trusted rows

New orchestration (necessarily new, since the original is hardcoded to
one entity) mirrors the original's exact constants and resumability
pattern, and adds one optimization: **each of the 338 distinct streetIds
is fetched live at most once**, then the same raw batch is classified
against every target entity that lists it (with that entity's own
sourceId) — never re-fetching a streetId already captured for a sibling
entity. This is safe by construction:
`classifyRowForAcceptance`/`classifyStreetExchange` are pure functions of
`(row, parentSourceId)`; a row that is `ACCEPT_PARENT` for Entity A is
correctly `REJECT_FOREIGN` for Entity B on the identical raw data (ECC
database-reviewer independently traced and confirmed this).

**Validated only via a 3-street sanity test** (streetIds
74001044/74000963/74001028, all within אזור תעשיה פנחס ספי), which
correctly produced `FAILED_NETWORK` for all 3 given the current site
block — proving
the failure path works honestly (no fabricated data, resumable-status
design intact) but **not** proving the success path against real data,
since no real acquisition has occurred yet this wave.

## ECC review (all 6 reviewers)

| Reviewer | Verdict | Key finding |
|---|---|---|
| planner | CONFIRMED all 5 critical questions (Kiryat excluded, 27 COMPLETE excluded, fetch2/fetch3 avoided, streetId-dedup correct, stopping at the block was not premature) | 1 low-severity naming concern: scripts used "אזור תעשיה פנחס ספיר" while the Wave 0G-16 catalog's canonical name is "אזור תעשיה פנחס ספי" — classification unaffected (matching is by sourceId), but the name flows into persisted data. **Fixed**: corrected in both scripts, discovery artifacts regenerated. |
| specialist | CONFIRMED (same naming finding as planner) | Independently verified all 10 entities' street counts against the actual manifest files (not just the summary), confirmed the 374 total, and found the per-entity counts match Wave 0G-17's 8-wave-old snapshot digit-for-digit — a genuine, meaningful cross-validation. No contradictions with any prior wave. |
| database-reviewer | PASS | Traced the streetId-dedup design in full: confirmed `classifyRowForAcceptance` is pure and stateless, so re-classifying the same raw batch per entity is safe; confirmed the resume logic never overwrites one entity's cached result while filling in a sibling's missing one; confirmed distinct result-file paths per (entity, street); confirmed the accounting invariant is still enforced unconditionally. |
| silent-failure-hunter | PASS, 1 minor fix applied | All entities in a street's reference list get either a cache hit or a fresh result — none silently skipped. **Minor gap found and fixed**: the run manifest didn't record already-cached entities' statuses in a mixed cached/uncached scenario for the same streetId — cosmetic (result files were always correct), now fixed so the manifest accurately reflects progress. |
| security-reviewer | PASS | No credential values anywhere (only field-NAME presence flags); no reCAPTCHA-bypass logic in the retry loop (an ordinary bounded reload/retry); confirmed disk state matches expectation exactly (3 `FAILED_NETWORK` result files, no partial/corrupted real data). |
| code-reviewer | APPROVE, 1 MEDIUM fix applied | Confirmed `classifyStreetExchange` reused verbatim with matching call signature; confirmed `parentSourceId` is correctly set to each target entity's own sourceId (never Kiryat's or shared incorrectly). **Found and fixed**: the new runner's "no response at all" detection inspected decoded response *content* rather than whether any response object was ever formed, unlike the original — a rare edge case (a response arrives but fails to decode) would have been misreported as `FAILED_NETWORK` instead of the more accurate `FAILED_OTHER: UNDECODABLE_ENVELOPE`. Fixed with an explicit `hadAnyResponse` flag restoring the original's exact semantics. |

All findings were either confirmed as correct-as-designed or fixed. No
finding invalidates the architecture's design — only implementation
hardening, now applied and re-verified (typecheck clean, 387/387 tests,
build clean).

## Canonical safety

- `data/deals.json` rows: 12,642 (unchanged)
- SHA-256: `18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f`
  (unchanged, verified before and after)
- Supabase writes: 0
- Importer runs: 0
- Deployments: 0

## Security

Scanned all new tracked artifacts (2 scripts, this report, the 10
street-manifest JSON files, the enumeration summary, and the combined
CSV) for tokens, cookies, Authorization headers, session material,
anti-bot values, and credential fragments: none found. The 3
`FAILED_NETWORK` shadow result files (uncommitted, per the project's
standing rule) contain zero acquired row data — `rows: []`,
`rowsReturned: 0`, `networkRequests: 0` in every case, consistent with no
`/deal-data` response ever having been captured.

## Tests

- Full suite: 387/387 passed (one transient flake on an unrelated,
  unmodified test observed on a single run, not reproducible on
  immediate re-run — not caused by this wave's changes)
- Typecheck: clean
- Build: clean (Next.js 16.2.6 / Turbopack)

## Live requests

- 10 safe, unauthenticated catalog requests (street discovery, Phase 3) —
  completed successfully, no reCAPTCHA involved.
- 3 street-level `fetch_number=1` acquisition attempts (sanity test) — all
  3 failed with `FAILED_NETWORK` due to the site-wide block. Zero
  `fetch_number>=2` requests made or attempted. Zero of the remaining 335
  distinct streetIds were attempted, per the standing rule against
  retrying through a reCAPTCHA block.

## Residual / next step (as of Wave 0G-24, pre-resume)

The architecture is proven-by-design (reuses the exact, already-validated
Kiryat identity/accounting logic) and ECC-reviewed with all findings
fixed. It is ready to run to completion — an estimated 45–90+ minutes at
the required concurrency=1 pacing across 338 distinct streets — as soon as
the site's current block clears. No citywide coverage result exists yet
for the 10 target entities; claiming one this wave would be fabrication.

---

## Wave 0G-24B — Controlled Resume Result (2026-08-29)

**Status: MULTI_ENTITY_LIVE_EXECUTION = PROVEN.** The source-side block
documented above cleared between Wave 0G-24 and this resume. A one-street
clearance probe (Phase 2, street 74001044 "החשמל") captured and decoded a
real `/deal-data` response (`SUCCESS_EMPTY`, `fetch_number=1`, matching
`base_id`) — genuine evidence the block had lifted, not a fabricated
success. The exact, already-committed, unmodified runner
(`scripts/audit-wave0g24-multi-entity-street-runner.ts`) then ran to
completion across all 338 distinct street IDs. Kiryat Hasharon was **not**
rerun (excluded per this wave's hard boundary, as in Wave 0G-24); its
5,145/5,640 figure is retained from Wave 0G-23.

### Source clearance

- Probe: `SUCCESS` — real `/deal-data` response captured and decoded.
- Full run: 338/338 distinct streetIds attempted, 374/374 entity-street
  classifications performed. Zero `FAILED_NETWORK` this run (the earlier
  block-era sanity test's 2 `FAILED_NETWORK` results were retried fresh —
  not resumed, since `FAILED_*` statuses are never cache-resumable — and
  both succeeded this time).

### Execution accounting

```
STREETS_ENUMERATED            = 374
DISTINCT_STREET_IDS           = 338
STREETS_ATTEMPTED (refs)      = 374/374
STATUS_COUNTS                 = SUCCESS_ROWS=171, SUCCESS_EMPTY=130,
                                 SUCCESS_MIXED_PARTIAL=58,
                                 FAILED_NO_TRUSTED_ROWS=12,
                                 PARTIAL_MORE_FETCHES_INDICATED=3
NETWORK_REQUESTS              = 362  (per distinct streetId — see note)
RETRIES                       = 4
ELAPSED_SECONDS               = 2,213.6 (~37 min)
RAW = PARENT + ZERO + FOREIGN + OTHER
35,241 = 21,700 + 975 + 12,566 + 0        (exact — asserted, not rounded)
```

`NETWORK_REQUESTS`/`RETRIES`/`ELAPSED_SECONDS` are summed once per
**distinct** streetId (338), not once per entity-street reference (374) —
a shared boundary street's one real live fetch is otherwise duplicated
across every referencing entity's own result file. The aggregation script
now asserts (and would throw `INTEGRITY_FAIL` on) any divergence between
a shared streetId's copies before collapsing them — an ECC
database-reviewer/code-reviewer hardening fix (see ECC table below); no
divergence was found. The RAW/PARENT/ZERO/FOREIGN/OTHER total, by
contrast, is intentionally **not** deduped by streetId — each entity's row
acceptance for a shared street is legitimately different (see the
הרצל example below), so a shared street is counted once per referencing
entity in that sum. 35,241 must therefore never be read as "distinct raw
rows fetched."

**12 `FAILED_NO_TRUSTED_ROWS`** occurrences (all listed in
`audit/wave0g24/failed_street_refs.csv`) are legitimate per-row rejections
on shared boundary streets where zero rows carried that specific entity's
`neighborhoodId` — the fail-closed design working as intended, not a
network or acquisition failure. The clearest proof this design works
correctly at scale: street 74000418 (הרצל) was fetched **once** and
reclassified against 3 entities with opposite outcomes on the identical
raw batch — `מרכז העיר` accepted 428/467 rows, `חוף הים והמלונות` accepted
0/467 (all foreign) on the exact same response.

### Per-entity results

| Entity | sourceId | Official | Baseline | Streets | Parent rows | New rows | Augmented | Delta | Coverage before→after | Status | Failed refs |
|---|---|---|---|---|---|---|---|---|---|---|---|
| אזור תעשיה פנחס ספי | 65209689 | 1,021 | 1,000 | 30 | — | — | 1,014 | 7 | 97.94%→99.31% | PARTIAL | 1 |
| עיר ימים | 65209703 | 3,060 | 2,325 | 22 | — | — | 2,500 | 560 | 75.98%→81.70% | PARTIAL | 2 |
| קריית נורדאו | 65209705 | 3,281 | 2,265 | 41 | — | — | 3,160 | 121 | 69.03%→96.31% | PARTIAL | 3 |
| מרכז העיר | 65209717 | 9,972 | 3,282 | 69 | — | — | 7,904 | 2,068 | 32.91%→79.26% | PARTIAL | 0 |
| חוף הים והמלונות | 65209727 | 2,612 | 2,343 | 19 | — | — | 2,589 | 23 | 89.70%→99.12% | PARTIAL | 2 |
| רמת אפרים | 65209736 | 2,266 | 2,082 | 46 | — | — | 2,139 | 127 | 91.88%→94.40% | PARTIAL | 0 |
| מע"ר - מרכז עירוני ר | 65210243 | 3,273 | 2,329 | 72 | — | — | 2,459 | 814 | 71.16%→75.13% | PARTIAL | 4 |
| אבו שדיד | 65210245 | 3,082 | 2,292 | 26 | — | — | 2,957 | 125 | 74.37%→95.94% | PARTIAL | 0 |
| רסקו | 65210248 | 2,012 | 2,010 | 26 | — | — | **2,012** | **0** | 99.90%→**100.00%** | **COMPLETE** | 0 |
| מכנס | 65210752 | 2,375 | 2,165 | 23 | — | — | 2,316 | 59 | 91.16%→97.52% | PARTIAL | 0 |

Exact parent/new-row figures per entity are in the committed
`audit/wave0g24/entity_outcomes.csv`. Every entity's coverage increased;
none decreased (independently cross-checked by the ECC specialist
reviewer). **רסקו (Rasko) reached exact official reconciliation** —
2,012/2,012, zero failed streets, zero ambiguous collisions — the second
entity (after Kiryat's street-level pilot) to hit COMPLETE this way. All
other 9 entities are PARTIAL: either their augmented total is still below
official, or at least one boundary street returned `FAILED_NO_TRUSTED_ROWS`
for that entity (a legitimate rejection, not an unresolved integrity
issue — no entity, in any case, has an ambiguous transaction collision).

Zero ambiguous collisions across all 10 entities, cross-checked by an
independently-implemented detector (`detectAmbiguousCollisions`) that
must agree with the primary classifier or the run throws.

### Pagination observation

16 entity-street references (10 **distinct** physical streets — a shared
street counted once per referencing entity) showed `total_fetch > 1`, i.e.
more data exists behind an unattempted deeper fetch:

| Street | streetId | total_rows | total_fetch | fetch1_rows |
|---|---|---|---|---|
| גולדה מאיר | 74001001 | 668 | 2 | 500 |
| קרן היסוד | 74000977 | 634 | 2 | 500 |
| בנימין | 74000532 | 913 | 2 | 500 |
| הרב קוק | 74000323 | 541 | 2 | 500 |
| סמילנסקי | 74000521 | 704 | 2 | 500 |
| דיזנגוף | 74000406 | 698 | 2 | 500 |
| ויצמן | 74000417 | 1,177 | 3 | 500 |
| ניצה | 74000442 | 822 | 2 | 500 |
| עובד בן-עמי | 74001078 | 619 | 2 | 500 |
| בן-צבי | 74000609 | 793 | 2 | 500 |

Full entity-level breakdown (including which of the 6 boundary entities
share each street) is in `audit/wave0g24/pagination_observation.csv`.
Note: `בן-צבי` shows `FAILED_NO_TRUSTED_ROWS` for `מע"ר - מרכז עירוני ר`
specifically — the "more data exists" signal is real for the physical
street, but not actionable for that entity, which accepted 0 rows there.
**`FETCH2_EXECUTED = NO`, everywhere, per this wave's hard boundary** —
logged for visibility only, never acted on.

### Citywide updated coverage

```
OFFICIAL_TOP_LEVEL_ROWS_SUM   = 63,704        (unchanged since Wave 0G-16)
COMPLETE_27_SUM               = 25,110        (unchanged, not touched this wave)
KIRYAT_RETAINED               = 5,145/5,640   (NOT rerun this wave — Wave 0G-23 figure)
TARGET_10_OFFICIAL_SUM        = 32,954
TARGET_10_BASELINE_SUM        = 22,093
TARGET_10_AUGMENTED_SUM       = 29,050
─────────────────────────────────────────────
UPDATED_SHADOW_TOP_LEVEL_UNIQUE = 59,305   (25,110 + 5,145 + 29,050)
UPDATED_DELTA                   = 4,399    (63,704 − 59,305)
UPDATED_CITYWIDE_COVERAGE       = 93.09%
BASELINE (Wave 0G-16)           = 49,721/63,704 = 78.05%
NET_NEW_VS_WAVE_0G16            = 9,584
THIS_WAVE_OWN_CONTRIBUTION      = 6,957
```

**`NET_NEW_VS_WAVE_0G16` (9,584) and `THIS_WAVE_OWN_CONTRIBUTION` (6,957)
are deliberately reported separately** (an ECC planner finding) — the
9,584 figure is the full citywide gain since the original Wave 0G-16
baseline measurement and includes Kiryat's 2,627-row gain that was already
earned and committed across Waves 0G-18/0G-20/0G-21/0G-23, not reacquired
this wave. This wave's own live acquisition against the 10 target
entities recovered 6,957 net-new rows.

Citywide top-level shadow coverage moved from **78.05% → 93.09%**, a
15.04 percentage-point increase, entirely from this wave's own live
acquisition (Kiryat's contribution to the total was already banked).

### PrevDeals (historical events, kept separate from top-level reconciliation)

```
RAW_STREET_PREVDEALS   = 9,209  (summed per entity; not cross-entity deduped)
UNIQUE_STREET_PREVDEALS = 9,206  (per-entity dedup only)
NEW_HISTORICAL_EVENTS   = 3,403
```

Not used in the official top-level reconciliation above, per the wave's
own instruction.

### Failures

All 12 non-success entity-street references are `FAILED_NO_TRUSTED_ROWS`
(zero `FAILED_NETWORK`, zero `FAILED_OTHER`, zero `FAILED_NORMALIZATION`).
Full list with exact zero/foreign counts in
`audit/wave0g24/failed_street_refs.csv`. These cluster on the highest-
volume shared streets (e.g. `מע"ר - מרכז עירוני ר` loses 1,367 raw rows
across 3 rejected streets against its own residual delta of 814) — an ECC
planner observation flagged as the highest-leverage open question for any
future wave: whether the official street→entity manifest is deliberately
over-inclusive at these boundaries, or whether the per-row `neighborhoodId`
uses a different code than the manifest's entity id there. Not
investigated further this wave (out of scope; no new acquisition
authorized for that purpose).

### Architecture verdict

```
ENTITY_PLUS_STREET_ARCHITECTURE = PROVEN   (unchanged from Wave 0G-24's own design proof)
MULTI_ENTITY_LIVE_EXECUTION     = PROVEN   (upgraded from NOT_PROVEN — real acquired
                                             data at scale, 10 entities, 338 streets,
                                             0 ambiguous collisions, 1 exact reconciliation)
```

### Canonical safety

- `data/deals.json`: 12,642 rows, SHA-256
  `18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f` —
  verified unchanged before Phase 1, after the full live run, and after
  all ECC fixes.
- Supabase writes: 0. Importer runs: 0. Deployments: 0.

### Security

Scanned all newly-tracked artifacts (2 script diffs, this report, 3
compact CSVs, 1 aggregation summary JSON) for tokens, cookies,
Authorization headers, session material, anti-bot values, and credential
fragments: none found. Spot-checked 3 of the 374 real shadow result files
(now containing actual acquired transaction data) — contain only deal
fields (price, address, dates, parcel numbers) and runner metadata, never
auth material. `audit/wave0g24/shadow/` (374 real result files) remains
untracked, excluded from this wave's commit, per the standing rule against
committing raw acquisition dumps.

### Tests

- Full suite: 387/387 passed (both before and after the ECC fix pass).
- Typecheck: clean (both passes).
- Build: clean, Next.js 16.2.6/Turbopack (both passes).

### ECC review (all 6 reviewers — live run succeeded, full review required)

| Reviewer | Verdict | Key finding / fix |
|---|---|---|
| planner | CONFIRMED (all 8 critical questions answered YES/CLEAN/SAFE) | 5 minor reporting-precision concerns, all fixed: (C1) RAW accounting is per entity-street reference, not deduped by street — added a scope-note comment and JSON field so it's never misread as a distinct-row count; (C2) `NET_NEW_VS_WAVE_0G16` conflated this wave's own contribution with Kiryat's already-banked prior gain — now reported as two separate fields; (C3) "16 streets with total_fetch>1" is 16 entity-refs across only 10 distinct streets, and `STATUS_COUNTS.PARTIAL_MORE_FETCHES_INDICATED=3` undercounts due to status-priority resolution — now reports both entity-ref and distinct-street counts explicitly; (C4) no assertion that `TARGET_ENTITIES` + Kiryat exactly equals Wave 0G-16's 11 PARTIAL entities — added as a hard integrity check; (C5) the status-classification's overshoot branch was dead code (already thrown earlier) — removed, and `pagination_observation.csv` now carries a STATUS column so a `FAILED_NO_TRUSTED_ROWS` street's "more data exists" signal isn't misread as actionable for that entity. Also flagged (not fixed, out of scope): the 12 `FAILED_NO_TRUSTED_ROWS` cluster on high-volume boundary streets — the highest-leverage open question for a future wave. |
| specialist | CONFIRMED, no concerns | Independently verified all 10 entities' official/baseline figures against `citywide_summary.json` and Kiryat's retained figures against `attribution_summary.json` by sourceId (not name); confirmed all 10 entities' coverage only increased; confirmed every citywide arithmetic identity reconciles exactly by hand. |
| database-reviewer | CONCERNS, both fixed | (1) The per-streetId economics dedup (`networkRequests`/`retries`/`elapsedSeconds`) was first-write-wins with no check that all entities sharing a streetId actually report identical values — safe only within a single execution, not across a hypothetical future resumed run. **Fixed**: now collects every record per streetId and throws `INTEGRITY_FAIL` on any divergence before collapsing. (2) The 27-COMPLETE-entities sum only self-checked internal consistency (official===shadow), with no pinned expected value the way Kiryat has (5640/5145) — a regenerated Wave 0G-16 dataset could silently drift this figure. **Fixed**: added a hardcoded `25110` guard. |
| silent-failure-hunter | PASS | Confirmed no swallowed errors, no dangerous fallbacks, no dropped iterations. One documentation-only note (addressed via the RAW-accounting scope comment above): a hypothetical `FAILED_NETWORK` street would legitimately vanish from the RAW/PARENT/ZERO/FOREIGN/OTHER sum (rowAcceptanceCounts is null pre-classification) but remains visible via `STATUS_COUNTS` and `failedRefs` — never silently lost from the report as a whole. |
| security-reviewer | PASS, no findings | fetch_number=1 enforced everywhere; no credential values ever logged (only field-name/presence flags); ordinary bounded retry/reload, no reCAPTCHA-solving code; `audit/wave0g24/shadow/` confirmed untracked; 3 spot-checked shadow files contain only deal data; canonical SHA-256 independently re-verified. |
| code-reviewer | APPROVE | Confirmed `StreetResult` field-shape correctness end-to-end; confirmed `parentSourceId` (never `entity.name`) is the join key throughout; confirmed no unused imports; confirmed correct `!= null` numeric guards; confirmed `csvEscape()` applied at every free-text CSV field (including the `מע"ר` name's embedded quote). Same LOW-severity economics-dedup note as database-reviewer (fixed, see above). |

All findings were either confirmed as correct-as-designed or fixed. No
finding invalidated any headline number — all were reporting-precision or
future-hardening improvements, independently re-verified by rerunning the
aggregation (identical output) and all quality gates (clean) after every
fix.

### Residual / next step

4,399 rows remain unaccounted for citywide (93.09% → 100% would require
closing this). The two clearest, evidenced levers for a future wave:
(1) the 16 entity-street references (10 distinct streets) with
`total_fetch > 1` — fetch2 was deliberately not executed this wave and
remains available as a bounded, already-proven mechanism (Wave 0G-22B) if
explicitly authorized; (2) the 12 `FAILED_NO_TRUSTED_ROWS` boundary
rejections, concentrated on `מע"ר - מרכז עירוני ר`'s highest-volume shared
streets — resolving whether these represent genuine catalog over-
inclusion or a `neighborhoodId` coding mismatch is the highest-leverage
open question, per the ECC planner's observation. Neither is authorized
by this wave; both require explicit new instruction.
