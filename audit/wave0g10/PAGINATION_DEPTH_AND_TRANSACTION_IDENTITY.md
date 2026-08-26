# WAVE 0G-10 — PAGINATION DEPTH + TRANSACTION IDENTITY PROOF

Evidence-only micro-wave. No canonical rebuild, no Supabase writes, no
deployment, no valuation changes, no schema migration.

## Phase 1 — Baseline

```
BASELINE_HEAD=6ca787ae96a0cf506fe36486168df87a42ddcd76
CANONICAL_ROWS=12642
CANONICAL_SHA256=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
```

Confirmed byte-identical before and after all work in this wave (see Phase 17).

## Phase 2 — TOTAL_ROWS / TOTAL_FETCH contract (רסקו, sourceId=65210248)

From the live, official `/deal-data` response (`fetch_number=1`):

```
TOTAL_ROWS=2012
TOTAL_FETCH=5
TOTAL_PAGE=202
FIRST_FETCH_NUMBER=1
TOTAL_FETCH_SOURCE=RESPONSE_FIELD
  exact field: data.total_fetch (sibling of data.total_rows, data.total_page, data.items)
```

`total_fetch` is an explicit response field, not an arithmetic derivation —
confirmed by direct inspection of the decoded response body (see
`audit/wave0g9/continuation_exchanges_rasko.json`, both captured exchanges
report identical `total_rows=2012, total_fetch=5, total_page=202`, i.e. the
value is stable across fetches for the same entity, not recomputed per-page).

## Phase 3 — Legitimate fetch_number 3 proof

Using ONLY the same proven direct-URL navigation
(`https://www.nadlan.gov.il/?view=neighborhood&id=65210248&page=deals`) and
the same visible "הבא" (Next) button already proven in Wave 0G-9, the probe
(`scripts/audit-wave0g10-fetch3-probe.ts`) clicked forward from the
already-observed fetch_number=1→2 transition, continuing well past the
previous wave's stopping point (up to a data-derived budget of 160 clicks).

```
FETCH_1_ROWS=500
FETCH_2_ROWS=500
FETCH_3_ROWS=NOT_REACHED

FETCH_1_RANGE=2022-03-27 .. 2026-06-15
FETCH_2_RANGE=2016-09-07 .. 2022-03-26
FETCH_3_RANGE=N/A

OVERLAP_1_2=0 (of 500/500 content-keys)
OVERLAP_2_3=N/A
OVERLAP_1_3=N/A

UNIQUE_AFTER_2_FETCHES=1000
UNIQUE_AFTER_3_FETCHES=N/A (fetch 3 not reached)

ENTITY_ID_ALL_ROWS_MATCH=YES (both fetches: distinctNeighborhoodIds=["65210248"], 500/500 and 500/500)
```

**Critical finding — why fetch_number=3 was not reached:** around click ~101
(local page depth ≈ page 101 of 202, i.e. roughly half the site's own
pagination), the SAME live browsing session (using the operator's real,
already reCAPTCHA-warmed profile) triggered a **genuine, reproducible,
site-native modal**, not a network error and not a technical rate limit:

```html
<div role="dialog" aria-modal="true" class="fade contanctModal centerModal smModal titleContainer modal show">
  ...
  <h3 class="title">לצפייה בנתונים נוספים</h3>   <!-- "To view additional data" -->
  ...
  <button class="btn blue">... התחברות</button>  <!-- "Login" -->
</div>
```

This modal:
- overlays the page and **intercepts pointer events**, making the real
  "הבא" button unclickable while it is showing;
- was dismissed via its own real close button (`.closeModalBtnContainer`)
  three separate times, and **reappeared immediately** on every subsequent
  click attempt on "הבא" — confirmed reproducible, not a one-off UI glitch;
- explicitly asks the anonymous user to log in ("התחברות") to view
  additional data.

Per this wave's own safety rules ("no forged session tokens", "no
reCAPTCHA bypass", and implicitly: no authentication), the probe **did not
click the login button and did not attempt to authenticate**. It stopped
cleanly after confirming the wall was reproducible (3 consecutive
detections), per the wave's own escape hatch: *"If no legitimate way to
derive the next request exists: return NO_SUPPORTED_CONTINUATION_FOUND."*

This is scoped as: **fetch_number 3 was NOT reached for רסקו in this
investigation**, not because of any technical limit on `fetch_number` itself
(the field mechanically supports incrementing — proven 1→2 in Wave 0G-9 and
re-confirmed here), but because the site's own UI interposes an
authentication gate at this depth for an anonymous session. This is an
honest, evidence-based PARTIAL result for Phase 3, not a proof of either
"fetch_number caps at 2" or "fetch_number can reach N" — it is a proof that
**anonymous continuation is blocked at this specific depth**, and that this
project does not attempt to bypass it.

