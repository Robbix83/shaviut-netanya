# Wave 0G-3 — Street-Level Acquisition Proof: עובד בן עמי

Status: EVIDENCE ONLY. No fix, no rebuild, no canonical writes, no Supabase writes, no deployment.

`data/deals.json` SHA-256 verified byte-identical before and after this wave:
`18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f`

---

## Phase 1 — Verify street-mode implementation

Inspected `scripts/harvest.ts` (unchanged, not executed as a full run).

```
STREET_MODE_FUNCTION      = harvestByStreets()  (scripts/harvest.ts:271-339)
UPSTREAM_QUERY_TYPE        = same nadlan.gov.il "/deal-data" XHR endpoint used by
                              neighborhood mode, but reached via typing a street name
                              into the search box and clicking an autocomplete
                              suggestion, instead of a neighborhood-name suggestion
STREET_IDENTIFIER_USED     = free-text street name ("<streetName> נתניה"), matched
                              against live autocomplete <li> suggestions. Selection
                              priority in the real harvester (harvest.ts:305-314):
                              1) an <li> whose text contains the exact streetName AND
                                 "נתניה" (exactOpt) — tried FIRST
                              2) else an <li> containing "רחוב" AND "נתניה" (streetOpt)
                              3) else press Enter with no selection
NETWORK_REQUEST_SHAPE      = identical to neighborhood mode: intercepted "/deal-data"
                              response body, JSON or base64+gzip, {data:{items:[...]}}
MAX_ROWS_PER_STREET        = not hardcoded anywhere in harvest.ts — governed entirely
                              by scrollUntilDone() + whatever upstream returns per
                              response. No client-side slice/limit exists.
PAGINATION_OR_SCROLL_BEHAVIOR = same scrollUntilDone() used by neighborhood mode:
                              infinite-scroll (window.scrollTo bottom),
                              MAX_SCROLL_ROUNDS=200, SCROLL_IDLE_ROUNDS=4
STOP_CONDITION              = idle scroll (no new items for N consecutive rounds),
                              MAX_SCROLL_ROUNDS reached, or a 405 reCAPTCHA rejection
```

