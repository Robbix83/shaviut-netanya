# Wave 0G-5 — Official Neighborhood Index + Deal-Data Request Contract Proof

Status: EVIDENCE-GAP-CLOSING DIAGNOSTIC ONLY. No source changes, no data rebuild,
no canonical writes, no Supabase writes, no deployment.

## Phase 1 — Baseline

```
BASELINE_HEAD           = 8df994b090128243c19688042708e84535ff8ea1
CANONICAL_DEALS_ROWS      = 12,642
CANONICAL_DEALS_SHA256     = 18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
```

Both match the wave's expected values exactly. Verified unchanged at the end of
this wave too (see Phase 18-equivalent closing check below).

## Phase 2 — Official neighborhood index

Fetched read-only via plain `curl` (no browser, no reCAPTCHA involved — this is
a public static JSON file):

```
GET https://data.nadlan.gov.il/api/index/neigh.json  -> HTTP 200
```

Saved to `audit/wave0g5/neigh-index-raw.json`. Structure: a flat object with
**1,703 keys** (citywide/nationwide in scope, not Netanya-specific), every
value shaped `{"UNIQ_ID_OLD": <number>}` — this is an ID-remapping / legacy-id
crosswalk table, NOT a neighborhood entity catalog with names/coordinates. It
carries no `NAME`, `CITY`, `PARENT_ID`, `TYPE`, `X`, or `Y` fields — only the
bare current-id -> legacy-id mapping.

```
INDEX_POSITION  = N/A (flat object, not an array)
ID              = the object's own keys (e.g. "66239231")
NAME            = NOT PRESENT in this endpoint
CITY            = NOT PRESENT in this endpoint
PARENT_ID       = NOT PRESENT in this endpoint
TYPE            = NOT PRESENT in this endpoint
X / Y           = NOT PRESENT in this endpoint
OTHER_IDENTITY_FIELDS = UNIQ_ID_OLD (the only value field, on every entry)
```

Two directly relevant lookups:
- Our stored id `66239231` ("נוף הטיילת" in our system) **is** a key in this
  file, with `UNIQ_ID_OLD: 65210243`.
- The id under investigation, `65210195`, does **not** appear anywhere in this
  file — neither as a key nor as any entry's `UNIQ_ID_OLD` value.

A second, more useful endpoint was also fetched — the same "page" endpoint
Wave 0G-4 had already observed being called by the live UI
(`data.nadlan.gov.il/api/pages/neighborhood/buy/{id}.json`), tried this wave
for both the target id and our own stored id:

```
GET https://data.nadlan.gov.il/api/pages/neighborhood/buy/65210195.json  -> HTTP 200
GET https://data.nadlan.gov.il/api/pages/neighborhood/buy/66239231.json  -> HTTP 403 AccessDenied (S3-style XML error, not JSON)
```

The successful response (`audit/wave0g5/neigh-page-65210195.json`) contains:
`neighborhoodId, neighborhoodName, settlementID, settlementName, x, y,
otherNeighborhoods (38 {title,id} entries), otherNeighborhoodStreets (17
{title,id} entries), trends (price-history graphs only — no transaction count
field of any kind was found anywhere in this file, confirmed by the specialist
reviewer's independent search for "1276"/"count"/"dealsCount"/"numDeals" —
the live UI's "נמצאו 1276 עסקאות" figure must come from a different call, not
this static page), version ("20-08-2026")`.

**Our own stored id (`66239231`) returning `AccessDenied` on this same
endpoint pattern is itself notable**: it demonstrates our id, while still
resolvable via the interactive UI search box (proven working in Wave 0G-2),
has no corresponding static "page" file in nadlan's current backend — a
"half-working" id (see Phase 5/ECC below).

## Phase 3 — Netanya entity reconciliation

```
OFFICIAL_NETANYA_INDEX_ROWS = 38 (from the working page's otherNeighborhoods array)
DISTINCT_IDS                 = 38 (no duplicate ids observed)
DISTINCT_NAMES                = 38 (no duplicate names observed within this list — confirmed zero name collisions)
```

