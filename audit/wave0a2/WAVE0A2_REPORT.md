# WAVE 0A-2 REPORT — Production Fail-Closed & Server-Owned Valuation Integrity

**Project:** shaviut-netanya.co.il · **Workspace:** C:\leads
**Date:** 2026-08-20 · **Mode:** surgical, test-first, LOCAL ONLY, not deployed, not pushed, **no valuation-math change**.

---

## 1. Starting HEAD
`cad9e3683b9e44dd7ec2a49e8e165ddbccb7852d` (`docs: wave 0a1 build-fix and final report`)

## 2. Ending HEAD
`29ec06d` (`fix: make lead valuation server-authoritative`) — plus this docs commit.

## 3. Files changed
**New:** `lib/config.ts`, `lib/valuationService.ts`, `lib/__tests__/config.test.ts`, `lib/__tests__/valuation.fixture.test.ts`, `app/api/lead/__tests__/lead.valuation.test.ts`, `app/api/dev/save-streets/__tests__/devroute.test.ts`.
**Modified:** `lib/store.ts`, `app/api/webhook/green/route.ts`, `app/api/valuation/route.ts`, `app/api/lead/route.ts`, `components/ValuationWizard.tsx`, `app/api/lead/__tests__/lead.gate.test.ts`.
**Unchanged (verified):** `lib/valuation.ts` (byte-identical, hash `eda487155c0645c6`), `app/api/dev/save-streets/route.ts` (already 403 in prod).
Independent review confirmed **no scope creep** — only the declared files + tests.

## 4. Tests before / after
- Before: 26 passed (3 files). After: **47 passed (7 files)** — +9 config, +2 valuation fixtures, +8 valuation-trust, +1 dev-route, +existing 26 (gate test updated).
- `tsc --noEmit` clean. `next build` exit 0.

## 5. DATA_SOURCE behavior
`resolveDataSource(env)` (`lib/config.ts`), called at request runtime in `getStore()` (not import):
- production + missing → **throws** (fail closed). production + `local` → **throws**. production + `supabase` → ok.
- **Build-phase exemption:** `NEXT_PHASE==="phase-production-build"` skips enforcement so local `next build` (which prerenders `/` and reads the store) is not broken; real prod builds run with `DATA_SOURCE=supabase` anyway. Review confirmed the exemption **cannot leak into request serving** (`next start`/serving never sets `NEXT_PHASE`).
- development/test → defaults `local`.

## 6. ADMIN_EMAIL behavior
Unchanged from Wave 0A-1 (fail-closed `isAdminAuthorized` seam). Not duplicated. Existing `lib/__tests__/adminAuth.test.ts` already covers: prod + missing → deny-all; matching → allow; non-matching → deny.

## 7. GREEN_WEBHOOK_TOKEN behavior
`isWebhookAuthorized({expected, provided, isProduction})` (`lib/config.ts`), used in `app/api/webhook/green/route.ts` before any work:
- production + no token → **401** (was fail-open). wrong token → 401. correct token → normal processing. dev + no token → allowed.
- Opt-out semantics (`STOP_RE`, `extractSender`, `optOutByPhone`) **byte-unchanged**; response is always `{ok:true}` → **no phone-existence leak**.

## 8. Dev-route / bypass behavior
- `/api/dev/save-streets`: already `403 disabled_in_production` before any FS write (unchanged); now covered by a test.
- `NEXT_PUBLIC_DEV_BYPASS_OTP`: server-side neutralized in Wave 0A-1; the **dead client bypass button was removed** from the wizard (net reduction in attack surface). No OTP bypass recreated.
- `ADMIN_DEV_BYPASS`: unchanged; already `NODE_ENV!=="production"`-guarded in middleware.

## 9. Old client valuation trust path (removed)
Baseline `app/api/lead/route.ts` set `estimateLow/High` from `body.valuation?.…` and forwarded the **client** `valuation` object to `notifyNewLead`. A malicious client could inject arbitrary estimates/confidence/comparables/neighborhood into the stored lead + admin + WhatsApp + Sheets.

## 10. New server-authoritative valuation path
`/api/lead` now: validates `valuationInput` (requires `neighborhoodId`) → **recomputes** via the shared `resolveAndValuate` seam (same path as `/api/valuation`) → uses **only** the server result for `estimateLow/High`, `neighborhood`, and the `notifyNewLead` payload. `body.valuation` is **never referenced**. Client sends INPUTS only; the browser is not authoritative for OUTPUTS. Both routes share one implementation (no copy-paste, no second algorithm).

