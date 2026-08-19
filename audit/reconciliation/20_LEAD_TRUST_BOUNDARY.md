# 20 — LEAD TRUST BOUNDARY (HIGH PRIORITY)

**Phase:** WAVE 0R
**Method:** Source inspection (VERIFIED) + safe local cryptographic reproduction (VERIFIED). No production tested. No code modified.

---

## EXECUTIVE VERDICT

The OTP phone-verification system is **decorative from a server-enforcement standpoint**. Two independent, individually-sufficient gaps mean the server never requires proof of phone ownership to create a lead:

1. **`POST /api/lead` requires NO OTP proof at all** — it accepts name + phone + consent and writes a lead, never receiving or checking an OTP token. This is **provider-independent** (true for Twilio Verify AND the SMS-fallback path). **[VERIFIED — CONFIRMED P1]**
2. **On the SMS-fallback path only**, the OTP code is embedded in plaintext inside the token returned by `POST /api/otp/send` (`base64url` is encoding, not encryption). **This does NOT apply when Twilio Verify is configured** (the currently-configured provider) — see the correction under Q3. **[VERIFIED but CONDITIONAL — applies only if an SMS-fallback provider is active]**

Additionally, the browser-supplied `valuation` object is persisted and forwarded to WhatsApp/Sheets **without server recomputation** — a caller can inject arbitrary estimate values. **[VERIFIED — CONFIRMED P2]**

> **Correction (post independent review):** An earlier draft of this report labelled finding #2 as an unconditional P2. That was **OVERSTATED**. `send/route.ts:36-53` branches on `useTwilioVerify`: when the three Twilio Verify env vars are present (they are, per 19_PRODUCTION_FACTS local evidence), the token is signed over the sentinel string `"VERIFY"` (not the code), and the real code lives only at Twilio, re-checked in `verify/route.ts:27-30`. The plaintext-in-token weakness therefore materializes **only** if the deployment falls back to Inforu / Twilio-SMS / Green-API OTP. Finding #1 is the durable, provider-independent gap.

---

## R0.4 QUESTIONS — ANSWERED WITH EVIDENCE

### Q1. Does `POST /api/lead` independently require server-verifiable proof that THIS phone completed OTP?
**NO. [VERIFIED]**
Evidence: [`app/api/lead/route.ts:33-110`](../../app/api/lead/route.ts). The handler:
- rate-limits by IP (`lead:${ip}`, 3/hr),
- validates `name.length >= 2`,
- validates `phone` against `PHONE_RE`,
- requires `consentReport === true`,
- builds a `Lead` and calls `getStore().insertLead(lead)`.

There is **no `token` field in the `Body` interface** (lines 9-29), **no import of `verifyToken`**, and **no call to any OTP-verification function**. The OTP token produced by `/api/otp/send` and validated by `/api/otp/verify` is never presented to, nor checked by, `/api/lead`.

### Q2. Can a caller directly POST name + phone + consentReport=true and create a lead WITHOUT using `/api/otp/verify`?
**YES. [VERIFIED by source; not executed against a running server to avoid polluting data.]**
Nothing in `/api/lead` links a submission to a prior OTP verification. The only barriers are the IP rate-limit (3/hr) and field validation. A script POSTing `{name, phone, consentReport:true}` creates a lead and triggers agent-WhatsApp + client-WhatsApp + Google-Sheets notifications.
> NOT TESTED against production (prohibited). NOT executed locally against a live dev server to avoid writing junk into `data/leads.json`. Source evidence is conclusive.

### Q3. OTP token properties
Evidence: [`lib/otp.ts`](../../lib/otp.ts).

