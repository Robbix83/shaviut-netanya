# External Dependencies Inventory — Phase 14

Audited: 2026-08-19  
Status codes: VERIFIED = confirmed by direct code read; LIKELY = inferred from pattern; UNKNOWN = not findable.

---

## 1. nadlan.gov.il (Israel Tax Authority — Real Estate Transactions)

| Attribute | Detail |
|-----------|--------|
| Purpose | Primary source of transaction data. Intercepted via Playwright browser automation. |
| Files | `scripts/harvest.ts`, `scripts/harvest-missing.ts`, `scripts/harvest-streets.ts` |
| How Called | Playwright navigates `https://www.nadlan.gov.il/`, fills the search input, picks autocomplete suggestion, intercepts XHR `GET /deal-data` responses. |
| Auth | None — reCAPTCHA v3 Enterprise is the anti-bot mechanism. Bypassed via persistent Chrome profile (`~/.harvest-chrome`) + puppeteer-extra-plugin-stealth. |
| Rate Limiting | Self-imposed: `POLITE_DELAY_MS = 4000` between neighbourhoods/streets. No server-side rate limit information available. |
| Timeout | Playwright page `goto` timeout 45 s; scroll wait 2500 ms per round. No explicit HTTP timeout on the intercepted fetch. |
| Error Handling | 405 response body (`decoded?.statusCode === 405`) signals reCAPTCHA block. Caught per neighbourhood; script continues with `console.log("שגיאה")`. No retry. |
| Retry | None. VERIFIED. |
| Fallback | If reCAPTCHA blocks and collected.length === 0, `harvestNeighborhood` throws and the neighbourhood is skipped. VERIFIED (harvest.ts line 373). |
| What Breaks if Down | Harvest run collects 0 deals; `deals.json` / Supabase are not updated (the old data is preserved). No alert is sent. |
| Monitoring | None. VERIFIED ABSENT. |

---

## 2. govmap.gov.il / es.govmap.gov.il (Israel National Mapping Authority)

### 2a. TldSearch API (AutoComplete + DetailsByQuery)

| Attribute | Detail |
|-----------|--------|
| Purpose | (1) Address autocomplete for the UI. (2) Resolve address text → ITM coordinates. (3) Discover neighbourhood ObjectIDs for harvest seeding. |
| Files | `lib/govmap.ts` (`autocomplete`, `resolvePoint`), `scripts/discover-neighborhoods.ts`, `scripts/discover-streets.ts`, `scripts/harvest.ts` (`discoverNeighborhoods`) |
| How Called | Plain `fetch` with spoofed headers (`Referer: https://www.nadlan.gov.il/`, `Origin: https://www.nadlan.gov.il`). `lib/govmap.ts` adds an in-process LRU cache (TTL 30 min). |
| Auth | None. Public API. Headers spoof nadlan.gov.il to avoid potential referrer restrictions. |
| Rate Limiting | No programmatic rate limit on the client side except 800 ms sleeps in discover scripts. `lib/govmap.ts` has 30-min cache. |
| Timeout | 8 seconds abort via `AbortController` (lib/govmap.ts line 31). |
| Error Handling | Returns `null` on non-OK response, non-JSON content-type, or exception. All callers treat `null` as "no result". VERIFIED. |
| Retry | None (lib/govmap.ts). `discover-neighborhoods.ts` retries 3 times with 1500 ms sleep. VERIFIED. |
| Fallback | Valuation API falls back to neighbourhood name text-match if govmap returns null (app/api/valuation/route.ts line 106). VERIFIED. |
| What Breaks if Down | Address autocomplete fails silently; UI shows no suggestions. Valuation may still succeed via text-match fallback. `discover-*` scripts fail per-name silently. |
| Monitoring | None. VERIFIED ABSENT. |

### 2b. WFS Parcel Layer (enrich-plot.ts)

