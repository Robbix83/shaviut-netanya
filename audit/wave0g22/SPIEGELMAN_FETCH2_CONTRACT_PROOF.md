# Wave 0G-22 — Single-Street Fetch2 Contract Proof (Spiegelman)

**Verdict: PASS (proven on controlled retry, Wave 0G-22B).** The initial
attempt (commit `b72759a`) ended `WAITING_FOR_OPERATOR` — the live site was
blocked for every street tested that session, verified cross-street, not a
code bug (see "Initial attempt" section below, preserved for the record).
A later controlled retry (Wave 0G-22B, no code changes, script run exactly
as committed at `b72759a`) found the block had cleared: the legitimate
street fetch2 mechanism fired on the first attempt, exactly as designed —
`fetch_number` incremented from 1→2 with every other request field
unchanged, identity preserved, and street-level reconciliation landed on
an **exact 533/533 match**. The Kiryat-wide marginal value of this
particular fetch2 turned out to be **zero new rows** (all 33 already
present in the existing citywide union via other means) — a real,
disclosed finding, not a failure of the mechanism.

Baseline commit: `de331fc` (Wave 0G-21, CLOSED PASS). Kiryat Hasharon
prior state: 5,145/5,640 unique rows, 91.22% coverage (unchanged by this
wave — see Kiryat impact below).

## Wave 0G-22B — Controlled retry result (live evidence)

Retry performed with the script **unmodified** from commit `b72759a`, run
exactly once, no retry loop, no other street tested.

| Field | Fetch1 | Fetch2 |
|---|---|---|
| Rows | 500 | 33 |
| Parent / Zero / Foreign / Other | 500 / 0 / 0 / 0 | 33 / 0 / 0 / 0 |
| Date range | 2003-08-05 to 2026-06-29 | 1998-11-02 to 2002-12-31 |

`FETCH1_VS_FETCH2_FIELD_DIFFERENCES = fetch_number only` — `base_id`,
`base_name`, `type_order`, `domain` all identical between the two
requests, reproducing Wave 0G-9's entity-level "fetch_number only" finding
at street level for the first time with direct evidence (not inference).

**Trigger mechanism**: real, visible "הבא" (Next) button click-through.
`DERIVED_ROWS_PER_PAGE=10` (from live `total_rows=533`/`total_page=54`),
`PAGES_IN_LOCAL_BATCH=50` — the new network exchange fired at **exactly**
click 50, matching the data-derived boundary precisely. `fetch_number`
was never hand-constructed.

**Street reconciliation** (fetch1 + fetch2, deduped via
`classifyTransactionGroups`, key = `parcelNum+dealDate+dealAmount` with
field-agreement check):

- Combined raw: 500 + 33 = 533
- True duplicates: 0
- Ambiguous collisions: 0
- **Unique: 533 — exactly equal to official `total_rows=533`**
- Delta: 0
- **SPIEGELMAN_STREET_COMPLETENESS = PROVEN**

