# Wednesday Launch Sprint — L0: V2 Launch Candidate

**Verdict: PASS.** A deterministic, validated V2 launch-candidate dataset
(59,305 rows, exactly matching the proven-safe citywide corpus) was built
entirely offline from already-acquired Wave 0G artifacts — zero new
network requests, acquisition research frozen per the operator decision.
Legacy `data/deals.json` is untouched. No Supabase writes, no deploy, no
import executed. Two real, material findings surfaced during ECC review
and were fixed rather than merely disclosed (see Phase 5/11 and the ECC
table): the neighborhoodId ID-domain mismatch (companion
`neighborhoods-v2.json` built), and a genuine coordinate-coverage
regression (closed from 0% to 73% using the same offline mechanism the
legacy pipeline itself uses, `data/street-index.json` — zero new
acquisition).

## Phase 1 — Baseline

```
STARTING_HEAD=86edc05f80900f8ae9a95f7d459f4949e3da0eda
LEGACY_ROWS=12642
LEGACY_SHA=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
```
Verified unchanged before and after this sprint.

## Phase 2 — Exact safe-union reconstruction

Reconstructed entirely from already-committed/already-persisted Wave 0G
artifacts, zero live requests:

```
27 originally-COMPLETE entities (Wave 0G-16 baseline = final)  = 25,110
+ Kiryat Hasharon final accepted union (replayed 0G-18→0G-21)  =  5,145
+ 10 target PARTIAL entities' 0G-24B augmented unions           = 29,050
                                                                 -------
SAFE_UNION_ROWS                                                 = 59,305  ✓ exact match
```

Kiryat's reconstruction specifically replays, in order, the exact
classification chain three separate waves established (never
re-derived, never reimplemented):
1. Wave 0G-18's baseline (2,518) + 70 street results → 4,831 (asserted).
2. Wave 0G-20's 3 already-captured probe recoveries (278 new) → 5,109
   (asserted).
3. Wave 0G-21's 2 already-captured street-fetch results (36 new,
   0 ambiguous) → 5,145 (asserted).

Every intermediate total is a hard assertion in the build script
(`RECONSTRUCTION_MISMATCH` throws otherwise) — this is not a
re-derivation that happens to land on the right number, it is the
verified, exact replay.

**Nuance flagged by ECC planner review**: Wave 0G-19's own headline
conclusion was **4,851** (2,518 baseline + 4,831 street rows + 20
zero-id rows it proposed accepting) — but Wave 0G-20 explicitly reverted
that proposal (kept zero-id rejection at 21 rows still rejected) before
recovering 278 CLASS-A rows through the *unchanged* per-row policy,
landing at 5,109. This builder correctly consumes only Wave 0G-19's raw
probe *data* (the 3 already-captured street responses), never its
discarded policy conclusion — so no rejected/zero-id row entered this
candidate. Restated here because "replays 0G-18→0G-19→0G-20→0G-21" could
otherwise be misread as applying every wave's own conclusion in a
straight line, which is not what happened and not what this script does.

**Also fixed during ECC review**: the replay of Wave 0G-21's own logic
had dropped that wave's own `SHADOW_CONVERSION_DROP` safety check (a
guard added by an EARLIER ECC review, specifically for this exact
silent-drop pattern) when a `toShadowDeal()` call returns `null` for a
malformed accepted row. The hardcoded exact-count assertions (4831/5109/
5145) would still have caught a drop this run, but with an uninformative
generic error rather than pinpointing the cause. Restored in both of the
Kiryat reconstruction's conversion loops.

## Phase 3 — Transaction integrity

```
RAW_ACCEPTED_ROWS      = 59,305
UNIQUE_TRANSACTIONS    = 59,305
AMBIGUOUS_COLLISIONS   = 0        (checked CITYWIDE, across all 38 entities
                                    at once — a stronger check than each
                                    prior wave's per-entity-only version)
```

Launch gate met exactly: `UNIQUE_TRANSACTIONS=59305`,
`AMBIGUOUS_COLLISIONS=0`. No trimming was needed or performed.

## Phase 4 — Entity reconciliation (all 38 entities)

Full table: `audit/launch/entity_reconciliation.csv`. Summary:

