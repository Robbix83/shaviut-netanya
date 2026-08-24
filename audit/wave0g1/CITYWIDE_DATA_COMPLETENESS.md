# Wave 0G-1 — Netanya Deal Data Completeness Audit

**Audit only. No application source, deal data, Supabase state, or importer was touched. No deployment. No harvest run.**

Trigger: Wave 0F-3A proved 5 real "עובד בן עמי 41" government transactions are completely absent from our 12,642-row dataset. This audit asks the larger question the operator raised: is Netanya transaction coverage broadly complete, materially incomplete, or severely incomplete?

All source data for this audit: `data/deals.json` (SHA-256 `18b3796e8f1c...11a8f`, 12,642 rows, verified fresh in this session — not assumed from any prior wave), `data/street-index.json`, `data/netanya-streets-raw.json` (the 1,048-entry official municipal street registry, all carrying a municipal `code`), `data/neighborhoods.json`. Read-only diagnostic script: `scripts/audit-wave0g1.ts` (new, this wave — not part of the application runtime).

---

## Executive Verdict

**MATERIAL_GAPS.**

Two separate, independently-provable defects were found, one of them a major, previously-unknown discovery:

1. **A likely acquisition-time ~500-row cap.** 18 of the city's 22 neighborhoods (82%) land in a narrow 490–500 total-deal band, 13 of them at *exactly* 500. Only 3 neighborhoods fall clearly outside that band — one far above (`מרכז העיר צפון`, 3,010), two clearly below (`נאות שקד` 455, `נווה איתמר` 205). A cluster this tight, across this many independently-sized real neighborhoods, is not plausible as genuine market volume — it is the same *class* of defect already proven at the runtime query layer in Waves 0C-2B/0E-2A (PostgREST's silent 1000-row cap), but at the **acquisition layer** (the Playwright scroll-collector in `scripts/harvest.ts`), with an apparent ~500-row ceiling, and it has never been fixed or even previously identified. This is the single largest, best-evidenced finding of this audit.
2. **Confirmed the Ben Ami 41 pattern is not isolated**: `דירת נופש` (vacation-apartment) transactions are extremely sparse citywide (15 rows in 28 years, across the entire dataset) despite not being excluded by the importer — consistent with, not contradicting, systematic under-collection of this transaction category specifically, on top of the general ~500-row cap.

Address-field quality (79.4% valid street, 20.6% literal `"0"` placeholder) and the one anchored official-benchmark comparison available in this session (our aggregate apartment counts exceed a second-hand-only CBS subset for two recent 3-month windows) do **not** on their own indicate severe citywide gaps at the aggregate level — the concern this audit surfaces is concentrated, structural, and street/neighborhood-specific, not a uniform citywide shortfall.

---

## Canonical Dataset Baseline

Verified fresh in this session (not trusted from prior claims):
```
TOTAL_DEALS = 12,642
DATE_RANGE = 1998-02-06 -> 2026-06-08
APARTMENT = 11,951   HOUSE = 391   LAND = 300   (sums exactly to 12,642)
```
Matches the prior baseline claim exactly. `SHA256 = 18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f`.

---

## Annual Deal Counts

Full table: `audit/wave0g1/yearly_counts.csv`. Highlighted years:

| YEAR | TOTAL | APT | HOUSE | LAND | VALID_STREET | STREET_0 | YoY% |
|---|---|---|---|---|---|---|---|
| 2019 | 199 | 186 | 6 | 7 | 164 | 35 | +25.9% |
| 2020 | 406 | 377 | 21 | 8 | 326 | 80 | +104.0% |
| 2021 | 1,120 | 1,064 | 37 | 19 | 922 | 198 | +175.9% |
| 2022 | 1,749 | 1,666 | 49 | 34 | 1,282 | 467 | +56.2% |
| 2023 | 1,478 | 1,399 | 41 | 38 | 1,197 | 281 | −15.5% |
| 2024 | 2,556 | 2,452 | 46 | 58 | 1,772 | 784 | +72.9% |
| 2025 | 2,472 | 2,353 | 61 | 58 | 1,909 | 563 | −3.3% |
| 2026 YTD (through 2026-06-08) | 798 | 792 | 5 | 1 | 690 | 108 | −67.7%* |

