# Wave 0G-15 — Rasko Final Gap Closure via Remaining Legitimate Sort Surfaces

## Baseline

BASELINE_HEAD=9e27af3 (Wave 0G-14 close)

Canonical:
- ROWS=12642 (unchanged)
- SHA256=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f (unchanged, before and after)

## Phase 2 — Reconstructed Current 2005-Row Union

Reused Wave 0G-13's `rasko_four_window_union.json` (2000 rows, DESC+ASC date sort) and Wave 0G-14's `rasko_final_merge.json`'s `newRows` (5 rows, price-desc + rooms-desc), no refetch. Reproduced via [`scripts/audit-wave0g15-rasko-merge.ts`](../../scripts/audit-wave0g15-rasko-merge.ts):

- OFFICIAL_TOTAL_ROWS=2012
- DATE_DESC_ASC_ROWS=2000
- PRICE_DESC_ROOM_DESC_NEW_ROWS=5
- RAW_ROWS=2005, UNIQUE_ROWS=2005, DELTA=7 — matches Wave 0G-14's committed evidence exactly (the script hard-stops if it doesn't).

## Phase 3 — Remaining Sort Values

From Wave 0G-14's [`sort_ui_inventory.json`](../wave0g14/shadow/sort_ui_inventory.json), both labels were proven **visible** but their `type_order` request values were never confirmed by network before this wave:

- PRICE_ASC_UI_LABEL=מחיר העסקה - סדר עולה — PRICE_ASC_TYPE_ORDER=**unproven until Phase 4**
- ROOM_ASC_UI_LABEL=מס' חדרים - סדר עולה — ROOM_ASC_TYPE_ORDER=**unproven until Phase 6**

**Causal-order correction (ECC specialist finding):** the live-fetch scripts (`audit-wave0g15-rasko-price-asc.ts`/`-rooms-asc.ts`) genuinely click by visible Hebrew text only and read whatever `type_order` the network returns, with no pre-click filtering. However, the merge script (`audit-wave0g15-rasko-merge.ts`) was written with `dealAmount_up`/`roomNum_up` as hardcoded expected-filter literals BEFORE either live script had run — these were an anticipated value based on the established naming convention (`dealDate_down`/`dealDate_up`, `dealAmount_down`, `roomNum_down` from prior waves), not a value confirmed in advance. Had the anticipation been wrong, `loadBatch()`'s empty-filter guard would have thrown rather than silently mislabeling data — so no incorrect data could have been accepted — but the original report wording overstated the causal ordering. The live captures (Phase 4/6) did independently confirm both anticipated values correct.

## Phase 4 — Price Ascending (live, fetch_number=1 only)

[`scripts/audit-wave0g15-rasko-price-asc.ts`](../../scripts/audit-wave0g15-rasko-price-asc.ts) → [`shadow/rasko_price_asc_meta.json`](shadow/rasko_price_asc_meta.json).

- Live network confirmed: **PRICE_ASC_TYPE_ORDER=dealAmount_up** (matches the naming pattern, but this is now a genuine wire observation, not an assumption)
- ROWS=500, IDENTITY_MATCH=YES (all 500 rows), no login wall

Merge against the reconstructed 2005-row union:
- ALREADY_KNOWN=500 (all of them)
- NEW_ROWS=0
- NEW_UNIQUE_TOTAL=2005
- DELTA_TO_2012=7

**2012 not reached** — per Phase 4's instruction, live acquisition continued to rooms-ascending.

## Phase 5 — New Price-Asc Rows

COUNT=0. No new rows recovered from price-ascending; the cheapest 500 Rasko transactions were fully covered by the 6 previously-tested surfaces.

## Phase 6 — Rooms Ascending (live, fetch_number=1 only, 2nd/final new-sort request this wave)

[`scripts/audit-wave0g15-rasko-rooms-asc.ts`](../../scripts/audit-wave0g15-rasko-rooms-asc.ts) → [`shadow/rasko_rooms_asc_meta.json`](shadow/rasko_rooms_asc_meta.json).

- Live network confirmed: **ROOM_ASC_TYPE_ORDER=roomNum_up**
- ROWS=500, IDENTITY_MATCH=YES (all 500 rows), no login wall

Merge (combined with price-asc, via [`scripts/audit-wave0g15-rasko-merge.ts rooms`](../../scripts/audit-wave0g15-rasko-merge.ts)):
- ALREADY_KNOWN=495 (out of 500 rooms-asc rows)
- NEW_ROWS=5
- FINAL_UNIQUE=2010
- FINAL_DELTA=2

All 5 new rows fall inside the previously diagnosed gap window (2016-06-06..2016-09-07), date range 2016-07-17..2016-09-05:

