# WAVE 0G-12 — SHADOW REBUILD V2: BOUNDED 3-ENTITY PILOT

Bounded pilot only. No canonical rebuild, no Supabase writes, no importer
run, no deployment, no valuation/UI changes. `data/deals.json` remains
frozen throughout (verified before/after — Phase 19).

## Reconciling latest evidence (before implementing anything)

Read directly from committed evidence, not conversational memory:

```
PAGINATION_DEPTH_PREVIOUSLY_PROVEN=
  fetch_number 1→2 proven for BOTH נוף הטיילת and רסקו (Wave 0G-10,
  audit/wave0g10/PAGINATION_DEPTH_AND_TRANSACTION_IDENTITY.md line 168:
  "FETCH_NUMBER_DEPTH=A — 1→2 ONLY PROVEN"). fetch_number 3+ is NOT proven
  for either entity — a reproducible login wall blocks it (confirmed on a
  second independent entity in the Wave 0G-10 addendum, commit fd4e7b6).
  Additionally, for נוף הטיילת ONLY, an ascending-sort surface was proven
  (Wave 0G-9) as a third independent acquisition window.

TOTAL_FETCH_CONTRACT_PREVIOUSLY_PROVEN=
  PARTIAL. `data.total_fetch` is a genuine, stable response field (line
  169: "TOTAL_FETCH_MATCHES_OBSERVED_WINDOWS=PARTIAL") — proven to exist
  and be internally consistent across repeated fetches for one entity, but
  NOT proven to exhaustively match real acquisition-window count beyond
  what was actually tested (fetch 1-2 only).

PARCELNUM_SEMANTICS_PREVIOUSLY_PROVEN=
  YES, with a caveat. Line 250: "PARCELNUM_SEMANTICS=PROPERTY_UNIT_ID" for
  subparceled rows, proven via the prevDeals-nesting mechanism. Line
  272 caveat: "-0" subparcel rows are ambiguous (PARCEL_ID or
  COMPOSITE_CADASTRAL_ID, not confidently PROPERTY_UNIT_ID).

TRANSACTION_DEDUP_KEY_PREVIOUSLY_PROVEN=
  NOT fully proven — best-evidenced only. Line 334:
  "BEST_OBSERVED_KEY = parcelNum + dealDate + dealAmount" with an explicit
  scope caveat (line 344+) softened from the wave's own initial "PROVEN"
  language after ECC review: zero collisions observed across ~1,362
  transactions in 2 neighborhoods, NOT proven citywide.
```

Per instruction, this pilot does NOT extrapolate fetch_number 3+ and does
NOT treat parcelNum alone as a transaction id anywhere in its code.

## ECC — targeted, all 6 completed

| ECC_REVIEWER | VERDICT | KEY_FINDING |
|---|---|---|
| planner | CONFIRMED (3 minor concerns, addressed) | Fetch-depth bound confirmed even stricter than the header comment claimed (hardcoded `>=2`, not a true caller-configurable depth) — comment corrected. 2 out-of-scope Entity-C probe datasets (אבו שדיד, גבע) were retained on disk beyond the sanctioned 3 entities — deleted. The בן ציון probe (1st candidate tested) crashed before writing any artifact (the bug that was then found and fixed) — disclosed below rather than glossed over. |
| specialist (code-explorer) | CONFIRMED, zero discrepancies | Independently re-derived every row count (1276/1000/108), the 224-collision arithmetic, all 7 Ben Ami 41 (parcelNum,date,price) triples, and confirmed `decodeRequestEnvelope()` is character-for-character identical to the prior inline pattern it replaced. |
| database-reviewer (lead) | CONFIRMED honest scoping; 1 latent edge case (fixed) | Verified the module correctly implements Wave 0G-10's finding and never reintroduces parcelNum-alone dedup anywhere. Found a latent (never-triggered) edge case: a row with both null parcelNum AND empty dealDate could theoretically collide with another such row at the same price — fixed with a `hasDate` flag and diagnostic counts (`nullParcelNumCount`/`emptyDealDateCount`), though the true worst case (both null/empty AND same price) is an honestly-documented residual limit, not solved. |
| silent-failure-hunter | 1 no-risk confirm, 3 concerns (2 fixed, 1 residual) | Entity-failure discard confirmed correct (a later exchange's identity failure discards the WHOLE entity, not just that exchange). Found and **fixed**: (a) a path-traversal gap in `assertSafeShadowOutputPath` (regex/substring matching didn't resolve `../` segments) — now resolves against `process.cwd()` first; (b) the pagination click-loop's stop condition was a timing heuristic, not a synchronization guarantee, so a race could in principle trigger an unproven fetch_number=3+ request that nothing downstream would catch — now the script fails the entire acquisition loudly if `fetch_number > 2` is ever observed, regardless of cause. Residual, disclosed: silent normalize-drop count was invisible before this wave's fix — now surfaced as `normalizationDrops` in every summary (0 in all 3 pilot entities, confirmed). |
| security-reviewer | PASS (5/5) | No credential values anywhere — not even field names reach the persisted output (stricter than required). Fail-fast path guard confirmed to run before any network I/O. No login/auth UI interaction, no fabricated fetch_number, no manual POST construction. Spot-checked both large output files (24k/30k lines) for `sk`/`token`/`exp` — zero matches. |
| code-reviewer | WARNING → addressed | Independently found the SAME path-traversal gap as silent-failure-hunter (now fixed) and one LOW finding: `dealNormalization.ts`'s extraction quietly changed `settlement: SETTLEMENT` (hardcoded) to `settlement: n.settlement` (parameter) without documenting it as a second intentional deviation — docstring corrected. All other checks (extraction fidelity, resource cleanup, dead code) PASS. |

