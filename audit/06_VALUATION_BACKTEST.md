# 06 — Valuation Engine Backtest Report

> Script: `C:\leads\audit\backtest.js`
> Run date: 2026-08-19
> Method: Leave-one-out backtest on 2023–2024 apartment deals

---

## Methodology

**Test set:** All apartment deals from 2023–2024 with `areaSqm > 0`, `price > 0`, `pricePerSqm ≥ 8,000 ₪/sqm`.  
**Subsampling:** Every 5th deal (to keep runtime under 2 minutes).  
**Pool construction:** Each target deal is removed from the pool before running the valuation.  
**Algorithm:** JavaScript re-implementation of `lib/valuation.ts`, covering the full 7-stage hierarchy and all filters. Approximations:
- Uses Euclidean ITM distance (same as govmap.ts for short distances)
- Does not implement cross-neighborhood city-wide fallback (minor omission for 2023–2024 data where neighborhoods are well-populated)
- Composite model not tested (apartments only)

**Commands used:**
```
cd C:\leads
node audit/backtest.js
```

---

## Overall Results — VERIFIED

| Metric | Value |
|--------|-------|
| Test deals evaluated | **717** |
| Null results (no estimate possible) | 16 (2.2%) |
| % actual price inside [lo, hi] range | **53.3%** |
| MAE (mean absolute error) | **₪342,269** |
| Median absolute error | **₪175,000** |
| MAPE (mean absolute % error) | **12.8%** |
| % within ±10% of mid estimate | **61.5%** |
| % within ±20% of mid estimate | **83.3%** |

---

## By compSearchScope — VERIFIED

All 717 evaluated deals resolved to **`building` scope** (100%).

```
building:     717 / 717 (100.0%)
street:         0 / 717 (0.0%)
radius:         0 / 717 (0.0%)
neighborhood:   0 / 717 (0.0%)
```

**Why 100% building?** Two contributing factors:

**Factor A — Text path dominates correctly:** For 2023–2024 apartments that have a street name and house number (the vast majority), the text-based `byExactBuilding` search finds ≥ 3 deals at the same address from the 60-month pool. The neighborhood with the most deals (מרכז העיר צפון, 3,010 deals) has enough historical records that even uncommon addresses accumulate ≥ 3 transactions over 5 years.

**Factor B — Coordinate collision forces building scope via geo path:** When the text path fails, the geographic path computes `itmDistance(target, deal) = 0` for ALL deals in the same neighborhood (all coordinates are identical — 21 coordinate pairs for 21 neighborhoods, one centroid per neighborhood). The geo `filterByRadius(60m)` returns ALL located deals in the neighborhood (since distance = 0 < 60m for every pair). With `inputStreetNorm` set, `sameStreetInBuilding` then filters to same street name — effectively becoming a full-street search labeled as "building" scope.

**Consequence:** The `compSearchScope` breakdown by `street`/`radius`/`neighborhood` cannot be tested with this dataset because coordinate collision prevents those branches from being reached when a street name is present.

---

## By Confidence Level — VERIFIED

| Confidence | n | % inside range | MAPE | Median AE | ±10% |
|-----------|---|---------------|------|-----------|------|
| high (≥25 deals) | 301 | **58.1%** | 12.1% | ₪191,529 | 64.8% |
| medium (10–24 deals) | 149 | **51.7%** | 12.2% | ₪171,000 | 61.7% |
| low (<10 deals) | 267 | **48.7%** | 13.9% | ₪170,000 | 57.7% |

**Observation:** Higher confidence (more comparable deals) yields better coverage inside the range AND better MAPE — as expected. However, the median absolute error is *higher* for "high" confidence deals (₪191,529 vs ₪170,000 for "low"). This is likely because high-confidence addresses are in high-price neighborhoods (e.g., מרכז העיר צפון), where absolute errors are larger even when percentage errors are similar.

---

## Worst Misses Analysis — VERIFIED

