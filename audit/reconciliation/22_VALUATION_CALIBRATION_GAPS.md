# 22 — Valuation Calibration Gaps

> Source of truth: `lib/valuation.ts` (864 lines, read in full), `lib/types.ts`.
> Cross-referenced: `audit/05_VALUATION_LOGIC.md`, `06_VALUATION_BACKTEST.md`, `07_COMPARABLE_TRACE.md`.
> Read-only forensic pass. No code or data modified. This document **identifies and quantifies** gaps only — it proposes **no** new ranges, weights, thresholds, coefficients, or formulas.
> Data stats below computed read-only over `data/deals.json` (12,642 deals: 11,951 apartment / 391 house / 300 land).
>
> Status legend: **VERIFIED** = explicit in source or directly measured; **LIKELY** = strongly inferred; **UNKNOWN** = cannot determine without runtime trace; **NOT TESTED** = code path exists but does not trigger on current data.

---

## 0. Central Question — Is the Band-Width Inversion Real?

**Answer: YES — VERIFIED.** The percentile band assigned to the *least precise* geographic evidence is the *narrowest*, and the band assigned to the *most precise* evidence (same building) is the *widest*. This is the inverse of sound interval calibration.

### Band widths from source (lines 443–445)

```ts
const scopePct = compSearchScope === "building" ? { lo: 20, hi: 80 }   // line 443
               : compSearchScope === "street"   ? { lo: 25, hi: 75 }   // line 444
               :                                  { lo: 33, hi: 67 };  // line 445  (radius AND neighborhood)
const lo  = percentile(ppsqm, scopePct.lo);   // line 446
const mid = percentile(ppsqm, 50);            // line 447
const hi  = percentile(ppsqm, scopePct.hi);   // line 448
```

| Scope | Evidence precision | Percentile band | **Band width** |
|-------|--------------------|-----------------|----------------|
| `building` | highest (same building/entrance) | P20–P80 | **60 pts** |
| `street`   | high (same street) | P25–P75 | **50 pts** |
| `radius`   | low (geo proximity, no street confirm) | P33–P67 | **34 pts** |
| `neighborhood` | lowest (whole-neighborhood fallback) | P33–P67 | **34 pts** |

**The inversion is explicit and monotonic in the wrong direction:** as geographic evidence degrades (building → street → radius → neighborhood), the percentile band *contracts* from 60 → 50 → 34 → 34 points. Sound calibration requires the opposite — a wider interval when the evidence is weaker. **VERIFIED — lines 443–445.**

**Second defect in the same block:** `radius` and `neighborhood` collapse to the **identical** P33/P67 band. A 500 m-radius match and a whole-neighborhood fallback — materially different evidence quality — are reported with the same interval width. There is no code path that widens the neighborhood fallback relative to the radius match. **VERIFIED — line 445 (the `else` branch covers both scopes).**

### Honest confound (so the effect is not overstated)

The band is a **percentile band over the comparable pool's ppsqm dispersion**, not a statistical confidence interval. The resulting **shekel** width is `size × (percentile(hi) − percentile(lo))`, which also depends on how dispersed the pool is:

- A same-building pool is homogeneous, so even P20–P80 spans a small ₪ range (Trace 1: ₪194 K width ≈ 10% on 3 near-identical units).
- A neighborhood pool is heterogeneous, so even P33–P67 can span a large ₪ range (Trace 3: houses ranging ₪12,131–₪34,103 /sqm).

So the *percentile-band* inversion is unambiguous and real (lines 443–445), while the *shekel-interval* width for a given query is a product of band-width × pool-dispersion and can move either way. The comment at lines 441–442 (`טווח האומדן מצטמצם ככל שהנתונים קרובים יותר לנכס`) describes the shekel outcome the author intended; per instructions this document does **not** infer whether that intent is justified — it only records that **the reported percentile band narrows as evidence precision falls, which is backwards, and radius vs. neighborhood are not differentiated at all.**

### Interaction with confidence and sample size (compounds the inversion)

Band width is decoupled from `confidence` and from sample size. A `building` match on the **minimum 3 deals** (Trace 1) receives the **widest** band (P20/P80) but `confidence = "low"`. The widest interval is therefore applied exactly where the pool is smallest and least stable, while the narrowest interval (P33/P67) is applied to large neighborhood pools. **VERIFIED — line 443 vs `confidenceFromCount` line 847.**

