# 03 DATA QUALITY AUDIT
**File:** `data/deals.json`  
**Total deals:** 12,642  
**Audit date:** 2026-08-19  
**Method:** All numbers from live `node -e` execution against the actual file.

---

## 1. Per-Neighborhood Deal Count (all 21)

| # | Neighborhood (Hebrew) | Neighborhood ID | Count | At cap? |
|---|---|---|---|---|
| 1 | מרכז העיר צפון | 66239254 | 3,010 | — (street-mode harvest) |
| 2 | קריית צאנז | 65867363 | 500 | YES |
| 3 | גבעת האירוסים | 65867396 | 500 | YES |
| 4 | משכנות זבולון | 65867903 | 500 | YES |
| 5 | נוף הטיילת | 66239231 | 500 | YES |
| 6 | נאות הרצל | 66239239 | 500 | YES |
| 7 | נאות גנים | 66239240 | 500 | YES |
| 8 | קריית השרון | 66239241 | 500 | YES |
| 9 | אגמים | 66239255 | 500 | YES |
| 10 | קריית רבין | 66239257 | 500 | YES |
| 11 | עין התכלת | 66239259 | 500 | YES |
| 12 | עיר ימים | 66239260 | 500 | YES |
| 13 | רמת חן | 67468648 | 500 | YES |
| 14 | מרכז העיר דרום | 67468658 | 500 | YES |
| 15 | רמת אפרים | 66239237 | 498 | near |
| 16 | נוף השרון | 66239287 | 498 | near |
| 17 | פרדס הגדוד | 66239285 | 493 | near |
| 18 | כוכב הצפון | 66239286 | 493 | near |
| 19 | קריית נורדאו | 66239243 | 490 | near |
| 20 | נאות שקד | 65867837 | 455 | no |
| 21 | נווה איתמר | 65867357 | 205 | no |

**VERIFIED** — 14 of 21 neighborhoods hit exactly 500.  
**VERIFIED** — Deals are grouped contiguously by neighborhood (20 transitions for 21 groups), then sorted by `dealDate` descending within each neighborhood.

---

## 2. Deal Counts by Year

| Year | Deals | Year | Deals |
|---|---|---|---|
| 1998 | 37 | 2013 | 147 |
| 1999 | 30 | 2014 | 166 |
| 2000 | 29 | 2015 | 208 |
| 2001 | 33 | 2016 | 201 |
| 2002 | 35 | 2017 | 135 |
| 2003 | 23 | 2018 | 158 |
| 2004 | 66 | 2019 | 199 |
| 2005 | 66 | 2020 | 406 |
| 2006 | 48 | 2021 | 1,120 |
| 2007 | 55 | 2022 | 1,749 |
| 2008 | 97 | 2023 | 1,478 |
| 2009 | 83 | 2024 | 2,556 |
| 2010 | 85 | 2025 | 2,472 |
| 2011 | 69 | 2026 | 798 |
| 2012 | 93 | | |

**VERIFIED** — No missing `dealDate` values (0 null).  
**Latest dealDate in data:** 2026-06-08.  
**Note:** The data reaches back to 1998; the low 2026 count (798) reflects a partial year (data through June 2026). No future dates exist.  
**Note:** There is no `asOf` field in deals.json — the field does not exist in the schema.

---

## 3. Missing Field Rates per Neighborhood

Fields checked: `floor`, `yearBuilt` (as stored — see §5e for sentinel issue), `houseNumber`, `areaSqm`, `rooms`, `pricePerSqm`.

