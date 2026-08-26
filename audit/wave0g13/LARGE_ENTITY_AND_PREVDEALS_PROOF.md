# WAVE 0G-13 — LARGE-ENTITY COMPLETENESS + PREVDEALS CONTRACT PROOF

Bounded, evidence-only wave. No canonical rebuild, no Supabase writes, no
importer run, no deployment, no valuation/label changes. `data/deals.json`
remains frozen throughout (verified before/after — Phase 18).

## Phase 1 — Baseline

```
BASELINE_HEAD=0d8a28b01e0f54d36112cb3a155c26790933d883
ROWS=12642
SHA256=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
```
Matches expected exactly. `graphify-out/` pre-existing noise ignored.

## Phase 2 — Reconcile existing Wave 0G-12 Rasko data

Reused, NOT refetched:

```
RASKO_SOURCE_ID=65210248
OFFICIAL_TOTAL_ROWS=2012
OFFICIAL_TOTAL_FETCH=5
DESC_FETCH_1=500
DESC_FETCH_2=500
DESC_UNIQUE=1000
```
Exact match to expected values.

## Phase 3 — Rasko ascending-sort acquisition (NEW this wave)

Live acquisition via the already-proven direct-URL + sort-toggle mechanism.
**This is the first time any entity's ascending sort was continued past
fetch_number=1** (Wave 0G-9 only ever captured ASC fetch 1, on a different
entity, נוף הטיילת). ECC planner confirmed this is legitimate generalization
of an already-proven mechanism, not a new unproven technique — the same
"הבא" continuation button, the same fetch_number field, just exercised
under the ascending sort direction for the first time. A hard tripwire
(`fetch_number > 2` → immediate entity failure) enforces the depth ceiling
structurally, not just by convention.

```
ASC_FETCH_1_ROWS=500
ASC_FETCH_2_ROWS=500
ASC_FETCH_1_RANGE=1998-01-12 .. 2009-03-18
ASC_FETCH_2_RANGE=2009-03-25 .. 2016-06-06
ENTITY_ID_MATCH=YES (3/3 exchanges, 1500/1500 rows, sourceId=65210248 throughout)
```

No login wall encountered (3 network requests total, 53.0s — far short of
the ~101-click threshold that triggered it in Wave 0G-10). Direct sourceId
only; no name-resolution, no autocomplete.

## Phase 4 — Rasko four-window union

```
RAW_ROWS_TOTAL=2000
DESC_UNIQUE=1000
ASC_UNIQUE=1000
DESC_ASC_OVERLAP=0
FOUR_WINDOW_UNIQUE=2000
OFFICIAL_TOTAL_ROWS=2012
DELTA_TO_OFFICIAL=12
```

```
RASKO_DUAL_SORT_COMPLETENESS=PARTIAL (2000/2012 = 99.40%)
```

**Not COMPLETE** — per ECC planner's explicit correction, this must not be
rounded up or described as "essentially complete." The remaining 12 rows
sit in `total_fetch`'s window 3 (of 5), which was never requested. Full
data: `audit/wave0g13/rasko_dual_sort.csv`.

## Phase 5 — Date-range coverage check

```
DESC_EARLIEST=2016-09-07   DESC_LATEST=2026-06-15
ASC_EARLIEST=1998-01-12    ASC_LATEST=2016-06-06
UNION_EARLIEST=1998-01-12  UNION_LATEST=2026-06-15
```

A chronological gap exists: **2016-06-06 (ASC latest) to 2016-09-07 (DESC
earliest)** — approximately 3 months. This is *consistent with* where the
12 missing rows likely sit, but per ECC planner's correction, **this is not
independently verified** — no request was made into that specific window.
The reconciliation gate remains `FOUR_WINDOW_UNIQUE` vs `OFFICIAL_TOTAL_ROWS`
(2000 vs 2012), not date continuity.

## Phase 6 — prevDeals raw schema inventory

Using the already-captured Wave 0G-10 raw samples (500-row fetch1 batch,
full raw objects, not re-fetched):

```
Nof Hatayelet: TOP_LEVEL_ROWS_WITH_PREVDEALS=130/500, TOTAL_NESTED_PREVDEALS=183, MAX_PREVDEALS_PER_ROW=5
Rasko: TOP_LEVEL_ROWS_WITH_PREVDEALS=114/500, TOTAL_NESTED_PREVDEALS=179, MAX_PREVDEALS_PER_ROW=8
```