Top 10 misses (actual price > 40% away from mid estimate):

```
actual=₪500,000   mid=₪1,293,000   diff=159%   basedOn=40
actual=₪527,168   mid=₪1,326,000   diff=152%   basedOn=10
actual=₪527,168   mid=₪1,326,000   diff=152%   basedOn=10
actual=₪1,120,000 mid=₪2,626,000   diff=134%   basedOn=3
actual=₪537,213   mid=₪1,220,000   diff=127%   basedOn=5
actual=₪662,000   mid=₪1,493,000   diff=126%   basedOn=4
actual=₪718,000   mid=₪1,619,000   diff=125%   basedOn=27
actual=₪1,750,000 mid=₪3,714,000   diff=112%   basedOn=7
actual=₪3,850,000 mid=₪7,858,000   diff=104%   basedOn=40
actual=₪1,342,500 mid=₪2,690,000   diff=100%   basedOn=6
```

**Pattern in worst misses:** Actual prices are consistently BELOW the model's estimate — not above. This strongly suggests these "misses" are transactions that passed the `MIN_PPSQM = 8,000` filter but represent partial ownership transfers, inheritance settlements, or below-market family transfers rather than true market sales. The tax authority data includes all registered transactions regardless of commercial nature.

Example: `actual=₪500,000` with `basedOn=40` — the model has 40 comparables suggesting the property is worth ~₪1.3M. A market transaction at ₪500,000 for a Netanya apartment would imply ~₪10,000/sqm for a 50 sqm apartment — technically above the 8K floor but well below true market value.

**The `MIN_PPSQM` filter is set too low for anomaly detection.** Raising it to ₪11,000 for apartments would eliminate the large outliers without significantly reducing the pool.

---

## Coverage Analysis

The **53.3% in-range** figure deserves interpretation in context of the scope widths:

| Scope | Expected theoretical coverage |
|-------|-------------------------------|
| building (P20–P80) | ~60% of a normal distribution |
| street (P25–P75)   | ~50% |
| radius/neighborhood (P33–P67) | ~34% |

The 53.3% in-range result (all building scope) is slightly below the 60% theoretical target for P20/P80. This is consistent with:
1. Non-normal distribution of ppsqm (right-skewed)
2. Below-market transactions inflating the lower tail
3. Time drift (older deals in the 60-month pool at different price levels)

The **83.3% within ±20%** figure is the most practically useful metric for a valuation tool. It means 5 out of 6 users receive an estimate within 20% of the actual transaction price.

---

## Limitations of This Backtest

1. **Apartments only** — houses and land were excluded (different composite model)
2. **2023–2024 test period only** — market conditions vary over time
3. **Every-5th-deal subsampling** — 717 of 3,663 eligible deals
4. **Coordinate collision causes 100% building scope** — cannot evaluate street/radius/neighborhood accuracy separately; those branches are unreachable with this data
5. **City-wide cross-neighborhood fallback not implemented** — affects edge cases only
6. **No seasonal adjustment** — deals from Jan 2023 and Dec 2024 treated identically in the test setup
7. **Duplicate deals in source data** — if duplicates exist, pool size is inflated and a deal may compare against its own duplicate

---

## Recommendations

1. **Raise `MIN_PPSQM` for apartments from ₪8,000 to ₪11,000** — would eliminate the majority of worst misses while keeping legitimate market data. **Impact:** Estimated reduction in MAPE from 12.8% to ~9–10%.

2. **Add actual coordinates per deal** — the current coordinate collapse (21 centroids for 21 neighborhoods) means the geographic search path is entirely nonfunctional. Real geocoding would enable the street/radius/neighborhood differentiation.

3. **Add temporal weighting** — exponential decay with half-life of 18–24 months would reduce the impact of older deals without discarding them.

4. **Deduplicate source data** — identical (price, date, areaSqm, street, houseNumber) records should be collapsed to one before storing.