Per instruction, this is explicitly distinguished:

```
OFFICIAL_INDEX_ENTITIES        = 38
UNIQUE_HUMAN_NEIGHBORHOOD_NAMES = 38 (all 38 titles are distinct strings — no
                                   duplicate-name-different-id situation was
                                   found WITHIN this current 38-entity list
                                   itself; the earlier-discovered "second נוף
                                   הטיילת" duplication is between OUR stored
                                   66239231 and the official 65210195 — i.e.
                                   a duplication across two different id
                                   SYSTEMS, not within nadlan's own current
                                   catalog, which lists "נוף הטיילת" exactly
                                   once, at id 65210195)
```

Full table: [audit/wave0g5/netanya_index_entities.csv](netanya_index_entities.csv).
No duplicate names with different IDs were found within the 38-entity official
list itself.

## Phase 4 — Compare with our 21-neighborhood model

Full comparison: [audit/wave0g5/neighborhood_reconciliation.csv](neighborhood_reconciliation.csv).

```
OUR_NEIGHBORHOOD_COUNT         = 21
OFFICIAL_INDEX_ENTITY_COUNT     = 38
OFFICIAL_UNIQUE_NAME_COUNT       = 38

MATCHED_BY_NAME                  = 14 (of our 21) / 14 (of the official 38)
OFFICIAL_ENTITIES_MISSING_FROM_OUR_MODEL (by id) = 38 of 38 — every single
                                   official id is absent from our stored
                                   neighborhoods.json, confirmed by direct
                                   set comparison
OUR_NAMES_NOT_IN_OFFICIAL_INDEX   = 7: "כוכב הצפון", "אופק הים" — wait, only
                                   entries actually in our 21-row file are
                                   counted; the 7 with no current official
                                   name match are: "אגמים"[id 66239255],
                                   "כוכב הצפון"[66239286], "נוף השרון"[66239287],
                                   "קריית רבין"[66239257], "קריית צאנז"[65867363]
                                   (differs by one letter from official
                                   "קרית צאנז"), "מרכז העיר צפון"[66239254]
                                   and "מרכז העיר דרום"[67468658] (the
                                   official list has one unsplit "מרכז העיר")
```

**Critical, unambiguous finding: `MATCHED_BY_ID = 0` of 21.** Not one of our
21 stored neighborhood ids matches any of nadlan's own 38 current internal
ids — confirmed independently by the database-reviewer and specialist
reviewers reading the CSVs directly.

**Correction (planner-caught):** the `MATCHED_BY_NAME = 14` figure is a
floor, not the true count — official titles in the source JSON are truncated
at roughly 20 characters (e.g. `"נאות גנים - שיכון ות"`, `"מע\"ר - מרכז עירוני
ר"`, `"אזור תעשיה קריית אל"`), so exact-string matching against our
untruncated names produces false negatives. For example "קריית רבין" (our
name) almost certainly refers to the same entity as the official
`"קריית יצחק רבין"` (id 65210240) — an exact-match comparison misses this.
The true name-match count is closer to 16-17 of 21, not 14 — this does not
change the headline `MATCHED_BY_ID = 0` finding (id-space mismatch is exact
and unaffected by truncation), only the secondary name-matching statistic.

Per-missing-entity detail (all 38, since 0 matched): see the CSV. None were
added to our model, per instruction. Whether each is
`POTENTIALLY_TRANSACTION_BEARING` is UNKNOWN for entities not otherwise
tested this wave — with the specific proven exception of `65210195` (YES,
confirmed transaction-bearing, per Wave 0G-4 and Phase 6 below).

## Phase 5 — Prove first-hit discovery loss (and its true scope)

