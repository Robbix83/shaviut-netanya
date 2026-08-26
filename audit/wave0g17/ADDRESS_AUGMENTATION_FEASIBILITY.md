# Wave 0G-17 — Street/Address-Level Augmentation Feasibility for PARTIAL Entities

## IMPORTANT CORRECTION NOTICE

**This report was substantially rewritten mid-wave after ECC review found the first draft's central conclusion was wrong.** The first draft concluded no street-level acquisition mechanism exists and reported `ADDRESS_LEVEL_AUGMENTATION_CITYWIDE_FEASIBLE=NO`. ECC's specialist reviewer (FAIL verdict) found this was false: a genuine, already-partially-documented (Wave 0G-4/0G-5) street enumeration source exists (`otherNeighborhoodStreets` via the same safe, unauthenticated endpoint `lib/nadlanCatalog.ts` already uses), and this wave's own captured evidence contained an unexamined `streetCode` field that pointed straight at it. This was checked, confirmed, and a genuine direct street-query contract was found and proven live. The corrected findings below supersede the first draft's negative conclusion entirely. The mistake and correction are disclosed here rather than silently overwritten, per this engagement's standing honesty requirements.

**A separate, serious issue was also found and fixed:** ECC's security-reviewer found (FAIL verdict) that an early discovery script captured and wrote a real auth token VALUE to disk, violating this engagement's core "field names/presence only, never values" credential rule. The file was deleted immediately on discovery; the responsible script was fixed to never read request body content at all and to explicitly skip any auth/token-named endpoint. See "Security Incident" section below.

## Baseline

BASELINE_HEAD=f0bddcf (Wave 0G-16 close)

Canonical:
- ROWS=12642 (unchanged, before and after)
- SHA256=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f (unchanged, before and after)

## Security Incident (disclosed, fixed, verified)

`scripts/audit-wave0g17-street-discovery.ts`'s first version registered a `page.on("request", ...)` listener capturing every `nadlan.gov.il` request's URL AND a 200-character body preview, unfiltered by endpoint. This captured a real POST to `https://api.nadlan.gov.il/token-verify` whose body contained an actual token value (`{"token":"[REDACTED]"}` — the value itself is never reproduced anywhere, including in this report), and wrote it to `audit/wave0g17/shadow/street_discovery_network.json`.

**Remediation, in order:**
1. The compromised file was deleted immediately on discovery (before any commit).
2. The script was fixed: it no longer reads `req.postData()` at all — URL and method only — and explicitly skips any URL matching `/token|auth\./i` so an auth-related endpoint is never recorded even by bare presence.
3. `assertSafeShadowOutputPath()` was added to this script's write (previously missing) and audited into the other 3 new scripts that were also missing it (`filter-discovery.ts`, `autocomplete-probe.ts`) — a convention gap ECC's code-reviewer separately flagged.
4. The script was re-run; the regenerated `street_discovery_network.json` was verified to contain only `{url, method}` pairs, confirmed token/auth-free.
5. No committed file, and no other file on disk, contains the leaked value — verified by a repo-wide grep for the token's literal prefix.

This is disclosed here in full rather than omitted, consistent with this engagement's transparency requirements for safety-relevant findings.

## Phase 2 — Wave 0G-16 Partial Scorecard (reused, not re-acquired)

All 11 PARTIAL entities read directly from [`audit/wave0g16/citywide_entity_scorecard.csv`](../wave0g16/citywide_entity_scorecard.csv). Full table with corrected, MEASURED official street counts (see Phase 4): [`audit/wave0g17/partial_entities.csv`](partial_entities.csv).

## Phase 3 — Primary Entity Selection

**PRIMARY_ENTITY=קריית השרון (Kiryat HaSharon), sourceId=65209683.** Unchanged from the original selection — 2nd-largest official total_rows (5,640) and 2nd-largest delta (3,122), not the most extreme case.

