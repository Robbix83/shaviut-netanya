# Wave 0G-21 — Final Mixed-Street CLASS-A Verification

**Scope:** bounded live fetch1 re-probe for the 2 remaining unverified mixed
streets in Kiryat Hasharon (sourceId=65209683) — הפארק (74000826) and הרב
נרייה (74001235) — closing the disclosed residual Wave 0G-20 left open (62
raw CLASS A rows, no row-level data). No architecture change. No new
identity semantics.

Baseline commit: `45fca41f643efff1893fe73251900ba062eec4ca` (Wave 0G-20,
CLOSED PASS).

## Result summary

| Street | ID | Raw | Parent (CLASS A) | Zero | Foreign | Duplicates vs 5109 union | Genuinely new |
|---|---|---|---|---|---|---|---|
| הפארק | 74000826 | 217 | 46 | 0 | 171 | 20 | 26 |
| הרב נרייה | 74001235 | 17 | 16 | 1 | 0 | 6 | 10 |
| **Total** | | **234** | **62** | **1** | **171** | **26** | **36** |

Both live reproductions exactly match Wave 0G-19/0G-20's earlier
reconstructed counts (46/0/171 for הפארק, 16/1/0 for הרב נרייה) — the
mixed-batch phenomenon reproduces identically on a fresh live fetch, and
this wave's numbers are not a new independent claim but a confirmation of
the prior estimate.

## Class-A closure

All 7 of the entity's mixed streets are now verified with real row-level
data (previously 3 of 7 verified in Wave 0G-20; this wave closes the
remaining 4 — 2 of which recover 0 rows: אריאל שרון and האר"י, already
confirmed `FAILED_NO_TRUSTED_ROWS` since Wave 0G-20 with 0 raw parent rows).

- Previously unverified raw CLASS A: 62 (46 הפארק + 16 הרב נרייה)
- Live-reproduced parent rows: 62 (exact match)
- Genuinely new after dedup: 36
- Duplicates vs the existing 5109-row union: 26
- הפארק-vs-הרב נרייה street-vs-street overlap: 0 (the two streets share no
  transactions with each other)
- Ambiguous collisions: 0

## Coverage

| | |
|---|---|
| Old accepted unique | 5,109 |
| Newly recovered | 36 |
| New accepted unique | 5,145 |
| Official total | 5,640 |
| Delta | 495 |
| Coverage | 91.22% (up from 90.59%) |

## Policy

No identity semantics changed this wave. Explicit-parent-id rows are the
only accepted class:

- Explicit parent accepted: 62
- Zero-id accepted: 0 (unconditionally rejected, same as every prior wave)
- Foreign non-zero accepted: 0 (unconditionally rejected, same as every
  prior wave)
- `PER_ROW_IDENTITY_POLICY_UNCHANGED=YES`

Wave 0G-19's zero-id question remains explicitly unresolved and untouched.

## Residual gap (post-recovery)

Remaining delta: 495 rows. Known, disclosed, non-exhaustive contributing
categories (not forced to sum exactly, per this wave's own instruction —
some rows may fall into more than one category or into none of these):

- **Street fetch2 opportunity** — unexecuted this wave. Prior pagination
  evidence (`audit/wave0g18/street_pagination_summary.csv`) shows:
  - אברהם שפיגלמן (74000875): `TOTAL_ROWS=533`, `FETCH1_ROWS=500` → up to
    33 rows behind fetch1's cutoff.
  - דגניה (74000847): `TOTAL_ROWS=501`, `FETCH1_ROWS=500` → up to 1 row
    behind fetch1's cutoff.
  - **Best fetch2 proof candidate: אברהם שפיגלמן** — 33 potential
    additional rows vs דגניה's 1, by a wide margin. This matches the
    wave's own "~34" prior estimate (33 + 1) almost exactly. Not executed
    — evidence only, per the hard boundary.
- **Zero-id rows** — 21 raw rows citywide-known-so-far in this entity, of
  which 1 (הרב נרייה) was reconfirmed live this wave. Policy remains
  CLOSED/unresolved; none accepted.
- **Foreign non-zero rows** — large (760+ previously known, of which 171
  from הפארק were reconfirmed live this wave, consistent with — not
  additional to — the prior total). Policy unconditionally rejects these;
  not investigated further.
- Remaining source-surface limitations (transactions with no identifiable
  street exposure at all, entity-catalog gaps, etc.) — not quantified this
  wave.

