# Wave 0G-8 — Direct Official-ID Acquisition Contract Proof

Status: TARGETED ACQUISITION-CONTRACT PROOF. No citywide harvest, no
canonical data changes, no Supabase writes, no importer, no deployment, no
valuation changes. Wave 0G-7's discovery implementation was not reverted or
redesigned.

## Phase 1 — Baseline

```
BASELINE_HEAD  = f9c4553b27b3d36ae24e8cb45f099b372f11ff80
CANONICAL_ROWS   = 12,642
CANONICAL_SHA256  = 18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
```

## Phase 2 — Trace of the current (Wave 0G-7) shadow failure

```
TARGET_SOURCE_ID          = 65210195
NAME_SEARCH_USED            = YES (typed "נוף הטיילת נתניה" into the search box,
                            clicked a "שכונה"-labeled autocomplete suggestion)
SELECTED_ENTITY_ID           = 65210243 (a third, unrequested entity — a CBD
                            designation, not the requested 65210195, and not
                            even the previously-known "wrong" GovMap id 66239231)
FIRST_IDENTITY_LOSS_STAGE     = the autocomplete suggestion-selection step —
                            nadlan's own client resolved the free-text name
                            search to an entity our targeting logic had no
                            control over
```

No fix to the name search itself was attempted, per instruction — it was
replaced entirely (Phase 10).

## Phase 3 — Reconstructing the legitimate direct-ID request path

Discovered by observing a **normal, legitimate browser navigation** (not by
inspecting or decoding any protected payload): after driving a known-good
ADDRESS-level search (typing "עובד בן עמי 41", the same address already
proven reachable in Wave 0G-4/0G-5), the browser's own address bar showed:

```
https://www.nadlan.gov.il/?view=address&id=72721794&page=deals
```

This is a **plain, human-readable query string** — `view`, `id`, `page` — not
an encoded or obfuscated value. Testing the analogous pattern for a
neighborhood entity:

```
https://www.nadlan.gov.il/?view=neighborhood&id={sourceId}&page=deals
```

confirmed live: a **fresh, cold navigation** to this URL — with **zero**
prior search-box interaction, zero autocomplete, zero typed text of any
kind — triggers nadlan's own client to construct and send a correctly
entity-scoped `/deal-data` POST request.

```
REQUEST_URL      = https://api.nadlan.gov.il/deal-data (unchanged from prior
                  waves' finding — the URL that matters for TARGETING is the
                  browser navigation URL above, not the API endpoint itself)
METHOD             = POST
CONTENT_TYPE        = text/plain (unchanged from Wave 0G-5's finding)
SAFE_BODY_FIELDS      = NOT captured this wave, deliberately — see Phase 4.
                    Wave 0G-5 already decoded this envelope once and found
                    base_id/base_name/fetch_number/type_order fields
                    alongside session-bound sk/token/exp credentials; this
                    wave did not need to re-decode it, since the direct URL
                    alone — without touching the request body at all — was
                    sufficient to prove correct targeting via the RESPONSE
                    content (every returned row's own `neighborhoodId` field).

Confirmed live (via response content, not by decoding the request):
base_name = "neighborhoodId" — YES, this is the correct characterization;
             every row returned when navigating to `?view=neighborhood&id=65210195`
             carries `neighborhoodId: 65210195` in its own response payload.
base_id    = "65210195" — YES, confirmed by exact response-content match,
             independently spot-checked by the planner review across 6
             non-contiguous rows plus a cross-link to the known addressId
             72721794 shared with Wave 0G-4/0G-5's evidence.
```

## Phase 4 — Session/token handling

**No session-bound field was reused, printed, fabricated, bypassed, or
committed.** The approach taken was option 1 from the wave's preferred list:
*"observe a normal official page request in the current browser session"* —
specifically, observing the URL the browser's own address bar showed after a
completely normal, legitimate navigation (an address search a real user
could perform), then testing whether the analogous URL pattern, on a **fresh
cold load**, would independently cause the browser's own already-authenticated
session to construct a new, correctly-scoped request. This succeeded — no
request body was ever inspected, decoded, or constructed by hand this wave.
No `sk`/`token`/`exp` value appears anywhere in this wave's artifacts
(confirmed by the security-reviewer, see Phase 15).

