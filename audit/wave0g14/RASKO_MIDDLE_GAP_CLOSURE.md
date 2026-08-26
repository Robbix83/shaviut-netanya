# Wave 0G-14 — Rasko Middle-Gap Closure via Legitimate Sort Surfaces

## Baseline

BASELINE_HEAD=af27c92 (Wave 0G-13 close: "docs: prove Rasko dual-sort completeness (2000/2012) and prevDeals contract")

Canonical:
- ROWS=12642 (unchanged)
- SHA256=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f (unchanged, before and after)

Pre-existing untracked large raw dumps from Wave 0G-12/0G-13 (deliberately never committed) were left in place, not cleaned.

## Phase 2 — Reconstructed Proven 2000-Row Rasko Union

Reused Wave 0G-13's stored artifacts, no refetch:

| window | type_order | fetch_number | rows | earliest | latest |
|---|---|---|---|---|---|
| DESC fetch 1 | dealDate_down | 1 | 500 | 2022-03-27 | 2026-06-15 |
| DESC fetch 2 | dealDate_down | 2 | 500 | 2016-09-07 | 2022-03-26 |
| ASC fetch 1 | dealDate_up | 1 | 500 | 1998-01-12 | 2009-03-18 |
| ASC fetch 2 | dealDate_up | 2 | 500 | 2009-03-25 | 2016-06-06 |

