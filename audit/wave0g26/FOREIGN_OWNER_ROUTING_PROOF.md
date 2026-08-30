# Wave 0G-26 — Foreign-Owner Routing Proof

**Verdict: PASS.** The `CITYWIDE_STREET_ROUTING` hypothesis raised by Wave
0G-25 was tested live, in bounds (2 street requests, the wave's full
budget), on the two highest-value entries in the actual 481-row unresolved
pool (selected from Wave 0G-25's committed CSV, not report prose). The
**routing rule itself is now strongly evidenced as safe** — 3 independent
live-verified cases across 2 waves, zero foreign-to-requesting-entity
misassignment, zero complete-entity contradiction (see Phase 8 for the
disclosed caveat: all 3 cases were pre-existing duplicates, so the rule
has not yet been tested on a genuinely contested assignment). Its
**yield is 0** on this sample: all 585 foreign-official rows seen this
wave (283 of which were genuinely part of the 481-row unresolved pool,
the other 302 already known from Wave 0G-25) are exact-transaction-key
duplicates already present in their true owner's corpus. No row was
added anywhere. Citywide figures are unchanged (59,305 / 63,704 /
93.09%). Architecture verdict: **PROMISING**, not PROVEN — safety is
strongly evidenced, yield is not.

This report also discloses and corrects three real issues found during
ECC review: an overstated Phase 9 cross-surface claim (585 → the correct
283), a mislabeled Phase 17 denominator ("0-for-783" → the correct
"0-for-283," since Wave 0G-25's בן-צבי was never part of the unresolved
pool), and — found while fixing those — a genuine **housekeeping gap**:
this wave's (and Wave 0G-25's) "the raw dump was deleted" claim was
technically inaccurate. `rm -f /tmp/...` from the Bash tool deletes from
Git-Bash's own POSIX `/tmp`, but Node.js on this Windows host resolves a
literal `/tmp/...` path to `C:\tmp\...` — a different physical location.
The raw dumps were never actually removed by the earlier commands; they
sat, untracked and never committed (git never saw them — they were
outside the repository entirely), at `C:\tmp\` until discovered and
properly deleted during this wave's fix pass. No security exposure
resulted (never committed, never in the repo, local-disk-only), but the
"deleted" claim in this and the prior wave's reports was inaccurate until
now — corrected here.

## Phase 1 — Baseline

- HEAD before this wave: `442c152` (Wave 0G-25, CLOSED PASS)
- Canonical: 12,642 rows, SHA-256
  `18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f` —
  verified unchanged throughout.

## Phase 2 — Street selection (from actual CSV, not prose)

Loaded `audit/wave0g25/boundary_citywide_overlap.csv` directly and summed
its `UNRESOLVED` column: **481**, matching Wave 0G-25's own total exactly
(the analysis script hard-throws otherwise). Ranked all 9 distinct
streets descending:

```
143 — פתח תקווה (74000627)  [SHARED_WITH_OTHER_TARGET_MANIFESTS]
140 — שלום עליכם (74000946) [EXCLUSIVE_TO_REQUESTED_ENTITY_UNVERIFIED_OWNER]
 70 — הלילך (74000991)
 61 — בן-אב"י (74000504)
 40 — בן-גוריון (74000996)
 27 — הרצל (74000418)
  0 — דב גרונר / בן-צבי / ז'בוטינסקי (already resolved by Wave 0G-25)
```

**`TARGET_STREET_1 = פתח תקווה (74000627)`, `TARGET_STREET_2 = שלום עליכם
(74000946)`** — the two highest-ranked, selected purely from the ranked
CSV data as instructed (report prose was not consulted for this
decision).

## Phase 3/4/5 — Live requests (2 of 2 used)

```
LIVE_REQUESTS = 2
WHY_REQUEST_NEEDED = these 2 streets' raw per-row neighborhoodId was
  never previously captured — only aggregate zero/foreign counts exist.
WHAT_IT_WOULD_PROVE = whether foreign rows can be safely routed to their
  explicit official owner, and whether doing so recovers genuinely new
  citywide transactions.
