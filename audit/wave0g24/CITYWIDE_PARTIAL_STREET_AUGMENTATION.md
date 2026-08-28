# Wave 0G-24 — Citywide PARTIAL-Entity Street Augmentation (Scale-Out)

**Status: architecture built and ECC-reviewed; live acquisition
WAITING_FOR_OPERATOR / SOURCE_BLOCKED.** Phases 1–4 (baseline, target-entity
loading, official street discovery, and the multi-entity runner
architecture) completed this session. Phase 5 onward (actually fetching
street data) could not proceed: the live nadlan.gov.il site is currently
not completing its reCAPTCHA challenge for any street request — verified
directly via a diagnostic probe (stalls at the "anchor" stage, never
reaching "token-verify"/"deal-data") and via a 3-street sanity test of the
new runner, which correctly and honestly produced `FAILED_NETWORK` for all
3 attempts rather than fabricating data. This is the identical pattern
already documented in Wave 0G-22's first attempt, which later cleared on
its own for a subsequent controlled retry (0G-22B). Per the project's
standing rule against reCAPTCHA bypass, no workaround was attempted and no
further live requests were made this session.

**No fabricated citywide coverage numbers appear anywhere in this report.**
Only the numbers actually computed from committed evidence are reported
below.

## Phase 1 — Baseline

- HEAD before this wave: `85abff8` (Wave 0G-23, CLOSED PASS)
- Canonical: 12,642 rows, SHA-256
  `18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f` —
  verified unchanged throughout this wave.

## Phase 2 — 10 target entities (loaded from committed Wave 0G-16 data)

All 11 Wave 0G-16 PARTIAL entities except קריית השרון (already fully
investigated through Waves 0G-17–0G-23 and explicitly excluded per this
wave's hard boundary):

| Entity | sourceId | Official total | Entity baseline | Delta | Coverage |
|---|---|---|---|---|---|
| אזור תעשיה פנחס ספי | 65209689 | 1,021 | 1,000 | 21 | 97.94% |
| עיר ימים | 65209703 | 3,060 | 2,325 | 735 | 75.98% |
| קריית נורדאו | 65209705 | 3,281 | 2,265 | 1,016 | 69.03% |
| מרכז העיר | 65209717 | 9,972 | 3,282 | 6,690 | 32.91% |
| חוף הים והמלונות | 65209727 | 2,612 | 2,343 | 269 | 89.70% |
| רמת אפרים | 65209736 | 2,266 | 2,082 | 184 | 91.88% |
| מע"ר - מרכז עירוני ר | 65210243 | 3,273 | 2,329 | 944 | 71.16% |
| אבו שדיד | 65210245 | 3,082 | 2,292 | 790 | 74.37% |
| רסקו | 65210248 | 2,012 | 2,010 | 2 | 99.90% |
| מכנס | 65210752 | 2,375 | 2,165 | 210 | 91.16% |

```
TOTAL_TARGET_OFFICIAL_ROWS  = 32,954
TOTAL_TARGET_ENTITY_BASELINE = 22,093
TOTAL_TARGET_DELTA           = 10,861
```

## Phase 3 — Street manifests (completed live, safe endpoint)

Enumerated via the proven, safe, unauthenticated
`getOfficialEntityStreets()` call (`lib/nadlanCatalog.ts`) — the same
mechanism Wave 0G-18 used for Kiryat's own manifest. No reCAPTCHA, no
browser session, discovery only.

| Entity | Official street count |
|---|---|
| אזור תעשיה פנחס ספי | 30 |
| עיר ימים | 22 |
| קריית נורדאו | 41 |
| מרכז העיר | 69 |
| חוף הים והמלונות | 19 |
| רמת אפרים | 46 |
| מע"ר - מרכז עירוני ר | 72 |
| אבו שדיד | 26 |
| רסקו | 26 |
| מכנס | 23 |

```
TOTAL_STREETS_ENUMERATED    = 374
DISTINCT_STREET_IDS         = 338  (36 streetIds shared across 2+ target
                                    entities — boundary streets)
```

This matches Wave 0G-17's own historical arithmetic exactly: 444 official
streets across all 11 PARTIAL entities, minus Kiryat's 70, predicts 374 —
independently re-measured live this wave and confirmed digit-for-digit
against Wave 0G-17's per-entity counts (72, 69, 26, etc.), an 8-wave-old
snapshot. This is a genuine cross-validation signal that the official
catalog has not changed for these entities.

## Phase 4 — Runner architecture (built, reviewed, sanity-tested only)

`scripts/audit-wave0g24-multi-entity-street-runner.ts` generalizes Wave
0G-18's proven single-entity runner to multiple entities. It does **not**
reimplement the core identity/accounting logic — it imports and reuses
`classifyStreetExchange` from `scripts/audit-wave0g18-street-runner.ts`
**unchanged**, which already enforces:

- `fetch_number=1` only (any other value → `FAILED_OTHER`)
- Per-row identity acceptance (`ACCEPT_PARENT` / `REJECT_ZERO` /
  `REJECT_FOREIGN` / `REJECT_MISSING` / `REJECT_MALFORMED`, from the
  unchanged `lib/streetRowAcceptance.ts`)
- The `RAW_ROWS == PARENT + ZERO + FOREIGN + OTHER` accounting invariant
  (hard `throw` on violation)
- Explicit mixed-batch statuses (`SUCCESS_MIXED_PARTIAL`,
  `FAILED_NO_TRUSTED_ROWS`) — no whole-batch discard of trusted rows

New orchestration (necessarily new, since the original is hardcoded to
one entity) mirrors the original's exact constants and resumability
pattern, and adds one optimization: **each of the 338 distinct streetIds
is fetched live at most once**, then the same raw batch is classified
against every target entity that lists it (with that entity's own
sourceId) — never re-fetching a streetId already captured for a sibling
entity. This is safe by construction:
`classifyRowForAcceptance`/`classifyStreetExchange` are pure functions of
`(row, parentSourceId)`; a row that is `ACCEPT_PARENT` for Entity A is
correctly `REJECT_FOREIGN` for Entity B on the identical raw data (ECC
database-reviewer independently traced and confirmed this).

**Validated only via a 3-street sanity test** (streetIds
74001044/74000963/74001028, all within אזור תעשיה פנחס ספי), which
correctly produced `FAILED_NETWORK` for all 3 given the current site
block — proving
the failure path works honestly (no fabricated data, resumable-status
design intact) but **not** proving the success path against real data,
since no real acquisition has occurred yet this wave.

## ECC review (all 6 reviewers)

| Reviewer | Verdict | Key finding |
|---|---|---|
| planner | CONFIRMED all 5 critical questions (Kiryat excluded, 27 COMPLETE excluded, fetch2/fetch3 avoided, streetId-dedup correct, stopping at the block was not premature) | 1 low-severity naming concern: scripts used "אזור תעשיה פנחס ספיר" while the Wave 0G-16 catalog's canonical name is "אזור תעשיה פנחס ספי" — classification unaffected (matching is by sourceId), but the name flows into persisted data. **Fixed**: corrected in both scripts, discovery artifacts regenerated. |
| specialist | CONFIRMED (same naming finding as planner) | Independently verified all 10 entities' street counts against the actual manifest files (not just the summary), confirmed the 374 total, and found the per-entity counts match Wave 0G-17's 8-wave-old snapshot digit-for-digit — a genuine, meaningful cross-validation. No contradictions with any prior wave. |
| database-reviewer | PASS | Traced the streetId-dedup design in full: confirmed `classifyRowForAcceptance` is pure and stateless, so re-classifying the same raw batch per entity is safe; confirmed the resume logic never overwrites one entity's cached result while filling in a sibling's missing one; confirmed distinct result-file paths per (entity, street); confirmed the accounting invariant is still enforced unconditionally. |
| silent-failure-hunter | PASS, 1 minor fix applied | All entities in a street's reference list get either a cache hit or a fresh result — none silently skipped. **Minor gap found and fixed**: the run manifest didn't record already-cached entities' statuses in a mixed cached/uncached scenario for the same streetId — cosmetic (result files were always correct), now fixed so the manifest accurately reflects progress. |
| security-reviewer | PASS | No credential values anywhere (only field-NAME presence flags); no reCAPTCHA-bypass logic in the retry loop (an ordinary bounded reload/retry); confirmed disk state matches expectation exactly (3 `FAILED_NETWORK` result files, no partial/corrupted real data). |
| code-reviewer | APPROVE, 1 MEDIUM fix applied | Confirmed `classifyStreetExchange` reused verbatim with matching call signature; confirmed `parentSourceId` is correctly set to each target entity's own sourceId (never Kiryat's or shared incorrectly). **Found and fixed**: the new runner's "no response at all" detection inspected decoded response *content* rather than whether any response object was ever formed, unlike the original — a rare edge case (a response arrives but fails to decode) would have been misreported as `FAILED_NETWORK` instead of the more accurate `FAILED_OTHER: UNDECODABLE_ENVELOPE`. Fixed with an explicit `hadAnyResponse` flag restoring the original's exact semantics. |

