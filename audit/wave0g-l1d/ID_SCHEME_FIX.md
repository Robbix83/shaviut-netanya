# Wave 0G-L1D — Fix the citywide `Deal.id` collision defect

**Verdict: DONE.** `lib/dealNormalization.ts`'s `Deal.id` fallback formula
now reuses the already-proven `parcelNum+dealDate+dealAmount` transaction
key instead of the collision-prone `dealDate+price+area` formula. Validated
at full scale against the real 59,305-row corpus that exposed the defect
(103 distinct duplicated ids → 0), entirely offline. `data/deals.json` is
unchanged, as required. One real, unresolved downstream risk is disclosed
below rather than silently left implicit: the next production harvest run
will not recognize any of the 12,642 existing rows by their (old-format)
id, and needs its own fix before it's safe to run.

## Root cause (recap — full detail in `audit/launch/L1_SUPABASE_V2_PREVIEW_IMPORT.md`)

`normalizeDeal()`'s id fallback was `${dealDate}-${price}-${builtArea||plotArea}`.
100% of both production's 12,642 rows and the frozen V2 candidate's 59,305
rows take this fallback branch (the source never populates
`raw.keyValue`/`raw.dealId`). It collided for 116 rows (103 distinct ids)
in the larger V2 set — production's smaller set had zero collisions purely
by chance of scale, not because the scheme was sound.

## Fix

`lib/dealNormalization.ts`:
- New exported `buildTransactionIdSuffix(parcelNum, dealDate, price)` —
  byte-identical formula to `lib/shadowRebuild.ts`'s already-proven,
  already-tested `transactionKey()` (Wave 0G-10/0G-12's best-evidenced
  transaction key, with its established null-parcel sentinel and
  `hasDate` flag).
- `normalizeDeal()`'s id fallback now calls this with `raw.parcelNum`
  (type-guarded: only a `string`/`number` `raw.parcelNum` is used, anything
  else falls back to the null-parcel sentinel honestly rather than
  silently stringifying a wrong value — an ECC silent-failure-hunter
  finding, applied).

`lib/shadowRebuild.ts`:
- `transactionKey()` now delegates to the same shared function instead of
  keeping its own copy of the formula — one implementation, not two that
  could drift. Byte-identical output, confirmed by the full existing
  `shadowRebuild.test.ts` suite passing unchanged.

**Why this key, not `street`+`houseNumber`:** L1's investigation tested
this — `street`+`houseNumber` alone resolves only 73 of the 94 genuinely-
differing collision groups (21 rows have placeholder `street="0"`/
`houseNumber=null` source data). `parcelNum` resolves all of them,
confirmed directly: the two real 65209703 transactions with identical
date/price/area and no usable address have distinct parcelNums
(`9039-18-101`/`9041-12-5`).

## Validation — full scale, zero new acquisition

`scripts/validate-id-fix-wave0g-l1d.ts` reuses `build-v2-launch-candidate.ts`'s
already-proven, deterministic, offline reconstruction of the real
59,305-row union (from already-committed Wave 0G shadow-output artifacts —
`buildUnion` was exported from that script purely to enable this reuse).
It recomputes what each row's id would be under the fixed formula from the
row's own already-present `parcelNum`/`dealDate`/`price`/`neighborhoodId`
fields (never trusting the old, already-baked-in `.id`, since a code fix
doesn't retroactively change already-serialized JSON):

```
OLD_FORMULA_DISTINCT_DUPLICATED_IDS=103
NEW_FORMULA_DISTINCT_DUPLICATED_IDS=0
OLD_FORMULA_UNIQUE_TOTAL=59189
NEW_FORMULA_UNIQUE_TOTAL=59305
VALIDATION=PASS_ZERO_COLLISIONS
```

**Methodology caveat, disclosed per ECC planner:** the corpus itself was
built and integrity-checked under `transactionKey()` (`classifyTransactionGroups`,
`detectAmbiguousCollisions`), so "zero collisions under the new formula"
is partly tautological — it validly proves the new `Deal.id` inherits the
corpus's existing uniqueness invariant, and it validly reproduces the old
formula's exact 103-failure count as an honest before/after comparison,
but it is not independent falsification of the key's citywide soundness.
The independent evidence remains Wave 0G-10/0G-12's raw sampling (zero
collisions across ~1,362 tested transactions in 2 neighborhoods).

## Tests