Field inventory (exhaustive — every one of 362 combined prevDeal entries
checked, not sampled):

| FIELD | EXAMPLE | NULL_RATE | MATCHES_TOP_LEVEL_FIELD |
|---|---|---|---|
| `dealDate` | `"2013-07-08"` | 0/362 (100% present) | YES — same field name/format as top-level |
| `dealAmount` | `1550000` | 0/362 (100% present) | YES |
| *(no other field ever observed)* | — | — | — |

**No** `dealNature`, `rooms`, `area`, `floor`, `parcelNum`, `address`,
`gush`/`helka`/`subparcel`, or any other field was ever present on a
prevDeal entry, across all 362 checked. A prevDeal entry inherits identity
ONLY from its parent top-level row (its parcelNum, address, property
attributes) — it carries none of its own.

## Phase 7 — What does prevDeals mean?

**Classification: A — prior transactions for the same property/unit.**
Proven, not inferred from field names, via 5 independent cross-checks
against the top-level `trend.years` field (a value the API itself derives):

| TOP_LEVEL parcelNum/date/price | PREVDEAL date/price | trend.years | date-gap check |
|---|---|---|---|
| 8247-229-80 / 2026-01-29 / 2,650,000 | 2013-07-08 / 1,550,000 | 12.6 | 2026-01-29 − 2013-07-08 = 12.56y ✓ |
| 8247-228-148 / 2025-12-11 / 6,700,000 | 2020-12-16 / 4,000,000 | 5.0 | 4.99y ✓ |
| 8247-229-66 / 2025-12-10 / 3,700,000 | 2012-02-16 / 2,052,000 | 13.8 | 13.81y ✓ |
| 8253-225-44 / 2025-12-01 / 3,200,000 | 2021-05-27 / 2,585,000 (+ older 2011-03-29 / 1,800,000) | 4.5 | 4.51y ✓ (matches nearest prevDeal) |
| 8252-177-2 / 2025-09-28 / 7,850,000 | 2019-07-29 / 3,850,000 | 6.2 | 6.17y ✓ |

All 5/5 independently confirm: `trend.years` = gap between the CURRENT sale
and the MOST RECENT prevDeal, proving prevDeals are genuine chronological
sale history for the SAME property, not unrelated metadata.

**Critical question — does one parcelNum appear with multiple historical
sales?** YES: parcelNum `8253-225-44` shows 3 total sales (2011, 2021,
2025) all correctly nested under one top-level row.

## Phase 8 — prevDeals vs top-level corpus

Flattened READ-ONLY, compared against Wave 0G-12's already-complete
1276-row top-level union for Nof Hatayelet (chosen as the test bed because
it is the ONE union already proven to exactly reconcile with official
`total_rows` — Wave 0G-12: `UNIQUE_TRANSACTION_ROWS (1276) ==
REPORTED_TOTAL_ROWS (1276)`):

```
NESTED_PREVDEALS_TOTAL=183 (from the 500-row fetch1 batch)
MATCH_EXISTING_TOP_LEVEL=0
NOT_PRESENT_TOP_LEVEL=183
```

**100% of the tested prevDeals events are absent from the complete
top-level union.** Sample of genuine-looking historical transactions never
present as top-level rows (full list: `audit/wave0g13/prevdeals_analysis.csv`):

```
parcelNum=8247-229-80  date=2013-07-08  price=1,550,000
parcelNum=8247-228-148 date=2020-12-16  price=4,000,000
parcelNum=8247-229-66  date=2012-02-16  price=2,052,000
parcelNum=8253-225-44  date=2021-05-27  price=2,585,000
parcelNum=8253-225-44  date=2011-03-29  price=1,800,000
```
```
DISTINCT_DATES=up to 183 (each event has its own date)
EARLIEST_DATE=2005-05-13 (from the 8252-109-0 "-0" example, Phase 11)
LATEST_DATE=2021-05-27
TOP_LEVEL_ONLY_CORPUS_INCOMPLETE=YES
```

**Scope, precisely (ECC database-reviewer + planner corrections):** this
100%-absence result is rigorous FOR the tested batch (183 events checked
against a COMPLETE 1276-row union — the comparison target's completeness
is what makes even this partial sample conclusive for the *existence* of
the gap). It is NOT extrapolated to the other 776 top-level rows' own
unchecked prevDeals, and NOT tested at all for Rasko (whose own union is
itself only 99.4% complete, making an absence test there ambiguous).

