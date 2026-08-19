# WAVE 0A-1 REPORT — Safety Foundation, Build Recovery & OTP Enforcement

**Project:** shaviut-netanya.co.il · **Workspace:** C:\leads
**Date:** 2026-08-20 · **Mode:** surgical, test-first, LOCAL ONLY, not deployed, not pushed.

---

## 1. Baseline commit hash
`0d9459fc02a9346f93d299eb73f919423595a4f5` — `baseline: pre-wave-0a1 safe snapshot` (source unmodified; only `.gitignore` hardened + audit docs).

## 2. Files changed (since baseline)
| File | Change |
|------|--------|
| `middleware.ts` | next-auth v5 wrapper fix (build) |
| `auth.ts` | `signIn` → fail-closed `isAdminAuthorized` seam |
| `lib/adminAuth.ts` | **new** — pure admin-authorization predicate |
| `lib/otp.ts` | hardened `secret()` (fail-closed prod), `signLeadProof`/`verifyLeadProof`, per-purpose HMAC keys, constant-time compare |
| `app/api/otp/verify/route.ts` | issue HttpOnly `lead_proof` cookie on success |
| `app/api/lead/route.ts` | require + verify proof before insert/notify; clear cookie after success |
| `vitest.config.ts`, `package.json`, `package-lock.json` | test harness |
| `lib/__tests__/otp.test.ts`, `lib/__tests__/adminAuth.test.ts`, `app/api/lead/__tests__/lead.gate.test.ts` | **new** tests |
| `.gitignore` | (in baseline commit) exclude root data-dumps & fullwidth-colon junk |

No file outside this set was touched (`git diff --stat` verified; independent review confirmed).

## 3. Tests added (26 total, all passing)
- `adminAuth.test.ts` (4): exact-match, **prod fail-closed when ADMIN_EMAIL unset**, dev-permissive, whitespace-trim.
- `otp.test.ts` (16): send-token valid/wrong-code/tampered/VERIFY-sentinel; lead-proof valid+normalization/no-code+purpose/missing/bad-sig/phone-mismatch/expired/malformed; **domain separation both directions**; **OTP_SECRET fail-closed in prod** (unset & dev-fallback) + dev-usable.
- `lead.gate.test.ts` (6): no-proof→401, expired→401, phoneA-proof+phoneB→401, malformed→401, valid+match→200 insert, consent-still-enforced→422.

## 4. Build before / after
- **Before:** `tsc` + `next build` FAIL — `middleware.ts(11,11): TS2352`.
- **After:** `tsc --noEmit` clean; `next build` **exit 0**, "✓ Compiled successfully", 26 pages, middleware compiled. (Pre-existing non-fatal "middleware→proxy deprecation" warning left as-is.)

## 5. Middleware / auth fix
Replaced the `(auth as …)` cast with the installed-types pattern `export default auth((req)=>{…})` (next-auth `index.d.ts:122-129,209-211`; runtime semantics confirmed in `lib/index.js:126-155`). Dev bypass preserved, guarded by `NODE_ENV!=="production"` (no prod fail-open). `auth.ts signIn` now fail-closed via `isAdminAuthorized`. Details: `02_BUILD_AUTH_FIX.md`.

## 6. OTP proof architecture
- On successful `/api/otp/verify` (any provider — Twilio Verify / Inforu / Twilio SMS / Green), the server issues a signed **`lead_proof`** = `base64url(normPhone:lead-submit:issued:expires | HMAC)`, delivered as a cookie: `HttpOnly`, `SameSite=Lax`, `Secure` in prod, `Path=/`, `Max-Age=900s`. The OTP **code is never** in the proof; the browser never reads it.
- Signing key is **domain-separated** (`keyFor("lead-proof")` vs `keyFor("otp")`), derived from `OTP_SECRET`, so a send-token can never validate as a lead-proof.
- `OTP_SECRET` **fail-closed in production** (throws at request runtime if unset or equal to the public dev fallback — never at import/build, so `next build` is unaffected).
- Client unchanged: same-origin `fetch` carries the cookie automatically. The `NEXT_PUBLIC_DEV_BYPASS_OTP` button that skipped verify is now **neutralized server-side** (its path has no proof → rejected), removing that client bypass's danger.

