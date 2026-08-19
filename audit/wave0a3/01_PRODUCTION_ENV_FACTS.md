# 01 — PRODUCTION ENV FACT MATRIX (Wave 0A-3)

**Governing rule:** Do NOT infer production from `.env.local`. Where no authorized production access exists → **UNKNOWN**.

## Access reality
This session has **no authorized access** to the live hosting environment: no Vercel API token/CLI session, no Vercel MCP, no production shell. Therefore **all production env values are UNKNOWN**. `LOCAL_PRESENT` reflects `.env.local`/`.env.example` key names only (never values) and is **not** evidence of production.

| Variable | PRODUCTION_PRESENT | PREVIEW_PRESENT | LOCAL_PRESENT |
|----------|--------------------|-----------------|----------------|
| DATA_SOURCE | UNKNOWN | UNKNOWN | YES (`=local`) |
| NEXT_PUBLIC_SUPABASE_URL | UNKNOWN | UNKNOWN | NO |
| SUPABASE_SERVICE_ROLE_KEY | UNKNOWN | UNKNOWN | NO |
| ADMIN_EMAIL | UNKNOWN | UNKNOWN | NO |
| OTP_SECRET | UNKNOWN | UNKNOWN | YES |
| GREEN_WEBHOOK_TOKEN | UNKNOWN | UNKNOWN | NO |
| GREEN_API_ID_INSTANCE | UNKNOWN | UNKNOWN | NO |
| GREEN_API_TOKEN_INSTANCE | UNKNOWN | UNKNOWN | NO |
| LEAD_NOTIFY_WHATSAPP | UNKNOWN | UNKNOWN | NO |
| GOOGLE_SHEETS_WEBHOOK | UNKNOWN | UNKNOWN | NO |
| NEXTAUTH_SECRET / AUTH_SECRET | UNKNOWN | UNKNOWN | YES (`NEXTAUTH_SECRET`) |
| Google OAuth (client id/secret) | UNKNOWN | UNKNOWN | NO (not in `.env.local` keys observed) |
| TWILIO_ACCOUNT_SID / AUTH_TOKEN / VERIFY_SID / FROM | UNKNOWN | UNKNOWN | YES (all four) |
| NEXT_PUBLIC_AGENT_NAME | UNKNOWN | UNKNOWN | NO |
| NEXT_PUBLIC_AGENT_LICENSE | UNKNOWN | UNKNOWN | NO |
| NEXT_PUBLIC_GA4_ID | UNKNOWN | UNKNOWN | NO |
| NEXT_PUBLIC_FB_PIXEL_ID | UNKNOWN | UNKNOWN | NO |

> `.env.local` locally configures **Twilio Verify** (all four TWILIO_* present) and lacks Green/Inforu/Sheets/Supabase/ADMIN_EMAIL/GREEN_WEBHOOK_TOKEN. This describes the **local dev** setup only.

## Deployment facts
| Fact | Value |
|------|-------|
| HOSTING_PROVIDER | **UNKNOWN** (Vercel referenced in code comments/`.env.example` — LIKELY, not verified) |
| ACTIVE_PRODUCTION_DEPLOYMENT | **UNKNOWN** |
| PRODUCTION_DOMAIN | `shaviut-netanya.co.il` (operator-stated) — LIKELY, not probed |
| LATEST_DEPLOYMENT_STATUS | **UNKNOWN** |
| BUILD_ID / COMMIT | **UNKNOWN** |

**Recommendation:** the operator must confirm, in the Vercel dashboard (read-only), presence of `DATA_SOURCE=supabase`, `ADMIN_EMAIL`, `OTP_SECRET` (strong), `GREEN_WEBHOOK_TOKEN`, and Supabase keys before any deploy. This wave cannot verify them.