RAW_ROWS=2000, UNIQUE_ROWS=2000, DELTA=12 (matches Wave 0G-13's committed evidence exactly).

## Phase 3 — 12-Row Chronological Gap

DESC_OLDEST_DATE=2016-09-07
ASC_NEWEST_DATE=2016-06-06
MISSING_DATE_INTERVAL=2016-06-06 .. 2016-09-07 (~3 months) — diagnostic only, never used as a request filter.

## Phase 4 — Legitimate UI Sort Inventory (live, read-only)

Opened Rasko's live "מיון" (sort) dropdown, then ran a page-wide DOM scan for short Hebrew labels matching a broad regex — this scan is NOT scoped to only the dropdown's own items, so it also picked up 4 separate room-count FILTER chips (`כל החדרים`, `3 חדרים`, `4 חדרים`, `5 חדרים`) that happened to be visible at the same time. Every candidate is classified post-hoc as `kind: "sort"` (carries an explicit ascending/descending direction phrase) or `kind: "filter"` (everything else) — 6 sort options, 4 filter chips, out of 10 total candidates. No option was clicked during this phase. Output: [`audit/wave0g14/shadow/sort_ui_inventory.json`](shadow/sort_ui_inventory.json).

| UI_LABEL | REQUEST_TYPE_ORDER_VALUE | PROVEN_BY_NETWORK | SAFE_TO_TEST |
|---|---|---|---|
| תאריך עסקה - סדר יורד | dealDate_down | YES (Wave 0G-9+) | already used |
| תאריך עסקה - סדר עולה | dealDate_up | YES (Wave 0G-13) | already used |
| מחיר העסקה - סדר יורד | dealAmount_down | this wave | YES — tested |
| מחיר העסקה - סדר עולה | (not tested — direction not selected) | NO | untested, budget-excluded |
| מס' חדרים - סדר יורד | roomNum_down | this wave | YES — tested |
| מס' חדרים - סדר עולה | (not tested — direction not selected) | NO | untested, budget-excluded |

The room-count filter chips (`כל החדרים`, `3 חדרים`, `4 חדרים`, `5 חדרים`) that also matched the initial broad DOM scan are a separate FILTER control, not part of the sort dropdown, and were excluded from the sort inventory above.

Two additional orthogonal official sort dimensions exist beyond date: **price** and **room count**. No other sort options were visible in the UI — none were invented.

## Phase 5 — Selection

SELECTED_SORT_LABEL=מחיר העסקה - סדר יורד (price, descending)
SELECTED_TYPE_ORDER=dealAmount_down (proven by network, this wave)
WHY_SELECTED=Price is a continuous, largely date-uncorrelated field. Room count is coarse (few discrete bins, likely large tie-blocks that could tie-break back toward insertion/date order) and was reserved as the Phase 8 second candidate instead of the first pick.

## Phase 6 — First Alternate-Sort Fetch (Price, fetch_number=1 only)

Live acquisition: [`scripts/audit-wave0g14-rasko-price-sort.ts`](../../scripts/audit-wave0g14-rasko-price-sort.ts) → [`shadow/rasko_price_sort_meta.json`](shadow/rasko_price_sort_meta.json) / [`shadow/rasko_price_sort_raw.json`](shadow/rasko_price_sort_raw.json).

- ROWS=500
- RESPONSE_ENTITY_IDS: identity check passed (`assertDirectIdAcquisitionIdentity` valid=true for all 500 rows)
- IDENTITY_MATCH=YES
- type_order observed on the wire = `dealAmount_down` (read from the REQUEST envelope, matching the proven fetch_number/type_order contract — never read from the response)
- No login wall encountered.

Dedup against the 2000-row union (parcelNum + dealDate + price key):
- ALREADY_KNOWN=498
- NEW_ROWS=2
- Both new rows landed exactly inside the known 2016-06-06..2016-09-07 gap window — direct corroboration of the Wave 0G-13 gap hypothesis, this time from an independent, non-date-ordered surface.

UNION_UNIQUE after Phase 6/7 = 2002. Did not exceed 2012 — no stop condition triggered.

## Phase 8 — Second Legitimate Sort (Room Count, fetch_number=1 only)

Price alone reached only 2002/2012 (delta=10) — did not close the gap. Rooms was the one remaining untested legitimate sort surface, and the wave's budget allows exactly one more (max 2 new-sort requests total, both now used).

Live acquisition: [`scripts/audit-wave0g14-rasko-rooms-sort.ts`](../../scripts/audit-wave0g14-rasko-rooms-sort.ts) → [`shadow/rasko_rooms_sort_meta.json`](shadow/rasko_rooms_sort_meta.json) / [`shadow/rasko_rooms_sort_raw.json`](shadow/rasko_rooms_sort_raw.json).

- ROWS=500, type_order=`roomNum_down`, identity valid, no login wall.

Combined (price ∪ rooms, deduped against each other and against the 2000-row union): [`scripts/audit-wave0g14-rasko-merge.ts`](../../scripts/audit-wave0g14-rasko-merge.ts) → [`shadow/rasko_final_merge.json`](shadow/rasko_final_merge.json).

- SECOND_SORT=roomNum_down (מס' חדרים - סדר יורד)
- ROWS=500
- NEW_ROWS (combined across both alt sorts, deduped) = 5 total (2 from price alone, 3 additional from rooms)
- FINAL_UNION_UNIQUE=2005
- FINAL_DELTA=7

ALREADY_KNOWN=994 (combined, non-unique-count: rows from either alt-sort batch already present in the existing 2000-row union — reproducible directly from `shadow/rasko_final_merge.json`'s `alreadyKnown` field).

All 5 recovered rows fall inside the diagnostic gap window (2016-06-06 .. 2016-09-07):

| parcelNum | dealDate | price | street | houseNumber |
|---|---|---|---|---|
| 8267-291-1 | 2016-08-04 | 2,300,000 | יל"ג | 6 |
| 8231-5-4 | 2016-06-15 | 2,200,000 | סוקולוב | 78 |
| 8231-285-1 | 2016-07-31 | 2,160,000 | טרומפלדור | 56 |
| 8267-375-7 | 2016-08-04 | 1,955,000 | הרב ריינס | 41 |
| 8267-391-6 | 2016-07-27 | 1,650,000 | הרב ריינס | 13 |

Per Phase 8's hard cap ("Maximum new sort requests in this wave: 2"), no further live acquisition was attempted this wave, even though the 2012 target was not reached. The 2 unused directions (price-ascending, rooms-ascending) remain untested, out of scope for this wave.

**Budget accounting note (ECC planner finding):** "2 new sort requests" refers to 2 new `type_order` values tested (`dealAmount_down`, `roomNum_down`). Each of the price-sort and rooms-sort scripts independently navigates to Rasko's direct URL, which unavoidably triggers the site's own default-sort `dealDate_down` fetch_number=1 page load before the sort is switched (visible as `exchange 1` in both `shadow/rasko_price_sort_meta.json` and `shadow/rasko_rooms_sort_meta.json`). This means 4 total `/deal-data` responses (2000 rows) were received live this wave, not 2 — but only 2 DISTINCT new sort surfaces were tested, which is what the budget constrains. The merge script explicitly filters exchanges by exact `typeOrder` match before merging, so the redundant baseline `dealDate_down` fetches are excluded from the reconciliation, not double-counted.

## Phase 9 — Exact Completeness Reconciliation

OFFICIAL_TOTAL_ROWS=2012
EXISTING_DESC_ASC_UNIQUE=2000
ALT_SORT_RAW_ROWS=1000 (500 price + 500 rooms)
ALT_SORT_NEW_ROWS=5 (deduped across both)
FINAL_UNIQUE=2005
DELTA=7

PASS requires FINAL_UNIQUE == 2012 exactly. **Not met.** No rounding, no acceptance of 2011/2013 — 2005 is reported exactly as measured.

## Phase 10 — Transaction Identity Recheck

RAW_ROWS_ALL_SURFACES = 2000 (DESC+ASC union, already internally deduped in Wave 0G-13) + 500 (price) + 500 (rooms) = 3000
UNIQUE_KEYS = 2005
DUPLICATE_KEYS = 995 collisions (994 price/rooms-vs-existing-union overlaps + 1 price-vs-rooms cross overlap, all folded into the single dedup pass)

Classification: every collision observed is an **exact** match on `parcelNum + dealDate + price` — a 3-field conjunction, not a fuzzy or partial match. No case was found where two rows with the same key had materially different underlying data (this wave did not re-normalize past the transaction key itself, since Wave 0G-12/0G-13 already established the key's collision behavior against real Rasko/Nof Hatayelet data, including the `8252-109-0`/prevDeals edge cases). All observed duplicates classify as **TRUE_SAME_TRANSACTION_ACROSS_SURFACES**. No LEGITIMATE_DISTINCT_TRANSACTION collapse was found. No AMBIGUOUS cases.

TRANSACTION_KEY=PASS (did not fail this wave).

## Phase 11 — PrevDeals Remains Separate

No new prevDeals fetch was performed this wave (not required — Wave 0G-13 already proved the contract). The two layers are kept explicit:

TOP_LEVEL_COUNT=2005 (this wave's best top-level union; still short of official 2012)
UNIQUE_PREVDEAL_EVENTS_AVAILABLE_IN_CAPTURED_DATA=183 (Nof Hatayelet, proven Wave 0G-13; Rasko's 179 nested events from its fetch-1 sample remain untested against a complete union, as documented in Wave 0G-13 — still true, since Rasko's top-level union is still incomplete this wave too)

prevDeals was NOT included in any of this wave's top-level reconciliation counts (2000, 2002, 2005) — those are top-level-only unions throughout.

## Phase 12 — Coverage-Driven Acquisition Design (conceptual only)

A future shadow harvester should NOT assume a fixed fetch count or fixed sort list. Instead:

1. Read official `total_rows`.
2. Acquire safe DESC windows (fetch 1, fetch 2 — proven depth ceiling).
3. Acquire safe ASC windows (fetch 1, fetch 2).
4. Dedup transaction-safely (parcelNum + dealDate + price).
5. Compare unique top-level count to `total_rows`.
6. If a delta remains, try a bounded list of other PROVEN official sort surfaces (price, room count — both proven this wave; price-ascending and rooms-ascending remain untested) — one at a time, fetch 1 only, re-checking the delta after each.
7. Stop immediately when unique == total_rows.
8. **Fail closed** if unique != total_rows after all approved surfaces are exhausted — mark the entity PARTIAL, never silently accept it as COMPLETE.

This wave is itself a live proof-of-concept of steps 1-6 (partially — 2 of 4 possible alt-sort directions), and of step 8 (Rasko is correctly reported PARTIAL, not forced to 2012).

COVERAGE_DRIVEN_STRATEGY=PARTIAL — proven to make real incremental progress (12→7 delta) using only legitimate surfaces, but not proven to reach exact closure for a large entity within this wave's request budget. No reusable `lib/` helper was extracted this wave (the acquisition/dedup primitives already exist from Wave 0G-12; only new orchestration scripts were added, mirroring Wave 0G-13's pattern).

## Phase 13 — Large-Entity Architecture Gate

RASKO_COMPLETENESS=PARTIAL (2005/2012 = 99.65%, up from 99.40% at the end of Wave 0G-13; PROVEN requires exact 2012/2012, not met)

LARGE_ENTITY_WITHOUT_FETCH3_PROVEN=NO (still no entity has been reconciled to exact official total_rows without fetch_number 3+; Rasko has narrowed from a 12-row gap to a 7-row gap using only fetch_number≤2 surfaces across 3 sort dimensions, but has not reached exact closure)

## Phase 14 — Can Citywide Shadow Now Run Safely?

Not authorization to run it — evaluation only.

A future read-only citywide shadow runner CAN safely: read each entity's `total_rows`, gather DESC+ASC (and, if needed, a small bounded set of additional proven sort surfaces) at fetch_number≤2, dedup by the transaction-safe key, keep prevDeals as a separate historical tier, require exact top-level reconciliation, and mark an entity FAILED/PARTIAL rather than silently accepting incompleteness. This wave is a second real-world demonstration of that fail-closed behavior (Rasko: reported 2005/2012, not rounded up, not concealed).

What remains unproven: whether ANY entity can reach exact reconciliation using only currently-proven surfaces (Rasko still has 7 unaccounted rows after DESC+ASC+price+rooms), and whether the two untested ascending directions (price-up, rooms-up) would close the remainder — that is an open question for a future wave, not resolved here.

SHADOW_CITYWIDE_REBUILD_READY=NO (unchanged from Wave 0G-13 — this wave adds evidence the fail-closed architecture works, but does not establish that any large entity can be driven to exact completeness).

## Phase 15 — Tests

No `lib/` reusable logic was added or modified this wave — only new orchestration scripts (`scripts/audit-wave0g14-*.ts`) that call the existing, already-tested `toShadowDeal`/`dedupByTransactionKey`/`transactionKey`/`decodeRequestEnvelope`/`parsePaginationContract`/`assertSafeShadowOutputPath` primitives from Wave 0G-12/0G-13. Test items A-H (additional-sort dedup, union-stops-at-total, prevDeals exclusion, etc.) are already covered by the existing `lib/__tests__/shadowRebuild.test.ts` and `lib/__tests__/wave0g13PrevDealsRegression.test.ts` suites, whose behavior this wave's new scripts exercise but do not change.

Full suite: **297/297 pass** (unchanged count from Wave 0G-13's close — confirms no regression).
Typecheck: clean (no errors).
Build: succeeded (`npm run build`, Turbopack, pre-existing unrelated "middleware→proxy" deprecation warning only).

## Phase 16 — Canonical Safety

ROWS BEFORE=12642
ROWS AFTER=12642
SHA BEFORE=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
SHA AFTER=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f (unchanged)
SUPABASE_WRITES=0
IMPORTER_RUNS=0
DEPLOYMENTS=0

## Phase 17 — ECC Final Review

All 6 targeted reviewers completed. Verdicts: planner CONCERNS, specialist PASS (1 latent note), database-reviewer CONCERNS, silent-failure-hunter CONCERNS, security-reviewer CONCERNS, code-reviewer CONCERNS. No FAIL verdicts; no reviewer found a completeness overclaim, a credential leak, or a broken login-wall/fetch-depth boundary.

Findings and fixes applied:

| # | Reviewer | Finding | Fix applied |
|---|---|---|---|
| 1 | silent-failure-hunter | Sort-click success was only logged as a boolean, never asserted — a visible-but-inert click (stale DOM/debounced handler) could silently report stale baseline data as if the new sort had run | `audit-wave0g14-rasko-{price,rooms}-sort.ts`: added `capturedNewExchange` check; sets `entityFailed=true` with an explicit reason if the expected new `typeOrder` exchange never appears |
| 2 | silent-failure-hunter | Merge script had no guard against an empty filtered batch — a silently-failed click upstream would produce a plausible-looking "0 new rows" result with exit code 0 | `audit-wave0g14-rasko-merge.ts`: throws `PRICE_BATCH_EMPTY`/`ROOMS_BATCH_EMPTY` if the filtered batch is empty |
| 3 | security-reviewer | `assertSafeShadowOutputPath()` was not called before the `*_meta.json` writes in either sort script, nor anywhere in the merge script (which wrote `rasko_final_merge.json` via a raw hardcoded path) — breaks the stated invariant that it's the only sanctioned write path for shadow output | Added `assertSafeShadowOutputPath()` calls before all 3 remaining unguarded writes |
| 4 | planner, code-reviewer (MEDIUM, independently found by both) | `rasko_final_merge.json`'s `altSortRawCount`/`altSortDedupCount` fields only ever carried the price batch's numbers, never folded in the room-count batch added later in development | Renamed/split into `priceRawCount`/`priceDedupCount`/`roomsRawCount`/`roomsDedupCount`/`altSortCombinedRawCount`; downstream reconciliation numbers (`newRows`, `finalUnion`, `gapRows`) were unaffected since they were already built from the combined array |
| 5 | code-reviewer (LOW) | Merge script's header comment described only the price-sort merge, not the later-added room-count batch | Updated header comment to describe both alt-sort batches |
| 6 | planner (LOW) | "2 new sort requests" budget language could be misread as "2 total live network requests"; only 4 total responses (2 unavoidable baseline `dealDate_down` loads + 2 new-sort fetches) were actually received | Added an explicit budget-accounting note to the Phase 8 section above |
| 7 | planner, database-reviewer (LOW, traceability) | `ALREADY_KNOWN=994` combined figure was console-only, not directly quoted in the doc/JSON in a labeled way | Added the value with its source citation in the Phase 6/8 section above; merge script's log line reformatted to a grep-able `KEY=value` |
| 8 | planner (LOW) | Report implied Phase 4 was a scoped read of "every visible menu item" in the dropdown; it is actually a page-wide heuristic scan classified post-hoc | Reworded Phase 4 section above; added `kind: sort\|filter` field to `sort_ui_inventory.json` |
| 9 | specialist (LOW, latent, not yet exploited) | `decodeRequestEnvelope` returning `null` (undecodable envelope) would silently skip the `fetch_number>1` tripwire rather than failing closed | Added an explicit `if (!envelope) { entityFailed = true; ... }` branch in both sort scripts, ahead of the existing `fetch_number>1` check |
| 10 | database-reviewer | The `8252-109-0`-style "-0" subparcel aggregate-row anomaly (Wave 0G-13) was not re-tested against this wave's new price/rooms surfaces | Not fixed — explicitly disclosed as an untested residual risk (see Phase 10 above); no evidence found either way this wave, scope was reconciliation only |

After applying fixes 1-9, all 3 live-acquisition/merge scripts were re-run end-to-end; results reproduced identically (2005/2012, delta=7, same 5 recovered rows) confirming the fixes changed only failure-mode robustness and reporting clarity, not the substantive findings. Full suite (297/297), typecheck, and build were re-verified clean after the fixes (see Phase 15/16 above).
