# WAVE 0A-3 REPORT — Production Contract Verification & Live Local E2E

**Project:** shaviut-netanya.co.il · **Workspace:** C:\leads
**Date:** 2026-08-20 · **Mode:** verify-first, non-destructive, no deploy, no production mutation.

---

## 1. Starting / ending HEAD
- Start: `79fc25c`. End: `bbcfada` (`fix: represent lead-without-valuation honestly (Option B formatter safety)`), plus this docs commit.

## 2. Production env facts
**All production env values UNKNOWN** — no authorized Vercel/Supabase access this session. `.env.local` (local only) configures Twilio Verify + `DATA_SOURCE=local`; it is **not** evidence of production. Hosting provider LIKELY Vercel (code comments), not verified. Full matrix in `01_PRODUCTION_ENV_FACTS.md`. Operator must confirm prod `DATA_SOURCE=supabase`, `ADMIN_EMAIL`, `OTP_SECRET`, `GREEN_WEBHOOK_TOKEN`, Supabase keys before deploy.

## 3. Actual Supabase schema verdict — 🔴 CRITICAL (CONDITIONAL)
Only artifact is committed `supabase/schema.sql`; **live schema UNKNOWN**. The committed `leads` table is **missing 13 columns the app writes**: `floor, houseNumber, sellTiming, consentReport, consentMarketing, consentWordingVersion, consentAt, optOutAt, alertOptIn, lastAlertAt` (10 written by `insertLead`) + `tabuStatus, tabuOrderedAt, tabuNotes` (written by `updateTabuStatus`). Since `SupabaseStore.insertLead` inserts the whole `Lead` object, **against a schema.sql-matching DB PostgREST returns PGRST204 → insert throws → route 500 `save_failed` → every post-OTP lead is lost.** Correctly **CONDITIONAL** (production reality unverifiable here). `deals` and `neighborhoods` MATCH. Detail in `02_SUPABASE_CONTRACT.md`. **This is Wave 1 precondition #0.**

## 4. LocalStore / SupabaseStore parity verdict
Not fully equivalent. Key divergences (`03_STORE_PARITY.md`): (a) `insertLead` sends columns absent from committed schema (see 3); (b) **ID format** differs (`lead_<ms>` vs UUID); (c) **`optOutByPhone`** — Supabase matches literal phone variants without normalizing the *stored* value, so non-canonical stored phones **silently miss opt-out** (local normalizes both sides); (d) **`getAllDeals`** returns only `id,neighborhoodId,x,y` on Supabase vs full deals locally; (e) **rooms-null** range handling differs; (f) LocalStore has **no write lock** (race). No changes made.

## 5. Local E2E result
**PASS** against a real local dev server, providers neutralized (no outbound; `sent:false`). Landing + wizard + valuation render + lead form all rendered with **no console/500/hydration errors**; the **dead OTP-bypass button is confirmed absent**; every `/api/*` call 200, no duplicate requests. Full matrix + verbatim evidence in `04_LOCAL_E2E.md`.

## 6. Mobile E2E result
**PASS** at 375×812 — no horizontal overflow (scrollWidth 375), CTA visible, wizard present, no console errors.

## 7. OTP full-flow result
Verified (real HTTP): send → token+devOtp; **wrong code → 422** (no cookie); **correct → 200 + HttpOnly `lead_proof`**; **lead without proof → 401**; **lead with proof → 200**. Neutralizing providers only flips the `sent` boolean — the cryptographic OTP gate (`verifyToken`/HMAC/`lead_proof`) was genuinely exercised, not bypassed.

## 8. Server valuation recompute parity
`/api/valuation` returned **identical** results across 3 repeated calls (2,425,000 / 2,498,000 / 2,516,000; scope neighborhood; 7 deals; low). Exact reproducibility on unchanged data. **Caveat (honest):** when `houseNumber+streetName` are present the recompute re-invokes govmap `resolvePoint`; two geocodes could differ and *could* shift scope/comps. A future server-issued signed valuation receipt (recorded at display, re-verified at submit) would remove recompute dependence — noted for later, **analysis only**.