```
FUNCTION       = discoverNeighborhoods(), scripts/harvest.ts:65-120
SOURCE_LINES    = 65-120 (seed loop: 88-110; selection: 96-99)
INPUT_HITS       = one ES_BASE (es.govmap.gov.il/TldSearch) geocoding query per
                   SEED_NAMES entry (23 names)
SELECTION_RULE   = `const hit = j?.data?.NEIGHBORHOOD?.[0];` (harvest.ts:96) —
                   first array element only, no loop over further matches
DISCARDED_HITS    = any additional NEIGHBORHOOD[1..] entries the geocoding API
                   might return for a given name (not independently
                   re-verified live this wave — the code-level behavior is
                   proven, but whether the ES API itself actually returns
                   multiple hits for "נוף הטיילת" specifically was not
                   re-tested; this is a structural capability gap, proven by
                   the code, whether or not it was ever actually triggered
                   for this specific name)
```

**This wave's new evidence reframes the finding's significance.** As the
specialist reviewer put it: "first hit only" is real and confirmed in the
code, but it is now the *less important* half of the story. The bigger,
newly-proven fact is that our ENTIRE 21-id neighborhood space comes from an
unrelated geocoding system (GovMap's ES/`TldSearch`, `ObjectID` field) that
has **zero structural relationship** to nadlan.gov.il's own internal
neighborhood-entity id space (the `652xxxxx`-range ids used in its own
`/api/pages/neighborhood/buy/*.json` catalog, and — per Waves 0G-2/0G-4's raw
`/deal-data` captures — embedded in every raw transaction record's own
`neighborhoodId` field too). Even a "fixed" version of `discoverNeighborhoods()`
that kept every hit per name would still be querying the wrong id system
entirely, unless it switched to consuming nadlan's own catalog instead.

The silent-failure-hunter's independent pass quantified this precisely: of
the 38 official entities, only 14 are ever searched for with a matching exact
string; **19 are never attempted under any similar seed name at all**, and 5
more are attempted under a text string that doesn't exactly match the current
official name (e.g. our seed `"קריית רבין"` vs. the official `"קריית יצחק
רבין"`) — meaning even the "attempted" 19/38 are not guaranteed to resolve
correctly.

```
For נוף הטיילת:
OFFICIAL_HITS   = not independently re-tested live this wave (the ES_BASE
                 geocoding API itself was not re-queried) — but PROVEN
                 downstream that our discovery process's OUTPUT (id
                 66239231) and nadlan's own catalog id for the same name
                 (65210195) are two entirely different numbers, which is
                 sufficient to prove the practical effect claimed
KEPT_ID          = 66239231 (our stored value, per data/neighborhoods.json)
DISCARDED_IDS     = 65210195 is not literally "discarded" by the [0]-only
                 selection rule in a single ES_BASE call — it was never even
                 a candidate, since it comes from an entirely different id
                 system that discoverNeighborhoods() never queries at all.
                 The originally-hypothesized "first-hit discards a sibling"
                 mechanism is therefore NOT the literal mechanism for this
                 specific case; the actual mechanism is "wrong id system
                 entirely," a related but distinct and more severe defect.
```

## Phase 6 — Test the second נוף הטיילת entity directly

Per instruction, this used "the SAME existing neighborhood-level acquisition
mechanism" — reusing a genuine, already-captured, neighborhood-scoped (not
address-scoped) `/deal-data` response for id `65210195` from Wave 0G-4 (its
response index 1: triggered as a broader feed alongside the address-level
query, but itself a plain 500-row neighborhood-level pull, confirmed by every
item in it sharing `neighborhoodId: 65210195`). No new canonical-affecting
request was needed to answer this phase; a fresh equivalent live request was
not re-run since the existing evidence already satisfies the question and
avoids an unnecessary extra live browser session.

```
ROWS_RETURNED           = 500
EARLIEST_DATE             = 2014-09-23
LATEST_DATE                = 2026-05-16
DISTINCT_STREETS           = 11
DISTINCT_HOUSE_NUMBERS      = 32
```