```
SUM_OFFICIAL = 63,704
SUM_SAFE     = 59,305
SUM_DELTA    =  4,399
63,704 - 59,305 = 4,399  ✓
```

27 entities show `STATUS=COMPLETE` (`DELTA=0`, `COVERAGE=100.00%`); 11
show `STATUS=PARTIAL` (Kiryat Hasharon + the 10 Wave 0G-24B target
entities), each with `V2_SAFE_ROWS <= OFFICIAL_TOTAL`.

## Phase 5 — Application schema compatibility

| Field | Present | Required by app | Launch blocker if missing |
|---|---|---|---|
| `dealDate` | YES | YES (valuation windowing, trend buckets, `data/deals.json`'s own age) | Would be — 0 invalid dates found |
| `price` | YES | YES (`>0` filtered elsewhere; base comparable pool gate) | Would be — 0 zero/negative found |
| `propertyType` | YES | Soft (defaults to `"apartment"` via `??`) | No |
| `areaSqm` / `plotSqm` | YES | Yes for apartment/house sizing (`areaSqm`) or land (`plotSqm`) | No — nulls degrade gracefully, never crash |
| `rooms` | YES | Soft (`!= null` guarded) | No |
| `floor` | YES | Soft (`!= null` guarded) | No |
| `street` / `houseNumber` | YES (48,192/59,305 = 81.3% non-zero) | Soft on stored rows (degrades to neighborhood/city-pool comparable tier) | No |
| `dealNature` | YES | Only at normalization time (already baked into `propertyType`) | No |
| `x` / `y` | Present but **all null** in this candidate | Soft per-row, but citywide degrades radius-tier comparable search | **No** — see P2 finding below |
| entity/source identity (`neighborhoodId`) | YES, but in a **different ID domain** than the currently-committed `data/neighborhoods.json` | **YES — structural join key** | **Real finding, addressed — see below** |

**Real, material finding (not a blocker, but must not be silently
missed):** production `Deal.neighborhoodId` currently resolves against
`data/neighborhoods.json`'s 21 entries, which use an old GovMap ID
domain (e.g. `"66239255"` for אגמים). Every Wave 0G artifact — and this
V2 candidate — uses the nadlan.gov.il `sourceId` domain instead (e.g.
`"65210238"` for the same אגמים). These are genuinely different ID
spaces for the same neighborhood; a naive drop-in of `deals-v2.json`
against the CURRENT `data/neighborhoods.json` would silently break every
neighborhood-scoped join for all 38 entities.

This is **not a new problem introduced by this candidate** —
`lib/neighborhoodDiscovery.ts` (already wired into the production
`scripts/harvest.ts`, confirmed by reading it) already assigns
`Neighborhood.id = entity.sourceId` when it runs. The committed
`data/neighborhoods.json` is simply a pre-Wave-0G-11 snapshot that
predates that migration and was never regenerated (correctly — running
`harvest.ts` is exactly the forbidden production-importer action this
entire audit trail has been avoiding). This candidate follows the
codebase's own already-intended direction, not a new invention.

**Addressed this sprint**: built a companion
`data/v2-candidate/neighborhoods-v2.json` — all 38 official entities,
`id=sourceId`, resolved from the already-committed nadlan catalog
snapshot, zero new requests. `x`/`y` are `null` for all 38 (coordinates
require a per-entity live fetch not yet performed for most — acquisition
is frozen, so this is deferred, not silently dropped). Swapping in this
file alongside `deals-v2.json` is a **data-file substitution, not a code
change** — `lib/store.ts`/`lib/valuation.ts` treat `neighborhoodId` as an
opaque join key and never hardcode either ID domain.

## Phase 6 — Data quality snapshot

```
VALID_STREET_ROWS   = 48,192
STREET_ZERO_ROWS    = 11,113   (SOURCE_LIMITATION — the official registry
                                 itself doesn't expose a street for these
                                 rows; already-known citywide pattern,
                                 documented since Wave 0G-16/0G-19)
MISSING_STREET_ROWS =      0
VALID_HOUSE_ROWS    = 48,192
MISSING_HOUSE_ROWS  = 11,113   (same rows as STREET_ZERO_ROWS — a row
                                 without a street structurally has no
                                 house number either)

EARLIEST_DATE = 1998-01-01
LATEST_DATE   = 2026-07-08

ZERO_AMOUNT_ROWS    = 0
NEGATIVE_AMOUNT_ROWS = 0
INVALID_DATE_ROWS   = 0
```

Zero `DATA_CORRUPTION` found — `normalizeDeal()` already rejects
zero/negative-price rows at acquisition time (returns `null`), so their
absence here is expected, not verified-and-cleaned. The 11,113
street-zero rows are a disclosed `SOURCE_LIMITATION` (the official
registry's own gap), not something this candidate cleaned, hid, or
fabricated a value for.

## Phase 7 — V2 candidate build

```
V2_ROWS      = 59,305
V2_SHA256    = 8bb6770525894cd2053293d0c60acb877e6acd77d81bdd30c02200e5e6c34bf0
V2_FILE_SIZE = 31,885,964 bytes (~30.4 MB)

RUN1_SHA = 8bb6770525894cd2053293d0c60acb877e6acd77d81bdd30c02200e5e6c34bf0
RUN2_SHA = 8bb6770525894cd2053293d0c60acb877e6acd77d81bdd30c02200e5e6c34bf0
DETERMINISTIC_BUILD = YES
```

(This SHA reflects the coordinate-enrichment fix below — a self-caught
bug during the fix pass: an earlier version applied coordinate
enrichment only to the primary build's rows, not to the separate
determinism-check rebuild's rows, producing a spurious `DETERMINISTIC_
BUILD=NO`. Fixed by moving enrichment inside `buildUnion()` itself so
both calls apply it identically — corrected and reverified, see ECC
table.)

The determinism check re-ran the **entire reconstruction from scratch**
(not a re-serialization of cached data) — re-reading every input file
independently and re-classifying from zero. Additionally, this SHA was
reproduced identically across two **separate process invocations** of the
script (a stronger guarantee than the in-process double-build alone).
Deterministic stable sort key: `neighborhoodId|dealDate|id`.

Every row was stripped, via explicit field selection (not object spread,
and coercing an absent field to `null` rather than `undefined` — an ECC
planner finding, since `JSON.stringify` silently drops `undefined` keys),
to **exactly** the 19-key production `Deal` shape — no `sourceId`,
`parcelNum`, or `rawDealNature` leak through. (Earlier drafts of this
report and the script's own comments said "18 keys" — an ECC
database-reviewer-caught counting error; the field list itself was
always correct and exact-matched against `lib/types.ts`, only the prose
count was wrong.) `prevDeals` was never part of the top-level row shape
anywhere in this pipeline and is confirmed absent
(`PREVDEALS_INCLUDED=NO`).

**Coordinate enrichment (new this fix pass, closes a real regression —
see Phase 11):**
```
COORD_ENRICHED = 43,315 (73.0%)
COORD_MISSING  = 15,990 (27.0%)
```
Applied using `data/street-index.json` — the exact same offline,
already-committed street-name-to-coordinate lookup
`scripts/enrich-coords.ts` uses for the legacy dataset. Zero new
acquisition; not a new mechanism, reuse of an existing one.

`data/deals.json` (legacy) was never opened for writing — confirmed both
by grep (zero references in the script) and by independent SHA-256
comparison before/after (below). Note: `data/*.json` is gitignored in
this repo, so `git status` showing no change for `data/deals.json` is
**not itself proof of anything** — it reflects the file not being
tracked at all (an ECC specialist finding, correcting this report's
earlier, imprecise "verified via git status" phrasing). The actual proof
is the SHA-256 hash match, independently recomputed twice.

## Phase 8 — Manifest

`data/v2-candidate/manifest.json` — includes `candidateVersion`,
`rowCount=59305`, `sha256`, `officialTotalRows=63704`, `knownDelta=4399`,
`coverage=93.0946`, `entityCount=38`, `prevDealsIncluded=false`,
`status="LAUNCH_CANDIDATE"`, and `sourceEvidence` (head commit + the 10
contributing wave IDs + the 3 component sums). No credentials, no raw
network material.

## Phase 9 — Legacy comparison (diagnostic only)

Legacy `data/deals.json` has no `parcelNum` field at all, so exact
transaction-key matching against it is not possible. Used a best-effort
diagnostic key instead (`street|houseNumber|dealDate|price|area`):

```
LEGACY_TOTAL         = 12,642
LEGACY_FOUND_IN_V2    = 11,254  (89.0%)
LEGACY_ONLY           =  1,388  (11.0%)
V2_NEW_VS_LEGACY      = 48,051
```

Bounded sample of legacy-only rows (8 inspected): all fall in אגמים
(`neighborhoodId="66239255"` in the legacy ID domain) with dates spanning
2023–2025, plausible real transactions — not obviously corrupted. Given
legacy `data/deals.json` predates the nadlan-official-catalog acquisition
approach this entire engagement adopted (it was likely built via an
earlier, broader-search harvest method), some genuine drift between the
two datasets (rounding, re-scrape timing, a slightly different
normalization pass) is expected and not investigated further — this is
explicitly diagnostic, not a reconciliation obligation, per this phase's
own instruction. No legacy-only rows were merged into V2.

## Phase 10 — Launch regression fixture (candidate verification only)

| Case | Source rows found | Expected semantics present | Result |
|---|---|---|---|
| עובד בן עמי 41 | 101 | Multiple property types/dates on a known shared-boundary street (spans חוף הים, נוף הטיילת, etc. — consistent with prior waves' boundary-street findings) | PASS |
| רסקו (entity) | 2,012 | `STATUS=COMPLETE` (2,012/2,012, 100%) | PASS |
| קריית השרון (entity) | 5,145 | `STATUS=PARTIAL` (5,145/5,640, 91.22%) | PASS |
| One COMPLETE entity (אגמים, 65210238) | 1,804 | `DELTA=0`, `COVERAGE=100%` | PASS |
| One large PARTIAL entity (מרכז העיר, 65209717) | 7,904 | `DELTA=2,068`, `COVERAGE=79.26%`, matches Wave 0G-24B exactly | PASS |
| Normal apartment | 55,840 rows citywide | `propertyType="apartment"`, non-null `areaSqm` for the vast majority | PASS |
| House | 1,714 rows citywide | `propertyType="house"` represented | PASS |
| Land | 1,751 rows citywide | `propertyType="land"`, `areaSqm=null` (by design — land uses `plotSqm`) | PASS |

No valuation tuning performed — this is candidate data verification only.

## Phase 11 — Application compatibility verdict

```
V2_APPLICATION_COMPATIBILITY = SMALL_CHANGE_REQUIRED
```

**Required change**: alongside adopting `deals-v2.json`, replace
`data/neighborhoods.json` with the companion `neighborhoods-v2.json`
built this sprint (38 entities, sourceId-keyed). This is a **data-file
swap**, not a code change — no logic in `lib/store.ts`, `lib/valuation.ts`,
or `lib/marketData.ts` hardcodes either ID domain; they consume
`neighborhoodId` as an opaque string key throughout. No unrelated
refactor performed or needed.

**Real finding, since fixed (an ECC planner finding — previously
understated in this report's own first draft)**: legacy
`data/deals.json` has **populated `x`/`y` on all 12,642 rows** (via
`scripts/enrich-coords.ts`'s own street-index lookup). This candidate's
rows started at `x=null, y=null` for all 59,305 — which would have been
a **citywide regression from 100% to 0% coordinate coverage**, not
merely an unfilled gap, disabling `lib/valuation.ts`'s radius-tier
comparable search entirely (guarded, so non-crashing, but a real,
understated feature loss in the first draft). **Fixed** using the exact
same offline mechanism: coordinate coverage is now 73.0% (43,315/59,305
rows), reusing `data/street-index.json`, zero new acquisition.

**Still-open, disclosed, non-blocking gap**: `neighborhoods-v2.json`
(the neighborhood-CENTROID coordinates, distinct from the per-deal
street-level coordinates above) has `x=null, y=null` for all 38 entities
— a per-entity centroid lookup requires a live fetch not yet performed,
and acquisition is frozen. This affects only neighborhood-centroid-based
features, not the per-deal radius search (which now has 73% coverage via
the fix above). Classified P2 below.

```
APP_CODE_CHANGES_REQUIRED = NONE
```

## Phase 12 — L1 Supabase import plan (prepared, NOT executed)

```
PRE_IMPORT_BACKUP        = full pg_dump (or Supabase project-level backup/
                             snapshot) of the CURRENT production `deals`
                             table, taken immediately before any L1 import
                             attempt, stored outside the repo.
TARGET_TABLES            = `deals` (and `neighborhoods`, for the
                             companion ID-domain swap) — preview/staging
                             table or a clearly-namespaced parallel table
                             (e.g. `deals_v2_preview`), NEVER a direct
                             overwrite of the live `deals` table in one
                             step.
EXPECTED_V2_ROWS         = 59,305
IMPORT_METHOD            = batched upsert via the existing Supabase
                             client tooling (never a raw SQL bulk
                             replace), keyed by `id`, from the exact
                             `data/v2-candidate/deals-v2.json` whose
                             SHA-256 is pinned in `manifest.json`.
POST_IMPORT_ROW_COUNT_CHECK = `SELECT COUNT(*)` against the target table
                             must equal exactly 59,305 before promoting.
ENTITY_COUNT_CHECK       = `SELECT COUNT(DISTINCT neighborhoodId)` must
                             equal 38, and each entity's row count must
                             match `audit/launch/entity_reconciliation.csv`
                             exactly.
DIGEST_CHECK             = re-serialize the imported rows in the SAME
                             deterministic sort order this script uses
                             and compare SHA-256 against the pinned
                             manifest value — any drift means the import
                             transformed data in flight and must be
                             investigated before promotion.
RLS_CHECK                = confirm Row Level Security policies on the
                             target table match the CURRENT production
                             `deals` table's policies exactly (read-only
                             public access; no public write) before any
                             traffic is pointed at it.
SERVICE_ROLE_GRANT_CHECK = confirm only the existing service-role key
                             (already used by the current import/admin
                             paths) has write access — no new grants, no
                             broadened permissions introduced by this
                             import.
READ_SMOKE_CHECK         = run the SAME valuation smoke queries used in
                             this sprint's regression fixture (Phase 10)
                             against the imported table via the app's own
                             `SupabaseStore` path, confirm identical
                             results to the local-file candidate.
```

**No DELETE privilege regression, no production write in L0.** This
entire phase is a plan only — nothing here was executed.

## Phase 13 — Rollback (defined before any future import)

```
ROLLBACK_DATASET          = the CURRENT, already-live production `deals`
                             table (Supabase) exactly as it stands today —
                             untouched by this sprint.
ROLLBACK_BACKUP_LOCATION  = the Phase 12 pre-import backup (pg_dump/
                             snapshot), stored outside the repository, in
                             the project's existing backup location/
                             convention (not created or located by this
                             sprint — to be confirmed operationally
                             before L1 proceeds).
ROLLBACK_TRIGGER          = any of: post-import row count != 59,305;
                             entity count != 38; digest mismatch; RLS/
                             grant check failure; a read-smoke-check
                             valuation result diverging from the local
                             candidate beyond expected floating-point
                             rounding.
ROLLBACK_METHOD           = restore the pre-import backup/snapshot over
                             the target table (or, if a parallel preview
                             table was used per Phase 12, simply drop it
                             and leave the live `deals` table untouched —
                             the safer of the two import strategies, and
                             the one this plan recommends specifically
                             because it makes rollback trivial: nothing
                             live ever changes until the preview table is
                             explicitly promoted).
ROLLBACK_VERIFICATION     = re-run the Phase 12 row-count, entity-count,
                             and digest checks against the RESTORED table
                             and confirm they match the PRE-import
                             baseline exactly.
```

We can restore the current working dataset without reconstructing it
from scratch: the legacy `data/deals.json` (untouched all sprint) remains
the canonical fallback at every step, and the recommended preview-table
import strategy means the live table is never even touched until an
explicit, separate promotion decision.

## Phase 14 — Launch blockers

**P0 (cannot continue launch sprint): none.**

**P1 (must fix before Production/L1 import): none found this sprint.**
The neighborhoodId domain finding (Phase 5/11) is resolved by the
companion `neighborhoods-v2.json` already built — not an open P1.

**P2 (can ship Wednesday, fix post-launch):**
- `neighborhoods-v2.json` (neighborhood-CENTROID coordinates, distinct
  from the per-deal coordinates fixed this sprint) has null `x`/`y` for
  all 38 entities — a per-entity live fetch not yet performed; acquisition
  is frozen. Affects only neighborhood-centroid-based features, not
  per-deal radius search. Fix: a bounded, explicitly-authorized
  coordinate-discovery pass post-launch (out of scope for this frozen
  sprint).
- 15,990 rows (27.0%) have no per-deal `x`/`y` even after this sprint's
  street-index enrichment fix (their street name isn't in the 991-street
  index) — degrades radius-tier comparable search gracefully for those
  specific rows only (guarded throughout `lib/valuation.ts`); does not
  crash. The other 73.0% (43,315 rows) now have real coordinates.
- 11,113 rows (18.7% of the V2 corpus) have no street/house number
  (`SOURCE_LIMITATION`, not corruption) — already-known citywide pattern,
  degrades street/building-tier comparable selection to neighborhood/city
  pool for those specific rows only.

**P3 (research/backlog, explicitly NOT reopened this sprint):**
- The known 4,399-row citywide delta (93.09% coverage). Per this
  sprint's own explicit instruction, this is a **documented limitation**,
  not automatically P0/P1 — no evidence surfaced this sprint that it
  makes the product unsafe to launch. Acquisition research (Wave 0G-26's
  own recommended offline-routing-replay next step) remains frozen until
  after launch, per the operator decision.
- Legacy-vs-V2 diagnostic drift (Phase 9, 1,388 rows) — flagged as
  worth a closer look eventually, not a launch concern.

## Canonical safety

```
LEGACY_ROWS  = 12,642   (unchanged)
SHA_BEFORE   = 18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
SHA_AFTER    = 18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
CHANGED      = NO
```

## Windows temp-path hygiene

No hardcoded `/tmp` path was used anywhere in this sprint's new code —
the `resolveTempPath()` helper (exported from the build script, unused
in this run since no scratch file was actually needed — the build reads
only already-committed/local repo paths and writes only to
`data/v2-candidate/`) resolves via `os.tmpdir()` + `path.resolve()` and
logs the exact resolved physical path, per this sprint's own hard rule
(a direct response to the real Bash-vs-Node `/tmp` mismatch Wave 0G-26
exposed and corrected). No raw acquisition dumps were created this
sprint — nothing to clean up. Verified via `git status --short` and a
direct filesystem check that no stray temp artifact exists anywhere
outside `data/v2-candidate/` and `audit/launch/`.

## Security

Scanned all newly-tracked artifacts (2 scripts, 1 test file, this report,
1 CSV) for tokens, cookies, Authorization headers, session material,
anti-bot values, and credential fragments: none found.
`data/v2-candidate/deals-v2.json` and `neighborhoods-v2.json` (real
transaction/neighborhood data, not secrets) are kept as local
build artifacts per the file-size policy below — not committed, not
scanned for credentials since they're pure property data by construction
(same normalizeDeal() pipeline every prior wave used).

## Commit strategy

`data/v2-candidate/deals-v2.json` is ~30.4 MB — large enough that forcing
it into Git would meaningfully bloat repository history for a file that
is, by design, exactly and deterministically reproducible from committed
inputs (`RUN1_SHA == RUN2_SHA`, verified twice, across separate process
invocations). Per this sprint's own guidance, it is **kept as a local
build artifact only**; its exact SHA-256 is pinned in the committed
`manifest.json`, and running `npx tsx scripts/build-v2-launch-candidate.ts`
reproduces it byte-for-byte from the same committed inputs. The much
smaller `neighborhoods-v2.json` (38 entities, ~4.9 KB) IS committed
alongside the manifest — no size concern, and committing it makes the
companion ID-domain artifact directly usable without a rebuild.

## ECC review

Per Phase 15: planner, specialist, database-reviewer, silent-failure-
hunter, security-reviewer, code-reviewer — all 6 required for this
launch-critical sprint.

| Reviewer | Verdict | Key finding / fix |
|---|---|---|
| planner | CONFIRMED with 3 concerns, all addressed | (1) Correctly identified that legacy `data/deals.json` has 100% x/y coverage while the initial V2 draft had 0% — a genuine citywide regression, not just an unfilled gap. **Fixed**: coordinate enrichment via `data/street-index.json` (the same mechanism legacy's own `scripts/enrich-coords.ts` uses) now covers 73.0% of rows, zero new acquisition. (2) Found רסקו hardcoded `STATUS=PARTIAL` despite achieving exact 2,012/2,012 coverage, contradicting this report's own Phase 10 table. **Fixed**: status is now derived from actual achieved coverage (`rows.length === officialTotal`), not hardcoded, with the citywide `complete27EntitiesSum` figure kept correctly pinned to the original 27 via membership (not status) filtering. (3) Flagged a documentation nuance around Wave 0G-19's discarded conclusion — addressed with an explicit clarifying note in Phase 2. |
| specialist | CONFIRMED, all 7 cross-checks pass | Independently re-summed all 27 COMPLETE entities' `uniqueRows.length` from their own shadow-output files (25,110, not from any report-restated number), re-summed Wave 0G-24B's 10 `AUGMENTED_UNIQUE` values (29,050), and re-verified Kiryat's 5,145/5,640 from `attribution_summary.json` directly. One real methodology-language finding: `data/*.json` is gitignored, so `git status` showing no change for `data/deals.json`/`data/neighborhoods.json` is not itself proof — the actual proof is the independently-recomputed SHA-256 match. **Fixed**: corrected this report's phrasing throughout to cite the hash comparison as the actual evidence. |
| database-reviewer | PASS, 2 cosmetic notes | Confirmed the 3 entity buckets (27 COMPLETE / Kiryat / 10 targets) are structurally disjoint via the same manifest field, confirmed all classification-chain assertions are strict `!==` checks, confirmed determinism holds despite `Deal.id` not being provably globally-unique (JS sort stability + fully-deterministic upstream iteration order together are sufficient). Noted a comment miscounting "18 keys" as "19" (**fixed**, see Phase 7) — cosmetic, the field list itself was always exact-correct against `lib/types.ts`. |
| silent-failure-hunter | 1 real regression found and fixed, rest PASS | The Kiryat-reconstruction replay had dropped Wave 0G-21's own ECC-added `SHADOW_CONVERSION_DROP` safety check for a `toShadowDeal()` null-return. **Fixed**: restored in both conversion loops. Confirmed the citywide ambiguous-collision and duplicate-key checks are complementary and jointly exhaustive; confirmed `csvEscape` correctly handles embedded-quote entity names in actual output. |
| security-reviewer | PASS, no findings | Confirmed zero network-capable imports in the builder script, confirmed the ONLY write targets are `data/v2-candidate/` and `audit/launch/`, confirmed `data/deals.json` is never referenced for writing anywhere in the script, confirmed no credential material in any new artifact, independently re-verified canonical SHA-256/row-count via `certutil`, confirmed `deals-v2.json` is correctly kept untracked (not force-committed) with only its SHA pinned in the committed manifest. |
| code-reviewer | APPROVE, 1 LOW note | Ran the actual build live, confirmed exact line-by-line fidelity to Wave 0G-21's original Kiryat-reconstruction logic (same functions, same order, same intermediate assertions), confirmed the determinism check is genuine (no module-level caching anywhere in the classification chain that could produce spurious agreement). One LOW note: `resolveTempPath` is exported but unused in this run — acceptable given its stated rationale (reuse by a future L1 script), kept per this sprint's own Windows temp-path hygiene rule. |

**A real bug was introduced and caught during the fix pass itself**:
applying the planner's coordinate-enrichment fix only to the primary
build's rows (not the separate determinism-check rebuild's rows, since
they're independent object instances) produced a spurious
`DETERMINISTIC_BUILD=NO` on the first attempt. Fixed by moving the
enrichment logic inside `buildUnion()` so both calls apply it identically
— re-verified end-to-end (`RUN1_SHA==RUN2_SHA` again, across two full
independent process invocations), and every hard launch gate re-checked
clean after every fix (392/392 tests, typecheck clean, build clean,
`SAFE_UNION_ROWS=59305`, `AMBIGUOUS_COLLISIONS=0`).