**Precise depth (ECC planner correction):** `total_page=202` for
`total_rows=2012` ⇒ ≈10 rows/page; click ~101 corresponds to page 101, i.e.
**row ~1001 — exactly the boundary immediately after the 2nd 500-row fetch
completes.** This is a sharper, more useful observation than "roughly
halfway": the wall appears to coincide precisely with having already loaded
2 fetches' worth (1000 rows), not with elapsed time or click count in
general.

**Caveats on "reproducible" (ECC planner + silent-failure-hunter
corrections):**
1. The 3 repeated detections were all within **one browser session, one
   entity, one day** — this does not by itself separate a genuine
   depth/fetch-count gate from a session-quota or time-based gate.
2. The dialog-dismissal code only records `dismissed=true` when a close
   click or Escape key press did not *throw* — it never re-checks whether
   the modal actually disappeared from the DOM afterward. So "closed 3
   separate times, reappeared each time" is not independently verified by
   the script; it is equally consistent with one persistent, never-actually-
   dismissed modal being detected 3 times.
3. A first supplementary attempt to test the row-1000 hypothesis on a
   SECOND, independent entity (נוף הטיילת, sourceId=65210195, total_rows=1276)
   hit a *different* modal on the very first click — "Token verification
   failed" / "רענן דף" ("refresh page") — most likely anti-bot session/token
   strain from having already run 5 live automated browser sessions against
   the same profile in quick succession that day. That attempt was
   inconclusive and is preserved as `fetch_depth_exchanges_nof_hatayelet.json`
   (empty array).
4. **UPDATE — clean confirmation obtained.** A second, separately-timed
   retest on the same entity (`fetch_depth_exchanges_nof_hatayelet_retest.json`)
   loaded normally: baseline fetch_number=1 (500 rows, 2014-09-23..2026-05-16)
   and the proven fetch_number=1→2 transition (500 rows,
   2006-12-26..2014-09-18) both completed cleanly, exactly as in Wave 0G-9.
   Continuing the SAME real "הבא" clicks past that point hit the identical
   login-wall modal (`לצפייה בנתונים נוספים` / `התחברות`) at click ~101 —
   the same click depth, same modal text, same 3-consecutive-detection
   pattern as רסקו.

**Net conclusion (upgraded from the prior draft's "UNKNOWN"):** the
row-1000 / 2-fetch-boundary login wall is now confirmed on **two
independent entities** with different `total_rows` (1276 and 2012) at the
**same click depth** (~101, i.e. ~1000 rows / 2 fetches loaded) — evidence
this is a request-count- or rows-loaded-based anonymous-session gate, not
an artifact of one entity or one degraded session. It remains unproven
whether the gate is a hard, permanent 2-fetch cap for every anonymous
session, or something that varies by account/IP/time — no third entity or
extended-wait retest was performed, per the "no endpoint hammering" rule.

## Phase 4 — Optional final fetch boundary

Not attempted — Phase 3's login wall makes any further fetch (3, 4, 5, or
the final one) unreachable without authentication, which is explicitly out
of scope. `REPORTED_TOTAL_FETCH=5` remains unverified beyond fetch 2.

```
OBSERVED_FETCH_NUMBERS=[1, 2]
REPORTED_TOTAL_FETCH=5
FINAL_FETCH_ROWS=UNKNOWN
FINAL_FETCH_TRIGGERED=NO
REQUEST_AFTER_FINAL_FETCH=N/A
```

## Phase 5 — Pagination contract verdict

```
FETCH_NUMBER_DEPTH=A — 1→2 ONLY PROVEN
TOTAL_FETCH_MATCHES_OBSERVED_WINDOWS=PARTIAL
  (total_fetch=5 is consistently reported by the server across both observed
   fetches, which is itself evidence it reflects a real server-side count —
   but only 2 of the 5 windows were actually exercised, so full agreement
   between total_fetch and observed windows is UNKNOWN beyond fetch 2)
```

Note: this downgrades Wave 0G-9's implicit optimism (which inferred
fetch_number depth was "probably fine to iterate" based on the clean 1→2
transition) — this wave found a real, reproducible obstacle to depth beyond
2 for at least one entity, discovered honestly rather than assumed away.

## Phase 6 — Inventory of transaction-identity-related fields

Captured via a live raw-item sample (500 top-level rows each, נוף הטיילת and
רסקו — `audit/wave0g10/raw_items_sample_*.json`). No field literally named
`dealId`, `transactionId`, `dealNumber`, or `objectId` exists anywhere in the
response schema.

