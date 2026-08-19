# Harvest Pipeline Audit — Phase 4

Audited: 2026-08-19  
Status codes: VERIFIED = confirmed by direct code read; LIKELY = inferred from code pattern; UNKNOWN = not findable.

---

## scripts/harvest.ts

### Purpose
Monthly Playwright-based browser harvest of real-estate transactions from nadlan.gov.il (protected by reCAPTCHA v3). Intercepts XHR responses to `/deal-data`, decodes the payload, normalises records to the `Deal` schema, then writes to `data/deals.json` or Supabase.

### Inputs
- `data/street-index.json` — street-level ITM coordinates loaded at startup into `streetCoords`
- `data/neighborhoods.json` — existing neighborhoods for merge (HARVEST_ONLY / HARVEST_STREET modes)
- `data/deals.json` — existing deals for merge (HARVEST_ONLY / HARVEST_STREET modes)
- ENV: `DATA_SOURCE`, `HARVEST_HEADLESS`, `HARVEST_PROFILE`, `CHROME_PROFILE_DIR`, `HARVEST_ONLY`, `HARVEST_STREET`
- Supabase ENV: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

### Outputs
- `data/deals.json` (local mode) — full replacement on a full run; merge on HARVEST_ONLY / HARVEST_STREET
- `data/neighborhoods.json` — written on a full run only (not HARVEST_ONLY)
- Supabase `deals` table (if `DATA_SOURCE=supabase`) — upserted in 500-record batches
- Supabase `neighborhoods` table — upserted on full run

### Pagination
VERIFIED — the script does **not** use page/offset calls. The API delivers transactions via infinite-scroll XHR. `scrollUntilDone()` scrolls `document.body.scrollHeight` and waits 2500 ms, stopping only when `collected.length` has not changed for `SCROLL_IDLE_ROUNDS = 4` consecutive rounds or `MAX_SCROLL_ROUNDS = 200` rounds is reached. No explicit knowledge of total-record count is used; there is no check against a "total" field in the API response.

```ts
// harvest.ts lines 253-264
const MAX_SCROLL_ROUNDS = 200;   // ← הוגדל מ-24 כדי לכסות רחובות עם 50+ עמודים
const SCROLL_IDLE_ROUNDS = 4;   // ← הוגדל מ-3 לוידוא שאכן אין עוד
```

### Error Handling / Retries
VERIFIED — errors inside the per-neighborhood loop are caught with `catch (e)` and logged; the loop continues to the next neighborhood. No retry on failure. 405 (reCAPTCHA block) is detected via `decoded?.statusCode === 405` and raises an `Error` inside `harvestNeighborhood`. There is no exponential back-off; the only inter-request delay is `POLITE_DELAY_MS = 4000`.

### Duplicate Prevention
VERIFIED — In-memory `Set<string>` keyed on `deal.id`. After all neighborhoods, the script filters `combined.filter(d => seen.has(d.id) ? false : seen.add(d.id))`. In HARVEST_ONLY/HARVEST_STREET mode, existing deals from disk are loaded first, so the deduplication covers both old and new records.

Deal id construction (line 202):
```ts
id: `${n.id}-${raw.keyValue ?? raw.dealId ?? `${dealDate}-${price}-${builtArea || plotArea}`}`
```
If `keyValue` / `dealId` are absent the id becomes a composite of date+price+area — collisions are possible for same-day same-price same-area transactions in the same neighbourhood. VERIFIED.

### Success vs Partial Failure Signals
- Console logs per-neighborhood counts.
- If `deals.length === 0`, a `console.warn` is printed — **nothing is written** to disk/Supabase.
- There is no exit code differentiation: `main().catch(e => { console.error(e); process.exit(1); })` only exits 1 on an uncaught exception.
- There is no manifest/checkpoint file produced. VERIFIED.