---

## 1. Temporal Weighting

**Finding: NONE. Older comps are weighted identically to recent comps. VERIFIED.**

The estimate is `percentile(ppsqm, p)` over the pool (lines 446–448) and, for houses, `percentile(ppsC, {25,50,75})` (line 495). `percentile()` (lines 854–863) sorts values and interpolates by rank — there is **no** date term, recency weight, or decay anywhere in the estimate path.

The only time mechanisms are hard cutoffs:
- Geographic pool: single 60-month cutoff (`GEO_MONTHS = 60`, line 89; `cutoffDate` line 106).
- Neighborhood fallback: shortest of 6/12/24/48-month windows that yields ≥ 3 deals (`WINDOWS` line 88, loop lines 152–162).

A deal from 2021 and a deal from 2026 inside the 60-month window contribute equally to the percentile. In a trending market the P50 lags the trend. `priceTrend` (lines 822–845) surfaces the trend to the UI but **does not feed back** into `estimateLow/Mid/High`. **VERIFIED — absence of any weight term, lines 398–521.**

---

## 2. ±50% Area Tolerance

**VERIFIED — lines 389–396.** `AREA_TOLERANCE_RATIO = 0.5` (line 94).

```ts
if (sizeInput != null && sizeInput > 0 && ptype !== "land") {   // line 389
  const areaMin = sizeInput * (1 - AREA_TOLERANCE_RATIO);        // ×0.5
  const areaMax = sizeInput * (1 + AREA_TOLERANCE_RATIO);        // ×1.5
  const areaFiltered = deals.filter(d => d.areaSqm != null && d.areaSqm >= areaMin && d.areaSqm <= areaMax);
  if (areaFiltered.length >= MIN_DEALS_FOR_ESTIMATE) deals = areaFiltered;  // keep only if ≥ 3
}
```

- Range is **±50%** of input built area (100 sqm → 50–150 sqm). This is very wide — a 50 sqm and a 150 sqm unit are treated as comparable, and small units carry higher ₪/sqm while large units carry lower, so a wide window imports precisely the size-driven ppsqm bias the filter's own comment (lines 387–388) says it exists to prevent.
- Filter is **skipped for land** (`ptype !== "land"` guard) — land is never size-filtered, so a small and a huge plot compete in the same pool.
- Uses `areaSqm` (built) for both apartments **and houses** — never `plotSqm`. For houses the size that drives value (the plot) is not the axis being toleranced.
- Applied **after** floor filter, and is the **last** gate before the ppsqm count check (line 402). If it drops the pool below 3 it is discarded (kept only if ≥ 3), but if the pool was already ≥ 3 and area-filtering leaves exactly < 3 valid ppsqm, the whole valuation returns `null` at line 402.

---

## 3. Floor ±2 Filter

**VERIFIED — lines 376–385.** `FLOOR_TOLERANCE = 2` (line 96); gate `MIN_DEALS_FOR_FLOOR_FILTER = 5` (line 93).

```ts
if (ptype === "apartment" && input.floor != null) {              // line 377 — apartments only
  const fs = deals.filter(d => d.floor != null && Math.abs(d.floor - input.floor!) <= FLOOR_TOLERANCE);
  if (fs.length >= MIN_DEALS_FOR_FLOOR_FILTER) { deals = fs; floorFiltered = true; }  // keep only if ≥ 5
}
```

- Apartments only — houses/land skip (comment lines 372–375: house deals mostly have `floor = null`).
- Kept only if ≥ 5 deals survive; otherwise the pool is left unfiltered and `floorAdjusted = false`.
- Deals with `floor = null` are **excluded** by the filter when it runs (`d.floor != null`), so a null-floor deal can never satisfy the floor filter and silently drops out whenever the filter activates.
- Note the local variable shadow: `const fs` (line 378) shadows the `fs` (fs/promises) import from line 4 within this block. Harmless here (no fs use inside the block) but fragile. **VERIFIED.**

---

## 4. yearBuilt null / 0-Sentinel Behavior

**Finding: the 0-sentinel pollutes age math. VERIFIED, and quantified as material.**

