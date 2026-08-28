# Wave 0G-22 — Single-Street Fetch2 Contract Proof (Spiegelman)

**Verdict: WAITING_FOR_OPERATOR.** This wave's live experiment did not
complete — the live nadlan.gov.il site stopped returning any `/deal-data`
response at all this session, for every street tested, before any fetch2
data could ever be captured. This is not a code bug and not a
street-specific issue; it is treated as an external, environmental block
(most likely reCAPTCHA/rate-limit escalation after five waves of heavy
automated browser acquisition in one session — Waves 0G-18 through 0G-21).
Per the wave's own instruction ("If the street UI cannot legitimately
produce the second request: return STREET_FETCH2_CONTRACT_NOT_PROVEN. Do
not guess.") and the project's standing rule against reCAPTCHA bypass, no
workaround was attempted and no further live requests were made.

Baseline commit: `de331fc` (Wave 0G-21, CLOSED PASS). Kiryat Hasharon
prior state: 5,145/5,640 unique rows, 91.22% coverage.

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

## Phase 3/4 — Live fetch2 attempt (did not complete)

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

## What the code would have measured (if the site had cooperated)

The script is fully written, reviewed, and quality-gated for a future
attempt once the block clears. It would have answered:

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

## ECC review (all 6 reviewers, code-only since no live data exists)

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

## Canonical safety

- `data/deals.json` rows: 12,642 (unchanged)
- SHA-256: `18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f`
  (unchanged, verified before and after this wave)
- Supabase writes: 0
- Importer runs: 0
- Deployments: 0

## Security

Scanned the new script and this report for tokens, cookies, Authorization
headers, session material, anti-bot values, and credential fragments: none
found. `audit/wave0g22/shadow/` is empty — the live run never reached any
`fs.writeFile` call for fetch2 data. No `fetch2_summary.json` or
`fetch_window_comparison.csv` exists, and none was fabricated to fill the
gap.

## Tests

- Full suite: 387/387 passed (unchanged — the fixes only add
  assertions/comparisons over already-well-typed data, no new lib surface)
- Typecheck: clean
- Build: clean (Next.js 16.2.6 / Turbopack)

## Live requests

Two page-load attempts on streetId=74000875 (each with its own internal
3-attempt reload-retry), plus one diagnostic cross-check on streetId=74000826
— all read-only, all within the "one street" acquisition-attempt spirit of
the wave's boundary (no fetch2 was ever obtained on any street; the second
street was probed only to distinguish a street-specific bug from a
session-wide block, not to acquire its data). Zero `fetch_number=2`
exchanges were ever captured. Zero `fetch_number>=3` requests were made or
attempted.

## Residual / next step

The fetch2 contract for אברהם שפיגלמן remains **unproven, not disproven**.
The script is ready to run again once the live site's block clears — no
code changes are anticipated to be needed for that next attempt beyond
what this wave already applied.
