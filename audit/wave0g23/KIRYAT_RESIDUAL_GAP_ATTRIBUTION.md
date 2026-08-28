# Wave 0G-23 — Kiryat Hasharon Residual Gap Attribution

**Scope:** read-only attribution of the remaining 495-row top-level delta
(5,145/5,640, 91.22% coverage), using only already-committed Wave 0G-16
through 0G-22 evidence. Zero new live requests performed — every finding
below is derived from data already on disk.

Baseline commit: `0e6213a` (Wave 0G-22B, CLOSED SUCCESS).

**ECC-caught correction disclosed up front**: a CSV-parsing bug in this
wave's own analysis script initially misreported one manifest street
(ד"ר יהודה פרח) as genuinely undiscovered, when it was on the 70-street
manifest all along. This was caught by ECC planner review, fixed, and
the script re-run before this report was finalized — see Phase 5 and
Phase 16 for the corrected findings. The figures throughout this report
are the corrected ones.

## Phase 2 — Union reconstruction (reproduced exactly)

| | |
|---|---|
| ENTITY_BASELINE_UNIQUE | 2,518 |
| STREET_ACCEPTED_UNIQUE | 4,705 |
| ENTITY_STREET_OVERLAP | 2,078 |
| **FINAL_UNIQUE** | **5,145** (2,518 + 4,705 − 2,078, verified) |
| OFFICIAL_TOTAL | 5,640 |
| DELTA | 495 |
| Coverage | 91.22% |

82.6% of the entity-layer's own 2,518 transactions (2,078 of them) are
independently confirmed by at least one street-level fetch — a strong
cross-validation signal that both layers are measuring the same real
population, not diverging data sources.

## Phase 3 — Entity-only vs street-only vs both

| Layer | Count | % of union | Valid address rate | street=0 rate | Date range |
|---|---|---|---|---|---|
| ENTITY_ONLY | 440 | 8.6% | 37.0% | 63.0% | 1998-05-11 to 2026-06-21 |
| STREET_ONLY | 2,627 | 51.1% | 100% | 0% | 2006-12-20 to 2021-04-12 |
| BOTH | 2,078 | 40.4% | 100% | 0% | 1998-11-02 to 2026-06-29 |

**Every STREET_ONLY and BOTH row has a valid address by construction** —
street-level acquisition requires a resolvable street identity to even be
requested. **ENTITY_ONLY is the only layer that can see addressless
transactions**: 277 of its 440 rows (63%) have `street="0"`, a structural
blind spot street-level acquisition can never independently reach, since
there is no street to query by.

## Phase 4 — street="0" / no-street analysis

| | |
|---|---|
| STREET_ZERO_ROWS | 277 |
| MISSING_STREET_ROWS | 0 |
| MISSING_HOUSE_ROWS | 277 (identical set to street=0) |
| ENTITY_ONLY_STREET_ZERO | 277 (100% of street=0 rows are entity-only) |
| STREET_ONLY_STREET_ZERO | 0 |

These 277 rows are spread across a wide range of `dealNature` categories
(דירה בבית קומות 67, ללא תיכנון 83, קרקע למגורים 58, מסחרי+משרדים 15,
and 13 smaller categories), dated 1998-05-11 through 2026-06-21 — not
concentrated in one narrow slice. **These rows are already inside the
accepted 5,145 union** (via the entity layer) — they explain a
*characteristic* of the union, not a cause of the missing 495, per the
wave's own instruction not to claim otherwise.

## Phase 5 — Official street roster completeness

**Correction applied mid-wave** (ECC planner finding, BLOCKING): the
initial run used a naive `.split(",")` to parse the 70-street manifest
CSV, which breaks on two RFC-4180 quoted/doubled-quote-escaped entries
(`74001008,"ד""ר יהודה פרח"` and `74000607,"האר""י"`) — this caused
ד"ר יהודה פרח to be wrongly reported as absent from the manifest, when it
is in fact `streetId=74001008` and was already directly fetched
(`COMPLETE`, 290 rows, `total_fetch=1`). Fixed with a proper CSV-line
parser and the script re-run; the figures below are the corrected ones.

| | |
|---|---|
| ACCEPTED_ROWS_WITH_STREET | 4,868 |
| ROWS_ON_OFFICIAL_70_STREETS | 4,793 |
| ROWS_ON_STREETS_NOT_IN_70_MANIFEST | 75 |
| DISTINCT_NON_MANIFEST_STREETS | 3 |

| Street (as it appears in the data) | Rows | Layer(s) | Explanation |
|---|---|---|---|
| ליבר זאב | 31 | BOTH, STREET_ONLY | **Word-order variant of זאב ליבר** (streetId=74001234, confirmed on the manifest). |
| שפיגלמן אברהם | 28 | BOTH, STREET_ONLY | **Word-order variant of אברהם שפיגלמן** (streetId=74000875, on the manifest) — the same reversed-order variant already observed in Wave 0G-18's own fetch1 evidence for this street (476 vs 24 rows split exactly this way; independently re-verified by the specialist reviewer). |
| הרב משה צבי נרייה | 16 | BOTH, STREET_ONLY | **Fuller official name for הרב נרייה** (streetId=74001235, on the manifest) — independently confirmed by the specialist reviewer: every one of this street's own 17 raw fetch1 rows uses "הרב משה צבי נרייה" as the address-field street name, while the catalog label is the shorter "הרב נרייה". Stronger than a hypothesis. |

**All 3 non-manifest street names are confirmed name variants of streets
already on the 70-manifest.** With the parsing bug fixed, **zero
genuine catalog-incompleteness evidence survives this wave.** The
70-street roster is not shown to be missing any real street — the
apparent gap was entirely a CSV-parsing artifact in this wave's own
analysis script, now corrected.

## Phase 6 — Street total_rows accounting

| | |
|---|---|
| STREET_TOTAL_ROWS_SUM (all 70 streets) | 5,487 |
| OBSERVED_PARENT_ROWS | 4,672 |
| OBSERVED_FOREIGN_ROWS (5 probed mixed streets) | 518 |
| OBSERVED_ZERO_ROWS (5 probed mixed streets) | 21 |

**`STREET_TOTAL_ROWS_SUM` is deliberately not compared to 5,640.** Three
independent reasons make that comparison invalid: (a) any transaction
reachable via 2+ streets is counted once per street in this sum, so it
double-counts; (b) for the 7 boundary/mixed streets, this sum includes
hundreds of rows that genuinely belong to *other* entities (משכנות
זבולון, קריית יצחק רבין, etc.), not Kiryat Hasharon; (c) it structurally
excludes the 277 street=0 transactions that have no street exposure at
all. None of these three effects point the same direction, so no
adjusted comparison was attempted.

## Phase 7 — Complete-street coverage

| Status | Count |
|---|---|
| COMPLETE (raw exposure fully captured) | 69 of 70 |
| PARTIAL | 1 (דגניה) |
| UNRESOLVED (raw exposure) | 0 |

All 7 originally-mixed streets have `total_fetch=1` (confirmed directly
from their own committed metadata) — meaning the site has **no further
rows to give for any of them beyond what fetch1 already returned**. Their
remaining uncertainty is entirely about *identity composition* (2 of the
7 — אריאל שרון and האר"י — lack row-level PARENT/ZERO/FOREIGN
breakdown, only aggregate counts and distinct foreign-entity IDs), not
about untested additional rows.

| Street | Known delta / max opportunity | Reason |
|---|---|---|
| דגניה (74000847) | ≤1 row | fetch1=500 captured, total_rows=501; fetch2 untested this wave, and per instruction not fetched |
| All other 69 streets | 0 | total_fetch=1 for all of them; nothing more exists to fetch |

**MAX_KNOWN_STREET_PAGINATION_OPPORTUNITY = 1** (Dgania only) — and even
that 1 row is unproven to be genuinely new, given Spiegelman's own
33-row fetch2 yielded exactly 0 new rows to Kiryat (Wave 0G-22B).

## Phase 8 — Foreign non-zero rows

| | |
|---|---|
| FOREIGN_RAW_ROWS | 760 |
| DISTINCT_FOREIGN_ENTITY_IDS | 5 |

| Entity ID | Official name | Row count | Streets |
|---|---|---|---|
| 65210241 | משכנות זבולון | 347 | הרב שמואל הרטום |
| 65210240 | קריית יצחק רבין | 171 | הפארק |
| 65210388 | אזור תעשיה קריית אל | unknown split (single-entity batch: all 5) | אריאל שרון |
| 65210244 | בן ציון | unknown (shares a 237-row batch with 65210242) | האר"י |
| 65210242 | רמת חן | unknown (shares a 237-row batch with 65210244) | האר"י |

All 5 IDs map to **real, distinct, official Netanya neighborhoods** in
the 38-entity citywide catalog (`audit/wave0g16/catalog_snapshot.json`)
— strong evidence these are genuine boundary-street sharing with
legitimate neighbors, not data corruption or misattribution.

**Duplicate check** (row-level data available for 518 of the 760 foreign
rows, from the 5 probed streets): `FOREIGN_DUPLICATE_ACCEPTED=0`,
`FOREIGN_NOT_IN_ACCEPTED_UNION=518`, `FOREIGN_NORMALIZATION_FAILED=0` —
**every single row-level-known foreign transaction is confirmed absent
from our accepted union**, and the accounting is closed exactly (0+518+0
= 518, no silent drops). This is the strongest evidence in this wave that
foreign-id rejection is *correct behavior*, not a hidden Kiryat gap:
these are real, distinct transactions belonging to their own entities,
not duplicates of anything we already have. The remaining 242 foreign
rows (from the 2 unprobed streets) have no row-level data to run this
check on, but there is no reason to expect a different pattern.

## Phase 9 — Zero-id rows

| | |
|---|---|
| ZERO_RAW_ROWS | 21 |
| ZERO_DUPLICATE_ACCEPTED | 0 |
| ZERO_NOT_IN_ACCEPTED_UNION | 21 |
| ZERO_NORMALIZATION_FAILED | 0 (accounting closed: 0+21+0=21) |
| ZERO_ACCEPTED | 0 (unchanged — Wave 0G-19's policy remains closed) |

All 21 zero-id rows are confirmed genuinely absent from the accepted
union — same pattern as foreign rows. If Wave 0G-19's unresolved zero-id
semantics were ever conclusively resolved in favor of acceptance, this
would be a real (if small) 21-row opportunity. That policy question is
explicitly **not reopened** this wave.

## Phase 10 — Date coverage

Full year-by-year breakdown in `year_layer_distribution.csv`. Pattern
observed (not a proven cause of the 495 gap):

- **1998–2005**: STREET_LAYER contributes 0 in every year. Coverage in
  this range comes almost entirely from the entity layer's own
  ascending-date-sort surface (`date_asc_1`/`date_asc_2`, confirmed used
  in `audit/wave0g16/shadow-output/65209683.json`'s `surfacesUsed`) —
  street-level fetch1's 500-row, descending-only window per street
  cannot reach this far back for most streets.
- **2006–2021**: STREET_LAYER contributes meaningfully every year
  (9–290 rows/year, peaking 2007–2020) — this is where street-level
  per-street acquisition added the most unique value beyond the entity
  layer's own multi-surface reach.
- **2022–2026**: STREET_LAYER drops back to 0 — every row in these 5
  years is either ENTITY_ONLY or BOTH. Both layers naturally reach the
  most recent transactions (entity's own descending sort, and every
  street's fetch1 window, which is always most-recent-first), so recent
  years show no unique street-layer contribution.

`SUSPECT_DATE_INTERVALS = []` — no year meets the bar (≥10 rows and >50%
entity-only share) that would flag it as disproportionately dependent on
the entity-only layer. Highest entity-only share is 2024 at 24.5%, well
under the threshold. **No date-based coverage pocket was found.**

## Phase 11 — Property / deal semantics

`ROWS_WITH_DEALNATURE=4,994` of 5,145 (97.1%); `DISTINCT_DEALNATURE=26`.

Categories disproportionately entity-only (i.e., low `entityShare` means
street-heavy; high means entity-heavy):

| dealNature | Count | Entity share |
|---|---|---|
| ללא תיכנון (no zoning/unplanned) | 86 | **97.7%** |
| קרקע למגורים (residential land) | 124 | **66.9%** |
| מסחרי + משרדים (commercial + offices) | 20 | **75.0%** |
| דירה בבית קומות (standard apartment) | 4,334 | 4.6% |

Land/unplanned-designation and commercial property types are
structurally under-represented in street-level acquisition — plausibly
because these parcels often carry weaker or non-standard street/address
data in the source, consistent with the street=0 pattern in Phase 4.
Ordinary apartments (the overwhelming majority of the corpus) are
extremely well covered by street-level acquisition (95.4% non-entity-only).

## Phase 12 — Parcel ID quality

| | Entity-only | Street-only | Both |
|---|---|---|---|
| MINUS_ZERO_ROWS (parcelNum ending `-0`) | 6 (1.4%) | 1 (0.0%) | 19 (0.9%) |
| MISSING_PARCEL_ROWS | 0 | 0 | 0 |

No missing `parcelNum` anywhere in the union. The `-0` suffix pattern is
rare across all three layers (≤1.4%) with no meaningful correlation to
entity-only acquisition — **not a driver of the residual gap.**

## Phase 13 — Duplicate-surface saturation

Three distinct duplication measurements, kept separate rather than
conflated:

| Measurement | Rate | What it means |
|---|---|---|
| Street-vs-street (different streets' own accepted rows duplicating each other) | **0.0%** | Different streets are essentially geographically disjoint from one another — little to no cross-street redundancy exists among the currently-processed streets. |
| Street-vs-entity-baseline overlap | **44.2%** (2,078 of 4,705) | Nearly half of everything street-level acquisition finds was *already* independently visible via the entity layer's own 8 sort surfaces. |
| Spiegelman fetch2 specifically (the one directly-tested pagination case) | **100%** (33 of 33) | A clean, concrete illustration: once a street's fetch1 is already merged, its fetch2 continuation is highly likely to rediscover data the union already has via other paths, not add new rows. |

The Spiegelman result is not proof that *every* street's fetch2 would
behave identically (`STREET_FETCH2_GENERALIZATION=ONE_STREET_PROVEN`,
per Wave 0G-22B) — but combined with the 44.2% baseline-overlap rate and
the fact only 1 more row of pagination opportunity exists city-wide
(Dgania), it is strong evidence that further street-pagination
investment faces diminishing returns.

## Phase 14 — Official entity total semantics

`TOTAL_ROWS_SEMANTICS = TOP_LEVEL_CONFIRMED` for the core claim: 5,640 is
the site's own `/deal-data` response's `total_rows` field for a direct
entity-level request — not a figure we computed ourselves.

- **PrevDeals are not double-counted**: Wave 0G-13 already proved
  prevDeals are historical sub-events, never counted in top-level
  `total_rows`. Unaffected by this wave.
- **Street=0 rows ARE counted as ordinary top-level rows** by the site:
  277 such rows already exist inside our accepted top-level corpus,
  proving the site's own total_rows does not exclude them as some
  separate category.
- **Whether 5,640 could include addresses entirely outside the 70-street
  roster** (e.g., very new construction not yet catalogued) is
  **UNKNOWN** — no evidence in any committed artifact confirms or
  refutes this. Flagged as an open hypothesis, not a finding.

## Phase 15 — Known-gap ledger

Full table in `residual_gap_ledger.csv`. Summary (raw opportunity counts
are **not** summed where they overlap — see each row's own reasoning):

| Category | Raw rows / opportunity | Proven new rows | Can it explain the 495? |
|---|---|---|---|
| KNOWN_UNTESTED_STREET_PAGINATION | 1 (Dgania) | 0 | At most 1, unproven even that |
| ZERO_ID_REJECTED | 21 | 0 | No — policy closed, though all 21 are confirmed genuinely independent of the accepted union |
| FOREIGN_ID_REJECTED | 760 | 0 | No — genuinely other entities' data, correctly excluded (0 of 518 row-level-known rows duplicate anything accepted) |
| NO_STREET / STREET_ZERO | 277 | 0 | N/A — already inside the accepted union |
| NON_MANIFEST_STREET | 75 rows already accepted, 3 distinct street names, **all confirmed name variants of manifest streets** (corrected — an earlier CSV-parsing bug wrongly flagged one as genuinely missing; fixed, see Phase 5) | 0 | N/A — no catalog-incompleteness evidence survives |
| SOURCE_CONTRACT_UNREACHABLE / UNKNOWN | 495 | — | The honest remainder |

```
PROVEN_EXPLAINED_DELTA     = 0
PLAUSIBLY_EXPLAINED_DELTA  = 1  (Dgania, upper bound, itself unproven)
UNEXPLAINED_DELTA          = 495
```

**Every currently-known, evidenced acquisition lever together accounts
for at most 1 of the missing 495 rows, and that 1 is unproven.** The
missing 495 cannot be transaction-by-transaction identified from
existing evidence. This wave does not claim otherwise.

## Phase 16 — Next acquisition dimension (evaluated, not implemented)

| Option | Expected value | Evidence | Risk / cost |
|---|---|---|---|
| A. Street fetch2 scale-out | **LOW** | Spiegelman's proven case: 33/33 duplicates, 0 new. Max known remaining opportunity across all 70 streets: 1 row (Dgania). | Low request cost, but evidence says the ceiling is ~1 row citywide |
| B. Zero-id policy work | LOW-MEDIUM | 21 raw rows, all confirmed independent of the accepted union (real potential upside, capped at 21) | Requires reopening Wave 0G-19's explicitly unresolved semantics — a policy decision, not an engineering one |
| C. Foreign/boundary entity investigation | **NOT LEGITIMATE as an acquisition lever** | 760 rows, all mapped to real distinct official entities; 0 of the row-level-known ones duplicate accepted data | Accepting any of these would violate identity policy and likely be *wrong* (real other-entity transactions) |
| D. No-street / parcel-level acquisition surface | **LOW** (downgraded — see correction) | The one piece of evidence that would have raised this option's value (a genuinely under-catalogued street) turned out to be a CSV-parsing bug in this wave's own script, now fixed — with it corrected, there is no remaining evidence any street is missing from the 70-manifest. 277 known street=0 rows are already captured via entity layer; whether OTHER street=0 rows exist that entity layer also missed remains untested but has no supporting evidence either | No committed evidence supports pursuing this |
| E. Additional entity sort/filter surface | LOW | Entity baseline already used 8 distinct surfaces (date asc/desc ×2, price asc/desc, rooms asc/desc) and still only reached 2,518/5,640 — most cheap permutations already exhausted | A few surfaces remain untried (e.g. area/floor sort, second rooms-sort fetch) but marginal value is likely small given 8 already tried |
| F. Address-level lookup/enumeration | LOW leverage for an aggregate gap | Only useful for already-known addresses (Wave 0G-4/0G-5 precedent) — doesn't discover unknown gaps | Not a scalable lever for closing 495 unknowns |
| G. Accept 91.22% as current safe ceiling | — | Every tested lever this wave shows diminishing-to-zero returns, **including the one hypothesis (catalog incompleteness) that initially looked promising — refuted on correction** | Lowest cost, most honest given the evidence |

```
BEST_NEXT_ACQUISITION_QUESTION = "None of the currently-known levers
(street fetch2 scale-out, zero-id, foreign-id, additional entity sort
surfaces, catalog-completeness) show evidence of meaningful remaining
yield. Is there a NEW acquisition dimension — not yet attempted in any
Wave 0G-16 through 0G-23 — worth scoping, or should 91.22% be accepted
as the current safe ceiling (Option G)?"
```

**Correction note**: an earlier draft of this section proposed a
catalog-completeness question built on the (incorrect, since-fixed) claim
that ד"ר יהודה פרח was missing from the 70-street manifest. With that
claim corrected — the street was on the manifest all along — Option D's
main supporting evidence is gone, and **no option in this wave's
evidence shows a meaningfully non-zero expected value**. Option G (accept
91.22% as the current safe ceiling) is the conclusion best supported by
the evidence gathered this wave.

## Phase 17 — Dgania decision

`DGANIA_ESTIMATED_MAX_NEW_ROWS ≈ 1`.

`IS_DGANIA_FETCH2_WORTH_A_SEPARATE_WAVE = NO` — consistent with the
expected answer. Spiegelman's proven 0-new-rows result on a 33-row
fetch2 makes a separate wave to chase Dgania's ≤1-row opportunity a poor
use of a live-request budget. Not fetched this wave, per instruction.

## Phase 18 — Live request escalation

`LIVE_REQUESTS = 0`. No offline analysis this wave left an ambiguity that
required a live request to resolve — every phase's findings were fully
derivable from already-committed evidence.

## Phase 19 — Tests

Analysis-only wave; no application/lib code was modified, so no new
tests were created, per instruction.

- Full suite: 387/387 passed
- Typecheck: clean
- Build: clean (Next.js 16.2.6 / Turbopack)

## Phase 20 — Canonical / security

- `data/deals.json` rows: 12,642 (unchanged)
- SHA-256: `18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f`
  (unchanged, verified before and after)
- Supabase writes: 0
- Importer runs: 0
- Deployments: 0
- Security scan of all new tracked artifacts (script, report, 4 CSVs):
  no tokens, cookies, Authorization headers, session material, anti-bot
  values, or credential fragments found.

## Phase 21 — ECC review

Five reviewers, per this wave's assignment (security-reviewer skipped —
no new live artifacts this wave):

| Reviewer | Verdict | Key finding |
|---|---|---|
| planner | 4 CONFIRMED, 2 CONCERN including 1 **BLOCKING** | Confirmed the wave correctly separates opportunity counts from proven-new-rows, correctly avoids double-counting disjoint categories, correctly deprioritizes street pagination, and correctly keeps foreign/zero rows rejected. **Blocking bug found**: the manifest CSV parser broke on RFC-4180 quoted/escaped fields, wrongly flagging ד"ר יהודה פרח as absent from the 70-manifest when it was on it all along — this invalidated the report's original `BEST_NEXT_ACQUISITION_QUESTION`. **Fixed**: proper CSV-line parser written, script re-run, Phase 5/15/16 rewritten with corrected figures. Also caught a backwards sentence in the ledger CSV and a year-range error in Phase 10 prose — both fixed. |
| specialist | CONFIRMED (all 5 domain claims) | Independently verified the 476/24 שפיגלמן name-variant split from raw evidence; found even stronger direct evidence for the הרב משה צבי נrייה variant than the report originally claimed (the street's own raw address field literally uses the fuller name); confirmed all 5 foreign entity IDs and the 8-surface entity-baseline claim against source files exactly; confirmed no contradiction with any prior wave's verified findings. |
| database-reviewer | CONCERN, fixed | No core-logic bug: the set-membership provenance tagging is sound (the hypothesized ambiguous-collision edge case is structurally unreachable, since disagreeing rows by definition share a `transactionKey` and would be tagged consistently either way) and the foreign/zero duplicate-check's `toShadowDeal(item, neighborhood, PARENT_SOURCE_ID)` reuse is confirmed safe (`transactionKey` depends only on `parcelNum`/`dealDate`/`price`, never on the sourceId/neighborhood passed in). **Fixed as hardening**: added explicit `ambiguousCollisions>0` throws at all 3 `classifyTransactionGroups` call sites (previously trusted prior waves' claims silently) and converted the inclusion-exclusion check from a log line to a hard throw. |
| silent-failure-hunter | CONCERN, fixed | All ~10 file reads fail loudly on missing/malformed input; the union provenance-tagging integrity check is sound. **Real gap found**: a `toShadowDeal` normalization failure in the foreign/zero duplicate-check loops was silently excluded from both buckets with no counter — a reader could wrongly assume `FOREIGN_DUPLICATE_ACCEPTED + FOREIGN_NOT_IN_ACCEPTED_UNION` always equals the row-level-known count. **Fixed**: added explicit `FOREIGN_NORMALIZATION_FAILED`/`ZERO_NORMALIZATION_FAILED` counters with a hard accounting-sum assertion at both sites. |
| code-reviewer | WARNING, fixed | **MEDIUM (already-manifested bug)**: `csvEscape` was defined but never called — the committed `street_completion_status.csv` had a genuinely corrupted row for `האר"י` (unescaped embedded quote breaking column alignment for any real CSV parser). **Fixed**: every CSV write now routes street names and free text through `csvEscape`. **LOW**: dead imports (`extractPrevDealEvents`/`prevDealKey`/`RawPrevDealEvent`, leftover from the Wave 0G-22 template this script was based on) — removed. |

Re-ran typecheck (clean), full test suite (387/387, unchanged), and build
(clean) after applying all fixes and re-running the corrected script.