| Attribute | Detail |
|-----------|--------|
| Purpose | Retrieve plot area (legal_area) for house-type transactions. |
| Files | `scripts/enrich-plot.ts` |
| How Called | Playwright opens `https://www.govmap.gov.il/?c=...&z=15&b=0` to obtain session cookies, then runs `page.evaluate(fetch("/api/geoserver/wfs?..."))` from inside the browser context. The WFS endpoint is a relative path (`/api/geoserver/wfs`) that the server enforces must come from govmap's own origin. |
| Auth | govmap session cookies obtained by navigating the page. No API key. |
| Rate Limiting | 300 ms sleep between queries (`SLEEP_MS = 300`). |
| Timeout | None explicit on the in-browser fetch — browser default. LIKELY 30 s. |
| Error Handling | `!res.ok` or non-JSON content-type → returns `null`. Exception in `page.evaluate` → `null`. VERIFIED (lines 58-60). |
| Fallback | Deal retains `plotSqm = null` if WFS fails. |
| What Breaks if Down | enrich-plot.ts run completes with `failed` count; `plotSqm` is not populated for affected house deals. |
| Monitoring | None. VERIFIED ABSENT. |

---

## 3. Supabase (PostgreSQL-as-a-Service)

| Attribute | Detail |
|-----------|--------|
| Purpose | Production data store for `deals`, `neighborhoods`, and `leads` tables. |
| Files | `lib/store.ts` (`SupabaseStore` class), all harvest scripts when `DATA_SOURCE=supabase` |
| How Called | `@supabase/supabase-js` client, created per request (`await this.client()` — no connection pool singleton in the store class). |
| Auth | `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (service-role, bypasses RLS). VERIFIED (store.ts lines 183-185). |
| Rate Limiting | None on client side. Supabase free-tier limits apply. |
| Timeout | None configured. UNKNOWN — Supabase JS client has internal timeout defaults. |
| Error Handling | Harvest scripts: no error handling around `sb.from("deals").upsert(...)` — an error will crash the script. VERIFIED (harvest.ts lines 523-526). API routes: `if (error) throw error` in `SupabaseStore` methods; caught by Next.js 500 handler. VERIFIED. |
| Retry | None. VERIFIED ABSENT. |
| Fallback | `DATA_SOURCE` defaults to `"local"` (JSON files) if the env var is not set. The fallback is file-based `LocalStore`. VERIFIED (store.ts line 12). |
| What Breaks if Down | All API routes using `getStore()` (valuation, lead, market, neighborhoods, admin) return 500. Harvest writes fail silently unless the upsert throws. |
| Monitoring | None. VERIFIED ABSENT. |

**Risk:** `SupabaseStore.client()` is called on every method invocation, creating a new client each time. This may cause connection limit issues under load. LIKELY.

---

## 4. Green API (WhatsApp Business)

| Attribute | Detail |
|-----------|--------|
| Purpose | (1) Send new-lead notification to the agent. (2) Send valuation report to the lead. (3) Send OTP codes (fallback to WhatsApp if no SMS provider configured). (4) Receive STOP/opt-out messages via webhook. |
| Files | `lib/notify.ts` (sendWhatsApp, notifyWhatsApp, sendReportToLead), `app/api/otp/send/route.ts` (sendWhatsApp), `app/api/webhook/green/route.ts` |
| How Called | Plain `fetch` POST to `https://api.green-api.com/waInstance${id}/sendMessage/${token}`. |
| Auth | `GREEN_API_ID_INSTANCE` (instance ID) + `GREEN_API_TOKEN_INSTANCE` (API token) embedded in URL path. VERIFIED (notify.ts line 56). |
| Rate Limiting | Green API free tier: 100 messages/day; paid tiers unlimited. No client-side rate limit implemented. |
| Timeout | None configured. VERIFIED ABSENT. |
| Error Handling | `try/catch` wrapping each send; returns `false` on failure. All three sends in `notifyNewLead` run via `Promise.allSettled` — failures do not propagate. VERIFIED (notify.ts lines 144-150). |
| Retry | None. VERIFIED ABSENT. |
| Fallback | If `GREEN_API_ID_INSTANCE` is not set: `sendWhatsApp` returns `false`; `notifyNewLead` proceeds without notification. Lead is still saved to the database. VERIFIED. |
| What Breaks if Down | Agent does not receive lead notification; lead receives no report; OTP not delivered if no other SMS provider is configured. Lead is still inserted into the database. |
| Monitoring | None. VERIFIED ABSENT. |

