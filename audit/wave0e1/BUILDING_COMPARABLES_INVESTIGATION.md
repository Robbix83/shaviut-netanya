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