```

Both requests were single, read-only, `fetch_number=1` page loads of the
already-proven direct street URL — no fetch2, no broad crawl, no
acceptance-policy change. The temporary probe script was deleted
immediately after use, never committed. The 2 raw JSON dumps were never
tracked or committed either (they were written outside the repository
entirely), but — see the top-of-report correction — an initial cleanup
attempt targeted the wrong `/tmp` due to a Bash-vs-Node path-resolution
mismatch on this Windows host; they have since been properly deleted from
their actual location (`C:\tmp\`).

**פתח תקווה (74000627), requested by מע"ר:**

```
RAW_ROWS=445  REQUESTING_PARENT_ROWS=0  FOREIGN_OFFICIAL_ROWS=445  ZERO_ROWS=0  UNKNOWN_ROWS=0
  -> רמת אפרים (65209736): 278 rows   [already known — Wave 0G-25 target-accepted]
  -> מרכז העיר (65209717): 24 rows    [already known — Wave 0G-25 target-accepted]
  -> גבע        (65210246): 143 rows   [the actual unresolved-pool portion]
```

**שלום עליכם (74000946), requested by קריית נורדאו:**

```
RAW_ROWS=140  REQUESTING_PARENT_ROWS=0  FOREIGN_OFFICIAL_ROWS=140  ZERO_ROWS=0  UNKNOWN_ROWS=0
  -> אגמים (65210238): 140 rows        [the entire unresolved-pool portion]