A second, separate single-street entry point also exists: `HARVEST_STREET=<name>`
(harvest.ts:444, 465-489) calls `harvestByStreets()` for exactly one street directly
(no need to iterate a whole neighborhood's street list). Both paths share the same
underlying `harvestByStreets()` function and the same suggestion-selection logic.

**Can עובד בן עמי be queried independently through this path? YES — confirmed live
in Phase 3 below**, using logic duplicated from `harvestByStreets()`'s single-street
loop body (not `scripts/harvest.ts` itself, which was never executed).

## Phase 2 — Side-effect safety

```
CANONICAL_DEALS_JSON_WRITE = YES — both the normal per-neighborhood loop and the
                              HARVEST_STREET=<name> single-street path unconditionally
                              write data/deals.json at the end of the run
                              (harvest.ts:487, 535), merging with existing content.
                              CONFIRMED UNSAFE to invoke scripts/harvest.ts directly,
                              in any mode, without risking canonical mutation.
CHECKPOINT_WRITE            = NONE — no checkpoint file distinct from data/deals.json
                              exists anywhere in the harvest pipeline.
SUPABASE_WRITE              = NONE in the HARVEST_STREET branch specifically — that
                              branch returns (harvest.ts:489) before the code ever
                              reaches the DATA_SOURCE==="supabase" block (harvest.ts:515).
OTHER_CANONICAL_WRITE       = NONE observed.
```

Diagnostic mode used: a minimal audit-only wrapper (`scripts/audit-wave0g3-street-fetch.ts`,
new file, not imported by the app) that duplicates the necessary decode/parse/normalize
functions and the single-street search-and-scroll flow verbatim, writing only under
`audit/wave0g3/`. It contains no code path that opens or writes `data/deals.json` and no
Supabase client at all. This mirrors the same safety pattern used in Wave 0G-2's
`scripts/audit-wave0g2-live-fetch.ts`.

## Phase 3 — Live street-level fetch

Query target: `עובד בן עמי` (exact text as it appears in canonical `deals.json`'s
`street` field). Executed live via the operator's existing, reused `~/.harvest-chrome`
Chrome profile (not created or modified by this session).

```
RAW_RESPONSES              = 2   ("/deal-data" fired twice: +430, then +500)
RAW_ROWS                   = 930
UNIQUE_ROWS                = 930  (0 duplicates by keyValue/dealId)
DUPLICATES                 = 0
EARLIEST_DATE (raw pool)   = 1998-01-07
LATEST_DATE (raw pool)     = 2026-05-28
DISTINCT_HOUSE_NUMBERS (raw pool) = 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,
                              20,21,22,23,24,25,26,27,30,32,33,34,35,36,38,40,42,44,
                              45,46, plus 19 rows with no parsed house number

EXACTLY_500                = false (930 total, across two responses)
HAS_MORE_SIGNAL            = YES — a second "/deal-data" response fired after the
                              first (430), reaching 930 before going idle
SECOND_REQUEST_OR_SCROLL   = YES — the second response was scroll-triggered, exactly
                              the mechanism that NEVER fired in Wave 0G-2's
                              neighborhood-level test (which stayed at one response,
                              500 rows, and never fired a second "/deal-data" call
                              despite 5 full scroll-idle rounds)
STOP_REASON                = scroll-idle (no new items for 5 consecutive rounds)
```

**Critical clarification — raw volume is not the same as on-street data.** The
autocomplete suggestion actually clicked was `"עובד בן עמי 2 נתניה" [כתובת/address type]`,
not a plain "רחוב" (street-type) suggestion — because `harvestByStreets()`'s own
selection logic tries an exact-text match FIRST, and an exact address-level match
existed here for house number 2. Clicking it opened what behaves like a
geographic/nearby-address feed, not a pure single-street registry: of the 930 raw
rows, only 495 have an `address` field that actually contains "בן עמי" — the other
435 belong to entirely different streets in the vicinity (ניצה, ז'בוטינסקי, שלמה
המלך, המעפילים, דוד המלך, ביאליק, בן גוריון, and others). This explains the
misleadingly wide house-number spread (1–46) in the raw pool above — most of those
numbers belong to other streets, not עובד בן עמי.

Genuinely on-street subset (address contains "בן עמי"):

```
ON_STREET_ROWS              = 495
ON_STREET_EARLIEST_DATE     = 1998-01-07
ON_STREET_LATEST_DATE       = 2025-07-14
ON_STREET_HOUSE_NUMBERS     = 2, 10   (identical set to canonical — no new numbers)
ON_STREET_PROPERTY_TYPE     = 100% apartment (495/495)
```

A second live query for the coded alias `שד עובד בן עמי` (street-index.json code
1078, same neighborhoodId as the plain form) returned **zero** autocomplete
suggestions and zero rows — nadlan.gov.il's own search does not recognize this
alias form as a separate searchable entity. This is consistent with, and does not
contradict, Wave 0F-1's finding that the two forms are aliases of one physical
street (same neighborhoodId/coordinates) — nadlan.gov.il itself only indexes the
plain form for search purposes.

## Phase 4 — Ben Ami 41 reconciliation

All five checked independently against the full 930-row raw pool, the 495-row
genuine on-street subset, and a loose price-only scan (in case of date/area
formatting drift):

| # | Date | Price | Area | Rooms | Type | RAW_FOUND | RAW_HOUSE_NUMBER | RAW_ADDRESS | RAW_TXN_ID | PARSED | WOULD_BE_EMITTED |
|---|------|-------|------|-------|------|-----------|-------------------|-------------|------------|--------|-------------------|
| 1 | 2024-11-15 | ₪280,000 | 65 | — | דירת נופש | false | N/A | N/A | N/A | false | NO |
| 2 | 2023-06-21 | ₪925,000 | 65 | 3 | דירת נופש | false | N/A | N/A | N/A | false | NO |
| 3 | 2023-05-11 | ₪680,000 | 45 | 2 | דירת נופש | false | N/A | N/A | N/A | false | NO |
| 4 | 2023-04-20 | ₪975,000 | 65 | 3 | דירת נופש | false | N/A | N/A | N/A | false | NO |
| 5 | 2022-06-08 | ₪232,000 | 45 | 2 | דירת נופש | false | N/A | N/A | N/A | false | NO |

Additional checks performed, all negative:
- `address` field containing the literal substring "41" anywhere in the 930-row raw
  pool: **0 occurrences**.
- Loose price-only match (ignoring date/area, in case of formatting drift): each of
  the 5 target prices matched either zero rows, or rows at a **different address
  and different date** than the target (e.g. ₪280,000 matched an unrelated
  `עובד בן עמי 2` transaction dated 2010-04-14 and an unrelated `ז'בוטינסקי 32`
  transaction — neither is transaction #1). No genuine match found for any of the 5.
- `dealNature` containing "נופש" (the target property type) does occur 73 times in
  the raw pool — but every one of those rows is address `עובד בן עמי 2`, at prices/
  dates that do not match any of the 5 targets.

**All five known official Ben Ami 41 transactions remain completely absent — 0/5 —
from this live street-level pull, exactly as in Wave 0F-3A (WebFetch-era, not
executed) and Wave 0G-2's neighborhood-level live pull.**

## Phase 5 — Compare query modes

```
NEIGHBORHOOD_MODE_ROWS          = 500  (Wave 0G-2, target: נוף הטיילת)
NEIGHBORHOOD_MODE_EARLIEST_DATE = 2024-12-01
NEIGHBORHOOD_MODE_RESPONSES     = 1 (never triggered a second "/deal-data" call)

STREET_MODE_ROWS (genuine on-street) = 495
STREET_MODE_EARLIEST_DATE            = 1998-01-07
STREET_MODE_RESPONSES                = 2 (successfully triggered a second call)

BEN_AMI_41_FOUND_NEIGHBORHOOD_MODE = NO (Wave 0G-2)
BEN_AMI_41_FOUND_STREET_MODE       = NO (this wave)
```

Context note: canonical `data/deals.json` rows for street `עובד בן עמי` carry
`neighborhoodId=66239254` ("מרכז העיר צפון" — the one neighborhood the production
harvester queries in street mode), NOT `66239231` ("נוף הטיילת", the id
`street-index.json` associates with this street and the one tested in Wave 0G-2).
This is the same neighborhood-resolution mismatch documented in Waves 0F-2A/0F-2B
(the already-fixed valuation-fallback defect) — it does not change this wave's
acquisition-completeness conclusions, but it means Phase 5's two query modes were
never truly measuring "the same neighborhood twice"; they are compared here only
because the user's wave scope explicitly requested this exact comparison.

Street mode DID succeed at something neighborhood mode could not: it broke past a
single-response ceiling (2 responses instead of being capped at 1) and reached
back to 1998 instead of a ~500-day rolling window. But for the one specific,
proven-real gap (Ben Ami 41), that extra reach made no difference — 0/5 either way.

## Phase 6 — Current canonical comparison

```
CANONICAL_STREET_ROWS   = 65   (house numbers: 2, 10 only)
LIVE_STREET_ROWS         = 495  (genuine on-street subset; house numbers: 2, 10 only)

CANONICAL_HOUSE_NUMBERS  = 2, 10
LIVE_HOUSE_NUMBERS       = 2, 10   (identical set — no new house numbers recovered)

LIVE_ROWS_MISSING_FROM_CANONICAL = 371, by exact (dealDate, price, areaSqm) content-key
  comparison. All 65 canonical rows were found present in the live pull (0 canonical
  rows are missing from live) — canonical is a true subset of live for this street.
  The 371 additional live rows are all at house numbers 2 or 10, spanning back to
  1998; none are at house number 41 or any other number.
```

Nothing was merged or written back; this is a read-only count comparison only.

## Phase 7 — Is street mode itself complete?

```
STREET_LEVEL_CAP                        = UNKNOWN
STREET_LEVEL_RESULT_SAFE_FOR_THIS_STREET = PARTIAL
```

Reasoning:
- The second response in this fetch returned exactly 500 items (430 + **500** = 930),
  the same round number seen as a hard ceiling in Wave 0G-2's neighborhood-level
  test. That is suggestive — but not conclusive — of the same 500-per-response
  ceiling applying here too, just with more than one response available at this
  level of granularity.
- Scrolling stopped via idle-timeout (5 consecutive rounds with no growth), not via
  an explicit "no more data" signal or a 405 rejection — so it cannot be ruled out
  that a longer scroll session, or a different UI entry point (the untested "רחוב"-
  labeled suggestion branch, since no separate one existed for this exact street),
  could reach further.
- More importantly: this test's underlying nadlan.gov.il view was NOT a pure
  single-street registry — it was contaminated by ~435 rows from neighboring
  streets, because the exact-text autocomplete match nadlan offered for this
  street happens to be an address-level suggestion, not a street-level one. This
  is exactly what the REAL `harvestByStreets()` code would also select (its
  exact-match branch is checked first), so it is a faithful reproduction of
  production behavior — but it also means this evidence does not cleanly isolate
  "street-level acquisition" as a distinct, uncontaminated query type for this
  street. A cleaner test would require a street whose autocomplete offers a
  genuine "רחוב"-typed suggestion, which did not happen to be available here.

## Phase 8 — Scalability estimate

No further live queries were run for this phase (per instruction). Using existing
municipal/street-index data only:

```
OFFICIAL_CODED_STREETS       = 1,048  (data/netanya-streets-raw.json)
STREETS_WITH_DEAL_ACTIVITY   = 417    (distinct data/deals.json street values)
```

Conceptually, a citywide per-street rebuild (if ever approved) would replace ~21
neighborhood-level queries with up to ~417–1,048 individual street-level queries
(one per street with known or possible activity), each subject to the same
politeness delay (`POLITE_DELAY_MS=4000`) and the same reCAPTCHA/session
constraints already governing the existing `STREET_MODE_NEIGHBORHOODS` path for
"מרכז העיר צפון" (~148 streets today).

```
NUMBER_OF_STREET_QUERIES     = up to ~417 (activity-only) to ~1,048 (full coverage),
                                roughly 3–7x more individual browser-driven queries
                                than the current 21 neighborhood-level queries
EXPECTED_CAP_RISK_PER_STREET = UNKNOWN per Phase 7 — this wave could not confirm
                                whether individual streets are themselves capped;
                                the one street tested returned uncapped-looking
                                volume (930) but with unresolved contamination from
                                neighboring streets (see Phase 7)
DEDUP_REQUIREMENT            = high — as observed directly in this wave, a single
                                street-level query can return rows belonging to
                                several other streets (435 of 930 rows here), so a
                                citywide street-mode rebuild would need cross-street
                                dedup, not just within-street dedup
NORMALIZATION_REQUIREMENT    = unchanged from today's normalize() pipeline; no new
                                normalization logic identified as necessary
```

No execution plan beyond this estimate was produced, per instruction.

## Phase 9 — Proof-of-solution verdict

Classification: **C — STREET MODE DOES NOT RECOVER THEM**

`STREET_LEVEL_ACQUISITION = NOT_VIABLE` (specifically, as a fix for the proven
Ben Ami 41 gap — see caveat below).

Street-level acquisition via the exact code path `harvestByStreets()` already uses
in production did recover substantially more historical data than canonical
currently holds for this street (495 vs 65 rows, reaching back to 1998 instead of
whatever window canonical currently spans) — but every one of those additional 371
rows is still confined to house numbers 2 and 10. House number 41 does not appear
even once, in any of the 930 raw rows returned (including the 435 rows swept in
from neighboring streets), under either strict or loose matching. Zero of the 5
known official Ben Ami 41 transactions were recovered.

## Phase 10 — Data strategy implication

Not answered as PROVEN_VIABLE, per instruction ("only if street mode is proven
viable") — street mode was NOT proven viable for this specific gap. For the record:
even if it had been proven viable, this wave's own evidence (the 435 contaminating
rows from other streets, and the still-unresolved Phase 7 cap question) would
already show it does not guarantee complete government-data parity on its own —
consistent with the instruction's own expectation.

## Constraints and honesty notes

- This wave tested exactly one street ("עובד בן עמי") and its one known
  street-index alias ("שד עובד בן עמי", which nadlan.gov.il does not recognize at
  all). No other street was queried.
- The "street-level" result obtained is, on closer inspection, an address-level
  / nearby-area result for this particular street, because that is what
  `harvestByStreets()`'s own real selection logic would click here too. This wave
  does not have evidence of what a genuinely isolated, contamination-free
  "רחוב"-typed query would return, because no such suggestion existed for this
  street.
- The Chrome profile at `~/.harvest-chrome` is the operator's real, pre-existing
  profile, reused read-only by this session, not created or newly warmed up here.
- `scripts/harvest.ts` itself was never executed in any mode during this wave —
  only read for Phase 1, and its logic duplicated (not imported) into the new
  diagnostic script.