No STOP/WAITING_FOR_OPERATOR was needed — this path did not require
bypassing reCAPTCHA or any anti-bot control; it worked through the browser's
own normal navigation and rendering pipeline.

## Phase 5 — Direct-ID test: נוף הטיילת

```
REQUESTED_ID          = 65210195
RESPONSE_ENTITY_ID       = 65210195
ENTITY_MATCH               = YES
ROWS_RETURNED              = 500
EARLIEST_DATE               = 2014-09-23
LATEST_DATE                  = 2026-05-16
DISTINCT_STREETS              = 12
DISTINCT_HOUSE_NUMBERS         = 31
```

**Critical acceptance criterion satisfied**: every one of the 500 returned
rows carries `neighborhoodId: 65210195` in its own response payload —
independently spot-checked by the planner review at 6 non-contiguous
positions across the full item list, confirming this is not a summary-only
claim. See [audit/wave0g8/nof_hatayelet_direct.json](nof_hatayelet_direct.json).

## Phase 6 — Ben Ami 41 acceptance

```
BEN_AMI_41_ROWS = 46 (all rows at this address within the 500-row response)
KNOWN_7_FOUND     = 7/7
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

All 7 additionally share `addressId: 72721794` — the same addressId observed
independently in Wave 0G-4/0G-5's evidence, and in this wave's own
`url_after_address_search.txt` capture — a direct cross-link confirming the
address-scope and neighborhood-scope views agree on the same underlying
asset. **This proves CATALOG ID → DIRECT ACQUISITION works without name
search**, for these 7 specific rows.

## Phase 7 — fetch_number / pagination proof

```
FETCH_1_ROWS       = 500 (נוף הטיילת) / 500 (רסקו) / 230 (industrial zone)
FETCH_2_ROWS        = NOT TRIGGERED — in all three direct-URL tests, scrolling
                   (the only legitimate, non-invented trigger mechanism
                   available) never produced a second `/deal-data` response,
                   even after up to 200 scroll rounds with a 4-round idle
                   threshold.
OVERLAP               = N/A
NEW_ROWS               = N/A
ENTITY_ID_SAME          = N/A

FETCH_NUMBER_SEMANTICS = UNKNOWN
```

Per instruction, this is honestly reported as UNKNOWN rather than invented.
Wave 0G-5's decoded envelope showed `fetch_number: 1` on the one request it
captured; this wave had no legitimate way to observe a `fetch_number: 2`
request without manually constructing a modified request body, which was
deliberately not attempted (see Phase 4).

**Important, planner-flagged completeness caveat**: both residential entities
(נוף הטיילת, רסקו) returned exactly 500 rows in a single response with no
further pagination — the SAME 500-row ceiling already proven at the
neighborhood level in Wave 0G-2, now confirmed to persist even via
direct-ID targeting. The industrial zone's 230 rows are almost certainly its
true, complete count (well under any cap), which is why it did NOT hit the
ceiling. **This wave proves targeting is solved; it does NOT prove or claim
the 500-row completeness problem is solved** — see Architecture Implication
below.

## Phase 8 — Independent direct-ID control: רסקו

```
REQUESTED_ID       = 65210248
RESPONSE_ENTITY_ID   = 65210248
ENTITY_MATCH           = YES
ROWS_RETURNED          = 500
ERROR                    = null
```

This is the single most important generality proof in this wave: רסקו had
**zero** autocomplete suggestions under the old name-search mechanism (Wave
0G-7's own evidence) — it was completely unreachable that way. Via the
direct URL, it works exactly as cleanly as נוף הטיילת: 500/500 exact match.
See [audit/wave0g8/rasko_direct.json](rasko_direct.json).

## Phase 9 — Special entity safety

```
SPECIAL_ENTITY_ID      = 65210388
TYPE/NAME                 = industrial ("אזור תעשיה קריית אל" in the
                        truncated catalog title; confirmed this wave via the
                        response's own `neighborhoodName` field to be the
                        full name "אזור תעשיה קריית אליעזר קפלן" — direct,
                        independent confirmation of the catalog-title
                        truncation theory raised in Waves 0G-5/0G-6)
