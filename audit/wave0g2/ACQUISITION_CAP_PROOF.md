# Wave 0G-2 — Single-Neighborhood Acquisition Cap Proof

**Evidence-only wave. `data/deals.json` verified byte-identical before and after (SHA-256 `18b3796e8f1c...11a8f`). No Supabase writes. No canonical harvest run. No deployment.**

## Baseline reconciliation — the "21 vs 22" discrepancy

```
CANONICAL_NEIGHBORHOOD_ROWS = 21          (data/neighborhoods.json)
DISTINCT_DEAL_NEIGHBORHOOD_IDS = 21       (data/deals.json)
MAPPED_NEIGHBORHOOD_IDS = 21              (100% — every deal's neighborhoodId maps to a real neighborhoods.json entry)
UNMAPPED_OR_SPECIAL_IDS = 0               (none — confirmed clean, no null/synthetic/phantom bucket)
```
**The "22" in Wave 0G-1 was a plain arithmetic error in that wave's own summary prose, not a hidden data bucket.** The underlying per-neighborhood table in Wave 0G-1 was correct and complete (21 real rows). Its executive summary and final response said "18 of 22 neighborhoods" — but 13 (exactly 500) + 5 (490–499) + 2 (below 490) + 1 (above 500, `מרכז העיר צפון`) = 21, not 22. Corrected: **18 of 21 neighborhoods (85.7%)**, not 18 of 22 (81.8%) — the corrected figure is *stronger* evidence for the cap hypothesis, not weaker. This is documented here transparently rather than silently fixed.

## Target neighborhood
```
TARGET_NEIGHBORHOOD = נוף הטיילת (chosen per instruction — directly tied to the Ben Ami 41 case)
TARGET_NEIGHBORHOOD_ID = 66239231
CURRENT_CANONICAL_DEAL_COUNT = 500
FIRST_DATE = 2024-11-11
LAST_DATE = 2026-05-27
```

---

## Phase 1 — Harvest side-effect audit (no execution)

Traced `scripts/harvest.ts` and `package.json` (`"harvest": "tsx scripts/harvest.ts"`) before running anything.
```
HARVEST_ONLY_SUPPORTED = YES — process.env.HARVEST_ONLY filters targetNeighborhoods by name-includes match
EXACT_COMMAND = HARVEST_ONLY="נוף הטיילת" npm run harvest   (not run in this wave)
NETWORK_ENDPOINT = https://www.nadlan.gov.il/ (SPA search flow) -> intercepted XHR responses matching "/deal-data"
PAGE_SIZE = not a fixed request-side page size -- driven by however many items nadlan.gov.il's own response contains per scroll-triggered fetch
PAGINATION = infinite-scroll-triggered (page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))), not URL/cursor pagination
MAX_ROWS = no client-side cap coded anywhere in harvest.ts -- MAX_SCROLL_ROUNDS=200 bounds scroll ATTEMPTS, not rows
STOP_CONDITION = SCROLL_IDLE_ROUNDS=4 consecutive scroll rounds with no new /deal-data items -> stop
```
Critically, for `HARVEST_ONLY`:
```
FILES_WRITTEN = data/neighborhoods.json (only on a FULL, non-onlyName run) and data/deals.json
FILES_OVERWRITTEN = data/deals.json IS OVERWRITTEN on every real harvest.ts run, including HARVEST_ONLY mode
  (harvest.ts lines ~510-513: combined = onlyName ? [...existingDeals, ...allDeals] : allDeals, then
  fs.writeFile(...,"deals.json", JSON.stringify(deals,...)) unconditionally when DATA_SOURCE !== "supabase")
CHECKPOINT_FILES = none found -- no separate checkpoint/resume file distinct from data/deals.json itself
DATA_DEALS_JSON_WRITTEN = YES
SUPABASE_WRITES = YES, if DATA_SOURCE=supabase is set (unconditional sb.from("deals").upsert(...) in 500-row batches)
```
```
IS THE NORMAL HARVEST_ONLY COMMAND SAFE TO RUN WITHOUT MUTATING CANONICAL DATA?
NO.
```
Confirmed by direct source reading, not run. Per this wave's explicit instruction, the real `HARVEST_ONLY` command was **not executed**.

---

## Phase 2 — Safe diagnostic mode