**Webhook security:** `app/api/webhook/green/route.ts` validates `?token=GREEN_WEBHOOK_TOKEN` only if the env var is set. If the env var is absent, any HTTP caller can trigger an opt-out for any phone number. VERIFIED (line 36-37). RISK.

---

## 5. Google Sheets (via Apps Script Web App)

| Attribute | Detail |
|-----------|--------|
| Purpose | Append a row for each new lead to a Google Sheet (CRM backup). |
| Files | `lib/notify.ts` (`appendToSheet`), `scripts/google-apps-script.gs` |
| How Called | `fetch` POST to `GOOGLE_SHEETS_WEBHOOK` URL (the Apps Script doPost endpoint). |
| Auth | The webhook URL itself is the auth token (unguessable). No additional auth header. |
| Rate Limiting | None configured. Apps Script: 20 req/s default quota. |
| Timeout | None configured. VERIFIED ABSENT. |
| Error Handling | `try/catch` returning `false` on failure. Best-effort; failure is logged nowhere. VERIFIED (notify.ts lines 121-140). |
| Retry | None. VERIFIED ABSENT. |
| Fallback | If `GOOGLE_SHEETS_WEBHOOK` is not set, function returns `false` immediately. VERIFIED (line 119). |
| What Breaks if Down | Leads not logged to Google Sheet; all other functionality unaffected. |
| Monitoring | None. VERIFIED ABSENT. |

---

## 6. MAVAT / iplan.gov.il (Israel Planning Authority)

| Attribute | Detail |
|-----------|--------|
| Purpose | Retrieve active building plans, demolition entities, and land-use zones near a coordinate. |
| Files | `lib/mavat.ts` (`fetchMavatData`), `app/api/mavat/route.ts` |
| How Called | Plain `fetch` GET to `https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/Xplan/MapServer/{layer}/query?f=json&...`. Three layers (1, 3, 4) queried in parallel. |
| Auth | None. Public ArcGIS REST service. |
| Rate Limiting | None configured. |
| Timeout | 10 s via `AbortController` per layer query. VERIFIED (mavat.ts line 97). |
| Error Handling | `!res.ok` or non-JSON → returns `[]` (empty features). Exception in catch → `[]`. VERIFIED (lines 101-109). |
| Retry | None. VERIFIED ABSENT. |
| Fallback | If all layers return empty, `fetchMavatData` returns `null`. `app/api/mavat/route.ts` returns 404. VERIFIED. |
| Cache | In-process Map with 6-hour TTL, keyed by coordinates rounded to 100 m grid. VERIFIED (mavat.ts lines 63-68). |
| What Breaks if Down | MAVAT card in UI not shown (404); valuation and lead capture are unaffected. |
| Monitoring | None. VERIFIED ABSENT. |

---

## 7. data.gov.il CKAN API

### 7a. Real Estate Transactions Resource

| Attribute | Detail |
|-----------|--------|
| Purpose | Alternative/supplementary harvest of Netanya transactions. Resource id `43a3b913-e4e2-4a1d-9e96-6982ef5a9e5a`. |
| Files | `scripts/fetch-datagov.ts` |
| How Called | Plain `fetch` GET with `User-Agent: Shaviut-Netanya/1.0 (public data research)`. |
| Auth | None. Public CKAN API. |
| Rate Limiting | 300 ms delay between pages (self-imposed). |
| Timeout | None configured. VERIFIED ABSENT. |
| Error Handling | `if (!res.ok) throw new Error(...)` per page; caught in loop and skipped. VERIFIED. If resource_id changes: `total === 0` → `process.exit(1)`. VERIFIED (line 158). |
| Fallback | None — script exits with code 1 on zero total. |
| What Breaks if Down | Harvest run fails; existing `deals.json` preserved. |
| Monitoring | None. VERIFIED ABSENT. |

### 7b. Urban Renewal Complexes Resource

