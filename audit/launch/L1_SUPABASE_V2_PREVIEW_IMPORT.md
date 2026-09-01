# Wednesday Launch Sprint — L1: Supabase V2 Preview Import

**Verdict: PARTIAL.** The DDL blocker from the previous session is fully
resolved — the operator ran `supabase/l1_preview_tables.sql` successfully,
and this session verified both preview tables exist with the correct
schema and access posture as far as this REST-only connection can prove.
**Import is blocked by a new, different, and more consequential finding:**
the frozen V2 candidate contains 116 rows sharing an `id` with another row
(the Postgres primary key on both `deals` and `deals_v2_preview`). The
import's own pre-import validation caught this before any row was written
— both preview tables remain at exactly 0 rows. This is a genuine,
previously-undetected data-integrity defect in the existing citywide
transaction-id scheme, not a bug in this session's import code.

## Resume baseline (re-confirmed)

```
Previous commit = e139d4a7e4350224a8cc5ccf48cc3d0da3e85bb6
Frozen V2 candidate: ROWS=59305, SHA256=8bb6770525894cd2053293d0c60acb877e6acd77d81bdd30c02200e5e6c34bf0 (unchanged)
Legacy canonical: ROWS=12642, SHA256=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f (unchanged)
```

## Preview table verification (`scripts/l1-verify-preview-tables.ts`)

```
neighborhoods_v2_preview_EXISTS = YES (0 rows)
deals_v2_preview_EXISTS         = YES (0 rows)
NEIGHBORHOODS_V2_PREVIEW_SCHEMA = MATCHES_EXPECTED_5_COLS
DEALS_V2_PREVIEW_SCHEMA         = MATCHES_EXPECTED_19_COLS
SERVICE_ROLE_DELETE             = NO (live-proven: Postgres 42501 permission denied on a real DELETE attempt)
```

**UNPROVEN vs FAILED, as instructed — nothing below was contradicted, this
connection simply cannot observe it:**
- `ANON_ACCESS` = UNPROVEN (no `NEXT_PUBLIC_SUPABASE_ANON_KEY` exists anywhere in this environment; this session cannot make a live anon-role request)
- `AUTHENTICATED_ACCESS` = UNPROVEN (no mechanism here mints a Supabase authenticated-role JWT)
- Both are backed by documentary evidence only: `supabase/l1_preview_tables.sql` explicitly runs `revoke all ... from anon, authenticated`, and the operator confirmed it executed with SUCCESS/no error.
- **`SERVICE_ROLE_INSERT`/`SERVICE_ROLE_UPDATE` = UNPROVEN VIA LIVE TEST this session too** — important nuance: the import never reached its own insert/update calls (it threw during pre-import validation first), so despite the grants being present in the executed DDL, no live INSERT or UPDATE has actually been exercised against these tables yet. Only `SELECT` (via the count/schema checks) and `DELETE` (correctly rejected) were live-tested.

## Import attempt — BLOCKED (`scripts/l1-import-v2-preview.ts`)

The script verifies the frozen SHA, loads both source files, then runs a
full pre-import validation pass over **all** 59,305 rows (not stopping at
the first problem — an early version did stop early, and a silent-failure-
hunter-style check confirmed this could mask other defect categories; the
loop now scans every row for every check before deciding whether to
proceed):

```
VALIDATION_DUPLICATE_IDS      = 103 distinct ids (116 rows total involved)
VALIDATION_ORPHANED_FK        = 0
VALIDATION_INVALID_PRICE      = 0
VALIDATION_UNEXPECTED_PREVDEALS = 0
```

Only the duplicate-id category is a problem — orphaned FKs, invalid
prices, and stray `prevDeals` fields are all clean across the full
dataset, confirming the rest of L0's build integrity holds.

Both target tables were re-confirmed at exactly 0 rows after this run.
**Zero writes of any kind occurred against either preview table this
session.**

## Root cause — a real, pre-existing citywide defect, not a V2-build bug