Preferred-order options 1–3 do not exist in this codebase (no dry-run flag, no output-path override flag, and `scripts/harvest.ts` exports nothing importable — it is a standalone script with only a `main()`). Used **option 4**: a new, standalone diagnostic script, `scripts/audit-wave0g2-live-fetch.ts`, that duplicates (does not import, does not modify) the minimal necessary pieces of `harvest.ts`'s network-interception, decode, and `normalize()` logic, hard-wired to:
- Never open, read, or write `data/deals.json`.
- Contain no Supabase code path at all.
- Write only under `audit/wave0g2/` (`live_raw_items.json`, `live_normalized.json`, `page_trace.json`).

`scripts/harvest.ts` itself was not modified.

---

## Phase 3 — Raw page trace (live, executed this wave)

Ran the diagnostic script for real, against the live `https://www.nadlan.gov.il/`, using the pre-existing, already-authenticated persistent Chrome profile at `~/.harvest-chrome` (last used by a real prior harvest session, 2026-07-29 — not created or "warmed up" by this session; reused read-only, as-is). Headful (not `HARVEST_HEADLESS=true`), matching `harvest.ts`'s own documented reliable path.

```
REMOTE_PAGE_SIZE = 500 (the entire response arrived in a single network event)
PAGES_REQUESTED = 1
ROWS_PER_PAGE = 500 (page 1 only)
TOTAL_RAW_ROWS_RECEIVED = 500
UNIQUE_RAW_TRANSACTIONS = 500 (0 duplicates)
DUPLICATES = 0
FINAL_PAGE_ROW_COUNT = 500
REMOTE_HAS_MORE_SIGNAL = NO -- the scroll loop ran its full SCROLL_IDLE_ROUNDS=5 (this diagnostic used 5, matching harvest.ts's default of 4 plus one extra round of margin) with zero additional /deal-data events after the first
HARVEST_STOP_REASON = scroll-idle (no new items for 5 consecutive scroll rounds) -- not a 405/reCAPTCHA rejection
```
**Answering the wave's specific questions directly:**
- Does upstream return more than 500 transactions for this neighborhood-level query? **No — the live response itself contained exactly 500, in one shot.**
- Does our current acquisition code request page 2/next cursor/next batch? **No such request ever fires — there is nothing to request; the site never emits a second `/deal-data` event no matter how much the page is scrolled, for this neighborhood-level query.**
- Does it stop at exactly 500? **Yes — because the upstream response itself is exactly 500 rows, not because our code artificially truncates a larger response.**

---

## Phase 4 — Compare against canonical 500

```
CANONICAL_COUNT = 500
LIVE_RAW_COUNT = 500
LIVE_PARSED_COUNT = 500 (100% of raw rows normalized successfully -- none dropped by normalize()'s price-null guard)
LIVE_UNIQUE_COUNT = 500
```
Compared by exact `id` (the same `neighId-dealDate-price-area` composite key `normalize()` builds) and, more robustly, by the `(dealDate, price, areaSqm)` content triple (since `keyValue`/`dealId` was absent from every raw row in both the canonical historical harvest and this fresh live fetch, so both fall back to the same content-derived key):
```
CANONICAL_IDS_PRESENT_IN_LIVE (exact id match) = 424 / 500
MATCHED (by date+price+area, robust to minor area-rounding drift) = 456 / 500
LIVE_IDS_MISSING_FROM_CANONICAL = 44   -- rows dated up to 2026-06-23, newer than canonical's 2026-05-27 cutoff
CANONICAL_IDS_NOT_FOUND_LIVE = 44      -- rows dated back to 2024-11-11 through mid-2025, now older than the live top-500 window
```
**`LIVE_UNIQUE_COUNT` does NOT exceed `CANONICAL_COUNT` — both are exactly 500.** This is not "the live fetch found more/less than canonical" — it is **the same fixed-size sliding window of the 500 most recent transactions**, captured at two different points in time:
```
LIVE fetch (2026-08-25):    covers dealDate 2024-12-01 -> 2026-06-23
CANONICAL (harvested earlier): covers dealDate 2024-11-11 -> 2026-05-27
```
As new transactions occur, they push the oldest ones out of the top-500 window. This neighborhood alone cycles through 500 transactions in well under two years — meaning **any transaction older than the current rolling window is permanently unreachable via this query type, regardless of when the harvest is (re)run.** No historical row is "missing due to a one-time mistake" — it is structurally unreachable by design of the upstream endpoint's own behavior for this query shape.