### Idempotency
LIKELY SAFE. Supabase path uses `upsert`, so re-running inserts or updates by id. Local path replaces the file on a full run. In HARVEST_ONLY mode, the script reads existing deals and re-deduplicates before writing — so rerunning it is safe if the same deal-ids are produced.

Risk: if `keyValue`/`dealId` are absent and the price/date/area differ slightly between runs, duplicate records will be created. LIKELY.

### What Can Silently Fail
- A neighborhood that returns no suggestions from `discoverNeighborhoods()` is silently skipped. VERIFIED.
- If `street-index.json` is missing, coordinates fall back silently to neighbourhood centroid. VERIFIED (line 50 console.warn only).
- If `decoded?.data?.items` path does not exist but there is no 405, `items = []` is used silently. VERIFIED.
- The `discoverNeighborhoods()` function ignores per-name `fetch` errors via `catch { /* דלג */ }`. VERIFIED (line 107).
- Chrome launch failure in persistent-profile mode calls `process.exit(1)` — not silent.

---

## Critical Questions — harvest.ts

### Q1: WHERE is the 500-deal-per-neighbourhood cap?
VERIFIED ABSENT. There is no 500-deal cap in `harvest.ts`. The only limits are `MAX_SCROLL_ROUNDS = 200` and `SCROLL_IDLE_ROUNDS = 4` inside `scrollUntilDone`. The cap referenced in the memory file does not appear in any harvest script. The Supabase upsert batch size is 500 records per API call (line 524), but this is a write-batch, not a data cap.

### Q2: How does harvest.ts know it got ALL transactions vs. just the first page?
VERIFIED — It does NOT know. Completeness is inferred from the idle-scroll heuristic: if 4 consecutive 2500 ms scroll attempts add zero new items, scrolling stops. This can produce false-done if the server is slow. There is no total-count comparison. This is a known gap.

### Q3: What happens if nadlan changes its response format?
VERIFIED — Silent data loss. The decode path (below) returns `null` on parse failure; the listener catches exceptions and ignores them; `items` defaults to `[]`; no error is surfaced. The harvest run will complete with 0 deals and emit a `console.warn`. The script will NOT crash or write an error manifest.

### Q4: Is there validation that the decoded Deal matches the expected schema?
VERIFIED ABSENT. The `normalize()` function does field-level coercion (num(), parseFloor(), etc.) but there is no schema library (zod, ajv, etc.) used. The only hard gate is `if (!price || !Number.isFinite(price)) return null`. All other fields silently default to `null`. Unknown fields in the raw record are silently dropped.

### Q5: How are partial-ownership transactions (זכויות, חלקי) identified?
VERIFIED ABSENT. The `classify()` function in `harvest.ts` (line 172-178) classifies by `dealNature` string matching on מגרש/קרקע/דירה/קוטג etc. It does not check for partial-ownership markers. The raw `dealNature` is preserved in the output, but no `isPartial` flag or filter exists. Partial-ownership deals may be included at full face value, inflating prices.

### Q6: What is the exact base64+gzip decode path?
VERIFIED:
```ts
// harvest.ts lines 122-136, function decodeDealData
function decodeDealData(text: string): any {
  try { return JSON.parse(text); } catch { /* not raw JSON */ }
  try {
    const buf = Buffer.from(text.replace(/^"|"$/g, ""), "base64");
    const unz = zlib.gunzipSync(buf).toString("utf8");
    return JSON.parse(unz);
  } catch { return null; }
}
```
Step 1: Try to parse as plain JSON (some API responses are not compressed).  
Step 2: Strip surrounding quotes, decode base64 → Buffer, gunzip, parse JSON.  
Failure at any step returns `null`. Identical copies exist in `harvest-missing.ts`, `harvest-streets.ts`, and `fetch-datagov.ts` (datagov uses plain JSON, no gzip).