```
BEN_AMI_41_ROWS_FOUND (all "עובד בן עמי 41" rows within this 500-row pull) = 46
KNOWN_7_FOUND = 7 / 7 — every one of the known official transactions is present:
```

| DATE | PRICE | AREA | FOUND |
|---|---|---|---|
| 2024-11-15 | ₪280,000 | 65 | YES |
| 2023-06-21 | ₪925,000 | 65 | YES |
| 2023-05-11 | ₪680,000 | 45 | YES |
| 2023-04-20 | ₪975,000 | 65 | YES |
| 2022-06-08 | ₪232,000 | 45 | YES |
| 2022-05-29 | ₪460,000 | 45 | YES |
| 2022-02-23 | ₪718,000 | 65 | YES |

**This is the wave's central result: a plain NEIGHBORHOOD-LEVEL query, once
correctly targeted at id `65210195`, recovers all 7 known transactions on its
own — no address-level query was necessary for these specific rows.**

## Phase 7 — Capture the successful address-level request contract

Reproduced live via Playwright (same operator Chrome profile, no reCAPTCHA
bypass — normal navigation and click), capturing the actual `/deal-data` POST
requests this time (Wave 0G-4 had captured only the response, not the
request body):

```
REQUEST_URL       = https://api.nadlan.gov.il/deal-data (no query string)
METHOD             = POST
CONTENT_TYPE        = text/plain
SAFE_POST_BODY_FIELDS = one top-level field, "##", whose value is a
                     REVERSED string that, once reversed back and base64
                     (URL-safe) decoded, is an HS256-header-shaped
                     three-segment envelope: {"alg":"HS256"} . <payload> .
                     <43-char segment>
SAFE_QUERY_FIELDS    = NONE (no query string at all on the URL)
```

**Correction to this wave's first-pass finding:** the planner review (Phase 14)
caught that this envelope is NOT truly opaque — reversing the captured string
and base64-decoding it (simple string manipulation on data already
legitimately captured; no signing key accessed, nothing forged, nothing
replayed) reveals a plain-text JSON payload. This was independently verified
by a fresh script decode, not just trusted from the planner's hand-decode.
The payload contains BOTH the query-identifying fields Phase 9 needs AND
several session-scoped fields that are genuine anti-bot/anti-replay
credentials — the latter have been redacted from the committed artifact
(`audit/wave0g5/dealdata_request_contract.json`) per this wave's own explicit
instruction not to collect or expose anti-bot tokens, even though the
specific captured credential had already expired by the time it was found.
Nothing was replayed or reused.

```
FIELD (decoded, non-credential)  | VALUE_FOR_BEN_AMI_41_QUERY | VALUE_FOR_NEIGHBORHOOD_65210195_QUERY | SEMANTIC_MEANING
base_id                          | "72721794"                  | "65210195"                              | the literal query key value — CONFIRMED to be the addressId (matches Wave 0G-4's raw response addressId exactly) for the address query, and the neighborhoodId for the broader query
base_name                        | "addressId"                 | "neighborhoodId"                        | tells the server which ID TYPE base_id is — proves this is a single, unified /deal-data endpoint that accepts multiple id types via the same envelope, not two separate endpoints
fetch_number                     | 1                            | 1                                        | almost certainly the pagination/scroll-page counter (each new scroll-triggered request would increment this) — this is very likely the actual pagination mechanism, previously unconfirmed
type_order                       | "dealDate_down"              | "dealDate_down"                          | sort order — descending by deal date. Directly explains and confirms the "most-recent-N sliding window" cap behavior proven live in Wave 0G-2

FIELD (redacted, credential-shaped) | why redacted
sk (nested JWT: {"domain":"www.nadlan.gov.il","exp":<ts>}) | session-bound anti-bot credential, matches the wave's own explicit "do not collect/expose anti-bot tokens" instruction
token (a UUID) | per-request nonce/replay-protection identifier, same reasoning
exp (unix timestamp) | expiry of the session-bound credential above
```