`ageFilter` (lines 169–173):
```ts
const ageFilter = (ds, toleranceYrs) => {
  if (input.yearBuilt == null) return ds;
  const withAge = ds.filter(d => d.yearBuilt != null && Math.abs(d.yearBuilt - input.yearBuilt!) <= toleranceYrs);
  return withAge.length >= MIN_DEALS_FOR_ESTIMATE ? withAge : ds;
};
```

The guard is `d.yearBuilt != null`. In JavaScript `0 != null` is **true**, so a deal carrying the **0 sentinel is treated as the literal year 0**, giving `|0 − 1995| = 1995 ≫ tolerance`. Such deals are therefore **always excluded** whenever the age filter is applied against a real input year.

**Measured pollution (read-only over deals.json):**

| Segment | Deals | `yearBuilt === 0` | Share |
|---------|-------|-------------------|-------|
| ALL | 12,642 | 3,468 | **27.4%** |
| apartment | 11,951 | 3,234 | **27.1%** |
| house | 391 | 20 | 5.1% |
| land | 300 | 214 | 71.3% |
| — | — | `yearBuilt === null`: **0** | — |

There are **zero** genuine `null` yearBuilt values — the dataset encodes "unknown" as `0`. So `input.yearBuilt == null` early-return (line 170) rarely helps, and whenever a user supplies a real year, roughly **27% of apartment comps are silently dropped** by `ageFilter` because their year reads as 0. The `withAge.length >= 3 ? withAge : ds` fallback (line 172) masks this by reverting to the unfiltered pool when the survivor count is too low, so the effect is invisible in outputs but real in pool composition.

**Second-order bug (LIKELY):** if `input.yearBuilt` itself arrives as `0` (a lead/form sending the same sentinel), the guard `input.yearBuilt == null` is false (0 ≠ null), the filter runs, and `|0 − 0| = 0 ≤ tolerance` matches **only the 0-sentinel deals** while excluding every real-year comp — an inverted pool. Whether the input layer can emit `0` is **UNKNOWN** from valuation.ts alone (depends on the form/lead normalization upstream). **VERIFIED for the deal-side pollution; LIKELY for the input-side inversion.**

---

## 5. Non-Numeric House-Number Handling

**Finding: latent scope-mislabel bug, but does NOT trigger on current data. Code path VERIFIED; production impact NOT TESTED (0 qualifying rows).**

In `byExactBuilding` (line 202) and `byBuildingNumber` (line 214):
```ts
const hn = parseInt(input.houseNumber);
if (isNaN(hn)) return onStreet;   // non-numeric input → return the ENTIRE street
```
If the input house number does not `parseInt` to a number, both helpers return the **entire street**. In the text stage (lines 224–249), `byExactBuilding` returning the whole street can then satisfy `≥ 3` and set `compSearchScope = "building"` (line 227) — labeling a whole-street pool as a same-building match and applying the **widest** P20/P80 band. This is BUG 2 in `05_VALUATION_LOGIC.md`.

**But quantified against the data it does not fire:** of 10,034 non-null house numbers, **0 are non-numeric** under `parseInt` (values like `"98א"` parse to `98`; only a value with a non-digit *first* character yields `NaN`, and none exist). Null/empty house numbers: 2,608 — these hit the `if (!input.houseNumber ...)` guard (lines 199, 212) and return `[]`, not the mislabel path. So the mislabel is a **real latent defect** but currently **inert**. **VERIFIED (code) / NOT TESTED (no triggering data).**

Note the same `parseInt` leniency means `houseNumber` variants sharing a numeric prefix (`"98א"`, `"98ב"`) are correctly unified to building 98 (comment line 196) — that behavior is intentional and works.

---

## 6. Exact-Building vs Near-Building Semantics

**VERIFIED — lines 196–219, 224–249.**

- **Exact building** — `byExactBuilding` (lines 197–206): same street (normalized) **and** `parseInt(houseNumber)` exactly equal. Sets `compSearchScope = "building"` → **P20/P80** (line 225–230). `HOUSE_RANGE` not used here.
- **Near building** — `byBuildingNumber` (lines 210–219): same street **and** `|houseNumber − input| ≤ HOUSE_RANGE` where `HOUSE_RANGE = 12` (line 209). Sets `compSearchScope = "street"` → **P25/P75** (lines 233–238). Deliberately *not* labeled "building" (comment lines 221–223) to avoid tagging neighbors (e.g. ויצמן 97 vs 98) as the same building.
- **Full street** — `byStreetName` (lines 185–194): street name match only → `"street"` (lines 240–246).