## 11. Proof valuation outputs did not change (math unchanged)
- `lib/valuation.ts` **byte-identical** to baseline (`git diff` empty; hash unchanged).
- `lib/valuationService.ts` calls `valuate({…})` with the **exact same field set/order** as the old `/api/valuation` route (verbatim move of neighborhood-resolution + geocode + valuate).
- `lib/__tests__/valuation.fixture.test.ts` pins concrete outputs for 2 real inputs (אגמים, קריית השרון) captured **before** the change; they pass unchanged after.

## 12. Tampering tests (all pass)
`app/api/lead/__tests__/lead.valuation.test.ts`: client `estimateLow=1`/`estimateHigh=999999999` → server values persisted; tampered `confidence`/`comparableDeals` → server object notified; tampered `neighborhood` string → server neighborhood stored; server recompute invoked with the validated input; missing OTP → 401 before any valuation work.

## 13. Failure behavior (chosen: Option B, documented)
If OTP is valid but recompute returns `{ok:false}` (no_match/insufficient_data) **or throws**, the lead is **still saved with null estimates** and `notifyNewLead(saved, null)`. Rationale: this is a seller lead-gen product where the verified contact is the core asset, and the schema already supports null estimates (a safe lead-without-valuation state). The server **never** falls back to client values. Invalid INPUTS (missing `neighborhoodId`) are rejected 422 **before** persistence (distinct from recompute failure). Tests 6, 7a, 7b cover these.

## 14. Build results
`npm test` → 47 passed. `tsc --noEmit` → clean. `next build` → **exit 0** (the fail-closed guard does not break the build thanks to the build-phase exemption).

## 15. Security review findings
Independent fresh-context review (specialist Claude subagent): **no blocking findings, no HIGH/CRITICAL.** All nine focus questions UPHELD — (1) math unchanged, (2) client output cannot reach trusted state, (3) no silent LocalStore in prod & no build-exemption leak, (4) webhook fail-closed & no phone-existence leak, (5) dev route can't mutate prod, (6) OTP enforcement intact & correctly ordered, (7) no scope creep, (8) no secret/`NEXT_PUBLIC_*` leakage (net reduction), (9) no new PII logging (error-codes/messages only, verified in test stderr). Option-B failure behavior and input validation confirmed safe.
> The reviewer also cautiously flagged earlier harness `system-reminder` messages present in its own context as possibly-untrusted and ignored them. Those were legitimate harness messages; the over-caution is harmless and required no action.

## 16. Commits
| Hash | Message |
|------|---------|
| `bc184dd` | fix: fail closed unsafe production configuration |
| `29ec06d` | fix: make lead valuation server-authoritative |
| (this) | docs: wave 0a2 verification report |

Wave 0A-1 history not squashed. Not pushed.

## 17. Residual risks
1. **Recompute at lead time repeats the govmap geocode** (when houseNumber+streetName present) — a network dependency; on failure it falls back to Option B (lead saved, no estimate). Acceptable; a cached/point-passthrough optimization could be a later refinement.
2. **Token-level OTP replay window** (Wave 0A-1 residual) — still deferred to Wave 1.
3. **`getIP()` trusts `x-forwarded-for`** (pre-existing) — rate-limit strength depends on deployment topology. Follow-up.
4. **Home page `/` is statically prerendered from build-time data** — in a real prod deploy it bakes Supabase data at build; if a prod deploy ran with `DATA_SOURCE=local` the static marketing stats could be stale, but all dynamic routes (lead/store) still fail closed at request time.

## 18. NOT VERIFIED
- Real browser end-to-end (calc → send → verify → submit with recompute) against a running dev server — logic verified by unit/integration tests + code trace; not executed live (external providers mocked).
- Production environment (Vercel `DATA_SOURCE`, `GREEN_WEBHOOK_TOKEN`, `ADMIN_EMAIL`, `OTP_SECRET`, Supabase) — still UNKNOWN; operator must set them before any deploy.
- Real govmap geocode / Green / Sheets behavior at lead-time recompute — mocked in tests.
- Whether the displayed valuation and the lead-time recompute ever diverge materially in production (data changing between view and submit) — server result always wins by design; no live measurement.

---
**STOP CONDITION MET.** No deploy. No Wave 1. No valuation-math change. No source transaction data changed. No geocode/harvest. Returned for external review.
