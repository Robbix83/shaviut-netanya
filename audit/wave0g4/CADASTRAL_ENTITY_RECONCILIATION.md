# Wave 0G-4 — Cadastral / Parcel Entity Reconciliation

Status: DEEP INVESTIGATION / ARCHITECTURE TRACE ONLY. No fix, no rebuild, no
canonical data mutation, no Supabase write, no deployment.

## Phase 1 — Baseline

```
BASELINE_HEAD              = 4f3f3dd309d45b1a826b527c98d7622bb737b549
CANONICAL_DEALS_SHA256      = 18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
CANONICAL_DEALS_ROW_COUNT   = 12,642
```

Verified byte-identical throughout this wave (rechecked at the end — see Phase 18).
`graphify-out/` residue (pre-existing modified/untracked cache files) was left
untouched.

## Phase 2 — Current acquisition map

| MODE | INPUT ENTITY | REQUEST BUILDER | UPSTREAM URL/PATH | IDENTIFIER | MAX OBSERVED ROWS | PAGINATION | USED BY PRODUCTION HARVEST? | OUTPUT PARSER |
|---|---|---|---|---|---|---|---|---|
| NEIGHBORHOOD_MODE | neighborhood name (fixed SEED_NAMES list) | `harvestNeighborhood()`, `scripts/harvest.ts:341-377` | `https://api.nadlan.gov.il/deal-data` via UI autocomplete click on a "שכונה" suggestion | neighborhood name text; upstream resolves internally | 500 (single response, proven Wave 0G-2) | scroll-triggered, but no 2nd response ever observed | YES (main harvest loop) | `normalize()`, `harvest.ts:181-223` |
| STREET_MODE | street name (from `street-index.json`, filtered by `neighborhoodId`) | `harvestByStreets()`, `scripts/harvest.ts:271-339`; near-identical duplicates in `harvest-missing.ts` and `harvest-streets.ts` | same `/deal-data` endpoint, reached via a "רחוב"-labeled or exact-text autocomplete suggestion | street name text | 930 raw / 495 genuinely on-street (proven Wave 0G-3, 2 responses) | scroll-triggered, DOES support a 2nd response (unlike neighborhood mode) | YES (for `מרכז העיר צפון` via `STREET_MODE_NEIGHBORHOODS`, and via `HARVEST_STREET=<name>` env var) | same `normalize()` |
| ADDRESS_MODE | full address text ("street + house number") | **NOT_IMPLEMENTED** anywhere in the codebase — this wave discovered and used it manually via `scripts/audit-wave0g4-address-trace.ts`, a new read-only diagnostic, not part of any production script | same `/deal-data` endpoint, reached via a "כתובת"-labeled autocomplete suggestion | `addressId` (upstream-internal, e.g. 72721794) | 101 (single response, not observed to hit any cap) | not tested beyond one response — 101 < 500 so the cap was never approached | NO | none exists — proven this wave only |
| AUTOCOMPLETE_QUERY | free-text search box input | shared by all three modes above — same `input#myInput2` / `.react-autosuggest__input` fill + `<li>` suggestion click pattern | client-side suggestion list, backed by `data.nadlan.gov.il/api/index/*.json` static indexes (e.g. `neigh.json`) plus live typeahead | free text | N/A | N/A | YES (all harvest scripts depend on it) | N/A (UI only) |
| PARCEL_MODE (query BY gush/helka/subparcel) | **NOT_IMPLEMENTED**; **NOT PROVEN to exist upstream either** — `parcelNum` was only ever observed as an OUTPUT field inside every `/deal-data` response (all three modes), never used as a query INPUT in any UI flow or source code this wave examined | N/A | N/A | N/A | N/A | N/A | NO | N/A |
| ENTITY_DETAIL_MODE (expand a single transaction row) | **NOT_IMPLEMENTED / NOT OBSERVED** — an attempted click on visible "8252" text in the live UI triggered no additional network request (confirmed: exactly 6 requests logged total, matching the count before the click attempt) | N/A | N/A | N/A | N/A | N/A | NO | N/A |

