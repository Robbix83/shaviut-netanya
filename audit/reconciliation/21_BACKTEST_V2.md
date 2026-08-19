# 21 — Leak-Free Valuation Backtest V2

> Script: `C:\leads\audit\reconciliation\backtest_v2.mjs`
> Machine-readable results: `C:\leads\audit\reconciliation\backtest_v2_results.json`
> Audit date: 2026-08-19 · Data: `data/deals.json` (12,642 deals; 11,951 apartments; range 1998-02-06 → 2026-06-08)
> Mandate: read-only on all source/data; outputs live only under `audit/reconciliation/`. No production file was modified.

Every claim below is tagged **VERIFIED** (reproduced from code/data), **LIKELY** (strong inference), **UNKNOWN**, or **NOT TESTED**.

---

## 0. Executive summary

- **V1 leaked in three independent ways** (future comparables in the pool, cutoff anchored to a fixed audit date, and a JS re-implementation rather than the real engine). All three are **VERIFIED** from `audit/backtest.js`. The alternate-representation concern (c) is **VERIFIED present in the data but LIKELY low-impact** for V1's apartment run (see §2c).
- **V2 runs an audit-only adapter, not the real `valuate()`.** Executing the real function leak-free is impossible without editing production (`valuation.ts` anchors every window to `new Date()`; `store.ts` exposes no seam to inject a date-bounded dataset). Reasons documented in §3.
- **Apartment headline, leak-free, V1-comparable cohort** (2023–2024 targets, `pricePerSqm ≥ 8000`, N = 3,650): **median APE 10.4%**, mean MAPE 16.5%, **±10% = 48.3%**, **±20% = 73.6%**, **inside interval = 39.6%**, directional bias **−₪146,000 median (68% under-estimated)**.
- **V2 looks "worse" than V1 on every accuracy metric, and that is the point:** V1's numbers were inflated by leakage. The honest, leak-free engine under-estimates in a rising market because it may only use past (cheaper) comparables. **VERIFIED**, explained in §7.
- **Geo-cohort breakdown is NOT geographically meaningful.** All 12,642 deals collapse onto **21 coordinate centroids (one per neighborhood)** — **VERIFIED**. Within a neighborhood every pairwise distance is 0 m, so building/street/radius geo tiers are indistinguishable. Reported in §6.

---

## 1. What V1 did (baseline under audit)

`audit/backtest.js` = leave-one-out over 2023–2024 apartment deals, every-5th subsample (717 of 3,663), pool = `deals.filter(d => d.id !== target.id)`, valuation via an inline JS re-implementation. Reported headline (`06_VALUATION_BACKTEST.md`): MAPE 12.8%, ±10% 61.5%, ±20% 83.3%, inside-interval 53.3%, 100% `building` scope.

---

## 2. V1 leakage diagnosis (each concern confirmed/refuted with evidence)

### (a) Are future transactions (`dealDate >= target.dealDate`) excluded from the comparable pool? — **NO. LEAK VERIFIED.**
`backtest.js:313` builds the pool as `deals.filter((d) => d.id !== target.id)` — the **only** exclusion is the target's own id. The single date filter inside the re-implementation is a **lower** bound: `d.dealDate >= cutoffGeo` (`backtest.js:75`, and each `WINDOWS` cutoff at `:91`). There is **no upper bound** tying comparables to `target.dealDate`. Consequently, for a target sold in 2023, comparables from 2024, 2025 and 2026 are freely used. This is the dominant leak: in a rising market the model sees the property's *own future price level*.

### (b) Is the cutoff anchored to a fixed audit date instead of `target.dealDate`? — **YES. VERIFIED.**
`backtest.js:37-41`: `cutoffISO(months)` = `new Date("2026-08-19")` minus `months`. Every window (60/48/24/12/6) is measured from the **fixed audit date 2026-08-19**, never from `target.dealDate`. So the 60-month "geo" pool for a 2021 target is 2021-08…2026-08 — i.e. almost entirely *after* the target. The rolling window is anchored to "today", not to T.

