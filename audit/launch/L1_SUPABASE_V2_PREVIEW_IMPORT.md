# Wednesday Launch Sprint — L1: Supabase V2 Preview Import

**Verdict: PASS.** The V2 launch candidate — regenerated in Wave 0G-L1G
with a corrected, collision-free id scheme — was imported into the
isolated `deals_v2_preview`/`neighborhoods_v2_preview` tables. Every gate
independently re-verified: row counts, entity reconciliation, a
canonical-normalization digest, data quality, the real (unmodified)
application read path, and the real (unmodified) valuation algorithm all
pass against live imported data. Production `deals`/`neighborhoods`/
`leads` are confirmed byte-for-byte/row-for-row unchanged.

## Superseded SHA — do not use for any future L1 validation

```
SUPERSEDED (blocked the import, 116 rows shared an id):
  8bb6770525894cd2053293d0c60acb877e6acd77d81bdd30c02200e5e6c34bf0

ACTIVE FROZEN CANDIDATE (Wave 0G-L1G, imported this session):
  ROWS   = 59305
  SHA256 = 1e7d066ddb145e27a645dcf3c0d0185d8a5ad2f5dbe905af7fb8102acd6f0a33
```

## Phase 0 — Baseline verification (PASS)

```
HEAD contains 5dca35a = YES
CANDIDATE_ROWS=59305 (independently recomputed, not trusted from any prior report)
DISTINCT_IDS=59305
SHA256=1e7d066ddb145e27a645dcf3c0d0185d8a5ad2f5dbe905af7fb8102acd6f0a33
IMPORT_SCRIPT_SHA_MATCH=YES (scripts/l1-import-v2-preview.ts pins the identical value)
```

## Phase 1 — Preview table state before import (PASS)

```
neighborhoods_v2_preview_EXISTS=YES  PREIMPORT_COUNT=0
deals_v2_preview_EXISTS=YES          PREIMPORT_COUNT=0
NEIGHBORHOODS_V2_PREVIEW_SCHEMA=MATCHES_EXPECTED_5_COLS
DEALS_V2_PREVIEW_SCHEMA=MATCHES_EXPECTED_19_COLS
SERVICE_ROLE_DELETE=NO (live-proven: Postgres 42501 permission denied)
ANON_ACCESS=UNPROVEN (no anon key configured in this environment — not FAILED, genuinely untestable here)
AUTHENTICATED_ACCESS=UNPROVEN (same reason)
```

Both tables confirmed empty — clean state, proceeded to import. No
synthetic INSERT probe was attempted first: with DELETE already proven
denied, an untestable stray row would have been unremovable, and the
import itself requires (and asserts) an empty starting table — so the
actual import is the live INSERT proof, fail-closed by construction.

## Phase 2 — Import execution (PASS)

```
SOURCE_SHA256=1e7d066ddb145e27a645dcf3c0d0185d8a5ad2f5dbe905af7fb8102acd6f0a33
PRE_IMPORT_VALIDATION=PASS
NEIGHBORHOODS_IMPORTED=38
SERVICE_ROLE_UPDATE_PROBE=PASS (real no-op UPDATE, 1 row matched — live proof of UPDATE capability)
DEALS_IMPORTED=59305 (bounded batches, zero partial-batch failures)
NEIGHBORHOODS_V2_PREVIEW_FINAL_COUNT=38
DEALS_V2_PREVIEW_FINAL_COUNT=59305
```

## Phase 3 — Hard reconciliation (PASS, independently re-derived)

