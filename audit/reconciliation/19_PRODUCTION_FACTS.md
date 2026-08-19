# 19 — PRODUCTION FACT VERIFICATION

**Phase:** WAVE 0R
**Governing rule:** Do NOT infer production state from `.env.local` / `.env.example` / local filesystem. Where no production evidence is accessible, mark **UNKNOWN**. Presence-only for secrets; no values shown.

---

## ACCESS REALITY

No authorized tooling in this session can read the live production environment: no Vercel API token, no deployment dashboard access, no production shell, no production DB connection was available or used. Therefore **every production-only fact below is UNKNOWN unless it can be derived from committed source that necessarily governs production.**

The previous audit's core methodological error was labelling local-file observations as "production VERIFIED." This report corrects that.

---

## FACT TABLE

| Fact | Value | Classification | Basis |
|------|-------|----------------|-------|
| HOSTING_PROVIDER | Vercel (referenced in `.env.example` comments & rate-limit code comments) | **LIKELY, NOT VERIFIED** | Documentation/comments only; no live deployment inspected |
| PRODUCTION_DEPLOYMENT_EXISTS | — | **UNKNOWN** | No deployment accessed |
| PRODUCTION_DOMAIN | `shaviut-netanya.co.il` (task header) | **LIKELY** | Operator-stated; not probed |
| CURRENT_DEPLOYMENT_ID / BUILD | — | **UNKNOWN** | No access |
| PRODUCTION_DATA_SOURCE | — | **UNKNOWN** | `DATA_SOURCE` defaults to `local` in code (`store.ts:12`); production value not visible |
| PRODUCTION_DATABASE (Supabase live?) | — | **UNKNOWN** | Supabase keys empty in `.env.example`; not present in `.env.local`; production unknown |
| ADMIN_EMAIL_PRESENT | **Absent locally**; production **UNKNOWN** | LOCAL_VERIFIED absent / PRODUCTION UNKNOWN | Not in `.env.example` nor `.env.local` |
| DEV_OTP_BYPASS_PRESENT (`NEXT_PUBLIC_DEV_BYPASS_OTP`) | Present in `.env.local`; production **UNKNOWN** | LOCAL_VERIFIED present / PROD UNKNOWN | Key name in `.env.local` |
| ADMIN_DEV_BYPASS_PRESENT | Present in `.env.local`; production **UNKNOWN** | LOCAL_VERIFIED / PROD UNKNOWN | Key name in `.env.local`; code-guarded by `NODE_ENV!=="production"` |
| OTP_SECRET_PRESENT | Present in `.env.local`; production **UNKNOWN** | LOCAL_VERIFIED / PROD UNKNOWN | Key name present |
| GREEN_WEBHOOK_TOKEN_PRESENT | **Absent** in `.env.local` (key not present); production **UNKNOWN** | LOCAL_VERIFIED absent / PROD UNKNOWN | Not among `.env.local` keys |
| SUPABASE_CONFIG_PRESENT | Absent locally; production **UNKNOWN** | LOCAL_VERIFIED absent / PROD UNKNOWN | Empty in `.env.example`, not in `.env.local` |
| AGENT_NAME_CONFIGURED | **UNKNOWN** in prod | UNKNOWN | `.env.example` empty; `.env.local` key not observed among the 10 listed |
| AGENT_LICENSE_CONFIGURED | **UNKNOWN** in prod | UNKNOWN | Same |
| GA4_CONFIGURED | **UNKNOWN** in prod | UNKNOWN | `.env.example` empty |
| META_PIXEL_CONFIGURED | **UNKNOWN** in prod | UNKNOWN | `.env.example` empty |

Local `.env.local` key names present (LOCAL evidence only, **never production**): `DATA_SOURCE`, `ADMIN_DEV_BYPASS`, `NEXT_PUBLIC_DEV_BYPASS_OTP`, `OTP_SECRET`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `TWILIO_VERIFY_SID`.

---

## RECONCILES ISSUE (B): "ADMIN_EMAIL not set in production" — VERIFIED?

**Corrected classification: CONDITIONAL_PRODUCTION_RISK (NOT VERIFIED).**

- Code fact **[VERIFIED]**: [`auth.ts:8-13`](../../auth.ts) `signIn` callback returns `false` only when `ADMIN_EMAIL` is set and the Google email differs. If `ADMIN_EMAIL` is **unset**, **any** Google account is allowed to sign in. The middleware `authorized` callback is `!!auth` ([`auth.ts:7`](../../auth.ts)), i.e. any authenticated session passes.
- Local fact **[LOCAL_VERIFIED]**: `ADMIN_EMAIL` is absent from `.env.example` and `.env.local`.
- Production fact: **UNKNOWN** — the operator may have set `ADMIN_EMAIL` directly in Vercel env vars, which are not visible here.

**Therefore:** the risk "any Google account can access admin" is a **real, code-confirmed failure mode** that **materializes only if `ADMIN_EMAIL` is unset in the production environment**. It must be treated as a **CONDITIONAL_PRODUCTION_RISK to be verified by the operator**, not asserted as a verified production breach. Recommended verification: operator checks Vercel → Project → Settings → Environment Variables for `ADMIN_EMAIL`. If absent → confirmed P0; if present and correct → resolved.

---

## OTHER FINDINGS THAT PRIOR AUDIT INFERRED FROM LOCAL STATE — RECLASSIFIED

| Prior claim | Prior label | Corrected label |
|-------------|-------------|-----------------|
| ADMIN_EMAIL unset "in production" | VERIFIED | **CONDITIONAL_PRODUCTION_RISK** |
| OTP dev bypass exposed "in production" | VERIFIED/P2 | **CONDITIONAL_PRODUCTION_RISK** (client-baked; prod build value UNKNOWN) |
| GREEN_WEBHOOK_TOKEN unset → unauthenticated opt-out | VERIFIED/P2 | **CONDITIONAL_PRODUCTION_RISK** (absent locally; prod UNKNOWN; impact = nuisance opt-out, not data breach) |
| DATA_SOURCE silently `local` in production | VERIFIED/P1 | **CONDITIONAL_PRODUCTION_RISK** (default is `local` in code; prod value UNKNOWN) |
| Placeholder agent name/license shown in prod | LIKELY | **UNKNOWN** (prod env not visible) |
| "Production running a stale unrebuildable bundle" | asserted | **UNKNOWN** (no deployment inspected) |