### Q7: Does the harvest script leave behind any checkpoint/manifest?
VERIFIED ABSENT. No checkpoint file is written. The only state that persists is `deals.json` and `neighborhoods.json`. If the script crashes mid-run, the partially-accumulated `allDeals` array (held in memory) is lost. A second run starts over from scratch. In HARVEST_ONLY / HARVEST_STREET mode the existing `deals.json` is loaded first, so individual-neighbourhood re-runs are safe, but a full-run crash loses progress entirely.

---

## scripts/harvest-missing.ts

### Purpose
Identifies streets in `street-index.json` with zero (or fewer than 5) deals in `deals.json`, then harvests each via direct street-name search on nadlan.gov.il. Designed as a supplementary pass to cover streets whose neighbourhood IDs are "phantom" IDs not present in the main harvest neighbourhoods.

### Inputs
- `data/street-index.json`
- `data/deals.json`
- `data/neighborhoods.json`
- ENV: `HARVEST_HEADLESS`, `CHROME_PROFILE_DIR`, `SKIP_EXISTING` (default true), `ONLY_STREET`

### Outputs
- `data/deals.json` — incremental append via `appendToDeals()` every `SAVE_EVERY = 5` streets

### Pagination
Same scroll-idle heuristic as `harvest.ts`. `MAX_SCROLL_ROUNDS = 200`, `SCROLL_IDLE_WAIT = 2500`, `IDLE_ROUNDS_STOP = 4`. VERIFIED.

### Error Handling / Retries
Per-street try/catch; failures increment `totalFail`, script continues. No retry logic. reCAPTCHA block is detected and counted as failure.

### Duplicate Prevention
VERIFIED — `appendToDeals()` reads the current `deals.json`, builds a `Set` of existing IDs, and only writes the new records. Safe to interrupt and resume (checkpoint-by-file every 5 streets). VERIFIED (lines 250-258).

### Idempotency
VERIFIED SAFE. Can be run twice; `appendToDeals` deduplicates by id on each batch save.

### Phantom Neighbourhood Mapping
VERIFIED — Hard-coded map at lines 38-44:
```ts
const PHANTOM_TO_REAL: Record<string, string> = {
  "66239238": "66239254",  // צפון מערב מרכז העיר → מרכז העיר צפון
  "66239288": "66239231",  // כוכב הים → נוף הטיילת
  "66239289": "65867837",  // גלי הים → נאות שקד
  "66239258": "66239260",  // רמת פולג → עיר ימים
  "66239242": "65867837",  // רמת ידין → נאות שקד
};
```
Any phantom ID NOT in this map uses its own ID unchanged, which will not match a real neighbourhood. VERIFIED.

### What Can Silently Fail
- Street with no autocomplete suggestion falls through to `Enter` keypress; if that also fails, 0 deals are returned silently.
- `SKIP_EXISTING=true` (default) skips streets with ≥5 existing deals. A street with 4 deals (partial coverage) is re-harvested; a street with 5 is not. The threshold is arbitrary.

---

## scripts/harvest-streets.ts

### Purpose
Street-level re-harvest of the top-N most active streets (by deal count in `deals.json`), using 4 concurrent Chrome browsers. Primary goal: enrich existing deals with house numbers (`houseNumber`) from the `fullAdress` field returned by street-level search.

### Inputs
- `data/deals.json`
- `data/street-index.json` (for coordinates)
- ENV: `HARVEST_TOP` (default 80), `HARVEST_HEADLESS` (hardcoded false), `CHROME_PROFILE_DIR`, `DATA_SOURCE`

### Outputs
- `data/deals.json` — merge: existing deals enriched with `houseNumber`, new deals appended
- Supabase `deals` table (if `DATA_SOURCE=supabase`)

### Pagination
VERIFIED — Different limit: `for (let i = 0; i < 18 && !last405; i++)` with 1800 ms wait, idle stop at 3. This is shorter than the main harvest (18 rounds vs 200). Possible gap for very active streets (> ~18 scroll pages). LIKELY RISK.

