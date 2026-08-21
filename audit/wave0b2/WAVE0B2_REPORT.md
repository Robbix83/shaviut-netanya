# Wave 0B-2 — Supabase Bootstrap Import Closure

## Verdict
**PASS.** The one-time bootstrap import of `neighborhoods.json` + `deals.json` into the new Supabase project completed with full source↔remote parity, leads isolated at 0, and source files unchanged. This closure is read-only reconciliation only — no import rerun, no `--write`, no live DB mutation.

## Scope
Storage migration of the current local market dataset into the empty Supabase project `sddtjsojbdxtakpwpqlz`. Only `public.neighborhoods` and `public.deals` were written. Explicitly excluded: `data/leads.json` and all other local artifacts (renewal/CBS/POI/street-index/debug/harvest). No data cleaning, dedup, or enrichment.

## Source Dataset (independently recomputed at closure)
| Metric | Value |
|--------|-------|
| neighborhoods | 21 (distinct IDs 21) |
| deals | 12,642 (distinct IDs 12,642) |
| duplicate Deal IDs | 0 |
| orphan deals (neighborhoodId ∉ neighborhoods) | 0 |
| propertyType | apartment 11,951 · house 391 · land 300 |
| dealDate min/max | 1998-02-06 / 2026-06-08 |
| null stats | rooms 300 · areaSqm 494 · plotSqm 12,367 · floor 3,829 · yearBuilt 0 · houseNumber 2,608 · x 0 · y 0 |
| source SHA-256 (neighborhoods) | `366255233b70cd9da9b5b092fd8441b52a018fa3ddac57c36a1003f7ea493939` |
| source SHA-256 (deals) | `18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f` |

Both source hashes at closure **equal** the pre-import hashes recorded in the manifest → **source unchanged by the migration**.

## Import Safety Controls (reconfirmed from code)
- **Target host pinned**: `assertTargetProject` requires the full host `sddtjsojbdxtakpwpqlz.supabase.co` (not just the ref); rejects wrong ref/TLD and host-spoofing, before the client is created.
- **Write path**: only `upsert(sb, "neighborhoods", …)` and `upsert(sb, "deals", …)`. No other write target.
- **No leads write path**: `leads` is only read (`countRows`) in preflight/verification; no insert/upsert/update.
- **No DELETE/TRUNCATE/DROP**: none present.
- **Stable-ID upsert**: `upsert(rows, { onConflict: "id" })` on the text PKs → idempotent, retry-safe.
- **Batch size bound**: default 500; ceiling clamped to **≤500** (`parseArgs`). The run used 500 (26 batches: 25×500 + 142).
- **Source guards before write**: SHA-256 of both files + `validateSource` (unique IDs, 0 orphans, propertyType∈{apartment,house,land}, parseable dealDate).
- **Preflight for initial write**: requires `neighborhoods=0, deals=0, leads=0` (`checkPreflight`); any `leads>0` always stops.
- **Post-import verification**: read-only (`countRows` HEAD counts + paginated `selectAll`) → canonical digest compare.
- **Secrets**: service-role key read from env only, never logged; all error output runs through `redactSecrets`; the manifest contains only ref/SHAs/counts/timestamps/digests/parity — no key/URL/headers.

## Dry-Run History
1. Dry-run #1 — stopped at remote preflight with a truncated `count(neighborhoods) failed`, followed by a Windows libuv `UV_HANDLE_CLOSING` assertion.
2. Dry-run #2 — same truncated `count(neighborhoods) failed | message=`, while independent evidence (direct REST `CONTENT_RANGE=*/0`; standalone `supabase-js` `COUNT=0, ERROR=null`) proved the environment/key/grants/RLS/SDK were all good.
3. Dry-run #3 (after the zero-safe fix) — **PASS**: `remote before: neighborhoods=0, deals=0, leads=0` · `DRY-RUN complete — NO writes performed.`

## Proven Findings vs Diagnostic/Hardening Changes
**Proven (evidence-backed):**
- The earlier preflight count step failed and, in dry-run #1, an abrupt `process.exit()` participated in a Windows/libuv teardown assertion that truncated the error output.
- Direct REST returned table status 200 with `Content-Range: */0`; the installed `supabase-js@2.106.2` `count` call returned `count=0, error=null` — environment/key/grants/RLS/SDK verified good.
- After the zero-safe preflight fix, dry-run #3 passed.
- The independent importer safety review passed with no HIGH/CRITICAL.
- `--write` was executed **exactly once**; the final source↔remote parity passed (counts + canonical digests).