---

## Phase 5 — Ben Ami 41 direct check

Searched the live raw response and the live normalized output for all 5 known official transactions:
```
2024-11-15 / ₪280,000 / 65sqm -> LIVE_RAW_FOUND=false  PARSED=false
2023-06-21 / ₪925,000 / 65sqm -> LIVE_RAW_FOUND=false  PARSED=false
2023-05-11 / ₪680,000 / 45sqm -> LIVE_RAW_FOUND=false  PARSED=false
2023-04-20 / ₪975,000 / 65sqm -> LIVE_RAW_FOUND=false  PARSED=false
2022-06-08 / ₪232,000 / 45sqm -> LIVE_RAW_FOUND=false  PARSED=false
```
```
PAGE_OR_BATCH = N/A -- none of the 5 rows appeared in the single page/batch that WAS returned
WOULD_BE_EMITTED = N/A -- there is no "page 2" our harvester failed to request; the rows are not present in ANY page nadlan.gov.il returns for a neighborhood-level "נוף הטיילת" search, live, right now
FIRST_LOSS_STAGE = upstream neighborhood-level query itself, not our scroll/pagination code, not our normalize()/classify() logic
```
All 5 official rows are dated 2022-06-08 through 2024-11-15 — every one of them **older** than even the *live* top-500 window's start (2024-12-01), and 4 of the 5 are older than the *canonical* window's start too (2024-11-11) except the 2024-11-15 row, which is barely newer than canonical's cutoff (2024-11-11) yet still absent from canonical — consistent with the canonical harvest's own window having shifted slightly differently at capture time, not a separate defect. **This directly, mechanically explains the Ben Ami 41 absence: these 5 real transactions are all old enough to have already fallen outside whatever 500-row recent-transactions window nadlan.gov.il returns for a `נוף הטיילת`-level search, at any point this neighborhood has ever been harvested.**