| Attribute | Detail |
|-----------|--------|
| Purpose | List of urban-renewal project complexes in Netanya. Resource id `f65a0daf-f737-49c5-9424-d378d52104f5`. |
| Files | `scripts/fetch-renewal.ts` |
| How Called | Plain `fetch` GET with `limit=500` and `filters={SemelYeshuv:7400}`. |
| Auth | None. |
| Error Handling | No try/catch on data.gov.il fetch — HTTP errors throw and crash the script. VERIFIED (line 42). |
| Fallback | None for data.gov.il. ArcGIS fetch has fallback (logs warn, continues with null coords). VERIFIED. |
| Monitoring | None. |

---

## 8. ArcGIS UrbanRenewalPro FeatureServer

| Attribute | Detail |
|-----------|--------|
| Purpose | Fetch ITM centroid coordinates for urban-renewal project complexes. |
| Files | `scripts/fetch-renewal.ts` (lines 79-94) |
| How Called | `fetch` GET to `https://services6.arcgis.com/I08Ekaykft5ELucH/arcgis/rest/services/GIS_UrbanRenewalPro/FeatureServer/1/query?...&outSR=2039`. |
| Auth | None. Public ESRI hosted service. |
| Error Handling | `try/catch`; on failure logs `console.warn` and proceeds with null coordinates. VERIFIED. |
| Fallback | Falls back to street-level coordinates from `street-index.json`. VERIFIED. |
| What Breaks if Down | `renewal.json` written with `x: null, y: null` for complexes without street-coordinate fallback. |
| Monitoring | None. |

---

## 9. SMS Providers (OTP delivery)

Three providers are tried in priority order in `app/api/otp/send/route.ts`.

### 9a. Twilio Verify

| Attribute | Detail |
|-----------|--------|
| Purpose | Preferred OTP delivery via Twilio Verify API (Twilio manages the code). |
| Files | `app/api/otp/send/route.ts` (`sendTwilioVerify`) |
| Auth | HTTP Basic: `TWILIO_ACCOUNT_SID` : `TWILIO_AUTH_TOKEN`. `TWILIO_VERIFY_SID` for service. |
| Error Handling | `!r.ok` logs error to console; returns `false`. Exception logs and returns `false`. VERIFIED. |
| Fallback | If `TWILIO_VERIFY_SID` / `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` not all set, this path is skipped. VERIFIED (line 37-39). |

### 9b. Inforu (Israeli SMS)

| Attribute | Detail |
|-----------|--------|
| Purpose | SMS OTP delivery via Inforu XML API. |
| Files | `app/api/otp/send/route.ts` (`sendInforu`) |
| Auth | `INFORU_USER` + `INFORU_PASS` embedded in XML body. |
| Error Handling | `try/catch` returning `false`. Response parsed for `<Result>1</Result>`. VERIFIED. |
| Fallback | Skipped if env vars not set. |

### 9c. Twilio SMS (plain)

| Attribute | Detail |
|-----------|--------|
| Purpose | Fallback SMS via Twilio Messages API. |
| Files | `app/api/otp/send/route.ts` (`sendTwilio`) |
| Auth | HTTP Basic: `TWILIO_ACCOUNT_SID` : `TWILIO_AUTH_TOKEN`. `TWILIO_FROM` for sender. |
| Error Handling | `!r.ok` logs error; returns `false`. VERIFIED. |

### 9d. Green API WhatsApp (OTP fallback)

| Attribute | Detail |
|-----------|--------|
| Purpose | Last-resort OTP delivery via WhatsApp if no SMS provider configured. |
| Files | `app/api/otp/send/route.ts` (`sendWhatsApp`) |
| Auth | `GREEN_API_ID_INSTANCE` + `GREEN_API_TOKEN_INSTANCE`. |
| Error Handling | `try/catch` returning `false`. VERIFIED. |
| What Breaks if None Configured | `sendOTP` returns `false`; in dev mode the OTP is returned in the response body (`devOtp`). In production no OTP is delivered, but the `token` is still returned, so a user who intercepts the token can verify any code. RISK in production if NODE_ENV is not `"production"`. VERIFIED (lines 55-57). |

---

## 10. CBS / Lemmas (Central Bureau of Statistics)

