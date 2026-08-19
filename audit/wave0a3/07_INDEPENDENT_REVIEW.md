# Wave 0A-3 — Independent Adversarial Review (07)

**Reviewer role:** fresh-context, read-only. Only this file was written; no code/data modified.
**Code HEAD:** `bbcfada` · **Wave baseline:** `79fc25c` · **Valuation baseline:** `0d9459f`
**Review date:** 2026-08-20

---

## Meta-finding (read first): the wave's verification docs do not exist

The task framed this as reviewing docs `00_BASELINE … 06_WAVE1_DECISION` in `audit/wave0a3/`.
**None of those files exist.** `git status` shows `?? audit/wave0a3/` (untracked) and `git ls-files
audit/wave0a3/` returns nothing — the directory was empty except for this review. Therefore
challenges that ask "does the doc overstate X?" cannot be answered against a doc. I ruled each
challenge against the **actual code and data** instead, and treat the missing deliverables as the
headline gap: Wave 0A-3 shipped a sound one-line code fix but produced **no written verification
artifact** for the production/schema/store/E2E/determinism claims it is credited with.

Independent command checks (all pass):
- `npm test` → **51 passed** (8 files). ✔
- `npx tsc --noEmit` → exit **0**, clean. ✔
- `git diff 0d9459f HEAD -- lib/valuation.ts` → **empty** (valuation math untouched). ✔

---

## Findings table

| # | Challenge | Ruling | Evidence |
|---|-----------|--------|----------|
| 1 | Production facts asserted as VERIFIED? | **UPHELD (vacuously) + GAP** | No doc asserts anything — docs absent. Code has no Vercel/Supabase prod access anywhere. No overreach *because nothing was written*. The proper state of every prod-env/prod-schema fact is UNKNOWN, and that is trivially satisfied. |
| 2 | Supabase schema missing columns → conditional outage? | **UPHELD — CRITICAL, correctly CONDITIONAL** | `supabase/schema.sql:38-55` defines only 16 `leads` columns. `SupabaseStore.insertLead` inserts the whole object (`store.ts:236`). `app/api/lead/route.ts:134-161` sets 10 absent columns to explicit values. See analysis below. Prod schema genuinely UNKNOWN → CONDITIONAL is the only honest ruling. |
| 3 | Local E2E exercised real boundaries; no overclaim? | **PARTIALLY UPHELD / claim OVERSTATED if presented as full browser E2E** | Server-authoritative + OTP-gate properties are proven by **integration tests** (`lead.gate.test.ts`, `lead.valuation.test.ts`): 401 without proof (`:145-147`), 200 with proof, client `estimateLow=1/estimateHigh=999999999` ignored, server value persisted (`:83-89`). BUT the specific "saved lead used SERVER valuation 2425000-2516000" numbers are a **fixture in `notify.test.ts:20-29`**, not a persisted artifact — `data/leads.json` newest entry is dated **2026-06-11**, no Aug-20 E2E lead exists. |
| 4 | Provider mocks weaken the OTP security check? | **WRONG (mock does not bypass gate) — gate genuinely exercised** | OTP gate is cryptographic and provider-independent. With Twilio Verify off, `otp/send/route.ts:50-51` signs the real code into the token; `verifyToken` (`otp.ts:85`) rejects `otp !== inputCode`. `lead/route.ts:93-98` independently re-checks the HMAC `lead_proof` HttpOnly cookie. Empty provider env only flips the `sent` boolean. |
| 5 | Option B still emits misleading output anywhere? | **UPHELD (fix is correct)** | `git diff 79fc25c HEAD -- lib/notify.ts` + tests confirm: null valuation → no "הנה דוח השווי שביקשת", no `₪…` price (`notify.test.ts:63`), agent gets "נדרשת בדיקה ידנית" flag (`notify.ts:35`). `fmtNis(null)="—"` (`:11`) → no NaN/₪0. `appendToSheet` null path writes **empty strings** (`:143-144`), not fabricated numbers — acceptable. |
| 6 | display==recompute parity + govmap caveat honest? | **CAVEAT HONEST / demonstration artifact ABSENT** | Same `valuate()` seam used server-side; client outputs never read (`route.ts:118-161`). Determinism caveat is legitimate: `valuationService.ts:53-57` calls external `resolvePoint()` **only** when `houseNumber && streetName` present → nondeterministic geocode; coarse input stays deterministic. But the claimed "3 identical /api/valuation runs" evidence exists in **no artifact** in this wave. |
| 7 | Wave 1 scope: no `phone UNIQUE`, no premature Redis/queues/Sentry? | **CANNOT REVIEW (doc absent) — independent check supports the constraint** | `06_WAVE1_DECISION.md` does not exist. Independently: current schema has **no** unique constraint on `leads.phone` (`schema.sql:38-55`), and `optOutByPhone` loops over *all* matching rows (`store.ts:160-166`) — both consistent with "one person, many properties". Any Wave 1 proposal adding `phone UNIQUE` would be WRONG; none can be confirmed either way. |
| 8 | PII: full phone logged, reported not fixed? | **UPHELD** | `app/api/otp/send/route.ts:56` `console.log(\`[OTP] phone=${phone} …\`)` logs the full MSISDN in cleartext on every send, prod included (no env guard). Still present at HEAD — correctly out-of-scope for this wave, but real. |

