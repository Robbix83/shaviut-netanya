# Wave 0G-16 — Citywide Shadow Coverage Audit (All 38 Official Entities)

## Baseline

BASELINE_HEAD=ab3bbbf (Wave 0G-15 close)

Canonical:
- ROWS=12642 (unchanged, before and after)
- SHA256=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f (unchanged, before and after)

## Phase 2 — Official Catalog

Loaded live via `lib/nadlanCatalog.ts`'s `getOfficialNetanyaEntities()` (plain unauthenticated GET, no reCAPTCHA):

- CATALOG_ENTITY_COUNT=38
- UNIQUE_SOURCE_IDS=38
- UNIQUE_NAMES=38

Not hardcoded — this is a live read this wave, matching the count referenced in prior waves' evidence but independently re-confirmed, not assumed.

## Phase 3 — Citywide Runner

Built [`scripts/audit-wave0g16-citywide-shadow.ts`](../../scripts/audit-wave0g16-citywide-shadow.ts): a coverage-driven runner trying, per entity, the 8 proven-safe surfaces in fixed priority order (date_desc fetch1/2, date_asc fetch1/2, price_desc/asc fetch1, rooms_desc/asc fetch1), stopping the instant the running deduped unique top-level count equals official `total_rows`, and failing closed the instant it exceeds it. Reuses every already-tested primitive from `lib/nadlanCatalog.ts`, `lib/nadlanAcquisition.ts`, `lib/dealNormalization.ts`, `lib/shadowRebuild.ts` — no new acquisition technique.

**Live validation before the full run** caught and fixed 2 real bugs:
1. The date-sort fetch2 surfaces initially clicked "הבא" only once; the proven pattern (Wave 0G-12/13) requires up to ~53 repeated clicks since the site paginates the UI in ~10-row increments while the underlying fetch stays at fetch_number=1 until a batch boundary is crossed. Fixed by porting the proven click-budget loop (`Math.ceil(500/rowsPerPage)+3`).
2. A single flaky sort-menu click (a Playwright locator reporting visible=true that lost visibility by click time — a real race) was propagating up and failing the ENTIRE entity instead of just that surface. Fixed by wrapping each surface's processing in its own try/catch with a 3-attempt retry using a fresh locator re-query.

Post-fix, the runner reproduced Wave 0G-15's exact Rasko result (2010/2012, delta=2, PARTIAL) independently, validated a fast-path small entity (COMPLETE after 1 request), and validated resume-from-cache.

## Pre-Flight ECC Review (before the live 38-entity run)

Per this wave's explicit instruction, planner/specialist/code-reviewer/security-reviewer reviewed the runner DESIGN before spending the live-request budget across all 38 entities.

| Reviewer | Verdict | Key finding | Fix |
|---|---|---|---|
| planner | NEEDS_FIXES_FIRST | Depth guard only rejected `fetch_number>2` flatly — an alternate-sort surface unexpectedly reaching `fetch_number=2` (never proven safe for those) would be silently accepted | Made the guard surface-aware: max proven depth is 2 for date sorts, 1 for everything else |
| specialist | NEEDS_FIXES_FIRST | Same finding, independently derived | Same fix |
| planner | — | Entity-level I/O (`saveResult`/`writeManifest`) sat outside the per-entity try/catch — a transient disk error could abort the remaining entities | Wrapped in their own try/catch; logs a warning and continues rather than aborting |
| planner | — | A `FAILED` result was cached and resumed forever, so a transient failure became permanent | `loadExistingResult()` now excludes `FAILED` from resume — always retried |
| code-reviewer | READY_TO_RUN | `--limit`/`--only` with a missing/invalid value silently processed 0 entities or crashed with a raw stack | Added clear `INVALID_ARG` errors for both |
| security-reviewer | READY_TO_RUN | No issues found | — |

All fixes applied and re-validated live against the same 2 test entities before the full run.

## Phase 4 — Full Citywide Live Run

