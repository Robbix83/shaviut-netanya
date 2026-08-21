# Wave 0C-1 — Preview Readiness

## Verdict
**PASS** (with manual operator env setup). The repository is technically ready for a first Vercel **Preview** deployment. No unresolved code blocker. Two proven, deferred items were fixed with minimal server-side changes: fractional-floor coercion and phone-number log masking. No deploy performed; live DB untouched.

## Repository Baseline
- HEAD start: `8d80298`, clean working tree.
- No unrelated changes.

## Environment Contract (derived from code)
**Server-only (never `NEXT_PUBLIC`):**
| Var | Req? | For | Fail mode | Consumed by |
|-----|------|-----|-----------|-------------|
| `DATA_SOURCE` | **required** (Preview = `supabase`) | runtime | **fail-closed** (prod throws if not `supabase`) | `lib/config.ts`, `lib/store.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | **required** (supabase) | runtime | throws on use if absent | `lib/store.ts` |
| `OTP_SECRET` | **required** | runtime | **fail-closed** (prod throws if unset/default) | `lib/otp.ts` |
| `ADMIN_EMAIL` | **required for admin** | admin auth | **fail-closed** (prod denies all if unset) | `auth.ts`, `lib/adminAuth.ts` |
| `AUTH_SECRET` (aka `NEXTAUTH_SECRET`) | **required** (prod) | Auth.js session | Auth.js throws if unset in prod | Auth.js internal |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | required for Google login | admin OAuth | provider disabled if unset | Auth.js `Google` provider (`auth.ts`) |
| `GREEN_WEBHOOK_TOKEN` | optional | opt-out webhook | **fail-closed** in prod (401 if unset) | `webhook/green`, `lib/config.ts` |
| `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM/VERIFY_SID` | optional | OTP delivery | no-op if unset | `app/api/otp/send` |
| `INFORU_USER/INFORU_PASS` | optional | OTP delivery | no-op if unset | `app/api/otp/send` |
| `GREEN_API_ID_INSTANCE/GREEN_API_TOKEN_INSTANCE` | optional | WhatsApp | no-op if unset | `lib/notify`, `otp/send` |
| `LEAD_NOTIFY_WHATSAPP` | optional | agent alert | no-op if unset | `lib/notify` |
| `GOOGLE_SHEETS_WEBHOOK` | optional | Sheets log | no-op if unset | `lib/notify` |
| `ADMIN_DEV_BYPASS` | optional | **dev only** | guarded `NODE_ENV!==production` | `middleware.ts` |
| `NODE_ENV` | platform-set | — | — | many |

**Browser-exposed (`NEXT_PUBLIC_*`) — all NON-secret:** `NEXT_PUBLIC_SUPABASE_URL` (public project URL), `NEXT_PUBLIC_AGENT_NAME/LICENSE/PHOTO/TESTIMONIAL/PHONE` (display), `NEXT_PUBLIC_GA4_ID`, `NEXT_PUBLIC_FB_PIXEL_ID` (analytics), `NEXT_PUBLIC_DEV_BYPASS_OTP` (dev-only, server-neutralized).

**Script-only (NOT Preview runtime):** `HARVEST_*`, `ENRICH_LIMIT`, `SKIP_EXISTING`, `ONLY_STREET`, `CHROME_PROFILE_DIR`, `HOME`, `USERPROFILE`, and `NODE_TLS_REJECT_UNAUTHORIZED` (set only in `scripts/fetch-cbs.ts` — a harvest script, **never** in an app/Preview path).

## Server vs Public Variables
**Secrets exposed via `NEXT_PUBLIC_*`: NO.** Every secret (`SUPABASE_SERVICE_ROLE_KEY`, `OTP_SECRET`, Twilio/Inforu/Green tokens, `GREEN_WEBHOOK_TOKEN`, `GOOGLE_SHEETS_WEBHOOK`, `AUTH_SECRET`, `AUTH_GOOGLE_SECRET`) is server-only. All `NEXT_PUBLIC_*` values are non-secret. (Prior review also confirmed no anon-key Supabase client exists anywhere — the service role is used server-side only.)

## Supabase Runtime Readiness
- Preview `DATA_SOURCE` value: **`supabase`** (fail-closed enforced at request runtime; build-phase exempt so `next build` succeeds).
- Service-role key is server-only; the browser never receives it; all I/O is via server `/api` routes.
- Preview can point at the existing project (`sddtjsojbdxtakpwpqlz`) with **no schema mutation** — bootstrap + data import already done.
- Live DB mutated this wave: **NO**. Blocker: **none**.

## Auth / OAuth Preview Readiness
- No fixed production URL is embedded: `middleware.ts` redirects to `new URL("/admin/login", req.nextUrl.origin)` (dynamic, Preview-safe); `auth.ts pages.signIn` is a relative path. Auth.js v5 auto-trusts the host on Vercel.
- Admin authorization is **fail-closed** (`isAdminAuthorized` denies all in prod when `ADMIN_EMAIL` unset).
- **Google OAuth on dynamic Preview URLs requires a manual action**: Google Cloud must list the exact redirect URI `https://<preview-host>/api/auth/callback/google`. Preview hostnames vary per branch/commit, so admin Google login on Preview needs the operator to register the Preview URL (or use a stable alias). **Not a code blocker** — the public funnel needs no auth.