A fresh script (not reusing the import script's own internal checks)
paginated through both tables from scratch:

```
PREVIEW_NEIGHBORHOODS=38
PREVIEW_DEALS=59305
DISTINCT_DEAL_IDS=59305
DUPLICATE_IDS=0
ENTITY_COUNT_CANDIDATE=38  ENTITY_COUNT_DB=38  ENTITY_MISMATCHES=0
ENTITY_RECONCILIATION=PASS
ROW_RECONCILIATION=PASS
```

## Phase 4 — Digest proof (PASS)

DB-returned JSON key order/shape won't reproduce the literal file SHA, so
a canonical-normalization digest was computed identically on both sides:
fixed field order (all 19 `Deal` fields), `value ?? null` normalization,
one string per row, sorted (order-independent), joined, hashed.

```
SOURCE_CANONICAL_DIGEST=ee4d02a1002402f2841294e5ce929aa4bf15accf40acb1b875a3f5a031955523
DB_CANONICAL_DIGEST=ee4d02a1002402f2841294e5ce929aa4bf15accf40acb1b875a3f5a031955523
DIGEST_MATCH=YES
```

Spot-checked 5 rows whose id contains the new `|`/`:` characters — every
one found in the DB with an exact, byte-for-byte matching id string.

## Phase 5 — Data quality (PASS)

```
ROWS_MISSING_A_FIELD=0
DB_COLUMN_SET matches the expected 19 Deal fields exactly, no extra columns
NO_PREVDEALS_COLUMN=YES
NULL_DISTRIBUTION_MATCH=YES (per-field null counts identical, source vs DB)
PROPERTY_TYPE_DISTRIBUTION_MATCH=YES (apartment=55840, land=1751, house=1714, both sides)
dealNature (Hebrew text) round-trips exactly — no encoding corruption, spot-checked
PRICE_NON_NUMERIC_ROWS=0 (no string coercion)
Neighborhood id sets match exactly, source vs DB
Kiryat Hasharon (65209683) = 5145 rows, Rasko (65210248) = 2012 rows — both match known values
```

## Phase 6 — Product read path (PASS)

Functions replicating `lib/store.ts`'s `SupabaseStore.getStats()`/
`getAllDeals()`/`getDealsByNeighborhood()` exactly (same query shape,
same pagination), pointed at the `_v2_preview` tables — no application
code or production `DATA_SOURCE` was touched.

```
getStats(): dealCount=59305, neighborhoodCount=38
getAllDeals(): 59305 rows, PAGINATION_OVER_1000_PROVEN=YES
getDealsByNeighborhood(Kiryat): 5145 rows (matches known value; proves single-neighborhood pagination past 1000)
All 3 property types present (apartment/house/land)
עובד בן עמי 41 (Ben Ami 41): 101 matching rows found
Exact-building lookup (street+houseNumber): works, sensible non-empty result
Street/address lookup: works, sensible non-empty result
```

## Phase 7 — Valuation smoke (PASS)

Ran the existing, already-committed `scripts/__tests__/l1PreviewValuationSmoke.test.ts`
(`L1_PREVIEW_SMOKE=1`) — uses a `vi.mock` on the raw `@supabase/supabase-js`
client to redirect table names only; exercises the real, completely
unmodified `lib/store.ts`/`lib/valuationService.ts`. 2 of 5 tests initially
hit vitest's default 5000ms timeout (not a functional failure — genuinely
takes longer to paginate ~60 pages over a real network connection;
independently confirmed both operations succeed via a separate script
first). Fixed with an explicit 30000ms timeout on those 2 tests — all 5
then passed, **committed** (see below).

Additional targeted cases run live (temporary script, deleted after use)
to specifically prove Phase 7's confidence/fallback requirements:

```
CASE A — exact-building match (הבשן 1, קריית השרון): confidence=high, 12 comparables, tier mix {building:1, street:1, radius:10}
CASE B — sparse/unrealistic case (9.5 rooms, nonexistent street): {ok:false, error:"insufficient_data"} — correctly refuses rather than fabricating a low-confidence answer
CASE C — land, no address (edge case): insufficient_data (address-resolution edge case, not an algorithm issue)
CASE D — land, real address (יוסף 4, קריית השרון): confidence=low, 3 comparables — correctly LOW given how little data existed, not falsely high
```

Zero changes were made to `lib/valuation.ts` or `lib/valuationService.ts` —
no blocker was found requiring an algorithm change.

**ECC planner note, recorded not acted on:** `getAllDeals()`/`getStats()`
pagination took >5s in this test's timeout, a real capacity datapoint at
today's 59,305-row scale (4.7x production's current 12,642) worth keeping
in mind for any future full-corpus read-path work, not itself a defect.

## Phase 8 — Production isolation (PASS)

