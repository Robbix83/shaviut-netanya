# Wave 0G-6 — Official Netanya Catalog Invariance Proof

Status: EVIDENCE-ONLY MICRO-WAVE. No source changes, no data rebuild, no
canonical writes, no Supabase writes, no deployment.

## Phase 1 — Baseline

```
BASELINE_HEAD  = d371a9d99e3f6b23cbdcfcfce1fb75c1d466ca44
CANONICAL_ROWS  = 12,642
CANONICAL_SHA   = 18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
```

Both match expected values exactly. Reconfirmed unchanged at close (see
Constraints).

## Phase 2 — Control catalog

Re-fetched (plain GET, no browser, no reCAPTCHA) the already-proven entity:

```
GET https://data.nadlan.gov.il/api/pages/neighborhood/buy/65210195.json -> HTTP 200
```

```
CONTROL_COUNT       = 38
CONTROL_IDS_SHA256    = 2732aaadde89bd46bcd67b7d71ae90aa1da29ddd30394b8eeeaa1021295e52f1
CONTROL_NAMES_SHA256   = 1ede59c6e6ac83bc5277cf888c70195080be0e6cc4eeeab7d7ec6ddf90b48da9
```

Saved: [audit/wave0g6/control_catalog.csv](control_catalog.csv) (38 rows,
`ID,NAME`, sorted deterministically by numeric ID).

## Phase 3 — Independent test entity

```
TEST_ENTITY_NAME = רסקו (Rasco)
TEST_ENTITY_ID    = 65210248
```

Chosen from the official 38-entry catalog itself (not from our app's model,
per instruction). "רסקו" is a historic, inland Netanya neighborhood
(coordinates x=187298, y=693778) geographically and historically distinct
from "נוף הטיילת" (a coastal/promenade-adjacent neighborhood, x=185657,
y=690599) — roughly 3.4km apart by straight-line ITM coordinate distance,
and named after an entirely unrelated development-company-era housing
project rather than any coastal feature.

## Phase 4 — Test entity page

```
GET https://data.nadlan.gov.il/api/pages/neighborhood/buy/65210248.json -> HTTP 200
```

```
TEST_COUNT       = 38
TEST_IDS_SHA256    = 2732aaadde89bd46bcd67b7d71ae90aa1da29ddd30394b8eeeaa1021295e52f1
TEST_NAMES_SHA256   = 1ede59c6e6ac83bc5277cf888c70195080be0e6cc4eeeab7d7ec6ddf90b48da9
```

Saved: [audit/wave0g6/test_catalog.csv](test_catalog.csv).

## Phase 5 — Exact set comparison

```
CONTROL_COUNT = 38
TEST_COUNT     = 38

ID_SET_EQUAL           = YES (identical SHA-256 over sorted, comma-joined ids)
NAME_SET_EQUAL          = YES (identical SHA-256 over sorted, pipe-joined names)
ID_NAME_PAIR_SET_EQUAL   = YES (identical SHA-256 over sorted "id:name" pairs —
                          the strongest comparison, per instruction, and it
                          passes cleanly)

ONLY_IN_CONTROL = [] (empty — nothing present in control that's absent from test)
ONLY_IN_TEST     = [] (empty — nothing present in test that's absent from control)

SELF_INCLUDED_CONTROL = YES (65210195/"נוף הטיילת" is a member of its own list)
SELF_INCLUDED_TEST      = YES (65210248/"רסקו" is a member of its own list)
```

The two independently-fetched pages return byte-for-byte identical
`otherNeighborhoods` catalogs — not merely equal counts, but an exact,
verified id+name pair-set match.

## Phase 6 — Order / context check

