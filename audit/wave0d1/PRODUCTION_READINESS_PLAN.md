# Wave 0D-1 — Production Readiness Plan

**Read-only planning wave. No Production deployment, domain attachment, DNS change, env-var change, or Supabase mutation was performed.** This document is the checklist for moving from the current verified Preview state to a real Production launch.

---

## Current State

### Repository
- HEAD: `3b58f09` (docs-only; last application-source commit is `b6e95d4`, mobile grid-centering fix)
- Working tree: clean apart from pre-existing, out-of-scope `graphify-out/` residue

### Vercel
| Field | Value |
|---|---|
| Project | `robbublils-projects/shaviut-netanya` |
| Total deployments | 4 |
| Production baseline | `shaviut-netanya-6ycwo1czg-....vercel.app` — platform-bootstrap only, retained, protected, no domain |
| Latest Preview | `shaviut-netanya-97ah045fq-....vercel.app` (HEAD `b6e95d4`, mobile-centering fix) |
| Other Previews | 2 earlier Previews, retained |
| Custom domains attached | NONE |
| Git integration | NONE (`.vercel/project.json` has no repo-linkage field) |
| Deployment Protection | Vercel Authentication (SSO) enabled, scope `all_except_custom_domains`; Git Fork Protection enabled; an automation-bypass token exists for CLI (`vercel curl`) use only — **value never printed in this report** |
| Preview env vars | 6/6: `ADMIN_EMAIL`, `AUTH_SECRET`, `OTP_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `DATA_SOURCE` — all Sensitive |
| Production env vars | **0** — none configured at all |

### Application (from prior waves, not re-audited)
Supabase-backed, real credentials: neighborhoods=21, deals=12,642, leads=0, orphans=0. Tests=124 passed, typecheck clean, build PASS. Price-wrap fix (`5a1b2b5`) and mobile-centering fix (`b6e95d4`) both verified.

---

## Production Environment Contract

Derived from actual source usage (grep-verified this wave, not assumed from history).

### REQUIRED — server, must be set with real Production values
| Var | Source | Notes |
|---|---|---|
| `DATA_SOURCE` | `lib/config.ts` | Must be exactly `"supabase"`. `resolveDataSource()` throws at **request runtime** in production if missing/wrong (build phase is exempted — proven in Wave 0C-2B/0C-4). |
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/store.ts` (`SupabaseStore.client()`) | Only referenced in a server-only file in this codebase — despite the `NEXT_PUBLIC_` prefix, it is **not currently inlined into any client bundle** (no `"use client"` file reads it). The prefix is Supabase's own scaffolding convention, not a leak in this app as written. |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/store.ts` | **SERVER SECRET.** Server-only reference confirmed by grep — no client-side usage anywhere. |
| `OTP_SECRET` | `lib/otp.ts` | **SERVER SECRET.** Fail-closed: throws at runtime in production if unset or left at the public dev-fallback value. |
| `ADMIN_EMAIL` | `lib/adminAuth.ts` | Fail-closed: if unset, production denies **every** admin sign-in attempt (not "allow all" — verified from source). |
| `AUTH_SECRET` | next-auth v5 internal convention | Not directly referenced via `process.env.AUTH_SECRET` in application source — next-auth v5 reads it by its own env-var convention. Required for session/JWT encryption. |

### REQUIRED FOR ADMIN LOGIN TO FUNCTION AT ALL — currently missing everywhere
| Var | Status |
|---|---|
| `AUTH_GOOGLE_ID` | **Not found anywhere** — not in application source (expected, next-auth reads it by convention), not in the 6 configured Preview vars, not in the previously-observed `.env.local` key list from prior waves. |
| `AUTH_GOOGLE_SECRET` | Same — **not found anywhere.** |

**This means Google admin sign-in cannot currently complete in *any* environment**, Preview or Production — this predates this wave and was simply never exercised (all admin-flow testing so far used `ADMIN_DEV_BYPASS`, not real Google sign-in).