| Property | Verdict | Evidence |
|----------|---------|----------|
| Code cryptographically random | **YES** | `crypto.randomInt(900000)` (`otp.ts:16`) |
| Token bound to phone | **YES** | payload `${phone}:${otp}:${expires}` HMAC-signed (`otp.ts:20-25`) |
| Token bound to OTP code | **YES (but see below)** | code is inside the signed payload |
| Expiry enforced | **YES** | `Date.now() > expires` (`otp.ts:51`), TTL 5 min |
| Verification rate limited | **NO** | `/api/otp/verify` has NO `rateCheck` call ([`verify/route.ts`](../../app/api/otp/verify/route.ts)) |
| Token single-use | **NO** | Stateless HMAC, no server store; the same token+code verifies repeatedly within 5 min |
| Token replayable | **YES** | within the 5-min window, unlimited replays |
| **Code recoverable from token** | **YES — CRITICAL** | `signToken` returns `base64url(payload\|sig)`; `payload` contains the plaintext code |

**Local reproduction (VERIFIED, dummy secret, no real credentials) — SMS-FALLBACK PATH ONLY:** decoding a token signed over a real generated code yields `0501234567:147479:<expires>|<sig>` — the 6-digit code (`147479`) is read directly from the token without any SMS. `base64url` is an encoding, not encryption.
**However, on the Twilio Verify path (the configured provider), the token is signed over the sentinel `"VERIFY"`, not the code** (`send/route.ts:47-48`, `otp.ts:52`), so nothing sensitive is recoverable and the code is validated server-to-server against Twilio (`verify/route.ts:35-56`). The plaintext-recovery attack is therefore **conditional on an SMS-fallback provider being active**, not a property of the configured deployment.
Independently, a genuinely provider-independent weakness remains: **`/api/otp/verify` has no rate limit** (`verify/route.ts` has no `rateCheck`). On the SMS-fallback path this permits brute-forcing the 6-digit code; on the Twilio Verify path Twilio enforces its own attempt caps.

> Note: even the HMAC `OTP_SECRET` strength is moot for this attack — the attacker does not forge a token, they read the code out of a legitimately-issued one. (`OTP_SECRET` still matters against forgery, and it falls back to a hardcoded dev default when unset — `otp.ts:10-12`.)

### Q4. Does verified-OTP state exist SERVER-SIDE after verification?
**NO. [VERIFIED]** The design is explicitly stateless ("OTP stateless — HMAC-SHA256 signed token … לא דורש DB", `otp.ts:2-5`). `/api/otp/verify` returns `{valid:true, phone}` to the client and stores nothing. There is no server record that "phone X passed OTP", so `/api/lead` could not check it even if it wanted to.

### Q5. Does the client alone decide that OTP passed?
**YES. [VERIFIED]** The verify endpoint returns a boolean to the browser; the browser then independently calls `/api/lead`. The trust that "this lead's phone was verified" lives entirely in client-side flow control.

### Q6. Can bypass flags expose a production bypass?
**CONDITIONAL / PRESENCE-ONLY.**
- `send/route.ts:55,61` returns `devOtp` **only when `NODE_ENV !== "production"`** — so the server does not leak the code via that field in a correct production build. **[VERIFIED for the server path]**
- `NEXT_PUBLIC_DEV_BYPASS_OTP` is a **client-baked** flag (any `NEXT_PUBLIC_*` var is inlined into the browser bundle at build time). If set truthy during a production build, the client could skip OTP UI entirely. It is present in `.env.local` (local only). **Production build value is UNKNOWN** (Vercel env not accessible). A local `.next` scan found no bypass reference, but no fresh production build was inspected. **[CONDITIONAL_PRODUCTION_RISK]**
- `ADMIN_DEV_BYPASS` (middleware) is guarded by `NODE_ENV !== "production"` (`middleware.ts:6-9`), so it cannot bypass admin auth in a correct production environment. **[VERIFIED for the code path; prod NODE_ENV assumed standard]**

---

## CLIENT-TRUSTED VALUATION

**Finding: the server persists and forwards client-supplied valuation values without recomputation. [VERIFIED — CONFIRMED P2]**

Evidence: [`app/api/lead/route.ts`](../../app/api/lead/route.ts):
- Line 28: `valuation?: Valuation | null` accepted in the request body.
- Lines 83-84: `estimateLow: body.valuation?.estimateLow ?? null`, `estimateHigh: body.valuation?.estimateHigh ?? null` — **persisted directly from client input** into the stored `Lead`.
- Line 107: `notifyNewLead(saved, body.valuation)` — the **entire client valuation object** is forwarded.

