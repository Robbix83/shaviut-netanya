# Wave 0G-20 — Per-Row Identity Acceptance for Mixed Street Batches

**VERDICT: PASS.** Wave 0G-18's whole-batch identity rejection (one bad row discards the entire street) is replaced with per-row acceptance: only explicit parent-id rows are ever accepted; zero-id and foreign-id rows stay rejected exactly as before — no policy broadening. A retrospective replay, using real row-level data for 3 of 7 previously-rejected mixed streets (91% of the affected rows), recovers 278 genuinely new transactions, raising coverage from 85.66% to 90.59%. Zero ambiguous collisions. Canonical unchanged.

## 1. Reconstructing the 7 mixed batches (Phase 2)

Reconstructed exactly from Wave 0G-18's already-captured evidence (no refetch):

| | Count |
|---|---|
| Mixed batches | **7** |
| Raw rows | **1,467** |
| CLASS A — explicit parent match | **686** |
| CLASS B — `neighborhoodId=0` | **21** |
| CLASS C — foreign non-zero id | **760** |
| CLASS D — other | **0** |

Matches the expected evidence from Wave 0G-19 exactly. Per-street breakdown: [`identity_class_summary.json`](identity_class_summary.json).

## 2. The actual (not assumed) CLASS A recovery value (Phase 3)

Wave 0G-18's runner never persisted row-level raw data for a rejected street — only aggregate counts. Real row-level data exists for only **3 of 7** mixed streets: בני רייך and טום לנטוס (Wave 0G-19's own probes, reused) plus **הרב שמואל הרטום** — this wave's own bounded Phase 18 live control fetch (moved earlier out of necessity, same pattern Wave 0G-19 used; disclosed here, not silently reordered). Together these 3 streets account for **624 of the 686 total CLASS A rows (91%)**.

The other 4 streets' 62 raw CLASS A rows have **no row-level data available** without a further live fetch, which this wave's one-fetch budget does not cover — reported as a disclosed, unverified residual, never assumed recovered and never silently dropped.

**Dedup, NOT assumed 100% new:**

| | Count |
|---|---|
| Raw CLASS A rows (verified, 3 streets) | 624 |
| Duplicate vs. old union (baseline + already-accepted street corpus) | 346 |
| Duplicate within the recovered set itself | 0 |
| **Genuinely new** | **278** |

55.4% of the recovered rows were already present via some other accepted surface (plausible: these ARE correctly-tagged parent rows, so many were independently captured by the entity baseline or other streets already) — the "assume all 686 are new" framing this wave explicitly warned against would have overstated the gain by roughly 2.5×.

| | |
|---|---|
| REPLAY_UNIQUE (old 4,831 + 278) | **5,109** |
| Official total | 5,640 |
| REPLAY_DELTA | 531 |
| REPLAY_COVERAGE | **90.59%** |

## 3. Per-row identity classifier (Phase 4)

`lib/streetRowAcceptance.ts` (new). `classifyRowForAcceptance(raw, parentSourceId)` returns one of `ACCEPT_PARENT | REJECT_ZERO | REJECT_FOREIGN | REJECT_MISSING | REJECT_MALFORMED` based **only** on the row's own `neighborhoodId` — no street-name or address inference of any kind. The type union structurally has no `ACCEPT_ZERO`/`ACCEPT_FOREIGN` member, so acceptance beyond an explicit parent-id match is not just avoided by convention but unrepresentable in the type system.

## 4. Mixed-batch status (Phase 5)

New `StreetStatus` values: `SUCCESS_MIXED_PARTIAL` (some accepted, some rejected — never silently reported as a clean success) and `FAILED_NO_TRUSTED_ROWS` (replaces the old blanket `FAILED_IDENTITY` — a batch with rows but zero accepted). Verified live: a batch of 100 parent + 5 foreign rows now preserves the 100 and rejects the 5, reporting `SUCCESS_MIXED_PARTIAL`, never `SUCCESS_ROWS`.

## 5. Row accounting invariant (Phase 6)

