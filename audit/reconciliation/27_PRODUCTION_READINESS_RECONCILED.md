# 27 — PRODUCTION READINESS (RECONCILED)

**Phase:** WAVE 0R
**Rule:** Distinguish BLOCKER / HIGH / MEDIUM / LOW / UNKNOWN. Do not treat "no Dockerfile" or missing `output: standalone` as blockers on a Vercel-native deployment. Avoid generic infra advice unrelated to the real stack.

---

## RECONCILED READINESS TABLE

| Area | Status | Severity | Evidence / correction |
|------|--------|----------|-----------------------|
| **Build** | `next build` fails on `middleware.ts` type cast | **BLOCKER** | `middleware.ts:11` cast incompatible with next-auth 5.0.0-beta.31. Correct fix (per installed type defs, 17_RECON issue F): `export default auth((req)=>{…})` wrapper preserving the `ADMIN_DEV_BYPASS` branch — NOT `auth as any`, NOT bare `export { auth as middleware }`. [VERIFIED] |
| **Admin auth** | Fail-open if `ADMIN_EMAIL` unset | **HIGH (conditional)** | Code-confirmed failure mode (`auth.ts:8-13`); production `ADMIN_EMAIL` presence UNKNOWN. Operator must verify Vercel env. Not a VERIFIED prod breach. |
| **OTP → lead trust boundary** | Lead creation needs no OTP proof; OTP code recoverable from token | **HIGH** | See 20_LEAD_TRUST_BOUNDARY. Code-VERIFIED, environment-independent. |
| **Client-trusted valuation** | Persisted + forwarded unverified | **MEDIUM** | `lead/route.ts:83-84,107`. Integrity, not access. |
| **Data source** | Defaults to `local`; prod value unknown | **HIGH (conditional)** | `store.ts:12`. If prod lacks `DATA_SOURCE=supabase`, leads write to ephemeral serverless filesystem and vanish. Prod value UNKNOWN — operator must verify. |
| **Lead persistence (local mode)** | No lock / no atomic write | **MEDIUM** | `LocalStore.insertLead` (`store.ts:104-117`). Real risk only if prod runs local mode (see above). On Vercel, local FS is also non-persistent — a second reason prod must be Supabase. |
| **Supabase error handling** | Throws propagate to 500; insert failure aborts before notify | **LOW** | Correct ordering (`lead/route.ts:99-104`). |
| **Production env visibility** | Not accessible this session | **UNKNOWN** | No Vercel access. All prod-only facts UNKNOWN. |
| **Monitoring / error tracking** | None found | **MEDIUM** | No Sentry/logging service in deps. Silent notify failures (26_ATTRIBUTION) compound this. |
| **Error boundaries (React)** | Not verified present | **LOW/UNKNOWN** | Not inspected exhaustively this phase. |
| **External API timeouts** | No explicit `fetch` timeouts (Twilio/Green/Inforu/Sheets/govmap) | **MEDIUM** | A hung upstream can stall a serverless invocation to its platform limit. Notifications are post-response fire-and-forget, so user-facing impact is limited; harvest/otp are exposed. |
| **Data freshness / harvest freshness** | Manual monthly harvest by design | **LOW** | Project design (memory: monthly Playwright harvest). Not a code blocker. |
| **Security headers (CSP/HSTS/X-Frame)** | Absent | **LOW** | Standard hardening; low risk for current threat model. |
| **Public dev endpoints** | `app/api/dev/save-streets`, `app/api/streets-raw` | **MEDIUM (conditional)** | Presence of a `/api/dev/*` route in a production build is worth gating. Behavior/exposure not fully traced this phase → verify before prod. |
| **Serverless rate limiting** | In-memory, per-instance | **LOW** | `rateLimit.ts` resets per cold start / per instance; acceptable at current scale, ineffective under horizontal scale. |
| **Backups** | None for `data/*.json`; Supabase has its own | **LOW/UNKNOWN** | If prod = Supabase, provider backups apply. If local, none. |
| **Deployment reproducibility** | No Git → no reproducible source state | **HIGH** | `C:\leads\.git` absent. One overwrite is unrecoverable. (Git init is deferred to roadmap, prohibited this phase.) |
| **No Dockerfile / no `output: standalone`** | N/A | **NOT A BLOCKER** | Vercel-native deployment does not require either. Explicitly excluded per rules. |

---

## RECONCILED BLOCKERS (only true blockers)

1. **Build failure** (`middleware.ts`) — nothing can deploy until green. **BLOCKER.**
2. **No version control** — no reproducible/rollback-able source state. **HIGH** (operationally blocker-adjacent; the enabling fix — Git init — is deferred).

## RECONCILED HIGH (mostly conditional on unknown prod env)
- Admin fail-open if `ADMIN_EMAIL` unset (verify Vercel env).
- `DATA_SOURCE` must be `supabase` in prod (verify Vercel env) — otherwise leads are lost on serverless.
- OTP→lead trust boundary (environment-independent; real).

## WHAT PRIOR AUDIT OVERSTATED
- "Production is running a stale unrebuildable bundle" → **UNKNOWN** (no deployment inspected).
- Several "VERIFIED production" blockers → **CONDITIONAL_PRODUCTION_RISK** pending operator env check.

---

## MINIMUM TO BE CONSIDERED DEPLOYABLE (reconciled)
1. Green build (correct next-auth middleware pattern).
2. Operator confirms `ADMIN_EMAIL` set in prod.
3. Operator confirms `DATA_SOURCE=supabase` in prod (and Supabase configured).
4. OTP→lead server-side proof enforced (Wave 0A/1).
5. Git initialized with the vetted `.gitignore` (Wave 0A; `leadssa.json` precondition from 18_SECRET_HYGIENE).

Everything else is HIGH/MEDIUM/LOW hardening, not a deploy blocker.