| FIELD | EXAMPLE | NULL_RATE (nof_hatayelet, n=500) | STABLE_LOOKING | SEMANTIC_MEANING_IF_PROVEN |
|---|---|---|---|---|
| `assetId` | `4250272` | 0/500 | Looks unique but ISN'T (470/500 distinct on nof_hatayelet, 408/500 on רסקו) | Building/complex-level id, shared by multiple units in the same building — NOT a transaction or even a per-unit id |
| `addressId` | `72721807` | 53/500 zero/absent | Repeats heavily (67 distinct/500) | Street-address-level id, many-to-one with parcelNum |
| `parcelNum` | `"8252-113-4"` | 0/500 | 500/500 distinct in every top-level sample; property/unit id for subparceled rows (see Phase 7 and its `-0`-row caveat) | Cadastral gush-helka-subparcel — property/unit identity, except `-0` rows which may be parcel/share-level |
| `polygonId` | `"8252-113"` (row 1) or `"52132568"` (row 2) | 0/500 | Repeats (88 distinct/500) — sometimes matches the parcelNum's gush-helka prefix, sometimes an unrelated opaque numeric id (ECC planner correction: not consistently a parcelNum prefix) | Building/parcel-level identifier, inconsistent format — not reliable for identity purposes |
| `dealDate` | `"2026-05-16"` | 0/500 | 449/500 distinct — expected, many transactions share a day | Transaction attribute, not an identity field |
| `dealAmount` | `7250000` | 0/500 | 303/500 distinct | Transaction attribute |
| `row_id` | `1` | 0/500 | Sequential 1..500 within THIS response only | Confirmed NOT stable — batch-local ordinal only, resets/reassigns per fetch |
| `prevDeals` | `[]` or `[{dealDate,dealAmount}, ...]` | 0/500 present as a field, but 370/500 are empty arrays | N/A (structural field) | **Nested prior-sale history for the SAME property** — see Phase 7, the central finding of this wave |
| `dealNature`, `roomNum`, `floor`, `assetArea`, `yearBuilt`, `streetCode`, `buildingFloors`, `hokHamecher`, `trend`, `ownership`, `priceSM` | various | 7–482/500 null depending on field | N/A | Descriptive attributes only, not identity |

No field is labeled a "transaction ID" merely for being unique in one
sample — `parcelNum`'s uniqueness is explained structurally in Phase 7, not
assumed.

## Phase 7 — What parcelNum actually represents

**Central finding of this wave.** Every top-level row's `prevDeals` array
(when non-empty) contains the SAME property's PRIOR sale(s) — same implicit
`parcelNum`, different `dealDate`/`dealAmount`, no other fields — nested
inside the CURRENT (most recent) transaction's row. Example
(`audit/wave0g10/raw_items_sample_nof_hatayelet.json`, row 6):

```json
{
  "parcelNum": "8247-229-80",
  "dealDate": "2026-01-29", "dealAmount": 2650000,
  "prevDeals": [ { "dealDate": "2013-07-08", "dealAmount": 1550000 } ],
  "trend": { "rate": 71, "years": 12.6 }
}
```

`trend.years` (12.6) is exactly the gap between 2013-07-08 and 2026-01-29 —
independent confirmation that `prevDeals` is a genuine, derived sale-history
field, not incidental data.

```
DISTINCT_ROWS (top-level, nof_hatayelet 500-sample)=500
DISTINCT_PARCELNUM (top-level)=500
PARCELNUM_WITH_MULTIPLE_TOP-LEVEL_ROWS=0

rows_with_nonempty_prevDeals=130/500 (26.0%)
prevDeals length distribution: {1: 88, 2: 36, 3: 2, 4: 3, 5: 1}
total_embedded_prior_transactions=183
total_real_transactions_if_flattened=500+183=683

(רסקו 500-sample, for generality:)
rows_with_nonempty_prevDeals=114/500 (22.8%)
total_embedded_prior_transactions=179
total_real_transactions_if_flattened=679
```

Concrete repeat-sale examples (parcelNum / date1 / price1 / date2 / price2),
full list in `audit/wave0g10/parcelnum_repeat_sales.csv`:

| PARCELNUM | DATE_1 (older) | PRICE_1 | DATE_2 (newer) | PRICE_2 |
|---|---|---|---|---|
| 8247-229-80 | 2013-07-08 | 1,550,000 | 2026-01-29 | 2,650,000 |
| 8253-225-44 | 2011-03-29 | 1,800,000 | 2021-05-27 → 2025-12-01 | 2,585,000 → 3,200,000 (3 sales total) |

