# 05 — Valuation Engine Forensic Audit

> Source: `lib/valuation.ts` (864 lines), `lib/types.ts`, `lib/store.ts`
> Status legend: **VERIFIED** = confirmed by code read + execution; **LIKELY** = inferred from code; **UNKNOWN** = cannot determine without runtime trace

---

## 1. Search Hierarchy — Exact Order

The algorithm has **7 stages**, not 4. Geographic and text paths interleave.

```
geoPool = neighborhood × propertyType × 60 months  [always the base]

[TEXT PATH — runs if streetName provided]
  T1. Exact building  (street name match AND houseNumber parseInt match, ±10yr age)
      → scope = "building"  if ≥ 3 deals
  T2. Near building   (street name match AND |houseNumber| ≤ 12, ±15yr age)
      → scope = "street"   if ≥ 3 deals
  T3. Full street     (street name match, ±15yr age)
      → scope = "street"   if ≥ 3 deals

[CITY-WIDE TEXT FALLBACK — only if scope=neighborhood AND geoPool < 6]
  T4. City-wide building (±12 house numbers, all neighborhoods)
  T5. City-wide street

[GEO PATH — runs if streetX/Y provided AND scope not yet set to building/street]
  G1. Building radius (≤ 60 m, street-name double-check, ±10yr age)
      → scope = "building"  if ≥ 3 deals
  G2. Street radius   (≤ 350 m, ±15yr age)
      → scope = "radius"   if ≥ 5 deals (MIN_DEALS_FOR_FLOOR_FILTER)
  G3. Expanded radius (≤ 500 m, ±20yr age)
      → scope = "radius"   if ≥ 5 deals
  G4. Cross-neighborhood geo (500/750/1000 m across city, all neighborhoods)
      → scope = "radius"   if ≥ 3 deals with ≥ 3 valid ppsqm

[FLOOR & AREA REFINEMENT — applied after scope is determined]
  F1. Floor filter: ±2 floors (apartments only, kept only if ≥ 5 deals remain)
  F2. Area filter:  ±50% of input areaSqm (kept only if ≥ 3 deals remain)
```

Source: lines 164–396 (`valuation.ts`)  **VERIFIED**

---

## 2. Every Filter, In Order

| Step | Filter | Threshold to apply | Min deals to keep filter |
|------|--------|-------------------|--------------------------|
| 1 | propertyType match | always | — |
| 2 | dealDate ≥ cutoff (60 months for geo, 6→48 months for neighborhood) | always | ≥ 3 (MIN_DEALS_FOR_ESTIMATE) |
| 3 | rooms ±1 | only if ≥ 6 deals result (MIN_DEALS_FOR_ROOM_FILTER) | 6 |
| 4 | yearBuilt ±10/15/20 yr (by scope level) | only if ≥ 3 deals remain | 3 |
| 5 | Text or geo scope selection (7 stages above) | depends on scope | 3 or 5 |
| 6 | floor ±2 (apartments only) | applied after scope | 5 (MIN_DEALS_FOR_FLOOR_FILTER) |
| 7 | areaSqm ±50% | applied after floor | 3 (MIN_DEALS_FOR_ESTIMATE) |
| 8 | pricePerSqm ≥ MIN_PPSQM | always at percentile computation | — |

**VERIFIED** — lines 90–402

---

## 3. Minimum Sample Requirements

| Constant | Value | Purpose |
|----------|-------|---------|
| `MIN_DEALS_FOR_ESTIMATE` | 3 | Minimum valid ppsqm values to compute a range |
| `MIN_DEALS_FOR_ROOM_FILTER` | 6 | Minimum deals needed before applying the ±1 room filter |
| `MIN_DEALS_FOR_FLOOR_FILTER` | 5 | Minimum deals needed to apply floor filter; also minimum for geo street/radius |
| `MIN_COMPOSITE_DEALS` | 6 | Minimum to use composite house model; falls back to neighborhood pool |
| `MIN_COMPARABLES` | 3 | Minimum for display comparables list |