### Deduplication / Merge Strategy
VERIFIED — Merge key: `${d.street}|${d.dealDate}|${d.price}|${d.areaSqm ?? d.plotSqm ?? ""}`. If the key already exists, only `houseNumber` and `address` are enriched (not replaced). If the key is new, the deal is added. This means the same transaction discovered at street level and at neighbourhood level will be stored once (by merge key), but the street-level deal gets a `st-` prefixed id, so if the merge-key comparison misses due to different area encoding, duplicates with two different ids could exist. LIKELY RISK.

### Idempotency
LIKELY SAFE. Merge-by-key approach means re-running enriches without duplication via the merge key, but the id may differ between runs (neighbourhood `n.id-...` vs street-level `st-...`).

---

## scripts/enrich-plot.ts

### Purpose
Enriches `house` property deals that are missing `plotSqm` by querying the govmap.gov.il WFS parcel layer from inside a live Playwright browser session (cookies required).

### Inputs
- `data/deals.json` — filters for `propertyType === "house" && !plotSqm && x && y`
- ENV: `ENRICH_LIMIT`

### Outputs
- `data/deals.json` — in-place enrichment; intermediate save every 50 deals

### Error Handling
Per-deal silent failure (returns `null` from `queryPlotSqm`). Failed count logged at end. No retry beyond the 3 radius expansions (15 → 30 → 60 m).

### Idempotency
VERIFIED SAFE — skips deals that already have `plotSqm`. Safe to re-run. The filter is `!d.plotSqm`.

### What Can Silently Fail
- If govmap session/cookies expire mid-run, WFS responses may return HTML errors (handled by `if (!ct.includes("json")) return null`). Deals that were processed successfully before the session expiry are saved; later ones silently fail. VERIFIED (line 59).
- No check that `legal_area` is geographically inside the queried BBOX — uses nearest sorted by size. LIKELY.

---

## scripts/fetch-datagov.ts

### Purpose
Alternative harvest from data.gov.il CKAN API (public, no reCAPTCHA). Pulls all Netanya transactions from resource `43a3b913-e4e2-4a1d-9e96-6982ef5a9e5a`, normalises to `Deal`, and writes to `deals.json` or Supabase. This is a full-replacement harvest (not incremental).

### Inputs
- `data/neighborhoods.json` (for neighbourhood ID mapping)
- data.gov.il CKAN API

### Outputs
- `data/deals.json` (full replacement) or Supabase

### Pagination
VERIFIED — Explicit offset-based pagination: `PAGE_SIZE = 100`, fetches `Math.ceil(total / PAGE_SIZE)` pages. Total is read from `j.result.total` in the first page response. The script checks `total === 0` and exits with an error. 300 ms polite delay between pages.

### Error Handling
Per-page catch: logs error, skips page, continues. No retry. If all pages fail, `allRaw` is empty.

### Idempotency
LIKELY NOT SAFE on local mode — full file replacement. Running twice produces the same output but replaces whatever `harvest.ts` wrote. Running datagov after harvest.ts loses any harvest.ts-only records if the resource coverage differs. VERIFIED — the function writes `unique` array unconditionally (line 203).

### What Can Silently Fail
- If `resource_id` changes, `total === 0` → `process.exit(1)`. Detected. VERIFIED.
- Neighbourhood match uses fuzzy `includes()` comparison; a neighbourhood name mismatch silently uses `neighName` string as the `neighborhoodId`, making downstream queries fail. LIKELY.

---

## scripts/fetch-renewal.ts

### Purpose
Fetches urban-renewal project complexes from data.gov.il (resource `f65a0daf-...`) for Netanya, maps each to a neighbourhood via `street-index.json`, and fetches ITM coordinates from ArcGIS. Writes `data/renewal.json`.

### Inputs
- data.gov.il CKAN API (renewal resource)
- ArcGIS UrbanRenewalPro FeatureServer
- `data/street-index.json`

### Outputs
- `data/renewal.json`