All findings were either confirmed as correct-as-designed or fixed. No
finding invalidates the architecture's design — only implementation
hardening, now applied and re-verified (typecheck clean, 387/387 tests,
build clean).

## Canonical safety

- `data/deals.json` rows: 12,642 (unchanged)
- SHA-256: `18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f`
  (unchanged, verified before and after)
- Supabase writes: 0
- Importer runs: 0
- Deployments: 0

## Security

Scanned all new tracked artifacts (2 scripts, this report, the 10
street-manifest JSON files, the enumeration summary, and the combined
CSV) for tokens, cookies, Authorization headers, session material,
anti-bot values, and credential fragments: none found. The 3
`FAILED_NETWORK` shadow result files (uncommitted, per the project's
standing rule) contain zero acquired row data — `rows: []`,
`rowsReturned: 0`, `networkRequests: 0` in every case, consistent with no
`/deal-data` response ever having been captured.

## Tests

- Full suite: 387/387 passed (one transient flake on an unrelated,
  unmodified test observed on a single run, not reproducible on
  immediate re-run — not caused by this wave's changes)
- Typecheck: clean
- Build: clean (Next.js 16.2.6 / Turbopack)

## Live requests

- 10 safe, unauthenticated catalog requests (street discovery, Phase 3) —
  completed successfully, no reCAPTCHA involved.
- 3 street-level `fetch_number=1` acquisition attempts (sanity test) — all
  3 failed with `FAILED_NETWORK` due to the site-wide block. Zero
  `fetch_number>=2` requests made or attempted. Zero of the remaining 335
  distinct streetIds were attempted, per the standing rule against
  retrying through a reCAPTCHA block.

## Residual / next step

The architecture is proven-by-design (reuses the exact, already-validated
Kiryat identity/accounting logic) and ECC-reviewed with all findings
fixed. It is ready to run to completion — an estimated 45–90+ minutes at
the required concurrency=1 pacing across 338 distinct streets — as soon as
the site's current block clears. No citywide coverage result exists yet
for the 10 target entities; claiming one this wave would be fabrication.