Downstream, in [`lib/notify.ts`](../../lib/notify.ts):
- `buildLeadMessage` (agent WhatsApp) uses `v.estimateLow/estimateHigh` (lines 33-35).
- `buildReportMessage` (client WhatsApp report) uses `v.pricePerSqmMid`, `v.basedOnDeals`, and iterates `v.comparableDeals` (lines 82-93).
- `appendToSheet` (Google Sheets) writes `v?.estimateLow/estimateHigh` (lines 133-134).

A caller can therefore set arbitrary `estimateLow`, `estimateHigh`, `pricePerSqmMid`, `basedOnDeals`, `comparableDeals`, `neighborhood`, `scope`, `confidence` and cause those forged values to appear in: the stored lead (admin dashboard), the agent's WhatsApp alert, the WhatsApp "report" sent to the (attacker-chosen) phone, and the Google Sheet. The server does **not** call `valuate()` at lead time to recompute or cross-check.

**Severity rationale:** This is **P2**, not P0/P1 — it does not breach other users' data or grant privileged access. Its impact is (a) admin dashboard / Sheets values are untrustworthy for any lead, and (b) the client-report WhatsApp path can be weaponized to send arbitrary "official-looking" valuations to arbitrary numbers (spam/social-engineering vector, amplified by Q1/Q2 which remove the phone-ownership check). If combined with a marketing/pricing decision made off stored `estimateLow/High`, integrity impact rises.

---

## SEVERITY SUMMARY

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | `/api/lead` requires no OTP proof → leads forgeable without verification (provider-independent) | **P1** | VERIFIED / CONFIRMED |
| 1b | #1 combined with `sendReportToLead` → server sends "official" WhatsApp valuation reports to **attacker-chosen numbers** (operator Green-API cost + WhatsApp-ban risk) | **P1** | VERIFIED / CONFIRMED (elevated after independent review) |
| 2 | OTP code recoverable from token **on SMS-fallback path only**; not applicable under configured Twilio Verify | **Conditional (≈N/A as configured)** | VERIFIED but CONDITIONAL |
| 2b | `/api/otp/verify` has no rate limit → brute-force on SMS-fallback path (Twilio Verify has its own caps) | **P2 (conditional)** | VERIFIED |
| 3 | Client valuation persisted + forwarded without server recompute | **P2** | VERIFIED / CONFIRMED |
| 4 | `NEXT_PUBLIC_DEV_BYPASS_OTP` could bypass client OTP UI if set in prod build | **P2** | CONDITIONAL_PRODUCTION_RISK (prod value UNKNOWN) |

**Why #1 is P1 not P0:** it does not expose existing data or grant admin; it enables junk/forged lead creation (spam, poisoned pipeline) subject only to a 3/hr IP rate limit. Still the most important lead-integrity gap and belongs in the first remediation wave.
**Why 1b is elevated (independent-review catch):** because `/api/lead` also triggers `sendReportToLead` (`notify.ts:112-114`), an unauthenticated caller can make the server dispatch branded WhatsApp "valuation reports" (with attacker-supplied figures, per finding #3) to **arbitrary phone numbers**. This turns the missing proof into an outbound-messaging abuse channel that spends the operator's Green-API quota and risks the operator's WhatsApp number being flagged/banned. Provider-independent.

---

## RECOMMENDATION DIRECTION (not implemented this phase)
- Bind lead creation to a fresh, single-use, server-verifiable proof of OTP for the **same** phone (e.g. a short-lived signed "verified" token issued by `/api/otp/verify`, distinct from the send-token, that `/api/lead` must present and that is invalidated on use). Do **not** ship the code inside any client-visible token.
- Recompute valuation server-side at lead time (or sign the valuation server-side when first computed and verify the signature at lead time) instead of trusting client values.
- Add rate limiting to `/api/otp/verify`.
- These are design changes — deferred to the corrected roadmap (Wave 0A/1). No code changed in this phase.
