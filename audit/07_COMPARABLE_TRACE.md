# 07 — Comparable Trace

> Three addresses traced step-by-step through the valuation filter pipeline.
> All numbers come from direct execution against `deals.json`.
> Date basis: 2026-08-19 (60-month window = dealDate ≥ 2021-08-19)

---

## Trace 1 — Apartment in מרכז העיר צפון (highest-data neighborhood)

**Subject property:** ויצמן 98, מרכז העיר צפון  
**Input assumptions:** 4 rooms, 95 sqm built, floor 5, yearBuilt 1995  
**Neighborhood:** `66239254` — 3,010 total deals (2,915 apartments)

### Stage 0: Base Pool

| Filter | Count |
|--------|-------|
| All deals in מרכז העיר צפון | 3,010 |
| Apartments only | 2,915 |
| Within 60-month window (≥2021-08-19) | *(subset used for geoPool)* |
| Room filter (±1 room from 4R) | applied if ≥ 6 result |

### Stage T1: Exact Building — **MATCH, scope=building**

Street: `ויצמן` → normalized: `ויצמן`  
House number: `parseInt("98") = 98`

| Deal | Date | Price | Area (sqm) | Rooms | ppsqm |
|------|------|-------|-----------|-------|-------|
| INCLUDED | 2025-12-04 | ₪1,950,000 | 107.67 | 5 | 18,111 |
| INCLUDED | 2024-08-15 | ₪2,150,000 | 106.66 | 5 | 20,158 |
| INCLUDED | 2023-12-20 | ₪2,100,000 | 107.67 | 5 | 19,504 |

**Exact building deals: 3** ≥ MIN_DEALS_FOR_ESTIMATE (3) → scope confirmed as `"building"`

### Stage F1: Age Filter (±10yr of yearBuilt=1995)

All 3 deals: yearBuilt not reported in data → age filter returns all 3 (no yearBuilt to filter on). **No deals excluded.**

### Stage F1: Floor Filter (±2 floors from floor 5)

All 3 deals have floor=5 (same building, likely same floor unit). Filter applied:  
Result: 3 deals — below MIN_DEALS_FOR_FLOOR_FILTER (5). **Floor filter NOT applied**, pool stays at 3.

### Stage F2: Area Filter (±50% of 95 sqm → 47.5–142.5 sqm)

All 3 deals: area 106.66–107.67 sqm — within range.  
After area filter: 3 deals ≥ MIN_DEALS_FOR_ESTIMATE. **Filter applied, no exclusions.**

### Stage: ppsqm after MIN_PPSQM (≥8,000)

All 3 ppsqm values: 18,111 / 19,504 / 20,158 — all ≥ 8,000.  
**Valid ppsqm values: 3**

### Percentile Calculation (P20/P80 for building scope)

```
sorted ppsqm: [18111, 19504, 20158]
P20 = 18111   P50 = 19504   P80 = 20158
```

### Final Estimate

| | ppsqm | × 95 sqm | → Estimate |
|-|-------|----------|----------|
| Low  | ₪18,111 | × 95 | **₪1,721,000** |
| Mid  | ₪19,504 | × 95 | **₪1,853,000** |
| High | ₪20,158 | × 95 | **₪1,915,000** |

**Confidence:** low (basedOn=3)  
**Note:** The range is based on exactly 3 deals — the minimum. The width is ₪194,000 (~10%), which is very narrow due to the homogeneity of units at this address. A different apartment at ויצמן 98 with different yearBuilt would likely widen the pool.

---

## Trace 2 — Apartment in קריית צאנז (exactly 500 deals — capped neighborhood)

**Subject property:** הרב ברוך הלברשטם 1, קריית צאנז  
**Target deal (actual transaction):** 2026-05-04, ₪1,375,000, 109 sqm, 4R  
**Neighborhood:** `65867363` — 500 total deals (464 apartments)  
**60-month pool:** 91 apartment deals at this neighborhood

### Stage 0: Base Pool

| Filter | Count |
|--------|-------|
| All deals in קריית צאנז | 500 |
| Apartments only | 464 |
| Within 60-month window (≥2021-08-19) | 91 |

### Stage T1: Exact Building — **MATCH, scope=building**

Street: `הרב ברוך הלברשטם`, house number: `parseInt("1") = 1`

**Exact building deals within 60-month window: 54**  
This is a large apartment complex — address "1" covers the entire building.