## OTP Runtime Requirements
- `OTP_SECRET` is **required** and **fail-closed** in production (Preview runs as production) — `secret()` throws if unset or equal to the dev default. Blocker: **none** (manual: set `OTP_SECRET`).

## External Integration Safety
- **WhatsApp (Green)** and **Google Sheets**: no-op when their env vars are unset → **safe to leave disabled** in Preview (zero external side effects).
- **OTP delivery (Twilio/Inforu)**: no-op when unset. Because Preview = production, `devOtp` is **not** echoed, so with no provider the OTP step cannot be completed end-to-end.
- **Recommended safe Preview posture:** leave ALL notification/OTP-provider vars **unset** → no real WhatsApp/SMS/Sheets traffic; smoke-test the public pages, valuation, and endpoint health (OTP send returns 200 without delivery). To exercise the *full* lead funnel, the operator may set **Twilio Verify** and test with their own controlled phone. No notification framework is needed or added.

## Floor Validation
- **Finding (proven defect):** `app/api/lead/route.ts` persisted `floor: body.floor ?? null` uncoerced; `leads.floor` / `deals.floor` are `int`. A fractional client value (e.g. `Number("2.5")`) would fail the Supabase INSERT → `500 save_failed` → **lead lost** in Preview/Supabase mode. (Harmless in local JSON mode, which is why it was latent.)
- **Fix (0C-1A correction):** fractional floor input is **rejected server-side**, not rounded — user-entered property data is never silently mutated. `validateFloor(body.floor)` enforces: absent/`null` → `null` (optional); valid finite **integer** → preserved exactly (including `0` and negative/basement floors); provided-but-invalid (fractional, `NaN`, `Infinity`, string) → **HTTP 422 `invalid_floor`** (route's normal validation convention), never persisted. The API does not coerce numeric strings (consistent with the existing `num()` helper), so `"3"` is rejected too. No form/valuation redesign; no arbitrary min/max limits.
- **Tests:** `validateFloor` unit (2/0/−1 accepted; absent→null; 2.7/1.5/"3.2"/"3"/NaN/Infinity rejected) + integration (POST floor 2 → persisted 2; floor 2.7 → 422, not persisted; "3.2" → 422; omitted → null).

## PII Logging
- **Finding (proven leak):** full phone number logged at `app/api/otp/send/route.ts:56` (`[OTP] phone=…`) and `app/api/webhook/green/route.ts:59` (`[opt-out] …`).
- **Fix:** `lib/pii.ts maskPhone()` (keeps first 3 + last 2 digits, masks the middle, e.g. `050*****67`) applied to both — provider/sent/removed metadata retained for debugging.
- **Residual (not changed, documented):** `otp/send:82,145` log the Twilio API error-response *body* on failure, which may echo the destination number. These are error-only, third-party responses; masking them would require parsing Twilio's payload. Low risk; recommend a follow-up if Twilio is enabled in Preview.
- **Other logs reviewed & cleared:** `lead/route` warn/error lines log only enum error codes / `Error.message` / caught error objects — no lead payload, phone, name, or address.
- **Tests:** `lib/__tests__/pii.test.ts`.

## Vercel / Serverless Compatibility
- **No serverless FS writes on the Preview path:** `LocalStore` (writes `data/*.json`) is unreachable when `DATA_SOURCE=supabase` (fail-closed); `/api/dev/save-streets` returns 403 in production. `SupabaseStore` is used exclusively.
- **No silent local fallback:** `resolveDataSource` throws in prod unless `supabase`.
- **Request IP:** `getIP` reads `x-forwarded-for` (Vercel edge sets it) — fine for Preview.
- **Runtime:** OTP/lead/webhook routes declare `runtime = "nodejs"` (Node crypto) — correct for Vercel Node functions.
- **No hardcoded localhost** in runtime app paths (client uses same-origin relative `/api/...` fetches; `-H 0.0.0.0` is dev-script only).
- **In-memory rate limiter** is per-instance (resets on cold start) — acceptable for Preview; durable rate limiting is a deferred Wave 1 item, **not** a Preview blocker.
- Blocker: **none**.

## Quality Gate
- tests: **112 passed** (11 files).
- typecheck: `tsc --noEmit` **clean**.
- build: `next build` **exit 0**.
- `lib/valuation.ts`: unchanged.

## Blockers
**None** (code). Remaining work is operator env configuration in Vercel (below).

## Required Manual Operator Actions
1. Set Vercel **Preview** environment variables (server): `DATA_SOURCE=supabase`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `OTP_SECRET` (strong), `ADMIN_EMAIL`, `AUTH_SECRET`. Do **not** set `NEXT_PUBLIC_DEV_BYPASS_OTP` or `ADMIN_DEV_BYPASS`.
2. Choose the notification posture: leave Green/Sheets/Twilio/Inforu **unset** for a side-effect-free Preview (funnel won't complete OTP), or set **Twilio Verify** to test the full funnel with a controlled phone.
3. (Only to test admin Google login on Preview) set `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` and add the Preview callback URL `https://<preview-host>/api/auth/callback/google` to Google Cloud OAuth authorized redirect URIs.
4. If the opt-out webhook will be exercised in Preview, set `GREEN_WEBHOOK_TOKEN` (else it fail-closes to 401 in production).

## Recommended Next Step
Configure the verified Preview environment variables in Vercel and perform one controlled first Preview deployment, followed by read-only/safe smoke testing (public pages + valuation; OTP only via a controlled provider).