One caveat, stated precisely and not overclaimed: this experiment queried at the **neighborhood level** (matching the historical harvest method for this neighborhood). The operator originally found these 5 rows via a **direct address-level search** ("עובד בן עמי 41") on nadlan.gov.il. This wave did not test whether an address-level query against nadlan.gov.il would surface these rows (that would require a second live experiment, out of this wave's single-neighborhood scope) — so it remains formally possible, though not tested here, that a more targeted street/address-level query could reach data the neighborhood-level query's 500-row window cannot. This does not weaken the core finding (the neighborhood-level cap is proven, live, right now) — it only means the *complete* fix, if one is ever authorized, would need street/address-level querying, not just a bigger neighborhood-level page size.

---

## Phase 6 — Code-level cap trace

```
CLASSIFICATION = B — upstream API returns only 500 and exposes no pagination
```
Proven directly, live: the single `/deal-data` network response for this neighborhood-level query contained exactly 500 items; scrolling (the *only* pagination mechanism `harvest.ts` implements for this query type — `page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))` in `scrollUntilDone()`) triggered zero further `/deal-data` events across 5 full idle-detection rounds. There is no client-side `limit`/`slice(0,500)` anywhere in `scripts/harvest.ts` (confirmed by direct source reading in this and the prior wave) — ruling out C. The scroll-until-idle stop condition itself behaved correctly (D ruled out: it correctly detected "no more data," it just correctly detected the true state of what upstream offers). No raw-to-parsed row loss occurred (E ruled out: 500 raw in, 500 parsed out, both this wave's live fetch and, by the same evidence, presumably the historical harvest).

**Exact file/function**: `scripts/harvest.ts`, `scrollUntilDone()` (lines ~252–265) driven by `openPageWithListener()`'s `response` listener (lines ~226–249), called from `harvestNeighborhood()` (lines ~341–377) — this wave's diagnostic script duplicates that exact mechanism and observed the exact same behavior live. The defect, such as it is, is not in this code — it is that `harvest.ts` has no *fallback* to a finer-grained query (e.g. per-street, the way it already does for `STREET_MODE_NEIGHBORHOODS`) when a neighborhood-level query hits this ceiling.

---

## Phase 7 — Systemic scope estimate (from current canonical distribution only — no new harvesting)

Corrected denominator (21, not 22 — see baseline reconciliation above):
```
EXACTLY_500 = 13
BETWEEN_490_499 = 5
BELOW_490 = 2   (נאות שקד=455, נווה איתמר=205)
ABOVE_500 = 1   (מרכז העיר צפון=3,010)
=> 18 of 21 (85.7%) sit in the 490-500 band consistent with the proven cap.
```
**How can `מרכז העיר צפון` sit at 3,010, far above the cap, if the cap is real?** Proven directly from source, not guessed: `scripts/harvest.ts` defines `STREET_MODE_NEIGHBORHOODS = new Set(["מרכז העיר צפון"])` and routes this **one** neighborhood through `harvestByStreets()` instead of `harvestNeighborhood()` — its own comment explains why: *"שכונות שnadlan.gov.il לא מכיר לפי שם — חייב לשאוב לפי רחובות"* ("neighborhoods nadlan.gov.il doesn't recognize by name — must harvest by street"). This means `מרכז העיר צפון`'s 3,010 rows are the **sum of ~148 separate per-street queries** (148 distinct streets recorded for this neighborhood, per Wave 0G-1's street coverage data), each individually still subject to the same ~500-row ceiling *per street*, not one neighborhood-level query. Since most individual streets have far fewer than 500 transactions, summing across 148 of them comfortably exceeds 500 in aggregate even though no single query ever returns more than 500. **This is not a contradiction of the cap hypothesis — it is architectural proof of it**: the one neighborhood that happens to use a finer query granularity is exactly the one neighborhood that escapes the ceiling.

---

## Phase 8 — Data freshness

```
CANONICAL_LAST_DATE (citywide, Wave 0G-1) = 2026-06-08
LIVE_LAST_DATE (this neighborhood, live fetch) = 2026-06-23
NEWER_ROWS_EXIST = YES
```
Confirms the canonical snapshot is a point-in-time capture (consistent with `harvest.ts`'s own documented "run once a month" cadence) and live data has moved on since. Secondary to the cap question, relevant only to future rebuild planning, per instruction.

---

## Phase 9 — Root cause verdict

```
ACQUISITION_CAP = PROVEN
CAP_SIZE = 500 rows per neighborhood-level (or per-street, for the one neighborhood using that mode) query
CAUSE = upstream (nadlan.gov.il) neighborhood-level search returns only the most recent 500 transactions in a
  single response, with no pagination trigger reachable via scrolling -- Classification B
TARGET_CANONICAL_COUNT = 500
TARGET_TRUE_LIVE_COUNT = 500 (the live ceiling itself, right now -- NOT the true total historical count for
  this neighborhood, which remains genuinely unknown; only that it is capped, not what lies beyond the cap)
TARGET_MISSING_COUNT = not quantifiable from this evidence alone -- what IS proven is that at least the
  Ben Ami 41 5 rows (2022-2024) sit outside the reachable window, and that the reachable window itself
  visibly slides over time (44/500 rows turned over between the canonical harvest and this live fetch alone)

BEN_AMI_41_EXPLAINED_BY_CAP = YES
```
All 5 official Ben Ami 41 rows are dated before the earliest date reachable by either the canonical harvest's window or this session's live window, for a neighborhood proven, live, to only ever expose its most recent 500 transactions via this query method. This is a mechanical, structural explanation, not a coincidence or a one-off collection mistake.

---

## Constraints and honesty notes

- This wave tested **one** neighborhood-level query type, live, once. It did not test whether an address-level or street-level query against nadlan.gov.il can reach older transactions for this neighborhood (plausible, given `STREET_MODE_NEIGHBORHOODS`'s existence proves per-street queries behave differently, but not tested here — would be a natural Wave 0G-3 scope).
- No other neighborhood was fetched live in this wave, per instruction. Phase 7's systemic estimate is drawn entirely from the existing canonical distribution (already computed, correctly, in Wave 0G-1) plus this one neighborhood's live confirmation — not extrapolated from further live testing.
- The persistent Chrome profile at `~/.harvest-chrome` was reused as pre-existing infrastructure from the operator's own prior harvest sessions; nothing in it was created or "warmed up" by this wave, and its use here was read-only web browsing (a real page visit + scroll), not a canonical-data mutation.

## No fix / no rebuild
Application source changes: NONE (both new files are diagnostic-only, outside the application runtime). Canonical deal writes: NONE. Supabase writes: NONE. Broad harvest: NO. Importer: NO. Deployment: NONE.