`IS_STREET_FETCH2_NOW_HIGHEST_VALUE_NEXT_STEP=PARTIAL` — with all 7 mixed
streets' CLASS A rows now fully closed and both the zero-id and foreign-id
levers explicitly policy-frozen, אברהם שפיגלמן's fetch2 is the best
currently-evidenced, currently-unblocked next lever — but its yield is an
upper-bound estimate (33 raw rows before dedup, not yet fetched or
deduped), so it is reported as PARTIAL rather than a confirmed highest-value
claim.

## Canonical safety

- `data/deals.json` rows: 12,642 (unchanged)
- SHA-256: `18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f`
  (unchanged, verified before and after this wave)
- Supabase writes: 0
- Importer runs: 0
- Deployments: 0

## Security

Scanned all new tracked artifacts (`final_verification_summary.json`,
`two_street_recovery.csv`) and this report for tokens, cookies,
Authorization headers, session material, anti-bot values, and credential
fragments: none found. The raw shadow dumps
(`audit/wave0g21/shadow/street_fetch_*.json`, uncommitted) record only
credential field NAMES (`sk`, `token`, `exp` presence flags via
`credentialFieldsPresent`), never values — consistent with every prior
wave.

## Tests

- Full suite: 387/387 passed (unchanged — no reusable lib code was added
  or modified this wave, so no new tests were required per this wave's own
  Phase 13 instruction)
- Typecheck: clean
- Build: clean (Next.js 16.2.6 / Turbopack)

## ECC review

Five reviewers, per this wave's assignment (planner skipped — optional for
a narrow verification wave):

| Reviewer | Verdict | Finding |
|---|---|---|
| specialist | PASS | Live identity results independently re-derived from raw JSON and confirmed exact; envelope base_id/base_name/fetch_number verified correct with no misattribution risk; `lib/streetRowAcceptance.ts` confirmed unchanged (zero diff vs. Wave 0G-20's commit). |
| database-reviewer | PASS | 5109-union reconstruction verified sound (structural replay of Wave 0G-20's own ECC-fixed pattern, with hard `4831`/`5109` throws); `classifyTransactionGroups` reused, not reimplemented; `AMBIGUOUS_COLLISIONS=0` gate confirmed not bypassable. Raised a question about the `parkVsNeriaOverlap===0`-gated per-street reconciliation, later resolved by code-reviewer (see below) as mathematically correct, not a gap. |
| security-reviewer | PASS | No credential values (only field-NAME presence flags) in any file, committed or uncommitted; no path-traversal or injection risk in the (hardcoded, non-attacker-controlled) file-path construction. |
| silent-failure-hunter | **CONCERN → FIXED** | `toShadowDeal()` can return `null` for an accepted-parent row (e.g. missing/non-finite `dealAmount`), and this was previously dropped with no counter and no error — a coincidental, not enforced, 62=62 reconciliation. **Fixed**: added an explicit `SHADOW_CONVERSION_DROP` throw comparing `acceptedItems.length` to the post-`toShadowDeal` `streetRows.length` per street. Verified offline against this run's own saved raw data (no new live fetch): both streets converted 100% of their accepted rows (46/46, 16/16) — the fix does not change this wave's reported numbers. |
| code-reviewer | APPROVE | Retry loop correctly bounded and leak-free (fresh context per attempt, closed in `finally`); fail-hard-on-wrong-`fetch_number` outside the retry loop is intentional, matching Wave 0G-20's pattern; traced `classifyTransactionGroups`'s `trueDuplicateStreetVsStreet` logic and confirmed the `parkVsNeriaOverlap===0` gate on the per-street reconciliation is mathematically correct (a real overlap would legitimately double-count in the independent per-street pass) — not a silent-skip bug, resolving database-reviewer's question. |

Re-ran typecheck (clean), full test suite (387/387, unchanged), and build
(clean) after applying the silent-failure-hunter fix.

## Live requests

Exactly 2 live street requests performed (הפארק, הרב נרייה), both
fetch_number=1. No fetch2. No other streets. (Two capture attempts on
הפארק returned no matching network exchange before a third attempt
succeeded — a known transient flakiness in the live browser capture
pattern also seen in earlier waves' runners, not a policy or code issue;
retries targeted the same street only, never a different one.)

## Architecture

No code or architecture change was required this wave — this was a
verification-only wave reusing Wave 0G-20's committed `classifyRowForAcceptance`
/ `classifyBatchForAcceptance` (`lib/streetRowAcceptance.ts`, unchanged)
and Wave 0G-18's `classifyTransactionGroups`
(`scripts/audit-wave0g18-aggregate.ts`, unchanged) exactly as-is.
