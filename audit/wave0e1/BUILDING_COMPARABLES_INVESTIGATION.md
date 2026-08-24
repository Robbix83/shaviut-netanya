# Wave 0E-1 — Building Comparables Investigation

**Investigation-only wave. No application source was changed. No deployment. No Supabase mutation. No importer rerun.**

## Executive Finding

The comparable-selection engine (`lib/valuation.ts`) **already has a fully-implemented same-building priority mechanism** — an exact house-number match gets `tier=0` ("building"), which unconditionally sorts before same-street (`tier=1`), radius (`tier=2`), and neighborhood (`tier=3`) matches, with two redundant safety nets (a city-wide exact-building search that ignores the resolved neighborhood, and an explicit re-injection step that survives area/room filtering). Traced from source, **if a house number reaches this function, the code correctly prioritizes the exact building.**

The real, most likely trigger for both observed cases is upstream of this engine: **house number is entered in a separate, clearly-optional UI field** (`components/AddressSearch.tsx`, labeled "לא חובה — ישפר דיוק" — "not required — improves accuracy") that is easy to skip, and **nothing in the flow requires it before calculating a valuation** (`canCalc` in `components/ValuationWizard.tsx` never checks it). When house number is empty, the same-building tier is structurally unreachable (the tier function's building branch is gated entirely on `input.houseNumber` being truthy) — every deal on the target street falls to `tier=1`, and the visible ranking becomes pure recency/room/size relevance across the *entire* street.

Real local data (proven byte-identical to Supabase in prior waves — see Evidence Note below) confirms this mechanism would produce **exactly** the observed results in both cases:
- **Hartom 29** has 95 total transactions with very recent activity (freshest: 2026-03-25); **Hartom 30** has 6, freshest 2025-07-10. Without a building filter, 29's more numerous, more recent, similarly-sized listings naturally outrank 30's older ones under the existing relevance/recency sort.
- **Weizmann 93/97/99** show recent 2025–2026 activity; **Weizmann 92** has only 3 exact-building rows, freshest 2023-11-21. Same mechanism, same outcome.

This is presented as the strongest, most evidence-consistent explanation, not a certainty — see **Root Cause Classification** for exactly what would confirm it with zero remaining doubt (one operator question).

---

## Evidence Note — data source used for Phases 6–9

Real-time Supabase credentials were not available in this environment. Rather than guessing, this investigation used `data/deals.json` — the same file `LocalStore` serves — which was **proven byte-identical to the Supabase `deals` table** via SHA-256 digest parity checks in Wave 0B-2's authenticated import run, and has not been altered since (no importer rerun in any wave since). This is real data, not a simulation, but it is not a *fresh* read of the live table at this exact moment. If the operator wants a live-table double-check, the safe read-only command is:

```powershell
$env:DATA_SOURCE = "supabase"
npx tsx -e "
import('./lib/store').then(async ({getStore}) => {
  const s = getStore();
  const all = await s.getAllDeals();
  console.log('total deals (id/neighborhoodId/x/y only, per getAllDeals contract):', all.length);
});
"
```
(`getAllDeals()` only returns `id, neighborhoodId, x, y` by contract — for the specific street/house-number rows shown below, a fuller read-only query would be needed; not run this wave since local parity evidence was sufficient and no operator credentials were requested.)

---

## Current Address Contract

Traced `user input → React state → payload → valuation input → comparable engine`:

1. **Does the UI require a house number?** **NO.** `canCalc` (`components/ValuationWizard.tsx:617-618`) is `(!needsArea || !!area) && (!needsPlot || !!plot) && (isLand || isHouse || !!rooms)` — house number and even street selection are absent from this check.
2. **Can the user proceed with only a street?** Yes, and technically even the "בחרו שכונה ידנית" (manual neighborhood) fallback lets them proceed with no street object at all.
3. **For `הרב שמואל הרטום 30`, what gets stored?**
   - `selectedStreet.street` = `"הרב שמואל הרטום"` (clean, from `data/street-index.json` via `/api/autocomplete`)
   - `selectedStreet.label` = same value — `AddressSearch.tsx:86-99`'s `pick()` explicitly sets `label: s.street`, **overwriting** whatever the API returned for `label` (which is `"{street}, {neighborhoodName}"` — `app/api/autocomplete/route.ts:87`). So `label` and `street` are identical in practice; the fact that `ValuationWizard.tsx` sends `streetName: selectedStreet?.label` instead of `.street` (lines 653, 766) is **not currently a bug**, just a redundant/confusing field choice worth cleaning up later.
   - `houseNumber` = whatever the user typed into the separate input (`AddressSearch.tsx:120-138`) — **empty string by default**, not pre-filled from the street selection.
   - City/settlement: implicit — always Netanya, not a distinct field.
   - Canonical street ID: **none exists** — matching is by normalized text only (see Normalization below).
4. Same for `ויצמן 92`: identical mechanics; `selectedStreet.street = "ויצמן"`.
5. **Is houseNumber preserved to the comparable engine?** Yes, structurally, end-to-end: `ValuationWizard.tsx` payload → `ValuationInput.houseNumber` (`lib/valuationService.ts:23`) → `PropertyInput.houseNumber` passed unchanged into `valuate()` (`lib/valuationService.ts:72`) → used directly in `lib/valuation.ts`'s `byExactBuilding`, `byBuildingNumber`, the city-wide augmentation, and `buildComparableDeals`'s `tier()`. **No code path silently drops it.**
6. **N/A** — house number is not lost in transit; see Root Cause Classification for why it may simply not have been entered.
7. **How the engine uses it, exactly** — see Current Comparable Pipeline below.

Graphify was not invoked for this trace — direct source reading was faster and more reliable for a targeted 6-file trace of this size, and every claim above is a direct source citation, not a graph inference.

---

## House Number Flow

- **Input component**: `components/AddressSearch.tsx` — a separate, standalone `<input id="addr-house-number">`, not part of the street autocomplete/suggestion object itself. Street and house number are two distinct concepts in the UI (confirmed).
- **Does autocomplete return house number?** No — `/api/autocomplete` (`app/api/autocomplete/route.ts`) indexes streets only (`data/street-index.json`), never individual addresses/house numbers. House number is always manually typed.
- **Do API types already include house number?** Yes — `ValuationInput.houseNumber`, `PropertyInput.houseNumber` (via `lib/types.ts`), `Lead.houseNumber` (`app/api/lead/route.ts:22`) all already exist.
- **Server-side validation?** None beyond `typeof === "string"` coercion (`app/api/lead/route.ts:64`) — no format check, no "required" enforcement anywhere server-side.
- **Impact on saved lead**: minimal to add a requirement — the column and type already exist in the Lead/Deal contract (confirmed via the existing `schema-contract` test suite from prior waves), so requiring it would be additive validation, not a schema change.

---

## Current Comparable Pipeline

Ordered decision path, from `lib/valuation.ts`'s `valuate()`:

1. **Candidate pool source**: `store.getDealsByNeighborhood(input.neighborhoodId, {monthsBack: GEO_MONTHS})` — scoped to the **resolved neighborhoodId**, not the whole city, as the starting point (`pool4yr`, despite its name, uses `GEO_MONTHS=60`, i.e. 5 years — see Five-Year Window below for the naming/comment mismatch).
2. **Property-type filter**: exact match on `propertyType` (apartment/house/land) — always applied first.
3. **Room-count handling**: `±1` room, applied only if it leaves ≥6 candidates (`MIN_DEALS_FOR_ROOM_FILTER`), else falls back to the unfiltered set (`geoPool`).
4. **Date window** (for the *valuation number*, separate from geography): a shrinking-window search `[6, 12, 24, 48]` months, picking the shortest window with ≥3 usable deals (`MIN_DEALS_FOR_ESTIMATE`) — **this is unrelated to which building/street is searched**; geography search below always uses the fixed 60-month window regardless of this loop.
5. **Location hierarchy** (the part this investigation is about), evaluated in this exact order:
   a. **Exact building** (`byExactBuilding`): same normalized street name **and** `parseInt(houseNumber)` equal — needs ≥3 matches.
   b. **Near-building / "street" via house-number proximity** (`byBuildingNumber`): same street, house number within ±12 — labelled `compSearchScope="street"`, not "building" (deliberately, per an explicit code comment guarding against mislabeling neighbors as the same building).
   c. **Whole street by name** (`byStreetName`).
   d. **City-wide textual fallback** (only if the neighborhood-scoped pool is thin): re-tries (a)/(c) against *all* city deals, ignoring `neighborhoodId` — exists specifically to handle streets whose deals were imported under a different neighborhood than expected.
   e. **Geographic radius tiers** (only if no coordinates-independent street text match won): building radius (60m) → street radius (350m) → wider radius (500m) → cross-neighborhood radius fallback (500/750/1000m).
   f. **Neighborhood** (implicit final fallback: whatever `deals` still holds).
6. **Floor filter**: `±2` floors, applied only for apartments with a stated floor, only if ≥5 candidates remain.
7. **Area filter**: `±50%` of stated area, applied only if it leaves ≥3 candidates.
8. **Outlier handling**: a hard `MIN_PPSQM` floor per property type (₪8,000/m² apartment, ₪12,000/m² house, ₪800/m² land) removes partial-rights/family-transfer transactions before they can enter the estimate or be shown as a comparable.
9. **Sorting/scoring for the *displayed* comparables** (`buildComparableDeals`): sort key is `(locationTier, houseNumberProximity, roomSizeRelevance, recency)` — tier is checked **first and absolutely** (any tier-0 beats any tier-1 regardless of how recent/relevant the tier-1 deal is).
10. **Final limit**: top 12 by that sort.
11. **Fallback behavior**: if the tight size/room filter yields fewer than 3 candidates, the code progressively widens (size tolerance, then room tolerance) before finally showing the whole geographic pool unfiltered.

**Does current code have a concept of:**
- **SAME BUILDING: YES.** Predicate: `normalizeStreet(d.street) === normalizeStreet(input.streetName) [or DB value is a text-prefix of the input] AND parseInt(d.houseNumber) === parseInt(input.houseNumber)`. Exactly `street === targetStreet AND houseNumber === targetHouseNumber`, as the investigation prompt hypothesized — confirmed, not something else.
- **NEARBY BUILDING: YES**, but as a *search-widening* concept (`byBuildingNumber`, ±12 house numbers), explicitly **not** labeled "building" in the UI — it's labeled "street" or, geographically, "radius". There is no separate "nearby building" *display* tier distinct from "street"/"radius".
- **SAME STREET: YES** — both a text-based (`byStreetName`) and geography-based (350m radius) form.
- **SAME NEIGHBORHOOD: YES** — the ultimate fallback.

---

## Address Normalization

`normalizeStreet()` (`lib/valuation.ts:178`) only strips known prefixes (`שד'`, `שדרות`, `רחוב`, `רח'`) via regex; it does **not** handle alternate/abbreviated street names. Matching after that is: exact equality, **or** the stored DB value being a literal text-prefix substring of the user's input (`inputStreetNorm.includes(ds)`) — deliberately one-directional to avoid false matches like "אבא הלל" incorrectly matching "אבא הלל סילבר" (per an explicit code comment).

Checked against real data for both test addresses:

| | Hartom | Weizmann |
|---|---|---|
| `TARGET_UI_STREET` | `הרב שמואל הרטום` (from `street-index.json`) | `ויצמן` |
| `TARGET_UI_HOUSE_NUMBER` | `30` (if entered) | `92` (if entered) |
| `TARGET_CANONICAL_STREET` | `הרב שמואל הרטום` | `ויצמן` |
| `TARGET_CANONICAL_HOUSE_NUMBER` | `30` | `92` |
| Stored `deals.street` value(s) for this street | **`הרב שמואל הרטום`** — one single spelling across all 280 rows on the street, exact match, no alias found | **`ויצמן`** — one single spelling across all 292 rows, exact match |
| Stored `houseNumber` format | Clean numeric strings (`"30"`, `"29"`, etc.), no suffix letters observed on this street | Clean numeric strings (`"92"`, `"93"`, etc.) |

**No street-name alias/mismatch was found for either address** — `הרטום` vs `הרב שמואל הרטום` is not actually an issue in the real data; the deals table consistently uses the full official name, identical to what `street-index.json`/autocomplete provides. This rules out classification D for both cases (see below). House-number strings are clean integers for both — this also rules out classification E for both cases, at least for these two specific streets.

---

## Five-Year Window

**Rolling 5 years from today**, confirmed from source: `cutoffDate(months)` computes `new Date()` (real wall-clock at request time) minus `months`, not a calendar-year boundary. The geography search (building/street/radius hierarchy) always uses `GEO_MONTHS = 60` (5 years) — **note**: the surrounding code comment says *"לחיפוש גיאוגרפי... תמיד 48 חודשים (4 שנים)"* ("always 48 months / 4 years") and the pool variable is named `pool4yr` — both are **stale/incorrect**; the actual constant is `60`, i.e. 5 years, matching the product's intended contract. This is a real, minor, source-confirmed documentation bug (not a functional one) worth fixing in a future micro-wave.

Applied to both cases: as of "today," a rolling 5-year cutoff is roughly `2021-08-23`. Every relevant row cited in this report (Hartom 30's 6 rows: 2023-05 to 2025-07; Weizmann 92's 3 rows: 2022-08 to 2023-11) falls well within that window — **the 5-year rule is not what excludes these buildings.**

---

## Hartom 30 — Remote Data (via proven-parity local data, see Evidence Note)

- Total deal rows for exact building (`street="הרב שמואל הרטום"`, `houseNumber=30`, all property types): **6**, all `propertyType="apartment"`.
- All 6 fall within the rolling 5-year window.
- Counts by room number: 3 rooms × 4, 4 rooms × 2.
- Recent 4-room deals: `2024-08-30` (90.3m², ₪2,430,000) and `2024-01-17` (90.3m², ₪2,500,000).
- Min/max deal date: `2023-05-14` to `2025-07-10`.
- Stored street value: `הרב שמואל הרטום` (single consistent spelling).
- Stored house-number representation: `"30"` (clean numeric string).
- `neighborhoodId`: `66239241`.

**Are the exact-building rows present in the candidate source the application queries?** **YES** — conditionally: they are present in the citywide dataset (`getAllDeals()`/`data/deals.json`) unconditionally, and present in the neighborhood-scoped `pool4yr` **if** the address resolves to `neighborhoodId=66239241` (matches the deals' own neighborhoodId) — and even if a different neighborhoodId were resolved, the code's city-wide augmentation step (`lib/valuation.ts:408-439`) would independently find and inject these 6 rows regardless of neighborhood, **provided `input.houseNumber` is a non-empty, parseable string when `valuate()` runs.**

## Hartom 30 — Candidate Trace

Traced the actual decision path for the two 4-room Hartom-30 candidates against the two most likely competing Hartom-29 candidates:

| ADDRESS | DATE | ROOMS | AREA | PRICE | IN_CANDIDATE_POOL | EXCLUDED_AT | EXCLUSION_REASON | TIER_IF_HOUSENUMBER_PROVIDED |
|---|---|---|---|---|---|---|---|---|
| Hartom 30 | 2024-08-30 | 4 | 90.3 | 2,430,000 | YES (city-wide, or neighborhood pool) | not excluded | — | **0 (building)** |
| Hartom 30 | 2024-01-17 | 4 | 90.3 | 2,500,000 | YES | not excluded | — | **0 (building)** |
| Hartom 29 | 2026-03-25 | 4 | 112.35 | 2,380,000 | YES | not excluded | — | 1 (street) |
| Hartom 29 | 2025-09-30 | 4 | 93.7 | 2,025,000 | YES | not excluded | — | 1 (street) |

**Why did 29 beat 30 in the operator's real session?** Not because of scoring bias against building 30, and not because the data is missing or mis-tagged — it is because **when `input.houseNumber` is empty, tier is uniformly 1 for every same-street deal** (`tier()`'s building branch is entirely gated on `input.houseNumber` being truthy — `lib/valuation.ts:753`). With tier equalized, the sort falls to `hnProximity` (also uniformly 1 when `houseNumber` is empty — `lib/valuation.ts:777`), then `relevance` (room/size closeness) and `recency`. Hartom 29 has far more inventory (95 rows vs. 6) skewed toward very recent (2026) 4-room transactions, so on pure recency/relevance grounds — with no location tiebreaker active — 29's listings statistically dominate 30's. **No speculation on the mechanism itself** — this is a direct reading of the sort comparator; the only open question is whether `input.houseNumber` was actually empty in the operator's real request, addressed in Root Cause Classification.

---

## Weizmann 92 — Remote Data (via proven-parity local data)

- Exact-building total: **3** rows, all `propertyType="apartment"`.
- All 3 within the rolling 5-year window.
- Room counts: 3 rooms × 2, 4 rooms × 1.
- Recent 4-room deal: `2023-11-21`, 107.3m², ₪1,800,000.
- Stored street value: `ויצמן` (single consistent spelling, matches autocomplete exactly).
- Stored house-number representation: `"92"`.
- Date range: `2022-08-11` to `2023-11-21`.

**Compared against the operator's government-site evidence:**
| Government-site transaction | Found in our dataset? |
|---|---|
| 21/11/2023 — 4 rooms — 107.3m² — ₪1,800,000 | **YES**, exact match |
| 24/11/2022 — 3 rooms — 76.85m² | **YES** — present, but `price=₪476,289` on this row implies ~₪6,200/m², **below the app's own ₪8,000/m² minimum-price-per-sqm quality floor** — this row is correctly filtered out as a likely partial-rights/family transaction by existing valuation-quality logic, independent of the location-tier issue. This is the app's quality filter working as intended, not a bug. |
| 11/08/2022 — 3 rooms — 106m² — ₪2,100,000 | **YES**, exact match |
| 26/01/2022 — 4 rooms — 100.35m² — ₪1,670,000 | **NOT FOUND** in our dataset — genuinely absent, not a normalization issue (no row with this date/price/area combination exists for house number 92 on this street). Reported explicitly, not silently assumed to match. |

Our dataset and the government site are **not fully identical** for this address (3 of 4 cited transactions present) — disclosed rather than assumed.

## Weizmann 92 — Candidate Trace

| ADDRESS | DATE | ROOMS | AREA | PRICE | IN_CANDIDATE_POOL | EXCLUDED_AT | EXCLUSION_REASON | TIER_IF_HOUSENUMBER_PROVIDED |
|---|---|---|---|---|---|---|---|---|
| Weizmann 92 | 2023-11-21 | 4 | 107.3 | 1,800,000 | YES | not excluded | — | **0 (building)** |
| Weizmann 92 | 2022-08-11 | 3 | 106 | 2,100,000 | YES | not excluded | — | **0 (building)** |
| Weizmann 92 | 2022-11-24 | 3 | 76.85 | 476,289 | YES (raw), excluded from *comparables* | `MIN_PPSQM` filter (`lib/valuation.ts:685`) | pricePerSqm ≈ ₪6,200 < ₪8,000 floor — correctly treated as a data-quality outlier | N/A (would be excluded regardless of tier) |
| Weizmann 93 | 2026-04-27 | 4 | 86 | 1,865,000 | YES | not excluded | — | 1 (street) |
| Weizmann 99 | 2026-01-06 | 5 | 142.4 | 3,220,000 | YES | not excluded | — | 1 (street) |
| Weizmann 97 | 2025-07-03 | 3 | 72 | 1,640,000 | YES | not excluded | — | 1 (street) |

**Why did 93/99/97 beat 92?** Identical mechanism to Hartom: without an active house-number filter, every same-street deal is tier=1, and 93/97/99's more recent (2025–2026) transactions outrank 92's 2022–2023 ones on pure recency/relevance. Same root mechanism, same evidence pattern as Hartom.

**The same root cause explains both cases.**

---

## Badge / Result UI

- The UI **already has all four tier badges implemented**, not just "אותו רחוב": `TIER_BADGE` (`components/ValuationWizard.tsx:295-300`) defines `building` ("🏢 אותו בניין"), `street` ("📍 אותו רחוב"), `radius` ("📐 בקרבת מקום"), and `neighborhood` ("🏘️ שכונה"). This is not a missing-feature problem — the display plumbing is fully wired to `ComparableDeal.tier`, which the engine already returns per-deal. The badge shown is exactly whatever `tier` the engine computed; the UI itself has no bug here.
- **Result header does not repeat the evaluated address**: confirmed from source — `Valuation` (`lib/types.ts:41-68`) has **no `street` or `houseNumber` field at all**, only `neighborhood: string | null`. The result screen (`components/ValuationWizard.tsx:1036-1038`) can only ever show *"טווח שווי משוער · {neighborhood}"* — it structurally cannot display the street/house number the user searched for, because the server response never carries it back. This is a separate, source-confirmed gap from the location-tier issue.

---

## Root Cause Classification

**HARTOM 30 = A** (house number effectively absent before the comparable engine runs) — with an important precision: this investigation did **not** find a code defect that captures a house number and then loses it in transit (traced end-to-end, no such drop point exists). The far more likely mechanism, fully consistent with every piece of evidence gathered, is that **house number was simply not entered** in the observed session(s), because the UI never requires it and labels it "not required." Classifications C, D, E, F, G, H were each specifically checked and ruled out for this case:
- **Not C** — when a house number *is* present, the sort's tier comparator makes tier-0 beat tier-1 unconditionally; there is no scoring path where a present, correct house number still loses to another building.
- **Not D** — the street name is stored identically to the autocomplete source; no alias.
- **Not E** — house numbers are stored as clean parseable integers.
- **Not F** — the exact-building data exists, is recent, and includes 4-room units.
- **Not G** — all relevant rows fall inside the 5-year window and match the target property type.
- **Not H** — the badge/tier display logic is correct and already supports all four tiers; it faithfully reflects whatever tier the engine computes.

**WEIZMANN 92 = A**, same reasoning, same evidence pattern, same mechanism. **The same root cause explains both cases** — this is one bug (or, more precisely, one product gap), observed twice.

**One caveat, stated plainly rather than hidden**: the classification would need to become **J (insufficient evidence)** for the *exact* trigger only if the operator can confirm they *did* type a house number in these specific sessions and still saw this result — in that scenario, the fault would sit somewhere this investigation did not find (worth a fresh, narrower trace with real request logs). A single operator question — *"did you type the house number field when testing these two addresses?"* — would fully close this gap.

---

## Proposed Product Contract

*(Not implemented — evidence-based proposal only.)*

- **A. Address requirement**: Make house number a required field before "חשב שווי לפי עסקאות אמיתיות" can be pressed, at least for `propertyType="apartment"|"house"` (not meaningful for raw land parcels). Smallest change: add house number to the existing `canCalc` check, and to `validateSize()`'s sibling validation.
- **B. Comparable location tiers**: Keep the existing four (building → street → radius → neighborhood) — the underlying engine and UI badges are already correctly structured for this; no redesign needed.
- **C. Quality scoring within each tier**: Keep the existing `MIN_PPSQM` outlier floor and size/room relevance sort *within* each tier — proven working correctly on the Weizmann 92 case (correctly excluded the ₪476,289 partial-rights row). Same-building priority must **not** bypass this — an outlier same-building transaction should still be filterable, exactly as today's code already does (tier is the primary sort key, but the `MIN_PPSQM` filter runs *before* tiering and applies uniformly).
- **D. Fallback rules**: Keep the existing progressive widen-on-thin-data behavior (building → street → radius → neighborhood, each requiring a minimum comparable count) — this is sound and already evidence-tested (Weizmann 92 with only 3 raw rows, 2 of quality, would correctly still produce a "building" scope estimate since `MIN_DEALS_FOR_ESTIMATE=3` is met by the raw count, though worth double-checking the min-count threshold's exact interaction with the quality filter in a future dedicated pass if this becomes a live concern — not tested this wave, flagged as an open question rather than assumed fine).
- **E. Display grouping**: No change needed — tier badges already group correctly once a real house number reaches the engine.
- **F. Result address header**: Add `street`/`houseNumber` (or a single formatted `resolvedAddress` string) to the `Valuation` response type and thread it through from `ValuationInput`, so the result screen can show *"טווח שווי משוער — הרב שמואל הרטום 30"* instead of only the neighborhood name.

**Strict fallback vs. weighted/blended — treated as two separate decisions, per instruction:**
- **For DISPLAY (which comparables to show, and their badges)**: recommend keeping **strict tier ordering** (today's behavior) — a user comparing their specific building wants to see their building's own transactions first, full stop; blending would muddy that signal for no real benefit.
- **For VALUATION CALCULATION (the estimateLow/Mid/High numbers)**: the existing code is **already a strict fallback with minimum-sample-size gating**, not blended (building wins outright once it has ≥3 qualifying deals, else it falls through entirely to street, etc.) — this wave found no evidence this needs to change to a blended/weighted model; a sudden jump in bracket width when crossing between tiers is a reasonable, explainable trade-off already implicit in the `scopePct` widening (`P20/P80` for building → `P33/P67` for neighborhood) that existing code already implements to compensate.

---

## Proposed Acceptance Tests

*(Design only — not written this wave.)*

For both **Hartom 30** and **Weizmann 92** (as literal fixtures, since real proven data already exists for them):
1. Given the exact street + house number + a plausible room/area combination, the returned `comparableDeals` array's first entries have `tier === "building"` when ≥1 qualifying same-building deal exists.
2. Exact address (street text and house number) is preserved unchanged from request payload through to whatever powers the comparable tiering — i.e. a unit/integration test asserting `PropertyInput.houseNumber` reaches `tier()`'s building branch.
3. House number is required by client-side validation before a valuation can be requested (once implemented) — a regression test asserting the calculate button/action is blocked without it.
4. A same-building outlier (e.g. a `pricePerSqm` below the `MIN_PPSQM` floor) is still excluded from comparables even when it's the only same-building row available — proven today via the Weizmann 92 ₪476,289 row; codify as an explicit test.
5. When same-building data doesn't exist or is insufficient, the fallback expands to street/radius/neighborhood, and this is observable via `compSearchScope`/comparable `tier` values, not silently indistinguishable from a "true" building match.
6. The displayed tier badge always matches the actual computed `tier` of the underlying deal — no UI/data drift.
7. The result screen displays the exact evaluated address (once Proposed Contract item F ships) — regression test on the response shape and the rendered header text.
8. No regression to the existing valuation arithmetic (`estimateLow/Mid/High`) — the existing `lib/__tests__/valuation.fixture.test.ts` characterization test already guards this; extend rather than replace it.

---

## Recommended Implementation Order

Not implemented this wave. In order of smallest-safest-first:
1. Fix the `pool4yr`/"4 years" comment-vs-`GEO_MONTHS=60` documentation mismatch (zero behavior change, pure clarity).
2. Add `street`/`houseNumber` (or a formatted address string) to the `Valuation` response type and result header (Proposed Contract item F) — additive, no existing behavior change.
3. ~~Make house number a required field in the UI before calculating~~ — **superseded by Wave 0E-1A**: the operator confirmed house number *was* entered in both real failing cases, so "not entered" is no longer the explanation. House number will still become mandatory as a separately-approved product decision (see Wave 0E-1A), but not as a fix for this specific bug — see Wave 0E-1A for why.
4. Add the acceptance tests above, anchored to the real Hartom 30 / Weizmann 92 fixtures already proven in this investigation.

---

## Wave 0E-1A Runtime Reconciliation

### Prior classification rejected
```
PRIOR A CLASSIFICATION: REJECTED
REASON: operator confirms the separate house-number field was populated with the
correct value ("30" and "92" respectively) in both real failing sessions. The
Wave 0E-1 "house number was likely never entered" hypothesis does not hold — it
was entered, and the failure needs a different explanation.
```
This correction is recorded here, not silently rewritten into the original findings above — the original Wave 0E-1 text is left as-is with this correction layered on top, per instruction.

**Separately, per operator direction**: house number will become mandatory for apartment/house valuations as an **already-approved product decision**, independent of this bug's root cause. That work is explicitly deferred to a future implementation wave and is **not** treated as an explanation for the Hartom 30 / Weizmann 92 failures, since the operator confirms it was already entered in both real sessions.

### Method
Reproduced both cases against the actual running application (`next dev`, same commit `d9e72ea`, same `data/deals.json` proven byte-identical to Supabase) via real browser DOM interaction — typing into the real autocomplete input, clicking the real rendered suggestion, typing into the real house-number input, clicking the real "המשך"/"חשב שווי" buttons — with `window.fetch` transparently instrumented (no source file touched) to capture the exact outgoing request bodies to `/api/resolve-address` and `/api/valuation`.

### Phase 2 — Captured runtime payloads

```
CASE=HARTOM30
UI_DISPLAY_ADDRESS=הרב שמואל הרטום (selected suggestion) + houseNumber field = "30"
UI_STREET_STATE=selectedStreet.street = "הרב שמואל הרטום" (label field identical, per Wave 0E-1's AddressSearch.pick() finding)
UI_HOUSE_NUMBER_STATE="30"
REQUEST_STREET="הרב שמואל הרטום"
REQUEST_HOUSE_NUMBER="30"
SERVICE_STREET="הרב שמואל הרטום" (unchanged — resolveAndValuate/valuate pass input.streetName through verbatim, confirmed by source in Wave 0E-1, reconfirmed here: no code changed since)
SERVICE_HOUSE_NUMBER="30" (unchanged, same reasoning)

CASE=WEIZMANN92
UI_DISPLAY_ADDRESS=ויצמן (selected suggestion) + houseNumber field = "92"
UI_STREET_STATE=selectedStreet.street = "ויצמן"
UI_HOUSE_NUMBER_STATE="92"
REQUEST_STREET="ויצמן"
REQUEST_HOUSE_NUMBER="92"
SERVICE_STREET="ויצמן" (unchanged)
SERVICE_HOUSE_NUMBER="92" (unchanged)
```
Full captured `/api/valuation` request bodies:
- Hartom: `{"neighborhoodId":"65867903","propertyType":"apartment","rooms":4,"areaSqm":90,"plotSqm":null,"floor":null,"yearBuilt":null,"houseNumber":"30","streetName":"הרב שמואל הרטום","streetX":188367.912,"streetY":690681.882}`
- Weizmann: `{"neighborhoodId":"66239254","propertyType":"apartment","rooms":4,"areaSqm":107,"plotSqm":null,"floor":null,"yearBuilt":null,"houseNumber":"92","streetName":"ויצמן","streetX":187067.163,"streetY":694046.39}`

### Phase 3 — Street+number duplication check
```
STREET_CONTAINS_HOUSE_NUMBER=NO (both cases)
EXACT_RUNTIME_VALUE=streetName:"הרב שמואל הרטום" / "ויצמן" — clean street text only, verified in the actual captured fetch body, not just source reading
EXACT_STORED_VALUE=deals.street="הרב שמואל הרטום" / "ויצמן" — identical
MATCH_PREDICATE_RESULT=TRUE (exact equality, no normalization even needed) for both
```
This hypothesis is disproven for both cases — the malformed-target theory does not hold.

### Interesting side-finding: a real neighborhood-resolution mismatch exists (Hartom only)
The address-resolution flow (browser-side govmap geocode → `/api/resolve-address`) resolved `הרב שמואל הרטום`'s neighborhood as **`65867903` (משכנות זבולון)**. The actual Hartom-30 deal rows in the dataset are stored under **`66239241` (קריית השרון)** — a genuine cross-source neighborhood disagreement, exactly the scenario `lib/valuation.ts`'s "city-wide textual fallback" and "city-wide exact-building augmentation" blocks were written to handle. **For Weizmann, no such mismatch exists** — the resolved neighborhoodId (`66239254`, מרכז העיר צפון) matches the stored deal rows' own neighborhoodId exactly. Despite this difference between the two cases (one has a neighborhood mismatch, one doesn't), **both reproduced correctly** — see below. This rules the neighborhood-mismatch out as the cause of the operator's observed failure (it's a real, separately-worth-fixing data-quality wrinkle, but the code already compensates for it, confirmed at runtime, not just in theory).

### Phase 5/6/7 — Selector trace, tier verification, reinjection trace: reproduction SUCCEEDED

**This is the central, most important finding of this wave.** Running the real application, real browser interaction, real captured network requests, with `houseNumber` genuinely present and correctly formed in both requests, **the exact building was correctly prioritized and displayed first in both cases**:

**Hartom 30 result** (top 3 of the displayed comparables, verbatim from the rendered page):
```
הרב שמואל הרטום 30 · 🏢 אותו בניין · קומה 3 · 4 חד' · 90.3 מ"ר · ₪2,430,000 · 08/2024
הרב שמואל הרטום 30 · 🏢 אותו בניין · קומה 1 · 4 חד' · 90.3 מ"ר · ₪2,500,000 · 01/2024
הרב שמואל הרטום 30 · 🏢 אותו בניין · קומה 7 · 3 חד' · 83.1 מ"ר · ₪2,175,000 · 05/2023
```

**Weizmann 92 result** (top 2, then falls to radius — correctly, since only 2 quality-passing exact-building rows exist):
```
ויצמן 92 · 🏢 אותו בניין · קומה 5 · 4 חד' · 107.3 מ"ר · ₪1,800,000 · 11/2023
ויצמן 92 · 🏢 אותו בניין · קומה 6 · 3 חד' · 106 מ"ר · ₪2,100,000 · 08/2022
ויצמן 107 · 📍 אותו רחוב · קומה 4 · 4 חד' · 106.85 מ"ר · ₪1,980,000 · 04/2023   (correctly falls to same-street once exact-building supply (2) is exhausted)
```

Per-candidate trace (the level of detail Phases 5–7 requested), for the transactions that matter:

| ADDRESS | DATE | ROOMS | AREA | PRICE | STREET_MATCH | HOUSE_NUMBER_MATCH | LOCATION_TIER (computed, runtime-observed) | DISPLAYED |
|---|---|---|---|---|---|---|---|---|
| Hartom 30 | 2024-08-30 | 4 | 90.3 | 2,430,000 | YES | YES | **0 (building)** | YES, #1 |
| Hartom 30 | 2024-01-17 | 4 | 90.3 | 2,500,000 | YES | YES | **0 (building)** | YES, #2 |
| Weizmann 92 | 2023-11-21 | 4 | 107.3 | 1,800,000 | YES | YES | **0 (building)** | YES, #1 |
| Weizmann 92 | 2022-08-11 | 3 | 106 | 2,100,000 | YES | YES | **0 (building)** | YES, #2 |

No exact-building candidate was found excluded, filtered, or mis-tiered in either reproduction. The re-injection safety net was not even needed to observe in action here since the primary building-tier path already succeeded directly (`compSearchScope` resolved to `"building"` on the first pass for Hartom despite the neighborhood mismatch, per the city-wide textual fallback; Weizmann's own neighborhood already contained its building's rows directly).

### Phase 9 — Root cause classification (runtime evidence)

```
HARTOM30=K
WEIZMANN92=K
```

**K — Insufficient evidence**, specifically: insufficient evidence of a *reproducible* defect. This is not an evasive answer — it reflects a real, load-bearing result: a faithful, real-UI, real-network-capture reproduction of both cases, with house number genuinely entered exactly as the operator describes, **produced the correct result** in both cases. Every other candidate classification (A/B/C/D/E/F/G/H) was directly and specifically tested against and disproven by this same reproduction (no request-level loss, no service-level loss, no malformed street string, no normalization failure, no missing data, no date/property exclusion, no mis-ranked tier, no display-mapping bug — all checked above with runtime evidence, not assumption). What remains unexplained is *why the operator's real session differed from this reproduction* — the two most likely candidates, neither confirmed nor ruled out this wave, are (a) different room/area/floor input values than the ones used here, or (b) a different resolution path if the browser-side govmap geocode failed for the operator (network/CSP-dependent) and the server fell back to a different `/api/resolve-address` code path than the one exercised here. Neither of these is speculation dressed as a finding — they are named as the specific next things to test, not asserted as the cause.

**No single common systemic cause was found** — because no cause was found at all in the faithful reproduction. This is reported plainly rather than forcing a classification the evidence doesn't support.

### Phase 8 — Result address header (reconfirmed, still not fixed)
Unchanged from Wave 0E-1: `Valuation` has no `street`/`houseNumber` field, so the result screen cannot show *"הערכת שווי — ויצמן 92, נתניה"* today. To render that heading, the response type needs (at minimum) the resolved `streetName` and `houseNumber` echoed back — both already available server-side at the point `valuate()` is called, just not included in its return value. Not implemented this wave.

---

## Wave 0E-1B Preview vs Local A/B Trace

**Both facts below are preserved, neither erased:**
- **Fact 1 (Wave 0E-1A, still true)**: a faithful local reproduction, using `next dev` with `DATA_SOURCE=local` (`LocalStore`), correctly displays the exact building first for both Hartom 30 and Weizmann 92.
- **Fact 2 (the operator's original report, still true)**: on a real deployed Preview, the operator observed Hartom 29 and Weizmann 93/99/97 instead.

This wave finds a **source-proven, deterministic explanation** for why these two facts can both be true at once: **Preview runs `DATA_SOURCE=supabase` (`SupabaseStore`), and `SupabaseStore` has a real, verifiable code defect that `LocalStore` does not share** — not a data difference, not a timing issue, not a stale build.

### Phase 1 — Preview build identification
```
PREVIEW_URL=https://shaviut-netanya-97ah045fq-robbublils-projects.vercel.app (latest Preview, Wave 0C-4D)
PREVIEW_DEPLOYED_COMMIT=b6e95d4
CURRENT_LOCAL_HEAD=231d9f7
VALUATION_CODE_IDENTICAL=YES — `git log --oneline b6e95d4..HEAD` touching lib/valuation.ts, lib/valuationService.ts, components/ValuationWizard.tsx, components/AddressSearch.tsx, app/api/resolve-address/route.ts, app/api/autocomplete/route.ts, app/api/valuation/route.ts, lib/store.ts returns nothing — every commit since is docs/audit-only.
DATA_SOURCE_PREVIEW=supabase (confirmed: this is one of the 6 Sensitive Preview-scoped env vars set in Vercel since Wave 0C-2/0C-4)
```
Not assumed which exact Preview the operator used — but since valuation-related code has not changed since `b6e95d4` (the commit backing every currently-retained Preview), **the specific Preview URL doesn't change the analysis**: whichever one they used ran identical `lib/valuation.ts`/`lib/store.ts` code against Supabase.

### The core finding — `SupabaseStore.getAllDeals()` silently strips the fields the city-wide fallback needs

Source comparison, `lib/store.ts`:
```ts
// LocalStore — used by Wave 0E-1A's successful local reproduction
async getAllDeals(): Promise<Deal[]> {
  return this.deals();          // full Deal objects — every field
}

// SupabaseStore — used by every Preview/Production deployment
async getAllDeals(): Promise<Deal[]> {
  const sb = await this.client();
  const { data, error } = await sb.from("deals").select("id,neighborhoodId,x,y");  // ONLY 4 fields
  if (error) throw error;
  return (data ?? []) as Deal[];
}
```
`lib/valuation.ts`'s `lazyAllDeals()` — the function backing **every** city-wide fallback (the "city-wide textual fallback" at lines 251-272, and the "city-wide exact-building augmentation for display" at lines 408-439, both explicitly written, per their own comments, to handle exactly the cross-neighborhood-tagging scenario found below) — calls `store.getAllDeals()`. On Supabase, every row it receives has `street === undefined` and `houseNumber === undefined`. Every filter in those fallbacks starts with `if (!d.street) return false` — so **on Preview/Production, these fallbacks always return zero results, silently, with no error.** On Local, the same fallbacks work correctly because `LocalStore.getAllDeals()` returns complete objects.

This is not a live-Preview assumption — it is a direct, deterministic comparison of the two classes' source code. It is confirmed further below with a prepared read-only diagnostic against the real table.

### Hartom 30 — the exact mechanism, fully explained

Checked against the real (proven-parity) dataset:
- **`הרב שמואל הרטום`'s deals are split across two different neighborhoodIds in the imported data**: house-number 30's 6 rows are tagged `neighborhoodId=66239241` (קריית השרון); house-number 29's 95 rows (and 265 other Hartom rows) are tagged `neighborhoodId=65867903` (משכנות זבולון).
- **The app resolves the whole street to `65867903`** (via `/api/resolve-address`'s static `street-index.json` lookup — see Phase 5 below) — which happens to be exactly where house 29 lives, not house 30.
- So `geoPool` (fetched via `getDealsByNeighborhood("65867903", ...)`, a **full-projection** `select("*")` query, unaffected by the field-stripping bug) legitimately contains dozens of real Hartom-29-and-others rows, and zero Hartom-30 rows — `byExactBuilding(geoPool)` correctly finds nothing for house 30, and the code falls to `compSearchScope="street"` using this pool. **This is where Hartom 29 comes from — a real, correctly-matched same-street deal, not a bug in the street-matching itself.**
- The only mechanism that could still find house 30 is the city-wide fallback (`lazyAllDeals()`) — proven above to be non-functional on Supabase. **House 30 is therefore never found on Preview, at any stage.**
- On Local, the identical scenario works because `LocalStore.getAllDeals()` returns full objects, so the city-wide fallback succeeds and correctly injects house 30 with `tier=0`.

### Weizmann 92 — a second, independent manifestation of the same class of defect

Checked against the real dataset:
- All of Weizmann's addresses (92, 93, 97, 99) share **one single neighborhoodId** (`66239254`, מרכז העיר צפון) — no cross-neighborhood split here, unlike Hartom.
- **That neighborhood has 3,010 deal rows — by far the largest in the dataset (next-largest is 500).** `SupabaseStore.getDealsByNeighborhood()` (`lib/store.ts`) has **no `.range()`/pagination and no explicit `ORDER BY`**:
  ```ts
  async getDealsByNeighborhood(neighborhoodId, q = {}) {
    const sb = await this.client();
    let query = sb.from("deals").select("*").eq("neighborhoodId", neighborhoodId);
    if (q.monthsBack) query = query.gte("dealDate", monthsAgoISO(q.monthsBack));
    ...
    const { data, error } = await query;   // no .range() — PostgREST default cap applies
    return data ?? [];
  }
  ```
  This is **the identical bug class already proven once before, in the same file, on `getStats()`, in Wave 0C-2B** — an unbounded PostgREST query silently capped at 1000 rows, with no error. That specific instance was fixed in `getStats()` (commit `2039580`); **`getDealsByNeighborhood()` and `getAllDeals()` were never touched and carry the same defect.**
- With 3,010 rows in Weizmann's neighborhood and no `ORDER BY`, PostgREST's row order for a truncated response is **not guaranteed** — this wave cannot certify from source alone whether the specific 3 Weizmann-92 rows survive a real truncated response, only that the query is structurally unsafe for any neighborhood past 1,000 rows, and Weizmann's is the most extreme case in the entire dataset (3× over the cap). **This part requires the live diagnostic below to confirm, not assumed.**

### Phase 5 — resolve-address / GovMap branch
Traced `app/api/resolve-address/route.ts`: the route the wizard actually calls sends `{street, x, y}`, which hits **"מסלול 0"** first — a direct, synchronous lookup in the static `data/street-index.json` file (`streetIndexResolve()`), **not** going through `getStore()` at all. This path's output is therefore **identical on Local and Preview/Production** — same bundled static file, no Store/database involvement. GovMap/coordinate-based resolution ("מסלול 1") is a fallback used only if the street-name lookup fails, and would go through `getStore().getAllDeals()` if reached — another call site hitting the same defect, though not the one exercised in either reproduction (street-name resolution succeeded first in both). **Conclusion: the resolve-address step itself is not a source of Local/Preview divergence** — the divergence is entirely inside `lib/valuation.ts`'s use of the Store layer.

### Phase 6 — Store parity diagnostic (prepared, not yet run — needs operator credentials)
A new read-only script, `scripts/verify-supabase-comparables-diagnostic.ts`, was written and self-tested (without real credentials — confirmed it fails safely with a generic error, no crash, no secret exposure) to directly confirm or refute the above against the real Supabase table:
- Whether `getAllDeals()` rows actually lack `street`/`houseNumber`/`price` on the real table (expected: YES, deterministically, from source).
- The real row count `getDealsByNeighborhood("66239254", {})` returns, and whether it's capped near 1000 (expected, pending confirmation).
- Whether Weizmann 92's specific rows survive that truncation (unknown pending this run).
- **The ultimate check**: calling the real `resolveAndValuate()` seam — the exact function the app itself calls — with the exact captured Wave 0E-1A runtime inputs, against the real Supabase-backed store, and reporting the top-3 comparable addresses+tiers it returns. This should reproduce the operator's Hartom-29/Weizmann-93-97-99 result if the theory is correct, using the app's own real code path, not a reimplementation.

**Operator command** (same PowerShell session with real credentials already set, no writes, no PII beyond these two known public addresses):
```powershell
$env:DATA_SOURCE = "supabase"
npx tsx scripts/verify-supabase-comparables-diagnostic.ts
```

### Phase 2 — Chrome DevTools capture instructions (Weizmann 92, for independent live confirmation)
For a second, fully independent confirmation straight from the authenticated Preview (not required if the Phase 6 script above already confirms the theory, but offered since it was requested):
1. Open `https://shaviut-netanya-97ah045fq-robbublils-projects.vercel.app` in Chrome, signed into Vercel.
2. Open DevTools → **Network** tab → click the 🚫 "clear" icon.
3. On the page: property type "דירה", search "ויצמן", select the plain "ויצמן" suggestion (not "שד ויצמן"), enter house number **92**, continue.
4. Enter rooms **4**, area **100** sqm, leave floor as you naturally would (please note whatever value, including "left blank," in your reply).
5. Click "חשב שווי לפי עסקאות אמיתיות".
6. In the Network panel, click the `valuation` request (POST to `/api/valuation`).
7. **Payload/Request tab** — copy the JSON body (it's just `{neighborhoodId, propertyType, rooms, areaSqm, floor, houseNumber, streetName, streetX, streetY}` — no PII, safe to paste back).
8. **Response tab** — copy the `comparableDeals` array's first 3–5 entries (`street`, `houseNumber`, `tier`, `dealDate`, `rooms`, `areaSqm`, `price`) and the top-level `compSearchScope`.
9. If a `resolve-address` request also appears, copy its request body and response JSON the same way.
10. **Do not** copy cookies, the `Authorization` header, or any request header — only the request/response **body** JSON described above.

### Phase 7 — cache/stale-state check
Checked only for mechanisms actually present in source/runtime, nothing speculative:
- React component state (`ValuationWizard.tsx`) persists across steps within one mount, as expected — no evidence found of stale cross-address leakage once `houseNumber`/`selectedStreet` are explicitly set by user action (confirmed empirically in Wave 0E-1A: fresh inputs correctly produced fresh, correct outputs each time).
- No server-side response caching exists on `/api/valuation` — `NextResponse.json(...)` with no `Cache-Control` header set (unlike `/api/neighborhoods`, which explicitly sets a 24h cache — `/api/valuation` has no such header).
- One real, source-confirmed SPA-navigation quirk was observed while testing (Wave 0E-1A): a client-side hash-only `navigate()` between test runs preserved the previous run's component state rather than resetting to step 1, until a full page reload was forced. This is normal React/Next.js client-navigation behavior, not a bug — but is noted because it means **testing multiple addresses back-to-back in one browser tab without a full reload could show a stale previous result if the operator didn't notice the wizard hadn't reset to step 1.** No evidence this happened in the operator's real report, but flagged as a real, present mechanism per the phase's instruction.

### Phase 9 — Root cause classification
```
WEIZMANN92=D (SupabaseStore/LocalStore behavior difference) — mechanism proven from source (getDealsByNeighborhood has no pagination against a 3,010-row neighborhood, the largest in the dataset); whether it specifically excludes Weizmann-92's 3 rows needs the Phase 6 live diagnostic to fully close, but the underlying defect is proven regardless of that specific outcome.
HARTOM30=D (SupabaseStore/LocalStore behavior difference) — mechanism fully proven from source alone, no live run required: getAllDeals()'s field-stripping deterministically disables the exact fallback this scenario depends on, independent of row-order luck.
```
Both cases trace to the **same class of defect** (unbounded/under-projected Supabase queries in `lib/store.ts`'s `SupabaseStore`, the same class already found and partially fixed in `getStats()` back in Wave 0C-2B) — but manifesting through two different specific call sites (`getAllDeals()`'s missing fields for Hartom; `getDealsByNeighborhood()`'s missing pagination for Weizmann). **One common systemic root, two distinct trigger conditions.**

---

## Wave 0E-2A SupabaseStore Parity Fix

### Confirmed via the operator's real live diagnostic run
The operator ran `scripts/verify-supabase-comparables-diagnostic.ts` against real Supabase and got **exact confirmation** of both defects proven from source in Wave 0E-1B:
```
GETALLDEALS_COUNT=1000                          <- capped, real total is 12,642
GETALLDEALS_SAMPLE_HAS_STREET=false              <- confirms the field-stripping projection
GETALLDEALS_SAMPLE_HAS_HOUSENUMBER=false
WEIZMANN_NEIGHBORHOOD_ROW_COUNT=1000             <- capped, real total is 3,010
WEIZMANN_92_PRESENT_IN_NEIGHBORHOOD_POOL=false   <- the specific row was excluded by truncation
HARTOM_30_PRESENT_IN_RESOLVED_NEIGHBORHOOD=false <- confirms the cross-neighborhood split
HARTOM_RESULT_TOP3=["הרב שמואל הרטום 29 [street]", ... ×3]
WEIZMANN_RESULT_TOP3=["ויצמן 93 [street]", "ויצמן 103 [street]", "ויצמן 99 [street]"]
```
This **exactly reproduces** the operator's original Preview observation, using the app's own real code path against the live table — root cause is no longer merely proven from source, it is proven end-to-end on production data.

### Root cause (final statement)
- **Defect 1**: `SupabaseStore.getDealsByNeighborhood()` had no pagination — any neighborhood past PostgREST's ~1000-row default cap silently lost rows, with no error. Weizmann's neighborhood (3,010 real rows) is the most extreme case in the dataset.
- **Defect 2**: `SupabaseStore.getAllDeals()` selected only `id,neighborhoodId,x,y` and was also capped at 1000 rows. Every city-wide fallback in `lib/valuation.ts` depends on this method and filters on `street`/`houseNumber`, both always missing — those fallbacks were structurally inert on any Supabase-backed environment.

### Implementation (`lib/store.ts`, `SupabaseStore` only)
Both methods now page through the table with `.range()` until a short page ends the loop — the same exhaustive-pagination pattern already proven correct in the `getStats()` fix (Wave 0C-2B), applied here to the two remaining unbounded call sites:
- `getDealsByNeighborhood()`: added `.order("id")` + a `PAGE_SIZE=1000` `.range()` loop around the existing `select("*").eq(...)` query (filters — `monthsBack`/`roomsMin`/`roomsMax` — unchanged, still applied server-side per page). Deterministic (explicit order), exhaustive (loops until a page returns `< PAGE_SIZE`), no duplicates (disjoint offsets), errors thrown per existing store conventions, return type unchanged (`Promise<Deal[]>`).
- `getAllDeals()`: changed the projection from `id,neighborhoodId,x,y` to `select("*")` (matching the existing repository pattern already used by `getDealsByNeighborhood`, `listNeighborhoods`, `getNeighborhood` — not a novel style) and added the identical `.order("id")` + `.range()` pagination loop. Return value now has full field parity with `LocalStore.getAllDeals()`.

No valuation logic, location-tier logic, scoring, 5-year window, or address resolution was touched — confirmed by diff scope (see below). `.order("id")` was added to both (a change beyond the literal ask, justified): without an explicit order, Postgres/PostgREST gives no ordering guarantee across separate paginated requests, which could otherwise silently reintroduce duplicate or missing rows across pages even after adding `.range()`.

### Regression tests (`lib/__tests__/store.supabaseComparables.test.ts`, 5 tests, all exercising the real `resolveAndValuate()` -> `valuate()` production seam against a faithful in-memory PostgREST-filter/order/range simulator — not a standalone pagination helper in isolation)
1. **Pagination**: 1,200-row mocked neighborhood, target building's row placed after row 1000 — `getDealsByNeighborhood()` returns all 1,201 rows, target included.
2. **Field parity**: `getAllDeals()` preserves `street`, `houseNumber`, and the full `Deal` shape (not the old narrow projection).
3. **getAllDeals pagination**: 1,500 mocked city-wide rows — all returned, none dropped.
4. **Hartom-equivalent fixture**: target resolves to neighborhood A; the real exact-building rows live under neighborhood B; asserts the city-wide fallback recovers them and they're ranked `tier: "building"`, first in `comparableDeals`.
5. **Weizmann-equivalent fixture**: a 1,102-row neighborhood with the exact-building rows placed (by `id` order) after row 1000; asserts they're still found, exhaustively, and ranked `tier: "building"`, first in `comparableDeals`.

All 5 passed on first run (manual trace of the exact filter/sort mechanics was done independently beforehand and matched the test results exactly — not just "tests pass," the underlying mechanics were understood, not merely asserted).

### Quality gates
- Focused: `lib/__tests__/store.supabaseComparables.test.ts` — 5/5 passed.
- Full suite: **129 passed** (14 files; 124 prior + 5 new).
- Typecheck: clean (one `unknown`-comparison type error in the new test's mock builder was caught and fixed — `gte`/`lte` value params narrowed from `unknown` to `string | number`).
- Lint: **not run** — `next lint` is non-functional in this repo on Next.js 16.2.6 (`next lint` was removed from the Next.js CLI in this version; the project never migrated to a standalone ESLint config; `npx next lint` fails with `Invalid project directory provided, no such directory: ...\lint` regardless of arguments). This is a pre-existing repo condition, not something this wave introduced or can fix within its scope (fixing the build tool chain is not a `SupabaseStore` change).
- Build: `next build` — succeeded, same route classification as every prior wave.

### Scope check
```
git diff --stat -- app lib components scripts
lib/store.ts | 45 +++++++++++++++++++++++++++++++++++----------
1 file changed, 35 insertions(+), 10 deletions(-)
```
Only `lib/store.ts` (application source) and the new test file changed. `ValuationWizard.tsx`, valuation scoring (`lib/valuation.ts`), the address resolver (`app/api/resolve-address/route.ts`), any UI file, the database schema, import scripts, and Vercel configuration were **not touched** — confirmed by this diff, not merely asserted.

### Live Supabase acceptance — status
The fix has **not yet been re-verified against the live table** (would require re-running the diagnostic script post-fix, which needs the operator's credentials). The pre-fix run above is what proved the root cause; a post-fix run is the remaining step to close this wave with full live confirmation. Same command as before:
```powershell
$env:DATA_SOURCE = "supabase"
npx tsx scripts/verify-supabase-comparables-diagnostic.ts
```
Expected (not assumed): `GETALLDEALS_COUNT=12642`, `GETALLDEALS_SAMPLE_HAS_STREET=true`, `GETALLDEALS_SAMPLE_HAS_HOUSENUMBER=true`, `WEIZMANN_NEIGHBORHOOD_ROW_COUNT` > 1000 (real value ~3010), `WEIZMANN_92_PRESENT_IN_NEIGHBORHOOD_POOL=true`, `HARTOM_30_PRESENT_IN_OWN_NEIGHBORHOOD=true` (already true pre-fix, unaffected), and both `HARTOM_RESULT_TOP3`/`WEIZMANN_RESULT_TOP3` showing the exact building at `[building]` tier first, subject only to the existing (unchanged) quality/scoring rules.

### Wave 0E-2A live confirmation

The operator reran the diagnostic against real Supabase post-fix. Result — every expected signal matched:

```
GETALLDEALS_COUNT=12642
GETALLDEALS_SAMPLE_HAS_STREET=true
GETALLDEALS_SAMPLE_HAS_HOUSENUMBER=true
GETALLDEALS_SAMPLE_HAS_PRICE=true
WEIZMANN_NEIGHBORHOOD_ROW_COUNT=3010
WEIZMANN_92_PRESENT_IN_NEIGHBORHOOD_POOL=true
HARTOM_RESULT_TOP3=["הרב שמואל הרטום 30 [building]", "הרב שמואל הרטום 30 [building]", "הרב שמואל הרטום 30 [building]"]
WEIZMANN_RESULT_TOP3=["ויצמן 92 [building]", "ויצמן 92 [building]", "ויצמן 107 [street]"]
ERROR=null
```

Wave 0E-2A is **CLOSED PASS**. Both real operator-reported cases (הרב שמואל הרטום 30, ויצמן 92) now resolve to the exact building at `tier=building` first, against the live table — not just the local mock. No further action needed on the `SupabaseStore` parity fix.

---

## Wave 0E-2B — Mandatory House Number + Result Address Context

**Objective:** house number becomes mandatory (UI + server) for property types where it's meaningful, and the result screen clearly repeats the evaluated address, so a user can never again get a valuation that silently skipped the building-level match the Wave 0E-2A fix made possible. Explicitly forbidden: touching the comparable engine, tiers, scoring, the 5-year window, address resolution, `SupabaseStore`/`LocalStore`, the database, the importer, or Vercel config.

### Phase 2 — contract trace (before editing)
```
CURRENT_HOUSE_NUMBER_TYPE=string (component state; sent as houseNumber.trim() || null)
CURRENT_UI_REQUIRED=false          — canCalc never checked houseNumber
CURRENT_SERVER_REQUIRED=false      — /api/valuation had NO input validation at all;
                                      /api/lead's validateValuationInput() accepted any string/null
CURRENT_RESULT_HAS_STREET=false    — Valuation type carries no street/houseNumber
CURRENT_RESULT_HAS_HOUSE_NUMBER=false
```
Smallest safe implementation, per the wave's own preferred order: **reuse existing wizard state** (`selectedStreet.street` + `houseNumber`, already in `ValuationWizard`'s own component scope) to render the result header — no change to `Valuation`/`Deal`/`ComparableDeal` types, no new API response field.

### Property-type model actually in the codebase (Phase 5)
`PropertyType = "apartment" | "house" | "land"` (`components/ValuationWizard.tsx`, `lib/valuationService.ts`, `app/api/lead/route.ts` — identical literal union in all three). No other property types exist to classify. Rule implemented: `apartment`/`house` → required; `land` → not required (existing behavior retained).

### Single source of truth (new file)
`lib/houseNumberRule.ts` — pure, dependency-free (zero imports), so it is safe to import from **both** the "use client" wizard and the server API routes without risking the service-role key (used by `lib/store.ts`/`lib/valuationService.ts`) ever reaching the client bundle. Exports:
- `isHouseNumberRequired(propertyType)` — `propertyType !== "land"` (default apartment when omitted).
- `isValidHouseNumber(propertyType, houseNumber)` — required check + trim, non-empty.
- `formatEvaluatedAddress(street, houseNumber, city = "נתניה")` — `"הערכת שווי — {street} {houseNumber}, {city}"`, `null` if no street is known (never invents one).
- `HOUSE_NUMBER_REQUIRED_MESSAGE` — the single Hebrew copy, imported everywhere it's shown (UI inline hint, wizard error banner, server 422 message) so wording can never drift between them.

### UI enforcement (Phase 3)
- `components/ValuationWizard.tsx`: `canCalc` now also requires `isValidHouseNumber(propertyType, houseNumber)`; the step-1 "המשך" button is disabled until it's satisfied (in addition to the existing `neighborhoodId` check); `calcValuation()` independently blocks and sets the Hebrew error banner (mirrors the existing `validateSize()` pattern) as defense-in-depth against any state-navigation edge case.
- `components/AddressSearch.tsx`: new `required` prop. When true: adds a `*` to the "מספר בית" label, sets `aria-required`, removes the old "(לא חובה — ישפר דיוק)" copy, and shows the shared Hebrew hint inline whenever the field is empty.
- **Necessary consistency fix**, found while implementing: the pre-existing "לא מוצאים את הרחוב? בחרו שכונה ידנית" fallback (manual neighborhood dropdown, used when a street isn't in the autocomplete index) had **no house-number field at all**. Making the rule unconditional on property type (matching the approved product decision literally) without also exposing a house-number input there would have created a dead-end — an apartment/house user in that fallback could never satisfy the requirement. Added the same required input + hint to that fallback block. This is the one small deviation beyond the three files named in the prompt's scope list, and it's still squarely "address form / wizard validation" — no valuation/store/tier logic touched.
- Values with letter suffixes (`30א`, `12ב`) are not blocked by the new required-check (`isValidHouseNumber` only tests `.trim().length > 0`). Note: `AddressSearch`'s pre-existing character filter (`e.target.value.replace(/[^\d\w]/g, "")`) already strips Hebrew letters today (JS `\w` is ASCII-only) — a pre-existing limitation, not introduced or fixed by this wave (fixing it is out of scope: "do not redesign same-building matching for suffixes").

### Server enforcement (Phase 4)
- `app/api/valuation/route.ts`: calls `isValidHouseNumber(body.propertyType, body.houseNumber)` before `resolveAndValuate()`; on failure returns `422 { error: "house_number_required", message }` and **never calls `resolveAndValuate`**.
- `app/api/lead/route.ts`: `validateValuationInput()` (the existing, only, validator for this input — extended, not duplicated) now rejects when the property type requires a house number and none is present, returning `null` → the existing `invalid_valuation_input` 422 path. No parallel validator created.

### Result address context (Phase 6/7)
Both the step-3 and step-4 result cards now show `formatEvaluatedAddress(selectedStreet?.street ?? null, houseNumber)` as a header line above the existing "טווח שווי משוער · {neighborhood}" line — sourced from the wizard's own selection state, never reconstructed from `comparableDeals`. Renders only when a street is actually known (silently omitted for the neighborhood-only manual-fallback path, consistent with "do not invent" — that path never had a street to show).

### Tests (Phase 8)
This repo has **no DOM/React component-testing infrastructure** (no jsdom `environment`, no `@testing-library/react`, no `.test.tsx` file anywhere) — confirmed by inspecting `vitest.config.ts` and the existing test suite before writing new tests. Introducing one for this micro-wave would be a new-architecture change the wave's own scope explicitly forbids ("Do not create new architecture"). Tests A/B/C/F/G/H are therefore implemented as direct unit tests of the exact shared pure functions that drive the UI gate and header text (`lib/__tests__/houseNumberRule.test.ts`, 17 tests) rather than simulated clicks on a rendered DOM — the same functions `ValuationWizard.tsx`/`AddressSearch.tsx` import, not a re-implementation. Tests D/E are real integration tests against the live route handlers (`app/api/valuation/__tests__/valuation.houseNumber.test.ts`, 5 tests), matching this repo's existing precedent for API-route testing (`app/api/lead/__tests__/lead.valuation.test.ts`). Two pre-existing fixtures (`lead.valuation.test.ts`'s `tamperedBody`, `lead.gate.test.ts`'s `validBody`) predated this rule and needed a `houseNumber` added to stay valid — fixed, plus 2 new tests added directly to `lead.valuation.test.ts` (6b/6c) covering the same server rule end-to-end through `/api/lead`.

| Test | Where | Result |
|---|---|---|
| A — apartment, `houseNumber=""` invalid | `houseNumberRule.test.ts` | pass |
| B — house, `houseNumber=""` invalid | `houseNumberRule.test.ts` | pass |
| C — whitespace-only invalid | `houseNumberRule.test.ts` | pass |
| D — server rejects missing house number, no valuation execution | `valuation.houseNumber.test.ts` (+ `lead.valuation.test.ts` 6b) | pass |
| E — server accepts `"92"`, preserved as string | `valuation.houseNumber.test.ts` | pass |
| F — Weizmann 92 header string | `houseNumberRule.test.ts` + live browser (below) | pass |
| G — Hartom 30 header string | `houseNumberRule.test.ts` + live browser (below) | pass |
| H — land exception, no regression | `houseNumberRule.test.ts` + `valuation.houseNumber.test.ts` + `lead.valuation.test.ts` 6c | pass |

### Manual local acceptance (Phase 11) — real browser, `npm run dev`
- **Case 1 (ויצמן 92, apartment):** clicking "המשך →" with the house-number field empty stayed on step 1 with the Hebrew hint visible; entering `92` resolved the neighborhood and cleared the hint; step-2 "חשב שווי" produced a result whose header read exactly **"הערכת שווי — ויצמן 92, נתניה"**, with "ויצמן 92" / "🏢 אותו בניין" as the first two comparable cards.
- **Case 2 (הרב שמואל הרטום 30, apartment):** same flow; result header read exactly **"הערכת שווי — הרב שמואל הרטום 30, נתניה"**, with three "הרב שמואל הרטום 30" building-tier comparables shown.
- **Mobile safety:** at 375×812 the address header line measured `left:68.7 right:306.7 width:238` — fully inside the 375px viewport, `document.body.scrollWidth === clientWidth` (no horizontal overflow anywhere on the page).
- Console: no errors other than the sandboxed preview proxy's expected HMR-websocket noise (pre-existing, unrelated to this change).
- Server-side spot-check via direct `curl` against the running dev server confirmed the same three cases at the HTTP layer: apartment without `houseNumber` → `422 house_number_required`; `land` without `houseNumber` → passes the gate (fails later on unrelated `insufficient_data`, proving the land exception works).

### Quality gates
- Focused new tests: `houseNumberRule.test.ts` 17/17, `valuation.houseNumber.test.ts` 5/5 — all pass.
- Full suite: **153 passed** (16 files; 129 prior + 22 new/updated: 17 + 5, plus 2 tests added to `lead.valuation.test.ts`, netting the file-count and test-count deltas above).
- Typecheck: clean.
- Lint: **not run** — same pre-existing `next lint` non-functional condition documented in the Wave 0E-2A section; unrelated to and unfixable within this micro-wave's scope.
- Build: `next build` — succeeded, same route classification as every prior wave (`/api/valuation` and `/api/lead` still dynamic `ƒ`, no new routes).

### Scope check
```
git diff --stat -- app lib components (excluding graphify-out)
app/api/lead/__tests__/lead.gate.test.ts      |  2 +-
app/api/lead/__tests__/lead.valuation.test.ts | 24 ++++++++-
app/api/lead/route.ts                         |  6 ++-
app/api/valuation/route.ts                    |  9 ++++
components/AddressSearch.tsx                  | 17 +++++--
components/ValuationWizard.tsx                | 71 ++++++++++++++++++++++-----
6 files changed, 109 insertions(+), 20 deletions(-)
+ new: lib/houseNumberRule.ts, lib/__tests__/houseNumberRule.test.ts, app/api/valuation/__tests__/valuation.houseNumber.test.ts
```
Confirmed **not touched**: `lib/store.ts` (the Wave 0E-2A `SupabaseStore` fix), `lib/valuation.ts` (comparable engine/tiers/scoring/5-year window), `lib/valuationService.ts` (the `resolveAndValuate` seam — the house-number gate lives in the two route handlers that call it, not inside it), the address resolver (`app/api/resolve-address/route.ts`), the database, import scripts, and Vercel configuration.

### Deployment
None. No Production or Preview deployment performed in this wave.

---

## Wave 0E-3 — Protected Preview Acceptance

**Deployment + verification wave only. No application source was modified.**

### Baseline
`HEAD=283971c` — confirmed to contain both Wave 0E-2A (`lib/store.ts` pagination fix — `PAGE_SIZE`-based `.range()` loops present) and Wave 0E-2B (`lib/houseNumberRule.ts` present, imported by `app/api/valuation/route.ts`). Working tree clean (`graphify-out/` residue excluded, left untouched per instruction) both immediately before and immediately after the deploy — the deployed source is provably exactly the tree at commit `283971c`.

### Pre-deploy gate
- Full test suite: **153/153 passed** (16 files) — matches expected state.
- Typecheck: clean.
- Build (`next build`, local): succeeded, same route table as every prior wave.
- Lint: not run — pre-existing `next lint` non-functional condition (Next.js 16, no ESLint config), unchanged, not addressed (out of scope, as instructed).

### Deployment
- Command: `npx vercel@59.4.0 deploy --target=preview --yes` (pinned CLI version, no `--prod`, no domain flags).
- Deployment ID: `dpl_F6wTh49VWyRYqJxVdfYguyA8fuCv`
- Preview URL: `https://shaviut-netanya-9q5h5skwf-robbublils-projects.vercel.app`
- Target: confirmed **`preview`** via `vercel inspect <id> --json` (a concrete server-side deployment record, not assumed from deploy-command text output alone) — `"target": "preview"`, `"readyState": "READY"`.
- Vercel-side build log (remote, same commit) shows the identical route table as the local Phase-2 build (`/api/valuation`, `/api/lead` still dynamic `ƒ`, no new/removed routes) — consistent with the local build, not proof of git SHA by itself since this project has no Vercel↔GitHub git integration (`vercel inspect --json` has no `meta`/`gitSource` field — confirmed by inspecting the JSON's top-level keys), so commit identity rests on the working-tree-clean-at-283971c evidence above, which is conclusive for a CLI-uploaded (non-git-integrated) deployment.
- No Production deployment. No `shaviut-netanya.co.il` domain attachment. No Preview environment variable changes (none were needed — build succeeded without any).

### Protection check
Unauthenticated plain `curl` (not `vercel curl`, which would mint an ephemeral Automation Bypass token) against the Preview URL:
```
HTTP/1.1 302 Found
Location: https://vercel.com/sso-api?url=...&nonce=...
```
Vercel Authentication (Deployment Protection) intercepted the request as expected — redirected to Vercel's SSO flow rather than serving the app. Protection was not bypassed, not disabled, and no Automation Bypass secret was created, inspected, or printed.

### Live acceptance
Operator tested all three cases against the protected Preview (`https://shaviut-netanya-9q5h5skwf-robbublils-projects.vercel.app`) in an already-authenticated browser:

```
CASE_A_MISSING_NUMBER=PASS
CASE_B_WEIZMANN92=PASS
CASE_C_HARTOM30=PASS
```

- **CASE A** — apartment, empty house number: could not advance/calculate; Hebrew requirement message shown; no valuation produced.
- **CASE B** — ויצמن 92: valuation succeeded; header showed "הערכת שווי — ויצמן 92, נתניה"; ויצמן 92 (אותו בניין) returned first; the prior broken behavior (93/99/97/103 before building 92) did **not** recur.
- **CASE C** — הרב שמואל הרטום 30: valuation succeeded; header showed "הערכת שווי — הרב שמואל הרטום 30, נתניה"; building 30 transactions returned first (אותו בניין); the prior broken behavior (building 29 instead of 30) did **not** recur.

### Wave 0E-3 closure

**WAVE 0E-3 = CLOSED PASS.**

### Wave 0E closure

All sub-waves of Wave 0E are now closed:
- 0E-1/0E-1A/0E-1B — root-cause investigation: **CLOSED**
- 0E-2A — `SupabaseStore` comparable-selection parity fix, live-verified: **CLOSED PASS**
- 0E-2B — mandatory house number + result address UX: **CLOSED PASS**
- 0E-3 — protected Preview deployment + live operator acceptance (Cases A/B/C): **CLOSED PASS**
- 0E-3A — Weizmann alias investigation (classification B, no risk): **CLOSED CLEAR**

**WAVE 0E = CLOSED PASS.** Production deployment and custom-domain attachment remain explicitly deferred — not performed in Wave 0E, not started automatically. The next Production step is to be decided with the operator.

---

## Wave 0E-3A — Weizmann Alias Investigation

**Investigation-only. No application source, `street-index.json`, deal data, or Supabase state was modified. No redeploy.**

Trigger: live Preview autocomplete for "ויצמן" returns two suggestions — "שד ויצמן" and "ויצמן".

### Phase 1 — street-index.json evidence
Both entries found in `data/street-index.json` (991 entries):

| field | "שד ויצמן" | "ויצמן" |
|---|---|---|
| DISPLAY_NAME | שד ויצמן | ויצמן |
| CANONICAL_NAME (municipal `code`) | `417` | **none — no `code` field at all** |
| STREET_ID | `417` (from `data/netanya-streets-raw.json`) | none |
| CITY | נתניה (implicit — single-city dataset) | נתניה |
| NEIGHBORHOOD_ID | `66239254` | `66239254` — **identical** |
| NEIGHBORHOOD_NAME (as stored) | "צפון מזרח מרכז העיר" | "מרכז העיר צפון" — **different spelling, same ID** |
| X / Y | `186965 / 693532` | `186965 / 693532` — **byte-identical** |
| SOURCE_FIELDS | `street, code, neighborhoodId, neighborhoodName, x, y` | `street, neighborhoodId, neighborhoodName, x, y` (no `code`) |

Cross-checked against the raw municipal source, `data/netanya-streets-raw.json` (1,048 official street records, `{code, name}` only): it contains **exactly one** Weizmann entry — `{code: 417, name: "שד ויצמן"}`. There is **no "ויצמן" (bare) entry anywhere in the official municipal list.** Same result in `data/streets.json` (the canonical neighborhood→streets map): under "צפון מזרח מרכז העיר" the only Weizmann entry is `"שד ויצמן"` — no bare "ויצמן".

Conclusion: `"ויצמן"` (no code) is **not** an official municipal street — it does not exist in either canonical source file. It exists only as a second, hand/script-added row in `street-index.json`, sharing the exact coordinates and neighborhoodId of the one real municipal entry.

Additional alias check — none of the following appear in any of the three data files (`street-index.json`, `netanya-streets-raw.json`, or as a distinct value in `deals.json`'s `street` field): `שדרות ויצמן`, `שדר' ויצמן`, `חיים ויצמן`, `ויצמן חיים`. The only two Weizmann-related strings anywhere in the codebase's data are the two already identified.

### Phase 2 — deal data distribution
Read-only scan of local `data/deals.json` (12,642 deals total — same file proven byte-identical to Supabase in prior waves):
```
WEIZMANN_COUNT=292
SD_WEIZMANN_COUNT=0
```
`"שד ויצמן"` has **zero** deals anywhere in the dataset. All 292 real Weizmann transactions are stored under the bare `"ויצמן"` spelling.

WEIZMANN ("ויצמן"): min date 2000-07-06, max date 2026-04-27, 58 distinct house numbers (sample: 3, 7, 8, 10, 17, 18, 20, 24, 25, 30, 31, 32, 35, 36, 37, …), single `neighborhoodId`: `66239254`.
SD_WEIZMANN ("שד ויצמן"): no rows — min/max/house-numbers/neighborhoodIds all empty/undefined.

### Phase 3 — house-number overlap
```
OVERLAPPING_HOUSE_NUMBERS= (none possible — SD_WEIZMANN has zero rows)
ONLY_IN_WEIZMANN= all 58 house numbers
ONLY_IN_SD_WEIZMANN= none
WEIZMANN_92_PRESENT=true (3 rows)
SD_WEIZMANN_92_PRESENT=false (0 rows)
```
No duplicate rows to compare — house number 92 (and every other house number) exists exactly once per real transaction, always under `"ויצמן"`. Sample: the three real Weizmann-92 deals (₪1,800,000 / 4 rooms / 107.3 m² / 2023-11-21; ₪476,289 / 3 rooms / 76.85 m² / 2022-11-24; ₪2,100,000 / 3 rooms / 106 m² / 2022-08-11) all carry `street: "ויצמן"`, `x: 186965`, `y: 693532`.

### Phase 4 — geographic / entity check
Both `street-index.json` rows resolve to **the same neighborhoodId (`66239254`) and byte-identical coordinates (`x=186965, y=693532`)** — not inferred from the Hebrew wording, read directly from the data. "שד" is the standard Hebrew abbreviation for "שדרות" (boulevard) — "שד ויצמן" is the full official/municipal form (registered under municipal street `code 417`); "ויצמן" is the short form the tax-authority (רשות המסים) deals dataset uses exclusively. Same physical corridor, same municipal entity, one name is a boulevard-form of the other — confirmed by identical coordinates/neighborhoodId, not by wording alone.

### Phase 5 — autocomplete behavior
Traced to `app/api/autocomplete/route.ts:81-93`. The de-duplication line:
```ts
const seen = new Set<string>();
const hits = index
  .filter((s) => streetMatches(s.street, q))
  .filter((s) => (seen.has(s.street) ? false : seen.add(s.street)))
```
De-duplicates **only by exact raw `street` string** (a `Set<string>` keyed on `s.street`). There is **no** de-duplication by canonical street ID/`code`, by normalized name (no prefix-stripping applied here), or by coordinates/`neighborhoodId`. Since `"ויצמן"` and `"שד ויצמן"` are different raw strings, both independently pass the filter and both are returned as separate suggestions — this is the exact and complete mechanism producing the two-suggestion UX the operator observed.

### Phase 6 — valuation risk
Traced `lib/valuation.ts:175-219`. The comparable-matching code already anticipates and explicitly documents this exact case:
```ts
// ─── נורמליזציה של שם רחוב: הסרת "שד'" / "שדרות" / "רחוב" / "רח'" ───
// מאפשר התאמה בין "שד ויצמן" (כפי שנשמר ב-DB) ל-"ויצמן" (כפי שהמשתמש הקליד).
const STREET_PREFIX = /^(שד'?|שדרות|רחוב|רח')\s*/i;
const normalizeStreet = (s: string) => s.replace(STREET_PREFIX, "").trim();
```
`byStreetName()`, `byExactBuilding()`, and `byBuildingNumber()` all compare `normalizeStreet(deal.street)` against `normalizeStreet(input.streetName)` — never the raw strings. Applying this normalization to both real inputs:
- User selects `"ויצמן"` → `inputStreetNorm = "ויצמן"` (no prefix to strip).
- User selects `"שד ויצמן"` → `inputStreetNorm = "ויצmন"` after stripping the `שד ` prefix → **also `"ויצמן"`**.
- Every real deal's `street` is `"ויצמן"` → `normalizeStreet(d.street) = "ויצמן"` in every case (since no deal is ever stored as `"שד ויצמן"`).

`ds === inputStreetNorm` evaluates `true` identically regardless of which alias was selected — this is the **primary always-active matching path** (`byStreetName`/`byExactBuilding` gate every tier, not a fallback triggered only in edge cases). House number 92 specifically: `byExactBuilding()` filters the already-street-matched pool by `parseInt(houseNumber) === 92`, which runs identically on the same 3-row result set regardless of which Weizmann alias produced that pool. Geo-radius fallback (tier 2) is equally unaffected since both aliases carry byte-identical `x`/`y`.

**Conclusion: selecting "שד ויצמן" vs "ויצמן" retrieves the exact same transactions, including for house number 92 at building tier. This is not a fallback/best-effort behavior — it is the engine's designed, primary, and already-tested matching path** (the same normalization also underlies the Hartom/Weizmann fixes verified in Wave 0E-2A).

### Root-cause classification
```
WEIZMANN_ALIAS_CLASSIFICATION=B — SAME STREET, TWO ALIASES, SAFELY CANONICALIZED DOWNSTREAM
```
The canonicalization happens in `lib/valuation.ts`'s `normalizeStreet()` at query time (not in the street index, and not in autocomplete's de-duplication, which is why the user-visible duplicate suggestion still appears) — but its effect on the actual valuation result is proven safe by direct source and data evidence, not assumption.

### Non-blocking UX observation (not fixed — out of scope for this investigation-only wave)
Autocomplete shows two suggestions for what is provably one street, because its de-duplication key is the raw string, not the canonical `code`/coordinates. This is a cosmetic duplicate-looking-suggestion issue, not a valuation-correctness risk (proven above) — worth a future minimal fix (de-dup by `code` when present, or by `neighborhoodId`+`x`+`y`) but explicitly not implemented in this investigation-only wave.

---

## Wave 0F-1 — Street Autocomplete Alias Dedup

**Micro-wave. Fixes exactly the UX observation flagged (not fixed) at the end of Wave 0E-3A. `lib/valuation.ts`, `lib/store.ts`, deal data, and `street-index.json` source data were not touched.**

### Prior duplicate
Confirmed in Phase 2 against real `app/api/autocomplete/route.ts` (991-entry `street-index.json`): query `"ויצמן"` returned both `["שד ויצמן", "ויצמן"]`; query `"שד ויצמן"` returned only `["שד ויצמן"]`. Root cause: the route's de-duplication (`Set<string>` keyed on the raw `street` field) treats two different spellings as two different streets, even when Wave 0E-3A already proved they are the same physical entity.

### Identity rule
New pure module `lib/streetAliasDedup.ts`. Two street-index entries are only merged into one alias group when **both** conditions hold:
1. Their `normalizeStreetForAlias()` text is equal (same prefix-stripping regex as `lib/valuation.ts`'s `normalizeStreet()`, deliberately kept in exact sync — a constant, not shared business logic, so this route pulls in nothing from the valuation module).
2. They share **proven physical identity**: exact-equal municipal `code` when both carry one, otherwise exact-equal `(x, y)` coordinates when a code is missing on either side. No fuzzy matching, no distance threshold, no Levenshtein — coordinates must be bit-for-bit equal as stored.

Condition 1 alone is a candidate filter only, never sufficient by itself (Test D/E prove this) — two entries can coincidentally normalize to the same text while being genuinely different streets or lacking any proof of shared identity, and must stay separate in that case.

### Why `neighborhoodId` is not used as street identity
Per the wave's explicit instruction and by design: a `neighborhoodId` groups many streets, so two entries sharing one proves nothing about whether they're the *same street* — only that they're in the same area. Using it as identity evidence would risk collapsing genuinely distinct streets that merely happen to sit in the same neighborhood. The rule uses only evidence that is itself specific to a single street: an official municipal code, or an exact coordinate pair.

### Canonical selection
When a group has an entry with a municipal `code` and one without, the coded entry is always preferred as canonical (Test F) — it is the officially-registered municipal record. Otherwise the first-encountered entry is kept, for deterministic, order-stable output. Deal rows and `street-index.json` itself are never renamed — the canonical selection only affects which entry the autocomplete route serves as the displayed/selected suggestion; `lib/valuation.ts`'s existing `normalizeStreet()` already makes either spelling resolve identically at valuation time (proven in Wave 0E-3A), so there is nothing to rewrite downstream.

### Alias searchability
The route's matching step (`streetMatches`) still runs against every entry's own raw `street` string first — so a user typing the alias `"ויצמן"` still matches that raw entry. Only *after* a match, the result is looked up in `buildCanonicalStreetMap()` and replaced with its group's canonical entry before the (now canonical-keyed) de-duplication runs. This preserves searchability by any alias while guaranteeing one suggestion per proven physical street.

### Real-data impact (Phase 8)
Ran `groupStreetAliases()` against the actual `data/street-index.json` (991 entries, 988 groups):
```
BEFORE query="ויצמן":      ["שד ויצמן","ויצמן"]
BEFORE query="שד ויצמן":   ["שד ויצמן"]
AFTER  query="ויצמן":      ["שד ויצמן"]
AFTER  query="שד ויצמן":   ["שד ויצמן"]
TOTAL_ALIAS_GROUPS_COLLAPSED=3
```
The three collapsed groups, all the identical pattern (a coded "שד X" municipal boulevard entry + an uncoded "X" entry, both with byte-identical coordinates — verified individually, not just counted):
- `שד ויצמן` (code 417) + `ויצמן` — the proven case.
- `שד בן גוריון` (code 996) + `בן גוריון`.
- `שד עובד בן עמי` (code 1078) + `עובד בן עמי`.

No unexpected or unrelated collapses — narrow, evidence-based, consistent with the one proven pattern. No broad street-name cleanup was performed or needed.

### Tests
`lib/__tests__/streetAliasDedup.test.ts` — 10 tests, all against the pure `groupStreetAliases`/`buildCanonicalStreetMap`/`normalizeStreetForAlias` functions:
- Weizmann pair collapses to one group; alias `"ויצמן"` remains searchable via the canonical map; coded entry wins as canonical regardless of input order (Tests A/B/C/F).
- Distinct streets with a coincidentally-equal normalized name but non-matching coordinates and no code stay separate (Test D).
- Shared `neighborhoodId` alone (even identical) never merges two entries lacking code/coordinate proof (Test E).
- Equal codes merge even with different coordinates; different codes never merge even with identical coordinates; near-but-not-exactly-equal coordinates are not merged (no fuzzy/distance matching).

Test G (valuation contract untouched): the full suite, including `lib/__tests__/store.supabaseComparables.test.ts` (Wave 0E-2A) and `lib/__tests__/valuation.fixture.test.ts`, was re-run unchanged and still passes — no valuation/comparable test was modified.

### Manual local acceptance
Real `npm run dev` server, real browser:
- `GET /api/autocomplete?q=ויצמן` → exactly one suggestion, `"שד ויצמן"`.
- `GET /api/autocomplete?q=שד ויצמן` → exactly one suggestion, `"שד ויצמן"`.
- In the live UI: searching `"ויצמן"` showed exactly one suggestion ("בחר שד ויצמן"); selecting it, entering house number 92, 4 rooms, 100 sqm produced a successful valuation with result header **"הערכת שווי — שד ויצמן 92, נתניה"** and two building-tier ("אותו בניין") "ויצמן 92" comparables first — identical to the Wave 0E-3 acceptance result, no regression.

### Quality gates
- Focused: `lib/__tests__/streetAliasDedup.test.ts` — 10/10 passed.
- Full suite: **163 passed** (17 files; 153 prior + 10 new).
- Typecheck: clean.
- Lint: not run — same pre-existing `next lint` non-functional condition, unrelated to this wave.
- Build: `next build` — succeeded, same route table as every prior wave.

### Scope check
```
git diff --stat -- app lib (excluding graphify-out)
app/api/autocomplete/route.ts | 59 +++++++++++++++++++++++++++----------------
1 file changed, 37 insertions(+), 22 deletions(-)
+ new: lib/streetAliasDedup.ts, lib/__tests__/streetAliasDedup.test.ts
```
```
VALUATION_CHANGED=NO
SUPABASESTORE_CHANGED=NO
LOCALSTORE_CHANGED=NO
DEAL_DATA_CHANGED=NO
STREET_INDEX_DATA_CHANGED=NO
DB_WRITES=NONE
DEPLOYMENT=NONE
```

### Deployment
None. No Production or Preview deployment performed in this wave.

---

## Wave 0F-2 — Protected Preview Acceptance (Street Alias Dedup)

**Deployment + verification wave only. No application source was modified.**

### Baseline
`HEAD=207567c` — confirmed to contain Wave 0F-1 (`lib/streetAliasDedup.ts` present, imported by `app/api/autocomplete/route.ts`). Working tree clean (`graphify-out/` residue excluded, untouched) both immediately before and immediately after the deploy — the deployed source is provably exactly the tree at commit `207567c`.

### Deployment
- Command: `npx vercel@59.4.0 deploy --target=preview --yes` (pinned CLI version, no `--prod`, no domain flags).
- Deployment ID: `dpl_CbE1i5qq2KFsKaJkgP36dqjhbgc5`
- Preview URL: `https://shaviut-netanya-ojna4ci6m-robbublils-projects.vercel.app`
- Target: confirmed **`preview`** via `vercel inspect <id>` (concrete server-side record) — `target: preview`, `status: Ready`.
- No Production deployment. No `shaviut-netanya.co.il` domain attachment. No Preview environment variable changes. Deployment Protection and Automation Bypass configuration untouched.

### Protection check
Unauthenticated plain `curl` against the Preview URL:
```
HTTP/1.1 302 Found
Location: https://vercel.com/sso-api?url=...&nonce=...
```
Vercel Authentication intercepted the request as expected. Not bypassed, not disabled, no Automation Bypass secret created/inspected/printed.

### Live acceptance
STOPPED here per Phase 4 — awaiting the operator's manual test of the four acceptance cases (Weizmann dedup, Weizmann 92 valuation, Ben Gurion dedup, Oved Ben Ami dedup) in an already-authenticated browser against the Preview URL above. This section will be completed once the operator reports results.

---

## Wave 0F-2A — Ben Ami 45 Live Fallback / Zero-Address Investigation

**Investigation-only. Wave 0F-2 acceptance is STOPPED, not marked PASS. No application source, data, or deployment changed.** Operator found this live on the Wave 0F-2 Preview while testing case D (Oved Ben Ami autocomplete); target address is Ben Ami house number **45** (corrected from an initial 42).

### Target (Phase 1)
Only one Ben-Ami-family entry pair exists in `street-index.json` — the same pair proven in Wave 0F-1: `"שד עובד בן עמי"` (code 1078) and `"עובד בן עמי"` (uncoded), both `neighborhoodId=66239231`, both `x=185473, y=690366`. No other distinct Ben-Ami street exists. Canonical (post-0F-1) = `"שד עובד בן עמי"`.
```
AUTOCOMPLETE_DISPLAY=שד עובד בן עמי, כוכב הים
STREET_CODE=1078
X=185473
Y=690366
NEIGHBORHOOD_ID=66239231
NORMALIZED_STREET_KEY=עובד בן עמי
```

### Real root cause (Phases 2–4) — proven via `resolveAndValuate()` traced against local data (proven byte-identical to Supabase in prior waves; real Supabase credentials remain unavailable in this environment, per every prior wave's Evidence Note — the exact operator rerun command for live confirmation is given below)

**The real defect has nothing to do with house number 45 specifically, and nothing to do with Wave 0F-1.** Two independent, compounding facts:

1. **Every real "עובד בן עמי" deal (65 rows) is stored under `neighborhoodId=66239254` ("מרכז העיר צפון")** — not `66239231`, the neighborhoodId the street itself resolves to. This is the exact same bug *class* proven for Hartom in Wave 0E-1B (a street whose transactions were imported under a different `neighborhoodId` than the one address-resolution assigns the street to) — except here the mismatch is total (0 of 65 rows are under 66239231), not partial.
2. `lib/valuation.ts` already has a designed safety net for exactly this scenario (the "שלב טקסטואלי עירוני" block, lines 251–272 — the same mechanism Hartom's fix relies on): if the resolved-neighborhood pool (`geoPool`) is small (`< MIN_DEALS_FOR_ROOM_FILTER = 6`), it searches `lazyAllDeals()` city-wide by normalized street name instead. **This safety net never fires here**, because `neighborhoodId=66239231` ("נוף הטיילת"/"כוכב הים") is itself a large, real, populated neighborhood — 500 total deals, 108 with `rooms=4` within the 5-year window — so `geoPool.length` is far above the `<6` trigger. The gate that exists specifically to rescue this exact situation silently does not apply when the *wrong* neighborhood happens to be populous rather than empty.

Traced with the real `resolveAndValuate()` seam (input: `neighborhoodId=66239231`, `streetName="שד עובד בן עמי"`, `houseNumber="45"`, `rooms=4`, `areaSqm=100`, real street coordinates):
```
RESOLVED_NEIGHBORHOOD=נוף הטיילת (66239231)
COMP_SEARCH_SCOPE=neighborhood
BASED_ON_DEALS=28
WINDOW_MONTHS=6
```
Building tier: 0 candidates (no house-45 deals exist anywhere in the dataset for this street — genuinely absent, not a bug by itself). Street tier: 0 candidates *from `geoPool`* (all 65 real Ben Ami deals are outside `geoPool` entirely, per fact 1) — the would-be rescue (city-wide street search) never executes, per fact 2. Falls straight through to neighborhood tier, which is dominated by an unrelated data-quality issue (next section).

### Zero-address root cause (Phase 4)
Traced the exact returned comparable rows to their raw `data/deals.json` records:
```json
{"dealDate":"2026-05-19","price":1025000,"areaSqm":103,"address":"0","street":"0","houseNumber":null,"neighborhoodId":"66239231","neighborhood":"נוף הטיילת", ...}
```
```
RAW_DEAL_STREET="0"        (literal string, not missing/null)
RAW_DEAL_HOUSE_NUMBER=null
```
**391 of the ~500 deals in `neighborhoodId=66239231` have this literal `street: "0"` / `address: "0"` value** — a pre-existing data-import artifact (present in this environment's `data/deals.json`, i.e. presumably Supabase too since this file was proven byte-identical in prior waves; not introduced by any wave in this engagement). It is not missing/`null` — it is a stored placeholder string.

`CompDealCard()` in `components/ValuationWizard.tsx` renders:
```ts
const streetLine = c.address
  ? c.address.replace(/,?\s*נתניה$/i, "").trim()
  : hasStreet ? `רח' ${c.street}...` : null;
```
`"0"` is a truthy string, so `c.address ? ... : ...` takes the `c.address` branch, the neighborhood-suffix regex doesn't match `"0"`, and the formatter faithfully renders the literal stored placeholder. This is not a formatter bug in the sense of miscomputing anything — it renders exactly what's stored — but it has no guard recognizing `"0"` (or an all-zero/placeholder value) as "no real address," unlike its existing guard for empty/falsy values.
```
DISPLAY_FORMATTER=CompDealCard() in components/ValuationWizard.tsx (streetLine computation)
RENDERED_RESULT="0"
```

### Wave 0F-1 regression check (Phase 5) — proven NOT a regression
Re-ran the identical `resolveAndValuate()` trace with `streetName="עובד בן עמי"` (the uncoded alias — the exact string a user would have selected before Wave 0F-1's dedup existed):
```
COMP_SEARCH_SCOPE=neighborhood
BASED_ON_DEALS=28
FIRST_3 comparables: byte-identical dates/areas/tier/street("0") to the canonical-alias run
```
Both aliases already carried the identical `neighborhoodId` (`66239231`) and identical coordinates in `street-index.json` **before** Wave 0F-1 existed (verified directly in the raw data, not assumed) — so Wave 0F-1 changed only which *label* is shown in autocomplete, never which `neighborhoodId`/coordinates get resolved into the valuation request. The defect is provably independent of, and predates, Wave 0F-1.

### Product expectation (Phase 6 — not implemented yet)
Documented, not built: if building 45 had valid recent deals, show building comparables first; else if same-street deals exist (they do — 65 real rows, just invisible to the current neighborhood-scoped fallback), show them before neighborhood; if only neighborhood fallback truly applies, show neighborhood comparables but never render a literal `"0"` — use a safe, truthful representation (e.g. omit the address line entirely when the stored value is a known placeholder) rather than inventing an address that isn't in the source data.

### Root-cause classification (Phase 7)
```
BEN_AMI_MATCHING_ROOT_CAUSE=G — multiple causes:
  (1) legitimate absence of house-45-specific deals (would justify falling past building tier alone), compounding
  (2) E — selector fallback bug: the existing city-wide street-name rescue (lib/valuation.ts:254, designed for exactly
      this "street lives under a different neighborhoodId" scenario) is gated on geoPool.length < 6, which fails to
      trigger when the wrong-but-resolved neighborhood is itself large/populous (here: 500 deals) rather than small —
      so the rescue never runs even though it would have found all 65 real same-street deals city-wide.

ZERO_ADDRESS_ROOT_CAUSE=Does not cleanly match any of A–D as literally worded — closest to B in spirit (no real
  street exists for these deals) but the source data encodes that as the literal string "0" rather than
  null/empty, and the UI formatter's existing truthy-check does not recognize "0" as a placeholder. Best
  classified as a source-data-placeholder + formatter-validation-gap pair, i.e. E — multiple causes.
```

### Wave 0F-1 regression
```
YES/NO = NO — proven via identical resolveAndValuate() output for both pre- and post-dedup alias spellings.
```

### Live Supabase confirmation (not yet run — operator step)
This investigation used local `data/deals.json` (proven byte-identical to Supabase in prior waves). For final live confirmation, the operator can run:
```powershell
$env:DATA_SOURCE = "supabase"
npx tsx -e "import('./lib/valuationService').then(async ({resolveAndValuate}) => { const r = await resolveAndValuate({neighborhoodId:'66239231', propertyType:'apartment', rooms:4, areaSqm:100, houseNumber:'45', streetName:'שד עובד בן עמי', streetX:185473, streetY:690366}); console.log(JSON.stringify(r, null, 2)); });"
```
Expected (not assumed): `compSearchScope=neighborhood`, and the top comparables' `street`/`address` fields showing the literal `"0"` placeholder — matching this local trace.

### Source changes
NONE. DB writes: NONE. Deployment: NONE.

---

## Wave 0F-2B — Relevant-Candidate City-Wide Fallback Fix

**Implementation micro-wave, authorized by the Wave 0F-2A root-cause proof. Not a Wave 0F-1 regression fix — this bug predates every wave in this engagement (present since the earliest baseline snapshot in this repo's git history).**

### Old gate vs new gate
```
CURRENT_FALLBACK_GATE (before) = compSearchScope === "neighborhood" && inputStreetNorm && geoPool.length < MIN_DEALS_FOR_ROOM_FILTER (6)
CURRENT_MIN_SAMPLE_RULE = MIN_DEALS_FOR_ESTIMATE (3) — already used everywhere else in the tier cascade
BUILDING_CANDIDATE_COUNT_AT_GATE (Ben Ami) = 0
STREET_CANDIDATE_COUNT_AT_GATE (Ben Ami, from geoPool) = 0 (all 65 real deals live outside geoPool's neighborhoodId)
RADIUS_CANDIDATE_COUNT_AT_GATE = not reached until later
WHY_GEOPOOL_6_EXISTS = git history shows this condition dates to the repo's earliest baseline snapshot (`0d9459f`), predating this engagement. The most evidence-consistent explanation (see scripts/harvest-missing.ts's documented "196 streets with a phantom neighborhoodId that doesn't exist in deals.json" concept): the gate was designed around "the resolved neighborhood pool is basically empty" (a real, separately-documented condition) as a proxy for "the street search failed for a data-completeness reason." That proxy holds when the wrong-resolved neighborhood is itself sparse, but silently fails when the wrong-resolved neighborhood is large/populous (Ben Ami: 500 unrelated deals) — exactly the gap Wave 0F-2A found.
```
New gate:
```ts
if (compSearchScope === "neighborhood" && inputStreetNorm) {
```
No new threshold was introduced. `compSearchScope` is still `"neighborhood"` at this point in the function if and only if the preceding local cascade (`byExactBuilding`/`byBuildingNumber`/`byStreetName` against `geoPool`) failed to reach `MIN_DEALS_FOR_ESTIMATE` at every tier — that's already the exact "not enough relevant candidates" signal, computed via the pre-existing threshold, just not previously reused as the rescue gate.

### Performance / selectivity (Phase 3)
```
NORMAL_REQUEST_CITYWIDE_SCAN=NO
```
Verified both by construction (removing an `&&` condition can only make the gate strictly more, never less, permissive — so every case that already triggered the rescue under the old gate still triggers it) and by an automated test (`TEST C`, below) that tracks every `deals`-table query issued through the real seam and asserts none of them is an unscoped (non-`neighborhoodId`-filtered) bulk query when the resolved neighborhood already has an exact-building match.

### Tests (Phase 5)
`lib/__tests__/valuation.cityWideFallback.test.ts` — 5 tests against the real `resolveAndValuate()` → `valuate()` seam, mocked Supabase client (same pattern as `store.supabaseComparables.test.ts`):
- **Test A (Ben Ami equivalent):** resolved neighborhood A populous (10 unrelated deals), target street's 5 real deals live under neighborhood B. Asserts the rescue fires and `compSearchScope === "street"`. **Confirmed to fail under the old gate** (`git stash` round-trip re-run: old gate produces `compSearchScope === "neighborhood"`, exactly reproducing the live Ben Ami defect) and pass under the new one.
- **Test B (Hartom equivalent):** small resolved-neighborhood pool (the old gate's originally-working case) with an exact-building match in a different neighborhood. Still recovers `compSearchScope === "building"` — no regression.
- **Test C (normal healthy neighborhood):** resolved neighborhood already has an exact-building match locally. Asserts **zero** unscoped `deals` queries were issued (the city-wide scan never runs) — a direct, automated proof of Phase 3's selectivity requirement, not just a manual claim.
- **Test D (thin relevant sample):** only 2 local street-tier matches (below the existing `MIN_DEALS_FOR_ESTIMATE=3`) plus 1 more matching deal in another neighborhood — combined city-wide total reaches 3, upgrading to `"street"` tier via the *existing* threshold. **Also confirmed to fail under the old gate** (same `git stash` re-run). No new threshold was invented for this case.
- **Test E (no street data anywhere):** target street has zero deals in the entire dataset. Rescue may run (harmless — `lazyAllDeals()` is memoized per request) but finds nothing; `compSearchScope` truthfully stays `"neighborhood"`, no comparable is falsely tagged `"building"`/`"street"`.

All 5 pass with the fix; a `git stash`/`git stash pop` round-trip confirmed Tests A and D specifically fail against the pre-fix code (2/5 failures, exactly the two designed to exercise the new gate) while B/C/E already passed under the old gate too — proving the test suite isolates the actual fix, not a false positive.

### Real Ben Ami diagnostic (Phase 6) — local data (real Supabase credentials remain unavailable in this environment; local `data/deals.json` proven byte-identical to Supabase in prior waves)
Before the fix: `COMP_SEARCH_SCOPE=neighborhood`, `BASED_ON_DEALS=28`, top comparables all `street:"0"` (the separately-tracked, still-open placeholder issue).
After the fix:
```
BEN_AMI_BUILDING_CANDIDATES=0 (house 45 genuinely has no deals — unchanged, correct)
BEN_AMI_STREET_CANDIDATES=16 (real "עובד בן עמי" deals, recovered city-wide)
BEN_AMI_RADIUS_CANDIDATES=not reached (street tier already satisfied)
COMP_SEARCH_SCOPE=street
BEN_AMI_FINAL_TOP3=["עובד בן עמי 2 [street]", "עובד בן עמי 2 [street]", "עובד בן עמי 2 [street]"]
```
All top comparables now show the real, genuine "עובד בן עמי 2" address — not the "0" placeholder — because these are real recovered deal rows, not neighborhood-tier filler. Live Supabase re-confirmation command (unchanged target from Wave 0F-2A, safe/read-only):
```powershell
$env:DATA_SOURCE = "supabase"
npx tsx -e "import('./lib/valuationService').then(async ({resolveAndValuate}) => { const r = await resolveAndValuate({neighborhoodId:'66239231', propertyType:'apartment', rooms:4, areaSqm:100, houseNumber:'45', streetName:'שד עובד בן עמי', streetX:185473, streetY:690366}); console.log(JSON.stringify(r, null, 2)); });"
```
Expected post-fix: `compSearchScope: "street"`, non-empty `comparableDeals` with real `street`/`address` values (not `"0"`).

### Wave 0E regression check (Phase 7) — local data, unchanged
```
Hartom 30 top-3:   ["הרב שמואל הרטום 30 [building]", "הרב שמואל הרטום 30 [building]", "הרב שמואל הרטום 30 [building]"]
Weizmann 92 top-3: ["ויצמן 92 [building]", "ויצמן 92 [building]", "ויצמן 107 [street]"]
```
Byte-identical to the results verified live in Wave 0E-2A/0E-3 — no regression.

### Open follow-up (Phase 8 — explicitly NOT fixed in this wave)
```
ZERO_PLACEHOLDER_DISPLAY = OPEN
```
This wave's fix naturally avoids the "0"-placeholder rows for the specific Ben Ami case (because it now surfaces real street-tier data instead of falling through to the "0"-contaminated neighborhood tier) — but that is a side effect, not a fix. The underlying defect (raw `deals.json`/Supabase rows with a literal `street`/`address` value of `"0"`, and `CompDealCard`'s formatter having no guard against it — proven in Wave 0F-2A) remains present and will still surface for any other request that legitimately falls through to neighborhood tier in a "0"-contaminated neighborhood. To be fixed separately (proposed Wave 0F-2C, per Wave 0F-2A's own recommendation).

### Quality gates
- Focused: `lib/__tests__/valuation.cityWideFallback.test.ts` — 5/5 pass.
- Full suite: **168 passed** (18 files; 163 prior + 5 new).
- Typecheck: clean.
- Lint: not run — same pre-existing `next lint` non-functional condition, unrelated to this wave.
- Build: `next build` — succeeded, same route table as every prior wave.

### Scope check
```
git diff --stat -- lib (excluding graphify-out)
lib/valuation.ts | 14 ++++++++++++--
1 file changed, 12 insertions(+), 2 deletions(-)
+ new: lib/__tests__/valuation.cityWideFallback.test.ts
```
```
AUTOCOMPLETE_CHANGED=NO
SUPABASESTORE_CHANGED=NO
LOCALSTORE_CHANGED=NO
DEAL_DATA_CHANGED=NO
ADDRESS_RESOLVER_CHANGED=NO
DB_WRITES=NONE
DEPLOYMENT=NONE
```

### Deployment
None. No Production or Preview deployment performed in this wave.

---

## Wave 0F-2C — Comparable Address Placeholder Display

**Presentation-only micro-wave, authorized by Wave 0F-2A's proven open follow-up. Source deal data was NOT touched, NOT cleaned, NOT migrated — the "0" placeholder still exists in `data/deals.json`/Supabase exactly as before.**

### Proven "0" source artifact (recap, unchanged from Wave 0F-2A, re-confirmed here)
```
RAW_FIELDS_AVAILABLE = Comparable.street: string|null, Comparable.address: string|null, Comparable.houseNumber: string|null, Comparable.tier?: "building"|"street"|"radius"|"neighborhood"
CURRENT_ADDRESS_SOURCE (before) = c.address preferred over c.street/c.houseNumber when truthy
CURRENT_FORMATTER (before) = c.address ? c.address.replace(/,?\s*נתניה$/i,"").trim() : hasStreet ? `רח' ${c.street}${c.houseNumber?...}` : null
CURRENT_EMPTY_FALLBACK (before) = "כתובת לא פורסמה" — but only reached for null/empty, never for a truthy "0"
```
Re-confirmed directly against `data/deals.json`: **2,608 deals city-wide** have `street === "0"` and `address === "0"` — perfectly correlated (both fields always placeholder together), and `houseNumber` is **never** literally `"0"` anywhere in the dataset (0 occurrences, checked directly) — so, per this wave's explicit instruction not to broaden beyond proven evidence, house-number handling was left completely untouched.

### Presentation rule
New file `lib/comparableAddress.ts`, `formatComparableAddress(street, address, houseNumber, tier)`:
- A street/address value is **not displayable** when, after trim, it is empty or literally `"0"` (the exact, evidence-proven placeholder — no numeric-street heuristics, no placeholder dictionary, nothing broader).
- Prefers `address` (with the `, נתניה` suffix stripped, same as before) when displayable; falls back to `` `רח' ${street}${houseNumber ? ' '+houseNumber : ''}` `` when only `street` is displayable (house-number appending logic byte-identical to before); otherwise falls back to a truthful tier-based label.
- Returns `{ text, isRealAddress }` so `CompDealCard` can keep its existing visual distinction (bold slate for a real address, italic gray for a fallback label) — same visual slot as the old "כתובת לא פורסמה" state, just correctly triggered now.

### Fallback labels (exact real tier enum, no invented tiers)
```
building     -> "עסקה בבניין"
street       -> "עסקה ברחוב"
radius       -> "עסקה בסביבה הקרובה"
neighborhood -> "עסקה בשכונה"
no tier      -> "עסקה באזור"   (neutral — e.g. the manual-neighborhood-fallback path, which never sets a per-comparable tier)
```

### No data mutation
`lib/comparableAddress.ts` reads only the four fields already passed into the component (`street`, `address`, `houseNumber`, `tier`) — it does not read, write, or touch `data/deals.json`, Supabase, `SupabaseStore`, `LocalStore`, the importer, or the database schema. **The literal "0" values remain in the source data exactly as before** — this wave changes only what the browser renders.

### Tests
`lib/__tests__/comparableAddress.test.ts` — 15 tests directly against `formatComparableAddress` (the same function `CompDealCard` imports, not a re-implementation — this repo has no DOM/component-testing infrastructure, same established rationale as Wave 0E-2B):
- Tests A/B/C: literal `"0"` street, literal `"0"` address (including when address is `"0"` but street would otherwise be usable — proves address-rejection is independent, not merely a side effect of street also failing), empty/whitespace street+address, null/undefined — all render a truthful fallback, never `"0"`.
- Tests D/E: valid street+houseNumber and valid street-without-houseNumber render exactly as before (no fabricated house number).
- Tests F/G: Hartom 30 and Ben Ami street-deal regressions — unchanged output.
- Test H: every real tier (`building`/`street`/`radius`/`neighborhood`) maps to its specified label; no tier maps to the neutral fallback.

### Real-data sample (Phase 7) — read-only, no writes
Rendered 3 real `street==="0"` rows from `data/deals.json` through the actual helper:
```
ZERO_SAMPLE_BEFORE="0"   ZERO_SAMPLE_AFTER="עסקה בשכונה"   (×3, all identical)
```

### Manual local acceptance
Real `npm run dev` server, real browser, apartment / neighborhood-fallback path (66239231, the same neighborhood proven contaminated in Wave 0F-2A) with no street selected (forcing a tier-less neighborhood result — the code path that most directly exercises the placeholder):
- The exact real deal row from the Wave 0F-2A investigation (₪1,025,000, floor 6, 4 rooms, 103 m², 05/2026) rendered as **"עסקה באזור"** — not `"0"` — with price/floor/rooms/area/date all intact and unchanged.
- No literal `"0"` found in any comparable card on the page (checked programmatically across all rendered address spans).
- 375px mobile viewport: no horizontal overflow (`document.body.scrollWidth === clientWidth`).
- No console errors.
- **Ben Ami 45 re-verified** (Wave 0F-2B's fix): result header **"הערכת שווי — שד עובד בן עמי 45, נתניה"**, comparable cards show the real **"עובד בן עמי 2"** address (street tier) — confirming the placeholder fix did **not** replace valid real addresses with generic labels.

### Quality gates
- Focused: `lib/__tests__/comparableAddress.test.ts` — 15/15 pass.
- Full suite: **183 passed** (19 files; 168 prior + 15 new).
- Typecheck: clean.
- Lint: not run — same pre-existing `next lint` non-functional condition, unrelated to this wave.
- Build: `next build` — succeeded, same route table as every prior wave.

### Scope check
```
git diff --stat -- components lib (excluding graphify-out)
components/ValuationWizard.tsx | 14 +++++---------
1 file changed, 5 insertions(+), 9 deletions(-)
+ new: lib/comparableAddress.ts, lib/__tests__/comparableAddress.test.ts
```
```
VALUATION_CHANGED=NO
AUTOCOMPLETE_CHANGED=NO
SUPABASESTORE_CHANGED=NO
LOCALSTORE_CHANGED=NO
DEAL_DATA_CHANGED=NO
IMPORTER_CHANGED=NO
DB_WRITES=NONE
DEPLOYMENT=NONE
```

### Deployment
None. No Production or Preview deployment performed in this wave.

---

## Wave 0F-3 — Final Protected Preview Acceptance

**Deployment + verification wave only. No application source was modified.**

### Baseline
`HEAD=7a00773` — confirmed to contain all three Wave 0F fixes: street-alias dedup (`lib/streetAliasDedup.ts`), the relevant-candidate city-wide fallback fix (`lib/valuation.ts`), and the comparable-address placeholder display fix (`lib/comparableAddress.ts`). Working tree clean (`graphify-out/` residue excluded, untouched) both before and after the deploy.

### Pre-deploy gate
- Full test suite: **183/183 passed** (19 files) — matches expected state.
- Typecheck: clean.
- Build: succeeded, same route table as every prior wave.
- Lint: not run — pre-existing `next lint` non-functional condition, unchanged.

### Deployment
- Command: `npx vercel@59.4.0 deploy --target=preview --yes` (pinned CLI version, no `--prod`, no domain flags).
- First attempt returned a transient `"reason": "deploy_failed", "message": "Not authorized"` API error (auth itself was confirmed healthy — `vercel whoami` and `vercel project ls` both succeeded normally against the correct project/team scope immediately before and after). Retried once, per the error's own suggested next step, and it succeeded — no source, config, or auth state was changed between attempts.
- Deployment ID: `dpl_CHuqRRzNJwKLq9ZfhXrPDHizXkuy`
- Preview URL: `https://shaviut-netanya-gs67chf42-robbublils-projects.vercel.app`
- Target: confirmed **`preview`** via `vercel inspect <id>` (concrete server-side record) — `target: preview`, `status: Ready`.
- No Production deployment. No `shaviut-netanya.co.il` domain attachment. No Preview/Production environment variable changes. Deployment Protection and Automation Bypass configuration untouched.

### Protection check
Unauthenticated plain `curl` against the Preview URL:
```
HTTP/1.1 302 Found
Location: https://vercel.com/sso-api?url=...&nonce=...
```
Vercel Authentication intercepted the request as expected. Not bypassed, not disabled, no Automation Bypass secret created/inspected/printed.

### Operator acceptance
STOPPED here per Phase 5 — awaiting the operator's manual test of the five acceptance cases (Weizmann autocomplete dedup, Weizmann 92 valuation, Ben Ami 45 fallback + real addresses, zero-placeholder check, Ben Gurion/Ben Ami alias dedup) in an already-authenticated browser against the Preview URL above. **Superseded mid-acceptance by Wave 0F-3A** (below) — the operator found a new product-trust question before completing this checklist; Wave 0F-3 acceptance remains open, not closed.

---

## Wave 0F-3A — Ben Ami 41 Official-Data Reconciliation

**Investigation-only. No application source, Supabase, or deal data was modified. No importer rerun. No deployment.**

Trigger: on the Wave 0F-3 Preview, "שד עובד בן עמי 41" returned a street-tier estimate (₪1,209,000–₪1,565,000) based on house-2 comparables, badge "אותו רחוב". The operator independently checked nadlan.gov.il and found 5 real transactions recorded at the exact address "עובד בן עמי 41" within the relevant window, all labeled `דירת נופש` (vacation apartment).

### The five official rows, individually reconciled

| # | Date | Price | Area | Rooms | Type (official) | In `data/deals.json`? |
|---|---|---|---|---|---|---|
| 1 | 2024-11-15 | ₪280,000 | 65 m² | — | דירת נופש | **NO** |
| 2 | 2023-06-21 | ₪925,000 | 65 m² | 3 | דירת נופש | **NO** |
| 3 | 2023-05-11 | ₪680,000 | 45 m² | 2 | דירת נופש | **NO** |
| 4 | 2023-04-20 | ₪975,000 | 65 m² | 3 | דירת נופש | **NO** |
| 5 | 2022-06-08 | ₪232,000 | 45 m² | 2 | דירת נופש | **NO** |

**Method (Phase 3):** searched all 12,642 rows in `data/deals.json` for each row by exact `(dealDate, price)` pair, then separately by `(dealDate, areaSqm)` — not by street name at all, specifically to catch a case where these rows were imported under a placeholder (`street: "0"`), a different alias, or a different neighborhoodId. **Zero matches on any of the 5 rows, on either search key.** A genuine date+price collision existing anywhere in a 12,642-row dataset by pure chance is vanishingly unlikely; zero hits across all 5 independently is direct, exhaustive proof of absence — not a classification/mapping error that moved them elsewhere. This is not parity by street name alone (which would not have caught a misfiled row); it's parity by the transaction's own identifying characteristics.

`data/deals.json` has no `gush`/`helka`/parcel-ID field to cross-reference (the raw scrape's `parcelNum`, e.g. `"7992-66-58"` in the repo's `data/debug-raw-deal.json` sample record, is never mapped into `Deal` by `scripts/harvest.ts`'s `normalize()` — a pre-existing, unrelated gap, not something this wave changes), so date+price+area is the strongest identity check available with current data.

### Raw source search (Phase 1)
No separate raw/pre-transform harvest cache exists anywhere in the repository (`data/` contains only the final transformed `deals.json`, plus one unrelated single-record debug sample, `data/debug-raw-deal.json`, for a different address). `scripts/harvest.ts` scrapes nadlan.gov.il live and writes directly into `deals.json`/Supabase — there is no intermediate artifact to search. Result: **RAW_SOURCE_FOUND=NO for all 5 rows** — not because a file was searched and came up empty, but because no such intermediate file has ever existed for this project.

### Import trace — property-type handling (Phase 2)
Traced `scripts/harvest.ts`'s `classify()` (the only place raw `dealNature` becomes a stored `propertyType`):
```ts
function classify(dealNature: string | null): "apartment" | "house" | "land" {
  const s = (dealNature || "").trim();
  if (/מגרש|קרקע|מקרקעין|חקלאי|נחלה/.test(s)) return "land";
  if (/דיר[הת]/.test(s)) return "apartment"; // דירה בבית קומות, דירת גג, דירת גן — לפני בדיקת בית
  ...
}
```
```
IS_VACATION_APARTMENT_SUPPORTED = NO — there is no "vacation apartment" propertyType; Deal.propertyType is only "apartment"|"house"|"land"
IS_VACATION_APARTMENT_MAPPED_TO_APARTMENT = YES — /דיר[הת]/ matches "דירת נופש" (the construct-state "דירת" form is exactly what this regex is written to also catch, per its own comment listing "דירת גג"/"דירת גן")
IS_VACATION_APARTMENT_EXCLUDED = NO
EXCLUSION_RULE = none exists
EXCLUSION_LOCATION = N/A
```
This **structurally rules out** root cause B (importer excludes vacation apartments) — the code provably never excludes by `dealNature`. The raw `dealNature` string is preserved verbatim on the `Deal` (`dealNature: raw.dealNature ?? null`) for display only; nothing in `scripts/harvest.ts` or `lib/valuation.ts` filters on it.

**Confirmed live in our own data**: `דירת נופש`-labeled deals ARE already present and already used as comparables today — the current Ben Ami 41 trace (below) shows two of the top-5 house-2 comparables carry `dealNature: "דירת נופש"` with normal full-market prices (₪23,158/sqm and ₪20,513/sqm). Excluding by `dealNature` categorically would be wrong; some `דירת נופש` transactions are legitimate market comparables.

Also checked: is there a partial-rights/ownership-fraction filter? Yes — `lib/valuation.ts` line 98–103:
```ts
// סף מינימום ₪/מ"ר לפי סוג נכס — מסנן עסקאות חלקיות/זכויות שנדל"ן מפרסם ביחד
// עם עסקאות שוק רגילות (מכירת 25% מדירה, העברות בין קרובים בתמורה סמלית וכו')
const MIN_PPSQM: Record<string, number> = { apartment: 8_000, house: 12_000, land: 800 };
```
applied at `buildComparableDeals()` line 693–695 (`pool = pool.filter(d => d.pricePerSqm == null || d.pricePerSqm >= minPps)`) — to the **displayed comparable pool**, not just the numeric estimate range. Its own comment explicitly names "sale of 25% of an apartment" as the exact scenario it exists to catch. This is a real, pre-existing, already-active safeguard — not something this wave added or needs to add.

### Why the prior "only house numbers 2 and 10" finding was accurate (Phase 5)
```
WHY_WAS_41_ABSENT_FROM_PRIOR_QUERY = the data genuinely does not contain it — proven by the exhaustive
  date+price+area search above, not a classification, alias, or neighborhoodId bug.
```
`scripts/harvest.ts -> harvestByStreets()` (the mode used for this neighborhood, gated by `STREET_MODE_NEIGHBORHOODS`) searches nadlan.gov.il **by street name**, then scrolls to collect everything the site's own street-level result list returns — it does not query per house number, so it can't selectively skip one house number while catching others from the same street-level listing. What is **not provable without a live rerun of the harvester** (explicitly not authorized this wave, and this environment has no network path to nadlan.gov.il to test it) is *why* nadlan.gov.il's own street-level listing didn't surface these 5 rows to the scraper in the first place. The most evidence-consistent hypothesis — offered as a hypothesis, not a proven fact — is that vacation/timeshare-style ("דירת נופש") unit sales in a resort-style building may be indexed or categorized differently on nadlan.gov.il's own site than the standard street-transaction list the harvester reads, such that a direct address-level search (what the operator did manually) surfaces them while the bulk by-street scrape does not. Confirming this would require either a live harvest rerun against this specific street/address or an operator-side comparison of nadlan.gov.il's street-list view vs. its address-search view — both out of this wave's scope.

### Valuation filter trace (Phase 6)
Not applicable in the "data present but filtered" sense — there is nothing to trace. **DATA MISSING**, not **DATA PRESENT BUT INTENTIONALLY NOT COMPARABLE**: all `BUILDING_CANDIDATES`/eligibility fields are 0 because the underlying rows do not exist in `data/deals.json` (or, by the established byte-identical-parity finding from Wave 0B-2/0E-2A, in Supabase) at all — not because any filter (date, property type, room, area, outlier, or partial-rights) rejected a real row. This was not independently re-queried against live Supabase credentials in this session (none are available in this environment, consistent with every prior wave); the exhaustive `data/deals.json` search above is the evidence. Safe read-only operator command for live re-confirmation:
```powershell
$env:DATA_SOURCE = "supabase"
npx tsx -e "import('./lib/store').then(async ({getStore}) => { const all = await getStore().getAllDeals(); const hits = all.filter(d => (d.dealDate==='2024-11-15'&&d.price===280000) || (d.dealDate==='2023-06-21'&&d.price===925000) || (d.dealDate==='2023-05-11'&&d.price===680000) || (d.dealDate==='2023-04-20'&&d.price===975000) || (d.dealDate==='2022-06-08'&&d.price===232000)); console.log('MATCHES=' + JSON.stringify(hits)); });"
```
Expected (if `data/deals.json` parity holds, as proven in every prior wave): `MATCHES=[]`.

### Property-type product-contract question (Phase 7)
```
CURRENT_RULE = דירת נופש transactions are NOT excluded from ordinary apartment valuations — they are classified as
  plain "apartment" and included as comparables like any other, subject only to the MIN_PPSQM price-per-sqm floor.
```
Applying `MIN_PPSQM.apartment = 8,000 ₪/sqm` to the operator's 5 official rows:
```
₪280,000 / 65 m² = ₪4,308/sqm  -> BELOW threshold -> would be filtered (looks like a partial/rights sale)
₪925,000 / 65 m² = ₪14,231/sqm -> ABOVE threshold -> would NOT be filtered
₪680,000 / 45 m² = ₪15,111/sqm -> ABOVE threshold -> would NOT be filtered
₪975,000 / 65 m² = ₪15,000/sqm -> ABOVE threshold -> would NOT be filtered
₪232,000 / 45 m² = ₪5,156/sqm  -> BELOW threshold -> would be filtered
```
```
PRODUCT_RISK = real and evidence-grounded, not hypothetical: 3 of the operator's 5 official "דירת נופש" examples have
  "normal-looking" market prices (₪14–15K/sqm) that the existing partial-rights filter would NOT catch. If a building
  is predominantly vacation/timeshare units (unlike the rest of its street), and some of its transactions are ever
  harvested, the current system has no dealNature-based safeguard — only the price floor — so a meaningfully different
  property category could be silently blended into an "ordinary apartment" valuation. This is not unique to Ben Ami 41;
  it is a general, pre-existing gap in the product contract (present since before this engagement), just newly proven
  concrete by this specific operator report.
```

### Current Ben Ami 41 valuation trace (Phase 8) — local data (proven parity; representative inputs since the operator's exact rooms/area were not captured verbatim — reconstructed as 4 rooms / 100 sqm to match this engagement's established test convention, NOT claimed to be the operator's literal input)
```
TARGET_PROPERTY_TYPE=apartment  TARGET_ROOMS=4 (representative)  TARGET_AREA=100 sqm (representative)
COMP_SEARCH_SCOPE=street
BASED_ON_DEALS=16
ESTIMATE=₪1,622,000 - ₪2,069,000  (differs numerically from the operator's ₪1,209,000–₪1,565,000, consistent with different reconstructed inputs — not claimed to reproduce their exact number)
```
Top comparables (all real, all house 2 on the same street):
```json
{"street":"עובד בן עמי","houseNumber":"2","tier":"street","dealNature":"דירת נופש","price":2200000,"areaSqm":95,"dealDate":"2025-02-12"}
{"street":"עובד בן עמי","houseNumber":"2","tier":"street","dealNature":"דירה בבית קומות","price":1890000,"areaSqm":116,"dealDate":"2022-01-31"}
{"street":"עובד בן עמי","houseNumber":"2","tier":"street","dealNature":"דירה בבית קומות","price":2400000,"areaSqm":117,"dealDate":"2023-12-31"}
{"street":"עובד בן עמי","houseNumber":"2","tier":"street","dealNature":"דירת נופש","price":2400000,"areaSqm":117,"dealDate":"2022-08-09"}
{"street":"עובד בן עמי","houseNumber":"2","tier":"street","dealNature":"דירה בבית קומות","price":1930000,"areaSqm":117,"dealDate":"2021-11-07"}
```
**Why house 2 was used instead of any Ben Ami 41 transaction**: because `BUILDING_CANDIDATES=0` — no house-41 row exists anywhere in the dataset (proven above) — the location hierarchy (building → street → radius → neighborhood, unchanged by this wave) correctly falls through to street tier, which the Wave 0F-2B fix (this session's prior wave) makes reachable at all for this street. This is the fallback mechanism working exactly as designed on the data that genuinely exists — not a bug, and not something this wave changes.

### Trust/confidence gap (Phase 9) — not implemented, documented only
The UI currently presents the **same confident styling** (📐/📍 tier badge, "מבוסס על N עסקאות") whether the true underlying reason for landing on street tier is (3) no exact-building transactions exist in the dataset at all — the proven case here — or any of the other four scenarios (data exists but was rejected as unsuitable; data exists in an unsupported category; etc.). There is currently **no UI signal distinguishing "we found nothing for this exact address" from "we found something and are choosing not to use it."** A user (or an operator manually cross-checking the government registry, as happened here) has no way to tell from the app alone that the street's data may be incomplete for a specific address.

### Root cause (Phase 10)
```
BEN_AMI_41_DATA_ROOT_CAUSE=A — RAW GOVERNMENT ROWS NEVER HARVESTED
```
Proven by exhaustive date+price+area search across the entire 12,642-row dataset (zero matches on all 5 official rows) combined with structural proof that the importer never excludes by property type (ruling out B) and no separate raw-cache artifact exists to search for a "collected but dropped" scenario. The deeper question of why nadlan.gov.il's own street-level listing didn't surface these rows to the scraper is not provable in this environment (no network path to nadlan.gov.il, no harvester rerun authorized) and is reported as an open, evidence-consistent hypothesis, not a proven fact.
```
BEN_AMI_41_VALUATION_TRUST_RISK=MEDIUM
```
Not HIGH: the current output is not proven inaccurate — it is a legitimate, intentional street-tier fallback (Wave 0F-2B) using real, price-sane, honestly-labeled transactions from the same street (including `דירת נופש` rows already filtered/validated by the pre-existing `MIN_PPSQM` safeguard), not corrupted or fabricated data. Not LOW: this wave found a real, evidence-grounded gap — no dealNature-based signal at all, a price-floor filter that would miss 3 of 5 real official examples, and a UI that cannot currently communicate "this exact address has no data of its own" to the user. MEDIUM reflects a proven-real product-contract gap without a proven-real current miscalculation.

### Wave 0F-1 regression
```
NO — this defect is unrelated to street-alias dedup; "עובד בן עמי" and "שד עובד בן עמי" already resolved to the
same neighborhoodId/coordinates before Wave 0F-1 (established in Wave 0F-1's own real-data check), and the absence
of house-41 data is a harvesting-coverage gap, not an alias-resolution defect.
```

### No fix performed
Source changes: NONE. Data writes: NONE. Importer rerun: NO. Deployment: NONE.