Run in one long-running background process; log: [`audit/wave0g16/citywide_run.log`](citywide_run.log) (small enough — 18KB — to commit; covers the main 38-entity pass, including all 8 first-pass transient failures visible with timestamps). All 38 entities processed sequentially, single browser page, concurrency=1. The subsequent individual/batch retries for those 8 entities ran as separate ad-hoc invocations whose console output was not separately logged to a file — their key details (attempt counts, final outcomes) are transcribed into the table below instead.

**First pass: 8/38 entities (21%) failed transiently**, all with `IDENTITY_FAIL: EMPTY_RESULT` (a 0-row response body on entities with substantial known `total_rows`, not a genuine identity mismatch):

| Source ID | Name | Official total_rows | Attempts to reach terminal state |
|---|---|---|---|
| 65210196 | מחנה יעקב | 158 | 2 (fail, succeed) |
| 65210240 | קריית יצחק רבין | 874 | 2 (fail, succeed) |
| 65210752 | מכנס | 2,375 | 2 (fail, succeed) |
| 65210244 | בן ציון | 1,136 | 2 (fail, succeed) |
| 65209689 | אזור תעשיה פנחס ספי | 1,021 | 2 (fail, then succeeded — but 6 of its 8 surfaces failed individually on the successful attempt, landing PARTIAL) |
| 65209703 | עיר ימים | 3,060 | 2 (fail, succeed as PARTIAL) |
| 65209717 | מרכז העיר | 9,972 | **3** (fail at exchange 7; failed AGAIN on the batch retry, reaching only 2,738/9,972 before failing; succeeded on a 3rd, solo retry as PARTIAL 3,282/9,972) |
| 65209727 | חוף הים והמלונות | 2,612 | 2 (fail, succeed as PARTIAL) |

**מרכז העיר — the largest entity in the catalog — was the most unstable, needing 2 failed attempts before a 3rd succeeded.** This is consistent with its live acquisition being the longest-running, most surface-dense sequence in the whole audit (8 surfaces, each involving either a ~50-click pagination loop or a sort-menu interaction), which plausibly increases exposure to whatever caused the transient `EMPTY_RESULT` responses.

**אזור תעשיה פנחס ספי's PARTIAL result (97.94%, 1,000/1,021) is NOT "reached using only 2 surfaces" in the sense of only trying 2** — its successful run actually attempted all remaining 6 surfaces (visible in the retry log: `date_asc_1` exhausted its 3 click retries, `date_asc_2`'s ~53-click budget exhausted without reaching fetch_number=2, `price_desc_1` also failed to select) and none of them produced usable data, most likely because the page's UI state had degraded after the very long `date_desc_2` click sequence earlier in the same run. Its 257.2-second elapsed time (vs. ~43s for other 2-surface entities) reflects those 6 failed attempts' retry/timeout overhead, not idle time.

**This pattern is not swept aside as a footnote — it is itself a citywide-architecture finding.** A future production-grade citywide runner MUST retry transient empty-response failures from scratch (never resume mid-entity with a stale contract — this wave's fixed resume logic already does this by design, confirmed by ECC silent-failure-hunter tracing the retry mechanism). It should also budget for the possibility that a single long-running entity (like מרכז העיר) may need multiple full retries, and should treat a UI-interaction cascade-failure (like אזור תעשיה פנחס ספי's) as a signal that a WHOLE ENTITY's later surfaces may be unreliable after an earlier surface's very long click sequence, not just as 6 independent unlucky coin-flips.

**Open question, not resolved this wave (ECC security-reviewer finding):** whether this 21% first-pass transient-failure rate reflects genuine intermittent server hiccups, or an early soft-block/rate-limit signal from the source site reacting to 38 sequential entity acquisitions in one browser session. This run's blind retry-without-slowdown succeeded every time, but a future citywide run (especially on a recurring monthly cadence) should treat this as an open item: consider increasing `INTER_ENTITY_DELAY_MS` (currently a flat 1200ms) or adding entity-level backoff before concluding the current pacing is safe to repeat indefinitely.

## Phase 9 — Entity Completeness Status (final, all 38 terminal)

- COMPLETE: 27
- PARTIAL: 11
- FAILED: 0