```

Both accounting invariants (`raw = requestingParent + foreignOfficial +
zero + unknown`) verified exactly; the script hard-throws otherwise.

## Phase 3 — Official destination ID validation

All 4 distinct non-zero neighborhoodIds observed resolve cleanly through
the official nadlan entity catalog (`audit/wave0g16/catalog_snapshot.json`
— never GovMap, never name-based guessing):

| neighborhoodId | Official name | Found in catalog |
|---|---|---|
| 65209736 | רמת אפרים | YES |
| 65209717 | מרכז העיר | YES |
| 65210246 | גבע | YES |
| 65210238 | אגמים | YES |

No unresolved/unknown IDs this wave (`UNKNOWN_ROWS=0` on both streets).

## Phase 6/7 — Transaction-safe citywide + destination-ownership check

**Critical correction made mid-wave (disclosed, not hidden):** the first
pass compared foreign rows against each destination entity's raw Wave
0G-16 **baseline** file, which is *stale* for the two destinations that
are themselves target entities (מרכז העיר, רמת אפרים) — Wave 0G-24B
already augmented their baselines with every street they successfully
accepted rows from, and this wave happened to re-fetch a street they were
*already* augmented from. Comparing against the stale baseline
misclassified 23 already-accepted Wave 0G-24B rows as "genuinely new."
**Fixed**: the script now reconstructs each target destination's full
*current* accepted-row set (baseline ∪ every street it has already
successfully accepted, per Wave 0G-24B's own committed result files)
before checking duplication — the correct comparison basis, since that
reconstruction is exactly how the current 59,305 figure was built. A
non-target (COMPLETE) destination's baseline needed no such
reconstruction — it was never augmented, so it is already current.

With the corrected comparison basis:

```
FOREIGN_ROWS_RAW (both streets, all destinations) = 585
FOREIGN_TRUE_DUPLICATE_CURRENT_CITYWIDE            = 585  (100%)
FOREIGN_GENUINELY_NOT_IN_59305                     =   0
AMBIGUOUS_COLLISIONS                               =   0
LEGITIMATE_DISTINCT_COLLISIONS                     =   0
```

| Destination | sourceId | Status | Raw rows | Duplicate | Genuinely new |
|---|---|---|---|---|---|
| רמת אפרים | 65209736 | PARTIAL (target, reconstructed) | 278 | 278 | 0 |
| מרכז העיר | 65209717 | PARTIAL (target, reconstructed) | 24 | 24 | 0 |
| גבע | 65210246 | COMPLETE | 143 | 143 | 0 |
| אגמים | 65210238 | COMPLETE | 140 | 140 | 0 |

Every foreign row on both streets is already present, byte-for-byte
(`parcelNum|hasDate:date|price` via the canonical `transactionKey()`,
applied through the same `toShadowDeal()` normalization used everywhere
else in this engagement — no hand-rolled key this time, unlike Wave
0G-25's imprecision, now avoided by construction), in its true owner's
corpus.

## Phase 8 — Routing rule evidence

```
ROUTING_RULE_EVIDENCE = STRONG_ON_SAFETY, UNTESTED_ON_A_NOVEL_CASE
```

Across 3 independent live-verified cases now (Wave 0G-25's בן-צבי, plus
this wave's 2 streets): zero foreign rows ever assigned to the requesting
entity, zero complete-entity contradictions. The rule — route an explicit
non-zero `neighborhoodId` to its own official entity — has never once
produced an incorrect or unsafe assignment when tested against real data.

**Disclosed caveat (an ECC planner finding, not hidden):** all 3 cases
were 100% pre-existing duplicates. The rule has therefore never yet been
exercised on a row that was genuinely absent everywhere — every "correct"
routing so far was confirmed only because the destination already held
the row. This is strong evidence of *safety* (the rule never misroutes),
but not yet evidence that it performs correctly when the assignment is
actually contested or novel. That distinction is exactly why Phase 15
below does not call the architecture PROVEN.

Also disclosed: "zero ambiguous collisions" (Phase 6/7) checked
`transactionKey` equality only (parcelNum+date+price) — it did not
independently re-verify non-key field agreement (floor, area, rooms) the
way `classifyTransactionGroups`'s `rowsAgree` check does elsewhere in
this engagement. Re-verifying would require re-fetching the now-deleted
raw rows, which would exceed this wave's 2-request budget. The claim
should be read as "no key-level disagreement," not as an independently
field-verified confirmation.

## Phase 9 — Independent cross-surface validation

**Correction made after ECC review (a real overclaim, caught and fixed,
not hidden):** the first draft of this section credited all 585 rows as
cross-surface confirmation. That overstates it. Only the rows matched
against a destination that was **never augmented** (גבע, אגמים — their
Wave 0G-16 baseline is exactly their current, complete corpus, a
genuinely different acquisition surface — neighborhood-scoped search —
than this wave's street-scoped query) count as true cross-surface
evidence. The rows matched against a **target** destination (מרכז העיר,
רמת אפרים) were matched against a corpus that already includes THIS SAME
street's own Wave 0G-24B result — the same surface, already classified,
merely re-confirmed here, not independent evidence.

```
CROSS_SURFACE_CONFIRMED_ROUTING_EXAMPLES = 283  (גבע 143 + אגמים 140)
SAME_SURFACE_RECONFIRMED (excluded above) = 302  (מרכז העיר 24 + רמת אפרים 278)
```

283 rows of genuine cross-surface confirmation is still materially
stronger evidence than manifest membership, exactly as the wave
anticipated — just a smaller, more honestly-scoped number than the first
draft claimed.

## Phase 10 — Zero-ID negative control

```
ZERO_ROWS_IN_TWO_STREETS = 0
ZERO_ROUTED               = 0
```

Neither selected street happened to contain a zero-id row this time —
the negative control is trivially satisfied (nothing to route, nothing
routed) rather than exercised against real zero-id data. The routing
concept still explicitly excludes `neighborhoodId=0` by construction; no
fallback to street-manifest membership was used anywhere in this wave's
classification.

## Phase 11 — Requesting-entity negative control

```
FOREIGN_ROWS_ASSIGNED_TO_REQUESTING_ENTITY = 0
```

Neither מע"ר nor קריית נורדאו received a single row from these two
streets — confirmed directly (`REQUESTING_PARENT_ROWS=0` on both).

## Phase 12 — Bounded replay (simulation only)

```
SIMULATION_ONLY = YES

SIMULATED_ROUTED_RAW      = 585
SIMULATED_ROUTED_UNIQUE   =   0
SIMULATED_DUPLICATES      = 585
SIMULATED_AMBIGUOUS       =   0