`lib/dealNormalization.ts:108` builds every `Deal.id` as:
```
`${neighborhoodId}-${raw.keyValue ?? raw.dealId ?? `${dealDate}-${price}-${builtArea||plotArea}`}`
```
A direct check found **100% of both the V2 candidate's 59,305 ids and
production `data/deals.json`'s 12,642 ids** take the fallback branch —
`raw.keyValue`/`raw.dealId` are never actually populated by this
pipeline's source data. This is corroborated by an earlier finding
already on record in `audit/wave0g10/PAGINATION_DEPTH_AND_TRANSACTION_IDENTITY.md`,
which established that no `dealId`/`keyValue`/`transactionId` field
exists anywhere in the observed raw nadlan.gov.il schema, and explicitly
flagged that citywide id-uniqueness at scale was never proven — this
defect materializing now is a pre-registered risk landing on schedule,
not a new discovery.

Production's 12,642 rows have **zero** id collisions (checked directly) —
not because the scheme is sound, but because that smaller, narrower
dataset never happened to produce two same-day/same-price/same-area
transactions in the same neighborhood. V2's 59,305 rows (~4.7x larger,
spanning more entities and years) crossed that threshold: **116 rows /
59,305 ≈ 0.20% collision rate.**

Of the 103 duplicated-id groups:
- **9 groups** are byte-for-byte identical rows after normalization (could
  look like safe no-op duplicates) — but `normalizeDeal()` drops
  `parcelNum` and other raw fields before this comparison is even
  possible, so "identical after normalization" does not prove "the same
  real-world transaction." No action was taken to deduplicate these.
- **94 groups** contain rows that differ in some field — e.g. the first
  one found: id `65209683-2007-07-30-930000-97.5` maps to two real
  transactions, "זאב ליבר 9" and "זאב ליבר 7" — same date/price/rooms/area,
  different buildings. These are almost certainly distinct real
  transactions the id scheme cannot disambiguate, not acquisition
  duplicates.

**Tested whether `street`+`houseNumber` would fix it (cheap, high-value
check before recommending it):** adding both to the id for the 94
differing groups resolves 73 of them — but **21 still collide**, all on
one entity (65209703), because those specific raw rows have `street="0"`
(a placeholder) and `houseNumber=null`. So `street`+`houseNumber` alone is
an incomplete fix. `audit/wave0g10/...` already names
`parcelNum + dealDate + dealAmount` as the best-evidenced transaction key,
and separately notes `parcelNum` is absent from the canonical `Deal`
schema — but it is **not** absent from the underlying `ShadowDeal` shadow
corpus this candidate was built from (`ShadowDeal` already carries
`parcelNum`; `build-v2-launch-candidate.ts`'s `toPureDeal()` is what
strips it via its 19-field `DEAL_FIELDS` projection). A real fix would
most likely need to combine both signals, not choose one — a decision for
a future, separately-authorized wave, not this one.

**Decision: no deduplication or workaround was attempted.** Silently
dropping the 116 rows would violate the "import exactly 59,305 deals"
requirement and would discard real, distinct transactions for 94 of the
103 groups. Modifying `lib/dealNormalization.ts`'s id-generation logic is
a foundational, reused-everywhere change explicitly out of this wave's
scope. STOP was the only in-charter option, and both preview tables
remaining at 0 rows means there is nothing to roll back.

## Post-import gates — NOT_ATTEMPTED (correctly gated behind the import)

Row reconciliation, entity reconciliation, digest match, null
reconciliation, known-case checks, pagination/getStats/getAllDeals/
getDealsByNeighborhood, exact-building/street lookup, comparable-selection
smoke, valuation smoke, leads/auth isolation, final access re-verification,
and performance checks were all not attempted — none can produce a
meaningful result against empty tables.

