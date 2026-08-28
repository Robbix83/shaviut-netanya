# Wave 0G-19 — Zero-Neighborhood Street Identity Reconciliation

**VERDICT: PARTIAL.** A real, honest investigation was carried out, a genuine premise error was caught and corrected, real code bugs were found and fixed, and a small, well-tested, clearly-labeled piece of classification tooling was produced — but the wave's central real-world question ("is `neighborhoodId=0` safe to accept as belonging to the requesting entity?") is **not resolved**. The evidence gathered is internally consistent but was directly contradicted by counter-evidence surfaced during ECC review, and the effective sample size is much smaller than it first appeared. No acquisition policy was changed in production.

## 0. Correcting this wave's own starting premise

The wave was framed around "~506 rows with `neighborhoodId="0"`." That figure does not appear anywhere in the actual Wave 0G-18 evidence — it traces back to an arithmetic error in this project's own prior final response, which wrote "506 of the 686" without ever having computed a real 506 figure. Re-deriving the breakdown precisely from the still-available (uncommitted) Wave 0G-18 shadow evidence gives the **exact** figures below (each of the 3 zero-id-affected streets has exactly `{parent, "0"}` as its distinct-id set, so the split is not an estimate):

| | Count |
|---|---|
| Total raw rows across the 7 rejected streets | **1,467** |
| CLASS A — matching parent id (`65209683`) | **686** |
| CLASS B — `neighborhoodId="0"` | **21** |
| CLASS C — a different, non-zero official id | **760** |
| CLASS D — missing/malformed identity | **0** |

A second terminological error surfaced during this wave's own ECC review and is corrected here: **686 is the matching-row count, not a "discarded total."** The actual total of non-matching (truly discarded, never accepted anywhere) rows is 1,467 − 686 = **781** (760 foreign + 21 zero-id). Every place in this project's own prior wave report that called 686 "discarded rows" was imprecise; 686 rows *did* carry the correct parent id but were still thrown away because Wave 0G-18's runner rejects a batch as a whole the instant any row in it fails identity — a separate, already-known architectural property, not something this wave changes.

Full breakdown: [`discarded_identity_classes.csv`](discarded_identity_classes.csv).

## 1. Reconstructing row-level evidence (Phase 2-3)

Wave 0G-18's runner never persisted raw, row-level data for a rejected (`FAILED_IDENTITY`) street — only aggregate counts (see `scripts/audit-wave0g18-street-runner.ts`'s `classifyStreetExchange`, the `...empty` spread on that branch). This means Phases 4-11's row-level analysis had no data to work from without a fresh, bounded capture. Phase 12's "at most 2 streets" live confirmation was therefore moved earlier out of necessity — disclosed here, not silently reordered.

**Chosen streets:** בני רייך (74001232, 12 of the 21 zero-id rows) and טום לנטוס (74001260, 8 of the 21) — together 20/21 (95%) of the total zero-id evidence. The 1 remaining zero-id row (הרב נרייה, streetId=74001235) was **not** reprobed and stays explicitly unresolved.

Both streets were fetched fresh, fetch_number=1 only, and reproduced Wave 0G-18's exact original counts (בני רייך: 79 matching/12 zero; טום לנטוס: 411 matching/8 zero) — confirming the phenomenon is stable, not a one-time artifact.

## 2. What the 20 zero-id rows actually look like (Phase 4-5)

All 20 rows:
- carry `neighborhoodId=0` **and** `neighborhoodName=null` — not another entity's real name
- carry their own `streetCode` matching the requested street exactly (20/20)
- have an `address` field that parses to exactly the requested street name (20/20, after fixing a real prefix-match bug — see §6)
- have a valid house number (20/20), and none show the `street="0"` text pattern (a different, already-known phenomenon)
- were **not** found anywhere in the existing Wave 0G-16 entity-level baseline corpus (0/20) — so there is no cross-surface reconciliation proof, only internal (within-response) consistency

[`zero_id_evidence.csv`](zero_id_evidence.csv) has the full per-row detail.

## 3. The counter-evidence that changes the verdict (Phase 6-8, revised after ECC review)

This is the most important finding of the wave, and it **complicates** rather than confirms the initial "safe to accept" hypothesis.

**The effective sample is 2 addresses, not 20 rows.** All 12 בני רייך zero-id rows are repeat sales of the single address "בני רייך 4"; all 8 טום לנטוס zero-id rows are repeat sales of "טום לנטוס 71." These are not 20 independent pieces of evidence — they are 2 independent pieces of evidence, each observed 12 and 8 times respectively (mostly different transaction dates/prices at the same building).

**The cadastral (gush/parcel-block) evidence points the other way.** Both zero-id addresses sit in cadastral block **9904-76** — a single, distinct block. But:
- On בני רייך, every explicitly parent-tagged row on the *same street* sits in blocks **9905-88/89** — never 9904-76.
- On טום לנטוס, the parent-tagged rows span **13 different** cadastral blocks (9901-6, -9, -11, -13, -14; 9902-5; 9903-9; 9904-6, -22, -25, -64; 9086-21, -22) — a normal, well-established, built-out street — and **none** of those 13 is 9904-76 either.