## Phase 9 — total_rows semantics

```
TOP_LEVEL_UNIQUE=1276 (exact match to official total_rows)
```

Using ONLY the rigorously-measured contribution of the 500-row fetch1
batch (not extrapolated): those 500 top-level rows alone carry 183
additional prevDeals events, ALL confirmed absent from the full 1276-row
union (Phase 8). Therefore **at minimum** 1276 + 183 = 1459 distinct real
transaction events exist for this entity — using only a subset of the
data, not even the full prevDeals count across all 1276 rows.

```
TOP_LEVEL_PLUS_NEW_PREVDEALS ≥ 1459 (measured minimum, not the true total)
official total_rows=1276
1459 > 1276
```

```
TOTAL_ROWS_SEMANTICS=A — top-level (most-recent-per-property) displayed
  rows only. Proven, not guessed: total_rows cannot include the measured
  prevDeals events, because doing so would already exceed 1276 using just
  one batch's contribution.
```

## Phase 10 — Future search corpus (concept only, not implemented)

```
RECOMMENDED_TRANSACTION_CORPUS=TOP_LEVEL + UNIQUE PREVDEALS, as a
  SEPARATELY-LABELED tier — not silently merged into one undifferentiated
  set.
```

Justification (per ECC database-reviewer): the evidence shows prevDeals
are genuine, additional historical transactions the official `total_rows`
count excludes entirely — a corpus that ignores them would silently omit
real sales history (exactly the failure mode this whole engagement began
by investigating, at Ben Ami 41). But prevDeals arrays are NOT proven
complete themselves (observed max 5-8 entries per row, unknown ceiling —
nadlan.gov.il may truncate older history), so a future corpus must NOT
claim "top-level + prevDeals = full history." It should tag each row with
its source (`top_level` vs `prevDeal`) so downstream consumers can
distinguish "the current/most recent sale" from "a recovered historical
sale" — valuation logic, for instance, may want to weight these
differently. No migration or implementation performed this wave.

## Phase 11 — Transaction identity revalidation

Full data: `audit/wave0g13/transaction_key_analysis.csv`.

| KEY | TOTAL_EVENTS | UNIQUE_KEYS | COLLISIONS |
|---|---|---|---|
| parcelNum+dealDate+dealAmount — top-level, 1 window | 500 | 500 | 0 |
| parcelNum+dealDate+dealAmount — top-level, 3 overlapping windows (Nof Hatayelet) | 1500 | 1276 | 224 |
| parcelNum+dealDate+dealAmount — flattened (top-level+prevDeals) | 683 | 683 | 0 |
| parcelNum+dealDate+dealAmount — Rasko DESC+ASC 4-window union (NEW) | 2000 | 2000 | 0 |

Collision classification:
- **224 collisions (Nof Hatayelet 3-window overlap): TRUE_DUPLICATE** — the
  exact same transaction re-fetched through overlapping acquisition
  windows. Correctly collapsed.
- **0 collisions anywhere else tested**, including the Rasko DESC+ASC
  4-window union — the two sort directions turned out to share NO
  transactions at all (clean complementary coverage, not an overlap that
  needed resolving).

**"-0" parcelNum special case (new concrete finding this wave):**
parcelNum `8252-109-0` (Nof Hatayelet) — top-level row claims `dealNature:
"דירת גג"` (penthouse), `assetArea: 1450` sqm, `floor: "שמונה עשרה"` (18th),
in a `buildingFloors: 17` building — **physically implausible for a single
residential unit** (a "penthouse" can't be on the 18th floor of a
17-floor building, and 1450 sqm is enormous for one apartment). Its
prevDeals: `[{1999-12-29, 4,805,000}, {1999-12-29, 788,000}]` — same date,
wildly different amounts. Per ECC database-reviewer: this is best
interpreted as a **parcel/building-level aggregate row**, not a genuine
single unit — consistent with Wave 0G-10's original "-0 rows are
ambiguous" caveat, now with concrete supporting evidence. The
`parcelNum+dealDate+dealAmount` key correctly keeps these two events
distinct (different amounts), but per ECC database-reviewer, this
separation currently works "by luck of differing prices, not by design" —
if two sub-shares of a "-0" parcel ever sold on the same date for the same
price, they would silently collapse. Not observed to happen in any tested
data, but not structurally prevented either.