The distinction is coherent in the text path. The **geo** path (lines 283–312) then re-checks: within `BUILDING_RADIUS = 60 m`, if a street name is present it requires all in-radius deals to share the street to keep `"building"`, else it downgrades to `"radius"` (lines 298–309, `allSameStreet`). Because of coordinate collision (§10), the 60 m radius returns the whole neighborhood, so this geo re-check leans entirely on the street-name double-filter. **VERIFIED.**

Display side uses a stricter definition: `BUILDING_HN_RANGE = 0` (line 743) — for the comparable-deal `tier` label, "building" means the exact same house number (line 756), while `hnProximity` treats `±2` as "same building really" only for intra-tier ordering (line 781). So the **valuation** near-building window (±12 → street) and the **display** building tier (±0) use different house-number semantics. **VERIFIED — line 209 vs 743 vs 781.**

---

## 7. Do Unlocated (missing/centroid) Deals Get Concatenated Into Geo Pools?

**Finding: YES, unconditionally — but harmless on current data because there are no unlocated deals; every deal instead shares its neighborhood centroid. VERIFIED.**

Lines 275–276 split the geo pool:
```ts
const located   = geoPool.filter(d => d.x != null && d.y != null);
const unlocated  = geoPool.filter(d => d.x == null || d.y == null);
```
Then at lines 306, 319, 334 the unlocated set is appended to every geo result regardless of address:
```ts
deals = inBuilding.concat(unlocated);   // line 306
deals = onStreet.concat(unlocated);     // line 319
deals = within.concat(unlocated);       // line 334
```
This is BUG 3 in `05_VALUATION_LOGIC.md` (unlocated deals from any street diluting a geo match).

**Measured:** `null-coord deals = 0`. Every one of the 12,642 deals has coordinates, so `unlocated = []` and the concats add nothing today. **However** the deeper issue is the reverse: **distinct (x,y) pairs = 21** for 21 neighborhoods — every deal carries its **neighborhood centroid**, not a real address point. So `located` is the entire neighborhood and `filterByRadius(60)` / `(350)` / `(500)` all return every located deal in the neighborhood (distance 0 for all same-neighborhood pairs). The geographic radius hierarchy is therefore a no-op proximity filter; it degrades to neighborhood-wide and is rescued only by the text/street path. This matches `06_VALUATION_BACKTEST.md` (100% of 717 backtested deals resolved to `building` scope — the street/radius/neighborhood branches are effectively unreachable when a street name is present). **VERIFIED — 21 distinct coords, 0 null coords.**

Net: the concat-of-unlocated defect is **latent/inert** on this data (VERIFIED it would fire if any deal lacked coords); the **operative** problem is centroid collision making geo distance meaningless.

---

## 8. Does Displayed `comparableDeals` Equal the Actual Valuation Pool?

**Finding: NO — displayed comparables are a DIFFERENT slice from the ppsqm pool that drives the estimate. VERIFIED.**

The estimate uses `ppsqm` = `deals.map(pricePerSqm).filter(>= minPpsqm)` (lines 398–400), or for houses `ppsC` (line 488/495). The displayed comparables use `displayDeals` through `buildComparableDeals` (line 544). They diverge in **four** ways:

1. **City-wide exact-building augmentation (lines 404–439):** if the final `deals` pool contains no deal at the exact input house number, up to N deals from *other neighborhoods* are prepended to `displayDeals` (line 435). These are **never** in the `ppsqm` array used for the range. So the UI can show building deals that did **not** contribute to the estimate. **VERIFIED — `displayDeals` (line 408) vs `deals` (line 398) are distinct variables; matches Finding 7 in 05.**
2. **Independent size/room re-filtering + top-12 cap:** `buildComparableDeals` / `pickComparables` re-filter by size (±14/±25 sqm or ±25%/±55% composite) and rooms, then `.slice(0, 12)` (lines 641–651, 784–801). The displayed set is at most 12 and filtered on different criteria than the valuation pool.
3. **House composite pool divergence (lines 486–492):** when the local composite pool has < 6 values, the estimate's `ppsC` is recomputed over the whole-neighborhood `geoPool` (line 490) while the displayed comps stay on the local geographic `deals`. The number shown and the number computed come from different pools. **VERIFIED — comment lines 486–487 states this explicitly.**
4. **Display-only MIN_PPSQM re-filter (line 685):** `buildComparableDeals` re-applies the partial-transaction filter to the display pool independently.