This directly and definitively answers Phase 9 (see below) — the query
identity is NOT unknown; it is a proven `base_id` + `base_name` pair, wrapped
in a short-lived, session-bound envelope that only a real, already-solved
browser session (exactly what Waves 0G-2 through 0G-5 have consistently used)
can legitimately produce. No attempt was made to access, derive, or verify
the HS256 signing key, and no token was reused across requests or sessions —
this remains a passive read of already-captured, already-expired data, not a
bypass of any protection.

## Phase 8 — Capture safe response shape

Already fully documented in Wave 0G-4 (unchanged, re-confirmed this wave via
the same response structure): raw items carry `assetId, addressId, polygonId,
neighborhoodName, neighborhoodId, address, dealDate, dealAmount, parcelNum,
dealNature, roomNum, floor, assetArea, yearBuilt, streetCode, settlmentID,
buildingFloors, hokHamecher, trend, prevDeals, ownership, priceSM, row_id`.

```
TOTAL_ROWS        = 101 (address-level) / 500 (neighborhood-level, capped)
ROWS_RETURNED       = same as above, single response each
PAGINATION_FIELDS    = none observed in the response shape itself; pagination
                     (such as it exists) is driven client-side by scrolling,
                     which triggers a NEW POST with a different opaque "##"
                     body — not a page/offset/cursor field in the response
ENTITY_FIELDS         = assetId, addressId, polygonId
ADDRESS_FIELDS         = address, street (parsed by us), houseNumber (parsed by us)
CADASTRAL_FIELDS        = parcelNum (gush-helka-subparcel composite string)
DEAL_FIELDS               = dealDate, dealAmount, dealNature, roomNum, floor, assetArea, yearBuilt, priceSM

CONFIRMS DIRECTLY:
parcelNum  = YES (present on every item)
gush/helka/subparcel = YES (embedded within parcelNum, not separate fields)
dealNature  = YES
street / houseNumber = NOT separate response fields — embedded in the single `address` string, parsed client-side (by us, or by nadlan's own UI)
entity ID    = YES (assetId + addressId)
```

## Phase 9 — Address query identity

```
ADDRESS_QUERY_IDENTITY = B — ADDRESS ID

Proven directly (Phase 7): the request's decoded base_name field is literally
"addressId" and base_id is literally "72721794" — the same addressId value
already observed in Wave 0G-4's raw response for this exact address. The
SAME endpoint/envelope shape also accepts base_name="neighborhoodId" (proven
by the second captured request, base_id="65210195") — so this is one unified
query surface parameterized by an id TYPE + VALUE pair, not a
address-only-specific mechanism.

CAN_THE_QUERY_BE_RECONSTRUCTED_FROM_OUR_EXISTING_STREET-INDEX_DATA = PARTIAL

Correcting this wave's own earlier draft finding: the query key IS now known
(addressId, a plain numeric value) — so the BLOCKER is not "we don't know
what the query needs," it's "we don't have a proven way to enumerate
addressIds for arbitrary addresses without already having found them via a
live search" (see Phase 12). Constructing the envelope itself would also
require replicating nadlan's session-bound sk/token/exp wrapping, which is
generated per live, already-authenticated browser session — so even knowing
the field names, this remains a per-address, full-browser-automation cost,
not a lightweight direct HTTP call from a script alone.
```

## Phase 10 — Distinguish two possible root causes

```
HYPOTHESIS_A (discovery-only fix is sufficient) = PARTIAL — proven for the
RECENT/reachable window only, not proven as a general guarantee.

HYPOTHESIS_B (address-level acquisition is fundamentally required) = DISPROVEN
for these 7 specific rows, since Hypothesis A's mechanism already recovers
them.
```