**VERIFIED** — lines 90–94 and 578

---

## 4. Percentile Ranges by Scope

| Scope | Low | High | Rationale |
|-------|-----|------|-----------|
| `building` | P20 | P80 | Same building — conditions identical, wide band allowed |
| `street` | P25 | P75 | Same street — closer than neighborhood |
| `radius` | P33 | P67 | Geographic area, more variation expected |
| `neighborhood` | P33 | P67 | Widest uncertainty |

Mid estimate = P50 at all levels.

**VERIFIED** — lines 443–448

---

## 5. Composite Model for Houses (the 0.4 coefficient)

**Formula:** `composite_size = areaSqm + 0.4 × plotSqm`  
**Source of 0.4:** Comment at line 461 says `"קרקע שווה פחות למ"ר מבנוי"` (land worth less per sqm than built area). **No empirical derivation or external source is cited.** This is an engineering heuristic. **LIKELY** calibrated by inspection of Netanya data.

**Trigger condition:** `propertyType === "house" AND input.plotSqm != null AND input.plotSqm > 0`  
If the user does not provide `plotSqm`, composite is NOT used and the system falls back to simple `ppsqm × areaSqm`.

**Process:**
1. For each deal in the pool, compute `price / (areaSqm + 0.4 × plotSqm)` → composite ppsqm
2. Deals with `pricePerSqm < 12,000` are excluded (using built-area ppsqm as proxy filter)
3. If fewer than 6 composite values in the local pool → expand to full neighborhood `geoPool`
4. Apply P25/P50/P75 to composite ppsqm values (always, regardless of scope)
5. Sanity check: if `estMid / areaSqm > 40,000 ₪/sqm` → composite result is unreliable, fall back to simple model

**Inconsistency found:** The `sizeDistance()` function (used for comparable ranking) uses `0.55 × built + 0.45 × plot` (different weighting from the 0.4 used in valuation). This means comparable ranking and valuation use different models. **VERIFIED** — lines 557–566 vs 462–466.

**Real-world impact of plotSqm=null:** In actual data, 371 of 391 house deals (95%) have `plotSqm = null`. The composite model almost never activates. **VERIFIED** — confirmed by querying deals.json.

---

## 6. Temporal Handling

**There is no temporal weighting.** A deal from January 2021 and a deal from May 2026 are treated identically in the percentile calculation if both fall within the 60-month window.

The only time-based mechanism is the hard cutoff:
- Geographic search: 60-month cutoff (`GEO_MONTHS = 60`)
- Neighborhood fallback: tries 6 → 12 → 24 → 48 months (uses shortest window with ≥ 3 deals)

**Implication:** In a rising or falling market, the P50 estimate will lag market direction. If the last 24 months rose 20% vs the prior 36 months, those older deals equally suppress the estimate. The `priceTrend` field exposes the trend to the user but does not adjust the valuation. **VERIFIED** — confirmed by absence of any weighting logic in lines 398–453.

---

## 7. Floor Adjustment Logic

```
if propertyType === "apartment" AND input.floor != null:
    filtered = deals.filter(|d.floor - input.floor| <= 2)
    if filtered.length >= 5:
        deals = filtered
        floorAdjusted = true
```

- Only for apartments (not houses, not land — houses typically have `floor=null`)
- FLOOR_TOLERANCE = ±2
- Threshold: 5 deals (MIN_DEALS_FOR_FLOOR_FILTER)
- Applied **before** area filter
- `floorAdjusted = true` is exposed in the response

**VERIFIED** — lines 372–385

---

## 8. Area Tolerance Logic

```
if sizeInput != null AND sizeInput > 0 AND propertyType != "land":
    areaMin = sizeInput × 0.5
    areaMax = sizeInput × 1.5
    filtered = deals.filter(d.areaSqm in [areaMin, areaMax])
    if filtered.length >= 3:
        deals = filtered
```

