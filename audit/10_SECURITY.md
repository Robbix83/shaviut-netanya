# Security Audit -- Phase 10

**Project:** shaviut-netanya (Next.js real-estate lead-gen)
**Auditor:** Claude Security Reviewer (automated forensic read-only scan)
**Date:** 2026-08-19
**Stack:** Next.js 16.2.6, React 19, next-auth 5.0.0-beta.31 (BETA), TypeScript (build currently failing)
**Scope:** All API routes, middleware, auth config, store, rate-limit, env files, build artifacts

---

## Severity Classification

| Level | Meaning |
|-------|--------|
| P0 Critical | Exploitable now with no effort; immediate action required |
| P1 High | Exploitable with moderate effort or realistic misconfiguration |
| P2 Medium | Meaningful risk; fix before production hardening |
| P3 Low | Defence-in-depth or best-practice gap |

---

## P0 -- Critical

### P0-1: Real Twilio credentials stored in `.env.local` and in `audit/01_SYSTEM_MAP.md`

**Files:** `.env.local` lines 21-24; `audit/01_SYSTEM_MAP.md`

Four live Twilio API values are present: Account SID (ACf...), Auth Token (3fe...), From number (+1945...), and Verify Service SID (VAab...). These are real production credentials, not placeholders. `.env.local` is in `.gitignore` and will not be committed. However:

- The file sits unencrypted on the developer workstation. Any process with file-system access, any backup, or a future accidental commit exposes these credentials.
- The Twilio Auth Token grants full account control: send arbitrary SMS worldwide, read call logs, delete resources, and accrue billing charges.
- The credentials were reproduced verbatim inside `audit/01_SYSTEM_MAP.md`, which IS a tracked project file. They have already propagated beyond `.env.local`.

**Required action:** Rotate all four Twilio values immediately via the Twilio console. Remove the values from `audit/01_SYSTEM_MAP.md`. Store replacements exclusively in the hosting platform secret manager (Vercel Environment Variables). Never store live credentials in local files, scripts, or documentation.

---

### P0-2: `ADMIN_EMAIL` not configured -- any Google account can access the admin dashboard

**Files:** `auth.ts` lines 8-12; `.env.local` line 11 (commented out)

The signIn callback in `auth.ts`:

```ts
const adminEmail = process.env.ADMIN_EMAIL;
if (adminEmail && user.email !== adminEmail) return false;
return true;
```

When `ADMIN_EMAIL` is absent -- commented out in `.env.local` and not marked required in `.env.example` -- the guard short-circuits to `return true` for every authenticated Google user. If the application is deployed to production with `ADMIN_EMAIL` unset, any person with a Google account can sign in at `/admin/login` and access the complete lead database: names, phone numbers, property details, consent status, and valuation estimates.

**Required action:** Set `ADMIN_EMAIL` to the owner email in every deployment environment before going live. Mark it as required in `.env.example`. Add a startup assertion that refuses to start in production without this variable.

---

## P1 -- High

### P1-1: `NEXT_PUBLIC_DEV_BYPASS_OTP=true` baked into client-side bundle at build time

**Files:** `.env.local` line 5; `components/ValuationWizard.tsx` line 1281

`NEXT_PUBLIC_` variables are inlined by Next.js at build time and shipped to every browser. If a production build is ever created while `.env.local` is active (e.g., `next build` on the dev machine), the literal string "true" is compiled into the JS bundle. Every visitor then sees the "Skip OTP" button and can submit a lead without phone verification, defeating identity verification and consent collection.

Confirmed: the current `.next/` build artifacts on disk already contain the `devOtp` console logging and the OTP-bypass button compiled into static JavaScript chunks under `.next/static/chunks/`.

**Required action:** Remove `NEXT_PUBLIC_DEV_BYPASS_OTP` from `.env.local`. Gate any dev bypass on a server-side flag that is never a `NEXT_PUBLIC_` variable, or remove the bypass entirely and rely on the `devOtp` server-side console log only.

---