---

## Detail — Challenge 2 (the CRITICAL one)

`schema.sql` `leads` columns: `id, createdAt, name, phone, email, address, neighborhood,
propertyType, rooms, areaSqm, plotSqm, estimateLow, estimateHigh, source, consent, status`.

The `Lead` object built in `route.ts:134-161` and inserted verbatim (`store.ts:236`,
`.insert(lead)`) sets these columns **that do not exist in schema.sql**, each to an explicit
value (not `undefined`, so each key is sent in the PostgREST payload):

`floor, houseNumber, sellTiming, consentReport, consentMarketing, alertOptIn,
consentWordingVersion, consentAt, optOutAt, lastAlertAt` — **10 columns on the insert path.**

The remaining two in the flagged list — `tabuStatus, tabuNotes` — are not written by
`insertLead` (undefined → dropped by JSON) but **are** written by `updateTabuStatus`
(`store.ts:265-270`), so they fail on the admin-update path instead. Both are genuinely
absent from schema.sql. The finding is if anything **understated by one**: `tabuOrderedAt`
(`store.ts:269`, `types.ts:174`) is also absent from the schema.

**Would `insertLead` fail if prod matches schema.sql?** Yes. PostgREST validates every payload
key against its schema cache; an unknown column returns `PGRST204` ("Could not find the 'X'
column … in the schema cache"), even when the value is `null`. `insertLead` does `if (error)
throw error` (`store.ts:237`), the route catches it and returns **500 `save_failed`**
(`route.ts:166-168`). Net effect **if** production == schema.sql: every post-OTP lead is lost.

**Is CONDITIONAL correct?** Yes, and it is the *only* defensible ruling. The wave has no
production DB access, so whether prod was migrated past schema.sql is **UNKNOWN**. The mismatch
against the committed artifact is a definite fact; the production impact is conditional on that
unknown. Asserting a definite outage would itself be the overreach challenge #1 warns against.

---

## HIGH / CRITICAL issues

- **CRITICAL (conditional):** `leads` schema drift — committed `schema.sql` is missing ≥12
  (actually 13) columns the app writes. If prod mirrors the committed schema, all lead inserts
  fail closed. Resolution requires the one production fact this wave could not obtain: the live
  `leads` column set. Recommend a read-only `information_schema.columns` check before any
  go-live sign-off, plus committing a forward migration so the artifact stops lying.
- **HIGH (process):** Wave 0A-3's verification deliverables (`00`–`06`) are absent. The wave's
  substantive claims (prod facts, store parity, E2E, determinism, Wave 1 plan) are
  **unverifiable from repository artifacts**. Only the notify.ts code change and its tests are real.
- **MEDIUM (PII, pre-existing):** full phone number logged at `otp/send/route.ts:56`.

## What is genuinely solid

- The single code change (Option B notify formatter) is correct, well-tested, and removes the
  misleading "here's your report / fabricated price" output. `notify.test.ts` (4 tests) passes.
- Server-authoritative valuation and the OTP→lead cryptographic gate are real and hold under
  provider neutralization — proven by integration tests, not just assertion.
- Valuation math is untouched (empty diff vs `0d9459f`); full suite green; types clean.

---

## Verdict

**The one code change is trustworthy; the "verification wave" around it is largely unwritten.**
No production fact is overstated — but only vacuously, because no verification document exists to
overstate it. The Supabase schema mismatch is **real against the committed artifact and correctly
characterized as CONDITIONAL** (production reality UNKNOWN); it is the top risk and slightly
understated (13 missing columns, not 12). The E2E/determinism numeric evidence should not be
cited as proven — those numbers trace to a unit-test fixture, with no reproducible artifact in
this wave. Recommend: (1) commit the real 00–06 docs or stop crediting their claims, (2) obtain
the live `leads` column set to collapse the CONDITIONAL, (3) scrub the phone-number log line.