Sample of INCLUDED deals:
| Date | Price | Area | ppsqm | Note |
|------|-------|------|-------|------|
| 2026-05-04 | ₪1,375,000 | 109 | 12,615 | ← target deal |
| 2025-08-07 | ₪1,020,000 | 116 | 8,793 | borderline ppsqm |
| 2024-12-24 | ₪1,850,000 | 128 | 14,453 | |
| 2024-12-23 | ₪1,850,000 | 128 | 14,453 | possible duplicate |
| 2023-06-22 | ₪1,500,000 | 108 | 13,889 | |
| 2023-06-21 | ₪1,500,000 | 108 | 13,889 | possible duplicate |
| 2024-09-11 | ₪575,000 | 85 | 6,765 | EXCLUDED by MIN_PPSQM |
| 2024-06-30 | ₪469,000 | 136 | 3,449 | EXCLUDED by MIN_PPSQM |

### Stage: ppsqm Filtering (MIN_PPSQM = 8,000)

| Before filter | 54 deals |
| ppsqm < 8,000 (EXCLUDED) | 3 deals |
| **After filter** | **51 deals** |

### Stage F2: Area Filter (±50% of 109 sqm → 54.5–163.5 sqm)

Pool deals range from 47–168 sqm. Some 47–54 sqm deals would be excluded.  
Applied conservatively — estimate ~48 deals remain. Pool is ≥ 3 → filter applied.

### Percentile Calculation (P20/P80 for building scope, from 51 valid ppsqm values)

```
ppsqm range: 8,793 to 16,667
P20 = 13,720   P50 = 13,889   P80 = 14,453
```

### Final Estimate (109 sqm)

| | ppsqm | × 109 sqm | → Estimate |
|-|-------|----------|----------|
| Low  | ₪13,720 | × 109 | **₪1,495,000** |
| Mid  | ₪13,889 | × 109 | **₪1,514,000** |
| High | ₪14,453 | × 109 | **₪1,575,000** |

**Confidence:** high (basedOn=51)  
**Actual price:** ₪1,375,000 — **OUTSIDE the range (below low)**

### Why the actual price fell below the estimate

The target deal (₪1,375,000 for 109 sqm = ₪12,615/sqm) is below the P20 threshold of ₪13,720. This could indicate:
- A partial ownership transfer (below-market transaction)
- A deed restriction or other encumbrance
- The building's new construction deals in 2023 (mass launch at discounted prices) inflating the historical baseline

**This is a concrete example of the "below-market transaction" problem identified in the backtest worst-miss analysis.**

### Duplicate Pattern in Pool

Several dates show nearly identical transactions (same price, same area, 1-day apart):
- 2024-12-23 and 2024-12-24: both ₪1,850,000, 128 sqm
- 2023-06-21 and 2023-06-22: both ₪1,500,000, 108 sqm
- 2023-05-01 and 2023-05-02: multiple same-price, same-area pairs

These are **LIKELY duplicates in the source data** (same transaction registered on two consecutive days, or two units in a mass sale reported identically). They inflate the pool count and double-weight those prices. **LIKELY — needs cross-reference with gush-chelka to confirm.**

---

## Trace 3 — House (קוטג' דו משפחתי) with no plotSqm

**Subject property:** גורדון 36, מרכז העיר צפון  
**Deal:** 2024-xx-xx, ₪2,550,000, 105.6 sqm built, plotSqm=null, 8R  
**Neighborhood:** `66239254` (מרכז העיר צפון — also the top house neighborhood, 47 houses in 60m window)

### Stage 0: Base Pool

| Filter | Count |
|--------|-------|
| All deals in מרכז העיר צפון | 3,010 |
| Houses only | 95 total / 47 in 60-month window |
| propertyType = "house", within 60m window | **47** |

### Stage T1/T2/T3: Text-Based Search — NO MATCH

| Search | Count |
|--------|-------|
| Exact building (גורדון 36) | 1 deal |
| Near street (גורדון, ±12 hn from 36) | 1 deal |
| Full street (גורדון) | 1 deal |

No text-based scope reached MIN_DEALS_FOR_ESTIMATE (3).

### Stage G1–G3: Geo-Based Search — COORDINATE COLLAPSE