```
PARCELNUM_SEMANTICS=PROPERTY_UNIT_ID
```

**Not inferred from the field name** — proven structurally: the API itself
treats `parcelNum` as the property's stable key, folding every OLDER sale of
the same property into the CURRENT row's `prevDeals`, and never emits more
than one top-level row per `parcelNum` within a given fetch window. This
also fully explains Wave 0G-9's "1276 unique parcelNum = 1276 total_rows,
zero collisions" finding — it was not a coincidence or a property of a
young/first-sale-heavy neighborhood; it is the API's own de-duplication
behavior, one top-level row per property, guaranteed by construction.

**Caveat (ECC planner correction):** the "unit-level" reading holds cleanly
for rows with a real subparcel number (e.g. `8252-113-4`). A distinct class
of rows has subparcel `-0` (e.g. `8253-228-0`, `8252-109-0`,
`8247-181-0`, `8253-229-0` — visible in
`audit/wave0g10/parcelnum_repeat_sales.csv`), and at least one such row
(`8253-228-0`) carries `prevDeals` spanning wildly different amounts
(125,000 / 86,000 / 117,000 / 6,176,000 / 4,815,000) — consistent with a
parcel-level or fractional-share (חלקי זכויות) record aggregating deals on
different physical assets or ownership shares of one cadastral parcel,
rather than one consistent physical unit. For these `-0` rows,
`PARCELNUM_SEMANTICS` is better stated as **PARCEL_ID or
COMPOSITE_CADASTRAL_ID, not confidently PROPERTY_UNIT_ID** — the clean
property-unit reading is proven for subparceled rows, not for `-0` rows.

## Phase 8 — Repeat-sale loss test

```
ROWS_BEFORE (top-level nof_hatayelet 500-sample)=500
ROWS_AFTER_PARCELNUM_DEDUP (top-level only)=500
ROWS_LOST (top-level only)=0
```

Contrary to the wave's initial hypothesis, deduping the TOP-LEVEL rows by
`parcelNum` alone loses nothing — because the API never emits duplicate
top-level `parcelNum` values in the first place (Phase 7).

**The real, more serious risk is different and was not anticipated by the
wave's framing:** a harvester that reads ONLY the top-level `items[]` array
(which is what every prior wave's shadow/audit script has done, since none
of them parsed `prevDeals`) silently drops every nested prior-sale
transaction — 26.0% of rows (nof_hatayelet) / 22.8% of rows (רסקו) carry at
least one hidden historical transaction, worth 183 and 179 additional real
transactions respectively across the two 500-row samples alone.

```
TRUE_DUPLICATE_FETCH_OVERLAP=0 (not observed as a risk — see Phase 10)
REPEAT_SALE_SAME_PROPERTY=183 (nof_hatayelet sample) + 179 (Rasko sample), all currently INVISIBLE to any top-level-only reader
UNKNOWN=0

PARCELNUM_ONLY_DEDUP_UNSAFE=YES
  — but the mechanism is NOT "duplicate top-level rows getting collapsed and
  losing one of two legitimate sales" (that scenario does not occur at the
  top level). It is "parcelNum-only dedup applied AFTER flattening
  prevDeals into separate rows would collapse a property's real, distinct
  historical sales into one" (183/679 and 179/679 collision counts under
  flattening — see Phase 9/10 candidate A).
```

No source data was modified — this is a read-only in-memory simulation over
the captured JSON samples.

## Phase 9 — Best transaction key

Evaluated on the FLATTENED set (top-level rows + each nested `prevDeals`
entry treated as its own transaction row, inheriting the parent's
`parcelNum`) — this is the set that actually needs a transaction-safe key,
since flattening is required to recover the ~25% of transactions currently
invisible at the top level.