No entity was left in an ambiguous "close enough" state — every entity ended in exactly one of the three defined states.

**Known latent limitation, not proven to have occurred (ECC silent-failure-hunter finding):** the response-capture handler is a fire-and-forget `page.on("response", ...)` listener; each surface's completion check only waits a fixed settle window before inspecting captured exchanges. If response decoding lagged behind that window (plausible for a large entity's gzipped payload under load), a genuinely-successful surface could be silently skipped, undercounting a result toward PARTIAL rather than COMPLETE. This is a bias toward UNDER-claiming completeness, not over-claiming it — a false PARTIAL is a safer failure mode than a false COMPLETE, but it means some of this wave's PARTIAL deltas could be smaller than reported. Not fixed this wave (would require explicit "handler settled" synchronization); flagged as a design item for a future runner revision.

## Phase 12 — Per-Entity Scorecard

Full scorecard: [`audit/wave0g16/citywide_entity_scorecard.csv`](citywide_entity_scorecard.csv) (38 rows, sorted by official_total_rows descending).

## Phase 13 — Citywide Aggregate

- OFFICIAL_ENTITIES=38
- COMPLETE_ENTITIES=27, PARTIAL_ENTITIES=11, FAILED_ENTITIES=0
- OFFICIAL_TOP_LEVEL_ROWS_SUM=63,704
- SHADOW_TOP_LEVEL_UNIQUE_SUM=49,721
- TOTAL_TOP_LEVEL_DELTA=13,983 (78.05% citywide top-level coverage using only proven-safe surfaces)
- RAW_PREVDEAL_EVENTS=22,846, UNIQUE_PREVDEAL_EVENTS=17,113
- TOTAL_SHADOW_TRANSACTION_EVENTS (top-level only)=49,721
- TOTAL_SHADOW_TRANSACTION_EVENTS (top-level + unique historical prevDeals, combined)=66,834

This combined figure is explicitly **not** presented as canonical or as a ready-to-import corpus — it is the shadow-audit's own measured coverage, reported honestly with its gap.

## Phase 14 — Completeness Distribution

- ENTITIES_100_PERCENT=27
- ENTITIES_99_TO_100_PERCENT=1
- ENTITIES_95_TO_99_PERCENT=1
- ENTITIES_BELOW_95_PERCENT=9

**This directly answers the wave's motivating question: Rasko's 2010/2012 (99.90%) PARTIAL behavior is RARE, not common or systemic.** Only 2 of 38 entities (Rasko and `אזור תעשיה פנחס ספי`, 97.94%) land in the 95-100% near-complete band. The other 9 PARTIAL entities are NOT "just short" — they range from 91% down to **32.91%** (מרכז העיר, the single largest entity in the catalog at 9,972 official rows). The pattern is bimodal: most entities (27/38, 71%) are fully reconciled by our proven-safe surfaces; a distinct minority of large/dense entities are only partially reachable, with severity roughly tracking entity size.

Full PARTIAL detail table: see [`citywide_summary.json`](citywide_summary.json)'s `partialEntitiesDetail`, or the extract below.

| Name | Source ID | Official Total | Shadow Unique | Delta | Coverage % |
|---|---|---|---|---|---|
| קריית השרון | 65209683 | 5,640 | 2,518 | 3,122 | 44.65% |
| אזור תעשיה פנחס ספי | 65209689 | 1,021 | 1,000 | 21 | 97.94% |
| עיר ימים | 65209703 | 3,060 | 2,325 | 735 | 75.98% |
| קריית נורדאו | 65209705 | 3,281 | 2,265 | 1,016 | 69.03% |
| מרכז העיר | 65209717 | 9,972 | 3,282 | 6,690 | 32.91% |
| חוף הים והמלונות | 65209727 | 2,612 | 2,343 | 269 | 89.70% |
| רמת אפרים | 65209736 | 2,266 | 2,082 | 184 | 91.88% |
| מע"ר - מרכז עירוני | 65210243 | 3,273 | 2,329 | 944 | 71.16% |
| אבו שדיד | 65210245 | 3,082 | 2,292 | 790 | 74.37% |
| רסקו | 65210248 | 2,012 | 2,010 | 2 | 99.90% |
| מכנס | 65210752 | 2,375 | 2,165 | 210 | 91.16% |