| Neighborhood | Total | floor | houseNumber | areaSqm | rooms | pricePerSqm |
|---|---|---|---|---|---|---|
| מרכז העיר צפון | 3,010 | 24% | 12% | 3% | 1% | 2% |
| קריית צאנז | 500 | 29% | 6% | 4% | 3% | 1% |
| גבעת האירוסים | 500 | 34% | 9% | 1% | 0% | 1% |
| משכנות זבולון | 500 | 8% | 0% | 1% | 0% | 0% |
| נוף הטיילת | 500 | **58%** | **78%** | 8% | 2% | 7% |
| נאות הרצל | 500 | 13% | 21% | 2% | 1% | 1% |
| נאות גנים | 500 | 10% | 20% | **16%** | **16%** | 1% |
| קריית השרון | 500 | 21% | 14% | 3% | 1% | 2% |
| אגמים | 500 | **50%** | 3% | 1% | 0% | 0% |
| קריית רבין | 500 | 31% | 1% | 2% | 1% | 1% |
| עין התכלת | 500 | **51%** | **94%** | 5% | 4% | 2% |
| עיר ימים | 500 | **61%** | 0% | 1% | 0% | 1% |
| רמת חן | 500 | **54%** | 47% | 4% | 2% | 3% |
| מרכז העיר דרום | 500 | 15% | 6% | 3% | 0% | 3% |
| רמת אפרים | 498 | 36% | 42% | 4% | 3% | 2% |
| נוף השרון | 498 | 36% | 42% | 4% | 3% | 2% |
| פרדס הגדוד | 493 | 35% | 30% | 5% | 4% | 2% |
| כוכב הצפון | 493 | 35% | 30% | 5% | 4% | 2% |
| קריית נורדאו | 490 | 24% | 2% | 1% | 0% | 0% |
| נאות שקד | 455 | **1%** | 0% | 0% | 0% | 0% |
| נווה איתמר | 205 | **54%** | 3% | **28%** | **24%** | 3% |

**VERIFIED** — Data quality is highly NON-UNIFORM across neighborhoods.  
Key anomalies:
- `houseNumber` missing 94% in עין התכלת, 78% in נוף הטיילת, 47% in רמת חן — these neighborhoods were likely harvested street-by-street without address parsing
- `floor` missing 58-61% in three coastal neighborhoods (נוף הטיילת, עיר ימים, אגמים, עין התכלת) — source data gap
- `areaSqm`+`rooms` both missing 16-28% in נאות גנים and נווה איתמר — suggests land/older records dominate those batches

---

## 4. pricePerSqm Distribution

Based on 12,423 deals with valid `pricePerSqm` (219 null/missing):

| Percentile | ₪/m² |
|---|---|
| min | 5 |
| p10 | 8,962 |
| p25 | 16,327 |
| **p50 (median)** | **22,458** |
| p75 | 27,338 |
| p90 | 35,398 |
| p95 | 43,731 |
| p99 | 63,241 |
| max | 347,032 |

**VERIFIED** — Median ₪22,458/m² is consistent with Netanya apartment prices (2020–2026 dominant period).  
The extreme min (5 ₪/m²) and max (347,032 ₪/m²) confirm erroneous outliers exist.

---

## 5. Suspicious and Impossible Values

### 5a. pricePerSqm < 3,000 or > 80,000

**Count: 434 deals** (3.4% of total)

Sample:
```
{ id: "66239255-2022-01-02-26000000-126", ppsqm: 206,349, price: 26,000,000, area: 126 m², type: apartment, neigh: אגמים }
{ id: "66239255-2021-12-28-26000000-123", ppsqm: 211,382, price: 26,000,000, area: 123 m², type: apartment }
{ id: "66239255-2021-08-04-252000-104",   ppsqm: 2,423,   price: 252,000,   area: 104 m², type: apartment }
{ id: "66239259-2025-03-30-100000-97",    ppsqm: 1,031,   price: 100,000,   area: 97 m²,  type: apartment }
{ id: "66239259-2024-10-15-2368000-1435", ppsqm: 1,650,   price: 2,368,000, plotSqm: 1,435 m², type: land }
```

**LIKELY** — High PPSQM outliers (>₪80k/m²) may be partial sales, parking spaces, or storage units misclassified as apartments. Low outliers (<₪3k/m²) likely represent land, symbolic transfers, or data entry errors.