### P1-2: `ADMIN_DEV_BYPASS` relies on `NODE_ENV` -- fragile production gate

**Files:** `middleware.ts` lines 6-9; `app/admin/(protected)/layout.tsx` line 5

The bypass condition is:

```ts
process.env.ADMIN_DEV_BYPASS === "true" && process.env.NODE_ENV !== "production"
```

On some PaaS providers (Railway, Render, some Docker base images), `NODE_ENV` defaults to `development` unless explicitly overridden. If `ADMIN_DEV_BYPASS=true` is present in a staging or preview environment copied from `.env.local`, the admin dashboard is fully open without authentication. Additionally, `layout.tsx` contains a duplicate of the same check that can drift independently.

**Required action:** Remove `ADMIN_DEV_BYPASS` entirely. Rely on next-auth own `authorized` callback for access control. Isolate any dev no-auth mode in a code path that cannot reach production.

---

### P1-3: Middleware type cast suppresses auth enforcement -- auth behaviour is unverified

**File:** `middleware.ts` line 11

```ts
return (auth as (req: NextRequest) => Promise<NextResponse>)(req);
```

The TypeScript build already fails due to this type mismatch with next-auth v5 beta. The cast silences the compiler but does not fix the API mismatch. The recommended next-auth v5 pattern is `export { auth as middleware }`, which routes every request through next-auth internal middleware handler and correctly invokes the `authorized` callback. With the cast pattern, if the beta API changes between versions, the cast silently accepts the call and may return undefined, causing Next.js to serve the protected page unauthenticated with no error.

Because TypeScript is already suppressed, there is no static safety net detecting this condition.

**Required action:** Refactor to `export { auth as middleware } from "@/auth"`. Resolve the TypeScript build failure. Write an integration test asserting that an unauthenticated GET to `/admin/dashboard` returns a 302 redirect to `/admin/login`.

---

### P1-4: `GREEN_WEBHOOK_TOKEN` is optional -- mass opt-out attack possible

**File:** `app/api/webhook/green/route.ts` lines 36-39

```ts
const expected = process.env.GREEN_WEBHOOK_TOKEN;
if (expected && req.nextUrl.searchParams.get("token") !== expected) { ... }
```

When `GREEN_WEBHOOK_TOKEN` is not set (absent from `.env.local`), the webhook accepts every POST without authentication. An attacker who discovers the endpoint URL can send fabricated `incomingMessageReceived` payloads with STOP text and any phone number in `senderData.chatId`. This triggers `optOutByPhone(phone)` and sets `consentMarketing=false` and `optOutAt` for matching leads. A script loop can silently opt out the entire lead database; there is no undo path in the current store implementation.

**Required action:** Make `GREEN_WEBHOOK_TOKEN` required. If not set at startup, return 503 to all webhook requests. Consider validating source IP against Green API published IP ranges.

---

### P1-5: In-memory rate limiter is per-serverless-instance -- effectively unbounded under load

**File:** `lib/rateLimit.ts`

The rate limiter uses a module-level `Map` scoped to a single process. On Vercel and any multi-instance serverless deployment, each Lambda instance has its own isolated Map. An attacker sending parallel requests distributes them across instances and bypasses the per-IP limit entirely.

Affected routes and their nominal (per-instance only) limits:
- `POST /api/lead` -- 3 leads per IP per hour
- `POST /api/otp/send` -- 5 OTP requests per IP per hour
- `POST /api/valuation`, `GET /api/autocomplete`, `GET /api/market` -- NO rate limiting at all

The code comment acknowledges this limitation and recommends Upstash Redis for serious production use.

**Required action:** Replace with Upstash Redis or Vercel KV before production. Apply rate limiting to all unauthenticated endpoints including valuation and autocomplete.

---

## P2 -- Medium

### P2-1: `OTP_SECRET` has a hardcoded fallback allowing token forgery

**File:** `lib/otp.ts` line 11

```ts
return process.env.OTP_SECRET || "dev-otp-secret-change-in-production";
```