### OPTIONAL / FEATURE-SPECIFIC — server
| Var | Feature | Priority if multiple set |
|---|---|---|
| `TWILIO_VERIFY_SID` + `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` | OTP via Twilio Verify | **Highest priority** — checked first in `app/api/otp/send/route.ts`; if all three are present, Twilio Verify is used exclusively |
| `INFORU_USER` + `INFORU_PASS` | OTP via Inforu SMS (Israel) | 1st in the non-Verify fallback chain |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM` | OTP via plain Twilio SMS | 2nd in the fallback chain (distinct from Twilio Verify — uses `TWILIO_FROM`, not `TWILIO_VERIFY_SID`) |
| `GREEN_API_ID_INSTANCE` + `GREEN_API_TOKEN_INSTANCE` | OTP via WhatsApp (Green API); also used for lead notifications | 3rd in the OTP fallback chain; independently also gates the two WhatsApp notification features below |
| `LEAD_NOTIFY_WHATSAPP` | Agent's own WhatsApp number — receives a message on every new lead | Optional; requires Green API vars too |
| `GOOGLE_SHEETS_WEBHOOK` | Appends each lead to a Google Sheet via an Apps Script webhook | Optional, independent of WhatsApp |
| `GREEN_WEBHOOK_TOKEN` | Authorizes the incoming Green API webhook (`/api/webhook/green`) | Fail-closed in production if that webhook is actually invoked with no token configured (`lib/config.ts: isWebhookAuthorized`) — only relevant if the incoming-webhook feature is used |
| `AGENT_NAME` / `AGENT_LICENSE` | Server-only fallback for the WhatsApp report text if the `NEXT_PUBLIC_` versions aren't set | Optional |

### NEXT_PUBLIC / browser-visible — optional
| Var | Feature |
|---|---|
| `NEXT_PUBLIC_AGENT_NAME`, `NEXT_PUBLIC_AGENT_LICENSE` | Cosmetic — schema.org JSON-LD, WhatsApp report text |
| `NEXT_PUBLIC_AGENT_PHONE` | Floating WhatsApp "contact us" button — button doesn't render at all if unset |
| `NEXT_PUBLIC_GA4_ID`, `NEXT_PUBLIC_FB_PIXEL_ID` | Analytics scripts — both entirely absent from the page if unset (`components/Analytics.tsx` returns `null`) |

### MUST REMAIN UNSET in Production
| Var | Reason |
|---|---|
| `ADMIN_DEV_BYPASS` | Already fail-closed via an explicit `NODE_ENV !== "production"` guard in both `middleware.ts` and `app/admin/(protected)/layout.tsx` — but should stay unset in Production scope as defense-in-depth, never relied upon as the only guard. |
| `NEXT_PUBLIC_DEV_BYPASS_OTP` | Local-dev-only OTP bypass (seen in prior waves' `.env.local` key inventory) — must never be set in any Vercel scope. |

**No server secret was found exposed under a `NEXT_PUBLIC_` name anywhere in source** — grep-confirmed this wave.

---

## Supabase

Not re-audited (per instruction) — using prior proven evidence from Waves 0C-2B/0C-4:
- Production must run `DATA_SOURCE=supabase`. Fail-closed behavior confirmed at source level: `resolveDataSource()` throws at request runtime if `DATA_SOURCE` isn't exactly `"supabase"` in production (build phase exempted, doesn't affect this).
- `SUPABASE_SERVICE_ROLE_KEY` is server-only everywhere in the codebase (grep-reconfirmed this wave, no new findings).
- No local-JSON fallback exists once `DATA_SOURCE` genuinely resolves to `"supabase"` — a credential/connectivity failure throws rather than silently falling back (proven in Wave 0C-2B, re-confirmed unchanged this wave since `lib/store.ts` was not touched again).
- No filesystem writes occur on the Supabase path — `SupabaseStore` only ever calls the Supabase REST client; `LocalStore`'s filesystem writes (`fs.writeFile`) are a structurally separate class, never reachable once `DATA_SOURCE=supabase`.
- **The intended Production Supabase project is the same one already proven in Wave 0C-2B/0C-4** (21 neighborhoods, 12,642 deals) — Production env vars simply don't exist in Vercel yet to point at it.

---

## OTP Strategy

```
PRIMARY PROVIDER:  Twilio Verify (TWILIO_VERIFY_SID + TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN)
                    — already the code's highest-priority path; real credentials already
                      exist locally (.env.local, prior waves), but are NOT yet in Vercel
                      at all (neither Preview nor Production).