## 9. Option B / null-valuation UX + notification result
Verified and **fixed** minimally (`bbcfada`): `fmtNis(null)`="—" (no NaN/₪0). Agent WhatsApp now shows an explicit **`⚠️ שווי לא חושב אוטומטית — נדרשת בדיקה ידנית`**; user WhatsApp now **acknowledges** the request (`קיבלנו את בקשתך… מכינים עבורך…`) with **no fabricated price**, instead of the previous misleading "here's the report you requested." Google Sheets writes empty estimates. Tests in `lib/__tests__/notify.test.ts`. Detail in `05_NOTIFICATION_CONTRACT.md`.

## 10. Notification reliability contract
Insert-before-notify ordering correct (lead never lost to a notification failure). **All 3 channels (agent WA, user WA, Sheets) fail silently** — no timeout, retry, delivery persistence, or operator alert (utils resolve `false`, never throw, so the route `.catch` never fires). Wave 1 candidate (delivery status/logging first, outbox later).

## 11. Actual DB constraints
From committed schema: PKs on all tables; FK `deals.neighborhoodId→neighborhoods.id`; **no unique constraints anywhere; no phone uniqueness on `leads`**; indexes only `idx_deals_neigh`, `idx_deals_date`. Live DB constraints **UNKNOWN**.

## 12. Actual RLS state
Committed schema **enables RLS** on all three tables with **no policies** → service-role-only access (anon blocked). Live RLS state **UNKNOWN**.

## 13. Recommended Wave 1 scope (`06_WAVE1_DECISION.md`)
**#0 (precondition):** reconcile production `leads` schema (operator-verified; additive migration if columns missing). **Then:** (1) lead idempotency for accidental double-submit — **input-scoped short-window, NOT `phone UNIQUE`** (one person legitimately lists multiple properties/times); (2) notification delivery visibility (logging + stored flag, no outbox); (3) PII log masking for `[OTP] phone=…` + opt-out webhook. **Deferred:** OTP durable single-use, notification outbox, serverless rate-limit infra, Redis/queues/Sentry.

## 14. Tests added
`lib/__tests__/notify.test.ts` (4 cases: agent/user messages with and without valuation). Suite 47 → **51**.

## 15. Build / test results
`npm test` → 51 passed. `tsc --noEmit` → clean. `next build` → exit 0. `lib/valuation.ts` **byte-identical** to baseline `0d9459f`.

## 16. Files changed
Code: `lib/notify.ts` (+ `lib/__tests__/notify.test.ts`). Docs: `audit/wave0a3/00–07` + this report. No production/data/schema/valuation-math changes. `data/leads.json` restored byte-identical after E2E.

## 17. Commits
| Hash | Message |
|------|---------|
| `bbcfada` | fix: represent lead-without-valuation honestly (Option B formatter safety) |
| (this) | docs: wave 0a3 verification report |

Not pushed.

## 18. Remaining UNKNOWN
- Entire production environment (Vercel env vars, active deployment, build id).
- **Live Supabase schema** — whether the `leads` table actually has the 13 columns (determines if production leads are currently failing).
- Live RLS policies / constraints.
- Real Twilio Verify / Green / Sheets behavior (mocked/neutralized).
- Address autocomplete (govmap) — not exercised (external); manual-neighborhood path used instead.
- govmap recompute nondeterminism when houseNumber+streetName present (bounded, not measured live).

## Independent review note
The fresh-context reviewer (`07_INDEPENDENT_REVIEW.md`) ran **before docs 00–06 were committed**, so its "verification docs don't exist" observation reflects that timing, not their content (they are on disk and committed with this report). Its substantive rulings are UPHELD: the Supabase mismatch is real and correctly CONDITIONAL (it counts 13 missing columns — matching this report); OTP/security properties genuinely hold; `valuation.ts` untouched; 51 tests pass; the `[OTP] phone=…` PII log is confirmed. It correctly noted the live E2E lead is not a persisted artifact (removed by the non-destructive restore); the verbatim run evidence is now recorded in `04_LOCAL_E2E.md`.

---
**STOP CONDITION MET.** No deploy, no production mutation, no DB schema change, no Wave 1 implementation, no valuation-math change, no geocode/harvest. Only the authorized minimal Option-B formatter safety was implemented. Returned for external review.