If `OTP_SECRET` is absent from the production environment, every OTP token is HMAC-signed with a publicly known string. An attacker can craft a valid token for any phone number with a far-future expiry and call `/api/otp/verify` to receive `{ valid: true, phone: "..." }` -- bypassing phone verification without ever receiving an SMS.

**Required action:** Remove the fallback string. Add a startup assertion: `if (!process.env.OTP_SECRET) throw new Error("OTP_SECRET is required")`. Document as required in `.env.example` with a generation command (`openssl rand -hex 32`).

---

### P2-2: OTP code returned in HTTP response body in non-production environments

**File:** `app/api/otp/send/route.ts` lines 55-62

```ts
const isDev = process.env.NODE_ENV !== "production";
return NextResponse.json({ token, sent, ...(isDev ? { devOtp: otp } : {}) });
```

In any environment where `NODE_ENV` is not exactly `production`, the generated OTP code appears in the JSON response. In a staging or preview environment accessible to third parties, this allows bypass of phone verification without the target device.

**Required action:** Log OTP to the server console only (`console.info`). Never include `devOtp` in the HTTP response body, regardless of environment. For automated testing, use Twilio Verify test credentials.

---

### P2-3: No rate limiting on `/api/valuation`, `/api/autocomplete`, and `/api/market`

These three unauthenticated public routes have no throttle:

- **Valuation:** Iterating over all neighborhood IDs with varying room and area parameters reconstructs the full pricing model across all districts.
- **Autocomplete:** Returns up to 12 streets per query. The full 1,048-street index with neighborhood mappings and ITM coordinates can be extracted in roughly 90 requests.
- **Market (`?scope=neighborhoods`):** Returns aggregate price statistics for all neighborhoods in a single unauthenticated response.

None expose PII directly, but together they allow complete dataset extraction with minimal effort.

**Required action:** Apply Redis-backed rate limiting to all three routes. Consider requiring a signed session token for valuation API calls.

---

### P2-4: `NEXTAUTH_SECRET` is a weak predictable value in `.env.local`

**File:** `.env.local` line 10 -- 36-character value with predictable structure

If this value is accidentally used in production (e.g., a Vercel deployment that reads `.env.local`), an attacker who knows the value can forge next-auth session JWTs and construct a valid admin session for any email address, bypassing even a correctly set `ADMIN_EMAIL`.

**Required action:** Generate a strong secret (`openssl rand -hex 32`) and store it exclusively in the platform secret manager. Add a startup assertion that the secret is at least 32 characters.

---

### P2-5: No HTTP security headers configured

**File:** `next.config.mjs` -- no `headers()` export

The application does not set Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, or Permissions-Policy. This permits clickjacking, inline script injection, and MIME-type sniffing attacks.

**Required action:** Add a `headers()` function in `next.config.mjs` setting at minimum: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a baseline CSP that disallows inline scripts.

---

### P2-6: No CORS restriction on any API route

No `Access-Control-Allow-Origin` policy is applied. Any web page on any domain can make cross-origin POST requests to `/api/lead`, `/api/valuation`, and the webhook. This enables cross-site lead injection and cross-origin data enumeration.

**Required action:** Add an `Origin` allowlist check in sensitive POST routes, or configure CORS in `next.config.mjs`. For the webhook, additionally restrict to Green API source IPs.

---

### P2-7: `NEXT_PUBLIC_SUPABASE_URL` used in the server-side service-role client

**File:** `lib/store.ts` lines 182-183

The `SupabaseStore` constructs its admin client with both `NEXT_PUBLIC_SUPABASE_URL` (public) and `SUPABASE_SERVICE_ROLE_KEY` (secret, confirmed server-side only). The service role key is not referenced in any client-side code or `NEXT_PUBLIC_` variable, so there is no active exposure. RLS is enabled on all tables with no anonymous policies. However, using the `NEXT_PUBLIC_` prefix for a variable also consumed server-side in a privileged context is misleading and creates risk that future developers treat it as safe to pair with the key in client code.