\* 2026's YoY drop is a partial-year artifact (only ~5.3 months of data), not a real decline — see Monthly Continuity below.

**Abrupt discontinuity, not interpreted as COVID/market-cycle**: totals roughly *quintuple* from 2020 (406) to 2021 (1,120) and continue climbing sharply through 2022–2024. This pattern — years of thin, roughly-flat low-volume data followed by a sudden multi-year step-change — is the classic signature of **when the harvest campaign itself started/scaled up**, not a real Netanya market discontinuity. Pre-2021 data should be treated as a much thinner historical sample than 2021+ data, independent of the ~500-cap finding below.

---

## Monthly Continuity

Full table: `audit/wave0g1/monthly_counts.csv` (2021-01 through 2026-06, 66 months, zero gap months — every month has at least 1 deal).

**Most suspicious months found:**

| Month | Count | Why flagged |
|---|---|---|
| 2026-06 | 1 | Sharp cliff to near-zero — the dataset's actual freshness cutoff is mid-2026, not the session date (2026-08-24); this is a **data-freshness boundary**, not a market event |
| 2026-04 | 59 | Steep drop from 2026-02's 364 and 2026-03's 109 — consistent with the harvest run that produced this snapshot happening mid-month, truncating April/May/June | 
| 2026-05 | 77 | Same freshness-cutoff pattern as above |
| 2026-02 | 364 | Anomalous spike vs. neighboring months (2026-01=188, 2026-03=109) — more than double either neighbor; worth checking for a harvest run that landed disproportionately in this single month |
| 2024-12 | 421 | Highest single month in the entire 66-month series — plausible year-end registration rush, but also consistent with a harvest run timed in Dec 2024 capturing more than usual |
| 2022-06 | 319 | Second-highest spike, isolated (2022-05=126, 2022-07=115) — same pattern as above |
| 2025-07 | 281 | Notable local peak |
| 2023-10 | 46 | Lowest month in the 2023 range, isolated dip between 2023-09=89 and 2023-11=105 |
| 2024-04 | 205, 2024-07 | 278 — both notable local peaks inside an otherwise steadier run |