| parcelNum | dealDate | price | street | houseNumber |
|---|---|---|---|---|
| 8274-518-3 | 2016-08-10 | 1,100,000 | ויצמן | 84 |
| 8274-572-10 | 2016-07-21 | 960,000 | שדה יצחק | 5 |
| 8267-932-10 | 2016-09-05 | 1,219,000 | ויצמן | 70 |
| 8274-640-10 | 2016-07-25 | 999,000 | יצחק שדה | 8 |
| 8267-373-7 | 2016-07-17 | 970,000 | משה שפירא | 48 |

Per this wave's 2-new-live-request budget (now fully used: price-asc + rooms-asc), no further live acquisition was attempted, even though 2012 was not reached.

**Budget accounting note (consistent with Wave 0G-14's disclosure):** each of the 2 new-sort scripts independently navigates fresh and unavoidably triggers the site's own baseline `dealDate_down` fetch_number=1 load before the new sort is switched. This means 4 total `/deal-data` responses were received live this wave (2 baseline reloads + 2 new-sort fetches), not 2 — but exactly 2 DISTINCT new sort surfaces were tested, which is what the budget constrains.

## Phase 7 — Exact Completeness Reconciliation

OFFICIAL_TOTAL_ROWS=2012
PRE_WAVE_UNIQUE=2005
PRICE_ASC_NEW=0
ROOM_ASC_NEW=5
FINAL_UNIQUE=2010
FINAL_DELTA=2

PASS requires exactly FINAL_UNIQUE=2012, FINAL_DELTA=0. **Not met.** FINAL_UNIQUE (2010) did not exceed 2012 at any point — no STOP/FAIL condition was triggered, and no row was trimmed to force equality. Result is **PARTIAL**, reported exactly as measured.

## Phase 8 — Transaction Key Revalidation (all 6 tested surfaces)

Computed via [`scripts/audit-wave0g15-phase8-key-revalidation.ts`](../../scripts/audit-wave0g15-phase8-key-revalidation.ts) across date-desc, date-asc, price-desc, price-asc, rooms-desc, rooms-asc (8 individual fetch windows):

- RAW_ROWS_ALL_SURFACES=4000 (2000 already-deduped date union + 500×4 alt-sort batches)
- UNIQUE_KEYS=2010
- DUPLICATE_KEYS=1990
- COLLISION_GROUPS=1491

Classification: every collision group was checked for internal consistency of `street`/`houseNumber` (fields outside the key itself) — all 1491 groups were internally consistent, classifying as **TRUE_SAME_TRANSACTION**. **AMBIGUOUS=0**. **LEGITIMATE_DISTINCT collapsed=0** (by construction — `dedupByTransactionKey` only removes exact 3-field key matches, never a fuzzy/heuristic match, so a collapse would require two rows to share `parcelNum+dealDate+price` exactly while differing elsewhere; none did).

`parcelNum` is gush-helka-**sub**parcel granularity (confirmed by ECC database-reviewer against `lib/shadowRebuild.ts`'s own docstring) — two distinct apartments in the same building carry different sub-parcel numbers and therefore different keys, so they could never land in the same collision group to begin with. This makes the street/houseNumber consistency check redundant confirmation, not the primary safeguard; the primary safeguard is the key's own parcelNum granularity. The residual risk (see Phase 9) is narrower than "any two nearby transactions could collide" — it is specifically about the small number of `"-0"` **aggregate** parcelNum rows, which by their own ambiguous nature (Wave 0G-13 finding) may not carry genuine sub-parcel granularity.

Repeat-sale preservation: `PARCELS_WITH_MULTIPLE_DISTINCT_TRANSACTION_KEYS=0` within Rasko's own 2010-row top-level union — Rasko's tested data does not happen to contain a same-parcelNum repeat sale among its top-level rows, so this specific dataset offers no positive example either way. The key's ability to preserve genuine repeat sales was already proven in principle using Nof Hatayelet's prevDeals data (Wave 0G-13, 5/5 `trend.years` cross-checks); this wave adds no counter-evidence and no new proof for Rasko specifically.

## Phase 9 — "-0" ParcelNum Residual

Checked across this wave's 5 newly recovered rows (rooms-ascending batch; price-ascending contributed none):

NEW_MINUS_ZERO_ROWS=0
COLLISIONS_AMONG_MINUS_ZERO=0 (N/A — no minus-zero rows present)

**Follow-up full-union scan (prompted by ECC planner's finding that a "-0" key collision could plausibly explain the entire 2-row residual):** rather than checking only this wave's 5 new rows, [`scripts/audit-wave0g15-minus-zero-full-scan.ts`](../../scripts/audit-wave0g15-minus-zero-full-scan.ts) scanned the FULL 2010-row final union for "-0" parcelNum rows and checked whether any share a base (gush-helka) parcel with another "-0" row — the specific configuration where a date+price coincidence could theoretically cause an undetected collapse.

- TOTAL_MINUS_ZERO_ROWS_IN_FULL_UNION=53
- BASE_PARCELS_WITH_MULTIPLE_MINUS_ZERO_TRANSACTIONS=0

RISK_OBSERVED=No concrete evidence of a collapsed collision was found — 53 "-0" rows exist in Rasko's data, but none share a base parcel with another "-0" row, so this specific collision mechanism has zero footprint in the currently reconciled 2010 rows. This does NOT rule out the theoretical risk for the 2 still-unaccounted rows themselves (which are, by definition, outside the tested union and therefore unobservable by this check) — it only shows the risk has no observed instance among the rows that WERE recovered. The key was not redesigned this wave, per instruction.

## Phase 10 — PrevDeals Remains Separate

TOP_LEVEL_FINAL_UNIQUE=2010
PREVDEALS_INCLUDED_IN_2012_COUNT=NO

No new prevDeals fetch was performed this wave. PrevDeals remains a separate historical tier per Wave 0G-13's proven contract.

## Phase 11 — Architecture Gate

FINAL_UNIQUE (2010) != 2012, so the PROVEN-gate conditions in this phase do not apply:

RASKO_COMPLETENESS=**PARTIAL** (2010/2012 = 99.90%, up from 99.65% at Wave 0G-14's close; up from 99.40% at Wave 0G-13's close)
LARGE_ENTITY_WITHOUT_FETCH3_PROVEN=**NO** (still no entity has reached exact official-total reconciliation without fetch_number 3+; Rasko has now been narrowed to a 2-row residual using 6 distinct legitimate sort surfaces, all at fetch_number≤2 for date, fetch_number=1 for price/rooms)

## Phase 12 — Citywide Shadow Readiness (architecture evaluation only)

All the architectural prerequisites listed in this wave's Phase 12 continue to hold, now demonstrated across 6 independent sort surfaces instead of 4 (Wave 0G-14) or 2 (Wave 0G-13): official entity discovery proven, direct sourceId targeting proven, runtime `total_rows` available and sort-invariant (verified identical across every one of the 8 fetch windows this engagement has captured for Rasko), multiple legitimate safe acquisition surfaces proven (6 tested — price-asc/rooms-asc were the last ones found VISIBLE by Wave 0G-14's heuristic UI scan, not a provably exhaustive enumeration; see the caveat below), exact-reconciliation gate exists and correctly reports PARTIAL rather than rounding, transaction-safe dedup proven on tested scope (0 ambiguous/collapsed across 4000 raw rows this wave), prevDeals policy proven, and an incomplete entity (Rasko itself, right now) demonstrably fails closed rather than being silently accepted as complete.

What remains unresolved: all 6 sort options found by Wave 0G-14's UI inventory scan (date×2, price×2, rooms×2) have now been tested, and none closed the remaining 2-row delta. **This is not proof the surface list is exhaustive** (ECC planner and silent-failure-hunter finding) — that inventory was a page-wide DOM-text heuristic scan (`li, div[role='option'], a, button` matching a regex, classified post-hoc), not a guaranteed-complete enumeration of the sort menu; it never scrolled the menu or cross-checked its item count against the site's own menu-length indicator, so a 7th option worded without an explicit "סדר עולה/יורד" phrase could in principle exist unseen. The honest statement is: **no further sort surface is currently known to exist** for this entity, not that the surface list is provably closed. Closing the remaining 2 rows would require either discovering and testing a genuinely new legitimate surface, an unproven request mechanism (explicitly forbidden this engagement), or accepting Rasko as a PARTIAL/fail-closed entity in any future citywide run.

SHADOW_CITYWIDE_REBUILD_READY=**NO** (architecture-readiness criteria are met per Phase 12's own definition — the "YES means" checklist items are all satisfied — but the honest overall verdict stays NO/PARTIAL until at least one large entity is driven to full 2012/2012-style proof, which Rasko still is not; the wave's own Phase 12 clarifies YES is about architecture readiness, not citywide completeness, but this report continues to report NO here as in Wave 0G-13/0G-14 to avoid any risk of the verdict being read as "ready to run citywide").

## Phase 13 — Tests

No `lib/` reusable logic was added or modified this wave — only new orchestration scripts (`scripts/audit-wave0g15-*.ts`) reusing the existing, already-tested `toShadowDeal`/`dedupByTransactionKey`/`transactionKey`/`decodeRequestEnvelope`/`parsePaginationContract`/`assertSafeShadowOutputPath` primitives (unchanged since Wave 0G-12). Existing coverage in `lib/__tests__/shadowRebuild.test.ts` continues to exercise the behavior these new scripts rely on.

Full suite: **297/297 pass** (unchanged count — confirms no regression).
Typecheck: clean.
Build: succeeded (Turbopack; pre-existing unrelated "middleware→proxy" deprecation warning only).

## Phase 14 — Canonical Safety

ROWS BEFORE=12642
ROWS AFTER=12642
SHA BEFORE=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
SHA AFTER=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f (unchanged)
SUPABASE_WRITES=0
IMPORTER_RUNS=0
DEPLOYMENTS=0

## Phase 15 — ECC Final Review

All 6 targeted reviewers completed. Verdicts: planner CONCERNS, specialist CONCERNS, database-reviewer PASS, silent-failure-hunter CONCERNS, security-reviewer PASS, code-reviewer PASS. No FAIL verdicts; no reviewer found a completeness overclaim on the headline verdict (PARTIAL was consistently stated), no credential leakage, and no broken fetch-depth/login-wall boundary.

Findings and fixes applied:

| # | Reviewer | Finding | Fix applied |
|---|---|---|---|
| 1 | planner, silent-failure-hunter (independently, both CONCERNS) | Phase 12's "the exhaustive proven-surface list for Rasko is now closed" overreaches — Wave 0G-14's UI inventory was a heuristic DOM-text scan (never scrolled, no menu-length cross-check), not a provably exhaustive enumeration; a 7th sort option worded without an explicit direction phrase could exist unseen | Reworded Phase 12 and the CSV's summary row: "no further sort surface is currently known to exist," not "exhaustive"/"closed" |
| 2 | planner | Budget language could be misread as "2 total live requests"; actually 4 total `/deal-data` responses (2 unavoidable baseline reloads + 2 new-sort fetches) | Added an explicit budget-accounting note to the Phase 6 section |
| 3 | planner | Tension between Phase 8's "AMBIGUOUS=0 by construction" and Phase 9's open "-0" residual risk — 2 collapsed "-0" transactions sharing date+price could exactly explain delta=2 | Added a follow-up full-union scan ([`audit-wave0g15-minus-zero-full-scan.ts`](../../scripts/audit-wave0g15-minus-zero-full-scan.ts)): 53 "-0" rows exist in the 2010-row union, 0 share a base parcel with another "-0" row — no concrete evidence of a collapse among recovered rows (result added to Phase 9; explicitly does NOT rule out the risk for the 2 still-unaccounted rows, which are by definition outside the tested union) |
| 4 | silent-failure-hunter | `capturedNewExchange` check in both new scripts was looser than Wave 0G-14's pattern — accepted ANY non-baseline `type_order`, not specifically the intended one, so a misclick landing on a different known sort could self-report `entityFailed=false` | Added a `knownWrongValues` check in both scripts: fails closed if the observed value matches a different, already-proven sort direction rather than the intended one |
| 5 | silent-failure-hunter | Phase 8 script's `loadRawBatch()` lacked the `*_BATCH_EMPTY`-style guard present in the merge script's equivalent helper — a present-but-empty-after-filter file could silently contribute 0 rows without erroring | Added the same empty-check throw to `loadRawBatch()` |
| 6 | specialist | The merge script's `dealAmount_up`/`roomNum_up` filter literals were written BEFORE the live scripts ran and captured those values — the original report wording overstated strict "not inferred ahead of time" causal ordering | Corrected Phase 3 section: these were anticipated values based on established naming convention, safely fail-closed if wrong (via `*_BATCH_EMPTY`), and independently confirmed correct by the live captures — not literally undetermined until the click |
| 7 | database-reviewer | (no defect) Phase 8's street/houseNumber collision classification is redundant confirmation, not the primary safeguard — `parcelNum`'s own sub-parcel granularity already structurally rules out two distinct apartments sharing a key | Added this clarification to Phase 8, narrowing the residual risk explicitly to "-0" aggregate rows rather than "any two nearby transactions" |

After applying fixes 1, 4, and 5 (the only ones requiring code changes), both live-acquisition scripts and the Phase 8 revalidation script were re-run end-to-end; results reproduced identically (2010/2012, delta=2, same 5 recovered rows, same 53 minus-zero rows / 0 collision bases). Fixes 2, 3, 6, 7 were documentation/wording corrections only. Full suite (297/297), typecheck, and build were re-verified clean after the fixes.