PRIMARY_ENTITY_NAME=קריית השרון
PRIMARY_ENTITY_SOURCE_ID=65209683
OFFICIAL_TOTAL_ROWS=5,640
CURRENT_SHADOW_UNIQUE=2,518
CURRENT_DELTA=3,122
CURRENT_COVERAGE=44.65%
**OFFICIAL_STREET_COUNT=70 (MEASURED — corrected from the first draft's "no official source exists" error)**

## Phase 4 — Official Street Enumeration (CORRECTED)

**STREET_ENUMERATION_SOURCE=PROVEN.** `https://data.nadlan.gov.il/api/pages/neighborhood/buy/{sourceId}.json` — the exact same safe, unauthenticated, no-reCAPTCHA endpoint `lib/nadlanCatalog.ts`'s `getOfficialNetanyaEntities()` already uses for entity discovery — returns an `otherNeighborhoodStreets` array: `[{id: <source-native numeric street id>, title: <street name>}, ...]`. This was already partially documented in Wave 0G-4 (a `streetCode` example, `74001078` for `עובד בן-עמי`) and directly visible in Wave 0G-5's already-committed raw evidence (`audit/wave0g5/neigh-page-65210195.json`) — this wave's first draft simply failed to check either.

Live-fetched for the primary entity this wave (plain GET, no browser):

STREET_COUNT=**70** (exact, official)
UNIQUE_STREET_IDS=70 (e.g. `74001205` for `הר שגיא`, `74000847` for `דגניה`, `74001224` for `טבת`)
UNIQUE_STREET_NAMES=70

For each street, the ONLY fields present are `id` and `title` — no coordinates, no other entity identifiers. Not invented beyond what's actually returned.

SOURCE_NATIVE_STREET_ID_AVAILABLE=**YES**

## Phase 5 — Street Direct-Target Contract (CORRECTED)

**DIRECT_STREET_QUERY=PROVEN.** Tested live: navigating to `https://www.nadlan.gov.il/?view=street&id={streetId}&page=deals` (structurally analogous to the already-proven `?view=neighborhood&id={sourceId}` from Wave 0G-8 — not a fabricated request body, a normal browser navigation to a URL pattern) triggers a genuine `/deal-data` POST with:

BASE_NAME=**streetCode**
ID_FIELD=the same `id` values from `otherNeighborhoodStreets`
IDENTITY_FIELD_IN_RESPONSE=**neighborhoodId** (each returned row still carries the parent entity's neighborhoodId — `assertDirectIdAcquisitionIdentity()` validated every response against the requesting entity's sourceId, matched exactly, every time, across all 3 streets tested)

This is a previously-undocumented mechanism in this 17-wave engagement. It reuses the exact same request-envelope shape and decode path (`decodeRequestEnvelope`) already proven safe for `neighborhoodId`-scoped and `addressId`-scoped queries — no new decoding logic, no invented field.

## Phase 6 — Address Enumeration Contract (unchanged from original finding)

ADDRESS_ENUMERATION_SOURCE=**NOT_FOUND** — no endpoint lists individual addresses; the `addressId` mechanism discovered in the original draft (see below) remains lookup-only, requiring a known address typed into the free-text autocomplete. This finding stands: it is now superseded in practical importance by the STREET-level mechanism (Phase 5), which IS enumerable and IS directly queryable — the two are genuinely different mechanisms, and this wave's positive result is about STREETS, not individual addresses.

CAN_ENUMERATE_HOUSE_NUMBERS_WITHOUT_FREE_TEXT_GUESSING=NO (unchanged) — but this no longer matters for closing the coverage gap, since street-level queries return every house number on that street in one request, without needing to enumerate them individually.

## Phase 7 — Primary-Entity Baseline (reused, not refetched)

BASELINE_UNIQUE=2,518
OFFICIAL_TOTAL=5,640
BASELINE_DELTA=3,122

## Phase 8 — Bounded Street Augmentation Sample (CORRECTED — now executed)

3 streets tested via the proven `?view=street&id={streetId}` mechanism, fetch_number=1 only, per Phase 8's original A/B/C selection criteria:

| Street | Street ID | Selection Rationale | Official total_rows (this street) | total_fetch | Rows Returned | Already in Baseline | **New vs. Baseline** | On-Street |
|---|---|---|---|---|---|---|---|---|
| **A: דגניה** | 74000847 | High baseline representation (202 rows already carry this street name in the entity-level corpus; 201 of those matched a key in this street's fetch1 batch) | 501 | 2 | 500 | 201 | **299** | 500/500 (100%) |
| **B: טבת** | 74001224 | Low baseline representation (7 rows already in corpus) | 16 | 1 | 16 | 7 | **9** | 16/16 (100%) |
| **C: הר שגיא** | 74001205 | Ordinary control street (13 rows already in corpus) | 58 | 1 | 58 | 13 | **45** | 58/58 (100%) |

**STREET_SAMPLE_NEW_ROWS=353** (before cross-street dedup; 353 after, since the 3 streets don't overlap with each other — verified via the shared transaction key)

All 3 streets returned **zero contamination** — every single row's `address` field genuinely contained the requested street name, and every row's `neighborhoodId` matched the requesting entity exactly.

**Important unresolved caveat, weighted deliberately, not buried (ECC planner finding):** this wave never attempted `fetch_number=2` on the `streetCode` surface for ANY street — the "no unsupported fetch depth" constraint means street-level pagination beyond fetch1 is simply unproven, not proven-safe-and-skipped. `דגניה` (501 official rows) is the one case in this sample large enough to expose this gap concretely: its own `total_fetch=2` means a genuine second street-level fetch exists and was not attempted, so this wave's reported 299-new-row figure for `דגניה` is a lower bound on what that single street alone could yield, not its ceiling. Any future wave scaling this mechanism must first establish whether `streetCode`-scoped `fetch_number=2` is safe (analogous to how Wave 0G-12/13 separately proved `neighborhoodId`-scoped `fetch_number=2`) before relying on it — this wave does not claim that proof exists.

## Phase 9 — Bounded Address Augmentation Sample (from original draft, still valid)

The one `addressId`-scoped test from the original draft remains valid evidence for the DIFFERENT (lookup-only) address mechanism, not superseded by the street-level finding — kept as-is:

| Field | Value |
|---|---|
| ADDRESS | הר שגיא 3 נתניה |
| ADDRESS_ID | 72714167 |
| ROWS | 1 |
| NEW_VS_BASELINE | 0 (already present) |
| Contamination | 0 |

ADDRESS_SAMPLE_NEW_ROWS=0 (this specific, narrower mechanism; superseded in practical value by Phase 8's street-level result, which recovered the SAME "הר שגיא" street's 45 missing rows via ONE request instead of needing one `addressId` lookup per address)

## Phase 10 — Ben Ami 41 Control (reused prior evidence, no new live request)

Reused [`audit/wave0g3/STREET_LEVEL_ACQUISITION_PROOF.md`](../wave0g3/STREET_LEVEL_ACQUISITION_PROOF.md), unchanged from the original draft. That wave tested the OLDER, free-text/scroll-based street-search path (`harvestByStreets()`), which is a DIFFERENT mechanism than this wave's `streetCode`-based direct query — Wave 0G-3's 47% contamination finding does not apply to the mechanism proven this wave, which showed 0% contamination across all 3 streets tested. The two mechanisms are not interchangeable; this wave's finding does not overturn Wave 0G-3's, it documents a cleaner alternative that didn't exist as a known path before now.

## Phase 11 — Incremental Coverage Value (CORRECTED)

ENTITY_BASELINE_UNIQUE=2,518
NEW_FROM_STREET_SAMPLE=353 (from 3 of 70 official streets — 4.3% of the entity's streets)
NEW_FROM_ADDRESS_SAMPLE=0
UNION_UNIQUE=**2,871**
DELTA_AFTER_SAMPLE=**2,769** (down from 3,122)
COVERAGE_AFTER_SAMPLE=**50.90%** (up from 44.65%)

**AUGMENTATION_INCREMENTAL_VALUE=HIGH**, with evidence: testing just 3 of the entity's 70 official streets (4.3%) recovered 353 new rows and raised coverage by 6.25 percentage points. This is **not linearly extrapolated to "70 streets would close the whole gap"** — the 3 streets tested were deliberately not a random sample (one high-representation, one low, one ordinary control, per Phase 8's own design), and larger/denser streets like `דגניה` already show their own internal fetch-depth ceiling (`total_fetch=2`) that would need separate handling at scale. But the measured, non-extrapolated result is unambiguous: this is a real, substantial, safe source of previously-unreachable rows.

## Phase 12 — Transaction Identity Cross-Surface (CORRECTED, now genuinely 2-way)

Computed across entity-level baseline (2,518 rows) + all 3 street-level samples (574 raw rows: 58+500+16) — 3,092 raw rows total:

RAW_ROWS=3,092
UNIQUE_KEYS=2,871
TRUE_DUPLICATE_CROSS_SURFACE=221 (rows the street-level query re-observed that were already in the entity-level baseline — expected, since street queries necessarily re-return each street's already-captured recent transactions alongside the older ones the entity-level surfaces couldn't reach)
AMBIGUOUS_COLLISIONS=**0**
LEGITIMATE_DISTINCT_COLLISIONS=0

No cross-surface collision ambiguity appeared across the full 3,092-row combined dataset — a substantially larger and more meaningful sample than the original draft's n=1.

## Phase 13 — Source Contamination (CORRECTED)

For all 3 streets combined:

ROWS_MATCHING_REQUESTED_STREET=574/574 (**100%**)
ROWS_OTHER_STREET=0
ROWS_OTHER_ENTITY=0
**SOURCE_CONTAMINATION_RATE=0%**

Direct street-ID targeting's fail-closed identity check held throughout — every one of the 3 street-level exchanges' `neighborhoodId` matched the requesting entity (65209683) exactly, with no filtering needed (contamination was measured as genuinely zero, not filtered-then-hidden).

## Phase 14 — Address Quality Value (CORRECTED)

BASELINE_VALID_ADDRESS_RATE=89.00% (2,241/2,518)
AUGMENTATION_VALID_ADDRESS_RATE=**100.00%** (574/574)

BASELINE_STREET_ZERO_RATE=11.00% (277/2,518)
AUGMENTATION_STREET_ZERO_RATE=**0.00%** (0/574)

**Street-level acquisition structurally cannot return "address=0" placeholder rows** — a transaction with no real recorded address wouldn't be indexed under any specific street to begin with, so it's unreachable by this mechanism by construction, not by luck. This means street-level augmentation improves address quality as a direct side effect of how it works, not merely coverage.

## Phase 15 — PrevDeals Value

RAW_PREVDEALS=**not measured this wave** — the street-fetch script did not extract nested `prevDeals` arrays from the raw street-level items (disclosed as a gap, not fabricated as zero). Given the entity-level and address-level mechanisms both carry `prevDeals` on their raw items (Wave 0G-13/0G-16), it is likely the street-level mechanism does too, but this was not verified.
UNIQUE_PREVDEALS=not measured
NEW_HISTORICAL_EVENTS_VS_EXISTING_SHADOW=not measured

## Phase 16 — Enumeration Scale Estimate (CORRECTED — now MEASURED, not estimated)

**MEASURED** (11 plain, safe, unauthenticated GET requests, no browser — same endpoint already proven safe by `lib/nadlanCatalog.ts`), via the committed, reusable [`scripts/audit-wave0g17-street-counts.ts`](../../scripts/audit-wave0g17-street-counts.ts) (independently re-run and reproduced the identical 444 total, not just a one-off inline computation — an ECC silent-failure-hunter finding on the first version of this number):

| Entity | Official Street Count |
|---|---|
| מרכז העיר | 69 |
| קריית השרון | 70 |
| קריית נורדאו | 41 |
| מע"ר - מרכז עירוני ר | 72 |
| אבו שדיד | 26 |
| עיר ימים | 22 |
| חוף הים והמלונות | 19 |
| מכנס | 23 |
| רמת אפרים | 46 |
| רסקו | 26 |
| אזור תעשיה פנחס ספי | 30 |
| **TOTAL** | **444** |

TOTAL_OFFICIAL_STREETS_ACROSS_11_PARTIAL_ENTITIES=**444** (exact, measured — corrects the first draft's "324, lower-bound-only" figure)

ESTIMATED_REQUEST_VOLUME: 444 street-level queries (fetch_number=1 each) to cover every street once, PLUS an unknown number of fetch_number=2 requests for the subset of streets whose own total_rows exceeds 500 (only 1 of the 3 streets tested — `דגניה` — needed this; if that rate holds, roughly 1/3 of large streets might need a second fetch, though this is not measured at scale, and street-level fetch_number=2 is itself unproven — see Phase 8's caveat above).

**Open reliability gap, disclosed not resolved (ECC silent-failure-hunter finding):** `scripts/audit-wave0g17-street-fetch.ts` cannot always distinguish a genuinely empty street (0 official transactions) from a transient acquisition failure. When a `/deal-data` response DOES arrive with 0 items, the script now correctly labels this `ZERO_TRANSACTIONS_ON_STREET` (a fix applied this wave, distinct from a real error). But when NO response arrives at all — which this wave's own Wave 0G-16 experience shows does happen transiently, independent of whether the target genuinely has data — the script cannot tell the two cases apart, and reports a generic failure either way. None of the 3 streets tested this wave happened to be genuinely empty, so this gap was not exercised in practice, but any future run scaling this mechanism across all 444 streets should retry every failure at least once (mirroring Wave 0G-16's own citywide runner) before treating a "failed" street as either outcome.

CITYWIDE_AUGMENTATION_SCALE=**MODERATE** (revised from the original draft's "HIGH_COST_LOW_YIELD"). **Correction (ECC planner finding):** the 444 street-level requests would be ADDITIVE to, not a replacement for, Wave 0G-16's existing 146 entity-level requests — true combined cost is closer to 146 + 444 ≈ 590 requests, roughly 4x Option A alone, plus an unmeasured additional tail for any street whose own total_rows exceeds 500 (1 of the 3 streets tested — `דגניה` — needed this; the true fraction citywide is unmeasured). MODERATE remains the right rating (590 requests is not a small number, but it recovers substantial real data per request, unlike the first draft's near-zero-yield assumption) — the number itself, not just the order-of-magnitude comparison, is what justifies it.

## Phase 17 — Architecture Options (CORRECTED)

| Option | Coverage Potential | Enumeration Proof | Request Cost | Dedup Complexity | Contamination Risk | Current Evidence |
|---|---|---|---|---|---|---|
| A: entity-level only | Bounded — 78.05% citywide ceiling (Wave 0G-16) | N/A (proven) | Low (146 req. citywide) | Low | None | Extensively proven, 38/38 |
| **B: entity + street** | **High for the ONE entity tested (44.65%→50.90% from just 4.3% of its streets); citywide potential unmeasured beyond this** | **PROVEN this wave** (`otherNeighborhoodStreets` + `?view=street&id=`) | Moderate-to-high (~590 req. citywide = 146 existing + 444 new, plus an unmeasured fetch-2 tail) | Low (same key works across surfaces, 0 ambiguous collisions on 3,092 rows) | **Zero measured** (0/574 rows contaminated) | **3/3 streets tested, all strongly positive** |
| C: entity + address | Proven near-zero (lookup-only, requires already-known addresses) | Query proven, enumeration NOT proven | Very high per unit of new data | Low | Zero (1 test) | 1/1 tested, 0 new rows |
| D: entity + street + address hybrid | Inherits B's strength; address adds little beyond it | Street: proven; address: not enumerable | Street cost + marginal address cost | Low | Zero | Street dominates; address adds no proven marginal value |

**BEST_NEXT_ARCHITECTURE=OPTION B (entity + street)**, a genuine reversal from this wave's own first-draft conclusion (Option A only) and from Wave 0G-16's standing recommendation. `addressId` (Option C) is retained as a reserve, narrow, per-lead verification tool — useful for confirming/denying one specific known address's transaction history — explicitly out of scope for bulk augmentation, where it adds no value that Option B doesn't already dominate.

## Phase 18 — Critical Decision (CORRECTED)

**CAN_PARTIAL_ENTITIES_PLAUSIBLY_BE_COMPLETED_WITHOUT_FETCH3=YES (plausibly)** — reversed from the first draft's NO. Based on this wave's evidence: a genuine, safe, zero-contamination, previously-undocumented mechanism recovered 353 new rows (a 6.25-point coverage gain) from testing only 3 of one entity's 70 streets. This is not proof that ALL 11 PARTIAL entities can reach 100% this way — `דגניה`'s own internal 501-row/2-fetch structure shows some streets have their own depth ceiling, and only 1 of 11 entities was tested at all — but it is strong, direct, measured evidence that meaningful further progress is possible without fetch_number≥3, reversing the "structural, cannot possibly be completed" framing this wave's own instructions opened with.

**ADDRESS_LEVEL_AUGMENTATION_CITYWIDE_FEASIBLE=PARTIAL** — this question, read literally (address-level, i.e. the `addressId` lookup mechanism specifically), remains NO: it is not enumerable and adds no proven value. But **STREET_LEVEL_AUGMENTATION_CITYWIDE_FEASIBLE=YES (with real, positive, measured evidence, not overclaimed)** — a materially different and more powerful mechanism than what the wave's own title anticipated, discovered mid-wave. This is reported as PARTIAL for the literal question asked, with the more important and different finding (street-level) called out explicitly rather than either conflated with it or omitted.

## Phase 19 — Canonical Comparison Question

CANONICAL_MATCH_SENSITIVITY_AUDIT_DEFERRED=YES

Reason: unchanged — acquisition completeness took priority, and this wave found a major new acquisition-completeness lead (street-level querying) that is more directly relevant to close out first, in a future wave.

## Phase 20 — Tests

No new reusable production logic was added — the 6 new scripts (`street-discovery.ts`, `filter-discovery.ts`, `autocomplete-probe.ts`, `address-contamination-probe.ts`, `street-url-probe.ts`, `street-fetch.ts`) are bounded diagnostic/discovery tools reusing existing tested primitives (`buildDirectNeighborhoodUrl`, `assertDirectIdAcquisitionIdentity`, `decodeRequestEnvelope`, `decodeDealData`, `toShadowDeal`, `dedupByTransactionKey`, `transactionKey`, `parsePaginationContract`, `assertSafeShadowOutputPath`). Given this wave's positive finding (a genuine new production-viable mechanism), a FUTURE wave building a reusable street-level runner (analogous to Wave 0G-16's citywide entity runner) should add focused tests at that point — premature to add now for what remains a bounded feasibility proof, not a production runner.

Full suite: **308/308 pass** (unchanged — confirms no regression).
Typecheck: clean.
Build: succeeded.

## Phase 21 — Canonical Safety

ROWS BEFORE=12,642, ROWS AFTER=12,642
SHA BEFORE=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
SHA AFTER=same (unchanged)
SUPABASE_WRITES=0, IMPORTER_RUNS=0, DEPLOYMENTS=0

## Phase 22 — ECC Final Review

**Round 1** (against the first, wrong draft): planner CONCERNS, specialist **FAIL** (missed `otherNeighborhoodStreets`), database-reviewer PASS, silent-failure-hunter CONCERNS, security-reviewer **FAIL** (token leak), code-reviewer CONCERNS.

**Round 2** (against this corrected draft, after finding and proving the street-level mechanism and purging/fixing the leak): planner PASS-with-concerns, specialist PASS, security-reviewer **FAIL again** (the redacted-in-code token value had been re-quoted verbatim in the report's own prose "Security Incident" section — fixed immediately, redacted, re-verified with a repo-wide grep), database-reviewer PASS, silent-failure-hunter CONCERNS, code-reviewer CONCERNS.

| # | Round | Reviewer | Finding | Fix applied |
|---|---|---|---|---|
| 1 | 1 | specialist | `otherNeighborhoodStreets` (already documented in Wave 0G-4/0G-5) was never checked; a `streetCode` field in this wave's own captured evidence went unexamined | Fetched it live, found 70 real streets with source-native IDs for the primary entity; tested and proved a genuine `?view=street&id=` direct query contract; substantially rewrote Phase 4-18 |
| 2 | 1 | security-reviewer | A script captured and wrote a real auth token VALUE to a committed-directory file | File deleted immediately; script fixed to never read request bodies and to skip auth/token URLs by pattern; guard added to all 4 original scripts |
| 3 | 2 | security-reviewer | The redacted token's prefix had been re-quoted verbatim in the report's own "Security Incident" prose section | Redacted to `[REDACTED]`; re-verified via repo-wide grep, zero occurrences remain |
| 4 | 1+2 | code-reviewer | `assertSafeShadowOutputPath()` missing from 3 of 4 original scripts; 2 dead/unlogged variables; a `.find()` silently dropping a hypothetical second match | All fixed and re-verified in round 2 |
| 5 | 2 | code-reviewer | A legitimate 0-transaction street and a real acquisition error were classified identically | `street-fetch.ts` now distinguishes `ZERO_TRANSACTIONS_ON_STREET` from real errors when a response does arrive; the remaining ambiguity (no response at all) is now explicitly disclosed, not silently possible |
| 6 | 2 | silent-failure-hunter | The 444-street citywide figure was computed via an ad-hoc inline script, not reproducible from anything committed | Wrote and committed `scripts/audit-wave0g17-street-counts.ts`; independently re-run, reproduced the identical 444 total |
| 7 | 2 | planner | Phase 17's Option B "Coverage Potential" cell and Phase 16's request-cost comparison understated scope/cost (implied citywide-proven, implied cost "comparable" to Option A rather than additive) | Both reworded to explicitly scope to "the one entity tested" and to state the true additive cost (~590 requests, not "comparable") |
| 8 | 2 | planner | Phase 8's דגניה caveat ("1 row not captured") understated the real gap — street-level `fetch_number=2` was never attempted at all, and the "202 vs 201" selection-rationale number wasn't backed by the measured artifact | Both fixed: caveat rewritten to state fetch_number=2 is fully unproven at street level (not just "1 row missing"); rationale text corrected to the measured 201 figure |

All fixes were re-verified live (re-running the affected scripts, confirming identical/corrected output) before this report was finalized. Full suite (308/308), typecheck, and build re-verified clean after every round of fixes.