### 5b. areaSqm < 15 or > 500

**Count: 191 deals**

Sample:
```
{ area: 573 m², type: house,      neigh: עין התכלת }
{ area: 1,245 m², type: apartment, neigh: גבעת האירוסים }   ← impossible for apartment
{ area: 515 m², type: apartment,   neigh: קריית השרון }
```

**VERIFIED** — 191 deals with extreme areas. Large "apartments" (>500m²) are likely misclassified (commercial, duplex penthouses, or the `assetArea` field containing plot area for houses).

### 5c. rooms > 10 or rooms < 1

**Count: 580 deals**

- rooms = 0: **579 deals** — the dominant case; likely sentinel for "unknown"
- rooms = 14: 1 deal (apartment in אגמים, likely data error)

**VERIFIED** — `rooms=0` is a de-facto null sentinel, not a true zero-room property. These should be treated as missing.

**Rooms distribution (valid range):**

| rooms | count | rooms | count |
|---|---|---|---|
| 1 | 131 | 4 | 3,763 |
| 1.5 | 8 | 4.5 | 53 |
| 2 | 506 | 5 | 3,659 |
| 2.5 | 68 | 5.5 | 47 |
| 3 | 2,862 | 6 | 445 |
| 3.5 | 101 | 7 | 86 |
| 3.8 | 1 | 8 | 31 |
| | | 9 | 1 |

**VERIFIED** — 3 and 4-room apartments are most common (expected for Netanya). Half-room increments (e.g., 3.5, 4.5) are present — standard Israeli practice.

### 5d. floor > 50 or floor < 0

**Count: 22 deals**

All 22 have `floor = -1`, corresponding to `מרתף` (basement). This is **valid** — the Hebrew floor parser maps מרתף/מרתפית → -1. No physically impossible floors found.

**VERIFIED** — floor values are clean. floor=-1 is a legitimate basement designation.

### 5e. yearBuilt < 1950 or > 2026

**Count: 3,819 deals** — this is the most serious data quality issue.

Breakdown:
- `yearBuilt = 0`: **3,468 deals** — sentinel value for "unknown/missing"
- `yearBuilt > 2026`: **322 deals** — likely future-planned construction or data error
- `yearBuilt > 0 and < 1950`: **29 deals** — pre-state buildings, plausible but check source
- `yearBuilt valid (1950–2026)`: **8,823 deals** (69.8%)

**VERIFIED** — The Phase 1 figure of "27.4% missing yearBuilt" was measuring `yearBuilt = 0` as missing. The field itself is never null (0% null); the sentinel `0` masquerades as "present." This is a normalization bug: `yearBuilt = 0` must be treated as null/unknown downstream.

**Note:** The per-neighborhood table above showed `yearBuilt` 0% missing because the query tested `== null`, not `=== 0`. The true "missing or invalid" rate is **30.2%** (3,819 / 12,642).

### 5f. price < 100,000 or > 50,000,000

**Count: 109 deals**

Sample:
```
{ price: 94,860,000, type: apartment, neigh: אגמים, date: 2024-08-29 }   ← likely commercial or large complex
{ price: 50,000,   type: apartment, neigh: עין התכלת, date: 2025-09-15 } ← symbolic transfer or error
{ price: 65,000,   type: apartment, neigh: עין התכלת, date: 2025-06-24 } ← same pattern
```

**LIKELY** — Ultra-high prices (>₪50M) may be multi-unit building sales or commercial property leaking into the residential dataset. Sub-₪100k prices are almost certainly partial sales, symbolic transfers (e.g., inheritance at 1% value), or data errors.

---

## 6. Near-Duplicate Detection

Matching criteria: same `street` + `houseNumber` + `dealDate` + `price` within 5%.

**Total near-duplicate pairs found: 3,011**

Breakdown:
- Same area (likely true duplicates): **2,155 pairs**
- Different area, same building (different units sold same day): **856 pairs**