### (c) Is only `target.id` removed, leaving alternate representations of the same transaction in the pool? — **VERIFIED present in data; LIKELY low-impact for V1's apartment run.**
- Only `target.id` is removed (`:313`). **VERIFIED.**
- The data **does** contain alternate representations: **1,491 groups** share identical `(street|houseNumber|dealDate|price)`; **1,488 of them are the same transaction registered under two overlapping `neighborhoodId`s** (three near-clone neighborhood pairs: פרדס הגדוד↔כוכב הצפון, נאות הרצל↔מרכז העיר צפון, רמת אפרים↔נוף השרון). Every id is unique because the id embeds `areaSqm`. **VERIFIED.**
- Impact on V1: V1's re-implementation filters the pool by `d.neighborhoodId === target.neighborhoodId` (`backtest.js:73`) and never implements the city-wide / cross-neighborhood fallback. The twin lives under a *different* `neighborhoodId`, so it does not enter the same-neighborhood estimate. Only **3 duplicate groups share the same `neighborhoodId`**. Hence the alternate-representation leak is real but **LIKELY negligible** in V1's specific apartment path. It becomes material for any path that crosses neighborhoods (production step 5), which V1 omitted.

### (d) Was production `valuate()` executed, or a separate re-implementation? — **RE-IMPLEMENTATION. VERIFIED.**
`backtest.js:60-277` is a standalone JS port. Its own header says "JavaScript re-implementation of lib/valuation.ts", and `06_VALUATION_BACKTEST.md` lists omissions: no cross-neighborhood city-wide fallback, no composite model, apartments only. So V1 tested a *copy* of the logic, not the shipping engine.

**V1 verdict: methodologically invalid for accuracy claims.** Its headline metrics are optimistic because (a)+(b) let each estimate peek at the future — including the market level of the target's own sale.

---

## 3. V2 parity: adapter vs. real engine

**V2 uses an audit-only adapter** (`backtest_v2.mjs`), a faithful port of the production **apartment** comparable-selection + percentile logic, driven per-target by an as-of clock T = `target.dealDate`. It does **not** call the real `valuate()`. Why the real function cannot be run leak-free without editing production:

1. **Time anchor is hard-wired to `new Date()`.** `valuation.ts:106-110` `cutoffDate()` and `store.ts:299-303` `monthsAgoISO()` both compute cutoffs from the system clock. There is no "as-of T" parameter. Anchoring windows to each target's own date (a leak-free requirement) would require editing these functions. **VERIFIED.**
2. **No dataset-injection seam + no upper date bound.** `valuate()` pulls the whole dataset through `getStore()`; the local store caches deals in a module-private `_localDeals` and returns a private `_store` singleton (`store.ts:50, 305-310`) — nothing accepts an injected, date-bounded array. Its filters are lower-bound only (`store.ts:87` `d.dealDate < cutoff` rejects *older* deals; nothing rejects deals **after** T). To remove future deals we must hand the store a pre-filtered dataset, which it offers no hook for. **VERIFIED.**