Consequence: a user cannot reconcile the displayed comps against the estimate by arithmetic — the "proof" deals are not guaranteed to be the pool the number came from. **VERIFIED.**

---

## 9. The 0.4 Composite Coefficient and the 0.45 vs 0.4 Inconsistency

**Both numbers confirmed from source. VERIFIED.**

| Constant | Value | Line | Used by | Live? |
|----------|-------|------|---------|-------|
| `PLOT_WEIGHT` | **0.4** | 462 | `composite()` — valuation estimate (lines 463–467, 495–498) | **YES** |
| `COMP_PLOT_WEIGHT` | **0.4** | 583 | `compSize()` — comparable display sizing (lines 585–595, 693) | **YES** |
| `sizeDistance()` plot weight | **0.45** (built 0.55) | 565 | `sizeDistance()` (lines 557–566) | **NO — dead code** |

```ts
// line 462 (valuation)         return built + PLOT_WEIGHT * (plot>0 ? plot : 0);   // 0.4
// line 565 (sizeDistance)      return 0.55 * builtD + 0.45 * plotD;                // 0.45
```

The inconsistency in `05_VALUATION_LOGIC.md` Finding 6 is **real and confirmed**: the estimate weights plot at 0.4, `sizeDistance` weights it at 0.45. **New forensic detail:** `sizeDistance` is **defined but never referenced** anywhere in the codebase (grep across `*.ts` returns only its definition at line 557). So the 0.45 path is **dead code** and has **no runtime effect** — the practical model is internally consistent at 0.4 (both live sites). The inconsistency is a maintenance/correctness smell (two documented weights for "how big is this property"), not an active divergence between displayed comps and the estimate. **VERIFIED — 0.4 at lines 462 & 583; 0.45 at line 565; `sizeDistance` uncalled.**

Source of 0.4: comment line 461 (`קרקע שווה פחות למ"ר מבנוי`) — an engineering heuristic; **no empirical derivation or external citation.** **LIKELY** hand-tuned. Same for 0.45.

---

## 10. Actual plotSqm Coverage — Does the Composite Model Effectively Do Nothing?

**Finding: for houses the composite model is effectively inert. VERIFIED by measurement.**

Read-only over deals.json:

| Segment | Deals | `plotSqm > 0` | Coverage |
|---------|-------|---------------|----------|
| ALL | 12,642 | 275 | 2.2% |
| **house** | **391** | **0** | **0.0%** |
| land | 300 | 275 | 91.7% |
| apartment | 11,951 | 0 | 0.0% |
| — | `plotSqm === null` overall | 12,367 | `=== 0`: 0 |

**Zero of 391 house deals carry a plot area.** Trace the consequence through the composite path (lines 470–515):

- `useCompositeModel = (ptype === "house" || isLand) && subjComposite != null` (line 470). For a house it requires the **subject** (`input.plotSqm`) to be non-null; the model can still "activate" on subject input.
- But `toPpsC` (lines 474–484) computes each comp's ratio as `price / composite(d.areaSqm, d.plotSqm)`, and `composite()` for a house with `d.plotSqm` null returns **just `built`** (line 466, `plot>0 ? plot : 0` → 0). So **every** house comp's composite size equals its built area, and `ppsC` = the built-area ppsqm distribution — identical to the simple model's `ppsqm`. The 0.4 plot term contributes **nothing on the comparable side** because no house deal has a plot.
- The only place 0.4 does anything for houses is scaling the **subject**: `estMid = round(subjComposite × cMid)` where `subjComposite = input.areaSqm + 0.4 × input.plotSqm` (line 468). So a house estimate = `(built + 0.4·plot_subject) × median(price/built_comp)` — the subject's plot is valued at 0.4× the built-area ₪/sqm, but no comp ever informs a plot premium.
- When `input.plotSqm` is null (the common lead case — see Trace 3, גורדון 36), `subjComposite = null`, `useCompositeModel = false`, and the model degrades fully to `ppsqm × areaSqm`, **omitting plot value entirely.**