**Required action (low priority):** Rename to `SUPABASE_URL` in the server-side store, or add a clear code comment explaining that the service role key must never be client-accessible.

---

## P3 -- Low

### P3-1: next-auth 5.0.0-beta.31 is pre-release software on the production authentication path

**File:** `package.json` -- `"next-auth": "^5.0.0-beta.31"`

Beta releases of next-auth v5 have introduced breaking changes between minor versions. The current TypeScript build failure is a direct symptom. Pre-release software in the authentication component creates ongoing risk of silent breaking changes to the `authorized` callback or session handling.

**Required action:** Pin to an exact version (remove `^`). Track the next-auth v5 changelog. Plan migration to the stable release when available.

---

### P3-2: Hardcoded internal LAN IP in `next.config.mjs`

**File:** `next.config.mjs` line 4 -- `allowedDevOrigins: ["10.100.102.76"]`

A private network IP address is hardcoded in source. No runtime security impact in production (dev-only setting), but should be removed or moved to an environment variable before the repository is shared or open-sourced.

---

### P3-3: `/api/dev/save-streets` development route present in the production bundle

**File:** `app/api/dev/save-streets/route.ts`

The route correctly returns 403 in production based on `NODE_ENV`. However it is compiled and deployed, increasing attack surface and depending on `NODE_ENV` being set correctly.

**Required action:** Exclude dev-only routes at build time so they are not registered as Next.js routes in production builds.

---

### P3-4: `data/leads.json` stores PII in plaintext on disk

**File:** `data/leads.json` -- 39 records, 756 lines

Contains names, phone numbers, addresses, consent timestamps, and property details. Correctly excluded from git via `.gitignore`. Risk materialises if `DATA_SOURCE=local` is accidentally deployed or the dev workstation is compromised.

**Required action:** Ensure `DATA_SOURCE=supabase` in all production and staging deployments. Add a startup assertion that refuses to run with `DATA_SOURCE=local` outside `NODE_ENV=development`.

---

### P3-5: Low-entropy `OTP_SECRET` in `.env.local`

**File:** `.env.local` line 7 -- 31-character predictable value

Even if the hardcoded fallback in `lib/otp.ts` is fixed (P2-1), the weak dev value means tokens signed in the dev environment are easy to brute-force if the value leaks. Replace with `openssl rand -hex 32`.

---

## Findings Summary

| ID | Severity | Title | File(s) |
|----|----------|-------|---------|
| P0-1 | P0 Critical | Real Twilio credentials in .env.local and audit doc | `.env.local`, `audit/01_SYSTEM_MAP.md` |
| P0-2 | P0 Critical | ADMIN_EMAIL unset -- any Google account accesses admin | `auth.ts`, `.env.local` |
| P1-1 | P1 High | NEXT_PUBLIC_DEV_BYPASS_OTP baked into production bundle | `.env.local`, `ValuationWizard.tsx` |
| P1-2 | P1 High | ADMIN_DEV_BYPASS depends on NODE_ENV -- fragile | `middleware.ts`, `layout.tsx` |
| P1-3 | P1 High | Middleware type cast suppresses auth type safety | `middleware.ts` |
| P1-4 | P1 High | GREEN_WEBHOOK_TOKEN optional -- mass opt-out attack | `webhook/green/route.ts` |
| P1-5 | P1 High | In-memory rate limiter bypassed on serverless | `lib/rateLimit.ts` |
| P2-1 | P2 Medium | OTP_SECRET hardcoded fallback allows token forgery | `lib/otp.ts` |
| P2-2 | P2 Medium | devOtp returned in HTTP response in non-production | `otp/send/route.ts` |
| P2-3 | P2 Medium | No rate limiting on valuation, autocomplete, market | 3 route files |
| P2-4 | P2 Medium | NEXTAUTH_SECRET weak in .env.local | `.env.local` |
| P2-5 | P2 Medium | No HTTP security headers (CSP, X-Frame-Options, etc.) | `next.config.mjs` |
| P2-6 | P2 Medium | No CORS restriction on any API route | all API routes |
| P2-7 | P2 Medium | NEXT_PUBLIC_SUPABASE_URL in server-side service-role client | `lib/store.ts` |
| P3-1 | P3 Low | next-auth 5.0.0-beta.31 pre-release in production path | `package.json` |
| P3-2 | P3 Low | Hardcoded internal LAN IP in config | `next.config.mjs` |
| P3-3 | P3 Low | Dev-only route shipped in production bundle | `api/dev/save-streets/route.ts` |
| P3-4 | P3 Low | data/leads.json plaintext PII on dev disk | `data/leads.json` |
| P3-5 | P3 Low | Low-entropy OTP_SECRET in .env.local | `.env.local` |