Notably, `אזור תעשיה פנחס ספי` reached 97.94% (1,000/1,021) with only `date_desc_1+date_desc_2` (2 surfaces) actually CONTRIBUTING data — but as detailed in Phase 4 above, it attempted all remaining 6 surfaces and every one failed to produce usable data (a UI-interaction cascade, not an early stop). Its 500-row-per-fetch ceiling was hit at exactly 1,021 official rows, meaning even 2 fetches of a single sort direction under-covers a mid-size entity once total_rows exceeds ~1,000, and this specific entity's later-surface failures mean we cannot say whether the alternate surfaces would have closed the remaining 21-row gap had they worked. Every OTHER PARTIAL entity exhausted all 8 surfaces (successfully attempted, not necessarily contributing new rows) without closing its gap.

## Phase 15 — Source Request Efficiency

- TOTAL_NETWORK_REQUESTS=146
- TOTAL_ELAPSED_SECONDS=2,758.3 (~46 minutes, across the full run + all retries)
- AVERAGE_REQUESTS_PER_ENTITY=3.84

Request-depth distribution (COMPLETE entities only):
- Completed after DESC fetch1 alone: 4
- Completed after DESC fetch2: 14
- Completed after ASC fetch1: 4
- Completed after ASC fetch2: 5
- Completed only after an alternate (price/rooms) surface: 0
- Still PARTIAL after exhausting all 8 surfaces: 11

No entity that reached COMPLETE ever needed an alternate price/rooms surface to do so — every COMPLETE entity finished within the 4 date-sort surfaces. The alternate surfaces (price/rooms) were exercised only by PARTIAL entities chasing the last few percent, and even then only recovered a small fraction of their remaining delta (as Wave 0G-14/15 already showed for Rasko specifically).

## Phase 10 — Address Quality (citywide)

- VALID_ADDRESS_RATE=77.65% (38,608 / 49,721)
- STREET_ZERO_RATE=22.35% (11,113 / 49,721)
- MISSING_HOUSE_RATE=22.35% (11,113 / 49,721)

**Verified, not assumed:** these two rates are identical (11,113 = 11,113) because they are caused by the exact same underlying condition in 100% of cases — a raw `address` field of literally `"0"` (a placeholder for "no address on file") produces both `street="0"` and `houseNumber=null` simultaneously via the shared `parseAddress()` logic. A direct scan confirmed zero rows have a missing house number for any OTHER reason. This means roughly 1 in 5 citywide transactions carries no usable address data at the source — a genuine upstream data-quality characteristic, not a normalization bug.

## Phase 11 — Property Semantics

- ROWS_WITH_DEALNATURE=41,016 / 49,721 (82.5%)
- DISTINCT_DEALNATURE_VALUES=42
- דירת נופש (vacation apartment) ROWS=166

Full breakdown: [`audit/wave0g16/dealnature_summary.csv`](dealnature_summary.csv). `classifyPropertyType()`/valuation logic were not touched — this is raw `dealNature` tallying only.

## Phase 5/8 — Transaction Identity & Normalization Safety