So: on the comparable side the composite model **does nothing** (0% plot coverage → 0.4 term always 0); on the subject side it does something only if the user supplies `plotSqm`, and then only as a crude 0.4× built-ppsqm scaler with no comp support. For land (91.7% plot coverage) the `plot`-basis model is data-supported and functional. **VERIFIED — 0/391 house plot coverage; lines 463–515.**

**Related flag defect (VERIFIED, from Trace 3):** `plotNotValued = ptype === "house" && (input.plotSqm ?? 0) > 200 && !compositeUsed` (line 551). A house where the user did **not** supply `plotSqm` has `(input.plotSqm ?? 0) = 0`, so `0 > 200` is false and the warning **never shows** — precisely the case (plot genuinely unvalued) where the user most needs it. The flag fires only when the user *did* supply a large plot yet composite still failed, i.e. the narrower case. **VERIFIED — line 551.**

---

## 11. MIN_PPSQM / MIN_DEALS Anomaly-Filtering Thresholds

**All constants reported verbatim. VERIFIED.**

`MIN_PPSQM` (lines 100–104):
```ts
apartment: 8_000    // comment: cheapest Netanya ≈ 12K; 8K = safety margin
house:    12_000    // comment: P25 real house market ≈ 13.5K
land:        800    // agricultural floor
// fallback for unknown types: 5_000 (line 127)
```

Sample-size gates:

| Constant | Value | Line | Role |
|----------|-------|------|------|
| `MIN_DEALS_FOR_ESTIMATE` | 3 | 91 | min valid ppsqm to compute a range; also the null-return gate (line 402) |
| `MIN_DEALS_FOR_ROOM_FILTER` | 6 | 90 | min before ±1 room filter kept |
| `MIN_DEALS_FOR_FLOOR_FILTER` | 5 | 93 | min to keep floor filter; also geo street/radius minimum |
| `MIN_COMPOSITE_DEALS` | 6 | 92 | min composite values before falling back to geoPool |
| `MIN_COMPARABLES` | 3 | 578 | min for display list before widening filters |
| `HOUSE_MAX_PPSQM_BUILT` | 40,000 | 95 | composite sanity ceiling → fall back to simple model |

**Calibration gap (corroborated by backtest, not re-run here):** `06_VALUATION_BACKTEST.md` shows every top-10 worst miss is an actual price **below** the estimate — below-market/partial transfers that passed the `8,000` apartment floor (e.g. actual ₪500 K vs mid ₪1.29 M, basedOn=40). The `8,000` floor is too low to reject these, so they enter the pool and depress the lower tail. The `MIN_PPSQM` filter doubles as the only anomaly filter and is set for a different purpose (excluding obvious 25%-share transfers), leaving a band of below-market-but-above-8K deals uncaught. **VERIFIED constants; LIKELY calibration gap per backtest evidence.** (No new threshold proposed here.)

---

## 12. Confidence Calibration — Does It Track Empirical Accuracy?

**Finding: confidence is a pure sample-count bucket, decoupled from scope, dispersion, and band width. It correlates weakly and monotonically with in-range coverage but is not calibrated to any accuracy target. VERIFIED (code) + LIKELY (empirical, from existing backtest).**

`confidenceFromCount(basedOn)` (lines 847–851):
```ts
if (n >= 25) return "high";
if (n >= 10) return "medium";
return "low";
```
- Input is `basedOn` = number of valid ppsqm (or composite) values (line 459/499) — **count only.** No term for scope, pool dispersion, band width, recency, or geographic precision.
- **Decoupled from the band:** a 3-deal building match gets `"low"` confidence **and** the widest P20/P80 band (§0). Confidence and interval width move independently, so the UI's confidence label does not reflect the interval it is paired with.

**Empirical tracking (from `06_VALUATION_BACKTEST.md`, not re-run):**