```
PRODUCTION_NEIGHBORHOODS_CHANGED=NO (still 21)
PRODUCTION_DEALS_CHANGED=NO (still 12,642)
LEADS_CHANGED=NO (still 0)
PRODUCTION_ENV_CHANGED=NO (.env.local's DATA_SOURCE still "local"; this session only ever set DATA_SOURCE=supabase inside a script's own process.env at runtime)
PRODUCTION_DEPLOYED=NO
data/deals.json SHA unchanged = 18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
data/neighborhoods.json SHA unchanged = 366255233b70cd9da9b5b092fd8441b52a018fa3ddac57c36a1003f7ea493939
```

## Phase 9 — Security (PASS)

```
RLS enabled = YES (documentary, from the executed DDL)
anon access = UNPROVEN (no anon key in this environment — genuinely untestable, not FAILED)
authenticated access = UNPROVEN (same reason)
service_role SELECT = PROVEN (every read this session)
service_role INSERT = PROVEN (the import itself, 59,305 rows, zero errors)
service_role UPDATE = PROVEN (live no-op probe inside the import script, 1 row matched)
service_role DELETE = NO (live-proven denied, Postgres 42501)
SECRET_EXPOSURE = NO (ECC security-reviewer verdict: no credential value in any log, error, or file this session touched or created)
ENV_FILE_TRACKED = NO (.env.local is untracked-and-ignored; only .env.example, a template with no real values, is tracked)
```

**id primary-key enforcement (ECC planner follow-up, confirmed):**
`supabase/l1_preview_tables.sql` declares `id text primary key` on both
tables (lines 24, 32) — genuine schema-level uniqueness enforcement, not
merely an observed property of this one import's data. A duplicate id in
any batch would have thrown a unique-constraint violation and the
fail-closed import would have stopped immediately.

## Phase 10 — Quality gates (PASS)

```
npx tsc --noEmit   -> clean
npx vitest run     -> 34 files, 412 tests passing, 5 skipped (the L1 preview smoke suite, gated behind L1_PREVIEW_SMOKE=1 — correctly not run in the standard suite)
npm run build      -> compiled successfully, 25 routes generated
L1_PREVIEW_SMOKE=1 npx vitest run scripts/__tests__/l1PreviewValuationSmoke.test.ts -> 5/5 passing (run separately, against live data, per its own documented opt-in gate)
```

## ECC review (3 reviewers)

- **planner** — confirmed the Phase 1 no-probe-row reasoning is correct
  (an untestable stray row would have broken the import's own empty-table
  precondition); confirmed the Phase 4 canonical-digest methodology is
  rigorous with only benign edge cases (missing-key vs explicit-null
  collapse, which PostgREST itself can't distinguish either); confirmed
  the timeout fix is the right call (independently proven working first);
  flagged that "id" uniqueness had only been checked as observed data,
  not confirmed as a schema constraint — verified directly: it is a real
  `primary key` declaration in the DDL.
- **database-reviewer** — independently re-verified row counts (59,305/38),
  spot-checked 5 individual rows byte-for-byte including new-format ids,
  ran a full FK-orphan check across all 59,305 rows (zero orphans, all 38
  neighborhoodIds resolve), reconfirmed production tables untouched;
  noted (non-blocking) that no index exists on `price`/`rooms`/`areaSqm`
  for future filter/sort query patterns — not needed by anything this
  wave exercises.
- **security-reviewer** — `SECRET_EXPOSURE=NO`; confirmed the test-file
  diff is exactly the 2-line timeout addition with no credential-handling
  change; confirmed every throwaway verification script this session
  created was deleted and never staged/committed; confirmed `.env.local`
  was never modified this session; broad credential-pattern scan across
  every touched file found nothing.

## Commit

Changed: `scripts/__tests__/l1PreviewValuationSmoke.test.ts` (explicit
30000ms timeout on 2 tests; no other change). Updated: this report.
Never staged: `graphify-out/`, any `audit/wave0g*/shadow/` or
`shadow-output/` directory, `data/v2-candidate/deals-v2.json` (still
intentionally untracked), any backup dump, any credential, any temp/cache
file. The live Supabase writes themselves (38 neighborhoods, 59,305
deals into the preview tables) are database state, not a git change —
nothing about them appears in `git status`.