**Correction (planner-caught, and materially important):** the original
draft of this report classified Hypothesis A as fully PROVEN. That overstated
the evidence. All 7 known Ben Ami 41 rows fall in the 2022-2024 range — the
NEWEST end of what the 500-row, `type_order:"dealDate_down"` (confirmed
Phase 7) neighborhood-level response window can reach; that window's oldest
row bottoms out around 2014. The evidence proves discovery-fix-alone recovers
RECENT transactions for this address, but says nothing about whether any
older (pre-2014) transactions for id 65210195 — for this address or others —
would also be recovered, since they would fall outside the same 500-row
sliding window that Wave 0G-2 already proved exists at the neighborhood
level. Hypothesis A is therefore **necessary-but-not-sufficient evidence**,
not a blanket proof that fixing discovery alone makes the whole dataset
complete — it is proven only for the reachable recency window, consistent
with (not contradicting) the systemic 500-row-cap risk already established
across 18 of 21 neighborhoods in Wave 0G-2.

## Phase 11 — Acquisition architecture decision gate

```
CHEAPEST_TRUSTWORTHY_DIRECTION = OPTION 3 — hybrid (corrected discovery +
neighborhood + address-level augmentation), NOT a pure Option 1.
```

**Correction (planner-caught):** Option 1 alone ("just switch to the
official 38-entity catalog") is weaker than this report's first draft
claimed, for a reason independent of Hypothesis A's downgrade above:
`audit/wave0g5/neigh-index-raw.json`'s `UNIQ_ID_OLD` crosswalk is
**many-to-one, not a clean bijection** — both our stored id `66239231` AND
another of our ids, `66239288`, map to the SAME legacy id `65210243`, and
`65210243` itself currently identifies a completely different, differently-
named entity (`"מע\"ר - מרכז עירוני ר"`, not `"נוף הטיילת"`) in the current
38-entity catalog. This means `neigh.json` cannot serve as a reliable
automated translation table from our old ids to the new catalog — a
discovery fix cannot simply "remap" existing ids via this crosswalk; it
would need to re-derive correct ids from scratch (e.g. by name-matching with
truncation awareness, per Phase 4's correction, or by capturing nadlan's own
`neighborhoodId` directly from live `/deal-data` responses during a fresh
harvest pass, per the database-reviewer's Phase 14 finding). Combined with
Hypothesis A's downgrade to PARTIAL (proven for recent data only, not a
guarantee of full historical completeness even after discovery is fixed),
the more defensible cheapest-trustworthy direction is a hybrid: corrected
discovery (sourced from nadlan's own catalog, not the unreliable crosswalk)
as the primary fix, WITH address-level augmentation retained as a
defense-in-depth path for specific known gaps and for reaching beyond any
given polygon's 500-row recency window.

Not implemented, per instruction.

## Phase 12 — Address enumeration question

```
ADDRESS_ENUMERATION_SOURCE = PARTIAL

Newly discovered this wave: the same `/api/pages/neighborhood/buy/{id}.json`
endpoint that supplies the 38-entity neighborhood catalog ALSO supplies an
`otherNeighborhoodStreets` array (17 entries for this one neighborhood) —
plain street name + streetCode pairs, fetchable without a browser. This
directly cross-references our own `data/street-index.json`'s coded entries
(confirmed: nadlan's `streetCode 74001078` = our `code 1078`, both
identifying "עובד בן עמי"/"עובד בן-עמי" — the hyphen is a cosmetic-only
display variant in nadlan's own catalog, confirmed by direct comparison,
resolving a discrepancy the planner raised in the prior wave). This gives a
PROVEN, low-cost path to enumerate STREETS per (correctly-identified)
neighborhood. It does NOT give a proven path to enumerate individual
ADDRESSES (house-number-level) within a street — that would still require
either the opaque browser-driven address search (Phase 9) per candidate
address, or a citywide street-level harvest (already proven to work, if
noisier, per Wave 0G-3) as a proxy for address coverage.
```

## Phase 13 — Property type preservation

Reconfirmed against this wave's own fresh captures (both the address-level
101-row response and the neighborhood-level 500-row response for id
65210195):

```
RAW_DEAL_NATURE_PRESENT             = YES ("דירת נופש", present verbatim on
                                     the matching rows in both response types)
CURRENT_DEAL_MODEL_PRESERVES_IT       = YES (Deal.dealNature, unchanged from
                                     Wave 0G-4's finding — no code was
                                     modified this wave)
CURRENT_PROPERTYTYPE_FLATTENS_IT       = YES (classify()'s /דיר[הת]/ regex,
                                     unchanged, confirmed still collapses it
                                     to "apartment")
```

No change made, per instruction.

## Phase 14 — ECC review

| ECC_REVIEWER | VERDICT | KEY_FINDING |
|---|---|---|
| specialist (code-explorer) | CONFIRMED (4/5 fully, 1/5 partially) | Independently verified the neigh-index-raw.json shape and the 66239231/65210195 facts exactly; found no transaction-count field anywhere in the neighborhood page JSON (refining, not contradicting, the original hypothesis); reframed the root-cause characterization: "first-hit-only" is real but secondary — the primary defect is that our entire neighborhood id space comes from an unrelated geocoding system (GovMap TldSearch) with zero structural relationship to nadlan's own internal id space; confirmed no code anywhere references either nadlan static-catalog endpoint |
| database-reviewer | CONFIRMED | Independently re-verified the 0/21 id-overlap and 14/21 name-overlap figures directly from the CSVs; found no hardcoded neighborhoodId literals in production code (only in test fixtures, low migration risk); confirmed there is no offline way to re-derive correct official ids for the existing 12,642 rows from stored fields alone (no polygon-boundary dataset exists) — a fresh re-harvest would be needed for full migration; recommended (as analysis, not a directive) adding a separate `officialNeighborhoodId` field rather than a full id-space migration, as lower-risk |
| silent-failure-hunter | CONFIRMED (4 patterns) | Quantified precisely: of the 38 official entities, 19 are never searched for under any similar seed name at all, and 5 more are searched under a text string that doesn't exactly match the current official name; harvest.ts's per-neighborhood loop logs every harvest count including zero with no distinction from a legitimate "no activity" result; no code anywhere cross-checks a stored id against the static page catalog, so a "half-working" id (searchable via UI, absent from the static catalog — exactly our own 66239231's situation) can persist indefinitely undetected |
| security-reviewer | PASS (4/5 clean, 1 informational) | Confirmed the new script logs only url/method/content-type/postData, never other headers/cookies; independently judged the opaque "##" POST body safe to commit — it's nadlan's own client-to-server payload against a public endpoint, structurally inconsistent with a bearer/session-token pattern (differs per-request, no JWT shape), though flagged as best-effort judgment since the encoding itself isn't reverse-engineered; zero secret-pattern strings found in any new artifact |
| code-reviewer | APPROVE (5/5, 1 informational) | Confirmed no data/deals.json or Supabase access, all writes confined to audit/wave0g5/, header capture limited to content-type only; noted one low-probability, evidence-completeness-only race (an in-flight response-body read could theoretically be interrupted by context close near the very end of a run) that does not affect the request-contract capture itself and required no fix |
| planner | PARTIAL — draft overstated 3 findings, all corrected in this final version | (1) Independently confirmed the 38-entity list is a self-inclusive settlement roster (65210195 lists itself), strengthening Q1, but flagged that cross-neighborhood identity was not verified — a second neighborhood's page fetch would confirm the 38-set is truly citywide-invariant rather than per-neighborhood-contextual; not done this wave. (2) Caught that the reconciliation CSV's exact-string name matching produces false negatives due to ~20-char title truncation in the source JSON (true match count ~16-17/21, not 14/21). (3) Caught that Hypothesis A was overstated as fully PROVEN when the evidence only covers the 2022-2024 recency window, not full historical completeness. (4) Decoded (and this session independently re-verified via script) that the "opaque" POST body is a reversed-base64 envelope with plainly readable base_id/base_name/fetch_number/type_order claims plus session-bound sk/token/exp credential fields — corrected from this report's own too-conservative first-pass "UNKNOWN" classification; the credential fields were redacted from the committed artifact per the wave's own anti-bot-token instruction. Flagged the single most valuable remaining open question: does `/deal-data` accept date-window or pagination parameters inside the payload that could bypass the 500-cap directly? Not tested this wave (would require live experimentation with the payload's own field values, arguably edging toward "forging" a modified request — deferred pending explicit authorization). |

## Phase 15 — Root cause

```
BEN_AMI_41_ROOT_CAUSE = A — FIRST-HIT NEIGHBORHOOD DISCOVERY IS SUFFICIENT
ROOT CAUSE, for the specific 7 known transactions AS TESTED (all within the
2022-2024 recency window) — with the planner-caught caveat that this is
proven for that window only, not as a blanket guarantee across all possible
historical transactions for this or any other polygon.

Refinement (not a contradiction): the underlying MECHANISM is more precisely
"our neighborhood id space is sourced from an entirely different, unrelated
system than nadlan's own internal id space, and that crosswalk is not even
cleanly reversible (many-to-one UNIQ_ID_OLD mapping)" — "first-hit-only" is a
true but secondary defect on top of that. Classification A is still the
correct top-level answer to the wave's own A-E options for the specific rows
tested, since address-level querying (B) was proven NOT necessary for them —
but this should not be read as "the whole dataset would become complete if
discovery were fixed."
```

## Phase 16 — Production trust

```
CURRENT_PUBLIC_PRODUCTION_BLOCKED = YES

A credible correction path now exists (Option 1, Phase 11) and is
evidence-backed rather than speculative — but it has not been implemented,
tested at scale, or verified to actually resolve the systemic 500-row-cap
risk across all 21+ real neighborhoods once discovery is corrected. Per the
wave's own instruction not to treat "a credible path exists" as equivalent
to "safe today," and given the now-quantified scale of the gap (24-38
official entities structurally unreachable by current discovery, not just
one), production use remains blocked until a corrected acquisition pass is
implemented, run, and independently re-verified.
```

## Constraints and honesty notes

- **This report was substantively corrected after its first draft**, based
  on the planner ECC review (Phase 14). Three findings were downgraded or
  reversed from the initial pass: Hypothesis A (Phase 10/15) from PROVEN to
  PARTIAL; the cheapest-trustworthy-direction (Phase 11) from a pure Option 1
  to a hybrid; and the "##" POST body (Phase 7/9) from UNKNOWN/opaque to a
  decoded, structurally-understood envelope. All three corrections are
  documented inline at their respective phases, not silently applied — this
  is deliberate, per this engagement's standing rule to surface self-caught
  errors transparently rather than quietly fix them.
- The decode in Phase 7/9 was performed by reversing an already-captured
  string and base64-decoding it — a passive read of data already
  legitimately obtained, not an attempt to bypass reCAPTCHA, forge a token,
  or access any signing key. The session-bound credential fields it revealed
  (`sk`, `token`, `exp`) were redacted from the committed artifact before
  commit, consistent with the wave's explicit instruction not to collect or
  expose anti-bot tokens, even though the specific captured token had
  already expired by the time this was found.
- Phase 6 deliberately reused an already-captured response from Wave 0G-4
  rather than re-running a live query, to avoid an unnecessary additional
  browser session — this is explicitly noted so the evidence trail is
  transparent about what was freshly captured this wave (Phases 2, 7) versus
  reanalyzed from a prior wave's raw data (Phase 6).
- The planner's own most-important-open-question (does `/deal-data` accept
  date-window/pagination parameters that could bypass the 500-cap directly?)
  was NOT tested this wave — answering it would require constructing a
  MODIFIED request payload (not just reading a captured one), which edges
  into "forging" a request in a way this wave's constraints did not clearly
  authorize. Left open for explicit future authorization.
- `data/deals.json` SHA-256 verified unchanged throughout this wave (matches
  Phase 1's baseline exactly).