## 7. Exact lead rejection behavior
`POST /api/lead` reads `lead_proof`; `verifyLeadProof(proof, phone)` checks signature (constant-time), purpose=`lead-submit`, not expired, and normalized-phone match. On any failure → **HTTP 401 `{ "error": "otp_verification_required" }`**, returned **before** consent check, **before** `insertLead`, **before** `notifyNewLead`. No security detail leaked. Existing name/phone/consent/rate-limit checks unchanged.

## 8. Phone-binding verification
`normalizePhone` applied on both sign (verified phone) and verify (submitted phone) sides; `+972`/`972`/`0`/dashes converge. Proof for phone A rejected when body phone = B (`phone_mismatch`). Traced + tested (`otp.test.ts`, `lead.gate.test.ts` case 5). Independent review confirmed no normalization bypass.

## 9. Replay behavior (honest)
The proof is **HMAC-signed, phone-bound, 15-min TTL**, and the cookie is cleared after a successful submission. It is **NOT single-use at the token level** (stateless design — no server nonce/jti). **RESIDUAL RISK:** within the 15-min TTL, a captured proof value could be replayed **for the same phone** in the same browser session until first success or expiry. Bounded by: HttpOnly (JS cannot read it), short TTL, post-success clear, phone-binding (cannot target another phone), and the 3-leads/IP/hour rate limit. Durable cross-instance single-use (nonce store) is **deferred to Wave 1** per this wave's replay-scope instruction. Not falsely claimed impossible.

## 10. Residual risks
1. Token-level replay window (above) — Wave 1.
2. `getIP()` trusts `x-forwarded-for` unconditionally (`lib/rateLimit.ts`, **unchanged/pre-existing**) — rate-limit strength depends on deployment topology (Vercel edge sets it; raw proxy may not). Follow-up ticket.
3. Client `NEXT_PUBLIC_DEV_BYPASS_OTP` button still renders if the flag is set at build; now harmless (server rejects) but cosmetically dead — cleanup optional, not required.
4. `middleware`→`proxy` deprecation warning (Next 16) — cosmetic, deferred.

## 11. Git safety proof
```
git ls-files | grep -E "\.env\.local|data/leads\.json|leadssa\.json|node_modules|\.next/"  → (empty)
```
`.env.local`, `data/leads.json`, `leadssa.json`, `node_modules`, `.next` all **untracked**. `.env.example` (template) and `.claude/launch.json` (no secrets) tracked intentionally. 146 files tracked at baseline. Fullwidth-colon junk files excluded (caught before commit). Full detail: `01_GIT_SAFETY.md`. **Not pushed; no remote.**

## 12. Full test / build results
`npm test` → **26 passed** (3 files). `npx tsc --noEmit` → clean. `npx next build` → **exit 0**.

## 13. Commits created
| Hash | Message |
|------|---------|
| `0d9459f` | baseline: pre-wave-0a1 safe snapshot |
| `a1bf364` | test: establish wave 0a1 characterization gate |
| `8895c1c` | fix: restore next-auth middleware build (v5 wrapper, no cast) |
| `aff3dc0` | fix: enforce otp proof on lead submission |
| `51db3a8` | harden: domain-separate otp and lead-proof signing keys |

## 14. NOT VERIFIED
- Real browser end-to-end (send→verify→submit) in a running dev server — logic verified by unit/integration tests + code trace + same-origin-cookie reasoning; not executed against a live server (LOCAL test-only, external providers mocked).
- Production environment (Vercel env vars, real OTP provider, `ADMIN_EMAIL`, `DATA_SOURCE`) — still UNKNOWN; unchanged from Wave 0R. The fail-closed guards behave correctly by test, but the operator must still set `OTP_SECRET`, `ADMIN_EMAIL`, `DATA_SOURCE=supabase` in prod before deploy (Wave 0A-4 / deploy gate).
- Real Twilio Verify / Green / Inforu delivery — mocked; not exercised.
- Cross-instance replay under horizontal scaling — deferred (Wave 1).

---
**STOP CONDITION MET.** No deploy, no prod env change, no valuation/data/harvest/geocoding changes, no Wave 0A-2 or Wave 1 work. Returned for external review.