## Phase 12 — Fallback key for weak parcelNum rows

```
PRIMARY_KEY=parcelNum + dealDate + dealAmount
FALLBACK_KEY=not required by any collision evidence found this wave — no
  case was found where the primary key failed for a MISSING parcelNum row
  (none existed in the tested samples) or an ambiguous "-0" row (the one
  concrete "-0" collision-risk case, 8252-109-0, was correctly resolved by
  the primary key's dealAmount component).
WHY=No arbitrary larger key was designed, per instruction, because no
  actual collision evidence demanded one. The identified residual risk
  (two "-0" sub-shares sharing both date AND amount) remains theoretical,
  not observed — flagged for future attention (Phase 11), not solved with
  a speculative key.
```

## Phase 13 — Nof Hatayelet prevDeals acceptance (Ben Ami 41)

```
BEN_AMI_TOP_LEVEL_ROWS=101 (full union, Wave 0G-12, unchanged)
BEN_AMI_PREVDEAL_EVENTS=0 (measured among the 46/101 rows that fall within
  the fetch1 sample — the other 55 rows were not checked, since their raw
  objects with prevDeals were never captured)
BEN_AMI_NEW_HISTORICAL_EVENTS=0 (within the tested subset only)
```

Per ECC planner's correction: this means "none among the 46 sampled," NOT
"Ben Ami 41 has no resale history" — a claim this wave's evidence does not
support for the other 55 rows. `דירת נופש` raw semantics reconfirmed intact
(Wave 0G-12's finding unchanged, not re-tested this wave).

## Phase 14 — Canonical comparison, bounded

```
NEW_PREVDEAL_EVENTS=183 (the Nof Hatayelet fetch1-batch events from Phase 8)
FOUND_IN_CANONICAL=0 (loose date+price match against all 12,642 canonical rows)
MISSING_FROM_CANONICAL=183
```

Consistent with Wave 0G-12's finding that Nof Hatayelet's entity was never
in the old system's discovery scope at all (0% top-level match either).
No canonical data read result was written anywhere.

## Phase 15 — Architecture gate

```
A. RASKO_SAFE_SURFACE_COMPLETENESS=PARTIAL
   (2000/2012 = 99.40% — does not meet the PROVEN bar of exact
   reconciliation; the union of legitimate safe surfaces does NOT equal
   official total_rows)

B. PREVDEALS_CONTRACT=PROVEN_INCLUDE
   (for the tested scope: prevDeals are genuine historical transactions,
   never redundant with top-level rows, and their exclusion causes
   TOP_LEVEL_ONLY_CORPUS_INCOMPLETE=YES — the "include" direction is
   proven; "for 100% of all prevDeals citywide" is not, per the Phase 8/9
   scope notes)
```

## Phase 16 — Citywide readiness

```
SHADOW_CITYWIDE_REBUILD_READY=NO
```

Per instruction, YES requires ALL of: large-entity completeness strategy
proven (NOT met — Rasko is PARTIAL, not PROVEN), transaction identity safe
(mostly met, with the "-0" theoretical residual risk noted), prevDeals
policy proven (directionally proven — INCLUDE — but not citywide-scoped),
no need for unsupported fetch depth (met — nothing beyond fetch_number=2
in either sort direction was attempted), canonical untouched (met). One
unmet criterion is sufficient to block readiness.

## Phase 17 — Tests

No reusable library logic changed this wave (only existing shared
functions from `lib/shadowRebuild.ts` were reused in new audit scripts).
Per the wave's own conditional instruction ("If reusable logic changes,
add focused tests"), this didn't strictly trigger — added anyway, as
regression anchors for the real examples this wave discovered:
`lib/__tests__/wave0g13PrevDealsRegression.test.ts` (5 tests): DESC+ASC
dedup safety (A), the `-0` same-day-different-amount non-false-merge case
(E, using the real 8252-109-0 example), and a unique prevDeals-derived
historical sale surviving normalization (D, using the real 8247-229-80
example).

```
Focused: 5/5 new tests pass
Full suite: 297/297 PASS (26 files, up from 292 at Wave 0G-12's close)
Typecheck: clean
Build: SUCCESS (all 25 routes)
```

## Phase 18 — Canonical safety

```
ROWS BEFORE=12642    ROWS AFTER=12642
SHA BEFORE=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
SHA AFTER= (same exact value)
SUPABASE_WRITES=0
IMPORTER_RUNS=0
DEPLOYMENTS=0
```

## Phase 19 — ECC final review

All 6 reviewers completed; every finding below was addressed before this
report was finalized.

| ECC_REVIEWER | VERDICT | KEY_FINDING |
|---|---|---|
| planner | CONFIRMED, 4 wording corrections applied | 2000/2012 correctly framed as PARTIAL (99.40%), not rounded up. ASC fetch_number=2 confirmed legitimate generalization of a proven mechanism, not an unproven depth. The 183/183 prevDeals-absence claim is rigorous for its tested scope (comparison target is complete) but must not be extrapolated citywide. Corrected 4 pieces of imprecise wording (DESC "reuse" framing, Rasko prevDeals presented as evidence, Ben Ami 41 "no resale history" overclaim, date-gap causation) — all applied to this report and the CSVs. |
| specialist (code-explorer) | CONFIRMED, all counts reproduced independently | 1500 raw items (3×500) all identity-valid for sourceId 65210248; four-window union numbers verbatim-matched; 130/183 prevDeals inventory exactly reproduced via grep counts; the 0/183 top-level-absence claim spot-checked on 5 of 183 entries with no contradiction (full 183 verified directly by this session's own code execution, not the reviewing agent's read-only toolset). |
| database-reviewer (lead) | CONFIRMED with 1 scope correction, 1 new finding | Corrected the "100% absent" framing to its precise tested scope. Independently identified and confirmed the `8252-109-0` penthouse anomaly (1450sqm, floor 18/17) as evidence for a parcel-level-aggregate interpretation of "-0" rows. Recommended TOP_LEVEL + UNIQUE_PREVDEALS as a separately-labeled tier — adopted in Phase 10. Flagged the "-0" dedup-by-luck risk — documented in Phase 11, not solved (no evidence demanded a fix). |
| silent-failure-hunter | 2 concerns fixed, 3 lower-severity noted | **Fixed**: the entity-failure discard only self-zeroed the FAILING exchange's rawItems, not earlier-captured ones — now explicitly zeroes all exchanges on any failure. **Fixed**: the merge script read Wave 0G-12's stored data and this wave's own ASC data with no sourceId/failure validation — now asserts both before merging. Noted (not fixed, low severity): the login-wall dismissal fallback was narrower than Wave 0G-10's version (fixed anyway, see code-reviewer); ASC dedup collision diagnostics logged but not persisted to JSON (informational only, no correctness impact). |
| security-reviewer | PASS (5/5) | Login-wall dismissal never touches the login button, stops after 3 confirmed hits. No credential values or even field-name arrays persisted to this wave's output files. fetch_number never fabricated. Merge script confirmed to make zero network calls. |
| code-reviewer | APPROVE, 3 LOW items fixed | Dead `toShadowDeal`/`ShadowDeal`/`neighborhood` import removed from the ascending script. Close-button selector list widened from 1 to match Wave 0G-10's proven 7-selector set. The regression test's second assertion (originally tautological, comparing a hardcoded pair to itself) rewritten to derive keys from the real `event1`/`event2` objects instead. |

**Critical review questions:**
1. **Is 2012/2012 actually proven or merely inferred?** Neither — it's
   **2000/2012, proven as PARTIAL**. Never claimed as 2012/2012.
2. **Are prevDeals genuine transaction events?** YES — proven via 5
   independent `trend.years` cross-checks (Phase 7), not inferred from
   field names.
3. **Could flattening prevDeals duplicate top-level rows?** NO — proven
   the opposite: 0/183 tested prevDeals events match any top-level row
   anywhere in the complete union (Phase 8).
4. **Could current key delete repeat sales?** NO — proven via both real
   data (the 8253-225-44 three-sale chain, all preserved) and unit tests.
5. **Are "-0" parcelNum rows handled safely?** Currently yes (0 observed
   collisions), but by favorable circumstance (differing amounts), not by
   structural guarantee — documented as a residual, unfixed risk since no
   actual failure was observed to fix.
6. **Was any unsupported fetch depth attempted?** NO — fetch_number never
   exceeded 2 in either sort direction; the login wall was never
   encountered or bypassed.