| KEY | UNIQUE_ROWS (nof_hatayelet, 683 total) | COLLISIONS | FALSE_MERGE_RISK | FETCH_OVERLAP_DEDUP_ABILITY |
|---|---|---|---|---|
| A: `parcelNum` only | 500 | 183 | **HIGH** — collapses every property's full sale history into a single row | Works for fetch-overlap dedup at the top level only; unsafe once flattened |
| B: `parcelNum + dealDate` | 680 | 3 | LOW but nonzero — 3 confirmed same-property-same-day-different-price cases | Good, not perfect |
| C: `parcelNum + dealDate + dealAmount` | 683 | 0 | None observed in ~1,360 combined transactions across 2 entities (not citywide-tested) | Demonstrated on tested data — collapses exact duplicates from overlapping fetch/sort windows (Phase 10) while preserving every distinct sale |
| D: `dealDate + price + area + address` (wave's own suggestion) | not directly tested this way | — | `assetArea` is `null` on every `prevDeals`-derived row (only `dealDate`/`dealAmount` are nested), so this key cannot even be constructed for historical rows | Not usable for the flattened set |
| E: official transaction id field | N/A | — | — | **Does not exist** (Phase 6) |

No official transaction-id field exists (Candidate A/E as originally
envisioned). The best-evidenced key, with zero collisions OBSERVED on the
tested data (not proven citywide — see caveat below), is:

```
BEST_OBSERVED_KEY = parcelNum + dealDate + dealAmount
```

It satisfies both required properties on the tested data:
1. Collapses the SAME transaction seen through overlapping fetch/sort
   surfaces (Phase 10, against the real 1276-row union).
2. Preserves DIFFERENT sales of the same property (Phase 7/8/9 — zero
   collisions observed across 1,362 real transactions spanning up to 12
   years of resale history for the same units).

**Scope caveat (ECC planner + silent-failure-hunter + database-reviewer,
independently raised):** "zero collisions" is an observation over ~1,362
transactions across 2 adjacent-profile Netanya neighborhoods, not a
citywide proof. Phase 11's same-day cases (16/679 ≈ 2.4% of Rasko's
flattened transactions) show `parcelNum+dealDate` alone already collides at
a non-trivial rate — meaning the collision *mechanism* (same property,
same-day, different amount) is real and not rare. A larger, still-untested
population (or a `-0` parcel with two same-day, same-amount share sales —
Phase 7's caveat) could plausibly produce a `parcelNum+dealDate+dealAmount`
collision that has simply not been observed yet. This key should be read as
**"best-evidenced candidate, not yet falsified"**, not as a citywide
guarantee.

Full breakdown: `audit/wave0g10/dedup_key_comparison.csv`.

## Phase 10 — Asc/desc overlap as dedup test bed

Reused Wave 0G-9's already-captured independent query surfaces for נוף
הטיילת (2 descending fetches + 1 duplicate baseline descending fetch from
the sort probe + 1 ascending fetch = 2,000 raw top-level rows fetched,
proven `total_rows=1276`):

| KEY | DEDUP_RESULT | EXPECTED | DELTA |
|---|---|---|---|
| A: `parcelNum` only | 1276 | 1276 | 0 |
| C: `parcelNum + dealDate + dealAmount` | 1276 | 1276 | 0 |
| D: full content key (`dealDate+dealAmount+assetArea+parcelNum`, Wave 0G-9's original key) | 1276 | 1276 | 0 |

At the TOP LEVEL, all three candidates agree exactly with the proven total —
because, per Phase 7, top-level `parcelNum` never repeats within an entity.
**This does not validate candidate A (`parcelNum` only) as a safe general
transaction key** — it only shows that top-level rows contain no
same-property duplicates to begin with. The meaningful test is Phase 9's
flattened comparison, where candidate A fails (183/679 collisions) and only
candidate C survives with zero collisions. This distinction — a key that
passes on top-level-only data but fails once historical transactions are
included — is exactly the kind of thing a naive validation could miss.

## Phase 11 — Same-day edge cases

Searched the flattened (top-level + nested) transaction sets for same
property, same date:

```
same_day_prevDeal_vs_current_date_match (Rasko sample)=16
  (16 cases where a nested prevDeal's date equals its own parent row's
   current dealDate — an apparent data-entry/registration artifact in the
   source, not fabricated or filtered out)

candidate-B (parcelNum+dealDate) collision groups=3 (nof_hatayelet) / 8 (Rasko, 16 individual collisions across 8 groups)
  concrete example: parcelNum 8274-516-207, 2024-10-20, two different
  amounts (2,766,000 top-level vs 2,566,000 nested) — same property, same
  reported date, genuinely different price
```

**`parcelNum + dealDate` alone is NOT sufficient** — confirmed with real
collision examples, not assumed. `dealAmount` must be included (Candidate C)
to resolve these same-day cases.

## Phase 12 — Citywide collision check using canonical data

```
CANDIDATE_KEY=parcelNum + dealDate + dealAmount
CANONICAL_ROWS=12642
UNIQUE_KEYS=NOT CONSTRUCTIBLE
COLLISIONS=NOT CONSTRUCTIBLE
COLLISION_RATE=N/A
```

**Important gap found, read-only, no data modified:** `data/deals.json` has
**no `parcelNum` field at all** — its own synthetic `id` is
`{neighborhoodId}-{dealDate}-{price}-{areaSqm}`, built from fields the
importer already had. The best-evidenced candidate key from Phases 9/10 cannot
even be constructed from the current canonical schema, because the
canonical importer never captured `parcelNum` in the first place. As a
substitute sanity check, the canonical data's own existing synthetic `id`
was checked for internal collisions:

```
canonical own id scheme: 12642 rows, 12642 unique ids, 0 collisions
canonical schema includes parcelNum: NO
```

This does not prove or disprove future citywide uniqueness of the
best-evidenced key — it only confirms the canonical data's OWN current id
scheme has no obvious collision problem, and flags (without acting on it)
that adopting the proven key would require capturing a currently-absent
field.

## Phase 13 — Property ID vs transaction ID model (conceptual, no implementation)

```
PROPERTY_IDENTITY = parcelNum (gush-helka-subparcel) — identifies a
  specific cadastral unit/apartment. Stable across all of that property's
  sales. Proven via Phase 7's prevDeals nesting, not the field name.

TRANSACTION_IDENTITY = parcelNum + dealDate + dealAmount — identifies one
  specific sale of one specific property. No official atomic transaction-id
  field exists anywhere in the observed schema (Phase 6), so this composite
  is the best available proxy, not a discovered official id.
```

A future data model would need BOTH concepts represented explicitly:
today's canonical schema conflates them (each canonical row is implicitly
"one property's one known sale," with no way to represent — or even detect
the existence of — that same property's other sales, since `parcelNum`
itself is absent). No schema change is made in this wave.

## Phase 14 — Acquisition stop condition

```
STOP_SIGNAL = runtime data.total_rows / data.total_fetch, read from the
  FIRST response for the entity (both fields proven present and consistent
  across repeated fetches for the same entity in Phase 2)
PROVEN_SOURCE = RESPONSE_FIELD (not derived, not hardcoded)
FAIL_CLOSED_BEHAVIOR = a future harvester should stop and flag
  INCOMPLETE_LOGIN_WALL (or similar) rather than silently reporting success
  if it cannot reach fetch_number == total_fetch AND has not confirmed
  data.items.length < the per-fetch row cap on the final fetch. Phase 3
  proved this exact failure mode is real and must be handled, not assumed
  away.
```

`total_fetch` was observed to report identically (5) across both fetch 1
and fetch 2 for the same entity in this wave — no evidence of it changing
dynamically was found, but only 2 of 5 windows were exercised, so this is
not proven exhaustively.

## Phase 15 — Future harvest algorithm (design only, NOT implemented)

```
official catalog entity (lib/nadlanCatalog.ts, proven Wave 0G-7)
  → direct sourceId query (lib/nadlanAcquisition.ts, proven Wave 0G-8)
  → read total_rows / total_fetch from the FIRST response (proven Phase 2)
  → legitimately fetch required windows via UI-driven fetch_number
    continuation AND ascending sort (proven Wave 0G-9 + this wave, capped by
    the entity's own total_fetch — never a hardcoded count)
  → verify every row's entity id (neighborhoodId) matches the requested
    sourceId (proven pattern, lib/nadlanAcquisition.ts::assertDirectIdAcquisitionIdentity)
  → FLATTEN each row's nested prevDeals into independent transaction
    candidates, inheriting the parent's parcelNum (Phase 7 — NEW requirement
    this wave surfaced; no prior wave's harvest design accounted for this).
    UNTESTED ASSUMPTION (ECC silent-failure-hunter): this inheritance
    presumes the property's parcelNum was the same at the time of the OLDER
    sale as it is today. If a parcel was ever subdivided or renumbered
    between an old sale and the current one, a flattened historical row
    would be mislabeled with a parcelNum it never actually held — a design
    risk to test before implementation, not something this wave's evidence
    rules out.
  → merge overlapping surfaces (descending + ascending + duplicate fetches)
    using parcelNum + dealDate + dealAmount (proven Phase 9/10)
  → completeness reconciliation: compare merged unique count against
    total_rows; if a login wall or other obstacle prevents reaching
    total_fetch windows, report PARTIAL rather than claiming completeness
    (Phase 3/14)
```

No code implementing this loop was written this wave.

## Phase 16 — ECC review

| ECC_REVIEWER | VERDICT | KEY_FINDING |
|---|---|---|
| planner | CONCERNS (addressed) | Phase 7 parcelNum semantics over-generalized for `-0` subparcel rows; Phase 3's "roughly half" imprecise (actual: row ~1001, exactly the 2-fetch boundary) and "reproducible" over-stated as single-session evidence; Phase 9 "PROVEN" language too strong for a 2-neighborhood sample. All three corrected in this report. Phase 12 confirmed honest as originally written. |
| specialist (code-explorer) | CONFIRMED | Independently re-derived all load-bearing arithmetic (683/679 flattened totals, 183/179 collisions, 1276-row union) with matching results; confirmed correct request/response correlation pattern and no fabricated fetch_number. Two claims (parcelNum pairwise-uniqueness, candidate-C zero-collision) noted as arithmetic-consistency-checked rather than independently re-derived from scratch, due to this reviewer's read-only toolset — not a finding of error. |
| database-reviewer (lead) | CONFIRMED | Independently reproduced every load-bearing number bit-for-bit from raw evidence (Phase 7/9/11/12). Confirmed the Phase 8 reframing (real risk = prevDeals silently dropped by top-level-only readers, not top-level parcelNum collisions) is well-supported and appropriately scoped, not overstated. |
| silent-failure-hunter | CONCERNS (addressed) | Flagged: (1) untested parcelNum-inheritance-across-renumbering assumption in the Phase 15 design — now explicitly caveated; (2) "PROVEN" language risk of being copied without caveats by a future implementer — softened; (3) the dialog-dismissal loop's `dismissed` flag doesn't re-verify the modal actually closed — now disclosed in Phase 3; (4) raw-sample script captures the first non-empty response without asserting a full 500-row page — script limitation noted below (both actual captures were independently verified at exactly 500 rows each, so no incomplete-sample effect occurred in practice, but the script itself has no built-in check). Phase 3's fail-closed honesty (FETCH_3_ROWS=NOT_REACHED, no silent completeness claim) confirmed sound. |
| security-reviewer | PASS (5/5) | No credential values (only field names) in any script or output file; login button never targeted by the dismissal logic; no fabricated/guessed request parameters; no canonical/Supabase writes; spot-checked output file clean. |
| code-reviewer | APPROVE | Correct resp.request()-based correlation and try/catch-wrapped context setup in both new scripts, matching the Wave 0G-9 fix pattern. Dialog-dismissal retry loop's `i--`/`continue` interaction confirmed correct (cancels via the for-loop's own `i++`), bounded by 3 independent hard exits — no infinite-loop risk. One LOW-severity cosmetic note (redundant metadata re-read, `audit-wave0g10-fetch3-probe.ts:172-178`) — harmless, not fixed, no functional impact. |