`RAW_STREET_TOTAL_OBSERVED=533` also matches exactly (the raw-accounting
check added after the prior attempt's ECC review) — the site's own row
count across both fetches reconciles perfectly, independent of any
identity/normalization filtering.

**Kiryat-wide impact**: `KIRYAT_IMPACT: fetch2ParentRows=33
duplicateVsCurrentKiryat=33 genuinelyNewToKiryat=0`. All 33 of fetch2's
rows — despite being genuinely new relative to fetch1 alone — are already
present in the current 5,145-row Kiryat union via some other
already-acquired path (the fetch1-vs-fetch1RowsAll containment check added
after the prior attempt's database-reviewer finding passed, confirming
this divergence is legitimate, not a bug). Kiryat coverage is therefore
**unchanged**: 5,145/5,640 (91.22%).

**Safety**: `ZERO_ACCEPTED=0`, `FOREIGN_ACCEPTED=0` (fetch2's batch was
`SUCCESS_ALL_PARENT` — no mixed-identity rows at all for this window),
`AMBIGUOUS_COLLISIONS=0` at both street and Kiryat scope. One fetch2 row
carried 1 prevDeal event, itself not new against the existing baseline —
correctly excluded from all top-level totals.

**Verdicts**: `STREET_FETCH2_CONTRACT=PROVEN`,
`SPIEGELMAN_STREET_COMPLETENESS=PROVEN`,
`STREET_FETCH2_GENERALIZATION=ONE_STREET_PROVEN` (not claimed beyond this
one street), `IS_FETCH2_WORTH_SCALING=NO` — because this street's
particular fetch2 yielded zero marginal value, not because the mechanism
itself failed. A different paginated street (e.g. דגניה, untested) could
still yield differently; no generalization is claimed either way.

Compact artifacts committed: `audit/wave0g22/fetch2_summary.json`,
`audit/wave0g22/fetch_window_comparison.csv`. Raw fetch2 response
(`audit/wave0g22/shadow/street_fetch2_74000875.json`) remains uncommitted,
per the wave's standing rule.

## Initial attempt (Wave 0G-22, commit b72759a) — preserved for the record

**Prior verdict: WAITING_FOR_OPERATOR.** This wave's first live attempt did
not complete — the live nadlan.gov.il site stopped returning any
`/deal-data` response at all that session, for every street tested, before
any fetch2 data could ever be captured. This was not a code bug and not a
street-specific issue; it was treated as an external, environmental block
(most likely reCAPTCHA/rate-limit escalation after five waves of heavy
automated browser acquisition in one session — Waves 0G-18 through 0G-21).
Per the wave's own instruction ("If the street UI cannot legitimately
produce the second request: return STREET_FETCH2_CONTRACT_NOT_PROVEN. Do
not guess.") and the project's standing rule against reCAPTCHA bypass, no
workaround was attempted and no further live requests were made at the time.

## Phase 2 — Fetch1 evidence reuse (successful)

Reused the already-committed fetch1 evidence
(`audit/wave0g18/shadow/street_65209683_74000875.json`) rather than
refetching, per instruction:

| Field | Value |
|---|---|
| Street | אברהם שפיגלמן (streetId=74000875) |
| FETCH1_ROWS | 500 |
| TOTAL_ROWS | 533 |
| TOTAL_FETCH | 2 |

All 500 committed fetch1 rows carry `neighborhoodId="65209683"` (the
requested parent), by construction — Wave 0G-18's runner only ever stores
ACCEPT_PARENT rows in its `rows` array. This is *not* an independent
re-verification (see the code comment at
[scripts/audit-wave0g22-spiegelman-fetch2.ts:76-86](../../scripts/audit-wave0g22-spiegelman-fetch2.ts) —
`normalizeDeal()` always force-sets `neighborhoodId` to the caller-supplied
parent id, so this check can never detect contamination even if present).
Fetch1's true identity purity was already established at ingestion time.

## Phase 3/4 — Live fetch2 attempt (initial attempt did not complete)

The script (`scripts/audit-wave0g22-spiegelman-fetch2.ts`) attempted to
reproduce, at street level, the exact click-through pagination mechanism
already proven at entity level in Wave 0G-9
(`audit/wave0g9/BEYOND_500_CONTRACT_PROOF.md`): derive rows-per-page from
`total_rows`/`total_page`, click the real "הבא" (Next) button enough times
to exhaust the locally-loaded batch, and observe whether the site's own
client JS fires a genuine `fetch_number=2` request — never hand-constructed.

Three page-load attempts (9s settle each) failed to capture even the
page's own automatic fetch1 exchange. A diagnostic capture showed:

- No `/deal-data` request fired at all.
- The reCAPTCHA sequence stalled at the `anchor` stage — it never reached
  `reload`/`clr`/`token-verify`, the sequence a working request always
  shows.
- The page body displayed `נמצאו 0 עסקאות` ("found 0 transactions").

To rule out a street-specific cause, a **second, different** street
(74000826, הפארק — which had worked cleanly in the immediately-prior Wave
0G-21, same session, same day) was also diagnostically probed and showed
the **identical** failure. This cross-street reproduction is the evidence
that the block is environmental/session-level, not particular to
streetId=74000875 or to this script's logic.

No further live attempts were made after this diagnosis.

## What the code was designed to measure (confirmed live in the retry above)

The script was fully written, reviewed, and quality-gated ahead of the
site's block clearing. Every one of the following was subsequently
confirmed live in the Wave 0G-22B retry above:

1. **Legitimate trigger** — via `nextButton` click-through, never inventing
   `fetch_number`.
2. **Identity preservation** — hard `SAFETY_VIOLATION` throw if
   `fetch2Exchange.baseId !== STREET_ID`, and if any exchange reports
   `fetch_number>=3`.
3. **Field-difference proof** — compares `base_id`/`base_name`/`type_order`/
   `domain` between fetch1 and fetch2 to reproduce Wave 0G-9's "fetch_number
   only" claim explicitly, not by assumption.
4. **Street reconciliation** — `fetch1RowsAll` (500, committed) + fetch2's
   accepted rows deduped via the shared `classifyTransactionGroups`
   (same field-agreement-aware classifier every prior wave used), checked
   against the official `total_rows=533` with a hard `throw` if the unique
   count ever exceeds 533.
5. **Kiryat-wide impact** — dedups fetch2's accepted rows against a
   faithfully-reconstructed current 5,145-row union (replaying Wave
   0G-21's own 4831→5145 recovery chain, hard-asserted to equal 5145
   before use).
6. **PrevDeals** — measured separately via the shared
   `extractPrevDealEvents`, never folded into top-level row counts.

## ECC review (all 6 reviewers, performed on the initial attempt's code — before the retry's live data existed)

The retry (0G-22B) reused this exact reviewed code unmodified and
encountered no new defect, so no fresh ECC pass was triggered — per the
retry wave's own instruction, a new review round is only warranted if
execution reveals a concrete new defect. It did not: every fixed check
below either passed cleanly (accounting invariants, containment assertion,
field-diff comparison, `total_rows` check) or was simply not exercised
(e.g. `SHADOW_CONVERSION_DROP` never fired, since `normalizationDrops=0`
this run).

| Reviewer | Verdict | Key finding |
|---|---|---|
| planner | CONFIRMED, with 2 concerns + 1 real bug | Design would have answered all 5 primary-mission questions. Confirmed WAITING_FOR_OPERATOR is not premature — the block is upstream of all script logic (even the page's own automatic fetch1 failed, on 2 different streets). Real bug: the click loop could close the browser context before a slow, in-flight response landed. **Fixed**: added a 5s post-loop drain wait. Also flagged missing field-diff/total_rows checks. **Fixed**: both added. |
| specialist | CONFIRMED | The street-level mechanism assumption is evidence-adjacent (grounded in Wave 0G-9's entity-level proof plus Wave 0G-20/21's already-proven street-level envelope shape), not a guess. The graceful `NOT_PROVEN` fallback is the correct design given offline DOM inspection was also blocked this session. |
| database-reviewer | CONCERN, fixed | The street-vs-Kiryat consistency cross-check relied on an unverified assumption (fetch1's rows ⊆ current Kiryat union). **Fixed**: added a hard containment assertion that throws if it doesn't hold, before relying on it. |
| silent-failure-hunter | PASS | All failure paths throw or return loudly with a clear reason; confirmed via `ls` that no partial/fabricated artifacts exist anywhere under `audit/wave0g22/`. |
| security-reviewer | PASS | No credential values anywhere (only field-NAME presence flags); no reCAPTCHA-bypass logic; the load retry is an ordinary bounded reload, not an evasion technique; confirmed empty disk state. |
| code-reviewer | CONCERN, fixed | **HIGH**: a normalization-drop check only logged a NOTE instead of failing closed — a silently-dropped accepted row could have corrupted every downstream reconciliation number with no error. **Fixed**: now throws `SHADOW_CONVERSION_DROP`, matching Wave 0G-21's own fix. **MEDIUM**: the "fetch1 reclassification" comment overclaimed independence. **Fixed**: comment now states plainly what the check actually verifies (report symmetry, not fresh detection). **LOW**: the persisted not-proven summary didn't distinguish failure reasons as well as the console log. **Fixed**: reason field now distinguishes all 3 failure modes explicitly. |

All findings were either confirmed as correct-as-designed or fixed. No
scoping/design flaw was found that would invalidate the experiment's
methodology — only implementation hardening, all now applied.

## Canonical safety (verified before and after both the initial attempt and the retry)

- `data/deals.json` rows: 12,642 (unchanged)
- SHA-256: `18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f`
  (unchanged throughout)
- Supabase writes: 0
- Importer runs: 0
- Deployments: 0

## Security

Initial attempt: scanned the script and report for tokens, cookies,
Authorization headers, session material, anti-bot values, and credential
fragments — none found; no fetch2 data existed to leak. Retry (0G-22B):
re-scanned the now-real `fetch2_summary.json` and `fetch_window_comparison.csv`
(the two committed artifacts) — pure row/date/count aggregates, no
credential material of any kind. The raw shadow dump
(`audit/wave0g22/shadow/street_fetch2_74000875.json`, uncommitted) contains
only `streetId`/`streetName`/`parentSourceId`/`fetchNumber`/`totalRows`/
`totalFetch`/`rawItems` — no credential fields at all, not even
presence-flag form.

## Tests

- Full suite: 387/387 passed (both runs; no code changed for the retry)
- Typecheck: clean (both runs)
- Build: clean (both runs, Next.js 16.2.6 / Turbopack)

## Live requests

**Initial attempt**: two page-load attempts on streetId=74000875 (each
with its own internal 3-attempt reload-retry), plus one diagnostic
cross-check on streetId=74000826 — zero `fetch_number=2` exchanges
captured.

**Retry (0G-22B)**: exactly one script execution, one page load (captured
fetch1 on the first attempt, no reload needed this time), one click-through
sequence (50 clicks, matching the data-derived boundary exactly) yielding
exactly one `fetch_number=2` exchange. No other street tested. Zero
`fetch_number>=3` requests made or attempted, either run.

## Residual / next step

The fetch2 mechanism is now **proven** for this street, with an exact
533/533 reconciliation — but its Kiryat-wide marginal value for this
specific street is zero (all 33 rows were already captured via another
path). The entity's remaining 495-row delta is therefore **not** reduced
by this wave. The other previously-identified pagination candidate,
דגניה (streetId=74000847, ~1-row opportunity), remains untested and is not
authorized by this wave. No further action on Spiegelman is warranted —
its fetch2 window has now been fully and exactly accounted for.