FALLBACK:           None recommended for launch. Configuring Inforu or Green-API-WhatsApp
                    as a second OTP path adds real operational complexity (another vendor
                    credential, another failure mode to reason about) for marginal benefit
                    at initial traffic volume. Add one later only if Twilio delivery
                    problems are actually observed in production logs.
REQUIRED ENV:       TWILIO_VERIFY_SID, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN (Production scope)
FAIL-CLOSED:        Partially. If no provider is configured, sendOTP()/sendTwilioVerify()
                    return sent=false and a signed token is still issued, but in production
                    (NODE_ENV==="production") the code is never returned to the client
                    (devOtp is dev-only) and never delivered anywhere — the funnel dead-ends
                    silently rather than exposing a fake/guessable code. Safe, but not a
                    graceful user-facing error either; not independently confirmed whether
                    the wizard UI shows a clear failure message in this case (out of scope
                    to verify without exercising real OTP sends, which this wave does not do).
REAL-PHONE TEST REQUIRED BEFORE LAUNCH: YES
```

**Known blocker, proven in Wave 0C-2A:** the existing local Twilio account returned `403 — "Trial accounts cannot send messages to unverified numbers"`. This means it is currently a **trial** Twilio account. Before any real user can receive an OTP, the operator must either upgrade to a paid Twilio account or pre-verify the specific launch-test phone number(s) in the Twilio console. This is a manual operator action outside Claude's authority (billing/account changes).

---

## Admin Authentication

- **`ADMIN_EMAIL` semantics** (from `lib/adminAuth.ts`, source-verified): if set, authorizes only that exact email; if unset, production denies **all** sign-ins (fail-closed), development allows all (convenience).
- **`AUTH_SECRET`**: required by next-auth v5 for session/JWT encryption; read via the library's own env convention, not explicit application code.
- **Google OAuth is required** — `auth.ts` configures only a `Google` provider, no credentials-based fallback. **Blocking:** `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` do not exist anywhere in this project yet (see Production Environment Contract above) — a Google Cloud OAuth client must be created before admin login can work at all, in any environment.
- **Authorized callback URL**: Google OAuth requires an exact, pre-registered redirect URI per environment — `https://<domain>/api/auth/callback/google`. Vercel Preview URLs are randomly generated per deployment, so they **cannot** be practically pre-registered one-by-one. Recommendation: register only the real Production domain's callback URL; treat admin-login testing as a **Production-domain-only** activity (or, if pre-launch testing is needed, register one additional stable Preview alias domain in Vercel and its matching callback URL).
- **Preview callback behavior**: will not work today (no credentials exist), and would additionally hit the above random-URL problem even once credentials exist.
- **Production callback behavior**: will work once (a) `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` exist, (b) the Production domain's callback URL is registered in Google Cloud Console, and (c) `AUTH_SECRET`/`ADMIN_EMAIL` are set in Vercel Production scope.
- **Admin routes protected server-side**: confirmed at two layers — `middleware.ts` (matches `/admin/((?!login).*)`, redirects to `/admin/login` if no session) and `app/admin/(protected)/layout.tsx` (redirects to `/admin/login` if no session). Both share the identical `ADMIN_DEV_BYPASS` dev-only escape hatch, correctly gated behind `NODE_ENV !== "production"`.
- **DEV bypass variables that must remain absent in Production**: `ADMIN_DEV_BYPASS`.