REQUEST_VALID              = YES
RESPONSE_ENTITY_MATCH        = YES (230/230)
ROWS_RETURNED                 = 230 (not zero — this special-category entity
                        does have real transaction history, uncapped, dating
                        back to 1998-06-09 through 2026-05-17)
ERROR                          = null
```

This is also the entity that had zero autocomplete suggestions under the old
mechanism (Wave 0G-7's own evidence) — same generality proof as רסקו, now
also covering the special-category case explicitly required by this wave.

## Phase 10 — Name search removed from shadow targeting

`scripts/audit-wave0g7-shadow-harvest.ts` was modified in place: its entire
navigation mechanism (fill search box → read suggestions → click a
"שכונה"-labeled suggestion → fall back to Enter) was **deleted** and
replaced with a single call: `buildDirectNeighborhoodUrl(sourceId)` followed
by `page.goto(directUrl, ...)`. `sourceName` is retained only as
display/label metadata on output rows — it is never used to construct a URL,
fill an input, or select anything (independently confirmed by the planner
and specialist reviews). Re-run and re-verified after the change:
`requestValid: true`, 500/500 matching rows, 7/7 known Ben Ami 41 rows found
— identical result to the standalone Wave 0G-8 script.

No canonical writes occurred as part of this change (same guarantees as
before — confirmed unchanged).

## Phase 11 — Identity assertion

Extracted into a new, separate, pure module —
[lib/nadlanAcquisition.ts](../../lib/nadlanAcquisition.ts) — deliberately
kept apart from `lib/nadlanCatalog.ts` (discovery) since this is an
acquisition-time concern, not a discovery-time one. `assertDirectIdAcquisitionIdentity()`
requires **every** returned item's own `neighborhoodId` to equal the
requested `sourceId` — not `.includes()` (which a code-review pass in Wave
0G-7 already proved would let a mixed batch slip through).

All 5 required tests implemented and passing in
[lib/__tests__/nadlanAcquisition.test.ts](../../lib/__tests__/nadlanAcquisition.test.ts):

| Test | Result |
|---|---|
| A — correct requested/returned id | PASS |
| B — wrong id (the exact Wave 0G-7 scenario: all 500 rows = 65210243) | PASS, fails closed |
| C — mixed entity response (5 correct rows buried in 495 wrong ones; also a single-wrong-row-among-499-correct variant) | PASS, fails closed on both |
| D — missing response identity (no `neighborhoodId` field at all; also a genuinely-empty result) | PASS, fails closed on both |
| E — no silent fallback to name search | PASS — both scripts structurally verified to contain zero search-box/autocomplete code |

**One real gap was found and fixed mid-wave**, independently confirmed by
both the code-reviewer and silent-failure-hunter passes: the identity
function originally threw an unhandled exception on `null`/`undefined`
input instead of returning its documented fail-closed shape. Not reachable
from either script's actual call sites today (both always pass real arrays),
but hardened proactively since this is now a shared, reusable module — fixed
to `!Array.isArray(items) || items.length === 0` before this report was
finalized, with a dedicated regression test added.

## Phase 12 — Targeted tests

All 9 implemented, spanning `lib/__tests__/nadlanAcquisition.test.ts` (new)
and two tests updated in `lib/__tests__/nadlanCatalog.test.ts` (to match this
wave's refactor — the mismatch-check logic moved out of the shadow script
into the shared module, and a false-positive in the "no production import"
scan against a legitimate doc-comment was fixed to check real import
statements instead of any substring mention):

| Test | Result |
|---|---|
| A — official sourceId reaches request builder unchanged | PASS — traced parameter → `buildDirectNeighborhoodUrl(sourceId)` → `page.goto()`, no intermediate transform |
| B — no autocomplete function is called in direct-ID mode | PASS — structural check confirms zero `myInput2`/`react-autosuggest`/`.fill(` references in either script |
| C — requested id 65210195 produces the correct neighborhoodId request shape | PASS — exact URL string match |
| D — identity mismatch fails closed | PASS — both a synthetic all-wrong-batch and a replay of the actual Wave 0G-7 failure data |
| E — missing identity does not silently PASS | PASS |
| F — different official id is not collapsed by name | PASS — `buildDirectNeighborhoodUrl` never references or accepts a name at all |
| G — shadow mode cannot write data/deals.json | PASS, both scripts |
| H — shadow mode cannot write Supabase | PASS, both scripts |
| I — Wave 0G-7's catalog parser tests remain green | PASS — all 28 original tests still pass unmodified in substance (2 updated for the refactor, described above) |

## Phase 13 — Canonical immutability

```
data/deals.json SHA256 (before) = 18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
data/deals.json SHA256 (after)   = 18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
MATCH = YES

CANONICAL_WRITES     = 0
SUPABASE_WRITES        = 0
CHECKPOINT_WRITES        = 0
```

## Phase 14 — Quality gates

```
Focused direct-ID tests (lib/__tests__/nadlanAcquisition.test.ts)  = 22/22 PASS
Wave 0G-7 catalog tests (lib/__tests__/nadlanCatalog.test.ts)         = 28/28 PASS (2 updated for this wave's refactor)
Full test suite (npx vitest run)                                        = 233/233 PASS (21 files)
Typecheck (npx tsc --noEmit)                                              = clean, zero errors
Production build (npm run build)                                            = SUCCESS
```

No lint migration introduced, per instruction.

## Phase 15 — ECC final review

| ECC_REVIEWER | VERDICT | KEY_FINDING |
|---|---|---|
| planner | CONFIRMED, with one important caveat | Independently spot-checked 6 non-contiguous rows in the raw 500-item response and confirmed 100% id match; cross-linked the shared `addressId: 72721794` between the address-scope and neighborhood-scope views as the strongest single piece of corroborating evidence. Assessed the "observe a legitimate URL, test the analogous pattern" methodology as sound and NOT a bypass — no reCAPTCHA handling, no token capture, no forged request bodies were involved. **Flagged the completeness caveat now central to this report's Architecture Implication**: both residential entities hit exactly 500 rows with zero further pagination, meaning the direct-ID mechanism solves targeting but not the separately-proven 500-row cap. |
| specialist (code-explorer) | CONFIRMED, all 5 tasks | Independently verified the identity function's strict-equality match logic, the exact URL construction and both scripts' import/call sites, and read the full industrial-zone evidence file directly — discovering its true full name ("אזור תעשיה קריית אליעזר קפלן") via the response's own `neighborhoodName` field, independently confirming the catalog-title-truncation theory from prior waves. Confirmed zero GovMap references and zero remaining sourceId-to-name conversion in either script. |
| silent-failure-hunter | 1 confirmed risk (already fixed before this report), 4 not-a-risk | Independently rediscovered the same null/undefined defensive gap already fixed proactively this session — confirming the fix was necessary, not speculative. All other checked failure modes (search-box fallback on error, silent success on navigation failure, response-shape parsing quirks) were confirmed NOT a risk, with specific line-level reasoning for each. |
| security-reviewer | PASS, all 4 checks | Confirmed both scripts log only method+URL (never headers/cookies) for requests, confirmed zero secret-pattern strings across all 5 new `audit/wave0g8/` artifacts (explicitly re-checked for the "##"-envelope pattern flagged sensitive in Wave 0G-5 — none present, since this wave never captured a request body at all), confirmed `lib/nadlanAcquisition.ts` makes zero network calls, and confirmed no secret env vars are referenced anywhere. |
| code-reviewer | 2 CONCERNS found and fixed before commit, otherwise PASS | Traced all 6 branches of the shadow script's `requestValid`/`error` derivation and confirmed the wiring is sound (navigation errors correctly take priority even over partially-collected data). Found the null/undefined defensive fix was incomplete: `assertDirectIdAcquisitionIdentity()` still assumed every ARRAY ELEMENT was an object, so a malformed row (`null`, a primitive) within an otherwise-valid array would still throw — fixed to guard each element individually, with a new regression test. Also found the mismatch-check regression test only verified the shared helper was CALLED, not that `requestValid` was actually wired to its result — strengthened to assert the exact wiring expression. Noted (non-blocking) that `scripts/audit-wave0g8-direct-id-harvest.ts` lacks the 405-specific detection its 0G-7 sibling has — reduces diagnostic clarity on a reCAPTCHA rejection but does not affect correctness, since `requestValid` still ends up `false` either way; left as-is. |

**Critical reviewer question, answered by the planner and specialist
independently: is there any path left where an official source id is
converted back to a name and re-resolved before acquisition? NO** — confirmed
by both reviews via full-file reads of both scripts; `sourceName` survives
only as inert display metadata attached to already-fetched rows, never as
an input to any targeting decision.

## Phase 16 — Root verdict

```
DIRECT_OFFICIAL_ID_ACQUISITION = PROVEN
```

All stated PASS criteria met: official sourceId 65210195 directly targets
the intended entity (Phase 5, 100% match); no autocomplete/name resolution
used (Phase 2's failure mode fully eliminated, confirmed by 3 independent
reviews); Ben Ami 41 recovered (Phase 6, 7/7); independent Rasko id request
targets Rasko correctly (Phase 8, 100% match, and proves generality since
Rasko was previously completely unreachable by name); identity mismatch
fails closed (Phase 11, TEST B/C/D all pass, including the mixed-batch edge
case a prior wave's code review specifically flagged as a risk); canonical
data unchanged (Phase 13).

## Architecture implication

```
DISCOVERY:   official nadlan catalog (lib/nadlanCatalog.ts, Wave 0G-7, unchanged)
IDENTITY:     official nadlan sourceId (proven stable and unique per entity,
              Waves 0G-6/0G-7/0G-8)
ACQUISITION:  direct entity-id /deal-data request via
              `?view=neighborhood&id={sourceId}&page=deals` navigation
              (Wave 0G-8, this report)
```

This closes the discovery→targeting gap Wave 0G-7 left open.

**Data completeness is explicitly NOT claimed.** The 500-row-per-response
ceiling proven at the neighborhood level in Wave 0G-2 persists unchanged
under direct-ID targeting — both tested residential entities hit exactly
500 rows with zero further pagination triggered by scrolling, and
`FETCH_NUMBER_SEMANTICS` remains UNKNOWN (Phase 7). Solving completeness (if
it is solved at all) is a separate, still-open problem this wave does not
address or claim to address.

## No rebuild performed

Per instruction: no citywide harvest, no canonical replacement, no Supabase
migration, no schema migration, no Production deployment. The Wave 0G-7
discovery module (`lib/nadlanCatalog.ts`) was not reverted or redesigned —
only its companion shadow/audit acquisition script was fixed to use the
newly-proven direct-ID mechanism.

## Constraints and honesty notes

- Two real gaps were found by the code-reviewer pass and fixed before this
  report was finalized (see Phase 15's table): element-level null safety in
  `assertDirectIdAcquisitionIdentity()`, and a regression test that checked
  the shared identity helper was called without confirming `requestValid`
  actually derived from its result. Both are now fixed with dedicated tests;
  the full suite (233 tests), typecheck, and build were all re-run clean
  after these fixes.
- `FETCH_NUMBER_SEMANTICS` is honestly reported as UNKNOWN (Phase 7) —
  scrolling never triggered a second response in any of the 3 direct-URL
  tests conducted, and no modified/forged request was attempted to test
  `fetch_number: 2` directly, per the wave's explicit constraint against
  anything resembling request forgery.
- The URL-pattern discovery methodology (observing a legitimate address-level
  navigation, then testing the analogous neighborhood-level pattern) was
  independently assessed by the planner review as sound and not a bypass —
  documented in Phase 4 with that reasoning included, not asserted
  unilaterally.
- `data/deals.json` SHA-256 verified unchanged throughout this wave.