Critical reviewer questions (per wave instructions):
1. **Is parcelNum actually proven to be transaction identity?** NO — proven
   to be PROPERTY/UNIT identity instead (for subparceled rows; ambiguous for
   `-0` parcel-level rows). This corrects the wave's own initial framing.
2. **Could repeat sales be lost?** YES, if a future harvester reads only
   `items[]` and never flattens `prevDeals` — this is the central risk this
   wave surfaced, not the wave's originally-hypothesized top-level-dedup
   risk (which does not occur in practice).
3. **Is fetch_number 3 legitimately observed?** NO — blocked by a
   reproducible-within-one-session login-wall modal; not bypassed, not
   faked, honestly reported as NOT_REACHED.
4. **Is total_fetch interpretation evidence-based?** YES for the field's
   existence and stability across 2 fetches (`data.total_fetch`, a real
   response field, unchanged 5→5 across fetch 1 and fetch 2) — NOT
   exhaustively verified beyond fetch 2 (Phase 4/14).
5. **Is proposed future dedup safe against overlapping asc/desc windows?**
   YES on tested data (Phase 10, exact match to the proven 1276-row total)
   — with the citywide-scale and parcelNum-renumbering caveats above.

## Phase 17 — Quality / safety

```
Tests: 233/233 PASS (21 files) — unchanged from Wave 0G-9 baseline, no lib/
  production code was modified this wave (only new scripts under scripts/,
  reusing the existing buildDirectNeighborhoodUrl export)
Typecheck: clean (npx tsc --noEmit, zero output)
Build: SUCCESS (npm run build, Next.js 16.2.6 Turbopack, all 25 routes)

CANONICAL_SHA_BEFORE=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
CANONICAL_SHA_AFTER=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
CANONICAL_WRITES=0
SUPABASE_WRITES=0
CHECKPOINT_WRITES=0
```