Wave 0G-18 already proved a single street name **can** genuinely span more than one official entity — 2 of its 7 rejected streets (הרב שמואל הרטום, הפארק) had rows split between the parent id and a real, different, non-zero foreign id on the exact same street. Given that precedent, a distinct cadastral cluster sharing a street frontage is consistent with **either**:
- (a) a real parcel group whose row-level neighborhood tag was simply never backfilled (the original hypothesis), **or**
- (b) a genuinely different administrative area that happens to front the same street name (the same pattern Wave 0G-18 already found elsewhere) — just tagged `0` instead of an explicit foreign id, for reasons not established this wave.

The evidence gathered this wave does not distinguish between these two interpretations. The `dealDate` range on the accepted rows (2016-09-12 through 2025) further weakens the "recently built, not yet backfilled" framing specifically — a ~10-year gap is a long time for a tag to simply be pending.

## 4. Foreign non-zero control group (Phase 9) — limited, disclosed

The 2-street live-reprobe budget went to the zero-id question (the wave's stated primary target), so no row-level data exists for CLASS C (foreign non-zero) this wave. Only the aggregate evidence from Wave 0G-18 is available: [`foreign_id_control.csv`](foreign_id_control.csv). Match rates on the 4 foreign-contaminated streets (0%-27.9%) are much lower than on the 2 zero-id streets (86.8%-98.1%), a real distinction — but this is aggregate-only, not the row-level bridging analysis Phase 9 asked for. **CLASS C remains rejected unconditionally, unchanged.**

## 5. Policy design and implementation (Phase 13/16) — narrow, tested, NOT adopted in production

`lib/streetIdentityPolicy.ts` (new) implements exactly the investigated rule ("Policy 2"): accept `neighborhoodId=0` only when the row's own `streetCode` matches the request **and** its address parses to exactly the requested street name; every other case — including any foreign non-zero id — stays rejected. Every decision carries an explicit reason string.

**This module is not wired into any live acquisition path.** `scripts/audit-wave0g18-street-runner.ts` is unchanged and still uses the stricter, all-or-nothing `assertDirectIdAcquisitionIdentity`. Given the genuine uncertainty in §3, this is deliberate — the module is investigation tooling and a tested reference implementation for a future wave to build on once the interpretation question is actually resolved, not an adopted policy change.

## 6. Real bugs found and fixed during ECC review

- **Prefix-match false positive (code-reviewer):** the original `nameMatch` check used `addr.startsWith(requestedStreetName + " ")`, which would incorrectly match a genuinely different street whose name is a prefix of another — e.g. a request for "הרב שלום" would false-positive-match the real, different street "הרב שלום איפרגן" (row 2 of this project's own street manifest). Fixed to parse the address the same way `lib/dealNormalization.ts`'s `parseAddress()` does (strip the trailing house-number token) and compare exactly, not by prefix. Regression test added.
- **`base_id == null` fallback (specialist):** the live-probe script's response-matching handler had a fallback that would accept *any* response whose envelope failed to decode a `base_id`, regardless of which street it actually answered — the same latent bug class Wave 0G-18 had to fix for real. Didn't manifest in this run (both captures decoded correctly), but fixed to require an exact match, no null bypass.
- **Duplicated evidence-gate logic (database-reviewer, code-reviewer):** the replay script originally reimplemented the streetCode/address check inline instead of calling the shared `classifyRowIdentity`, creating drift risk. Fixed to call the shared function directly — one place the rule lives.

## 7. Retrospective replay (Phase 14) — a conditional figure, not an adopted baseline

Given the genuine interpretation uncertainty in §3, the replay below shows **what the numbers would be if** the 20 zero-id rows were accepted — it is not presented as a validated new coverage figure.

- Old union (Wave 0G-18, re-verified by reconstruction): **4,831**
- 20 candidates, evidence-gated via the shared `classifyRowIdentity`: 0 true duplicates, **20 genuinely new** (none were already in the union)
- **If accepted:** augmented unique = **4,851**, delta = **789** (down from 809), coverage = **86.01%** (up from 85.66%)

[`policy_replay_summary.json`](policy_replay_summary.json) has the full machine-readable output, including the explicit `unresolvedZeroIdRowsNotReprobed: 1` marker for the הרב נרייה row.

## 8. Explaining the (still-782 if unaccepted / 789 if accepted) remaining gap (Phase 15)

Bounded, disclosed components — **not claimed to sum exactly**, since the composition of the still-unresolved 5 streets' rows is unknown without further live data:

- **Street fetch-2 unattempted:** ~34 rows (2 known streets, unchanged from Wave 0G-18) — a small, low-risk, already-scoped opportunity.
- **The other 5 still-rejected streets' entire batches remain unrecovered:** 957 raw rows (686 CLASS A total minus the 490 now-resolved from the 2 reprobed streets = 196 CLASS A rows still discarded whole, plus 760 CLASS C, plus 1 CLASS B). Notably, **196 of these are rows that already carry the CORRECT, unambiguous parent id** — they are discarded only because Wave 0G-18's runner rejects a batch wholesale rather than per-row. Recovering them would require no new acceptance-policy risk at all (the existing, trusted `ACCEPT_PARENT_MATCH` rule already covers them) — only a runner architecture change (whole-batch → per-row acceptance) and a fresh live fetch of those 5 streets, both out of scope this wave.
- **Foreign non-zero (CLASS C), 760 rows:** stays rejected per this wave's explicit instruction.
- **Baseline `street="0"` rows (~11% of the original baseline):** structurally unreachable by any street-targeted query regardless of policy.
- **Normalization drops:** 0 observed this wave.
- **Unknown:** a genuine remainder not attributable to any of the above with current evidence.

## 9. Fetch2 priority reassessment (Phase 19)

`CURRENT_REMAINING_DELTA` = 809 (unaccepted) or 789 (if the zero-id policy were adopted). `ESTIMATED_FETCH2_OPPORTUNITY` ≈ 34.

**IS_STREET_FETCH2_NOW_THE_HIGHEST_VALUE_NEXT_STEP: PARTIAL.** It remains a legitimate, low-risk, already-proven-mechanism next step, but §8 identified a larger and *lower-risk* opportunity this wave — the 196 CLASS A rows sitting in the other 5 already-known streets, recoverable via the already-trusted parent-id rule alone, no new acceptance policy required. Neither was executed this wave.

## 10. Architecture verdict (Phase 20)

- **ZERO_NEIGHBORHOOD_POLICY: PARTIAL.** Internally self-consistent within the 2 examined addresses; directly contradicted by cadastral-block evidence found on ECC review; not independently confirmed. Not PROVEN_SAFE, not UNSAFE (no evidence of active harm/false-positive was found either) — genuinely unresolved.
- **ENTITY_PLUS_STREET_ARCHITECTURE_AFTER_ZERO_RECONCILIATION: PROVEN** (unchanged from Wave 0G-18 — the underlying street-query mechanism itself was not touched or weakened this wave; this wave only investigated one open question about it).
- **KIRYAT_HASHARON_REPLAY_COVERAGE:** 86.01% *if* the unproven policy were adopted; **85.66% remains the actual, adopted figure** (Wave 0G-18's, unchanged), since no policy change was made in production.

## 11. Canonical safety (Phase 21)

ROWS BEFORE=AFTER=12,642. SHA BEFORE=AFTER=`18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f`. Supabase writes=0, importer runs=0, deployments=0.

## 12. Security (Phase 22)

Repo-wide grep of every new file for token/auth/cookie/session/credential-value patterns: 0 matches. **SECURITY_SCAN = PASS.**

## 13. Quality gates (Phase 23)

Focused identity-policy tests: 22 (`lib/__tests__/streetIdentityPolicy.test.ts`). Full suite: **368/368 passing**. `npx tsc --noEmit`: clean. `npm run build`: clean. No lint/config changes.

## 14. ECC final review (Phase 24)

Six reviewers, all reviewing real live-captured data and the actual code:

- **planner: FAIL** (of the wave's initial draft) — caught the 686-vs-781 terminology error and, decisively, that the effective sample is 2 addresses not 20, with cadastral-block evidence actively contradicting the "safe" story. This finding drove the verdict downgrade from the wave's initial PASS-leaning draft to PARTIAL and the rewrite of §3, §5, §10.
- **specialist: PASS with 1 FAIL item** — confirmed `neighborhoodName=null`, `streetCode`/`fetch_number=1` correctness, and the shared-gush-block evidence directly from the raw JSON; flagged the `base_id==null` fallback bug (fixed) and the wide dealDate range as weakening (not refuting) the recency framing.
- **database-reviewer: PASS**, with a real should-fix (evidence-gate logic duplication in the replay script, fixed) and confirmation the הרב נרייה row is genuinely excluded, not silently defaulted.
- **silent-failure-hunter:** confirmed the "2 addresses not 20" and cadastral-boundary findings independently from the raw JSON; flagged (unresolved, disclosed) that `classifyRowIdentity` has no way to detect a source-side data-entry error in `streetCode` itself, and that CLASS C behavior under this rule was never actually tested (no foreign-nonzero row was present in either probed street).
- **security-reviewer: PASS** — 0 credential/token values found; confirmed the safe decoded-envelope pattern (no Wave 0G-17-style leak).
- **code-reviewer: WARN → fixed** — the prefix-match false-positive risk and the duplicated evidence-gate logic (both fixed, tests added).

## 15. Report

This document; compact artifacts: [`discarded_identity_classes.csv`](discarded_identity_classes.csv), [`zero_id_evidence.csv`](zero_id_evidence.csv), [`foreign_id_control.csv`](foreign_id_control.csv), [`policy_replay_summary.json`](policy_replay_summary.json). Raw probe dumps stay uncommitted under `audit/wave0g19/shadow/`.