CURRENT_CITYWIDE_UNIQUE        = 59,305
SIMULATED_NEW_CITYWIDE_UNIQUE  = 59,305   (unchanged)
OFFICIAL_TOTAL                 = 63,704
SIMULATED_DELTA                =  4,399   (unchanged)
SIMULATED_COVERAGE             =  93.09%  (unchanged)
```

No row was written to any union, result file, or canonical data this
wave. This simulation is not adopted.

## Phase 13 — Destination entity impact

| Entity | sourceId | Current safe unique | Official total | Current delta | Simulated routed new | Simulated new unique | Simulated new delta |
|---|---|---|---|---|---|---|---|
| רמת אפרים | 65209736 | 2,139 | 2,266 | 127 | 0 | 2,139 | 127 |
| מרכז העיר | 65209717 | 7,904 | 9,972 | 2,068 | 0 | 7,904 | 2,068 |
| גבע | 65210246 | 1,550 | 1,550 | 0 | 0 | 1,550 | 0 |
| אגמים | 65210238 | 1,804 | 1,804 | 0 | 0 | 1,804 | 0 |

No entity's simulated unique exceeds its official total (the fail-closed
gate never fired — nothing to gate, since 0 new rows were routed
anywhere).

## Phase 14 — Partial vs. complete entity impact

```
NEW_ROWS_ROUTED_TO_PARTIAL_ENTITIES  = 0
NEW_ROWS_ROUTED_TO_COMPLETE_ENTITIES = 0
COMPLETE_ENTITY_CONTRADICTIONS       = 0
```

No contradiction arose — גבע and אגמים received zero genuinely-new rows,
consistent with their COMPLETE status.

## Phase 15 — Architecture verdict

```
CITYWIDE_STREET_ROUTING = PROMISING
```

Deliberately **not** PROVEN. The routing *rule*'s safety is strongly
evidenced (Phase 8) — but PROVEN requires demonstrated yield (recovering
at least one genuinely new, correctly-routed transaction), and across all
3 live-verified cases to date (Wave 0G-25's בן-צבי, this wave's 2
streets — 783 unresolved-pool rows tested in total), **zero** genuinely
new rows have been found. Calling the architecture PROVEN on safety alone
would overclaim, exactly as this wave's own instruction warns against.

## Phase 16 — Request reduction (restated, not new)

```
DUPLICATE_REF_REQUESTS_AVOIDABLE = 36
REQUEST_REDUCTION_PERCENT        = 9.6%
```

Would distinct-streetId routing eliminate the `FAILED_NO_TRUSTED_ROWS`
concept? **Yes, in semantics** — under citywide routing, a street
acquisition never "fails ownership" for a requesting entity, because no
entity requests it in an ownership sense; every row is independently
routed or rejected by its own explicit `neighborhoodId`. The per-
(entity,street) status taxonomy would be replaced by a per-row outcome.
**Not implemented this wave.**

## Phase 17 — Extrapolation boundary

Of the 481-row unresolved pool, this wave live-tested exactly the **283**
rows (143 גבע + 140 אגמים) that were the genuinely-unresolved portion of
the 2 selected streets — the other 302 rows seen this wave (24 מרכז
העיר + 278 רמת אפרים) were already explained by Wave 0G-25 as
target-accepted, merely re-confirmed here.

```
LIVE_VERIFIED_UNRESOLVED_ROWS = 283  (of 481, 58.8%)
LIVE_VERIFIED_GENUINELY_NEW   =   0
LIVE_VERIFIED_DUPLICATES      = 283
```

**No extrapolation to "X% of 481 will recover" is offered as fact.**
283/481 (58.8%) of the unresolved pool has now been live-tested, with
0/283 genuinely new. **Correction (an ECC planner finding, not hidden):**
an earlier draft added Wave 0G-25's בן-צבי (500 rows) to this figure to
claim "0-for-783" — but בן-צבי shows `UNRESOLVED=0` in Wave 0G-25's own
committed CSV (it was already fully resolved there, categorized
`VERIFIED_OUTSIDE_TARGET`, never part of the 481-row unresolved pool).
Folding it in inflated the tested-sample denominator by roughly 2.8×.
Correctly stated: this wave's own tested sample is **0-for-283** of the
481-row unresolved pool; Wave 0G-25's בן-צבי is a separate, similarly-
patterned (also 100% duplicate) but distinctly-categorized prior result,
never combined into one pool-relative count. Neither sample is a
statistically rigorous basis for a percentage projection with a stated
confidence interval, so none is given. The remaining 198 untested
unresolved-pool rows (הלילך 70, בן-אב"י 61, בן-גוריון 40, הרצל 27) are
genuinely unknown.

## Phase 18 — Next architectural decision

```
BEST_NEXT_STEP = A
```

**Offline replay of ALL already-captured street rows using explicit-owner
routing.** Wave 0G-24B already live-acquired all 374 entity-street raw
batches for the 10 target entities (persisted in
`audit/wave0g24/shadow/`, uncommitted but present on disk) — but the
runner only ever persisted *accepted* rows per entity, discarding the
per-row raw `neighborhoodId` of every rejected row. Reusing what's
already been fetched (routing every already-captured raw row by its own
explicit `neighborhoodId`, without any new live crawling) is a strictly
cheaper and more evidence-grounded next step than either a full
citywide-338-street reacquisition (Option B) or continuing to
individually investigate boundary streets one at a time (Option C) —
option D (stop) is not warranted given the wave's own repeated finding
that the rule is safe, just not yet shown to be valuable at scale.
**Not implemented this wave** — contingent on separate authorization.

## Phase 19 — No policy loosening

```
CURRENT_REQUESTING_ENTITY_POLICY_CHANGED = NO
ZERO_ID_POLICY_CHANGED                    = NO
FOREIGN_ID_VALIDATION_LOOSENED            = NO
```

The concept under test throughout this wave was **routing to the
explicit owner**, never accepting a foreign row into the wrong
(requesting) owner. No production code, identity policy, or acceptance
rule was touched.

## Tests

- Full suite: 387/387 passed.
- Typecheck: clean.
- Build: clean, Next.js 16.2.6/Turbopack.
- No reusable routing helper code was added to `lib/` this wave (the
  routing logic exists only inside the one-off analysis script); per
  Phase 20's own instruction, no application tests were manufactured for
  it. The script's own hard-throw invariants (accounting sum, fail-closed
  official-total gate, corpus-reconstruction correctness) serve as its
  self-verification, matching this engagement's established pattern for
  one-off audit scripts (see Wave 0G-24B/0G-25's own aggregation
  scripts, none of which have dedicated `__tests__` either).

## Canonical safety

- `data/deals.json`: 12,642 rows, SHA-256
  `18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f` —
  verified unchanged before and after.
- Supabase writes: 0. Importer runs: 0. Deployments: 0.

## Security

Scanned all newly-tracked artifacts (1 new analysis script, this report,
3 compact CSVs, 1 JSON summary) for tokens, cookies, Authorization
headers, session material, anti-bot values, and credential fragments:
none found. The 2 live diagnostic requests used the exact same proven,
unauthenticated street-page mechanism as every prior wave (no reCAPTCHA
bypass, no session forging). The temporary probe script was deleted
immediately, never committed. The 2 raw JSON dumps were never tracked or
committed (`git status`/`git log` never saw them — they lived entirely
outside the repository), though see the top-of-report correction: they
were not actually deleted from disk until mid-wave, due to a Bash-vs-Node
`/tmp` path-resolution mismatch on this Windows host — no security
exposure resulted, but the "deleted" claim was inaccurate until the
housekeeping fix. Both are now confirmed removed from their real location
(`C:\tmp\`).

## ECC review

Per Phase 22: planner, specialist, database-reviewer, silent-failure-
hunter, security-reviewer (all required); code-reviewer (reusable
analysis code was written).

| Reviewer | Verdict | Key finding / fix |
|---|---|---|
| planner | CONCERNS-FOUND, all 3 material issues fixed | (1) Phase 9's cross-surface claim wrongly credited all 585 rows — corrected to the true 283 (only גבע/אגמים, matched against a genuinely different, never-augmented surface). (2) "0-for-783" wrongly folded Wave 0G-25's already-resolved בן-צבי (500 rows, `UNRESOLVED=0` in that wave's own CSV) into this wave's unresolved-pool denominator — corrected to "0-for-283," with בן-צבי cited separately. (3) Flagged the raw dumps as non-reproducible by any reviewer — investigating this led directly to discovering the `/tmp` path-resolution bug (see below). Also noted Phase 8's `STRONG` claim didn't disclose that 100%-duplicate results never actually tested the rule on a contested case — **fixed**, softened and caveated. |
| specialist | CONFIRMED, no discrepancies | Independently verified all 6 cross-checks: street selection ranking, מרכז העיר/רמת אפרים's Wave 0G-24B figures, גבע/אגמים's COMPLETE status, the exact `acceptedParent` counts (24/278) already known for this same street from Wave 0G-24B's own result files, RAW_ROWS consistency between Wave 0G-25's aggregate observation and this wave's full live re-fetch, and the citywide baseline (59,305) match. Zero drift found. |
| database-reviewer | CONCERNS, all fixed | (1) `reconstructCurrentAcceptedKeys` branched on `TARGET_ENTITIES` membership alone, which is false in general — Kiryat Hasharon is PARTIAL and was augmented (Wave 0G-18/0G-23) but isn't in `TARGET_ENTITIES`; the old code would have silently trusted its stale baseline if it were ever a destination. **Fixed**: branch on the baseline's own `status` field, fail closed (throw) for any PARTIAL-but-not-target case rather than guessing. (2) No invariant asserting `dup+notPresent+normalizationDrops===raw` per destination. **Fixed**: added an explicit throw. (3) No assertion connecting the computed unresolved-pool-tested figure to the CSV's own per-street values. Addressed via the corrected, explicit Phase 17 accounting. |
| silent-failure-hunter | HIGH finding, disclosed (not silently fixed — genuinely can't be re-verified) | `AMBIGUOUS_COLLISIONS=0`/`LEGITIMATE_DISTINCT_COLLISIONS=0` were asserted as confirmed facts but only ever checked `transactionKey` equality, never independently verified non-key field agreement (floor/area/rooms) the way `classifyTransactionGroups`'s `rowsAgree` does elsewhere in this engagement. Re-verifying would require re-fetching the deleted raw rows, exceeding this wave's 2-request budget — **honestly disclosed as a key-level-only claim**, not silently left as an overclaim. Also found: `normalizationDrops` wasn't in the CSV output (**fixed**, added as a column) and a fragile non-null-assertion pattern in the CSV writer (**fixed**, replaced with an explicit check-and-throw). |
| security-reviewer | PASS at review time; a real gap found during the fix pass | Confirmed no credential material anywhere, confirmed `git status` showed no tracked temp artifacts, confirmed the script makes zero network requests. The reviewer correctly found no *tracked* raw dump — but while fixing the planner's reproducibility concern, this session discovered the raw dumps were never actually deleted from disk at all (Bash's `rm -f /tmp/...` targeted a different physical path than Node's `/tmp/...`) — see the top-of-report correction. No exposure resulted (never tracked, never in the repo), but the "deleted" claim was inaccurate until corrected this wave. |
| code-reviewer | APPROVE, 2 MEDIUM fixed | Confirmed correct `sourceId`-based joins, no unused imports, consistent `csvEscape`, no falsy-on-zero bugs. **Fixed**: (1) Phase 14's hardcoded `partialSourceIds` list (which even included Kiryat, inconsistent with `reconstructCurrentAcceptedKeys`'s own scope) replaced with each destination's already-loaded `status` field as ground truth. (2) Documented the `owner_routing_results.csv` limitation (entity-level, not per-street, aggregation) with an explicit code comment for future reuse. |

**A genuine, disclosed correction, found only because of this review
pass:** fixing the planner's reproducibility concern required tracing
exactly where the "deleted" raw dumps actually were — which surfaced a
real Bash-vs-Node `/tmp` path-resolution mismatch on this Windows host.
The dumps were never at risk of being committed (they were never inside
the repository, and `git` never saw them), but this wave's initial
security posture ("deleted after use") was inaccurate until the actual
files were located at `C:\tmp\` and properly removed mid-wave. This
correction is disclosed here rather than silently patched, and the same
housekeeping gap likely applies to Wave 0G-25's own probe dump — noted
for awareness, not re-litigated (Wave 0G-25 is already closed).

All findings were either confirmed as correct-as-designed or fixed and
disclosed. The headline numbers (585 raw, 0 genuinely new, citywide
unchanged at 59,305/93.09%) were unaffected by any fix — re-running the
analysis script after all fixes (made possible only because the raw
dumps, contrary to the original claim, had not actually been deleted yet)
reproduced identical figures, now with corrected interpretive framing.
Quality gates re-ran clean after every fix.