**Diagnostic / hardening changes (NOT conclusively proven as the single root cause):**
- `interpretCountResult` (explicit `count===0` handling) + switching preflight counts to sequential — the committed fix that immediately preceded the passing dry-run. Treated as the **most likely** corrective change; the exact failing intermediate condition (an error object with an empty message) was destroyed by the earlier crash and not independently reproduced.
- `createClient` option alignment (`autoRefreshToken:false`) and `select("*")` count shape — **alignment/hardening** to match the verified-good SDK call; **possible contributing factors**, root cause **not independently proven**.
- `process.exit()` removal + `Promise.allSettled`/sequential counts — fixed the libuv teardown crash (real), a **separate** issue from the count-value handling.

**Unsupported root-cause claims avoided: YES** — no single change is asserted as *the* proven root cause beyond the evidence above.

## Independent Safety Review
Fresh-context review of the importer: **no HIGH, no CRITICAL findings.** Its two recommendations (pin full host; crash-safe resume manifest) were applied. Both absolute invariants (target-ref/host pin, no-lead-import) and the canonical-digest normalizer were confirmed sound for this dataset.

## Write Execution
- Command executed by the operator **exactly once**: `npx tsx scripts/import-supabase-bootstrap.ts --write`.
- **No rerun occurred during this closure.** No `--write` and no `--resume` were run here.
- Manifest: `audit/wave0b2/MIGRATION_MANIFEST.json` — `status: "complete"`, `startTime 2026-08-21T18:46:17Z`, `endTime …:21Z`, `rowsWritten 12663` (21 + 12,642), 26 batches all `ok`.

## Post-Import Reconciliation
Credentials exist only in the operator's PowerShell session, so this closure did **not** issue any live DB query. Remote figures below are the importer's own read-back verification recorded in the manifest, **independently corroborated** by recomputing the local canonical digests at closure and confirming they equal the manifest's **remote** digests (same canonical/projected semantics the importer used — not redefined).

| Check | Local (recomputed now) | Manifest remote | Result |
|-------|------------------------|-----------------|--------|
| neighborhoods count | 21 | 21 | ✅ |
| deals count | 12,642 | 12,642 | ✅ |
| leads count | (never imported) | 0 | ✅ |
| neighborhoods digest | `2a07966f3765c80d` | `2a07966f3765c80d` | ✅ |
| deals digest | `d8e688b4faf3a3d3` | `d8e688b4faf3a3d3` | ✅ |

## Data Integrity
- distinct neighborhood IDs = 21; distinct deal IDs = 12,642.
- orphan deals referencing a missing neighborhood = 0.
- propertyType parity: apartment 11,951 · house 391 · land 300 (digest-covered).
- dealDate range parity: 1998-02-06 → 2026-06-08 (digest-covered).
- projected-column null parity: covered by the full-column canonical digest match (a single differing cell would flip the digest).

## Leads Isolation
`public.leads` was never written by the importer (no code path inserts/upserts leads); `data/leads.json` was never read. Manifest `remoteFinal.leads = 0`; preflight would hard-stop on any `leads>0`. **Remote leads = 0.**

## Security / Secret Handling
No secret is present in source, the manifest, the audit docs, or Git-tracked config. The service-role key is read from env only and never logged; error paths are secret-redacted. `.env*`/`data/leads.json` remain gitignored and untracked.

## Reproducibility Note
The live Supabase `service_role` privileges were **manually reduced** after bootstrap to exactly `SELECT, INSERT, UPDATE` (no DELETE). `supabase/bootstrap_v1.sql` grants those same three privileges, but a fresh run may not reproduce the exact live state unless it first `REVOKE ALL PRIVILEGES … ON <table> FROM service_role` before granting (to clear any default/implicit grants). **This is out of scope for Wave 0B-2 import closure and must not trigger any live DB mutation here** — recorded as the recommended next micro-wave only.

## Verification Gate
- tests: **104 passed** (10 files) — includes importer safeguards, zero-safe count, batch-size bound, parity normalizer.
- typecheck: `tsc --noEmit` **clean**.
- build: `next build` **exit 0**.
- `lib/valuation.ts`: byte-identical to the original baseline (unchanged across all waves).

## Git / Commit
- HEAD before closure: `15fbcf0`.
- Closure commit: see final response (importer batch-bound hardening + closure docs).
- Pushed: **NO**.

## Deferred Items
1. Bootstrap reproducibility housekeeping (the `REVOKE ALL … then GRANT SELECT/INSERT/UPDATE` micro-wave) — SQL-only, no live mutation.
2. Pre-existing, out of scope: OTP-send phone PII logging; notification delivery visibility; lead idempotency (Wave 1).

## Final Conclusion
Wave 0B-2 is **complete and verified**. The bootstrap dataset (21 neighborhoods, 12,642 deals) is faithfully reproduced in `sddtjsojbdxtakpwpqlz` with full canonical-digest parity; `leads` remains 0; the source is unmodified; the importer enforces target-host pinning, source/preflight guards, stable-ID upserts, ≤500 batches, read-only verification, and no lead/DELETE/TRUNCATE path; and no secrets are persisted. Import executed exactly once; no rerun during closure.
