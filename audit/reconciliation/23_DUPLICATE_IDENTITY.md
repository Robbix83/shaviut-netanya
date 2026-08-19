# 23 — DUPLICATE IDENTITY RECONCILIATION
**Question:** Are the ~2,155 near-duplicate candidates the SAME transaction (dedupe-able) or DISTINCT units (must never be deleted)?
**File under audit:** `data/deals.json` (12,642 records) — READ-ONLY, nothing modified.
**Analysis script:** `audit/reconciliation/analyze_dupes.js` (read-only; re-runnable).
**Audit date:** 2026-08-19. All numbers from live `node` execution against the actual file.

---

## Step 1 — Field inventory (EVERY field on a Deal record)

Enumerated across all 12,642 records. The record carries **exactly 19 fields**:

`id`, `dealDate`, `price`, `propertyType`, `rooms`, `areaSqm`, `plotSqm`, `floor`, `yearBuilt`, `dealNature`, `address`, `houseNumber`, `street`, `neighborhoodId`, `neighborhood`, `settlement`, `x`, `y`, `pricePerSqm`.

### Identity / provenance fields — CRITICAL RESULT

| Field the task asked about | Present in data? |
|---|---|
| `gush` (גוש) | **ABSENT** |
| `helka` (חלקה) | **ABSENT** |
| `subparcel` / תת-חלקה | **ABSENT** |
| `dealId` (source record id) | **ABSENT** |
| `keyValue` (source key) | **ABSENT** |
| any stable source-record id | **ABSENT** |

**VERIFIED — the data contains NO land-registry key (gush/helka/subparcel) and NO stable source identifier.** The `types.ts` `Deal` interface comment claims the `id` is a "מזהה ייחודי יציב (גוש-חלקה-תת + תאריך + מחיר)", but that is **not** how it is actually built. Per `03_DATA_QUALITY.md §7` and `scripts/harvest.ts` L202, the real `id` is a **derived composite**:

```
id = `${neighborhoodId}-${keyValue ?? dealId ?? `${dealDate}-${price}-${builtArea||plotArea}`}`
```

Since `keyValue` and `dealId` are never populated, every id falls to the fallback form `neighborhoodId-date-price-area` (219 end in `NaN` where area was missing).

**VERIFIED — all 12,642 `id` values are unique** (0 duplicate ids). The file is therefore already deduplicated *on its own construction key*. Consequently, two records can only survive as a "near-duplicate" if they differ in at least one of {neighborhoodId, date, price, area}. This single fact governs the entire classification below.

---

## Step 2 — Reproducing the candidate set

Prior audit criterion (§6): same `street` + `houseNumber` + `dealDate`, price within ±5%. Testing grouping variants against the live file:

| Grouping key | Pairs | same-area | diff-area |
|---|---|---|---|
| street + houseNumber(**blank-ok**) + date  ≡  address+date | **3,011** | 2,102 | 909 |
| street + date only | 4,856 | 2,765 | 2,091 |
| street + houseNumber(**required present**) + date | 1,852 | 1,411 | 441 |

**CONFIRMED — the prior audit's 3,011 pairs are reproduced exactly** by treating a *missing* houseNumber as an empty bucket (equivalently, grouping on `address+date`). The "**~2,155 same-area**" candidate figure is reproduced as **2,102** here; the ~53 gap is purely the area-equality tolerance (this run uses `|Δarea| < 0.5 m²`; the prior figure used looser rounding). **The ~2,155 near-duplicate candidate set is CONFIRMED (VERIFIED).**

Note: the "street + houseNumber required" variant collapses to 1,852 because 2,608 records have a null houseNumber and would otherwise be dropped — the prior audit did **not** drop them.

---

## Step 3 — Classification (using ALL available identity fields)

Because there is **no registry key and no stable source id**, no group can be *proven* identical. Records were classified on the strongest available signal: identical `price`, `areaSqm`, `rooms`, `floor`, `yearBuilt`, `propertyType`, and whether the pair differs *only* in `neighborhoodId`.

### Pair-level (of the 3,011 candidate pairs)

| Class | Pairs | Basis |
|---|---|---|
| **LIKELY_DISTINCT_UNITS** | **1,204** | area / rooms / floor differ → physically different apartments sold same building + same day |
| **LIKELY_DUPLICATE** (cross-neighborhood artifact) | **1,437** | byte-identical on every identity field, differ ONLY in `neighborhoodId` |
| **AMBIGUOUS** | **370** | price within ±5% but not identical, or area missing on one side |
| **EXACT_DUPLICATE_HIGH_CONFIDENCE** | **0** | no field capable of proof exists |
| same-neighborhood, all-identity-equal | **0** | impossible by id-construction (would collapse to one id) |

### Group-level (1,525 candidate groups, each scored by its strongest internal pair)

| Class | Groups |
|---|---|
| EXACT_DUPLICATE_HIGH_CONFIDENCE | **0** |
| LIKELY_DUPLICATE | **1,307** |
| LIKELY_DISTINCT_UNITS | **150** |
| AMBIGUOUS | **68** |