| Attribute | Detail |
|-----------|--------|
| Purpose | Socio-economic neighbourhood profile (score 1–10, demographics, wage, education). |
| Files | `lib/cbs.ts`, `scripts/fetch-cbs.ts` (data collection), `app/api/cbs/route.ts` |
| How Called | Data is pre-fetched by `scripts/fetch-cbs.ts` and stored in `data/cbs-netanya.json`. Runtime reads from file only — **no live API call at request time**. VERIFIED (cbs.ts lines 63-72). |
| Auth | None. |
| Rate Limiting | N/A (file read). |
| Error Handling | File read wrapped in try/catch; on failure `_data = { city: null, statAreas: [] }`. `getNeighborhoodProfile` returns `null`. VERIFIED. |
| Fallback | Returns city-average profile if no neighbourhood-specific stat area is mapped (`NH_MAP`). VERIFIED (cbs.ts line 141). |
| Neighbourhood Coverage | VERIFIED PARTIAL — only `קריית צאנז` has a specific stat-area mapping (`NH_MAP`). All other neighbourhoods receive city-average data with `precision: "city"`. VERIFIED (cbs.ts lines 53-56). |
| What Breaks if Down | File missing → all profiles return null or city-average. Minimal impact (display only). |
| Monitoring | None. |

---

## 11. nextauth / Authentication

| Attribute | Detail |
|-----------|--------|
| Purpose | Admin panel authentication (`app/api/admin/**`). |
| Files | `app/api/auth/[...nextauth]/route.ts` |
| How Called | NextAuth.js library. |
| Auth | Credentials provider (email/password), or OAuth provider — not readable without reading the file. UNKNOWN (file not audited in this phase). |
| What Breaks if Down | Admin panel inaccessible. Public-facing pages unaffected. |

---

## Dependency Matrix Summary

| Service | Runtime (request-time) | Offline (script) | Required | Has Fallback | Has Timeout | Has Monitoring |
|---------|------------------------|------------------|----------|--------------|-------------|----------------|
| nadlan.gov.il | No | Yes (harvest) | Yes | No | 45 s (Playwright) | No |
| govmap TldSearch | Yes (autocomplete, valuation) | Yes (discover/harvest) | Partial | Yes (text-match) | 8 s | No |
| govmap WFS | No | Yes (enrich-plot) | No | No | None | No |
| Supabase | Yes (all API routes) | Yes (harvest if set) | Prod only | Yes (LocalStore) | None | No |
| Green API | Yes (OTP, lead notify) | No | No | Yes (no-op) | None | No |
| Google Sheets | Yes (lead notify) | No | No | Yes (no-op) | None | No |
| MAVAT/iplan | Yes (/api/mavat) | No | No | Yes (404) | 10 s | No |
| data.gov.il CKAN | No | Yes (fetch-datagov, fetch-renewal) | No | No | None | No |
| ArcGIS ESRI | No | Yes (fetch-renewal) | No | Yes (street coords) | None | No |
| Twilio Verify | Yes (OTP) | No | No | Inforu/Twilio/Green | None | No |
| Inforu SMS | Yes (OTP) | No | No | Twilio/Green | None | No |
| CBS file | Yes (/api/cbs) | No | No | Yes (city avg) | N/A | No |

---

## Cross-Cutting Risks

1. **No monitoring on any external service.** There are no health-check endpoints, alerting on harvest failures, or error reporting services (Sentry/Datadog). VERIFIED ABSENT.

2. **No timeout on Supabase client calls.** A slow or unresponsive Supabase can stall Next.js route handlers indefinitely. VERIFIED ABSENT.

3. **Green API webhook unauthenticated if `GREEN_WEBHOOK_TOKEN` is not set.** Any caller can trigger opt-out for any phone number. VERIFIED (webhook/green/route.ts line 36).

4. **OTP `devOtp` leaked in response when `NODE_ENV !== "production"`** — if deployed to a staging environment with default env, the OTP is visible in the API response, making phone verification trivially bypassable. VERIFIED (otp/send/route.ts line 57).

5. **Supabase `SupabaseStore.client()` creates a new client on every method call.** Under concurrent requests this could exhaust the Supabase free-tier connection limit. LIKELY.

6. **CBS neighbourhood coverage is nearly zero** — 22 of 23 neighbourhoods receive city-average data, labelled `precision: "city"`. Only קריית צאנז has a specific mapping. VERIFIED.