- NORMALIZATION_DROPS (citywide sum)=0 — every raw top-level row across all 38 entities normalized successfully (no row was silently discarded for lacking a valid price).
- AMBIGUOUS_TRANSACTION_COLLISIONS=0 — no entity's collision groups disagreed on the 4 specific non-key fields this check inspects (street/houseNumber/floor/areaSqm) across any of the 38 entities' combined surfaces. **Scope caveat (ECC database-reviewer finding):** this check does not compare `rooms`, `yearBuilt`, or raw `dealNature` — two observations sharing a transaction key but disagreeing only on one of those 3 unchecked fields would not be flagged. Given collision groups mostly arise from the same real transaction re-observed across overlapping sort windows (not two genuinely different transactions), a 0-count result is plausible, but the check's coverage is 4 fields, not "every non-key field."
- No entity was FAILED for an ambiguous collision, which the runner would have done automatically (Phase 5's fail-closed requirement) had one occurred.

## Phase 6 — "-0" Parcel Safety

- MINUS_ZERO_ROWS (citywide sum)=446
- MINUS_ZERO_COLLISIONS (citywide sum)=0 (no base parcel had 2+ "-0" rows collide into the same date+price)

**Clarification on Phase 6's fail-closed requirement:** the runner does not special-case "-0" rows for collision detection — the general `detectAmbiguousCollisions()` check (Phase 5) already covers them, since it inspects every transaction-key collision group regardless of parcelNum shape. A "-0" row involved in a genuine contradictory collision (same key, different street/floor/area) would trip the SAME fail-closed path as any other row. None did, citywide, this wave.

## Phase 7 — PrevDeals Historical Tier

- RAW_PREVDEAL_EVENTS=22,846
- UNIQUE_PREVDEAL_EVENTS=17,113 (25.1% collision rate within the tested surfaces — expected, since overlapping sort windows re-observe the same nested history)
- PREVDEAL_NORMALIZATION_DROPS=(tracked per-entity; entities with all-valid nested events had 0 drops — see scorecard)

PrevDeals were NEVER used to satisfy any entity's `total_rows` reconciliation — `recomputeUnion()` (which drives every COMPLETE/PARTIAL/FAILED decision) only ever processes top-level raw items; prevDeals extraction is a structurally separate pass over the SAME top-level items' nested arrays, feeding an entirely disjoint accumulator (`uniquePrevDeals`). This is an architectural invariant (not merely a runtime observation) — the two accumulators never share code paths.

**Coverage gap, disclosed not fixed (ECC database-reviewer finding):** unlike top-level rows, prevDeals events have no ambiguous-collision check. `extractPrevDealEvents()` inherits the parent row's `parcelNum` verbatim, including "-0" aggregate values — two different "-0"-parcel properties within the same entity that happened to share a nested date+price would silently collapse via `prevDealKey()` with no detection, the same theoretical risk Phase 6 covers for top-level rows but does not extend to this tier. Not proven to have occurred (only 446 "-0" top-level rows exist citywide, and their nested prevDeals were not separately audited this wave) — flagged as an open gap for a future wave, not a resolved risk. `prevDealKey()` was hardened this wave to include `sourceId` (previously relying only on each entity's dedup Map being scoped fresh, not on the key itself) as defense-in-depth against a future aggregation step that might merge events across entities.

## Phase 18 — Canonical Comparison (READ-ONLY)

Matched using transaction evidence (`dealDate + price + street + houseNumber`), deliberately NOT the obsolete GovMap `neighborhoodId` system, per this wave's explicit instruction.

- CANONICAL_ROWS=12,642
- SHADOW_TOP_LEVEL_ROWS=49,721
- SHADOW_HISTORICAL_PREVDEALS=17,113
- SHADOW_ROWS_WITH_ANY_CANONICAL_MATCH=9,744
- CANONICAL_ROWS_WITH_ANY_SHADOW_MATCH=11,044
- SHADOW_TOP_LEVEL_ONLY=39,977
- CANONICAL_ONLY=1,598
- **SHADOW-SIDE MATCH RATE=19.60%** (9,744 / 49,721 — what fraction of shadow rows found some canonical match)
- **CANONICAL-SIDE MATCH RATE=87.36%** (11,044 / 12,642 — what fraction of canonical rows found some shadow match)

**Correction (ECC planner finding):** an earlier version of this report published only the 19.6% figure under the misleading label "match rate," inviting the reading that canonical and shadow mostly disagree. They do not. **87.36% of canonical's own rows ARE found in this wave's shadow data.** The 19.6% figure only looks low because shadow (49,721 top-level rows) is ~4x larger than canonical (12,642 rows) — canonical appears to be a narrower slice (fewer entities, a shallower acquisition depth, or both), not a set that mostly conflicts with the live data. Both rates are now reported, correctly labeled, rather than one being presented as "the" match rate.

**Zero-cost staleness check performed this wave (in place of, not instead of, the still-unresolved bounded sample):** comparing max/min `dealDate` on each side —