```
MEMBERSHIP_INVARIANT = YES
ORDER_INVARIANT       = YES (the raw, pre-sort array order returned by the
                        API is itself identical between the two independent
                        requests — not just the set after sorting)

CONTEXT_ONLY_DIFFERENCES:
- neighborhoodId / neighborhoodName (self-identity, correctly page-specific:
  65210195/"נוף הטיילת" vs 65210248/"רסקו")
- x / y (page-specific center coordinates)
- otherNeighborhoodStreets (page-specific street list — 17 entries for נוף
  הטיילת vs 26 for רסקו, correctly reflecting each neighborhood's own streets)
- trends (page-specific price-history graphs)
- version field is identical on both ("20-08-2026") — both pages were
  generated from the same underlying data snapshot, strengthening confidence
  this isn't a stale-cache artifact of comparing two different generations
```

No membership difference of any kind was found. Every difference between the
two pages is exactly the kind of page-local, self-referential metadata
Phase 6 asked to distinguish from catalog membership.

## Phase 7 — Optional third check

Not performed. Per instruction: "If first two match exactly: STOP. Two
independent page contexts are enough for this micro-wave." Phase 5 found an
exact match on the strongest comparison (`ID_NAME_PAIR_SET_EQUAL = YES`), so
no third fetch was made.

## Phase 8 — Discovery-source verdict

```
Classification: A — EXACT SAME 38-ENTITY CATALOG ACROSS INDEPENDENT PAGES

OFFICIAL_CATALOG_INVARIANCE = PROVEN, WITH SCOPE QUALIFICATIONS (see ECC below)
```

**Qualification added after ECC review (planner):** "PROVEN" is accurate but
narrower than the unqualified phrase suggests. What is actually proven is:
*the `otherNeighborhoods` catalog is identical across two standard
residential neighborhoods within settlementID 7400 ("נתניה"), at data build
version "20-08-2026."* The 38-entry list includes four non-standard entries
never fetched directly this wave — two industrial zones (ids 65209689,
65210388), one "in planning" zone (65210239, "אגם 3 - בתכנון"), and one CBD
designation (65210243) — so invariance for those specific entity types
remains untested, not disproven. Cross-version behavior (would a future data
rebuild reshuffle the roster?) is also untested and out of this micro-wave's
scope.

**More important logical point, also raised by the planner: invariance is
not the same as completeness.** This test proves the two pages share one
common source list — it does NOT and cannot prove that source list is
exhaustive. If a 39th real polygon existed and were omitted from every
page's roster identically, this exact test would still return a perfect
invariance result and would not detect the gap. This result should be read
as "a single, stable, reusable discovery source now exists and behaves
consistently across independent samples" — not as "this proves there are
exactly and only 38 real Netanya neighborhoods." No claim beyond the former
is made here.

## Phase 9 — Implementation implication

Not implemented, per instruction. Since PROVEN:

The cheapest next architecture step is now evidence-supported: **replace
GovMap/name-seeded neighborhood discovery with nadlan's own official
38-entity catalog as the acquisition discovery source** (fetchable via a
single plain, unauthenticated GET per any known entity id — no browser, no
reCAPTCHA needed for discovery itself, only for the subsequent per-entity
`/deal-data` acquisition which remains browser-driven per prior waves).

Explicit caveats carried forward, unchanged by this wave's narrow scope:

- Each neighborhood query is still capped at 500 rows per response, newest
  first (proven Wave 0G-2, and the sort mechanism itself confirmed in Wave
  0G-5's decoded request contract: `type_order:"dealDate_down"`) — fixing
  discovery alone does not remove this cap.
- Address-level augmentation may still be needed to reach transactions
  outside any given polygon's 500-row recency window (Wave 0G-5's Hypothesis
  A was proven PARTIAL — sufficient for the specific recent-window rows
  tested, not a blanket completeness guarantee).
- Property-type semantics (raw `dealNature` vs. flattened `propertyType`)
  still need preservation if/when any acquisition redesign is implemented —
  unchanged, not addressed this wave.
- A citywide rebuild has NOT been authorized by this or any prior wave in
  this family, and this wave does not request or imply such authorization.