**Exact manual actions required before Production, none performed this wave:**
1. Create a Google Cloud OAuth 2.0 Client (Web application type).
2. Register authorized redirect URI: `https://shaviut-netanya.co.il/api/auth/callback/google` (once the domain is live).
3. Add `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` to Vercel Production environment scope.
4. Set `ADMIN_EMAIL` (the operator's real Google account email) and `AUTH_SECRET` (a strong random value) in Vercel Production scope.

---

## Notifications / External Integrations

| Integration | Requires | Launch posture (recommended) |
|---|---|---|
| OTP delivery | Twilio Verify creds | **REQUIRED FOR LAUNCH** — no lead can be captured without it |
| `notifyWhatsApp` (alert to agent's own number) | `GREEN_API_ID_INSTANCE`/`TOKEN` + `LEAD_NOTIFY_WHATSAPP` | **OPTIONAL, recommended Day 1** — low risk (one message to the operator), high value |
| `sendReportToLead` (auto-report to the *consumer's* WhatsApp) | `GREEN_API_ID_INSTANCE`/`TOKEN` | **KEEP DISABLED INITIALLY** — customer-facing message content deserves a few real leads' worth of manual review before it's automatic; recommend enabling a few days after launch, not on day one |
| `appendToSheet` (Google Sheets) | `GOOGLE_SHEETS_WEBHOOK` | **OPTIONAL FOR LAUNCH** — nice-to-have, no urgency, safe to add anytime |
| Analytics (GA4 / FB Pixel) | `NEXT_PUBLIC_GA4_ID` / `NEXT_PUBLIC_FB_PIXEL_ID` | **OPTIONAL FOR LAUNCH** — safe to add anytime post-launch |

**Confirmed from source (`app/api/lead/route.ts:182-191`): leads persist to Supabase independently of every notification.** `insertLead()` is awaited and gates the HTTP response (failure → 500); `notifyNewLead(...)` runs un-awaited (`.catch()` only) *after* the insert succeeds — a WhatsApp/Sheets/analytics failure can never prevent or roll back a lead being saved.

---

## Domain / DNS

- **Intended Production domain, confirmed from source**: `shaviut-netanya.co.il` — hardcoded as `BASE_URL` in `app/layout.tsx:6` with the comment `// TODO: החלף בדומיין האמיתי` ("replace with the real domain"), used for `metadataBase`, canonical URL, and OpenGraph tags.
- **Current resolution status, checked this wave**: `shaviut-netanya.co.il` does **not resolve** (`curl`: "Could not resolve host"; `nslookup`: "Non-existent domain"). The domain does not appear to be registered yet, or has no DNS zone configured. This must be resolved (registration and/or DNS delegation) before any Vercel-side domain work is possible.
- **Registrar**: unknown from available evidence. The only `.co.il` domain visible in this Vercel account (`sikuma.co.il`) belongs to an unrelated project and its registrar ("Third Party") tells us nothing about `shaviut-netanya.co.il`'s registrar. No registrar-specific instructions are given here, per instruction.

**Cutover plan (once the domain is registered/resolvable), in Vercel-generic terms:**
1. In the Vercel project, add the domain (`shaviut-netanya.co.il`, and decide on `www.shaviut-netanya.co.il` — see below).
2. Vercel will present the exact DNS records needed — typically an `A`/`ALIAS` (or `ANAME`) record for the apex (`shaviut-netanya.co.il`) pointing at Vercel's edge, and a `CNAME` for `www` pointing at `cname.vercel-dns.com` (exact values are generated per-domain by Vercel at add-time, not invented here).
3. Add those records at whichever DNS provider actually hosts the zone (registrar's own DNS, or a separate DNS host if delegated) — outside Claude's authority to perform.
4. Vercel auto-issues SSL (Let's Encrypt) once DNS verification succeeds — typically minutes, occasionally longer depending on propagation.
5. **www vs apex**: decide canonical host (e.g., apex canonical, `www` redirects to apex, or vice versa) — Vercel's domain settings support a redirect either direction. `BASE_URL` in source is currently apex, no `www` — recommend keeping apex canonical to match existing source, with `www` set to redirect to apex.
6. **Auth callback implications**: the Google OAuth authorized redirect URI must exactly match whichever host is canonical (apex vs `www`) — mismatches cause OAuth failures.
7. **Canonical URL implications**: `metadata.alternates.canonical` and OpenGraph `url` in `app/layout.tsx` are already hardcoded to the intended apex domain — no source change needed once the domain resolves and is attached, *provided* apex is chosen as canonical (matches existing hardcoding).
8. **Analytics implications**: GA4/FB Pixel (if enabled) will start attributing traffic to the real domain once live — no special action needed beyond having the IDs set.
9. Per **Deployment Protection / Public Access** below, attaching the domain to a Production deployment is what actually makes the site publicly reachable — see next section.

---

## Deployment Protection / Public Access

- Current policy: `ssoProtection.deploymentType = "all_except_custom_domains"` — every `*.vercel.app` URL (Preview and Production alike) requires Vercel Authentication; **any deployment reached via a custom domain is automatically exempt.**
- **No protection setting needs to change for launch.** Attaching the real domain to a Production deployment is itself what creates the public, unauthenticated entry point — the existing policy already does the right thing by design.
- Preview URLs should remain protected indefinitely — they're internal-only by nature, no reason to ever open them.
- The retained baseline deployment should remain retained even after a real launch — no benefit to deleting it, and Vercel Support confirmed returning to zero deployments resets the first-deployment-classification behavior that required the baseline in the first place.
- **Recommendation: do not "promote" the old bootstrap baseline to Production for the real launch.** That deployment was intentionally created with zero application env vars, purely to satisfy Vercel's first-deployment requirement. For the real launch, create a **fresh Production deployment** from the fully-verified current HEAD, with the complete, correct Production env-var set actually configured beforehand, and attach the domain to *that* deployment. The old baseline stays as a retained, protected, historical artifact — never deleted, never domain-attached.

---

## Pre-Launch Test Matrix

Minimal operator test matrix for the final pre-launch session. **None of these were performed this wave.**

| # | Test | Side effects | Notes |
|---|---|---|---|
| 1 | Production Supabase connectivity | None (read-only) | Requires Production `DATA_SOURCE`/Supabase env vars to be set first |
| 2 | One controlled real OTP to operator-owned phone | **YES** — real SMS sent via Twilio, consumes quota | Requires the phone number to be Twilio-trial-verified or a paid Twilio account |
| 3 | OTP verify | No additional effect beyond #2 | Completes the flow started in #2 |
| 4 | One controlled lead submission | **YES** — writes a real row to the Production `leads` table | Should use an obviously-test name/phone the operator can identify and optionally clean up afterward |
| 5 | Lead persisted in Supabase | None (read-only verification of #4) | |
| 6 | Expected WhatsApp behavior, if enabled | **YES** — real WhatsApp messages sent (to agent and/or the test lead's own number) | Only relevant if Green API is configured for launch |
| 7 | Expected Sheets behavior, if enabled | **YES** — writes a real row to the configured Sheet | Only relevant if `GOOGLE_SHEETS_WEBHOOK` is configured for launch |
| 8 | Admin login (real Google OAuth) | Creates a real OAuth session/grant | Requires Google OAuth client + callback URL to already be configured |
| 9 | Mobile/desktop smoke | None | Same pattern already proven across Waves 0C-4/0C-4B/0C-4C/0C-4D |
| 10 | Logs / PII check | None (read-only) | Same pattern already proven across prior waves |
| 11 | Rollback check | None — a **dry confirmation** that the rollback target/procedure is understood, not an actual rollback execution | Do not rehearse a real domain detachment or deployment rollback against a live Production site without a specific reason to |

---

## Cutover Procedure

1. Confirm `shaviut-netanya.co.il` is registered and its DNS zone is reachable/manageable.
2. Set the full Production environment-variable set in Vercel (see contract above) — including the still-missing `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`.
3. Create the Google OAuth client and register its Production callback URL.
4. Deploy a fresh Production deployment from the fully-verified current HEAD (`vercel deploy --prod`, no `--skip-domain` this time, since a real domain now needs attaching) — or deploy first, verify, then attach the domain as a separate step; either order is safe since the protection policy already gates `*.vercel.app` URLs.
5. Add the domain to the project in Vercel; configure the DNS records it specifies.
6. Wait for DNS propagation + automatic SSL issuance.
7. Run the Pre-Launch Test Matrix above against the live domain.
8. Only after all required tests pass, treat the site as launched.

## Rollback Procedure

- **Revert Production to a prior safe deployment**: use Vercel's native "promote a previous Ready deployment to Production" capability (Vercel Dashboard → Deployments → select a known-good prior deployment → promote), or redeploy a known-good commit fresh. No destructive action needed — the prior deployment artifacts aren't deleted by a rollback.
- **Detach/redirect the custom domain**: remove the domain from the Production deployment in Vercel's domain settings, or repoint it at a deliberate maintenance/placeholder deployment. This alone returns the public site to unreachable (falls back to the same protected-only state the project is in today).
- **Disable OTP/providers quickly**: remove (or blank) the relevant Production env var(s) — e.g., `TWILIO_ACCOUNT_SID` — and redeploy. `sendOTP`/`sendTwilioVerify` already degrade gracefully to `sent:false` when credentials are absent (proven from source, not assumed) — no code change needed as a kill switch.
- **Preserve Supabase leads/data**: none of the above Vercel-side actions touch Supabase in any way — Vercel and Supabase are fully decoupled systems. Leads/deals/neighborhoods data is never at risk from a Vercel-side rollback.
- **What must NOT be deleted**: the retained Production baseline deployment; the Supabase project and its tables; any lead data already collected; the Vercel project itself.
- **Return to maintenance/protected state**: simply detach the domain — this is sufficient and reversible; no deployment needs to be deleted.

---

## Blocking Items

1. **Google OAuth credentials do not exist anywhere** (`AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`) — admin login cannot work in any environment until a Google Cloud OAuth client is created and its credentials added to Vercel.
2. **Production has zero environment variables configured** — none of the 6 required vars exist in Production scope yet.
3. **OTP provider credentials are not in Vercel at all** (only locally in `.env.local`), and the existing local Twilio account is a **trial** account restricted to pre-verified numbers (proven in Wave 0C-2A) — must be resolved before real users can receive OTPs.
4. **The intended domain `shaviut-netanya.co.il` does not currently resolve** — must be registered and DNS-configured before Vercel domain attachment is even possible.
5. **A real, controlled end-to-end test** (OTP send → verify → lead submit → Supabase-persisted) has never been run against real Production-equivalent configuration — required once items 1–4 are resolved, before public launch.

## Deferred Items (safe to defer)

1. `favicon.ico` 404 — cosmetic, unchanged across every wave so far.
2. `sendReportToLead` (auto-WhatsApp report to the consumer) — recommend enabling a few days after launch, once real lead traffic has validated the message content.
3. Google Sheets webhook integration — nice-to-have, no urgency.
4. GA4 / FB Pixel analytics — safe to add anytime post-launch.
5. Inforu / Green-API-WhatsApp as OTP fallback providers — Twilio Verify alone is sufficient for launch; add a fallback later only if real delivery problems are observed.
6. In-memory rate limiter → Redis/Upstash — a known, source-documented scaling limitation (`lib/rateLimit.ts`'s own comment), not urgent at initial launch traffic volumes.

## Operator Manual Actions Required (outside Claude's authority)

1. Register/confirm DNS control of `shaviut-netanya.co.il`.
2. Create a Google Cloud OAuth 2.0 Client and register the Production callback URL.
3. Resolve the Twilio trial-account restriction (upgrade to paid, or pre-verify test numbers).
4. Add all required Production environment variables in the Vercel dashboard.
5. Add the domain to the Vercel project and configure the DNS records Vercel specifies.
6. Run the Pre-Launch Test Matrix personally (several of its steps have real side effects Claude should not trigger unprompted).

## Recommended Next Step

Work through the Operator Manual Actions above in order (DNS → Google OAuth → Twilio → Vercel env vars → domain attachment), then request a fresh wave to execute the Cutover Procedure once every Blocking Item is resolved. Do not attach the domain or configure Production env vars until the operator confirms each manual action is complete.