## Constraints / honesty notes

- The wave's own hypothesis — "parcelNum-only dedup could destroy legitimate
  historical deals by collapsing separate top-level rows" — does not occur
  in practice, because the official API never emits more than one top-level
  row per property to begin with (Phase 7). The actual, more serious risk is
  a different one this wave surfaced: **every prior harvest/audit script in
  this engagement (0G-7 through 0G-9) read only top-level `items[]` and
  never parsed `prevDeals`**, meaning roughly a quarter of real historical
  transactions per neighborhood have been silently invisible to every
  measurement taken so far, including this wave's own Phase 2/3 row counts
  (which, like all prior waves, count top-level rows only).
- Fetch_number depth beyond 2 was not proven for either tested entity — a
  genuine, reproducible, site-native login wall blocked further anonymous
  UI-driven continuation at click ~101 (≈row 1000, exactly the 2-fetch
  boundary) for both רסקו and, on a clean retest, נוף הטיילת too. This was
  discovered and reported honestly rather than bypassed; no authentication
  was attempted.
- Phase 9-11's zero-collision result for `parcelNum + dealDate + dealAmount`
  is proven only across ~1,362 real transactions spanning two neighborhoods
  (נוף הטיילת and רסקו) — not proven citywide, and Phase 12 shows the
  canonical schema cannot even currently test this at citywide scale because
  it lacks a `parcelNum` field.