| | Canonical | Shadow |
|---|---|---|
| Earliest date | 1998-02-06 | 1998-01-01 |
| Latest date | 2026-06-08 | 2026-07-08 |

**Canonical is NOT materially stale** — its latest transaction is only ~1 month behind the live shadow data's latest, and its earliest date nearly matches too. This weakens the "snapshot staleness" explanation as the primary driver of the shadow-side 19.6% figure; it points instead toward **strict key sensitivity** (the match key is an EXACT 4-field match — `dealDate+price+street+houseNumber` — with no fuzzy tolerance for address-formatting divergence) and **coverage differences** (canonical may simply not include every entity/surface this wave's 38-entity, 8-surface run covered) as the more likely explanations. Distinguishing between those two conclusively would require the bounded manual sample Phase 18 calls for — still not done this wave, and now more clearly the right next step given staleness is ruled out as the dominant factor.

This wave does NOT classify the 39,977 shadow-only or 1,598 canonical-only rows further — Phase 18 explicitly calls for "bounded samples, classified cautiously," which is follow-up work, not resolved here.

## Phase 19 — Neighborhood Label Mismatch Audit

Of the 9,744 matched transactions, **5,977 (61.3%) carry a DIFFERENT canonical neighborhood label than the official entity they were acquired under.** This substantially extends the Rasko/`מרכז העיר צפון` finding from Wave 0G-12 — that was not an isolated mislabeling, it is the dominant pattern.

Full breakdown: [`audit/wave0g16/neighborhood_label_mismatches.csv`](neighborhood_label_mismatches.csv). Top mismatches:

| Old (canonical) label | Official label | Count |
|---|---|---|
| מרכז העיר צפון | מרכז העיר | 539 |
| נוף הטיילת | מע"ר - מרכז עירוני | 490 |
| מרכז העיר צפון | מכנס | 486 |
| מרכז העיר צפון | נאות הרצל | 485 |
| מרכז העיר צפון | רסקו | 480 |
| מרכז העיר צפון | חוף הים והמלונות | 479 |
| קריית רבין | קריית יצחק רבין | 464 |
| כוכב הצפון | פרדס הגדוד | 460 |
| קריית צאנז | קרית צאנז | 431 |
| מרכז העיר דרום | אבו שדיד | 425 |
| נוף השרון | רמת אפרים | 418 |
| נאות גנים | נאות גנים - שיכון ות | 406 |
| רמת חן | בן ציון | 404 |

**Correction (ECC planner finding):** an earlier version of this report miscounted `מרכז העיר צפון`'s spread as "SIX entities, 2,955 rows" — the correct count, verified directly against the committed CSV, is **SEVEN distinct official entities, 2,471 rows combined** (מרכז העיר 539, מכנס 486, נאות הרצל 485, רסקו 480, חוף הים והמלונות 479, רמת אפרים 1, and מע"ר - מרכז עירוני ר 1 — the last two are single-row coincidences, not part of the real pattern).

At least three distinct patterns are visible here and should NOT be conflated into one 61.3% headline:
1. **Real boundary/polygon mismatches** — `מרכז העיר צפון` spread across 5 official entities with substantial counts (539/486/485/480/479 = 2,469 of its 2,471 rows), consistent with it being a single old, coarse GovMap polygon that the legacy harvester applied broadly across what the official catalog now treats as several distinct neighborhoods. This is the strongest evidence of a genuine geographic mislabeling.
2. **Likely 1:1 renames, not boundary differences** — `נוף הטיילת`→`מע"ר...` (490), `קריית רבין`→`קריית יצחק רבין` (464), `כוכב הצפון`→`פרדס הגדוד` (460), `קריית צאנז`→`קרית צאנז` (431, near-certainly a spelling/transliteration variant of the same place), `מרכז העיר דרום`→`אבו שדיד` (425), `נאות גנים`→`נאות גנים - שיכון ות` (406), `רמת חן`→`בן ציון` (404) — together ~3,080 rows (~52% of the 5,977 total). These look like the OLD canonical label and the NEW official entity are the same real place under a renamed/reorganized boundary, not necessarily a harvesting error.
3. **Catalog-truncation artifacts, not a real place-name difference at all** — `נאות גנים - שיכון ות`, `מע"ר - מרכז עירוני ר`, and `קריית יהלום - פארק ת` are each exactly 20 characters, and the official nadlan.gov.il catalog's raw `title` field for these entities is verifiably cut off mid-word at that length (confirmed directly against this wave's own `catalog_snapshot.json` — a source-side limitation, not anything introduced by this pipeline). Where one of these truncated names appears as the "official" side of a mismatch pair, the apparent "difference" from the old canonical label may be partly a display artifact rather than a substantive one.

