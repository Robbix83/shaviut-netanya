# Wednesday Launch Sprint — L1: Supabase V2 Preview Import

**Verdict: PARTIAL (blocked at the operator boundary before any write).**
Phase 1 (baseline) passed cleanly. Every subsequent phase requires a live
connection to the production Supabase project, and **no such connection
is available in this environment** — this is reported honestly rather
than fabricated, exactly per this engagement's standing rule against
inventing results when blocked.

## Phase 1 — Baseline (PASS)

```
STARTING_HEAD = b84d27e74be9c676146780d93c3416a2e8334f49
```
Confirmed L0 commit present (`b84d27e`). Legacy canonical unchanged:
```
LEGACY_ROWS = 12,642
LEGACY_SHA  = 18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
```
V2 candidate unchanged:
```
V2_ROWS = 59,305
V2_SHA  = 8bb6770525894cd2053293d0c60acb877e6acd77d81bdd30c02200e5e6c34bf0
```
Both digests match exactly what L0 produced. No STOP condition triggered
at this phase.

## Phase 2 onward — BLOCKED

Checked, in order, every way this session could reach the production
Supabase project:

1. **Environment variables** — `.env.example` documents
   `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as the
   variables `lib/store.ts`'s `SupabaseStore` requires. Neither is
   present in `.env.local` (confirmed by name-only grep — no values were
   ever inspected or would be printed). `.env.local` sets
   `DATA_SOURCE=local` — this machine is currently configured for the
   local file-based store, not Supabase, for any purpose.
2. **Supabase CLI** — not installed (`which supabase` found nothing); no
   `~/.supabase` global config; the repo's own `supabase/` directory
   contains only two static SQL files (`schema.sql`, `bootstrap_v1.sql`)
   used historically to set up the database by hand via Supabase
   Studio's SQL editor — there is no linked CLI project, no migration
   history, nothing scriptable from here.
3. **MCP Supabase connector** — a `supabase` entry exists in this user's
   global `~/.claude/mcp-configs/mcp-servers.json`, but it is an
   unconfigured template: `--project-ref=YOUR_PROJECT_REF` is the literal
   placeholder text, never filled in. It is not connected to this
   session — confirmed via `ToolSearch`, which surfaced no Supabase-
   capable tool at all (only an unrelated website-builder D1/SQLite MCP).

**Conclusion: this session has zero ability to read, back up, or write
to the production Supabase project.** Every phase from 2 onward (read
current state, backup, preview-table creation, import, reconciliation,
digest checks, read-path tests, valuation smoke, RLS/grants
verification, performance checks) is **NOT_ATTEMPTED** — not failed, not
partially done, not worked around. No row was read from or written to
any live database this session. No credential value was ever seen,
requested, or printed.

## What's needed to unblock L1

One of the following, at the operator's discretion — none of which this
session can do on its own:

1. **Add the two missing variables to `.env.local` directly** (on this
   machine, not pasted into this chat) — `NEXT_PUBLIC_SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`, sourced from the Supabase project's own
   dashboard (Settings → API). This session will never ask for or handle
   the raw values; once present in the environment, the existing
   `@supabase/supabase-js` client (already a dependency) can connect
   without any code change.
2. **Configure the MCP Supabase connector** — replace
   `YOUR_PROJECT_REF` in `~/.claude/mcp-configs/mcp-servers.json` with
   the real project reference and complete whatever auth flow that MCP
   server requires (typically an interactive login, not a pasted key) —
   then reconnect the MCP server to this session.
3. **Run the import from a different, already-connected environment** —
   if credentials exist elsewhere (e.g., a deploy pipeline, another
   machine), the deterministic `data/v2-candidate/deals-v2.json` +
   `neighborhoods-v2.json` (SHA-pinned in the committed
   `data/v2-candidate/manifest.json`) can be handed to that environment
   directly; this report's Phase 4-9 plan (preview-table names, RLS/grant
   requirements, digest-check method) still applies verbatim there.

No further action was taken this session. No preview tables were
created. No backup was attempted (nothing to back up from — Phase 3
correctly never ran). Production is untouched, exactly as it was before
this sprint began.

## Canonical / production safety (unaffected)

```
ORIGINAL_TABLES_CHANGED = NO (not reachable, not attempted)
LEADS_CHANGED           = NO (not reachable, not attempted)
PRODUCTION_ENV_CHANGED  = NO
PRODUCTION_DEPLOYED     = NO
LEGACY data/deals.json  = unchanged (SHA verified above)
```

## Tests / quality gates

No code was changed this phase (the blocker was discovered before any
implementation work began), so no new test run was needed. The full
suite, typecheck, and build were already verified clean at the end of
L0 (`b84d27e`) and remain applicable — not re-run here since nothing in
the repository changed.

## Security

No credential value was printed, logged, requested, or stored anywhere
in this session or this report — only variable NAMES were checked for
presence/absence. No tracked artifact from this phase contains any
secret material (this report is the only new file, and it is
credential-free by construction).