- AREA_TOLERANCE_RATIO = 0.5 → ±50% of input
- For a 100 sqm apartment: includes deals from 50–150 sqm
- For land: filter is **not applied** (skipped by the `ptype !== "land"` guard)
- Applied **after** floor filter
- Uses `areaSqm` (built area) for both apartments and houses — not `plotSqm`

**Interaction with floor filter:** Floor filter uses `MIN_DEALS_FOR_FLOOR_FILTER = 5` but area filter uses `MIN_DEALS_FOR_ESTIMATE = 3`. Scenario: 6 deals after floor filter → area filter could reduce to 3 → still valid. But if floor filter was NOT applied (left 20 deals) and area filter reduces to 2 → `ppsqm.length < MIN_DEALS_FOR_ESTIMATE` → valuation returns `null`. The area filter is the final safety gate. **VERIFIED** — lines 387–402.

---

## 9. MIN_PPSQM Filtering

| Property Type | Minimum ₪/sqm | Rationale (from comments) |
|---------------|---------------|--------------------------|
| `apartment` | 8,000 | Market floor in Netanya ~12K; 8K provides safety margin |
| `house` | 12,000 | P25 of real market transactions ~13,500K |
| `land` | 800 | Agricultural land → lower floor |

**Applied at three points:**
1. Main ppsqm array (line 400): `d.pricePerSqm >= minPpsqm` before percentile computation
2. Composite model (line 480): `d.pricePerSqm < minPpsqm → null` — using built-area ppsqm as proxy even for composite
3. Cross-neighborhood fallback check (line 360): `inRPps.length >= MIN_DEALS_FOR_ESTIMATE`
4. Display deals (line 685): `d.pricePerSqm >= minPps` before showing comparables

**Purpose:** Filters out partial ownership transfers, symbolic transfers between relatives, and subsidized housing sales that appear in the public tax authority records alongside market transactions.

**VERIFIED** — lines 99–104, 400, 480, 685

---

## 10. priceTrend Calculation

```
Input:  last 24 months of neighborhood deals (same propertyType)
Process:
  1. Group deals by calendar quarter (YYYY-Qq)
  2. Compute P50 (median) ppsqm per quarter
  3. Filter quarters with ppsqm > 0
  4. Sort chronologically
  5. Require ≥ 3 quarters (else return null)
  6. Require ≥ 8 deals total (else return null)
  7. changePct = (last_quarter_ppsqm - first_quarter_ppsqm) / first × 100
  8. months = number_of_quarters × 3

Return: { points: [{label, ppsqm}], changePct, months }
```

**Limitations:**
- Uses only 24 months (not the full 60-month geo pool)
- `months` is approximate (`quarters × 3`), not actual span from first to last date
- A single outlier deal can dominate a quarter with 1 transaction
- `changePct` measures first-to-last, not a regression slope — noisy with few data points

**VERIFIED** — lines 822–845

---

## Critical Findings

### BUG 1 (CRITICAL — VERIFIED): Coordinate Collision Destroys Geographic Search

All 12,642 deals share only **21 distinct x,y coordinate pairs** — one per neighborhood centroid. Every deal in a given neighborhood has **exactly the same coordinates**.

```
Distinct x,y coordinate pairs: 21
Deals sharing coords with >10 others: 12,642 / 12,642 = 100%
Example: x=186965.0, y=693532.0 → מרכז העיר צפון: 3,010 deals (all same point)
```

**Consequence:** The geographic radius filters (`BUILDING_RADIUS=60m`, `STREET_RADIUS=350m`, `COMP_RADIUS_LADDER=[500m]`) all compute distance = 0 between every deal in the same neighborhood. The `filterByRadius(60)` call returns ALL located deals in the neighborhood, not just nearby ones.