---

## Items Verified Clean

- **Admin API double-protection:** `/api/admin/leads` (GET) and `/api/admin/leads/[id]` (PATCH) both call `await auth()` server-side independently of middleware and return 401 if no session. Correct defence-in-depth.
- **SQL injection:** No SQL string concatenation anywhere. Local store uses JSON file I/O; Supabase store uses the official JS client with parameterized queries.
- **Stack traces in error responses:** All API error responses return opaque codes only (e.g., `{ error: "save_failed" }`). Stack traces go to `console.error` server-side only. No internal details exposed to clients.
- **Consent enforcement:** `/api/lead` requires `consentReport === true` before saving. The `consentAt` timestamp is server-generated and cannot be forged by the client.
- **Phone validation:** Both `/api/lead` and `/api/otp/send` validate phone format against regex before processing.
- **Status allowlisting:** PATCH `/api/admin/leads/[id]` validates `status` and `tabuStatus` against static allowlists before writing. No arbitrary values accepted.
- **SUPABASE_SERVICE_ROLE_KEY server-side only:** Confirmed not referenced in any client component, page, or NEXT_PUBLIC_ variable. RLS is enabled on all three Supabase tables with no anonymous access policies.
- **`.env.local` in `.gitignore`:** Confirmed. The file will not be committed.
- **`data/*.json` in `.gitignore`:** Confirmed. Lead data will not be committed.
- **`/api/dev/save-streets` disabled in production:** The NODE_ENV check returns 403 correctly. Risk is low but the route should still be excluded at build time (P3-3).
- **No secrets in NEXT_PUBLIC_ variables (except bypass flag):** All NEXT_PUBLIC_ variables in `.env.example` are non-secret (Supabase URL, agent display info, analytics IDs).
- **Error handling is generic:** Errors from `insertLead()` catch blocks return opaque strings only; no exception details propagate to the client.
- **Injection risk in input fields:** Phone, address, rooms, and name inputs are stored as-is in JSON/Supabase but are not executed or interpolated into queries or shell commands. No injection risk identified.
- **No shell command execution with user input:** No `exec`, `spawn`, or similar calls found in any API route. No path traversal risk.

---

## Immediate Action Checklist (required before any production deployment)

1. [ ] Rotate all Twilio credentials via Twilio console; delete values from `audit/01_SYSTEM_MAP.md`
2. [ ] Set `ADMIN_EMAIL` in every deployment environment; add startup assertion
3. [ ] Remove `NEXT_PUBLIC_DEV_BYPASS_OTP` from `.env.local` and all build pipelines
4. [ ] Set `GREEN_WEBHOOK_TOKEN` to a strong random value (`openssl rand -hex 32`); make it required at startup
5. [ ] Replace in-memory rate limiter with Upstash Redis or Vercel KV
6. [ ] Remove `OTP_SECRET` fallback string in `lib/otp.ts`; add startup assertion; generate strong value
7. [ ] Fix middleware to use `export { auth as middleware }` pattern; resolve TypeScript build failure
8. [ ] Add HTTP security headers in `next.config.mjs`
9. [ ] Explicitly set `NODE_ENV=production` in the hosting platform environment
10. [ ] Generate strong `NEXTAUTH_SECRET` (`openssl rand -hex 32`); store in platform secret manager only
