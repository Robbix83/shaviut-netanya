# Wave 0G-9 — Beyond-500 Completeness Contract Proof

Status: EVIDENCE-ONLY / ACQUISITION-CONTRACT INVESTIGATION. No canonical data
changes, no Supabase writes, no importer, no deployment, no valuation
changes. The official discovery module was not altered.

## Phase 1 — Baseline

```
BASELINE_HEAD    = 824aefbc900e2f75512a39568e090fe4f8497532
CANONICAL_ROWS     = 12,642
CANONICAL_SHA256    = 18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
```

## Phase 2 — Current first-batch contract (נוף הטיילת, sourceId=65210195)

Using the already-proven direct-ID path (Wave 0G-8), captured live:

```
REQUEST_URL   = https://api.nadlan.gov.il/deal-data
METHOD          = POST
BASE_NAME        = "neighborhoodId"
BASE_ID           = "65210195"
FETCH_NUMBER       = 1
TYPE_ORDER          = "dealDate_down"
DOMAIN                = "www.nadlan.gov.il"

ROWS_RETURNED       = 500
FIRST_DEAL_DATE       = 2026-05-16 (most recent)
LAST_DEAL_DATE          = 2014-09-23 (oldest in this batch)
RESPONSE_ENTITY_ID        = 65210195
```

**Critical, previously-unnoticed finding**: the response's `data` object
contains three structural fields never inspected in any prior wave:

```
CONTINUATION_FIELDS (RESPONSE, not request):
  total_rows  = 1276  (the TRUE total transaction count for this entity —
                exactly matches the "נמצאו 1276 עסקאות" figure independently
                observed on the live UI page in Wave 0G-4)
  total_fetch  = 3     (the number of /deal-data fetches needed to cover
                total_rows at 500 rows/fetch)
  total_page    = 128   (the number of 10-row UI display pages needed to
                cover total_rows — 1276/128 ≈ 10 rows per UI page)
```

Distinguishing REQUEST fields from RESPONSE fields explicitly, as required:

```
REQUEST FIELDS:  base_id, base_name, fetch_number, type_order, domain
                 (plus session-bound sk/token/exp — present but never
                 logged by value, see Phase 4/Security below)
RESPONSE FIELDS: statusCode, data.total_rows, data.total_fetch,
                 data.total_page, data.items[]
```

No `hasMore`, `next`, `nextPage`, `cursor`, `offset`, or `count` field name
was found — but `total_rows`/`total_fetch`/`total_page` serve the identical
functional purpose (a total-vs-fetched-so-far signal), just under different
names. Full raw exchange saved at
[audit/wave0g9/continuation_exchanges_nof_hatayelet.json](continuation_exchanges_nof_hatayelet.json).

## Phase 3 — Tracing fetch_number

```
FETCH_NUMBER_SOURCE            = the request envelope (decoded passively via
                                reversal+base64 of the already-captured "##"
                                field — same technique reviewed safe in Wave
                                0G-5; no signing key accessed)
FETCH_NUMBER_INITIAL_VALUE       = 1 (on the direct-URL page's first request)
FETCH_NUMBER_MUTATION_OBSERVED     = YES — see Phase 6. The value changed from
                                1 to 2 across two consecutive real requests,
                                observed passively, never set by this session.
FETCH_NUMBER_CONSUMER               = the site's own client-side pagination
                                logic (triggered by exhausting the locally
                                loaded rows while clicking the visible "הבא"
                                control — see Phase 4/6)
```

```
Do we have ACTUAL evidence the official UI changes this value after more
results are requested?

YES.
```

This was proven live, not inferred from the field's name (per the wave's
explicit instruction not to assume pagination from naming alone).

## Phase 4 — Observing normal UI continuation