```
NEIGHBORHOOD_MODE    = IMPLEMENTED (scripts/harvest.ts harvestNeighborhood())
STREET_MODE          = IMPLEMENTED (scripts/harvest.ts harvestByStreets(), scripts/harvest-missing.ts, scripts/harvest-streets.ts)
ADDRESS_MODE         = NOT_IMPLEMENTED (proven to exist upstream this wave; no production code uses it)
PARCEL_MODE          = NOT_IMPLEMENTED (existence upstream unproven — see Phase 7)
ENTITY_DETAIL_MODE   = NOT_IMPLEMENTED (existence upstream unproven — one click attempt produced no new request)
```

A fourth acquisition surface exists in the repo but is architecturally separate
from nadlan.gov.il entirely: `scripts/fetch-datagov.ts` pulls from data.gov.il's
CKAN open-data API (plain `fetch`, no Playwright/reCAPTCHA) and its `normalize()`
does read `GUSH`/`HELKA` fields directly from that source. This session found the
script's hardcoded `resource_id` (`43a3b913-e4e2-4a1d-9e96-6982ef5a9e5a`) and the
`remez` dataset slug both return 404 live; the CKAN catalog itself is reachable
(1,199 datasets total via `package_search`) but this session could not rediscover
the current correct resource_id within scope (Hebrew full-text search via the API
returned 0 results for several plausible terms; the site's own search box did not
navigate to a results page in this session either). Status: **UNVERIFIED / STALE**,
not further pursued — this is a real but secondary lead, out of this wave's
critical path.

## Phase 3 — Identifier inventory

See [audit/wave0g4/identifier_inventory.csv](identifier_inventory.csv) for the
full table. Summary of the critical question:

**ARE GUSH/HELKA/SUBPARCEL IDENTIFIERS AVAILABLE UPSTREAM BUT LOST BEFORE THE
FINAL DEAL MODEL? — YES, definitively proven.**

Every raw `/deal-data` response captured this wave family — neighborhood-mode
(Wave 0G-2, 500 items), street-mode (Wave 0G-3, 930 items), and address-mode
(this wave, 101 items) — carries the identical rich field set:
`assetId, addressId, polygonId, neighborhoodName, neighborhoodId, address,
dealDate, dealAmount, parcelNum, dealNature, roomNum, floor, assetArea,
yearBuilt, streetCode, settlmentID, buildingFloors, hokHamecher, trend,
prevDeals, ownership, priceSM, row_id`. `parcelNum` (format
`"<gush>-<helka>-<subparcel>"`, e.g. `"8252-156-59"`) is present on 100% of
sampled raw records across all three modes.

`scripts/harvest.ts`'s `normalize()` (and the near-identical functions in
`harvest-missing.ts` and `harvest-streets.ts`) reads only a small subset of
these fields into the final `Deal` object. `lib/types.ts`'s `Deal` interface has
no `addressId`/`parcelNum`/`polygonId`/`assetId` field at all — confirmed absent
from both the TypeScript type and the Supabase `deals` table schema
(`supabase/bootstrap_v1.sql`).

**Critically, `Deal.neighborhoodId` is not even sourced from the raw record's own
`raw.neighborhoodId` field** — it is set to `n.id`, the `Neighborhood` object the
harvest LOOP believes it is currently querying (`harvest.ts:214`,
`harvest-missing.ts:172`, `harvest-streets.ts:128`, all confirmed independently
by the specialist reviewer). The raw upstream `neighborhoodId`/`neighborhoodName`
fields are read into memory but never copied into the output at all. This single
fact is the direct explanation for Phase 9 below.

## Phase 4 — Operator-provided cadastral evidence

Live-verified against a real captured API response (not just the operator's
screenshot transcription) — see
[audit/wave0g4/ben_ami_41_reconciliation.csv](ben_ami_41_reconciliation.csv).