Sample true duplicates:
```
key: שמורת נחל בניאס|7|2024-05-28
  A: id=66239255-2024-05-28-3055000-126  price=3,055,000 area=126m²
  B: id=66239255-2024-05-28-2996999-104  price=2,996,999 area=104m²
  → different area, different ID = legitimately different units

key: שמורת נחל בניאס|7|2021-10-09
  A: id=66239255-2021-10-09-2222002-103  area=103m²
  B: id=66239255-2021-10-09-2152001-126  area=126m²
  → different area = different units (not duplicates)
```

**LIKELY** — The 856 "same area" near-dups with price within 5% (but not identical price) may be legitimate near-simultaneous sales of identical units in a new building. True duplicates (exactly same price AND area) require a count refined further. The ID scheme (`neighborhoodId-date-price-area`) provides natural deduplication: if two records have exactly the same ID they are deduplicated by the harvest script. IDs with `NaN` suffix (219 total) lose area disambiguation and are at higher risk of collision.

---

## 7. Deal ID Format Analysis

**VERIFIED** — Format: `{neighborhoodId}-{dealDate}-{price}-{areaOrKey}`

Examples:
```
66239255-2026-05-19-3100000-130.7      ← neighborhoodId=66239255, date=2026-05-19, price=3100000, areaSqm=130.7
66239255-2024-08-29-94860000-NaN       ← area was null/NaN at normalize time
```

- IDs with numeric trailing value: **12,423**
- IDs ending in `NaN`: **219** (1.7%)

The `NaN` suffix occurs when both `areaSqm` and the raw `keyValue` field are absent. These IDs risk collision if two deals in the same neighborhood share the same date and price but differ only in unreported area.

The harvest script (line 202 of `scripts/harvest.ts`) builds the ID as:
```typescript
id: `${n.id}-${raw.keyValue ?? raw.dealId ?? `${dealDate}-${price}-${builtArea || plotArea}`}`
```
When `keyValue`, `dealId`, area are all missing, the fallback becomes `date-price-NaN`.

---

## 8. Coordinate Validity

All 12,642 deals have non-null `x` and `y` (confirmed in Phase 1).

Actual coordinate ranges in the data:
- **x:** 185,256 – 189,245 (ITM Easting)
- **y:** 687,199 – 695,127 (ITM Northing)

These coordinates map to the 21 neighborhood centroids from `neighborhoods.json` — when a street-level coordinate is unavailable, the deal inherits the neighborhood centroid (see `harvest.ts` line 218–221).

**VERIFIED** — Zero deals have coordinates outside the valid Netanya ITM bounding box.  
**LIKELY** — Most coordinates are neighborhood-level centroids, not street-level. The `street-index.json` file provides per-street refinement but it is unclear how complete it is.

---

## 9. Property Type × Area Cross-Validation

| Type | Count | missing areaSqm | missing plotSqm | both null |
|---|---|---|---|---|
| apartment | 11,951 | 192 (1.6%) | 11,951 (100%) | 192 |
| house | 391 | 2 (0.5%) | 391 (100%) | 2 |
| land | 300 | 300 (100%) | 25 (8.3%) | 25 |

**VERIFIED** — Classification logic is consistent:
- Apartments never have `plotSqm` (by design in normalize())
- Land deals never have `areaSqm` (correctly set to null for land)
- 25 land deals (8.3%) have neither `areaSqm` nor `plotSqm` — no area data at all

**VERIFIED** — No land deals incorrectly carry `areaSqm`. No apartments carry `plotSqm`.

**LIKELY** — 191 deals with `areaSqm > 500` (§5b) include cases classified as "apartment" with 573–1,245m² — these may be misclassified duplexes, penthouses, or the source field containing total project area.

---

## 10. neighborhoods.json vs deals.json

**VERIFIED** — Perfect 21:21 match. Every neighborhood ID in `neighborhoods.json` has at least one deal in `deals.json`, and every `neighborhoodId` in `deals.json` appears in `neighborhoods.json`. Zero orphan IDs in either direction.