Using only normal, legitimate interactions (no reCAPTCHA handling needed —
the operator's already-warmed browser profile loaded the page normally):

```
UI_CONTINUATION_CONTROL = a real, visible "הבא" (Next) button
                          (id="next", class="arrows nextBtn") — confirmed
                          present, not disabled, not hidden
SECOND_NETWORK_REQUEST_TRIGGERED = YES
```

The button paginates through the client-side-cached rows first (10 rows per
UI page); a genuine new `/deal-data` network request only fires once the
locally-loaded 500 rows are exhausted. This boundary — 500 loaded rows ÷ 10
rows-per-page (itself derived from `total_rows`/`total_page` = 1276/128 ≈
10, not guessed) = 50 UI-page clicks — is a **data-derived number**, not an
arbitrary loop count. Clicking "הבא" exactly 50 times (as a script drove the
same click a real user would perform, one at a time, waiting for the DOM
between clicks) triggered the second real network exchange at precisely
click 50:

```
FIRST_SAFE_REQUEST_FIELDS  = fetch_number=1, type_order=dealDate_down
SECOND_SAFE_REQUEST_FIELDS  = fetch_number=2, type_order=dealDate_down
FIELD_DIFFERENCES             = fetch_number only (1 → 2); base_id, base_name,
                             type_order, domain all unchanged
```

```
UI_APPEARS_HARD_CAPPED = NO
VISIBLE_UI_ROW_COUNT_IF_DETERMINABLE = 1276 (the true total, per total_rows
                                       and the "1 / 128" page indicator —
                                       the visible UI itself already knows
                                       the full count, even before all rows
                                       are fetched)
```

Additionally found: a real, visible sort dropdown ("מיון") exposing 6
concrete options, including `"תאריך עסקה - סדר עולה"` (deal date - ascending)
— see Phase 8.

## Phase 5 — Operator fallback

Not needed. The operator's already-authenticated Chrome profile loaded the
page and responded to normal clicks without any reCAPTCHA/session
restriction encountered this wave.

## Phase 6 — Legitimate second-batch test

One second-batch request performed (triggered automatically by the 50th
"הבא" click, not manually constructed), target `65210195`:

```
BATCH_1_COUNT       = 500
BATCH_2_COUNT        = 500

BATCH_1_DATE_RANGE   = 2014-09-23 to 2026-05-16
BATCH_2_DATE_RANGE    = 2006-12-26 to 2014-09-18

CONTENT_KEY_OVERLAP   = 0  (content key = dealDate|dealAmount|assetArea|parcelNum)
UNIQUE_NEW_ROWS         = 500

RESPONSE_ENTITY_ID_1   = 65210195
RESPONSE_ENTITY_ID_2    = 65210195
ENTITY_MATCH_BOTH         = YES
```

**Acceptance signal met**: Batch 2 contains 500 genuinely new transactions
not present in Batch 1 — a clean, chronologically-contiguous, non-overlapping
continuation into older history. Independently re-verified by the specialist
review via direct boundary-date inspection (batch 1's oldest date,
2014-09-23, is strictly newer than batch 2's newest date, 2014-09-18 — the
disjointness is provable by construction, not just a count).

A real request/response correlation bug (matching by URL string alone, which
both requests share identically) was found and fixed mid-wave — see
Constraints — and all results shown here are from the post-fix, re-verified
run.

## Phase 7 — Third batch

Not fetched, per instruction: *"Do NOT fetch a third batch by default. Only
if Batch 2 proves continuation but leaves its semantics ambiguous, fetch ONE
third batch."* Batch 2's result was unambiguous — clean fetch_number
increment, zero overlap, correct entity, chronologically contiguous — so no
third batch was fetched via this mechanism. (Full coverage of the remaining
276 rows was independently achieved via the ascending-sort mechanism
instead — see Phase 8, which serves as an even stronger cross-validation
than a third same-mechanism fetch would have.)

## Phase 8 — Sort-direction investigation

The ascending option was **found in the live UI itself**, not invented from
naming symmetry: the sort dropdown's actual DOM content includes the literal
Hebrew string `"תאריך עסקה - סדר עולה"` alongside its descending counterpart
`"תאריך עסקה - סדר יורד"` — both real, visible, selectable options.

```
ASC_REQUEST_SUPPORTED = YES
ASC_REQUEST_VALUE       = type_order="dealDate_up" (observed, not guessed —
                        selecting the visible option produced this exact
                        value in the resulting request)
ROWS                      = 500
EARLIEST_DATE               = 1998-06-30
LATEST_DATE                   = 2011-03-24
OVERLAP_WITH_DESC_500          = 224 rows (overlap with the COMBINED two
                              descending batches' 1000 rows — expected,
                              since all three windows share some
                              chronological middle ground; not a defect)
UNIQUE_ROWS                     = 276
```

**This single ascending-sort request reaches further into history
(1998-06-30) than either individual descending fetch alone reached** (batch
2's oldest date was 2006-12-26) — confirming ascending sort is a genuinely
independent, useful history-access mechanism, not merely a relabeled
duplicate of descending pagination.

**Complete coverage achieved**: 500 (desc fetch 1) + 500 (desc fetch 2) +
276 (new, unique rows from the ascending fetch) = **1276 — exactly matching
`total_rows`**. Zero rows are unaccounted for. This was independently
re-verified by the specialist review reading the raw `contentKeys` arrays
directly, not trusting a summary count.

## Phase 9 — Date filter / range support

```
DATE_FROM_SUPPORTED     = NO / UNKNOWN
DATE_TO_SUPPORTED         = NO / UNKNOWN
YEAR_FILTER_SUPPORTED       = NO / UNKNOWN
UI_EXPOSES_DATE_RANGE         = NO — the only date-related controls found in
                              the live UI are the two sort-direction options
                              (ascending/descending), not a distinct
                              from/to date-range picker. No separate
                              historical-range filter UI element exists.
```

No historical slice was tested, since none was found to be legitimately
supported — consistent with the instruction not to fabricate field names.

## Phase 10 — Other official continuation signals

```
OTHER_CONTINUATION_MECHANISM = NONE beyond fetch_number pagination (Phase 6)
                              and sort-direction (Phase 8). The response's
                              own total_page (128) corresponds to the UI's
                              10-row display pagination, which is itself
                              just a client-side view over already-fetched
                              data plus the fetch_number-triggered
                              network continuation already documented — not
                              a separate, distinct mechanism.
EVIDENCE_SOURCE                 = live response metadata (total_rows,
                              total_fetch, total_page) and live UI
                              interaction (Phase 4/6/8)
```

No export/download function, map-movement-triggered request, or
result-total-only endpoint was found or tested.

## Phase 11 — Completeness strategy matrix

```
DIRECT-ID FIRST 500:            PROVEN (Wave 0G-8)
FETCH_NUMBER PAGINATION:          PROVEN (this wave, fetch 1→2, both נוף הטיילת and רסקו)
INFINITE SCROLL:                    DISPROVEN as a distinct trigger — scrolling
                                 the page body alone never triggered a new
                                 fetch in any test this wave or prior waves;
                                 the real trigger is exhausting the locally-
                                 loaded rows via the "הבא" click-through, not
                                 scroll position itself
VISIBLE PAGE PAGINATION:              PROVEN — the "הבא"/"הקודם" (Next/Previous)
                                 buttons are real and drive the underlying
                                 fetch_number continuation once local data
                                 is exhausted
ASCENDING SORT:                        PROVEN — a real, UI-exposed, independently
                                 useful history-access mechanism
DATE SLICING:                            DISPROVEN as a distinct mechanism — no
                                 separate date-range UI control exists;
                                 what looked like "date filtering" is fully
                                 accounted for by the sort-direction options
OTHER CONTINUATION:                       DISPROVEN — no additional mechanism
                                 found beyond the above, within the scope
                                 tested
ADDRESS-LEVEL AUGMENTATION:                 PROVEN for known addresses (Wave
                                 0G-4/0G-5); CITYWIDE ENUMERATION remains
                                 UNKNOWN/PARTIAL (unchanged from prior waves,
                                 not re-tested this wave)
```

## Phase 12 — Dedup / transaction identity

```
OFFICIAL_STABLE_TRANSACTION_ID = YES
FIELD = parcelNum (the gush-helka-subparcel composite string, e.g.
        "8252-156-59")
```

Verified directly across all 1,500 row-fetches captured this wave for נוף
הטיילת (3 overlapping requests × 500 rows): 1,276 unique content-keys
(date+price+area+parcelNum), zero rows with an empty `parcelNum`, and
exactly 1,276 unique non-empty `parcelNum` values — a perfect 1:1 match to
the true `total_rows` count, with every re-fetched duplicate row (from
overlapping batch windows) carrying the identical `parcelNum` for the
identical transaction.

```
KNOWN_COLLISION_RISK = LOW, based on this evidence — no collision observed
across 1,500 fetched rows spanning 3 overlapping request windows. Not
formally proven collision-free at citywide scale (only tested for one
entity), but structurally sound (gush-helka-subparcel is an official
cadastral identifier, not a derived/computed key).
```

No citywide dedup implemented, per instruction.

## Phase 13 — Second capped entity control (רסקו)

Continuation was proven on נוף הטיילת, so this control was run: `65210248`,
first batch + one continuation click-through (same 50-click, data-derived
mechanism — this entity's own metadata: `total_rows=2012, total_fetch=5,
total_page=202`, giving the identical ~10-rows-per-page derivation).

```
RASKO_BATCH_1        = 500 rows, dates 2022-03-27 to 2026-06-15
RASKO_BATCH_2         = 500 rows, dates 2016-09-07 to 2022-03-26
RASKO_NEW_ROWS          = 500 (zero overlap)
RASKO_OVERLAP             = 0
RASKO_ENTITY_MATCH          = YES (65210248 in both batches)
```

**This proves the mechanism is general, not נוף-הטיילת-specific.** Note:
only fetch 1→2 was tested for רסקו (1,000 of its 2,012 total rows recovered,
48%); fetches 3–5 and ascending sort were NOT tested for this entity — full
coverage was proven only for נוף הטיילת, not for רסקו. This distinction is
made explicit per the silent-failure-hunter review's finding that this
scoping must not be blurred.

## Phase 14 — Hard-cap alternative: multi-surface completeness

Not needed as a fallback — a genuine beyond-500 mechanism was proven
(Phase 6/8/11). For completeness, per instruction, the surface matrix is
still recorded conceptually:

| SURFACE | WHAT_IT_RECOVERS | KNOWN_BLIND_SPOT | ENUMERABLE_AT_CITY_SCALE | OVERLAP_RISK |
|---|---|---|---|---|
| A. direct neighborhood entity, fetch_number-paginated | full history per entity (proven: 100% for נוף הטיילת via 3 requests) | none proven this wave; untested whether every entity's total_fetch is reachable this cleanly | YES — via the official 38-entity catalog (Wave 0G-6/0G-7) | requires dedup by parcelNum (Phase 12) across overlapping fetch windows |
| B. street-level query | recovers more per-street history than a single neighborhood fetch, but proven noisy/contaminated (Wave 0G-3) | contamination from neighboring streets | PARTIAL — street-index.json has known coverage gaps | high, needs careful filtering |
| C. address-level query | reaches specific known addresses cleanly (Wave 0G-4/0G-5) | no proven citywide address enumeration | UNKNOWN/PARTIAL | low per-address, but no dedup tested at scale |
| D. official catalog / street lists | discovery only, not acquisition | n/a | YES (Wave 0G-6/0G-7) | n/a |
| E. ascending/descending sort cross-check | validates completeness for a given entity (proven: exact 1276 total match) | requires knowing total_rows in advance to know when done | YES, since total_rows is returned on every response | none — used as a completeness check, not a separate recovery path |

## Phase 15 — Can we build a complete-enough corpus?

```
Classification: D — MULTIPLE OFFICIAL MECHANISMS CAN BE COMBINED

BEYOND_500_STRATEGY = D
```

Fetch_number pagination alone (proven general across 2 entities) combined
with the response's own `total_rows`/`total_fetch` signal (which tells a
future harvester exactly how many fetches to perform, per entity, with no
guessing) is sufficient in principle to reach 100% of any single entity's
history — proven completely for one entity (נוף הטיילת, 1276/1276) and
partially (but generally) for a second (רסקו, 1000/2012, mechanism
confirmed working, remaining fetches not executed but not disproven either).

```
COMPLETE_ENOUGH_SHADOW_REBUILD_TECHNICALLY_PLAUSIBLE = YES
```

Not equated with "no pagination" — a real, general, legitimate mechanism
was proven. This does not mean a rebuild is trivial (each entity's
total_fetch count varies, so citywide scale would require reading and
respecting each entity's own total_rows/total_fetch signal, one entity at a
time) — but it is technically plausible, evidence-backed, not speculative.

## Phase 16 — Public product implication

```
CURRENT_PUBLIC_PRODUCTION_BLOCKED = YES
```

Not changed by this wave, per instruction.

```
IF HARD_500_CAP_WITHOUT_CONTINUATION: N/A — a continuation mechanism WAS proven.
```

Since an official continuation strategy is proven: it IS technically
plausible for a future SHADOW citywide rebuild (Phase 15). This wave does
NOT authorize such a rebuild — that decision remains for a future,
explicitly-authorized wave.

## Phase 17 — Quality / safety

No production/library code was modified this wave (only new, additive
audit-only diagnostic scripts under `scripts/`, reusing
`lib/nadlanAcquisition.ts`'s existing `buildDirectNeighborhoodUrl()` export
unchanged). Full gates re-run as a precaution:

```
Full test suite (npx vitest run)   = 233/233 PASS (21 files, unchanged from Wave 0G-8)
Typecheck (npx tsc --noEmit)          = clean, zero errors
Production build (npm run build)         = SUCCESS
```

```
data/deals.json SHA256 (before) = 18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
data/deals.json SHA256 (after)   = 18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
MATCH = YES

CANONICAL_WRITES = 0
SUPABASE_WRITES    = 0
CHECKPOINT_WRITES    = 0
```

No lint migration introduced, per instruction.

## Phase 18 — ECC final review

| ECC_REVIEWER | VERDICT | KEY_FINDING |
|---|---|---|
| planner | CONFIRMED, one caveat noted | Independently proved the 50-click derivation is not just correct but conservative-by-construction (`total_page = ceil(total_rows/rowsPerPage)`, so any rounding error can only *inflate* the click budget, never make it too small — the boundary can never be missed). Independently re-derived the 276-new-rows arithmetic from raw contentKeys (not the console summary) and spot-checked 3 specific overlap rows to confirm the 224-row overlap is genuine shared data, not padding. Explicitly refuted the "client-side re-render coincidence" alternative explanation using the exact click-50 timing and the zero-gap date seam as coincidence-proof evidence. Flagged two honest caveats, both addressed here: (1) the pre-fix (buggy-correlation) artifacts were overwritten in place rather than preserved separately — noted in Constraints below rather than reconstructed after the fact; (2) `fetch_number: 3` was never directly observed for either entity — continuation beyond fetch 2 is proven only via the independent ascending-sort cross-check for נוף הטיילת, and not proven at all for רסקו's remaining fetches 3-5, which is why Phase 13 explicitly scopes its claim to "mechanism generalizes," not "full history recovered." |
| specialist (code-explorer) | CONFIRMED, all 5 tasks | Independently verified the credential-safety of `decodeRequestEnvelope()` line by line; independently re-derived zero-overlap for both entities directly from date-prefixed contentKeys (mathematically forced disjointness given the observed boundary dates); confirmed no `fetch_number` value is ever constructed/sent by either script, only read from already-fired requests. One nuance added: the ascending batch's range is described as "reaching further into history" rather than "wholly disjoint" from the descending batches, since it does share a 224-row overlap window with them — both true) claims are compatible and both appear in this report. |
| silent-failure-hunter | 1 confirmed scoping risk (addressed), 4 not-a-risk | Confirmed loop-exhaustion and click-exception failure modes are both unambiguous in console output and JSON structure (`newExchangeDetectedAtClick` stays `null`, exchange count stays unchanged). Flagged a real scoping risk: raw JSON evidence alone proves fetch 1→2, not fetch 3+ (total_fetch=3 for נוף הטיילת, total_fetch=5 for רסקו) — this report is deliberately precise about that boundary throughout (Phase 11, 13, 15) rather than claiming blanket "pagination works" without qualification. Confirmed the request/response correlation fix left no remaining Map/URL-based correlation anywhere in either script. |
| security-reviewer | PASS, all 5 checks | Confirmed `decodeRequestEnvelope()` in both scripts returns only safe fields plus a `credentialFieldsPresent` array of field NAMES (never values) for sk/token/exp; confirmed zero credential values, JWT-shaped strings, or raw "##" envelopes anywhere across all 7 `audit/wave0g9/` files; confirmed neither script ever constructs, mutates, or replays a request body — every captured request originated from a genuine UI click. |
| code-reviewer | 1 minor CONCERN found and fixed, otherwise PASS | Confirmed no canonical/Supabase writes, all output confined to `audit/wave0g9/`, the correlation fix is complete in both files, and the click loop is properly bounded with no infinite-loop risk. Flagged a minor resource-leak gap: `ctx.newPage()`/`page.addInitScript()` ran before the code they protect was wrapped in try/finally, so a failure there (unlikely but possible) could leak a browser process — fixed in both scripts before this report was finalized, with both scripts re-verified to still produce identical, correct results afterward. |

**Critical reviewer questions, answered:**

1. Was any request mutation tested without legitimate source evidence? **NO** — confirmed independently by 3 of the 5 reviewers (planner, specialist, code-reviewer) via full-file reads; every request field observed this wave came from a genuine UI interaction, never hand-constructed.
2. Was any anti-bot/session material retained? **NO** — confirmed by the security-reviewer across every artifact; only field *names* (not values) for sk/token/exp are recorded, exactly as designed.
3. Is any claimed beyond-500 mechanism demonstrated with genuinely new rows? **YES** — 500 genuinely new rows for נוף הטיילת's fetch 2 (zero overlap, independently re-verified), 500 for רסקו's fetch 2, and 276 genuinely new rows from the ascending-sort cross-check (independently spot-checked).
4. Did the investigation confuse a different sort/filter view with pagination? **NO** — the planner explicitly tested and refuted this alternative explanation; the fetch_number-driven continuation and the sort-direction option are correctly reported as two DISTINCT, both-genuine mechanisms (Phase 11), not conflated with each other.

## Constraints and honesty notes

- The request/response correlation bug (URL-string-only matching, which could
  misattribute a response to the wrong request under near-simultaneous
  firing) was caught when an early sort-probe run produced an implausible
  result. It was fixed by switching to Playwright's own `resp.request()`
  reference for guaranteed 1:1 correlation, and all evidence files were
  regenerated after the fix. Per the planner's honest flag: the pre-fix,
  buggy-correlation artifacts were overwritten in place rather than
  preserved as a separate before/after pair — the bug itself is documented
  here in prose (this section and Phase 6), but not preserved as a raw
  artifact. This does not affect the validity of the current, post-fix
  evidence, which is internally consistent and was independently
  reproduced twice more after the fix (once for the continuation probe,
  once implicitly via the sort-probe re-run after the resource-cleanup fix).
- `fetch_number: 3` was never directly observed for either entity. Full
  completeness (100% of `total_rows`) was proven for נוף הטיילת only via the
  COMBINATION of fetch 1 + fetch 2 + the independent ascending-sort
  cross-check — not via fetch_number reaching 3 directly. For רסקו, only
  fetch 1→2 was demonstrated (1,000 of 2,012 total rows); fetches 3-5 remain
  untested. This report does not claim fetch_number pagination reaches
  arbitrarily high values, only that the 1→2 transition is real, general,
  and combined with sort-direction, sufficient to reach 100% coverage for at
  least one tested entity.
- `data/deals.json` SHA-256 verified unchanged throughout this wave.