### Error Handling
ArcGIS fetch is wrapped in try/catch with `console.warn` on failure, falling back to street-level coordinates. VERIFIED (lines 93-94). data.gov.il fetch has no error handling — an HTTP error will throw and crash the script. VERIFIED.

### Idempotency
VERIFIED SAFE — Writes a fresh `renewal.json` each run; no merge needed.

---

## scripts/discover-neighborhoods.ts

### Purpose
One-time utility: validates candidate neighbourhood names against govmap API and prints JSON with ObjectID and ITM coordinates. Output is copied manually into `neighborhoods.json`. Not scheduled.

### Inputs
- Hard-coded `CANDIDATES` list
- govmap ES API

### Outputs
- Printed JSON to stdout only (no file written)

### Retries
VERIFIED — 3 attempts per name with 1500 ms sleep between attempts. VERIFIED (line 30).

---

## scripts/discover-streets.ts

### Purpose
One-time utility: fetches streets per neighbourhood from govmap AutoComplete, writes `data/streets.json`. Not scheduled.

### Inputs
- Hard-coded `NEIGHBORHOODS` list
- govmap AutoComplete API

### Outputs
- `data/streets.json` — `{neighbourhoodName: [street, ...]}`

### Pagination / Cap
VERIFIED — Results are limited to 12 streets per neighbourhood (`Array.from(set).slice(0, 12)`, line 74). This is a hard cap and does NOT enumerate all streets.

---

## scripts/remap-streets.ts

### Purpose
Re-maps all streets in `street-index.json` to the nearest neighbourhood (by ITM distance < 5000 m). Writes updated `street-index.json` and `streets.json`. Run after adding new neighbourhoods.

### Inputs
- `data/neighborhoods.json`
- `data/street-index.json`

### Outputs
- `data/street-index.json` — updated `neighborhoodId` / `neighborhoodName`
- `data/streets.json` — `{neighbourhoodName: [sorted streets]}`

### Idempotency
VERIFIED SAFE — Deterministic nearest-point calculation. Same output on repeated runs.

### Risk
Streets without x/y coordinates are skipped silently (`stillUnmapped++`). VERIFIED (line 31).

---

## scripts/remap-deals.ts

### Purpose
Updates `neighborhoodId` / `neighborhood` on every deal in `deals.json` to match the street-index mapping. Run after `remap-streets.ts`.

### Inputs
- `data/deals.json`
- `data/street-index.json`

### Outputs
- `data/deals.json` — updated neighbourhood fields

### Idempotency
VERIFIED SAFE — Writes only if `changed > 0`. VERIFIED (line 50).

### What Can Silently Fail
- Deals without a `street` field are skipped without logging. All such deals retain their original (possibly wrong) neighbourhood. VERIFIED (line 34).

---

## Summary of Key Risks

| Risk | Severity | Location |
|------|----------|----------|
| No 500-deal cap — memory of cap is incorrect | VERIFIED ABSENT | All harvest scripts |
| No total-record verification — harvest may stop early | HIGH | harvest.ts scrollUntilDone |
| No schema validation on decoded deals | HIGH | harvest.ts normalize() |
| Partial-ownership deals not filtered | MEDIUM | harvest.ts classify() |
| No checkpoint on crash (full-run) | MEDIUM | harvest.ts main() |
| Silent drop of deals when nadlan response format changes | HIGH | harvest.ts decodeDealData |
| datagov full-replace overwrites harvest.ts data | HIGH | fetch-datagov.ts main() |
| discover-streets hard-caps at 12 streets/neighbourhood | MEDIUM | discover-streets.ts line 74 |
| harvest-streets scroll cap at 18 rounds (vs 200 in harvest.ts) | MEDIUM | harvest-streets.ts line 186 |
| Phantom-to-real neighbourhood map is hard-coded | MEDIUM | harvest-missing.ts lines 38-44 |
| govmap cookie expiry during enrich-plot silently fails remaining deals | MEDIUM | enrich-plot.ts |