All 7 rows (the 5 originally supplied in Wave 0G-3 plus 2 additional rows newly
supplied in this wave's prompt) were found, with an exact `parcelNum` match, in
the live direct-address-query response. One small, honestly-noted discrepancy:
subparcel `8252-156-54` (23/02/2022, ₪718,000) is labeled `דירת נופש` in the
operator's transcription but the live official page itself currently shows
`ללא תיכנון` ("not classified") for that same row — this is what the live site
shows today, not a transcription error introduced by this investigation.

```
CANONICAL_MATCH = NO for all 7 (confirmed by direct date+price+area search
                   against all 12,642 canonical rows)
```

Canonical `data/deals.json` has no `gush`/`helka`/`subparcel` fields at all
(proven in Phase 3), so the reconciliation search used only date, price, and
area — the same method Wave 0F-3A and Wave 0G-2/0G-3 used. Zero matches found.

## Phase 5 — Official UI network trace

Executed successfully, without bypassing reCAPTCHA or any anti-bot control —
using the same normal browser navigation and the operator's own pre-existing,
already-authenticated `~/.harvest-chrome` Chrome profile that Waves 0G-2 and
0G-3 already used legitimately.

Searching `"עובד בן עמי 41 נתניה"` in the live search box produced an
autocomplete suggestion whose text read **`"עובד בן עמי 41 נתניה" [כתובת]`** —
a distinct **address-type** entity, separate from both the street- and
neighborhood-type suggestions used in prior waves. Clicking it triggered:

```
[req 1] GET  https://data.nadlan.gov.il/api/index/neigh.json
[req 2] GET  https://data.nadlan.gov.il/api/pages/neighborhood/buy/65210195.json
[req 3] GET  https://data.nadlan.gov.il/api/index/dealNatureIndex.json
[req 4] POST https://api.nadlan.gov.il/deal-data     -> 101 items (the address-specific set)
[req 5] GET  https://data.nadlan.gov.il/api/pages/neighborhood/buy/65210195.json?t=...
[req 6] POST https://api.nadlan.gov.il/deal-data     -> 500 items (a broader neighborhood-level feed for the SAME id 65210195)
```

**The critical discovery: `65210195` is a neighborhoodId that appears NOWHERE in
our system** — not in `data/neighborhoods.json` (21 entries, none matching), not
in `data/street-index.json`, not in `data/deals.json`. The raw record's own
`neighborhoodName` for this id is `"נוף הטיילת"` — the SAME name as our existing,
already-harvested neighborhood id `66239231`. **nadlan.gov.il's backend appears
to have (at least) two separate polygon/neighborhood records both named
"נוף הטיילת."** Our `discoverNeighborhoods()` function only ever found one of
them (Phase 9 below).

The live page's own visible text (captured verbatim, see
[audit/wave0g4/address_trace_page_text.txt](address_trace_page_text.txt))
confirms this independently of the raw JSON: heading
`"עובד בן עמי 41, נוף הטיילת, נתניה"`, section title
`"עסקאות בכתובת עובד בן עמי 41, נתניה"`, and `"נמצאו 101 עסקאות"` — an exact
match to the 101-item raw response.

Only safe metadata was captured: request method, URL, and (for `/deal-data`
only) decoded response bodies of public transaction records. No cookies, no
Authorization headers, no tokens were ever read or logged — independently
confirmed by the security-reviewer pass (Phase 15).

An attempt to click on visible "8252" (gush) text to see if a per-transaction
detail view fires a further request produced no additional network call
(request count stayed at 6) — no `ENTITY_DETAIL_MODE` was found.

## Phase 6 — Operator network capture fallback

**Not needed.** Phase 5's automated trace succeeded fully using the existing,
already-authorized browser session — no reCAPTCHA or anti-bot block was
encountered, so no operator manual-capture procedure was required.

## Phase 7 — Test cadastral queryability

The proven, evidence-backed query mode is **address-level**, keyed by
`addressId` (an internal identifier resolved by nadlan's own autocomplete from
free-text address input — not something our system currently captures or could
construct without first also solving the discovery problem in Phase 9).

```
QUERY_KEY               = addressId (this is the identifier that CHARACTERIZES
                           the 101-row result set — every row shares it — but it
                           is not confirmed as the literal request parameter,
                           since the POST body was not captured; see Constraints.
                           reached here via free-text address search
                           "עובד בן עמי 41 נתניה", not by direct addressId
                           injection — a direct addressId-parameterized request
                           was NOT attempted, since no such endpoint contract
                           was proven from source or from the captured network
                           trace)
QUERY_VALUE              = "עובד בן עמי 41 נתניה" (free text, resolved via autocomplete)
ROWS_RETURNED             = 101
TARGET_TRANSACTION_FOUND  = YES — all 7 known transactions present, matched by exact parcelNum
TARGET_ADDRESS            = "עובד בן עמי 41" (verbatim on every one of the 101 returned rows)
TARGET_DEAL_NATURE         = predominantly "דירת נופש" (vacation apartment); one row ("ללא תיכנון")
```