The entire geographic hierarchy (G1–G3 above) is **effectively nonfunctional** as a proximity filter. All geographic searches degrade to neighborhood-wide searches.

**What saves the valuation:** The text-based path (T1–T3) runs first and uses street name + house number matching. Since most queries provide a street name, the text path finds the correct deals without needing real coordinates. The geo path is redundant when the text path succeeds, and collapses to neighborhood-wide when text fails.

**VERIFIED** — confirmed by querying deals.json: only 21 distinct x,y groups

---

### BUG 2 (SIGNIFICANT — VERIFIED): Scope Mislabeling for Non-Numeric House Numbers

When `input.houseNumber` cannot be parsed to an integer (e.g., "12א", "5/ב"):
- `byExactBuilding()` returns the **entire street** (line 202: `if (isNaN(hn)) return onStreet`)
- `byBuildingNumber()` also returns the **entire street** (line 214: `if (isNaN(hn)) return onStreet`)
- If the street has ≥ 3 deals, the scope is set to `"building"` with the entire street's deals

**Result:** A non-numeric house number causes ALL street deals to be labeled as a "building" match, applying P20/P80 percentiles (wider range) instead of the correct P25/P75 (street). The `compSearchScope` field returned to the user incorrectly says `"building"`.

**VERIFIED** — lines 197–219

---

### BUG 3 (MODERATE — VERIFIED): Unlocated Deals Appended Unconditionally

At lines 306, 319, 334:
```typescript
deals = inBuilding.concat(unlocated);
deals = onStreet.concat(unlocated);
deals = within.concat(unlocated);
```

All deals in the neighborhood with `x == null || y == null` are concatenated to every geographic result, regardless of their actual address. These "unlocated" deals may be from any street or building in the neighborhood. They dilute the geographic precision of the geographic search path.

**VERIFIED** — lines 274–337

---

### BUG 4 (MODERATE — VERIFIED): No Temporal Weighting

Deals from 60 months ago count equally with recent deals. In a market that has risen or fallen significantly in the past 5 years, the P50 estimate will be biased toward historical prices. The `priceTrend` field shows users the trend but the estimate itself is not adjusted.

**VERIFIED** — confirmed by absence of any time-based weight in the percentile calculation

---

### BUG 5 (MINOR — LIKELY): Duplicate Transactions in Source Data

The source data (tax authority / nadlan.gov.il) contains what appear to be duplicate records — the same transaction filed more than once with identical price, date, and area but different database IDs. Example from קריית צאנז, הרב ברוך הלברשטם 1: multiple identical prices on the same date (2023-04-29: two records at ₪1,500,000 for 108 sqm).

If these are true duplicates (same transaction reported twice), they inflate the pool size and double-weight the duplicated price in the percentile calculation.

**Status: LIKELY** — patterns observed in data; true deduplication requires cross-referencing gush-chelka numbers not available in this audit.

---

### FINDING 6 (VERIFIED): Composite Model Coefficient Inconsistency

The valuation model uses `PLOT_WEIGHT = 0.4` for composite size.  
The comparable ranking function `sizeDistance()` uses `0.55 × built + 0.45 × plot`.

These are different weightings for the same conceptual "how big is this property" calculation. The comparables shown to the user are ranked by a different formula than the one used to compute their estimated value. This could cause the displayed comparables to seem inconsistent with the range.

**VERIFIED** — lines 462 vs 562–565

---

### FINDING 7 (VERIFIED): Display Augmentation Can Add Deals Outside the Valuation Pool

The "city-wide exact-building augmentation" (lines 404–439) adds deals from other neighborhoods to `displayDeals` for UI purposes. These deals are NOT included in the `ppsqm` array used for the valuation range — only in the comparable deals shown to the user. This means the UI may show deals that are NOT the basis for the estimated range, which could mislead the user about where the numbers come from.

**VERIFIED** — lines 404–439: `displayDeals` vs `deals` are separate variables