This is READ-ONLY — nothing was relabeled. Fully distinguishing pattern 1 from pattern 2 (both real, but different in kind — boundary error vs. rename) would require the bounded-sample follow-up noted in Phase 18, not resolved here.

## Phase 20 — Regression Tests

New test file: [`scripts/__tests__/wave0g16CitywideShadow.test.ts`](../../scripts/__tests__/wave0g16CitywideShadow.test.ts) (10 tests), covering the runner's pure logic: prevDeals extraction/dropping (H), prevDeals dedup including repeat-sale preservation and null-parcelNum safety (I), ambiguous-collision detection including the true-duplicate-not-flagged case (F) and the "-0" aggregate-parcel contradictory-evidence case (J), and the resume contract-version tag (M).

Items A-E (surface sequencing, exact-stop, PARTIAL/FAILED classification) were validated live pre-flight (see above) rather than mocked — consistent with this engagement's established pattern of validating browser-driven acquisition against the real site, not a Playwright mock. Items K/L (runner cannot write canonical/Supabase) are covered structurally: every write in both new scripts goes through `assertSafeShadowOutputPath()`, whose own guarantees are already tested in `lib/__tests__/shadowRebuild.test.ts` (TEST E/F); this wave's ECC security-reviewer independently confirmed (by direct code inspection) that every write call site in both scripts is guarded, and that neither script imports or references Supabase in any form.

**A real bug was caught while wiring these tests**: importing the runner script's pure helper functions for testing would have executed its `main()` function as a side effect (launching a live browser). Fixed with a `pathToFileURL`-based direct-execution guard — the first naive string-concatenation attempt at this guard silently broke DIRECT execution too (a Windows `file://` URL needs a third leading slash before the drive letter that manual concatenation drops), caught by testing the fix live before trusting it.

Full suite: **307/307 pass** (297 baseline + 10 new).
Typecheck: clean.
Build: succeeded.

## Phase 22 — Canonical Immutability

ROWS BEFORE=12,642, ROWS AFTER=12,642
SHA BEFORE=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
SHA AFTER=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f (unchanged)
SUPABASE_WRITES=0, IMPORTER_RUNS=0, CANONICAL_CHECKPOINT_WRITES=0, DEPLOYMENTS=0

## Phase 23 — Write-Path Isolation (source verification)

Direct source verification (grep across both new scripts) rather than a full Graphify rebuild, since the question is narrowly bounded and the existing graph predates this wave's new files:

- No `supabase` reference anywhere in either script.
- `data/deals.json` is referenced exactly once, as a `fs.readFile` (READ-ONLY) in the aggregation script's Phase 18 comparison — never written.
- No `valuation` reference in either script.
- Every `fs.writeFile` call site in both scripts (6 total: manifest, per-entity result, scorecard CSV, dealnature CSV, mismatch CSV, summary JSON) is immediately preceded by an `assertSafeShadowOutputPath()` call targeting a path under `audit/wave0g16/`.

CANONICAL_WRITE_REACHABLE=NO
SUPABASE_WRITE_REACHABLE=NO
VALUATION_MUTATION_REACHABLE=NO

## Phase 24 — ECC Final Review