A true `gush`/`helka`/`subparcel`-keyed query (independent of any free-text
address resolution) was **not proven to exist** — `parcelNum` was only ever
observed as an OUTPUT field in every response, never as a queryable INPUT
parameter in any UI flow, autocomplete suggestion, or source-code path examined
this wave. Per the wave's explicit instruction not to invent an endpoint, this
was not further tested. Testing the other 6 known subparcels via a *separate*
direct query was therefore not performed, since the first query mode
(address-level, free-text) is proven legitimate but is not itself a
cadastral/gush-helka query — it is an address query that happens to return
cadastral identifiers as output.

## Phase 8 — Address entity vs street entity

```
OFFICIAL_ENTITY_MODEL      = C — parcel-based address. The 101 transactions all
                              share gush 8252 / helka 156, with each individual
                              transaction distinguished only by its subparcel
                              (תת-חלקה, e.g. -59, -58, -57...). This is a single
                              large building/complex (over 100 individually
                              transacted sub-units under one municipal address)
                              registered as one cadastral parcel (gush-helka),
                              with each apartment unit as its own subparcel.
DISPLAY_ADDRESS             = "עובד בן עמי 41" (identical on all 101 rows)
QUERY_ENTITY                 = address (addressId=72721794), NOT a bare street or
                              bare parcel entity
ENTITY_ID                    = addressId 72721794 (also assetId varies per
                              individual transaction/unit, e.g. 4853658 for the
                              first known row)
STREET_ID                    = streetCode 74001078 (= settlmentID 7400 +
                              street-index.json's own municipal code 1078 for
                              "שד עובד בן עמי" — confirmed this matches our
                              existing coded street-index entry exactly, so the
                              STREET identity is correctly cross-referenced
                              upstream even though our system never captures it)
HOUSE_NUMBER                  = 41 (embedded in the address string, not a
                              separately broken-out field in the raw response)
GUSH                          = 8252
HELKA                         = 156
SUBPARCEL_RELATIONSHIP        = one subparcel per individually-sold apartment unit
                              within the same building (helka 156 spans
                              subparcels observed from 1 to 143, with 101 of
                              those having recorded transactions)
```

## Phase 9 — Why street query misses house 41

```
FIRST_DIVERGENCE_STAGE = discovery (scripts/harvest.ts's discoverNeighborhoods())
```

Classification: **A — street query uses a different entity index** (specifically:
a different NEIGHBORHOOD entity index — the street query itself resolves the
street correctly by streetCode, but the transactions live under a second,
undiscovered neighborhood polygon that neither neighborhood-mode nor
street-mode harvesting has ever queried).

```
PROOF:
```
1. `discoverNeighborhoods()` (`scripts/harvest.ts:65-120`) queries a fixed list
   of ~23 neighborhood NAMES against an ES-based geocoding API and keeps only
   `j?.data?.NEIGHBORHOOD?.[0]` — the FIRST hit per name (`harvest.ts:96`). There
   is no loop over additional hits and no dedup/merge logic for two polygons
   sharing a name. This was independently confirmed by the specialist reviewer.
2. Our `data/neighborhoods.json` has exactly one "נוף הטיילת" entry, id
   `66239231` — the one Wave 0G-2 already tested and proved capped at 500.
3. The live official UI, searching directly for the missing address, resolves it
   to neighborhoodId `65210195`, ALSO named "נוף הטיילת" — an id our system has
   never seen in any file (`neighborhoods.json`, `street-index.json`,
   `deals.json` — confirmed absent from all three).