`classifyBatchForAcceptance` asserts `rawRows === acceptedParent + rejectedZero + rejectedForeign + rejectedMissing + rejectedMalformed`, throwing (fail-closed, aborting that street as `FAILED_OTHER`) if ever violated. Verified live on all 3 real captures — accounting matched exactly every time.

## 6. Runner change (Phase 7)

`scripts/audit-wave0g18-street-runner.ts`'s `classifyStreetExchange` modified minimally: the old whole-batch `assertDirectIdAcquisitionIdentity` check is replaced by per-row classification; only `ACCEPT_PARENT` rows reach normalization, `prevDeals` extraction, and the returned `rows` array. No change to acquisition request behavior, network contract, or identity semantics beyond this. `RUN_CONTRACT_VERSION` deliberately **not** bumped (stays `"wave0g18-v1"`) — bumping it would have broken two already-committed, already-working scripts (`audit-wave0g18-aggregate.ts`, `audit-wave0g19-replay.ts`) that import and compare against it; resume-safety for the one status this wave actually changes is unaffected either way, since `FAILED_*` was never resumable and the previously-clean `SUCCESS_ROWS`/`SUCCESS_EMPTY`/`PARTIAL_MORE_FETCHES_INDICATED` results remain valid unchanged under the new logic (they were always 100% all-parent batches).

## 7. Zero-id policy remains closed (Phase 8)

**ZERO_ROWS_ACCEPTED = 0.** Verified live across all 3 probed streets (20 zero-id rows observed, 0 accepted). Wave 0G-19 left `ZERO_ID_SEMANTICS=UNRESOLVED` / `ZERO_NEIGHBORHOOD_POLICY=PARTIAL` — this wave does not adopt that policy. Regression test: `lib/__tests__/streetRowAcceptance.test.ts` "K" block asserts every zero-shaped input classifies to a `REJECT_*` decision and that the module's own source contains no `ACCEPT_ZERO` member at all.

## 8. Foreign non-zero remains closed (Phase 9)

**FOREIGN_ROWS_ACCEPTED = 0.** Verified live (347 foreign rows on הרב שמואל הרטום, all rejected). `classifyRowForAcceptance` never reads `address` or `streetCode` — only `neighborhoodId` — so a matching street name or streetCode cannot override a conflicting foreign id. Regression test: "L" block confirms classification depends only on `neighborhoodId`.

## 9. Transaction dedup revalidation (Phase 10)