Two review passes this wave: a **pre-flight** pass (planner/specialist/code-reviewer/security-reviewer reviewed the runner design before the live 38-entity run — 2 real bugs found and fixed) and this **final** pass (all 6 reviewers, against the completed run's report and final code). Verdicts: planner CONCERNS, specialist CONCERNS, database-reviewer CONCERNS, silent-failure-hunter CONCERNS, security-reviewer PASS (1 concern), code-reviewer CONCERNS. No FAIL verdicts. performance-optimizer was not used — concurrency was structurally 1 (single browser page, sequential loop) by design, not a speculative choice, so no performance review was warranted per this wave's own instruction ("only review request pacing/concurrency if necessary").

| # | Reviewer | Finding | Fix applied |
|---|---|---|---|
| 1 | planner | Canonical "match rate" (19.6%) was mislabeled `canonicalMatchedTopLevel` and presented as if it were a canonical-side rate, when it was actually a shadow-side count — the two differ (canonical-side is 87.36%) | Fixed the aggregate script to compute and report BOTH rates correctly labeled; rewrote Phase 18 |
| 2 | planner | Phase 19 arithmetic error: "SIX entities, 2,955 rows" for מרכז העיר צפון should be SEVEN entities, 2,471 rows | Recomputed directly from the committed CSV and corrected; also split the 61.3% headline into 3 distinct sub-patterns (real boundary mismatch, likely 1:1 rename, catalog-truncation artifact) rather than one undifferentiated number |
| 3 | planner | `אזור תעשיה פנחס ספי`'s 257s elapsed with only 2 surfaces in `surfacesUsed` was unexplained — its "97.94% using only 2 surfaces" framing implied it never tried the rest | Investigated via the retry log; corrected — it attempted all 8, 6 failed individually (UI cascade after a long prior click sequence) |
| 4 | planner, silent-failure-hunter | The 8-transient-failure disclosure named only 1 of 8 entities, no source IDs, no attempt counts | Added a full table (source ID, name, official total_rows, attempt count) for all 8, including the newly-discovered detail that מרכז העיר actually failed twice, not once |
| 5 | code-reviewer, specialist (independently) | Depth-distribution classification (`afterDesc1`/`afterDesc2`/etc.) inferred depth from presence/absence of intermediate surfaces, which the runner deliberately skips for small entities — could misfile an entity that legitimately needed a later surface | Rewrote to classify by the LAST surface actually used, by fixed order; re-ran — published numbers were unaffected (no entity in this run happened to trigger the bug), but the logic is now robust for future runs |
| 6 | code-reviewer | Dead/tautological ternary in `canonicalOnly` computation | Simplified to a direct computation |
| 7 | database-reviewer | Ambiguous-collision check only inspects 4 fields (street/houseNumber/floor/areaSqm), not rooms/yearBuilt/dealNature — "0 found" claim should be scoped accordingly | Added an explicit scope caveat to Phase 5/8 |
| 8 | database-reviewer | `prevDealKey()` omitted `sourceId`, relying only on each entity's dedup Map being scoped fresh — fragile against a future cross-entity merge | Added `sourceId` to the key; added a test proving cross-entity non-collision |
| 9 | database-reviewer | PrevDeals events (including "-0" parcels) have no ambiguous-collision check, unlike top-level rows | Disclosed as an open gap in Phase 7, not fixed this wave |
| 10 | silent-failure-hunter | A fire-and-forget response listener + fixed settle-window could theoretically under-count a surface (false PARTIAL) if decoding lagged | Disclosed as a known latent limitation in Phase 9; not proven to have occurred, biases toward under- not over-claiming completeness |
| 11 | security-reviewer | The 21% first-pass transient-failure rate could be an early rate-limit/soft-block signal, not addressed as a pacing consideration for future runs | Added as an explicit open item in Phase 4, recommending future pacing changes be considered before repeating this cadence |

After applying fixes 1, 2, 5, 6, 8 (the ones requiring code/data changes), the aggregation was re-run end-to-end; all citywide totals reproduced identically except the corrected canonical-comparison and depth-distribution fields (which changed from mislabeled/latent-buggy to correct — the underlying 38-entity acquisition results themselves were untouched). Full suite (307/307 → 308/308 after 1 added test), typecheck, and build re-verified clean after all fixes.