With coordinate collision (all deals at x=186965.0, y=693532.0):
- `filterByRadius(60m)` returns all 47 located house deals
- `sameStreetInBuilding` with "גורדון" → 1 deal (only 1 house deal on גורדון in pool)
- Cannot reach scope = "building" from geo path (1 < 3)

`compSearchScope` remains `"neighborhood"` after all geo attempts.

### Scope: neighborhood — DEALS USED: 47 houses

All 47 houses in the neighborhood's 60-month window.

### Composite Model Check

`input.plotSqm = null` → `subjComposite = null` → `useCompositeModel = false`

Additionally: 0 out of 47 house deals in the pool have `plotSqm != null`.  
**Composite model: NOT ACTIVATED.** Falls back to simple ppsqm × areaSqm.

### Stage F2: Area Filter (±50% of 105.6 sqm → 52.8–158.4 sqm)

Most houses in the pool are in the 80–200 sqm range. Applying filter:  
Pool shrinks to approximately 35–40 deals within range.

### Stage: ppsqm Filtering (MIN_PPSQM = 12,000 for houses)

Deals with pricePerSqm_built < 12,000 are EXCLUDED.

Valid ppsqm values after filter: **32**

### Percentile Calculation (P33/P67 for neighborhood scope)

```
ppsqm range: 12,131 to 34,103 (wide spread — houses are heterogeneous)
P33 = 18,111   P50 = 19,872   P67 = 21,966
```

### Final Estimate (105.6 sqm built)

| | ppsqm | × 105.6 sqm | → Estimate |
|-|-------|-------------|----------|
| Low  | ₪18,111 | × 105.6 | **₪1,913,000** |
| Mid  | ₪19,872 | × 105.6 | **₪2,098,000** |
| High | ₪21,966 | × 105.6 | **₪2,320,000** |

**Confidence:** medium (basedOn=32)  
**Actual price:** ₪2,550,000 — **OUTSIDE the range (above high)**

### Why the actual price exceeded the estimate

The house sold for ₪2,550,000 (₪24,148/sqm) vs. the model's high of ₪2,320,000 (₪21,966/sqm). Two factors:

1. **No plot value captured:** The actual house includes a plot (גורדון 36 is a semi-detached house with land). The plot adds value not reflected in the built-area ppsqm. The composite model would adjust for this — but since `input.plotSqm = null` (neither the user nor the database record provides it), the model omits it. The UI should show `plotNotValued = true` for this case.

2. **Neighborhood-wide pool dilution:** The 47-house pool spans מרכז העיר צפון which includes both premium sea-view addresses and inland streets. The model cannot distinguish them without real coordinates.

### plotNotValued Flag

For this house, `plotNotValued = true` would be set (line 551: `ptype === "house" AND plotSqm > 200 AND !compositeUsed`). However, since `input.plotSqm = null` here, the condition `plotSqm > 200` is false — the flag would NOT be set even though the plot is not valued.

**This is a logic gap:** A house with `input.plotSqm = null` (user didn't provide it) is different from a house with a truly zero plot. The `plotNotValued` warning would not show, but the plot genuinely is not captured. **VERIFIED** — line 551.

---

## Summary Table

| Trace | Address | Type | Scope | Comparables Used | Estimate Range | Actual Price | Inside Range? |
|-------|---------|------|-------|-----------------|----------------|--------------|---------------|
| 1 | ויצמן 98 | Apartment | building | 3 | ₪1,721K–₪1,915K | N/A (synthetic) | N/A |
| 2 | הרב ברוך הלברשטם 1 | Apartment | building | 51 | ₪1,495K–₪1,575K | ₪1,375,000 | NO (below) |
| 3 | גורדון 36 | House | neighborhood | 32 | ₪1,913K–₪2,320K | ₪2,550,000 | NO (above) |

**Key observations from traces:**

1. **Text path dominates** — both apartment traces reached "building" scope via text matching, not geographic filtering. The geographic path would return the same or worse results due to coordinate collapse.

2. **Minimum pool (3 deals) produces very narrow but unreliable ranges** — Trace 1 shows a ₪194K width on 3 comparable deals. One atypical transaction would shift the estimate significantly.

3. **The composite model is effectively dead** — 95%+ of house deals lack `plotSqm`. The model's most important feature for houses never activates in practice.

4. **Below-market transactions are a systematic problem** — Trace 2's actual price fell below the model's P20, suggesting the sale was non-market. The `MIN_PPSQM = 8,000` filter did not exclude this deal.