7 new tests in `lib/__tests__/dealNormalization.test.ts` (15 total in that
file now): the real colliding case now produces distinct ids; the same
case still resolves when street/houseNumber are both unusable; two rows
with the same parcelNum/date/price still get the same id (not a
regression); the null-parcelNum sentinel path still works; `raw.keyValue`/
`raw.dealId` are still preferred when present; the `hasDate` flag reaches
through `normalizeDeal()` (a missing date never silently matches a present
one); the `${neighborhoodId}-` prefix is preserved. The last two were
added after an ECC pr-test-analyzer review found the original 5 tests
covered the fix's effect but not its `hasDate` propagation or prefix
stability explicitly.

```
npx tsc --noEmit   -> clean
npx vitest run     -> 32 files, 399 tests passing, 5 skipped (unrelated, gated live-DB test)
npm run build      -> compiled successfully, 25 routes generated
data/deals.json SHA -> unchanged (18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f)
```

## Disclosed, NOT fixed in this wave — a real downstream risk

An ECC planner finding: `scripts/harvest.ts` (the production harvester,
lines ~343/370) merges freshly-`normalizeDeal()`'d rows with
`existingDeals` loaded from `data/deals.json`, deduping by `d.id`, then
upserts to Supabase by that same id (line ~384). Every one of the 12,642
existing rows carries an OLD-format id. The **next** production harvest
run will normalize new rows under the NEW formula, fail to recognize any
existing row as "already present" (different id for the same real
transaction), and produce a duplicated local corpus / orphaned old-id rows
in Postgres.

This is a real, blocking prerequisite for the next harvest or any V2
import — but fixing `scripts/harvest.ts`'s merge/dedup logic (or running a
one-time id backfill on `data/deals.json`) is a distinct, separately-
scoped change from "fix the id scheme in dealNormalization.ts," and this
wave's charter was specifically the latter. Recorded here rather than
silently left for someone to discover the hard way.

## Scope note

This wave deliberately did NOT regenerate `data/v2-candidate/deals-v2.json`
or its frozen SHA — the prior L1 report already separated "fix the id
scheme" from "regenerate the candidate" as two distinct future steps, and
an ECC planner review confirmed keeping them separate is correct (bundling
them would mean rewriting a frozen-SHA artifact in the same wave that
changes the generator producing it — worse reviewability).

## Security / production safety

```
data/deals.json CHANGED = NO (SHA verified unchanged)
data/neighborhoods.json CHANGED = NO
Supabase written to = NO (this wave made zero network requests)
Acquisition resumed = NO (zero new fetches — validation reused already-committed artifacts)
```

## ECC review (4 reviewers)

- **planner** — confirmed the formula choice and scope are correct;
  identified the `scripts/harvest.ts` id-cutover risk (documented above,
  not fixed — out of this wave's scope); flagged the validation
  methodology's partial circularity (disclosed above); suggested deleting
  the validation script after the wave closes — not done, kept instead
  for consistency with this engagement's established pattern of retaining
  validation scripts as audit-trail evidence (see L0/L1's own kept
  scripts); `buildUnion`'s export was endorsed as low-risk.
- **typescript-reviewer** — confirmed type correctness and no regressions;
  found the new docstring substantially duplicated `transactionKey()`'s —
  trimmed to cross-reference instead of restate (applied); flagged a
  pre-existing (not introduced by this fix) minor inconsistency between
  empty-string parcelNum handling and the `nullParcelNumCount` diagnostic
  — left as-is per the reviewer's own "not a blocker" assessment.
- **silent-failure-hunter** — found `raw.parcelNum` could silently
  stringify a non-scalar (object/array) value into a wrong-but-truthy key
  — fixed with an explicit `string`/`number` type guard; confirmed the
  validation script is 100% read-only and its unexercised
  `REMAINING_COLLISIONS` branch fails loud (not silently) if ever
  triggered.
- **pr-test-analyzer** — confirmed the real production collision case is
  faithfully reproduced in tests; found 2 gaps (hasDate propagation and
  prefix stability not explicitly asserted) — both added.

## Commit

Changed: `lib/dealNormalization.ts`, `lib/shadowRebuild.ts`,
`lib/__tests__/dealNormalization.test.ts`,
`scripts/build-v2-launch-candidate.ts` (export list only). New:
`scripts/validate-id-fix-wave0g-l1d.ts`, this report. Never touched:
`data/deals.json`, `data/neighborhoods.json`, any Supabase table.