No exact-repeated-count pattern suggestive of a page-size API limit was found at the **monthly** level (unlike the neighborhood level — see below). The isolated spikes most likely correspond to individual `npm run harvest` runs landing unevenly across calendar months (this project's harvester is run manually, "once a month," per its own header comment) rather than a systematic monthly truncation.

---

## Property Type Coverage

Full `dealNature` distribution (30 distinct raw values, `audit/wave0g1/` — not written as a separate CSV per the required list but fully enumerated in the raw audit script output):

| dealNature | Count | First | Last |
|---|---|---|---|
| דירה בבית קומות | 8,810 | 1998-12-30 | 2026-06-08 |
| (null) | 2,206 | 1998-02-06 | 2026-05-27 |
| קרקע למגורים | 300 | 2004-06-16 | 2026-02-16 |
| קוטג' דו משפחתי | 294 | 2004-09-05 | 2026-03-24 |
| דירה | 208 | 2014-03-17 | 2022-10-17 |
| קומבינציה | 124 | 2015-02-01 | 2025-11-05 |
| ללא תיכנון | 120 | 2004-05-11 | 2026-03-09 |
| חנות | 95 | 2005-06-08 | 2026-02-17 |
| מחסנים | 90 | 2005-10-26 | 2026-01-22 |
| דירת גן | 87 | 2008-08-22 | 2026-04-23 |
| קוטג' חד משפחתי | 82 | 2003-11-27 | 2025-12-31 |
| משרד | 56 | 2005-05-17 | 2026-02-16 |
| דירת גג | 55 | 2008-09-23 | 2026-02-16 |
| מגורים | 17 | 2005-04-14 | 2022-10-20 |
| קוטג' טורי | 15 | 2006-09-10 | 2025-12-01 |
| **דירת נופש** | **15** | 2008-06-12 | 2026-02-17 |
| עסק | 12 | 2020-12-27 | 2021-12-28 |
| בית בודד | 12 | 2006-12-21 | 2025-05-21 |
| מלאכה | 9 | 2004-03-17 | 2022-09-13 |
| חניה | 8 | 2022-02-10 | 2026-02-11 |
| מסחרי + משרדים | 7 | 2023-05-02 | 2025-06-15 |
| מסחרי + מגורים | 6 | 2022-02-14 | 2025-06-22 |
| **מלונאות** | **4** | 2006-11-07 | 2024-07-04 |
| ...5 more single/low-digit categories | | | |

**Commercial/parking/storage categories exist and are collected** (חנות/office/מחסנים/חניה all present, in plausible-looking volumes). **Vacation/hotel categories exist but are extremely sparse**: `דירת נופש` + `מלונאות` = only 19 rows total, across 28 years, citywide. Confirmed via `scripts/harvest.ts`'s `classify()` (traced in Wave 0F-3A) that `דירת נופש` is not excluded — it is mapped straight to `propertyType: "apartment"`. **This is not automatically a bug** (the wave's own instruction) — it may genuinely reflect that vacation/timeshare-style sales are rare in nadlan.gov.il's own registry, or it may reflect the acquisition process under-collecting this specific category (as the Ben Ami 41 case, and the general ~500-cap finding below, both suggest is plausible). Not resolvable without either a live harvest test or external verification — flagged as an **unknown**, not asserted as proven either way.

No dedicated "rights/share transaction" category exists distinct from the ordinary apartment/house categories — partial-ownership rows are mixed in with ordinary sales, distinguished only after the fact by the `MIN_PPSQM` price-per-sqm floor (see Wave 0F-3A).

---

## Official Street Universe

```
OFFICIAL_STREET_COUNT = 1,048        (data/netanya-streets-raw.json — the municipal registry)
OFFICIAL_CODED_STREET_COUNT = 1,048  (100% of the registry carries a real municipal code)
DEAL_STREET_DISTINCT_RAW = 416
DEAL_STREET_DISTINCT_NORMALIZED = 416  (same as raw -- no alias collisions found beyond the 3 already known from Wave 0F-1)
```
Canonicalization used the exact same `normalizeStreet()` prefix-stripping logic as `lib/valuation.ts` (not `street-index.json` rewritten — analysis-only, in-memory).
```
OFFICIAL_STREETS_WITH_ANY_DEAL = 303 / 1,048  (28.9%)
OFFICIAL_STREETS_WITH_NO_DEALS_EVER = 745  (71.1%)
OFFICIAL_STREETS_WITH_DEAL_LAST_5Y = 293  (28.0%)
OFFICIAL_STREETS_WITH_ZERO_DEALS_LAST_5Y = 755  (72.0%)
```
**Per this wave's own explicit instruction, a street with zero recorded transactions is NOT automatically a data-collection defect** — Netanya has many short residential streets, industrial lanes, and streets named after individuals with genuinely low sale frequency. A ~29% "any activity" rate is not inherently implausible for a mid-size Israeli city's full street registry. This number is reported as a **coverage indicator**, not a proven gap — the coverage figure barely moves between "ever" (28.9%) and "last 5 years" (28.0%), which is itself unremarkable (no acceleration or degradation signal).

---

## Street Coverage

Full table: `audit/wave0g1/street_coverage.csv` (416 streets). Top 10 by volume: ד"ר יוסף בורג (384), נתן יונתן (327), בן צבי (294), ויצמן (292), הרב שמואל הרטום (280), קרן היסוד (242), אירוס הארגמן (238), ניצה (211), האלונים (180), יוספטל (174).