| Confidence | n | % inside range | MAPE | Median AE |
|-----------|---|-----------------|------|-----------|
| high (≥25) | 301 | 58.1% | 12.1% | ₪191,529 |
| medium (10–24) | 149 | 51.7% | 12.2% | ₪171,000 |
| low (<10) | 267 | 48.7% | 13.9% | ₪170,000 |

Coverage is monotonic (58.1% → 51.7% → 48.7%), so more comps ≈ better in-range — a weak positive signal. But: (a) **median absolute error is non-monotonic** (high has the *largest* median AE, ₪191 K, because high-count addresses sit in higher-price neighborhoods); (b) even `high` reaches only 58.1% in-range against the ~60% theoretical target for a P20/P80 band, and the overall in-range is 53.3%. So the labels rank-order accuracy loosely but are **not calibrated** — "high" does not correspond to a stated hit rate, and the label says nothing about ₪ error magnitude. **VERIFIED (count-only formula, lines 847–851); LIKELY (weak empirical monotonicity, existing backtest).**

---

## Classification Summary

| # | Gap | Status |
|---|-----|--------|
| 0 | Band-width inversion (P20/80 building → P33/67 radius+neighborhood); radius=neighborhood undifferentiated | **VERIFIED** |
| 1 | No temporal weighting; older comps weighted equally | **VERIFIED** |
| 2 | ±50% area tolerance very wide; land unfiltered; houses filtered on built not plot | **VERIFIED** |
| 3 | Floor ±2, apartments only, ≥5 gate, null-floor excluded | **VERIFIED** |
| 4 | yearBuilt 0-sentinel pollutes age math (27.4% of deals; 0 true nulls); input-side inversion if input=0 | **VERIFIED** deal-side / **LIKELY** input-side |
| 5 | Non-numeric house number → whole-street mislabeled "building" | **VERIFIED** code / **NOT TESTED** (0 triggering rows) |
| 6 | Exact (±0→building) vs near (±12→street) vs display tier (±0) semantics differ | **VERIFIED** |
| 7 | Unlocated deals concatenated into geo pools unconditionally | **VERIFIED** (inert: 0 unlocated); centroid collision (21 coords) is the operative defect |
| 8 | Displayed comparableDeals ≠ valuation ppsqm pool (4 divergence sources) | **VERIFIED** |
| 9 | 0.4 (live ×2) vs 0.45 (sizeDistance, dead code) coefficient inconsistency | **VERIFIED** |
| 10 | plotSqm coverage: houses 0/391 (0.0%) → composite inert on comp side; plotNotValued flag misfires | **VERIFIED** |
| 11 | MIN_PPSQM (8K/12K/800) too low for anomaly rejection (below-market misses) | **VERIFIED** constants / **LIKELY** calibration gap |
| 12 | Confidence = count-only bucket, decoupled from band/scope/dispersion; weak empirical monotonicity | **VERIFIED** code / **LIKELY** empirical |

---

## Top 3 Calibration Gaps by Impact

1. **Band-width inversion (Gap 0).** The reported percentile interval *narrows* as geographic evidence weakens — building P20/P80 (60 pts) → radius/neighborhood P33/P67 (34 pts) — the opposite of sound calibration, and radius vs. neighborhood are not distinguished at all. Compounded by the band being decoupled from sample size (widest band on 3-deal building pools) and from `confidence`. Explicit at lines 443–445.

2. **Composite model inert for houses + plot value dropped (Gaps 10, 9).** 0 of 391 house deals carry `plotSqm`, so the 0.4 plot term contributes nothing on the comparable side; when the user omits `plotSqm` the plot is valued at zero and `plotNotValued` (line 551) fails to warn because `0 > 200` is false. Houses with land are systematically under-estimated (corroborated by Trace 3: actual ₪2.55 M vs high ₪2.32 M). The 0.45-weight `sizeDistance` is dead code, so the estimate itself is at least internally consistent at 0.4.

3. **No temporal weighting + MIN_PPSQM too low, with count-only confidence (Gaps 1, 11, 12).** All comps in the 60-month window are weighted equally, so the P50 lags a trending market while `priceTrend` observes the drift without feeding it back; the 8K apartment floor lets below-market/partial transfers into the pool (every backtest worst-miss is below estimate); and `confidence` is a pure count bucket that reflects none of this. Together they bias the point estimate and mislabel its reliability.
