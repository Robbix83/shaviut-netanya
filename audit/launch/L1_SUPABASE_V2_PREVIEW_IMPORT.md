# Wednesday Launch Sprint — L1: Supabase V2 Preview Import

**Verdict: PARTIAL.** Connectivity is now proven (the operator added
`NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` to `.env.local`
directly — no value was ever seen, requested, or printed by this session).
A read-only pre-import backup of all three production tables was taken and
independently verified. The mission is still blocked before any write,
now at a different, more precise point than the previous attempt: **this
session's REST-only Supabase client has no DDL execution capability**, so
the two isolated preview tables (`neighborhoods_v2_preview`,
`deals_v2_preview`) could not be created. Zero production impact.

## Resume baseline (confirmed)

```
Previous L1 report commit = c713cdf
V2 candidate: ROWS=59305, SHA256=8bb6770525894cd2053293d0c60acb877e6acd77d81bdd30c02200e5e6c34bf0
Legacy canonical: ROWS=12642, SHA256=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
```
Both digests re-verified unchanged at the end of this session.

## Phase 0 — Safe env check (PASS)

```
NEXT_PUBLIC_SUPABASE_URL_PRESENT=YES
SUPABASE_SERVICE_ROLE_KEY_PRESENT=YES
DATA_SOURCE=local
```
Checked by parsing `.env.local` for variable NAMES only; no value was ever
read into a variable that gets logged, and no value appears anywhere in
this repository, this report, or any console output produced this session.

## Phase 1 — Connection probe (PASS)

A minimal read-only probe (`.from("deals").select("id", {count:"exact",
head:true})` — the same head-count idiom already used in
`lib/store.ts:250`) against the production `deals` table returned:

```
SUPABASE_CONNECTION=PASS
PROJECT_REACHABLE=YES
CURRENT_DEALS_ROW_COUNT=12642
```

12,642 matches the known legacy row count exactly, confirming this is
genuinely the expected production project, not an empty or wrong one.

## Phase 2 — Read current Supabase state (DONE, with a capability finding)

Row counts confirmed via read-only queries:
```
deals:         12,642 rows (19 columns incl. "houseNumber")
neighborhoods: 21 rows (5 columns)
leads:         0 rows
```

**Capability probe result — this is the key finding of this session.**
`@supabase/supabase-js` talks to Supabase exclusively through PostgREST
(the REST Data API), which by design cannot execute DDL. Three ways this
session could still reach DDL were checked, and all three are closed:

1. `information_schema.tables` / `pg_catalog.pg_policies` via `.schema(...)`
   → `PGRST106` (schema not exposed to the Data API).
2. An `exec_sql`-style RPC function → `PGRST202` (no such function exists;
   none is defined anywhere in `supabase/schema.sql` or
   `supabase/bootstrap_v1.sql`).
3. A direct Postgres connection string (`DATABASE_URL`/similar) → not
   present in `.env.local`; no `pg` npm package is a dependency (only
   `@supabase/supabase-js` ^2.48.1, itself REST-only).

**Conclusion: this session can read and (once tables exist) write rows via
REST, but cannot create the preview tables itself.** This is a hard
capability boundary, not a missing-credential problem — adding more
env vars of the same kind already present would not unblock it.

A real schema-drift finding surfaced during this probe: the live `deals`
table has 19 columns (including `"houseNumber"`), while the older,
committed `supabase/schema.sql` only declares 18. `supabase/bootstrap_v1.sql`
(already committed, from an earlier wave) already documents the correct
19-column shape and explicitly calls out this exact drift in its own
comments — confirmed as the authoritative reference used below, not a new
discovery requiring any code change.

## Backup (DONE and independently verified)

`scripts/l1-backup-production.ts` (new, committed) performs a read-only
logical backup of all three production tables via paginated REST reads.
This is a row-content backup, not a physical `pg_dump` — no direct
Postgres connection is available to do the latter.

An ECC silent-failure-hunter review of the first run found a real gap: row
counts from pagination alone are not proof of completeness — a server-side
page-size cap could return a short page mid-table and look identical to
"reached the end." Fixed by adding an independent `count:"exact",
head:true` check per table *before* paginating, with a hard
`BACKUP_COUNT_MISMATCH` throw (refuses to write a partial backup) if the
two disagree. Re-run after the fix:

```
NEIGHBORHOODS_BACKUP_ROWS=21    SHA256=659d312e86ba405bce6bb56ac174845652cfd661937b48e1c8c8c68479dbed7f
DEALS_BACKUP_ROWS=12642         SHA256=8914299bec21e24a003b1fbf549bb49adf7f78f54f83915baa7ac0409677166b
LEADS_BACKUP_ROWS=0             SHA256=4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945
```
Identical to the pre-fix run — the original backup was in fact complete,
now with proof instead of an unverified assumption. Output lives in
`audit/launch/backups/` (now `.gitignore`'d — see Security below) and was
never staged or committed.

## Preview table creation (BLOCKED — the actual stopping point)

Since this session cannot execute DDL, it prepared
`supabase/l1_preview_tables.sql` (new, committed) — reviewed SQL for the
operator to run manually in Supabase Studio's SQL editor. It creates
`neighborhoods_v2_preview` and `deals_v2_preview` only; it never touches
`deals`/`neighborhoods`/`leads`.

An ECC database-reviewer + planner pass caught a real correctness issue in
the first draft: `bootstrap_v1.sql` documents that this project has
**"Automatically expose new tables" = OFF**, meaning `service_role`'s
RLS-bypass does **not** by itself grant table privileges on a
newly-created table — without explicit `GRANT`s, the eventual import
would have failed with a permissions error on the very first insert, even
though this same service-role key already reads/writes production tables
fine. Fixed by mirroring `bootstrap_v1.sql`'s exact access-control block
(`REVOKE ALL` then explicit `GRANT SELECT, INSERT, UPDATE` to
`service_role` — no `DELETE`, matching the production
`SERVICE_ROLE_DELETE=NO` posture; `REVOKE ALL` from `anon`/`authenticated`)
for both new tables.

```
NEIGHBORHOODS_V2_PREVIEW_ROWS=NOT_CREATED
DEALS_V2_PREVIEW_ROWS=NOT_CREATED
```

## Phases 5–18 (import, reconciliation, digest, read-path, valuation
smoke, RLS re-verification, performance) — NOT_ATTEMPTED

All correctly gated behind preview-table creation; none were attempted.

## What's needed to unblock the rest of L1

One of, at the operator's discretion:

1. **Run `supabase/l1_preview_tables.sql` in Supabase Studio's SQL
   editor** — the fastest path. Once the two tables exist with the
   grants applied, a resumed session can import via the same
   `@supabase/supabase-js` REST client already proven to work.
2. **Add a direct Postgres connection string** (e.g. `DATABASE_URL`) to
   `.env.local` and add the `pg` package as a dependency — would let a
   future session run DDL itself via a real SQL client, no manual Studio
   step needed for this or future waves.
3. **Configure a Supabase Management API token** (a different credential
   class from the service-role key) — would allow DDL via Supabase's
   HTTP Management API instead.

Option 1 requires no new credential of any kind and is the smallest step.

## Production safety (unaffected)

```
ORIGINAL_TABLES_CHANGED = NO
LEADS_CHANGED           = NO
PRODUCTION_ENV_CHANGED  = NO
PRODUCTION_DEPLOYED     = NO
LEGACY data/deals.json  = unchanged (SHA verified above)
```

## Tests / quality gates

```
npx tsc --noEmit   -> clean
npx vitest run     -> 32 files, 392 tests, all passing (unchanged count from L0)
npm run build      -> compiled successfully, 25 routes generated
```
Re-run after applying every ECC fix below, not just once at the start.

## Security

- No credential value was ever printed, logged, or written to any file
  this session — only variable NAMES were checked for presence.
- `audit/launch/backups/` (containing real production row data) is now
  added to `.gitignore` (previously it was untracked-but-not-ignored — a
  real accidental-`git add -A` risk an ECC security-reviewer and
  code-reviewer both flagged independently). Confirmed via `git status`
  that it no longer appears at all.
- `supabase/l1_preview_tables.sql` is static DDL with no interpolation —
  no injection surface.
- `SECRET_EXPOSURE = NO` (ECC security-reviewer verdict).

## ECC review (6 reviewers dispatched, findings applied)

- **planner** — confirmed stopping at the DDL wall is correct (no
  realistic path missed); flagged the false "never committed" claim in
  the backup script's original comment and the missing
  `service_role` GRANTs in the SQL draft; flagged this report as stale —
  all three fixed/rewritten.
- **database-reviewer** — verified column types/nullability, FK ordering,
  indexes, and RLS posture in `l1_preview_tables.sql` against
  `lib/types.ts` and `bootstrap_v1.sql`; SQL confirmed safe to hand to the
  operator after the grants fix.
- **silent-failure-hunter** — found the backup script's pagination
  termination had no independent proof of completeness; fixed with a
  count cross-check.
- **security-reviewer** — verified no secret exposure anywhere; recommended
  the `.gitignore` addition, applied.
- **code-reviewer** — confirmed the false "excluded from version control"
  comment was not actually enforced anywhere on disk; flagged a redundant
  `existsSync` check (removed); everything else clean.
- **specialist** — not separately dispatched this pass; the other five
  reviewers' scope fully covered this session's actual (narrow) change
  surface — two new scripts and a report, no import logic was written
  since Phase 4 never unblocked.

## Commit

New files this session: `scripts/l1-backup-production.ts`,
`supabase/l1_preview_tables.sql`, `.gitignore` (one new line), this report.
Never committed: `audit/launch/backups/*.json` (real production data
dumps), any credential, the 59,305-row V2 candidate file (already
established as local-only in L0).