Both fixes require modifying `valuation.ts`/`store.ts`, which the audit mandate forbids. Therefore the adapter is the correct instrument. (Monkey-patching the global clock could address #1, but #2 still forces a dataset-level filter that the store cannot accept — so a partial real-engine run would still leak. Full parity is not reachable read-only.)

### Adapter fidelity — ported verbatim from `valuation.ts`
Constants (`GEO_MONTHS 60`, `WINDOWS [6,12,24,48]`, `MIN_DEALS_* `, `AGE_TOLERANCES`, `BUILDING_RADIUS 60`, `STREET_RADIUS 350`, ladder `[500]`, `MIN_PPSQM apartment 8000`, `HOUSE_NUMBER_RANGE 12`, `AREA_TOLERANCE_RATIO 0.5`, `FLOOR_TOLERANCE 2`), the `percentile()` interpolation, street normalization regex, the full text hierarchy (exact-building → ±12 near-street → full street), the city-wide text fallback, the geo hierarchy (60/350/500), the cross-neighborhood step-5 fallback, the floor/area filters, the scope→percentile map (building 20/80, street 25/75, else 33/67), and `estimate = round(size × percentile)` for apartments. `itmDistance` = `Math.hypot`, identical to `govmap.ts`.

### Deviations from production (all intentional, all documented)
- **#LF-1 (leak-free time anchor):** all cutoffs computed from **T**, not `new Date()`. This is the corrective change, not a fidelity gap.
- **#LF-2 (leak-free upper bound):** the pool is `dealDate < T` (strict). Production has no upper bound because in production the DB only holds deals up to "now".
- **#LF-3 (leak-free on the city-wide fallback):** production's city-wide text fallback (`valuation.ts:254-272`) filters city deals by `propertyType` only, **with no date bound**. The adapter adds `dealDate < T` there too; otherwise this path would re-introduce future leakage.
- **#P-1 (scope only):** the adapter computes only the *estimate math* (low/mid/high, scope, basedOn, confidence). It does **not** build `comparableDeals`, `priceTrend`, or `renewal` — those are display fields (`valuation.ts:537-547`) that never affect the estimate. No fidelity loss for accuracy metrics.
- **#P-2 (apartments only):** the composite house/land model (`valuation.ts:462-515`) is not ported; houses and land are handled in §8, never mixed into apartment metrics.
- **#P-3 (display augmentation skipped):** the city-wide exact-building *display* augmentation (`valuation.ts:404-439`) only mutates `displayDeals`, never the `ppsqm` used for the estimate — correctly omitted.

Adapter parity is therefore **VERIFIED** for the apartment estimate math, modulo the three leak-free corrections (#LF-*) that are the entire purpose of V2.

---

## 4. V2 methodology

**Leak-free rules (enforced in `valuateAsOf`):**
- For a target at T, **no comparable may have `dealDate >= T`** (strict `<`). All windows (`GEO_MONTHS`, `WINDOWS`, step-5, city-fallback) are computed relative to T.
- **Target + alternate-representation exclusion.** `isAlternateOf()` drops any deal with the same `street` + `houseNumber` + price (±0.5%), `dealDate` within ±7 days and `areaSqm` within ±3 m², regardless of id/neighborhoodId. Because exact duplicates share T, the strict `< T` bound already removes them; this rule is belt-and-suspenders for near-date re-registrations. **Alternates are never deleted from source — only skipped in-memory.**
- **Cohort 1 = apartments only.** Houses/land are excluded from every apartment metric (§8).

**Sample: ALL eligible apartment targets — no subsampling.** Eligible = `propertyType` apartment, `areaSqm > 0`, `price > 0`, valid `dealDate` → **11,759 targets**. Targets are **not** pre-filtered by `pricePerSqm` (that would bias the universe); the 8000 floor applies only to the comparable pool, exactly as production does. Deterministic, no `every-Nth` ordering risk. Runtime ≈ 18 s.

---

## 5. Apartment cohort metrics (leak-free)

`N eligible = 11,759 · N evaluated = 11,328 · N null = 431 (3.7%)`. **VERIFIED.**

> **Read the median, not the mean, as the headline.** Mean MAPE is dominated by below-market outliers: **996 targets (8.8%) have APE > 50%, and 75.6% of those are below-market** (mid > actual) — partial-ownership, family, or rights transfers that clear the 8000 floor but are not open-market sales. Mean MAPE (16.5%–178% depending on cohort) is a metric artifact of ratio-averaging a heavy right tail; **median APE (~10–12%) is the robust central accuracy.** **VERIFIED / LIKELY interpretation.**

| Metric | All years (N=11,328) | 2023–2024 (N=3,766) | **V1-comparable** 2023–24, ppsqm≥8000 (N=3,650) |
|---|---|---|---|
| MAE | ₪807,282 | ₪1,309,578 | ₪498,277 |
| Median AE | ₪238,000 | ₪282,000 | ₪272,000 |
| Mean MAPE | 107.0% | 178.6% | **16.5%** |
| **Median APE** | **11.5%** | **11.1%** | **10.4%** |
| within ±5% | 25.4% | 27.3% | 28.2% |
| within ±10% | 45.2% | 46.8% | **48.3%** |
| within ±15% | 59.8% | 60.8% | 62.7% |
| within ±20% | 70.2% | 71.3% | **73.6%** |
| **% actual inside [low,high]** | 35.7% | 38.4% | **39.6%** |
| Median signed err (mid−actual) | −₪107,000 | −₪135,000 | **−₪146,000** |
| Mean signed err | +₪176,064 | +₪554,827 | −₪280,461 |
| % over-estimated | 35.3% | 33.6% | 31.5% |
| % under-estimated | 64.4% | 66.0% | **68.1%** |

**Directional bias — VERIFIED:** the leak-free engine **under-estimates** (median mid−actual ≈ −₪146k; ~68% of estimates below actual). Expected: with only past comparables in a rising Netanya market, the ₪/m² percentile pool sits below the price level at T. (The *mean* signed error flips positive on the all-years/2023-24 columns only because a few extreme below-market targets produce huge positive mid−actual residuals — the same outliers that inflate mean MAPE.)

---

## 6. Breakdowns (all-years evaluated cohort, N=11,328)

### By year (selected)
| Year | n | Median APE | ±10% | ±20% | inside | med signed err |
|---|---|---|---|---|---|---|
| 2019 | 178 | 9.4% | 52.8% | 82.6% | 37.6% | −59,500 |
| 2020 | 368 | 8.6% | 54.6% | 75.5% | 39.1% | −28,000 |
| 2021 | 1,046 | 10.9% | 47.1% | 74.4% | 35.2% | −95,000 |
| 2022 | 1,627 | 12.4% | 41.6% | 68.7% | 32.5% | −144,000 |
| 2023 | 1,364 | 13.0% | 42.1% | 67.2% | 34.2% | −90,750 |
| 2024 | 2,402 | 10.2% | 49.5% | 73.6% | 40.8% | −147,000 |
| 2025 | 2,220 | 10.2% | 49.1% | 71.9% | 38.6% | −92,500 |
| 2026 | 783 | 12.1% | 43.2% | 64.6% | 32.7% | −157,000 |

Pre-2015 years have tiny n (5–170) and behave erratically (thin/old pools); full table in the JSON. Median signed error is negative in essentially every modern year → persistent rising-market under-estimation.

### By neighborhood (selected extremes)
| Neighborhood | n | Median APE | ±20% | inside |
|---|---|---|---|---|
| נוף הטיילת | 393 | 7.3% | 84.2% | 44.5% |
| נוף השרון | 453 | 7.2% | 83.0% | 39.5% |
| קריית השרון | 483 | 6.6% | 81.8% | 37.3% |
| כוכב הצפון | 452 | 8.4% | 83.4% | 37.4% |
| מרכז העיר צפון | 2,806 | 14.4% | 63.2% | 34.7% |
| נאות הרצל | 437 | 19.7% | 50.6% | 35.9% |
| נאות שקד | 455 | 16.7% | 56.5% | 23.1% |

All 21 neighborhoods are in the JSON. Homogeneous, high-turnover neighborhoods (נוף הטיילת, קריית השרון) predict best; heterogeneous ones (נאות הרצל/שקד) worst.

### By compSearchScope — **geo tiers are NOT geographically meaningful (see note)**
| Scope | n | Median APE | ±10% | ±20% | inside |
|---|---|---|---|---|---|
| building | 9,290 | 10.5% | 48.1% | 73.6% | 38.6% |
| street | 20 | 15.4% | 35.0% | 60.0% | 50.0% |
| radius | 2,018 | 17.4% | 32.1% | 54.9% | 22.2% |

### By resolution path (how the pool was actually selected)
| Path | n | Median APE | ±20% | inside |
|---|---|---|---|---|
| text-exact-building | 3,952 | 9.6% | 77.5% | 35.9% |
| geo-building | 5,332 | 11.3% | 70.7% | 40.6% |
| geo-radius(350) | 1,546 | 16.2% | 57.4% | 23.6% |
| geo-radius(60) | 107 | 15.0% | 57.9% | 24.3% |
| city-text-street | 20 | 15.4% | 60.0% | 50.0% |
| city-text-building | 6 | 11.7% | 66.7% | 50.0% |
| cross-neighborhood(500/750/1000) | 365 | 24–34% | 29–47% | 7–18% |

**Text-anchored building matches are the most accurate path; cross-neighborhood fallbacks are the least (thin pools, worst outliers).**

### By confidence · comparables · size · comp-age
- **Confidence:** high (n=2,980) med APE 10.9%, inside 42.2%; medium 10.8%, 37.7%; low (n=5,658) 12.2%, 31.4%. More comparables → better coverage. **VERIFIED.**
- **# comparables:** 3–4 → med APE 13.7%, inside 27.1%; 50+ → 11.3%, inside 42.3%. Monotonic in coverage.
- **Size band:** best 120–149 m² (med APE 8.1%, ±20% 80.2%); worst <60 m² (med APE 24.3%, ±20% 40.6%) — small units are heterogeneous and outlier-prone.
- **Comparable age:** <12 mo (n=6,155) med APE 9.2%, ±20% 76.7%; 36 mo+ med APE 17.7%, ±20% 56.3%. Fresher comparables predict markedly better → supports temporal weighting.

### Geo-cohort testability — **explicit finding (VERIFIED)**
`data/deals.json` contains exactly **21 unique coordinate pairs for 21 neighborhoods** — one centroid per neighborhood, every deal in a neighborhood sharing it. Within a neighborhood all pairwise `itmDistance` = 0, so `filterByRadius(60)`, `(350)`, `(500)` return the *identical* located pool. **The building/street/radius geo tiers cannot be distinguished by real proximity.** The `geo-building` vs `geo-radius(*)` split above is an artifact of age-filter counts and text-fallback ordering, **not** geography. Cross-neighborhood step-5 uses inter-centroid distances (min 461 m; the three duplicate-twin pairs are 700–834 m apart), so it pulls whole adjacent neighborhoods, not nearby addresses. **Any geographic interpretation of the geo cohorts would be fabricated; real per-deal geocoding is required before geo tiers can be evaluated.**

---

## 7. V1 vs V2 — and why they differ

| Metric | V1 (leaky, `06_…md`) | V2 leak-free, V1-comparable cohort | Δ |
|---|---|---|---|
| Target universe | 2023–24 apt, ppsqm≥8000, every-5th (717) | 2023–24 apt, ppsqm≥8000, **all** (3,650) | — |
| MAPE (mean) | 12.8% | 16.5% | +3.7 pp |
| Median APE | (not reported) | 10.4% | — |
| within ±10% | 61.5% | 48.3% | **−13.2 pp** |
| within ±20% | 83.3% | 73.6% | **−9.7 pp** |
| inside interval | 53.3% | 39.6% | **−13.7 pp** |
| directional bias | (not reported) | −₪146k median, 68% under | — |

**Do not read V2 as "the model got worse."** The engine is unchanged; the *measurement* got honest. The deltas are fully explained by methodology, not by any code change:

1. **Future-comparable leakage removed (V1 bug a+b).** V1 let each estimate use comparables sold *after* the target — including 2024–2026 prints for a 2023 target, at the target's own (or higher) price level. Removing them is exactly why ±10/±20/inside all drop: the easy information is gone. This is the single largest driver. **VERIFIED.**
2. **Rising-market under-estimation exposed.** Once only past comparables are allowed, estimates fall below actuals in an appreciating market (median bias −₪146k, 68% under). V1's symmetric-looking coverage was an artifact of straddling the target with future comps. **VERIFIED.**
3. **Full-census vs subsample.** V2 evaluates all 3,650 targets vs V1's 717; more of the below-market tail is included, nudging mean MAPE up (median APE stays ~10–11%, showing the central mass is stable). **VERIFIED.**
4. **Fuller engine port.** V2 adds the city-wide and cross-neighborhood fallbacks V1 omitted; these serve the thin-pool tail and carry the worst accuracy (cross-neighborhood inside 7–18%), slightly lowering aggregate coverage but faithfully reflecting production. **VERIFIED.**

**Conclusion: V2's ±10% ≈ 48%, ±20% ≈ 74%, inside ≈ 40%, median APE ≈ 10–11% is the defensible estimate of real-world accuracy for the apartment engine.** V1's 61.5/83.3/53.3 were optimistic by ~10–14 points due to look-ahead leakage.

---

## 8. Houses & land (reported separately — never mixed into apartment metrics)

- Counts (**VERIFIED**): 391 houses, 300 land in `deals.json`.
- Accuracy: **NOT TESTED** in this pass. Houses/land use the production **composite** model (`valuation.ts:462-515`: built + 0.4×plot, ₪ per composite m², `MIN_COMPOSITE_DEALS 6`, `HOUSE_MAX_PPSQM_BUILT` sanity, house/land `MIN_PPSQM` 12000/800), which the apartment adapter does not port (deviation #P-2). A leak-free composite backtest is a separate, well-scoped follow-up; mixing them into the apartment cohort would violate the cohort rule, so they are excluded here by design.

---

## 9. Threats to validity / honest caveats

- **Adapter, not the shipping function.** Parity is argued line-by-line (§3) and is strong for apartment estimate math, but it is a port; a byte-identical guarantee would need a refactor of `valuation.ts`/`store.ts` to accept an as-of parameter (out of audit scope). **LIKELY equivalent, not VERIFIED-identical.**
- **`pricePerSqm` is taken as stored**, not recomputed — matches production, but inherits any harvest-time rounding.
- **Below-market transactions remain in both target and comparable pools** above the 8000 floor; they are the primary error source. Raising the apartment floor (e.g. to ₪11,000) would trim the tail — but that is a *model* change, out of audit scope, and would also shrink the target universe.
- **Geo cohorts untestable** until real geocoding exists (§6). No geographic accuracy claim is made.
- **Interval coverage ≈ 40%** vs a nominal P20–P80 (~60% under normality): the ₪/m² distribution is right-skewed and, leak-free, the interval sits below actuals in a rising market — so true coverage is well under nominal. Interval widths are **not** calibrated. **VERIFIED.**

---

## 10. Reproduce

```
node C:\leads\audit\reconciliation\backtest_v2.mjs
```
Reads `data/deals.json` read-only; prints all metrics/breakdowns; writes `audit/reconciliation/backtest_v2_results.json`. Deterministic (no randomness, no sampling).