- Added per ECC review: invariance was proven for standard residential
  entities only — a future implementation should not assume the 4 untested
  special-category entries (industrial/in-planning/CBD) behave identically
  without a direct check. Any future code that adopts this catalog as a
  discovery source should assert/test the invariance property explicitly
  rather than silently assuming it, precisely to avoid the silent-failure
  scenario the silent-failure-hunter flagged (a future rewrite trusting
  "whichever id is queried first" with no invariance check would fail
  silently if the assumption ever stopped holding). This proof also does not
  establish that the 38-entry catalog is exhaustive/complete — only that it
  is a single, stable, reusable source, consistent across the two
  independent samples tested.

## ECC review

| ECC_REVIEWER | VERDICT | KEY_FINDING |
|---|---|---|
| planner | PARTIAL — evidence solid but conclusion needed qualifying | Independently re-verified the identical-array claim via 7 spot-checked positions including a distinctive shared ordering anomaly (id 65210752 sitting out of numeric sequence in both files identically — stronger evidence than the hashes alone, since it fingerprints a genuinely shared source rather than coincidence). Confirmed both files share `settlementID:7400`/`settlementName:"נתניה"` — the correct characterization is "all neighborhoods in this settlement," not an abstract "citywide" claim. Flagged 4 untested special-category entries (2 industrial zones, 1 in-planning zone, 1 CBD designation) and the critical logical point that invariance across two samples proves a shared source, not that the source is complete — both incorporated into Phase 8 above. |
| specialist (code-explorer) | CONFIRMED, no corrections needed | Independently re-verified all 38 array positions at 8 spread checkpoints (including first, last, and self-inclusion points) — byte-identical. Confirmed `version:"20-08-2026"` identical on both. Confirmed both lists are genuinely self-inclusive (not one-sided). Confirmed zero production code (scripts/, lib/, components/) currently reads or consumes the `otherNeighborhoods` field — only this wave's and Wave 0G-5's own audit artifacts reference it. |
| silent-failure-hunter | 2 confirmed risks, 2 not-a-risk/insufficient-evidence | (1) Not a risk: no personalization/caching field found in either JSON body proving coincidental rather than genuine invariance — though HTTP response headers (Cache-Control, Vary, Set-Cookie) were not captured, so header-level personalization can't be fully ruled out from body content alone. (2) Insufficient evidence: no count/total/hasMore field exists anywhere to positively rule out a silent cap at some round number, though 38 is not a conspicuous default page size. (3) CONFIRMED RISK: this wave's two fetches used plain unauthenticated curl; nothing proves an authenticated/browser-driven fetch (the kind actually needed for /deal-data acquisition) would see the identical list — geo/bot-detection-based content variation remains untested. (4) CONFIRMED RISK: `scripts/discover-neighborhoods.ts` currently seeds discovery from a hardcoded name list, not this catalog; a future naive rewrite that trusts `otherNeighborhoods` from "whichever id is queried first" with no explicit invariance assertion/test would silently break the moment (if ever) the assumption stops holding, with no error surfaced. |

## Constraints and honesty notes

- No browser, reCAPTCHA-solving session, or anti-bot token was used or
  needed for this wave — both fetches were plain, unauthenticated HTTP GETs
  against public static JSON files, consistent with Wave 0G-5's finding that
  discovery-source fetching (unlike per-entity `/deal-data` acquisition)
  requires no session credential at all.
- No request/session metadata of any kind was captured this wave (no
  cookies, headers, or tokens were involved in a plain GET to a public,
  unauthenticated endpoint), so the security-reviewer's targeted trigger
  condition ("only if any request/session metadata is captured") did not
  apply — no security review was run for this wave, per its own scoping
  instruction to use ECC agents only where useful.
- `data/deals.json` SHA-256 reconfirmed unchanged at the close of this wave,
  identical to Phase 1's baseline.