`AMBIGUOUS_COLLISIONS = 0`, `LEGITIMATE_DISTINCT_COLLISIONS = 0` (no such rows found). Reused `classifyTransactionGroups` (the same field-agreement-aware function Wave 0G-18's own aggregator uses, ECC-reviewed there) rather than a hand-rolled key-only dedup — an earlier draft of this wave's replay script used a naive first-key-wins check that could have silently merged two distinct transactions sharing a key; caught by ECC (database-reviewer) and fixed by routing the 278 newly-accepted rows through the exact same proven classifier, treating them as one "virtual street" input. No rows were discarded merely to hit 5,640 — 5,109 is the real, computed figure.

## 10. Per-street recovery (Phase 12)

[`mixed_batch_recovery.csv`](mixed_batch_recovery.csv):

| Street | Parent rows (raw) | Parent rows (new) | Zero rejected | Foreign rejected | Final status |
|---|---|---|---|---|---|
| טום לנטוס | 411 | 163 | 8 | 0 | SUCCESS_MIXED_PARTIAL (verified live) |
| הרב שמואל הרטום | 134 | 52 | 0 | 347 | SUCCESS_MIXED_PARTIAL (verified live) |
| בני רייך | 79 | 63 | 12 | 0 | SUCCESS_MIXED_PARTIAL (verified live) |
| הפארק | 46 | UNVERIFIED | 0 | 171 | LIKELY SUCCESS_MIXED_PARTIAL (unverified) |
| הרב נרייה | 16 | UNVERIFIED | 1 | 0 | LIKELY SUCCESS_MIXED_PARTIAL (unverified) |
| אריאל שרון | 0 | 0 | 0 | 5 | FAILED_NO_TRUSTED_ROWS |
| האר"י | 0 | 0 | 0 | 237 | FAILED_NO_TRUSTED_ROWS |

Per-street "new" counts sum exactly to the combined total (163+52+63=278), reconciled by an integrity assertion in the replay script.

## 11. Reclassified Wave 0G-18 street totals (Phase 13)

Not all 7 failures became successes — the two 100%-foreign streets (אריאל שרון, האר"י) correctly remain `FAILED_NO_TRUSTED_ROWS` under the new logic too (0 accepted rows either way):

| Status | Count |
|---|---|
| CLEAN_SUCCESS (SUCCESS_ROWS, unchanged) | 29 |
| SUCCESS_EMPTY (unchanged) | 32 |
| PARTIAL_MORE_FETCHES_INDICATED (unchanged) | 2 |
| **SUCCESS_MIXED_PARTIAL (new — 3 verified live, 2 inferred from aggregate reconstruction, not row-level-verified)** | **5** |
| **FAILED_NO_TRUSTED_ROWS (was FAILED_IDENTITY; genuinely still 0 trusted rows)** | **2** |

29+32+2+5+2 = 70, reconciles exactly.

## 12. Residual gap reconciliation (Phase 14)

`REMAINING_DELTA = 531`. Bounded, disclosed components — **not claimed to sum exactly**:

- **Zero-id rejected:** 21 (unchanged, out of scope this wave)
- **Foreign non-zero rejected:** 760 raw (unconditionally rejected; not all necessarily "new" if ever accepted — some portion is likely duplicate, unmeasured)
- **Street fetch-2 unattempted:** ~34 (2 known streets, unchanged from prior waves)
- **CLASS A unverified residual:** 62 raw, dedup rate unknown (extrapolating the verified streets' 44.6% new-rate suggests ~28 potentially recoverable, **not** claimed as fact)
- **No identifiable street (baseline `street="0"`):** ~11% of the original baseline, structurally unreachable regardless of policy
- **Normalization drops:** 0 (verified this wave — all 624 accepted CLASS A rows normalized cleanly)
- **Unknown:** genuine remainder, not attributable to the above with current evidence

## 13. Fetch2 priority (Phase 15)

`FETCH2_ESTIMATED_OPPORTUNITY ≈ 34`. `CURRENT_DELTA_AFTER_PARENT_RECOVERY = 531`.

**IS_STREET_FETCH2_NOW_HIGHEST_VALUE_NEXT_STEP: NO.** The ~28-row unverified CLASS A residual (§12) is comparable in size and requires no new acceptance-policy risk (just one more bounded live fetch using the already-proven per-row logic); the still-untouched 760-row CLASS C question dwarfs both but requires genuine investigation, not just more fetches. Fetch2 was not executed this wave.

## 14. Zero-id priority reassessment (Phase 16)

`ZERO_ID_MAXIMUM_RAW_OPPORTUNITY = 21`, vs. `NEW_CLASS_A_RECOVERY = 278` (13×), `FETCH2_OPPORTUNITY ≈ 34` (1.6×), `CURRENT_DELTA = 531` (25×).

**ZERO_ID_POLICY_PRIORITY: LOW.** No change to zero-id policy made or recommended.

## 15. Tests (Phase 17)

- `lib/__tests__/streetRowAcceptance.test.ts` — 19 tests (A-P from the wave's own list, plus a `SUCCESS_EMPTY`-branch coverage test added on ECC review).
- `scripts/__tests__/wave0g18StreetRunner.test.ts` — 2 tests updated to reflect the new correct behavior (a mixed batch now preserves its valid parent row and reports `SUCCESS_MIXED_PARTIAL`, not a whole-batch `FAILED_IDENTITY`), 1 message-text assertion updated, 1 `RESUMABLE_STATUSES` assertion updated for the new status — all other 19 tests unchanged and still passing.

## 16. Bounded live control (Phase 18)

**LIVE_STREET:** הרב שמואל הרטום (74000865). **RAW_ROWS:** 481. **ACCEPTED_PARENT:** 134. **REJECTED_ZERO:** 0. **REJECTED_FOREIGN:** 347. **ACCOUNTING_MATCH:** true. Reproduced Wave 0G-18's exact original counts. No fetch2. No second control fetch needed (first one reproduced cleanly).

## 17. Quality gates (Phase 19)

Focused tests: 19. Full suite: **387/387 passing**. `npx tsc --noEmit`: clean. `npm run build`: clean. No lint/config changes.

## 18. Canonical safety (Phase 20)

ROWS BEFORE=AFTER=12,642. SHA BEFORE=AFTER=`18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f`. Supabase writes=0, importer runs=0, deployments=0.

## 19. Security (Phase 21)

Repo-wide grep of every new/changed file for token/auth/cookie/session/credential-value patterns: 0 matches. **SECURITY_SCAN = PASS.**

## 20. ECC final review (Phase 22)

Six reviewers, all against the real committed code and real live-captured data:

- **planner: PASS with 1 blocking finding, fixed** — verified the row-level fail-closed rule has exactly one accept path and cannot be reached for a zero/foreign id; verified the dedup was genuinely computed, not assumed; verified the refetch boundary and disclosed residual are honest. Caught a real forward-compatibility defect: `audit-wave0g18-aggregate.ts`'s `successStatuses` list was missing the new `SUCCESS_MIXED_PARTIAL` status — any future aggregator run would have silently discarded exactly the rows this wave recovers. **Fixed.**
- **specialist: PASS** — confirmed every real `neighborhoodId` value across all 991 captured rows this wave touched is a clean parent match, `"0"`, or a clean foreign number (never null/malformed in live data — those paths are defensive-only); confirmed `parsePaginationContract` correctly reads full-batch metadata independent of the per-row filter; confirmed `fetch_number=1` on the live control. Flagged the runner's inline accept-filter duplicating the classifier's logic. **Fixed.**
- **database-reviewer: PASS with 1 concern, fixed** — confirmed the 55.4% duplicate rate is plausible, not evidence of double-counting; confirmed the ambiguous-collision check runs over the FULL new union, not just the new subset; confirmed the 62 unverified rows never enter the dedup pool. Flagged that the replay's original dedup was a naive key-only check lacking field-agreement verification (the same anti-pattern already documented as a prior finding in the aggregator). **Fixed** by routing recovery through `classifyTransactionGroups` directly.
- **silent-failure-hunter: PASS**, with the same drift-risk finding as specialist (now fixed) — all other checks (accepted zero/foreign rows, lost valid rows under combined pagination+mixed-identity, batch-status ambiguity, false completeness, null `rowAcceptanceCounts` misuse) came back CLEAN.
- **security-reviewer: PASS** — 0 credential/token values found; confirmed the safe decoded-envelope pattern; confirmed the runner's diff is scoped to exactly the per-row classification change, no new write path introduced.
- **code-reviewer: PASS with 1 should-fix (already resolved by the time of review) and 1 nitpick, fixed** — confirmed `rowAcceptanceCounts` is set consistently across all 3 `StreetResult` construction sites, `RESUMABLE_STATUSES` correctly includes the new status, `RUN_CONTRACT_VERSION` reasoning holds, dead code cleanly removed. Nitpick (missing `SUCCESS_EMPTY` branch test) added.

Every fix was re-verified: `npx tsc --noEmit` clean, full suite passing, replay re-run producing byte-identical numbers, no `INTEGRITY_FAIL` thrown.

## 21. Report

This document; compact artifacts: [`mixed_batch_recovery.csv`](mixed_batch_recovery.csv), [`identity_class_summary.json`](identity_class_summary.json), [`kiryat_replay_summary.json`](kiryat_replay_summary.json). Raw response dumps stay uncommitted under `audit/wave0g20/shadow/`.