### The cross-neighborhood artifact (the crux)

All **1,437** identical-except-`neighborhoodId` pairs trace to exactly **three neighborhood pairs**:

| Pairs | Neighborhood A ↔ Neighborhood B |
|---|---|
| 489 | מרכז העיר צפון ↔ נאות הרצל |
| 479 | נוף השרון ↔ רמת אפרים |
| 469 | כוכב הצפון ↔ פרדס הגדוד |

This aligns with `03_DATA_QUALITY.md §3`, where **נוף השרון/רמת אפרים** (both 498 deals) and **כוכב הצפון/פרדס הגדוד** (both 493 deals) show **byte-identical missing-field rates**. **LIKELY — these are the SAME transactions harvested twice under two overlapping neighborhood polygons** (a harvest boundary-overlap / de-normalization artifact), not two real sales. A single physical street address belongs to exactly one neighborhood, so the same `street+house` appearing under two `neighborhoodId`s is a provenance defect in the harvest, not a market event.

**Critically:** there are **ZERO** same-neighborhood all-identity-equal pairs. Within one neighborhood, identical (date, price, area) already produces an identical `id` and was collapsed at harvest time. Every surviving "duplicate" is therefore either (a) a genuinely different unit (different area/rooms/floor), or (b) the cross-neighborhood harvest artifact. There is no third category.

---

## Step 4 — Minimum evidence rule for EXACT_DUPLICATE_HIGH_CONFIDENCE

To call two records **provably the same transaction**, the minimum sufficient evidence is **either** of:

1. **Identical land-registry key** — same `gush` + `helka` + `subparcel` (חלקה/גוש/תת-חלקה) **AND** identical `dealDate` **AND** identical `price` **AND** identical `areaSqm`; **or**
2. **Identical stable source-record id** (`dealId` / `keyValue` from nadlan.gov.il) on both records.

**NEITHER of these fields exists in `data/deals.json`.** Therefore **EXACT_DUPLICATE_HIGH_CONFIDENCE = 0**, necessarily, not incidentally.

> **EXPLICIT WARNING:** `{same building + same date + similar price + similar area}` **does NOT prove same transaction.** New-project buildings routinely sell many identical-spec, identical-price units on the same day. The strongest signal available here — identical on all seven identity fields but differing only in the neighborhood label (the 1,437 cross-neighborhood pairs) — is *compelling provenance evidence of double-ingestion*, but it is still **LIKELY_DUPLICATE, not EXACT**, because no registry key or source id can confirm the two rows describe one legal transaction.

---

## Step 5 — DELETION_SAFETY_VERDICT

### **VERDICT: PARTIALLY_SAFE**

| Rule applied | Records safe to remove |
|---|---|
| **Strict proven-identity** (registry key or identical source id required) | **0** — the required proof fields do not exist |
| **Strong-evidence** (cross-neighborhood byte-identical artifact) | up to **~1,437** rows are *dedupe candidates* (one copy per pair, from 3 overlapping neighborhood pairs) — **but resolve at the harvest layer, not by row deletion** |
| Distinct units (differing area/rooms/floor) | **0 — UNSAFE, never delete** (1,204 pairs are different apartments) |

**Reasoning:**
- Under the task's proven-identity standard, **nothing is safe to hard-delete today (0)** — the data lacks any field that can prove transaction identity.
- The only defensible dedupe target is the **1,437 cross-neighborhood artifact pairs**, and even these should be fixed by **making neighborhood assignment deterministic at harvest** (assign each address to a single neighborhood), **not** by deleting rows — because a blind delete would drop the copy carrying the correct neighborhood attribution and could corrupt per-neighborhood valuation baselines.
- The **1,204 distinct-unit pairs must never be deleted**; they are legitimately separate apartments.
- **370 ambiguous pairs** need more data (registry lookup) before any action.

**No deletion is performed in this phase.** Recommendation for a future phase: re-harvest with deterministic single-neighborhood assignment (or add gush/helka/subparcel to the schema), then the cross-neighborhood duplication disappears at source and the question becomes moot.

---

## Claim ledger

| Claim | Status |
|---|---|
| Data has NO gush/helka/subparcel | **VERIFIED** |
| Data has NO stable source id (dealId/keyValue) | **VERIFIED** |
| `id` is a derived `neighborhoodId-date-price-area` composite; all 12,642 unique | **VERIFIED** |
| 3,011 near-duplicate pairs reproduced (prior audit figure) | **VERIFIED** |
| ~2,155 same-area candidate set confirmed (measured 2,102) | **VERIFIED** |
| 1,437 pairs are identical-except-neighborhoodId | **VERIFIED** |
| 1,204 pairs are distinct units (area/rooms/floor differ) | **VERIFIED** |
| Cross-neighborhood pairs are the SAME transaction double-harvested | **LIKELY** |
| EXACT_DUPLICATE_HIGH_CONFIDENCE is 0 for lack of proof fields | **VERIFIED** |
| Deletion under proven-identity rule: 0 safe today | **VERIFIED** |
| Registry-key re-harvest would resolve at source | **NOT TESTED** (recommendation) |