Every finding above marked "fixed" was applied before this report was
finalized; full test suite (292/292), typecheck, and build were re-run
clean after all fixes (Phase 20).

## Graphify — blast radius (existing graph, read-only)

The cached `graphify-out/graph.json` predates this wave's new modules
(`lib/shadowRebuild.ts`, `lib/dealNormalization.ts`, this wave's additions
to `lib/nadlanCatalog.ts`/`lib/nadlanAcquisition.ts` don't appear in it) —
not rebuilt, per instruction ("do not rebuild unless genuinely unusable");
instead supplemented with a direct source grep for accuracy:

```
DISCOVERY_NODES=lib/nadlanCatalog.ts (getOfficialNetanyaEntities), lib/neighborhoodDiscovery.ts
ACQUISITION_NODES=lib/nadlanAcquisition.ts (buildDirectNeighborhoodUrl, assertDirectIdAcquisitionIdentity, decodeRequestEnvelope — new this wave)
PAGINATION_NODES=lib/shadowRebuild.ts (parsePaginationContract), scripts/audit-wave0g12-shadow-acquire.ts (click-loop, capped at fetch_number<=2)
NORMALIZATION_NODES=lib/dealNormalization.ts (normalizeDeal, extracted from scripts/harvest.ts this wave), lib/shadowRebuild.ts (toShadowDeal, dedupByTransactionKey)
MODEL_NODES=lib/types.ts (Deal, Neighborhood — UNCHANGED this wave), lib/shadowRebuild.ts (ShadowDeal — additive, extends Deal, never used by production code)
CANONICAL_WRITE_NODES=scripts/harvest.ts main() (untouched this wave — still the only writer of data/deals.json/neighborhoods.json)
SUPABASE_IMPORT_NODES=scripts/harvest.ts main()'s DATA_SOURCE=supabase branch (untouched, unreferenced by any file this wave touched)
VALUATION_DEPENDENCY_NODES=lib/valuation.ts, lib/store.ts, lib/valuationService.ts, lib/marketData.ts, lib/alerts.ts, lib/importBootstrap.ts
  (grep-confirmed: these are the only production consumers of Deal.dealNature/.propertyType/.neighborhoodId — none import
  lib/shadowRebuild.ts, lib/dealNormalization.ts's new location, or lib/neighborhoodDiscovery.ts; parcelNum has ZERO
  production consumers anywhere, confirming it's still absent from the canonical schema)
```

Containment confirmed: the `Deal` interface itself was never modified this
wave (only reused/extended), so every downstream valuation/UI consumer is
provably unaffected by this pilot's existence. No migration performed.

## Phase 1 — Baseline

```
BASELINE_HEAD=3518feb6da68343e0a32be5654297998bbb79d64
CANONICAL_ROWS=12642
CANONICAL_SHA256=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f
```
Matches expected exactly. `graphify-out/` pre-existing noise ignored, not
touched.

## Phase 2 — Three pilot entities

**Entity A (mandatory):** נוף הטיילת, sourceId=65210195.
**Entity B (mandatory):** רסקו, sourceId=65210248.
**Entity C:** selected via minimal live probing — the official 38-entity
catalog was fetched once (1 cheap request), then 4 ordinary-residential
candidates were probed live (1 request each) until one came in under 500:

| candidate | sourceId | total_rows | result |
|---|---|---|---|
| בן ציון | 65210244 | 1136 | too big — **and this specific probe crashed before writing any artifact**, due to a bug (see Errors below); no file for it exists on disk |
| אבו שדיד | 65210245 | 3082 | too big (artifact deleted post-review — out of pilot scope) |
| גבע | 65210246 | 1550 | too big (artifact deleted post-review — out of pilot scope) |
| **נווה שלום** | **65210247** | **108** | **selected — Entity C** |

```
ENTITY_C_NAME=נווה שלום (Neve Shalom)
ENTITY_C_SOURCE_ID=65210247
ENTITY_C_TOTAL_ROWS=108
```

## Phase 3 — Reusable shadow harvest path

Built as importable, tested library code — NOT copy-pasted logic:

- `lib/shadowRebuild.ts` (new): `ShadowDeal` type (extends `Deal` with
  `sourceId`/`parcelNum`/`rawDealNature` — additive, never touches the
  shared `Deal` interface), `toShadowDeal()` (wraps the SAME
  `normalizeDeal()` production harvest.ts now also uses), `parsePaginationContract()`,
  `dedupByTransactionKey()`/`transactionKey()`, `assertSafeShadowOutputPath()`.
- `lib/dealNormalization.ts` (new): `normalizeDeal()`/`decodeDealData()`
  and helpers, extracted from `scripts/harvest.ts`'s previously-inline
  implementation — `scripts/harvest.ts` now imports from here too, so
  production and shadow share the identical normalization code, not two
  copies.
- `lib/nadlanAcquisition.ts` (modified): added `decodeRequestEnvelope()`,
  extracted from a pattern that had been independently duplicated inline
  in 3 prior audit scripts (Wave 0G-9 continuation/sort probes, Wave 0G-10
  fetch-depth probe) — now centralized, one implementation.
- `scripts/audit-wave0g12-shadow-acquire.ts` (new): the live acquisition
  driver, reusing all of the above plus `buildDirectNeighborhoodUrl()`/
  `assertDirectIdAcquisitionIdentity()` from `lib/nadlanAcquisition.ts`.

Shadow output location: `audit/wave0g12/shadow/` (raw, uncommitted per
Phase 23). No code path in any of the above touches `data/deals.json`,
`data/neighborhoods.json`, or Supabase.

## Phase 4 — Identity fails closed

Every one of the 6 live acquisitions this wave ran (A, B, C, plus 3 Entity-C
candidate probes) validated 100% via `assertDirectIdAcquisitionIdentity()`
on every exchange:

| entity | REQUESTED_SOURCE_ID | OBSERVED_SOURCE_IDS | IDENTITY_MATCH |
|---|---|---|---|
| Nof Hatayelet | 65210195 | {65210195} | YES (3/3 exchanges, 1500/1500 rows) |
| Rasko | 65210248 | {65210248} | YES (2/2 exchanges, 1000/1000 rows) |
| Neve Shalom | 65210247 | {65210247} | YES (1/1 exchange, 108/108 rows) |

No mixed-entity batch was ever encountered live this wave. The fail-closed
behavior itself was exercised only via unit tests (inherited from Wave
0G-8's `assertDirectIdAcquisitionIdentity` test suite), not a live failure
this wave — no entity actually failed identity during acquisition.

## Phase 5 — Runtime pagination contract

Read live from each entity's first response (never hardcoded):

| SOURCE_ID | TOTAL_ROWS | TOTAL_FETCH | INITIAL_FETCH_NUMBER |
|---|---|---|---|
| 65210195 | 1276 | 3 | 1 |
| 65210248 | 2012 | 5 | 1 |
| 65210247 | 108 | 1 | 1 |

For Rasko, `total_fetch=5` implies 5 acquisition windows exist — but this
pilot's evidence only proves windows 1-2 safe (Phase reconciliation above).
Per instruction, the script does **not** attempt to reach fetch 3-5 for
Rasko: `PAGINATION_DEPTH_NOT_YET_PROVEN` applies, and Entity B is reported
PARTIAL (Phase 8), not padded to look complete.

## Phase 6 — Nof Hatayelet full shadow

```
REPORTED_TOTAL_ROWS=1276
REPORTED_TOTAL_FETCH=3
FETCH_NUMBERS_USED=[1, 2] (descending) + ascending-sort surface (proven Wave 0G-9)
RAW_FETCHED_ROWS=1500
OVERLAP_ROWS=224 (collisions collapsed by the shared dedup key)
UNIQUE_TRANSACTION_ROWS=1276
EARLIEST_DATE=1998-06-30
LATEST_DATE=2026-05-16
```

`UNIQUE_TRANSACTION_ROWS (1276) == REPORTED_TOTAL_ROWS (1276)`.
**ENTITY_A_COMPLETENESS=PASS.**

## Phase 7 — Ben Ami 41 acceptance

```
BEN_AMI_41_ROWS=101
```

A major finding: 101 total historical transactions exist for this address
across the full 1276-row union — not just the 7 previously known (Wave
0G-4). All 7 confirmed present, exact match on (parcelNum, date, price):

```
KNOWN_ROWS_EXPECTED=7
KNOWN_ROWS_FOUND=7
```

| parcelNum | date | price | raw dealNature |
|---|---|---|---|
| 8252-156-59 | 2024-11-15 | 280,000 | דירת נופש |
| 8252-156-58 | 2023-06-21 | 925,000 | דירת נופש |
| 8252-156-57 | 2023-05-11 | 680,000 | דירת נופש |
| 8252-156-56 | 2023-04-20 | 975,000 | דירת נופש |
| 8252-156-60 | 2022-06-08 | 232,000 | דירת נופש |
| 8252-156-55 | 2022-05-29 | 460,000 | דירת נופש |
| 8252-156-54 | 2022-02-23 | 718,000 | **ללא תיכנון** |

The 7th row's raw dealNature (`ללא תיכנון`) differs from what Wave 0G-4
originally captured (`דירת נופש`) — a genuine data-drift on the source site
between snapshots, already noted in Wave 0G-10, reconfirmed here.

```
RAW_DEAL_NATURE_VALUES (across all 101 Ben Ami 41 rows)=
  דירת נופש, ללא תיכנון, דירה בבית קומות, מלונאות, תחנת דלק
```

Five distinct raw values preserved exactly as returned — none flattened to
a single normalized category. `דירת נופש` survives.

## Phase 8 — Rasko full shadow

```
REPORTED_TOTAL_ROWS=2012
REPORTED_TOTAL_FETCH=5
FETCH_NUMBERS_USED=[1, 2]
RAW_FETCHED_ROWS=1000
OVERLAP_ROWS=0
UNIQUE_TRANSACTION_ROWS=1000
EARLIEST_DATE=2016-09-07
LATEST_DATE=2026-06-15
```

`UNIQUE_TRANSACTION_ROWS (1000) != REPORTED_TOTAL_ROWS (2012)`.

```
ENTITY_B_COMPLETENESS=PARTIAL
BLOCKER=fetch_number 3+ is blocked by a reproducible, site-native login
  wall (proven on this exact entity in Wave 0G-10, and independently
  re-confirmed on a second entity in the Wave 0G-10 addendum) — no
  legitimate acquisition mechanism to reach the remaining 1012 rows
  (windows 3-5) is currently proven safe. This pilot does not attempt to
  authenticate or bypass the wall.
```

## Phase 9 — Entity C full shadow

```
REPORTED_TOTAL_ROWS=108
REPORTED_TOTAL_FETCH=1
FETCH_NUMBERS_USED=[1]
UNIQUE_TRANSACTION_ROWS=108
```

`UNIQUE_TRANSACTION_ROWS (108) == REPORTED_TOTAL_ROWS (108)`.
**ENTITY_C_COMPLETENESS=PASS** — trivially, a genuinely single-window
entity, confirmed via runtime metadata (`total_fetch=1`), not assumed from
the row count alone.

## Phase 10 — Transaction identity (hard gate)

```
PARCELNUM_SEMANTICS=PROPERTY/UNIT identity for subparceled rows (Wave
  0G-10 finding, reused not re-derived) — NOT transaction identity.
  Ambiguous (parcel/share-level) for "-0" subparcel rows.
OFFICIAL_TRANSACTION_ID_FIELD=NONE EXISTS (confirmed again this wave —
  the raw item schema captured across all 3 entities has no dealId/
  transactionId/dealNumber/objectId field)
```

No true stable transaction id exists. Per instruction, the safest proven
composite is used: `parcelNum + dealDate + dealAmount` (Wave 0G-10's
best-evidenced key, reused unchanged). It satisfies both required
properties on the tested data:
1. Collapses identical transactions from overlapping acquisition windows
   (Phase 6: 224 real collisions collapsed for Nof Hatayelet).
2. Preserves legitimate repeat sales of the same property — proven via
   unit test using Wave 0G-10's real historical example (not re-exercised
   live this wave; see Phase 11 honesty note).

## Phase 11 — Dedup key proof

Full comparison table: `audit/wave0g12/dedup_key_analysis.csv`.

| entity | dataset | candidate key | raw | unique | collisions |
|---|---|---|---|---|---|
| Nof Hatayelet | live acquisition (3 overlapping windows) | parcelNum+dealDate+dealAmount | 1500 | 1276 | 224 |
| Nof Hatayelet | post-dedup re-test | parcelNum only | 1276 | 1276 | 0 |
| Rasko | live acquisition (2 windows) | parcelNum+dealDate+dealAmount | 1000 | 1000 | 0 |
| Neve Shalom | live acquisition (1 window) | parcelNum+dealDate+dealAmount | 108 | 108 | 0 |

Acceptance criteria:
- **Duplicates from overlapping fetch windows collapse**: YES — 224/1500
  Nof Hatayelet rows were exact re-fetches from the descending/ascending
  overlap, correctly collapsed.
- **Resulting count reconciles with official total_rows**: YES for Entity
  A and C (exact match); Entity B correctly does NOT reconcile and is
  reported PARTIAL rather than forced to match.
- **No known legitimate repeat sales lost**: honestly qualified — **not
  exercised against live data this wave**, because this pilot's
  acquisition (like every prior harvest, including the original canonical
  importer) reads only top-level `items[]` and does not flatten nested
  `prevDeals`. Wave 0G-10 already proved top-level rows never repeat a
  parcelNum, so this pilot's live data legitimately contains ZERO
  repeat-sale pairs to test against (confirmed: 0 parcelNum repeats among
  1276/1000/108 unique rows in each entity respectively). The
  repeat-sale-preservation guarantee is proven via unit test only
  (`lib/__tests__/shadowRebuild.test.ts` TEST G, using Wave 0G-10's real
  parcelNum 8247-229-80 example: a 2013 sale and a 2026 sale of the same
  unit, both preserved as distinct rows).

**TRANSACTION_SAFE_DEDUP=PASS** (on the scope actually tested; citywide
and prevDeals-inclusive scope remain unproven, disclosed not hidden).

## Phase 12 — Raw + normalized contract

Both raw and normalized semantics preserved side by side in every
`ShadowDeal` row (`lib/shadowRebuild.ts`):
- `dealNature` (base `Deal` field, unchanged raw string) AND
  `rawDealNature` (explicit shadow-only duplicate, for clarity) both carry
  the exact raw value — e.g. `דירת נופש` for Ben Ami 41.
- `propertyType` (derived: `apartment`) coexists, never overwrites either.
- `parcelNum`, `sourceId` — raw identifiers, never fabricated.
- `address`/`street`/`houseNumber` — parsed from the raw `address` string,
  original raw `address` also retained verbatim.

## Phase 13 — Shadow vs canonical comparison (read-only)

Matched by CONTENT (dealDate + price + areaSqm), independent of the old
`neighborhoodId` domain, per instruction. Full table:
`audit/wave0g12/canonical_comparison.csv`.

| entity | shadow rows | canonical matches | shadow-only | match rate |
|---|---|---|---|---|
| Nof Hatayelet | 1276 | 0 | 1276 | 0.0% |
| Rasko | 1000 | 479 | 521 | 47.9% |
| Neve Shalom | 108 | 0 | 108 | 0.0% |

**Classification:**
- **Nof Hatayelet & Neve Shalom (0% match) — newly recovered historical
  transactions.** Both entities' `sourceId`s were never in the old
  GovMap-based discovery's id space (a 21-entity space proven in Wave 0G-7
  to have ZERO overlap with nadlan's own 38-entity catalog). Every row is
  genuinely new to this project's data, not a duplicate needing
  reconciliation.
- **Rasko (47.9% match) — a genuinely new finding this wave.** A 10-row
  spot-check of "matched" rows found them to be TRUE matches (identical
  street + house number), but filed in canonical data under a **different
  neighborhood label** — `מרכז העיר צפון` (neighborhoodId `66239254`), not
  `רסקו`. This means the OLD system's street-by-street harvest for `מרכז
  העיר צפון` (`STREET_MODE_NEIGHBORHOODS` in scripts/harvest.ts)
  geographically overlaps Rasko's official polygon and already captured
  roughly half of it — under the wrong name. The remaining 521 shadow-only
  rows are NOT primarily a stale-snapshot effect: only 1 of 521 postdates
  canonical's own overall latest date, so most are streets within Rasko's
  true boundary the old street-index simply never listed.

No canonical or shadow data was modified by this comparison.

## Phase 14 — Address quality

| entity | valid street | valid house# | street="0" | missing house | has parcelNum | has raw dealNature |
|---|---|---|---|---|---|---|
| Nof Hatayelet | 93.1% | 93.1% | 6.9% | 6.9% | 100.0% | 94.3% |
| Rasko | 86.4% | 86.4% | 13.6% | 13.6% | 100.0% | 80.8% |
| Neve Shalom | 85.2% | 85.2% | 14.8% | 14.8% | 100.0% | 96.3% |
| **Canonical (all 12,642 rows)** | — | — | **20.6%** | — | **0.0%** (field doesn't exist) | — |

Shadow data's street="0" rate (6.9-14.8%) is notably lower than canonical's
own overall rate (20.6%) — not because canonical was "cleaned" (it wasn't
touched), but because this pilot's 3 entities happen to have better source
address data. `parcelNum` is captured on 100% of shadow rows, a field
canonical has never had.

## Phase 15 — Completeness scorecard

Full table: `audit/wave0g12/entity_scorecard.csv`.

| ENTITY | SOURCE_ID | OFFICIAL_TOTAL_ROWS | SHADOW_UNIQUE_ROWS | DELTA | COMPLETE |
|---|---|---|---|---|---|
| Nof Hatayelet | 65210195 | 1276 | 1276 | 0 | **YES** |
| Rasko | 65210248 | 2012 | 1000 | 1012 | **NO** (proven source-contract limitation: login wall) |
| Neve Shalom | 65210247 | 108 | 108 | 0 | **YES** |

2 of 3 entities PASS with DELTA=0. The one non-zero delta is a proven,
disclosed, source-contract limitation exactly as the wave's own PASS
criterion allows ("unless a clearly proven source-contract limitation is
encountered").

## Phase 16 — Shadow output safety

```
CAN_WRITE_CANONICAL=NO
CAN_WRITE_SUPABASE=NO
```

Enforced by `assertSafeShadowOutputPath()`, called before every write in
`scripts/audit-wave0g12-shadow-acquire.ts` (both the `.json` and
`_summary.json` targets, individually guarded — see ECC fixes). Tests:
`lib/__tests__/shadowRebuild.test.ts` TEST E/F, including a path-traversal
regression test added after ECC review.

## Phase 17 — Tests

All 11 items covered:

| item | coverage |
|---|---|
| A. sourceId survives catalog→acquisition | `shadowRebuild.test.ts` TEST I ("carries parcelNum and sourceId through unchanged") + live proof (Phase 4 table) |
| B. no autocomplete/name re-resolution | `shadowAcquireScript.test.ts` TEST B (source-text: no `.fill()`, no GovMap/TldSearch in executable code) |
| C. wrong response entity fails closed | `shadowAcquireScript.test.ts` TEST C + `nadlanAcquisition.test.ts` (shared helper's existing Phase 11 suite) |
| D. runtime total_rows/total_fetch parsed correctly | `shadowRebuild.test.ts` TEST D (including the fetch_number-is-NOT-a-response-field regression) |
| E. shadow output cannot target canonical | `shadowRebuild.test.ts` TEST E (+ traversal hardening test) |
| F. shadow mode cannot write Supabase | `shadowRebuild.test.ts` TEST F |
| G. dedup preserves repeat sales | `shadowRebuild.test.ts` TEST G |
| H. dedup collapses true duplicates | `shadowRebuild.test.ts` TEST H |
| I. raw dealNature survives normalization | `shadowRebuild.test.ts` TEST I + `dealNormalization.test.ts` |
| J. single-fetch entity completes correctly | live proof: Entity C, Phase 9 |
| K. multi-fetch entity completes exactly or fails honestly | live proof: Entity A (completes exactly), Entity B (fails honestly as PARTIAL) |

## Phase 18 — Performance (measured only, not optimized)

| entity | network requests | elapsed seconds |
|---|---|---|
| Nof Hatayelet | 3 | 49.0 |
| Rasko | 2 | 99.0 |
| Neve Shalom | 1 | 7.4 |
| (Entity C candidate probes: בן ציון, אבו שדיד, גבע) | 1 each | ~7.4-7.7 each |

Rasko's 99s for only 2 requests (vs Nof Hatayelet's 49s for 3) reflects the
"הבא" click-loop needing more clicks to reach fetch_number=2 (rowsPerPage
differs slightly by entity) — not optimized, per instruction.

## Phase 19 — Canonical immutability

```
data/deals.json rows=12642 (unchanged)
SHA-256=18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f (unchanged)
SUPABASE_WRITES=0
IMPORTER_RUNS=0
CHECKPOINT_WRITES=0
DEPLOYMENTS=0
```

## Phase 20 — Quality gates

```
Focused tests: 292 total across all lib/__tests__ (up from 233 at Wave
  0G-11's close) — includes 21 shadowRebuild.test.ts, 12
  shadowAcquireScript.test.ts, 8 dealNormalization.test.ts, and 3 new
  decodeRequestEnvelope tests in nadlanAcquisition.test.ts
Full suite: 292/292 PASS (25 files)
Typecheck: clean (npx tsc --noEmit, zero output)
Build: SUCCESS (npm run build, all 25 routes)
```

Re-run clean AFTER all ECC-driven fixes were applied (not before).

## Phase 21 — Graphify review

See "Graphify — blast radius" section above.

## Phase 22 — ECC final review

See "ECC — targeted, all 6 completed" table above. Critical questions:

1. **Does any code silently fall back to GovMap?** NO —
   `shadowAcquireScript.test.ts` asserts no GovMap/TldSearch reference in
   executable code; `assertDirectIdAcquisitionIdentity` is the only
   targeting mechanism.
2. **Does any code silently fall back to name search?** NO — no `.fill()`
   or autocomplete interaction anywhere in the acquisition script.
3. **Can entity mismatches pass?** NO — fail-closed identity check on
   every exchange, confirmed by specialist's independent trace.
4. **Can pagination stop early [and be reported as complete]?** NO — Rasko
   stopped at fetch 2/5 and is explicitly labeled PARTIAL with a named
   blocker, not silently treated as done.
5. **Can repeat sales be deleted by dedup?** Not observed to happen (0
   real repeat-sale pairs existed in the tested live data), and proven not
   to happen synthetically (unit test) — disclosed as untested against
   live prevDeals-inclusive data.
6. **Can shadow code write canonical/Supabase?** NO — enforced by
   `assertSafeShadowOutputPath()`, now hardened against path traversal.
7. **Is raw dealNature preserved?** YES — confirmed for all 101 Ben Ami 41
   rows across 5 distinct raw values.

## Constraints / honesty notes

- Entity C selection required 4 live probes (בן ציון, אבו שדיד, גבע, נווה
  שלום), not the theoretical minimum of 1 — this is because `total_rows`
  is only knowable after the first live fetch; no cheaper signal exists.
  ECC planner confirmed this proportionate, not excessive.
- The בן ציון probe (first candidate tried) crashed with a `ReferenceError`
  bug before writing any artifact — the exact bug (`firstContract` declared
  in a block scope it was later referenced outside of) that led to the
  `decodeRequestEnvelope()` extraction and fetch_number source-vs-response
  fix. No output file for that probe exists; this is disclosed rather than
  implied to have succeeded silently.
- Two out-of-scope Entity-C candidate datasets (אבו שדיד, גבע — full
  500-row acquisitions, retained on disk after their probes) were deleted
  post-ECC-review, since they fall outside this pilot's sanctioned 3
  entities and Phase 23 disallows retaining large out-of-scope acquisition
  dumps.
- The repeat-sale-preservation guarantee (Phase 10/11) is proven via unit
  test with real historical data, but NOT exercised against this pilot's
  own live acquisition, because no genuine repeat-sale pair exists at the
  top level in any of the 3 tested entities (matches, does not newly
  re-derive, the Wave 0G-10 finding).
- The best-evidenced dedup key (`parcelNum + dealDate + dealAmount`)
  remains unproven citywide and untested against prevDeals-flattened data
  — this pilot did not attempt to close either gap, per its bounded scope.