---

## 11. Sort Order

**VERIFIED** — Deals are organized as follows:
1. **By neighborhood** — 21 contiguous blocks, ordered by harvest sequence (not alphabetical, not by ID)
2. **Within each neighborhood** — sorted **date descending** (newest first)

The neighborhood order matches the harvest loop order in `scripts/harvest.ts` (first `discoverNeighborhoods()` hit order, with מרכז העיר צפון handled last via street-mode).

---

## 12. Latest dealDate / asOf

- **Latest `dealDate`:** `2026-06-08` (קריית השרון)
- **`asOf` field:** Does not exist in `deals.json` or the schema. The Phase 1 reference to `asOf` is not present in the actual data structure.

**VERIFIED** — The freshest data is approximately 10 weeks old relative to audit date (2026-08-19).

---

## CRITICAL FINDING: The 500-Deal Cap

### Source code investigation (scripts/harvest.ts)

There is **no explicit 500-record or pageSize limit** anywhere in the harvest script. The harvest uses scroll-based infinite-scroll pagination:

```typescript
const MAX_SCROLL_ROUNDS = 200;   // ← raised from 24 to cover streets with 50+ pages
const SCROLL_IDLE_ROUNDS = 4;    // ← raised from 3 for certainty
```

With `MAX_SCROLL_ROUNDS = 200` and a `waitForTimeout(2500)` per round, the script can theoretically scrape up to ~200 pages × items-per-page of results.

### What actually causes the 500 cap

**LIKELY** — The 500-record ceiling is imposed by `nadlan.gov.il`'s backend API (`/deal-data` endpoint), not by the harvest script. The API returns a maximum of ~500 deals per neighborhood-level query regardless of scroll depth. Once the site has loaded all available results (at the API limit), further scrolling yields no new items and the harvest terminates at `SCROLL_IDLE_ROUNDS`.

Evidence:
- 14 neighborhoods hit **exactly** 500 (not approximately — the cap is sharp)
- מרכז העיר צפון (harvested street-by-street) yields **3,010** deals — bypassing the neighborhood-level cap by querying each street individually
- Neighborhoods with fewer historical transactions (נווה איתמר: 205, נאות שקד: 455) come in under the cap naturally

### Implication

The date range for capped neighborhoods is arbitrarily truncated at the API's result window, which appears to be the **most recent 500 deals**. Example: קריית רבין (500 deals) has data from 2013, but earlier deals from 2004–2012 may exist in the tax authority database but are inaccessible via the neighborhood-level query mode.

The street-by-street strategy (currently applied only to מרכז העיר צפון) should be extended to all 14 capped neighborhoods to recover the full history.

---

## Summary of Key Issues

| Issue | Count | Severity | Status |
|---|---|---|---|
| yearBuilt = 0 (sentinel for null) | 3,468 (27.4%) | HIGH | VERIFIED |
| yearBuilt > 2026 (invalid future) | 322 (2.5%) | MEDIUM | VERIFIED |
| Neighborhoods hard-capped at 500 | 14/21 | HIGH | VERIFIED |
| rooms = 0 (sentinel for null) | 579 (4.6%) | MEDIUM | VERIFIED |
| PPSQM outliers (<3k or >80k ₪/m²) | 434 (3.4%) | MEDIUM | VERIFIED |
| Near-duplicate pairs (same area) | 2,155 pairs | MEDIUM | LIKELY |
| IDs with NaN suffix (collision risk) | 219 (1.7%) | LOW | VERIFIED |
| areaSqm > 500 or < 15 | 191 (1.5%) | LOW | VERIFIED |
| price < ₪100k or > ₪50M | 109 (0.9%) | LOW | VERIFIED |
| Land deals with no area data | 25 (8.3% of land) | LOW | VERIFIED |
| Coordinates are centroid-level | ~all | INFO | LIKELY |
| No `asOf` field in data | — | INFO | VERIFIED |