- The `same_day_prevDeal_vs_current_date_match=16` finding (Rasko) was
  reported as an observed data artifact, not explained or resolved — its
  cause (registration correction? genuine same-day resale? data entry error
  in the source?) is unknown and out of scope for this wave.
- `scripts/audit-wave0g10-raw-sample.ts` captures the first non-empty
  `/deal-data` response and stops, without asserting the item count equals
  the site's per-page cap (500). This wave's actual two captures were
  independently verified afterward at exactly 500 rows each (Phase 6's
  null-rate table is not built on a truncated sample), but the script has no
  built-in guard against a future run silently capturing a partial page.
- A first supplementary live attempt to test whether the Phase 3 login wall
  triggers at the same row-1000 depth for a second, independent entity was
  inconclusive (session/token-shaped modal, likely from running 5 live
  automated browser sessions against the same profile in quick succession).
  A second, separately-timed retest cleanly confirmed the same wall on that
  second entity at the same click depth — see the Addendum below.

## Addendum — post-wave follow-up (informal, per user direction to continue
without the full phase/ECC template)

**1. Login-wall universality — now confirmed on two independent entities.**
The clean retest (`audit/wave0g10/fetch_depth_exchanges_nof_hatayelet_retest.json`)
loaded fetch_number 1 and 2 normally for נוף הטיילת (matching Wave 0G-9's
figures exactly), then hit the identical `לצפייה בנתונים נוספים` /
`התחברות` modal at click ~101 — same depth, same text, same 3-detection
pattern as רסקו. This is now evidence of a request-count- or rows-loaded-
based anonymous-session gate (not a one-entity or one-degraded-session
artifact), though still not proven as a universal, permanent 2-fetch cap
for every anonymous session (no third entity, no extended-wait retest, no
different IP/account tested).

**2. Ben Ami 41 — checked whether Phase 7's `prevDeals` discovery explains
the missing transactions. It does NOT.** Using the concrete facts from
Wave 0G-4 (`audit/wave0g4/CADASTRAL_ENTITY_RECONCILIATION.md`): the 7 known
Ben Ami 41 transactions belong to `neighborhoodId=65210195` (`נוף הטיילת`)
— the exact entity already captured in this wave's own raw sample — with
`parcelNum` values `8252-156-54` through `8252-156-60`. All 7 were found
as **plain top-level rows** in `audit/wave0g10/raw_items_sample_nof_hatayelet.json`,
each with `prevDeals: []` (no nested history — first/only sale). All 7 were
re-confirmed **still absent** from `data/deals.json` today (spot-checked by
date+price against all 12,642 canonical rows). One data-drift note: parcelNum
`8252-156-54`'s `dealNature` now reads `ללא תיכנון` on the live site,
vs. `דירת נופש` when Wave 0G-4 first captured it.

**Conclusion:** the Ben Ami 41 gap is NOT an instance of this wave's
prevDeals-nesting risk. It remains exactly what Wave 0G-4 already diagnosed:
a pure **discovery-scope gap** — `discoverNeighborhoods()` in
`scripts/harvest.ts` never enumerated `neighborhoodId=65210195` in the first
place (it keeps only the first geocoding hit per seed name, which resolved
to a different stored id, `66239231`, for the same neighborhood name). The
proven fix (`lib/nadlanCatalog.ts` + `lib/nadlanAcquisition.ts`, from Waves
0G-7/0G-8) is available but unapplied — applying it means a canonical
rebuild, which remains out of scope without explicit authorization.

No canonical writes, no Supabase writes, no deployment, no schema changes
were made in this addendum. `data/deals.json` SHA-256 reconfirmed unchanged:
`18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f`.