4. Neither `harvestNeighborhood()` (which only ever iterates over
   `data/neighborhoods.json`'s known 21 ids) nor `harvestByStreets()` (which
   filters `street-index.json` by a KNOWN `neighborhoodId`, and separately, in
   Wave 0G-3's live test, actually swept in the correct street's transactions
   but mistagged them under yet a THIRD id, `66239254`, because
   `normalize()`/`normalizeRaw()` always stamps the loop's assumed
   neighborhood rather than the raw record's own `neighborhoodId` — see Phase 3)
   has any code path that would ever reach id `65210195`.
5. Therefore: it is not that the street query "excludes" house 41 by some
   filter — it is that the entire polygon this address's transactions live
   under has never been queried by ANY current acquisition mode, at any level.

This also directly resolves the apparent paradox from Wave 0G-3: the street-mode
query for "עובד בן עמי" DID return transactions for this street (495 genuine
on-street rows, house numbers 2 and 10) — but those came from an entirely
different underlying polygon/harvest context (tagged `66239254`,
"מרכז העיר צפון", per Wave 0G-3's canonical-comparison finding), not from
`65210195`. House 41's transactions are not "missing from the street" in any
general sense — they simply belong to a polygon our system has never visited.

## Phase 10 — Property type / deal nature contract

```
RAW_DEAL_NATURE_AVAILABLE   = YES ("דירת נופש", confirmed present verbatim in
                              raw.dealNature on every matching row)
RAW_VALUE                    = "דירת נופש"
CURRENT_NORMALIZED_TYPE       = "apartment" (via classify()'s /דיר[הת]/ regex,
                              confirmed unchanged in scripts/harvest.ts:172-178,
                              harvest-missing.ts:133-139, and
                              scripts/fetch-datagov.ts:42-48 — all three harvest
                              paths apply the identical regex)
RAW_VALUE_PRESERVED_ANYWHERE  = YES — Deal.dealNature stores the raw string
                              verbatim (confirmed in lib/types.ts and
                              harvest.ts's normalize() output). The raw text is
                              NOT lost; only the coarse propertyType
                              classification collapses "דירת נופש" and a
                              regular "דירה" into the same "apartment" bucket.
SEMANTIC_INFORMATION_LOST     = NO for storage (dealNature is preserved
                              verbatim) / YES for any code path that filters or
                              searches by propertyType instead of dealNature —
                              e.g. lib/valuation.ts's comparable search filters
                              by propertyType, so it cannot currently
                              distinguish a vacation unit from a standard
                              apartment even though the raw distinguishing text
                              is sitting right there in the same row.
```

Future data-contract direction (NOT implemented, per instruction):

```
SEARCH CORPUS:      all official transactions we can legitimately acquire
                     (including "דירת נופש" and any other dealNature variant)
VALUATION CORPUS:    only transactions whose dealNature is compatible with the
                     target property category the end user is valuing — this
                     would require lib/valuation.ts to filter/weight on the
                     preserved raw dealNature string, not only on the coarser
                     propertyType, when the two diverge semantically
```

## Phase 11 — Are vacation units systemic?

No further live scraping performed for this phase, per instruction — canonical
data + source logic only.

```
CURRENT_VACATION_ROWS_DETECTABLE = YES
COUNT = 231 (rows in data/deals.json where dealNature contains "נופש")
```

This count is derived from the PRESERVED raw `dealNature` string field (already
stored, per Phase 10) — not invented from the normalized "apartment" bucket, and
not from any new live scrape. All 231 currently normalize to `propertyType:
"apartment"` and are therefore currently indistinguishable from standard
apartments in any valuation logic that reads `propertyType` rather than
`dealNature`. None of these 231 rows are on `עובד בן עמי` — the specific 7 known
missing transactions are a distinct, separate case (an acquisition-discovery
gap, not a classification gap), but the pattern shows vacation units DO already
exist within canonical data elsewhere in the city, just unflagged.

## Phase 12 — Source contract risk

See [audit/wave0g4/acquisition_surface_matrix.csv](acquisition_surface_matrix.csv)
for the full table. Summary:

| SOURCE_SURFACE | SAFE_FOR_CITYWIDE_REBUILD? |
|---|---|
| Neighborhood-level | NO — proven 500-row cap, proven blind to duplicate-named polygons |
| Street-level | NO — proven contamination from neighboring streets; still missed the target entirely |
| Address-level | PARTIAL — reached the target cleanly and uncapped in this one test, but not implemented anywhere, and there is no proven "list all addresses" enumeration surface to drive it at scale |
| Cadastral/parcel-level | UNKNOWN — no query-by-gush/helka mode proven to exist |
| data.gov.il / CKAN | UNKNOWN — architecturally attractive (has GUSH/HELKA fields, no reCAPTCHA) but currently unverified/stale (hardcoded resource_id returns 404) |

No rebuild is recommended from any UNKNOWN surface, per instruction.

## Phase 13 — Completeness architecture options (no implementation)

| OPTION | COVERAGE_PROS | KNOWN_GAPS | QUERY_VOLUME | DEDUP_COMPLEXITY | IDENTIFIER_STABILITY | PROPERTY_TYPE_PRESERVATION | CURRENT_EVIDENCE_LEVEL |
|---|---|---|---|---|---|---|---|
| A. Per-neighborhood | simplest, ~21 queries | 500-row cap; blind to duplicate-named polygons (proven: 65210195) | lowest | low (current scheme) | current `id` scheme, prefixed by (possibly wrong) neighborhoodId | dealNature preserved as today | HIGH (extensively proven across 0G-1/0G-2) |
| B. Per-street | recovers much more history for a given street | contaminates with neighboring streets (Wave 0G-3: 435/930); still blind to polygon 65210195-class gaps | ~417-1,048 queries (Wave 0G-3 estimate) | high — cross-street dedup needed | same risk as A | same as A | MEDIUM (proven for exactly one street) |
| C. Per-address | reached the specific known gap cleanly, uncapped in the one test performed | no proven enumeration surface to drive it (how do you get the address list in the first place, especially for undiscovered polygons like 65210195?); untested at any scale beyond 1 address | very high if driven by exhaustive address enumeration | needs an addressId-based id scheme, not currently modeled | would need parcelNum/addressId as first-class identifiers (schema-additive, per database-reviewer) | dealNature already preserved; propertyType classification unchanged unless separately fixed | LOW-MEDIUM (proven for exactly 1 address) |
| D. Per-cadastral/entity | would directly solve the duplicate-polygon problem if it exists | existence of a direct gush/helka query mode is UNPROVEN | unknown | unknown | would be the most stable identifier of all (gush/helka/subparcel are immutable land-registry identifiers) | unaffected | VERY LOW (no direct evidence either way) |
| E. Hybrid (neighborhood/street sweep + polygon-discovery step that also queries by NAME without assuming one-result-per-name, plus preserving raw parcelNum/addressId on every ingested row) | addresses the actual proven root cause (missed polygon discovery) without requiring an unproven cadastral query mode | still inherits the 500-row cap risk per individual polygon query unless address-level fallback is also added | moderate — one extra discovery pass, not a full rebuild | moderate | improved if parcelNum/addressId are captured from every response (schema-additive) | improved if dealNature-based filtering is added at the valuation layer | evidence-based, follows directly from Phase 9's proven root cause |

No optimization or recommendation to build any of these is made here — this is
a comparison table only, per instruction.

## Phase 14 — Graphify cross-check

The existing `graphify-out/graph.json` graph (queried read-only via
`graphify query`) was used to identify candidate nodes; every claim below was
then independently verified against actual source (per the wave's own
instruction that graphify is not source of truth). The graph itself appears to
reflect an earlier state of the project (it still references
`audit/reconciliation/*` and `audit/MASTER_AUDIT_REPORT.md`, artifacts from
before the current "Wave" naming convention) but the acquisition-pipeline file
list it surfaced was accurate and verifiably complete for this trace.

```
ACQUISITION_ENTRY_NODES        = scripts/harvest.ts, scripts/harvest-missing.ts,
                                  scripts/harvest-streets.ts, scripts/fetch-datagov.ts
                                  (all verified to exist and match the graph's claims)
PARSER_NODES                    = decodeDealData(), normalize()/normalizeRaw() in
                                  each of the three nadlan-facing harvest scripts;
                                  a structurally distinct normalize() in
                                  fetch-datagov.ts for the separate CKAN source
NORMALIZATION_NODES             = classify() (property-type collapse, identical
                                  regex duplicated 3x), parseAddress(),
                                  parseFloor() — all independently verified
                                  present and near-identical across the 3
                                  nadlan-facing scripts
MODEL_NODES                     = lib/types.ts (Deal interface) — verified to be
                                  the single shared contract all harvest scripts
                                  write into
OUTPUT_NODES                    = data/deals.json (local file target) and the
                                  Supabase `deals` table (supabase/bootstrap_v1.sql)
                                  — verified 1:1 mirror of the Deal type, no
                                  cadastral columns present in either
VALUATION_DEPENDENCY_NODES      = lib/valuation.ts (comparable search, filters by
                                  propertyType not dealNature — Phase 10),
                                  lib/store.ts (data access layer)
```

Estimated blast radius for a future acquisition redesign that adds
`addressId`/`parcelNum`/raw-`neighborhoodId` as first-class fields: **small and
additive**. It touches exactly the parser/normalization functions in the 3-4
harvest scripts (add field reads), the `Deal` type (add nullable fields), and
the Supabase schema (add nullable columns) — confirmed by the database-reviewer
to require no destructive migration and no cross-table cascade, since no other
table has a foreign key into `deals` besides `deals.neighborhoodId ->
neighborhoods.id`. It would NOT need to touch `lib/valuation.ts` unless the
dealNature-based filtering improvement from Phase 10 is separately pursued. No
refactor of high-centrality/unrelated nodes is proposed.

## Phase 15 — ECC review round

| ECC_REVIEWER | VERDICT | KEY_FINDING |
|---|---|---|
| planner | PARTIAL — evidence strong on WHAT, weaker on HOW | Correctly identified the single most important gap: the `/deal-data` POST request BODY was never captured, so "address-entity query keyed by addressId" is an inference from response payload fields, not a directly observed request — it remains equally consistent with a neighborhood-scoped query (65210195) plus a filter. Also surfaced strong independent corroboration this report had under-weighted: the live page's own footer reads **"סה"כ 38 שכונות"** (38 total neighborhoods) against our system's 23 `SEED_NAMES` / 21 stored neighborhoods — direct, quantified proof of systemic under-enumeration, not just a one-address curiosity. One planner claim was independently re-checked and found incorrect: it reported zero `street-index.json` matches for "עובד בן עמי" — direct re-verification this wave found two matching entries (`"עובד בן עמי"` and `"שד עובד בן עמי"`, both `neighborhoodId 66239231`). The planner's underlying live-UI observation (the neighborhood-sidebar list shows "עובד בן-עמי" with a hyphen, while the address heading shows it without one) is real, but doesn't change the root-cause conclusion, since Wave 0G-3 already proved the space-form text is independently resolvable by nadlan's own autocomplete (930 raw rows returned).
| specialist (code-explorer) | CONFIRMED (4/5 fully, 1/5 partially) | Independently verified all 5 core claims: neighborhoodId is stamped from loop context not raw data (all 3 harvest scripts); the 13 rich upstream fields are read nowhere in any harvest script; `discoverNeighborhoods()` structurally keeps only the first geocoding hit per name; `Deal` type has none of the cadastral fields; no other code in the repo secretly consumes these fields (fetch-datagov.ts's GUSH/HELKA use is a legitimately separate, unrelated source) |
| database-reviewer | CONFIRMED | Deal/Supabase schema mirror exactly, no cadastral columns exist in either; flagged an ADDITIONAL, previously-undocumented risk: the current `id` scheme's fallback key (`dealDate-price-area` when keyValue/dealId are absent) is not collision-resistant and a first-write-wins dedup could silently drop a genuinely distinct transaction; confirmed adding parcelNum/addressId as nullable columns would be low-risk and additive, not a breaking migration |
| silent-failure-hunter | CONFIRMED (4/4) | Found 4 concrete silent-failure patterns: (1) no cross-check between assumed and raw neighborhood/street identity anywhere in any harvest script; (2) lib/valuation.ts's confidence score cannot distinguish "genuinely thin market" from "structurally incomplete acquisition" — both render as plain low confidence to the end user; (3) the id-collision risk independently corroborated by the database-reviewer; (4) `discoverNeighborhoods()` never logs when a seed name resolves to zero or to a since-discarded additional polygon — the entire 65210195 gap would have been invisible in any log output this whole engagement |
| security-reviewer | PASS (4/4) | No cookies/auth headers/tokens/secrets logged or committed anywhere in the new scripts or artifacts; confirmed `ownership` arrays were empty (no personal data) in all captured records; confirmed the Chrome profile's contents were never written to any output file; noted (and correctly disregarded, per prompt-injection hygiene) an unrelated tool-instruction block that appeared in its own context |
| code-reviewer | APPROVE (5/5, 1 LOW note) | Both new diagnostic scripts confirmed read-only (no data/deals.json writes, no Supabase code path), output confined to their own audit directories, and the street-mode script's suggestion-selection logic verified byte-for-byte faithful to the real harvestByStreets(); one LOW-severity note: the diagnostic's scroll-loop constants (250 rounds/5 idle) don't exactly match the production scrollUntilDone()'s (200/4), making it slightly more patient — doesn't affect evidence validity, just a header-comment precision nit, not fixed per this wave's no-source-changes scope |

No reviewer was asked to modify application source, per instruction.

## Phase 16 — Root cause verdict

**A. BEN AMI 41 ACQUISITION ROOT CAUSE**

Classification: **A — ADDRESS/ENTITY INDEX DIFFERENT FROM STREET INDEX**

More precisely: the transactions live under a second, previously-undiscovered
NEIGHBORHOOD polygon (id `65210195`, also named "נוף הטיילת") that our
`discoverNeighborhoods()` function's first-hit-only, name-based discovery never
found. This is a discovery-layer gap, not a filter, not a classification issue,
and not (primarily) the previously-proven 500-row cap — though that cap does
also apply to this newly-found polygon once you do query it broadly (proven:
the second live response for id 65210195 was itself capped at exactly 500).

**B. CITYWIDE ACQUISITION STRATEGY**

Classification: **HYBRID_REQUIRED**

Neither neighborhood-only nor street-only acquisition is safe alone (both
independently proven incomplete, in different ways, across Waves 0G-1 through
0G-4). Address-level querying reached the one known gap cleanly, but has no
proven enumeration surface to scale it, and cadastral-level querying's very
existence is unproven. A hybrid — proper multi-polygon-aware discovery,
combined with preserving the raw identifiers (parcelNum/addressId/raw-
neighborhoodId) that already exist in every response but are currently
discarded — is the only strategy this wave's evidence actually supports.

## Phase 17 — Product trust verdict

```
CAN_CURRENT_12642_ROW_DATASET_SUPPORT_PUBLIC_PRODUCTION_VALUATIONS?
ONLY_WITH_STRONG_GUARDRAILS
```

This verdict is not softened for schedule reasons. Given the now cumulatively
proven facts across this wave family: (1) a 500-row acquisition cap affecting
18/21 neighborhoods (Wave 0G-2), (2) street-level acquisition recovering
dramatically more history for at least one tested street while still missing
its target (Wave 0G-3), and (3) this wave's proof of a structurally
undiscovered second neighborhood polygon whose ~1,276 transactions (per the
live page's own count) have NEVER been queried by any acquisition mode — the
dataset cannot currently be presented to end users as complete or as capable of
reliably reflecting "no comparable data exists" versus "our acquisition never
reached this area." Any production use requires visible guardrails (e.g.
explicit low-confidence/limited-data disclosure) rather than presenting
estimates as if backed by a complete government record.

## Constraints and honesty notes

- **Most important open gap (raised by the planner review):** the exact HTTP
  request BODY sent to `POST /deal-data` for the address-level query was not
  captured by this session's diagnostic — only the URL, method, and response
  were logged (deliberately, to avoid capturing headers/cookies). This means
  "address-entity query keyed by addressId" is proven as an OUTPUT
  characteristic (every returned row carries a consistent addressId/parcelNum
  restricted to one address) but the exact REQUEST contract that produced it
  is not reverse-engineered — it remains possible the request itself is
  scoped by neighborhoodId 65210195 with server- or client-side address
  filtering, rather than a literal addressId query parameter. This does not
  change Phase 9's root-cause conclusion (polygon 65210195 is unreached either
  way), but it does mean Phase 7's `QUERY_KEY=addressId` should be read as
  "the identifier that characterizes the result set," not as a confirmed
  literal request parameter name.
- The live page's own request to `data.nadlan.gov.il/api/index/neigh.json`
  (the first request observed, seq 1) is very likely a full index of nadlan's
  own neighborhood entities — its response body was not captured this session
  (only /deal-data responses were decoded and saved). Reading that response
  would likely be the cheapest possible next step to confirm the
  duplicate-polygon hypothesis directly (see Next Recommended Step).
- The live page's own footer text confirms **"סה"כ 38 שכונות"** (38 total
  neighborhoods) exist in nadlan.gov.il's system for Netanya, versus our 23
  `SEED_NAMES` / 21 stored neighborhoods — strong, quantified, independent
  corroboration that under-enumeration is systemic, not specific to "נוף
  הטיילת" alone.
- This wave tested exactly one address ("עובד בן עמי 41"). No claim is made
  that every neighborhood in Netanya has a similarly undiscovered duplicate
  polygon — only that the mechanism which would cause such a gap (first-hit-
  only name-based discovery) is structurally present and unguarded across the
  whole codebase.
- The data.gov.il/CKAN alternate surface (Phase 2, Phase 12) was investigated
  but its current resource_id could not be rediscovered within this wave's
  scope; this is reported as UNKNOWN, not as ruled out.
- `data/deals.json` SHA-256 verified unchanged throughout (see Phase 18).