`scripts/__tests__/l1PreviewValuationSmoke.test.ts` (new, committed) was
built and its plumbing was verified: it wraps the real, unmodified
`SupabaseStore`/`valuate()`/`resolveAndValuate()` via a `Proxy` on
`createClient` that transparently redirects `.from("deals")`/
`.from("neighborhoods")` to the `_v2_preview` tables — no application code
was changed. Run once against the still-empty tables
(`L1_PREVIEW_SMOKE=1 npx vitest run scripts/__tests__/l1PreviewValuationSmoke.test.ts`),
all 5 assertions correctly failed on 0-row data (not on wrong-table
reads — confirming the redirect hits the empty preview tables rather
than production's populated ones). This test is real, reusable
infrastructure for the next resume: once the id-collision blocker is
resolved and import succeeds, re-running it with no changes should pass.
It is gated behind `L1_PREVIEW_SMOKE=1` so it never runs in (and never
breaks) the normal `npx vitest run`.

## What's needed to unblock the rest of L1

A decision on `lib/dealNormalization.ts`'s `Deal.id` scheme, most likely
incorporating `parcelNum` (available in the shadow corpus but currently
stripped before the final `Deal` shape) alongside `street`+`houseNumber`
(covers 73/94 of the differing groups alone, but not all). This is a
cross-cutting change affecting the id format used by every prior wave's
artifacts and production itself — it needs its own authorized wave, not a
decision made inside L1.

Once a corrected candidate exists (regenerated via
`build-v2-launch-candidate.ts` with a fixed id scheme, producing a new SHA
to freeze), `scripts/l1-import-v2-preview.ts` is ready to run as-is — its
pre-import validation, batching, and reconciliation logic all passed ECC
review this session.

## Production safety (unaffected)

```
ORIGINAL_TABLES_CHANGED = NO
LEADS_CHANGED           = NO
PRODUCTION_ENV_CHANGED  = NO
PRODUCTION_DEPLOYED     = NO
PREVIEW_TABLES_ROWS     = 0 / 0 (neighborhoods / deals) — nothing was ever written
LEGACY data/deals.json  = unchanged (SHA verified above)
```

## Tests / quality gates

```
npx tsc --noEmit   -> clean
npx vitest run     -> 32 files, 392 tests passing, 5 skipped (the gated live-preview smoke test)
npm run build      -> compiled successfully, 25 routes generated
```

## Security

- No credential value was ever printed, logged, or written anywhere this
  session — only variable NAMES were checked for presence, matching every
  prior session in this engagement.
- `SECRET_EXPOSURE = NO`.
- `audit/launch/backups/` (real production row dumps from the prior
  session) remains `.gitignore`'d; confirmed absent from `git status`.

## ECC review (5 reviewers dispatched across 2 rounds this session)

- **planner** — confirmed STOP (not a dedup workaround or a surrogate-key
  change) is the only in-charter option; confirmed the root-cause framing
  is accurate and, per `audit/wave0g10/...`, actually understated (this
  was a pre-registered risk, not a surprise); recommended citing
  `parcelNum` alongside `street`+`houseNumber` in the fix
  recommendation — applied; recommended checking whether
  `street`+`houseNumber` alone actually resolves the 94 differing groups
  — run, found 21/94 still collide, incorporated into this report.
- **database-reviewer** — reviewed the import script's batching/fail-closed
  design as sound and safe to re-run later; found the UPDATE-grant probe
  didn't verify a row actually matched — fixed with a `.select()` count
  assertion.
- **silent-failure-hunter** — independently found the same UPDATE-probe gap
  and, separately, that the original validation loop stopped at the first
  violation found, potentially hiding other defect categories — both
  already fixed by the time of the second run in this session, which
  scanned the full 59,305 rows and confirmed no other defect category
  exists.
- **security-reviewer**, **code-reviewer** — not re-dispatched this round;
  the new files follow the same patterns (env loading, error handling,
  no logged secrets) already reviewed clean in the prior session, and no
  new credential-handling surface was introduced.

## Commit

New files this session: `scripts/l1-verify-preview-tables.ts`,
`scripts/l1-import-v2-preview.ts`,
`scripts/__tests__/l1PreviewValuationSmoke.test.ts`, this report. Never
committed: any credential, DB dumps, the 59,305-row V2 candidate file
(already local-only since L0).
