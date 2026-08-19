# 25 — CORRECTED REMEDIATION ROADMAP

**Phase:** WAVE 0R (planning only — nothing here is implemented this phase)
**Basis:** Reconciled evidence in files 17–24, 26, 27 + independent review (28). Supersedes the wave plan in `MASTER_AUDIT_REPORT.md`, which was built on unreconciled and partly-overstated findings.

**Every item below is a PROPOSAL.** No production code, data, schema, Git, or deployment was changed in this phase.

---

## DO NOT TOUCH YET (BLOCKED pending evidence or business decision)

These are explicitly blocked; acting on them now would be destructive or unsupported:

| Blocked action | Why blocked |
|----------------|-------------|
| Delete the ~1,450–1,490 cross-neighborhood "duplicate" rows | 23_DUPLICATE_IDENTITY: 0 provably identical (no gush/helka/subparcel or source id). These are a harvest boundary-overlap artifact — fix by **single-neighborhood assignment at harvest**, not row deletion. |
| Delete the ~1,200–1,300 "distinct-unit" pairs | Legitimately different apartments sold same building/day. Hard-deletion loses real transactions. |
| Raise apartment `MIN_PPSQM` to 11,000 | Unsupported; would silently drop below-market transactions. Quantify impact via backtest first. |
| Claim any fix yields "MAPE 9–10%" or "70–80% coverage" | Leak-free V2 shows median APE ~10.4%, interval coverage ~39.6%. No evidence supports the old projections. |
| Temporal weighting of comparables | Identified as a gap (22); implementing is a valuation change — needs backtest-gated design. |
| Change percentile ranges / confidence thresholds / house composite coefficient | Valuation-behavior changes; blocked until characterization fixtures (24 #15-25) exist. |
| Full-dataset geocoding | Large data operation; validate on a sample first (Wave 3). |
| Full-city street harvest | Runtime + nadlan-cap strategy undecided (17 issue C: script imposes no cap; cause LIKELY server-side). |
| Supabase schema migration / `getStore()` refactor / `valuation.ts` rewrite | Out of scope; no evidence they are the bottleneck. |
| Phone `UNIQUE` constraint on leads | Needs business analysis (repeat enquiries are legitimate). |
| Automatic `consentAt` backfill for existing leads | No historical evidence of when/if consent was given; backfilling fabricates a legal record. |
| Production deploy | Blocked until Wave 0A gates pass. |
| Rotate any secret automatically | 18_SECRET_HYGIENE: no exposed credential; rotation unnecessary and manual-only if ever needed. |

---

## WAVE 0A — SAFETY FOUNDATION (highest priority)

### 0A-1 Fix the production build (next-auth v5 middleware)
- **WHY:** `next build` fails; nothing ships until green. **BLOCKER.**
- **EVIDENCE:** `middleware.ts:11` `TS2352`; independent review reproduced `tsc --noEmit` error. Installed `next-auth@5.0.0-beta.31` type defs (`node_modules/next-auth/index.d.ts:118-129,209-211`) prescribe the `auth((req)=>…)` wrapper.
- **FIX PATTERN:** `export default auth((req) => { /* keep ADMIN_DEV_BYPASS+NODE_ENV branch */ return NextResponse.next()/redirect as today })`. **NOT** `auth as any` (re-introduces the cast) and **NOT** bare `export { auth as middleware }` (drops the bypass branch).
- **PRECONDITION:** none.
- **TEST FIRST:** characterization gate #1 (`next build` exits 0) + #2-4 (admin auth paths).
- **FILES:** `middleware.ts`. **DATA:** none.
- **RISK:** Low — narrow, type-directed. **ROLLBACK:** revert one file (once Git exists).
- **SUCCESS METRIC:** `next build` and `tsc --noEmit` exit 0; admin routes still protected.

### 0A-2 Initialize Git with the vetted ignore
- **WHY:** No version control → no rollback for any later change. **HIGH.**
- **EVIDENCE:** `C:\leads\.git` absent; `.gitignore` already excludes `.env*.local` and `/data/*.json` (18_SECRET_HYGIENE).
- **PRECONDITION (mandatory):** add `leadssa.json` (repo root, 52 KB, **not** covered by `/data/*.json`) to `.gitignore` or move it under `/data/`; confirm no PII. Re-scan for secrets (18) immediately before first commit.
- **TEST FIRST:** `git status` shows no `.env*`, no `data/*.json`, no `leadssa.json` staged.
- **FILES:** `.gitignore`, new repo. **DATA:** none deleted.
- **RISK:** Low. **ROLLBACK:** n/a (additive).
- **SUCCESS METRIC:** clean initial commit; secrets/PII confirmed absent from tree.
- **NOTE:** Git init was prohibited in Wave 0R; it is the first action of implementation, not audit.

### 0A-3 Enforce OTP→lead server-side trust boundary
- **WHY:** `/api/lead` accepts no proof of phone ownership → forged leads + outbound WhatsApp reports to arbitrary numbers. **P1.**
- **EVIDENCE:** 20_LEAD_TRUST_BOUNDARY (findings #1, #1b). Provider-independent.
- **DESIGN:** `/api/otp/verify` issues a fresh, short-lived, **single-use**, server-verifiable "verified-phone" token (distinct from the send-token; never containing the code). `/api/lead` must present it; server checks it is valid, unexpired, unused, and bound to the **same** phone, then invalidates it. Keep it stateless-signed if DB-less is required, but include a single-use nonce store or short TTL + jti.
- **PRECONDITION:** 0A-1 (build green), 0A-2 (rollback safety).
- **TEST FIRST:** characterization gate #7 (replay), #8 (proof required), #9 (phone match) — currently `EXPECTED-TO-CHANGE`.
- **FILES:** `app/api/otp/verify/route.ts`, `app/api/lead/route.ts`, `lib/otp.ts`. **DATA:** none.
- **RISK:** Medium — touches the live funnel; must not break legitimate submissions. **ROLLBACK:** revert; funnel returns to current (permissive) behavior.
- **SUCCESS METRIC:** lead creation rejected without a valid one-time verified-phone token; legitimate end-to-end flow still succeeds.

### 0A-4 Operator env verification (no code) + fail-closed guards
- **WHY:** Two HIGH risks are conditional on unknown prod env. **HIGH.**
- **EVIDENCE:** 19_PRODUCTION_FACTS. `auth.ts:8-13` fail-open if `ADMIN_EMAIL` unset; `store.ts:12` defaults `local`.
- **ACTIONS:** (a) Operator confirms in Vercel: `ADMIN_EMAIL` set, `DATA_SOURCE=supabase`, `OTP_SECRET` strong, `NEXT_PUBLIC_DEV_BYPASS_OTP` absent/false, `ADMIN_DEV_BYPASS` absent. (b) Code: make `auth` fail-closed when `ADMIN_EMAIL` unset (deny all) and make prod throw at boot if `DATA_SOURCE` unset.
- **TEST FIRST:** gate #3 (non-admin rejected), #14 (DATA_SOURCE fail-closed).
- **FILES:** `auth.ts`, `lib/store.ts` (guard only). **DATA:** none.
- **RISK:** Low-Medium (fail-closed could lock admin out if `ADMIN_EMAIL` misconfigured — verify first). **ROLLBACK:** revert guard.
- **SUCCESS METRIC:** unset `ADMIN_EMAIL` denies all admin; unset prod `DATA_SOURCE` refuses to boot.

### 0A-5 Minimum characterization test harness
- **WHY:** Safety net so 0A-3/0A-4 and later waves don't regress silently. No test runner exists today.
- **EVIDENCE:** 24_CHARACTERIZATION_GATE; `package.json` has no `test` script.
- **SCOPE:** gate items #1-16 only (build, admin auth, OTP/lead boundary, normalizePhone, percentile fixtures, valuation snapshots). Add Vitest.
- **TEST FIRST:** n/a (this IS the tests).
- **FILES:** `package.json` (+`test` script), new `*.test.ts`, audit fixtures may seed from `audit/reconciliation/`. **DATA:** none.
- **RISK:** Low. **ROLLBACK:** delete tests.
- **SUCCESS METRIC:** `npm test` green; #7/#8/#9/#14 present as `EXPECTED-TO-CHANGE` guards.

---

## WAVE 1 — LEAD INTEGRITY & RELIABILITY
- **1-1 Server-recompute or sign valuation** (P2, 20 finding #3): stop trusting client `valuation`. Either recompute via `valuate()` at lead time, or sign the valuation when first computed and verify at lead time. TEST FIRST: fixture that a tampered `estimateMid` is rejected/overwritten. FILES: `app/api/lead/route.ts`, `app/api/valuation/route.ts`. RISK: Medium. SUCCESS: stored/notified figures always match a server computation.
- **1-2 Make notifications observable** (P3→ elevated by 26): `notify.ts` currently swallows all failures (`catch→false`), and the route's `.catch` never fires. Add structured `console.error`/logging per channel and surface a delivery flag. No retry yet. FILES: `lib/notify.ts`, `app/api/lead/route.ts`. RISK: Low. SUCCESS: a failed WhatsApp/Sheet emits a log line; store remains source of truth.
- **1-3 Local-mode write safety** (Medium, 27): only if prod might run local mode — add atomic write (temp+rename) / lock to `LocalStore.insertLead`. If prod is confirmed Supabase (0A-4), downgrade to LOW. FILES: `lib/store.ts`. RISK: Low.
- **1-4 Rate-limit `/api/otp/verify`** (P2 conditional, 20 #2b). FILES: `app/api/otp/verify/route.ts`. RISK: Low.

## WAVE 2 — DATA IDENTITY & COMPLETENESS
- **2-1 Fix cross-neighborhood double-assignment at HARVEST** (not by deletion): deterministic single-neighborhood assignment so the ~1,450–1,490 artifact rows stop being generated/duplicated. PRECONDITION: reconcile the duplicate-count method (23 vs 21 vs review: 1,437 vs 1,491) to ONE script first. DATA: harvest output only; no deletion of existing source. RISK: Medium. SUCCESS: new harvests produce one row per deal per canonical neighborhood.
- **2-2 Quantify nadlan 500-ceiling cause** (17 issue C): instrument a single-neighborhood harvest to prove server-side vs client-side cap before any full re-harvest. NOT the full harvest itself.

## WAVE 3 — COORDINATE / GEOCODING CORRECTNESS
- **3-1 Validate `geocode-deals.ts` on a 100-deal sample** against known addresses (ITM). Geo tiers (60m/350m) are currently inert because all 12,642 deals share 21 centroids (17 issue D, 22). Do NOT run full-dataset geocoding until the sample validates. SUCCESS: sample coordinates match govmap within tolerance; THEN plan full run as a separate gated step. Re-run backtest V2 after to measure real geo-tier effect — do not pre-promise a number.

## WAVE 4 — VALUATION CALIBRATION (identify-then-gate; nothing changed without backtest)
- Candidates from 22 (all currently BLOCKED for implementation): band-width inversion (radius/neighborhood narrower than building); `yearBuilt===0` sentinel dropping ~27% of comps via `ageFilter`; dead `sizeDistance` 0.45 vs live 0.4; inert house composite (plotSqm 0% for houses); `MIN_PPSQM` floor; no temporal weighting; directional under-prediction (−₪146k median, 68% under) from V2. EACH change must be proposed with a backtest-V2 delta and characterization fixtures (24 #15-25) BEFORE merge.

## WAVE 5 — OBSERVABILITY & ATTRIBUTION
- Structured per-lead attribution capture (utm_*/gclid/fbclid/referrer) — currently only free-text `source` survives (26). Add error monitoring (Sentry). No tracking added in audit phase.

## WAVE 6 — MOBILE CRO
- From 12_MOBILE_CRO (unreconciled here): remove `maximumScale:1` (WCAG), funnel friction review. Low risk, defer behind safety waves.

## WAVE 7 — ARCHITECTURE / REFACTOR
- next-auth GA upgrade when released; error boundaries; consider valuation model revision only after Wave 3 gives real coordinates. Highest-risk, last.

---

## SEQUENCING RATIONALE (changed from old MASTER)
1. Old MASTER put "data hygiene / delete duplicates" in Wave 1 — **removed/blocked**: deletion is unsafe (23).
2. Old MASTER promised coverage 53%→75-80% from geocoding — **removed**: leak-free baseline is ~40% interval coverage; the true post-geocoding number is unknown until measured (Wave 3 gate).
3. The OTP→lead trust boundary (P1) was **entirely absent** from old MASTER and is now a Wave 0A blocker.
4. Every valuation change is gated behind characterization fixtures + a backtest-V2 delta, not shipped on intuition.