**Flagged patterns** (documented, not auto-classified as "missing" per this wave's instruction):
- **19 streets have ≥10 total deals but ≤2 distinct house numbers** — most explainable as new-tower developments (e.g. "ד"ר יוסף בורג": 384 deals, 3 house numbers, first deal 2021-10-31 — a handful of large new buildings each generating many unit sales, a normal profile). The **proven exception is "עובד בן עמי" itself** (65 deals, only 2 house numbers, first deal 2021-02-23) — now known from Wave 0F-3A to be an *incomplete* profile, not a genuine "few buildings" one. This list should be treated as a worklist for future spot-checks, not a closed finding.
- **Only 2 streets with ≥5 total deals have their data stop before 2020**: `חב"ד` (11 deals, last 2016-07-07) and `חיים לבנון` (9 deals, last 2012-05-20) — both plausibly genuine (very low-volume streets that simply haven't transacted recently), but unverified against any live source.
- **2,608 rows (20.6% of the entire dataset) carry the literal `street: "0"` placeholder** (see Address Quality below) — these rows are excluded from all street-level grouping above by construction, so the 416-street/303-covered-street figures are a **floor**, not the true count of distinct streets actually present in the data.

---

## Address/Data Quality

Global (12,642 rows):
```
VALID_STREET_ROWS = 10,034 (79.37%)      STREET_LITERAL_ZERO_ROWS = 2,608 (20.63%)
NULL_STREET_ROWS = 0 (0.00%)             EMPTY_STREET_ROWS = 0 (0.00%)
VALID_HOUSE_NUMBER_ROWS = 10,034 (79.37%)  NULL_HOUSE_NUMBER_ROWS = 2,608 (20.63%)   HOUSE_NUMBER_ZERO_ROWS = 0 (0.00%)
VALID_PRICE_ROWS = 12,642 (100.00%)
VALID_AREA_ROWS = 12,148 (96.09%)
VALID_ROOMS_ROWS = 12,342 (97.63%)
VALID_COORDINATES_ROWS = 12,642 (100.00%)
VALID_NEIGHBORHOOD_ID_ROWS = 12,642 (100.00%)
```
`street="0"` and `houseNumber=null` are always paired (confirmed, matches Wave 0F-2A/2C's finding exactly). Price, coordinates, and neighborhoodId are effectively 100% populated — the *only* material quality gap is the street/house-number placeholder.

**Is newer data cleaner?** Full table: `audit/wave0g1/data_quality.csv`.
```
2021: 82.3% valid street (17.7% "0")
2022: 73.3% valid street (26.7% "0")
2023: 81.0% valid street (19.0% "0")
2024: 69.3% valid street (30.7% "0")   <- worst year
2025: 77.2% valid street (22.8% "0")
2026: 86.5% valid street (13.5% "0")   <- best year (partial, only ~5 months)
```
**No, newer data is not consistently cleaner** — 2024 is the single worst year for street-placeholder contamination (30.7%), worse than 2021 (17.7%). The trend is noisy, not monotonic in either direction.

---

## Neighborhood Coverage

Full 22-neighborhood table printed in the raw audit output (not a required separate CSV; summarized here). Two findings:

**1. `street="0"` concentration is wildly uneven across neighborhoods** — not a uniform data-quality issue, concentrated in specific neighborhoods:
| Neighborhood | Total | street="0" | % |
|---|---|---|---|
| עין התכלת | 500 | 468 | **93.6%** |
| נוף הטיילת (Ben Ami's neighborhood) | 500 | 391 | **78.2%** |
| רמת חן | 500 | 237 | 47.4% |
| נוף השרון | 498 | 210 | 42.2% |
| רמת אפרים | 498 | 210 | 42.2% |
| נאות שקד | 455 | 0 | 0.0% |
| עיר ימים | 500 | 0 | 0.0% |
| משכנות זבולון (Hartom's neighborhood) | 500 | 1 | 0.2% |

Two neighborhoods (`עין התכלת`, `נוף הטיילת`) have such extreme `street="0"` contamination that a majority-or-near-majority of their own transaction history has no usable address at all — an independent quality problem layered on top of the volume-cap finding below, concentrated in specific neighborhoods rather than spread evenly citywide.

**2. The neighborhoodId-split pattern already proven for individual streets (Hartom, Wave 0E) is visible city-wide** — `DISTINCT_STREETS` per neighborhood (4 to 148) shows enormous variance not obviously explained by neighborhood size alone; a full audit of every such split was out of this wave's scope (would require cross-referencing every street against every neighborhood it appears under), but the mechanism is already proven real by two independent real cases (Hartom, Wave 0E-1B; Ben Ami, Wave 0F-3A).

---

## Dataset Concentration

```
TOTAL_STREETS_WITH_DEALS = 416    TOTAL_STREET_DEALS (excl. street="0" rows) = 10,034
TOP_10_STREETS = 26.1% of all street-attributable deals
TOP_25_STREETS = 43.5%
TOP_50_STREETS = 58.7%
MEDIAN_DEALS_PER_STREET = 9      P25 = 4   P75 = 24   P90 = 54   MAX = 384
```
Moderate concentration — the top 50 streets (12% of the 416 covered streets) account for 59% of volume, plausible for a real city where transaction activity naturally clusters around larger apartment buildings and busier corridors. Not extreme enough on its own to indicate acquisition bias; consistent with either genuine market concentration or a mild collection bias — **not distinguishable from this data alone**.

---

## Duplicate / Truncation Signals

```
DUPLICATE_TRANSACTION_IDS = 0
EXACT (date+price+area+street+houseNumber+neighborhood) DUPLICATE GROUPS = 0
```
No duplicate-row acquisition artifact found.

**The truncation signal is at the neighborhood level, and it is the headline finding of this audit:**
```
Neighborhoods with EXACTLY 500 total deals: 13 of 22
  אגמים, עין התכלת, עיר ימים, גבעת האירוסים, קריית השרון, קריית רבין,
  קריית צאנז, משכנות זבולון, נאות גנים, נאות הרצל, נוף הטיילת, רמת חן, מרכז העיר דרום
Neighborhoods with 490-498 (near 500): 5 more
  קריית נורדאו (490), כוכב הצפון (493), נוף השרון (498), פרדס הגדוד (493), רמת אפרים (498)
=> 18 of 22 neighborhoods (82%) land in a 490-500 band.
Neighborhoods clearly OUTSIDE that band: only 3
  מרכז העיר צפון = 3,010 (6x the band)   נאות שקד = 455   נווה איתמר = 205
```
A cluster this tight across 18 independently-sized real neighborhoods is not plausible as coincidental market volume — genuine per-neighborhood transaction counts would not cluster this narrowly around a round number. This is the same *defect class* already proven at the Supabase/PostgREST runtime-query layer (Waves 0C-2B, 0E-2A: a silent ~1000-row response cap) — but here it sits one layer earlier, in the **historical acquisition** itself (`scripts/harvest.ts`'s Playwright-based scroll-and-collect loop against nadlan.gov.il, `MAX_SCROLL_ROUNDS=200` / `SCROLL_IDLE_ROUNDS=4`). The most evidence-consistent explanation — offered as a hypothesis, not proven without a live harvest rerun (out of this audit's scope) — is that nadlan.gov.il's own street/neighborhood-level result list silently caps at (or the harvester's idle-detection stopped scrolling at) roughly 500 rows, and every neighborhood that genuinely has more than ~500 real transactions has had the remainder silently dropped. `מרכז העיר צפון` proves the harvester *can* collect more than 500 when the underlying data/site allows it — making the other 18 neighborhoods' clustering more suspicious, not less.

**This single finding likely explains a meaningful share of missing transactions city-wide, independent of and in addition to the Ben Ami 41 property-type question.**

---

## Official Citywide Benchmark

Full table: `audit/wave0g1/official_benchmark.csv`.

Attempted per the required priority order (CBS first). CBS press releases are published as compressed PDFs that this session's `WebFetch` tool could not parse into readable text (confirmed: attempted extraction of `cbs.gov.il/.../04_24_047b.pdf` returned only binary/structural metadata, not usable figures). A full clean 2021–2025 annual series was **not obtainable in this environment** with the tools available this session.

One genuine, citable CBS figure **was** recovered (via web search result text, not the PDF itself):
```
CBS: Netanya second-hand ("יד שנייה") apartment transactions
  Sep-Nov 2023:  188 official   vs.  230 in our dataset (all-source apartment sales)  -> 122.3%
  Dec 2023-Feb 2024: 324 official  vs.  489 in our dataset (all-source apartment sales) -> 151.0%
```
**This is not an apples-to-apples total-vs-total ratio** — CBS's figure is second-hand sales only; ours includes new-construction sales too (CBS reports those in a separate series this session could not retrieve). The ratio exceeding 100% is expected and not proof of completeness — it only rules out *severe* aggregate under-collection for these two specific windows (our all-source count already exceeds a same-city subset benchmark).

A secondary, non-official aggregator (`madadirot.co.il`) reports Netanya trailing-12-month apartment+house sales of 1,235 (prior year 2,212) — **explicitly not used as primary proof**, per this wave's instruction, shown for context only and not independently verified against CBS/tax-authority primary data.

```
PHASE 11 STATUS = PARTIAL — one real official data point obtained and compared; full 2021-2025 annual
  series not retrievable in this environment (PDF parsing not available to this session's WebFetch tool).
```
**Operator step to complete this phase**, if a full annual series is wanted: open each CBS press release PDF directly (e.g. `https://www.cbs.gov.il/he/mediarelease/DocLib/2024/047/04_24_047b.pdf` and the equivalent releases for other years/quarters, linked from `https://www.cbs.gov.il/he/mediarelease/pages/2024/...`) or use the Tax Authority's own real-estate data portal (`https://www.gov.il/he/service/real_estate_information`) filtered to Netanya, and extract the city-level annual figures directly (a human reader or a PDF-text-extraction tool, neither available to this session, would be needed).

---

## 10-Address Official Spot Check

**Constraint, confirmed directly in this session**: `nadlan.gov.il` is a JavaScript SPA behind reCAPTCHA v3 (confirmed by a live `WebFetch` attempt against a real nadlan.gov.il URL, which returned only the page shell/title, no transaction data — consistent with `scripts/harvest.ts`'s own extensive Playwright+stealth-plugin+persistent-Chrome-profile workaround, which exists specifically because a plain HTTP fetch cannot retrieve this site's data). This session has no browser-automation path to nadlan.gov.il. Per this wave's own Phase 11 fallback instruction ("do not guess"), the same standard is applied here: **`OFFICIAL_RECENT_DEALS` for the 7 additional stratified addresses is honestly reported as not independently verifiable in this session**, not guessed.

| # | Address | Category | OUR_RECENT_DEALS (5y) | OFFICIAL_RECENT_DEALS | Status |
|---|---|---|---|---|---|
| 1 | עובד בן עמי 41 | Known missing | 0 | 5 (proven, Wave 0F-3A) | **MISSING** (proven) |
| 2 | ויצמן 92 | Known present | 3 | matches confirmed live in Wave 0E-3 acceptance | **PRESENT** (proven) |
| 3 | הרב שמואל הרטום 30 | Known present | present (Wave 0E) | matches confirmed live in Wave 0E-3 acceptance | **PRESENT** (proven) |
| 4 | בן צבי (street-level) | High-volume central | 221 (5y) / 294 total | not independently checked this session | UNKNOWN |
| 5 | קרליבך (street-level) | Low-volume | 1 (5y) / 1 total | not independently checked this session | UNKNOWN |
| 6 | ד"ר יוסף בורג (street-level) | High-volume, newer development, north/coastal (כוכב הצפון / פרדס הגדוד) | 384 (5y) / 384 total | not independently checked this session | UNKNOWN |
| 7 | חב"ד (street-level) | Older neighborhood, stale data (קריית צאנז) | 0 (5y) / 11 total, last deal 2016 | not independently checked this session | UNKNOWN |
| 8 | אירוס הארגמן (street-level) | Established/older area (גבעת האירוסים) | 63 (5y) / 238 total | not independently checked this session | UNKNOWN |
| 9 | יוספטל (street-level) | Old central street (spans 1998-2026, נאות הרצל/מרכז העיר צפון) | 116 (5y) / 174 total | not independently checked this session | UNKNOWN |
| 10 | חרצית (street-level) | Coastal-adjacent (גבעת האירוסים) | 50 (5y) / 166 total | not independently checked this session | UNKNOWN |

**Match rate for the 3 provable addresses: 2/3 present as expected, 1/3 (Ben Ami 41) proven missing** — this is the one hard, already-established data point this session has for spot-check purposes; items 4–10 are OUR-side context only, not a completed spot-check, and are flagged `WAITING_FOR_OPERATOR` if a live comparison is wanted (open `nadlan.gov.il`, search each street/address, compare recent transaction counts to the OUR_RECENT_DEALS column above).

---

## Ben Ami 41 Known Gap

Kept explicit, not folded into aggregate statistics:
```
Official visible rows (nadlan.gov.il, per operator report, Wave 0F-3A):
  2024-11-15 -- ₪280,000 -- 65 sqm -- דירת נופש
  2023-06-21 -- ₪925,000 -- 65 sqm -- 3 rooms -- דירת נופש
  2023-05-11 -- ₪680,000 -- 45 sqm -- 2 rooms -- דירת נופש
  2023-04-20 -- ₪975,000 -- 65 sqm -- 3 rooms -- דירת נופש
  2022-06-08 -- ₪232,000 -- 45 sqm -- 2 rooms -- דירת נופש
Current dataset matches: 0/5 (proven exhaustively in Wave 0F-3A by date+price+area search,
  not street-name matching alone)
```

---

## Completeness Scorecard

| Category | Rating | Evidence |
|---|---|---|
| ANNUAL_VOLUME_COVERAGE | **AMBER** | Aggregate volume looks plausible for 2021+ (our count exceeds a same-city official second-hand-only subset for 2 recent windows) but pre-2021 data is thin and likely reflects when the harvest campaign scaled up, not a real historical market pattern |
| STREET_COVERAGE | **AMBER** | 71% of official streets show zero deals ever — not automatically a defect (many are genuinely low-activity), but combined with the 500-cap finding, likely includes real gaps, unquantified |
| RECENT_DATE_CONTINUITY | **GREEN** (with one **AMBER** caveat) | No zero-deal months found in 66 consecutive months (2021-2026); the 2026-04/05/06 near-zero tail is a data-freshness cutoff, not a gap, but does mean "today's" live data is ~2.5 months stale relative to the session date |
| ADDRESS_FIELD_QUALITY | **AMBER** | 79.4% valid street globally; the 20.6% `"0"`-placeholder problem is real, large, unevenly concentrated (up to 93.6% in one neighborhood), and not improving over time (2024 is the worst year) |
| PROPERTY_TYPE_COVERAGE | **AMBER/UNKNOWN** | No categorical exclusion exists (commercial/parking/storage all present); vacation/hotel categories are real but extremely sparse (19 rows citywide in 28 years) — consistent with, not proof of, under-collection |
| OFFICIAL_SAMPLE_MATCH_RATE | **UNKNOWN** (partial evidence only) | Only 3 of the 10 target addresses have a proven official comparison (2 present, 1 proven missing); 7 could not be independently checked in this environment |
| **(new, not in the original list, but the strongest single signal found)** ACQUISITION_TRUNCATION_RISK | **RED** | 18 of 22 neighborhoods (82%) cluster in a 490-500-row band — very strong evidence of a systematic acquisition-time cap, of the same class as the already-proven runtime PostgREST cap, previously unidentified |

### Overall verdict: **MATERIAL_GAPS**

Not SEVERE_GAPS: the data that does exist is high-quality on non-address fields (100% valid price/coordinates/neighborhoodId, 96%+ valid area/rooms), no duplicate-row corruption, and the one real official benchmark comparison available does not show severe aggregate under-collection. Not HEALTHY: the acquisition-cap finding is strong, structural, affects the large majority of neighborhoods, and directly explains why a real, government-confirmed transaction (Ben Ami 41) is entirely absent from a specific neighborhood that happens to sit exactly at the suspected cap (`נוף הטיילת` = 500 total, 78.2% of which is additionally `"0"`-placeholder-contaminated).

---

## Valuation Trust Implication

**ONLY_WITH_CONFIDENCE_GUARDRAILS.**

Distinguishing the four scenarios explicitly:
- **Exact-building data exists and is used**: trustworthy — this is real government data, unaffected by any gap found here.
- **Street-only data exists** (no exact building, but real same-street comparables): reasonably trustworthy for streets NOT capped near 500 and not `"0"`-contaminated — but this audit cannot currently tell a user which streets those are.
- **Neighborhood-only fallback**: materially riskier than previously assumed — if the resolved neighborhood is one of the 18 sitting at the suspected acquisition cap, or one with heavy `"0"`-contamination (up to 93.6%), the neighborhood-tier pool itself may be a truncated, non-representative sample of that neighborhood's real market, not just "less precise than street/building tier" as previously understood.
- **Known/likely incomplete source coverage**: now proven structural (the 500-row-cluster finding), not isolated to Ben Ami's street — any address whose real transaction history exceeds ~500 rows in its resolved neighborhood, or whose relevant transactions fall into a sparse category (vacation apartments), is at elevated risk of an incomplete comparable pool, with no current UI signal to the user that this is happening (confirmed separately in Wave 0F-3A's Phase 9).

No UI change made in this wave, per instruction.

---

## Proven Gaps

1. **Ben Ami 41**: 5 real government transactions, 0 in our dataset (Wave 0F-3A, re-confirmed here).
2. **18 of 22 neighborhoods (82%) cluster in a 490–500-total-deal band**, strongly indicating a systematic ~500-row acquisition-time cap — new finding, this wave.
3. **20.6% of all rows (2,608) carry a literal `"0"` street/address placeholder**, unevenly concentrated up to 93.6% in one neighborhood, not improving over time.
4. **`דירת נופש`/`מלונאות` categories are extremely sparse citywide** (19 rows in 28 years) despite not being excluded by the importer.

## Unknowns

1. Whether nadlan.gov.il's own street/neighborhood result list actually caps at ~500 (the acquisition-layer hypothesis) — not provable without a live, authorized harvest rerun.
2. True apples-to-apples annual citywide transaction totals (official new+resale combined) for 2021–2025 — CBS publishes this, but this session's tools could not parse the PDF releases.
3. Official transaction counts for the 7 additional spot-check addresses (Phase 12) — this session has no live path to nadlan.gov.il's protected search flow.
4. Whether the 71% of official streets with zero recorded deals reflects genuine low market activity, the same acquisition cap, or a mix — unquantified without street-by-street external verification.

## Recommended Next Step

**A single, narrowly-scoped, explicitly-authorized micro-wave**: rerun `npm run harvest` for exactly one already-known-capped neighborhood (`נוף הטיילת`, id `66239231` — the smallest, most concentrated case, already tied to a proven real-world defect) using the existing `HARVEST_ONLY="נוף הטיילת"` single-neighborhood mode, and compare the resulting row count to the current 500. If it comes back meaningfully above 500, the acquisition-cap hypothesis is confirmed with real evidence and a full citywide re-harvest becomes a data-backed decision rather than a guess; if it comes back at ~500 again, the hypothesis is disproven and the investigation should look elsewhere (e.g., directly at nadlan.gov.il's own site behavior for this neighborhood). This directly and cheaply tests the single highest-value open question from this audit before committing to any larger, costlier action.

Do not fix data. Do not start harvesting. Do not start the next wave automatically.
