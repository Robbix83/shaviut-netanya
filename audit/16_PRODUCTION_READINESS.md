# Phase 15 — Production Readiness Audit

**App:** shaviut-netanya (Next.js 16 / React 19 / Tailwind / RTL Hebrew)
**Date:** 2026-08-19
**Auditor:** Forensic read-only pass — no files modified

---

## 1. next.config.mjs — Production Configuration

**VERIFIED — incomplete for production.**

```js
// next.config.mjs (full file)
const nextConfig = {
  reactStrictMode: process.env.NODE_ENV === "production",
  allowedDevOrigins: ["10.100.102.76"],
  onDemandEntries: { maxInactiveAge: 30 * 60 * 1000, pagesBufferLength: 5 },
};
```

Missing:
- **`output: "standalone"`** — required for Docker and most PaaS deployments (Railway, Fly.io, Render). Without it, deploying the app requires the full `node_modules` directory.
- **`headers()`** — no security headers configured: no `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`. The app is served without any HTTP security hardening.
- **`compress`** — not set; Next.js defaults to gzip but this is not explicit or configurable without the setting.
- `onDemandEntries` settings are development-only and have no effect in production builds — harmless but misleading.
- `allowedDevOrigins` contains a private LAN IP hardcoded — should be env-conditional.

---

## 2. Dockerfile / Cloud Config

**VERIFIED — NONE.**

No `Dockerfile`, `docker-compose.yml`, `railway.json`, `fly.toml`, `render.yaml`, or `app.yaml` found at any path under `C:\leads`.

No `vercel.json` found. The app is not configured for Vercel deployment beyond the implicit Next.js auto-detection.

**Deployment is entirely manual / undocumented.** There is no reproducible build-to-deploy path.

---

## 3. Monitoring Setup

**VERIFIED — NONE.**

No Sentry, Datadog, New Relic, or equivalent found:
- `package.json` has no monitoring dependencies.
- No `sentry.client.config.ts`, `sentry.server.config.ts`, or equivalent.
- `lib/analytics.ts` handles client-side GA4/Facebook Pixel tracking only — no server-side error reporting.

```ts
// .env.example — analytics section
NEXT_PUBLIC_GA4_ID=
NEXT_PUBLIC_FB_PIXEL_ID=
// No server-side monitoring variable exists
```

**Consequence:** Any server-side error (failed valuation, crashed API route, Supabase connectivity loss) is invisible to the operator. Errors only surface if a user reports them or if logs are manually reviewed.

---

## 4. Error Boundaries

**VERIFIED — NONE.**

- No `app/error.tsx` file (Next.js App Router error boundary).
- No `app/not-found.tsx` (custom 404 page).
- No React `ErrorBoundary` component anywhere in `components/`.
- No `app/global-error.tsx`.

```
# Result of Glob("app/error.tsx"): No files found
# Grep for "ErrorBoundary" in app/: No files found
```

**Consequence:** Any unhandled React render error in `ValuationWizard` or sub-components will show Next.js's generic error page (in production) or a full stack trace (in development). There is no graceful degradation UI — the entire page becomes a white error screen.

---

## 5. Database Down — Graceful Degradation?

**VERIFIED — MIXED. LocalStore degrades gracefully; SupabaseStore does not.**

### LocalStore (DATA_SOURCE=local)

```ts
// lib/store.ts:53–59
async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, file), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;  // returns empty array on any error
  }
}
```

If `deals.json` is missing/corrupt: `getDealsByNeighborhood()` returns `[]` → `valuate()` returns `null` → API returns 422 "insufficient data" → user sees Hebrew error message. **Graceful.**

If `leads.json` is missing: `insertLead()` creates the file from scratch. **Graceful.**

### SupabaseStore (DATA_SOURCE=supabase, i.e., production)

```ts
// lib/store.ts:186–195
async listNeighborhoods(settlement: string): Promise<Neighborhood[]> {
  const sb = await this.client();
  const { data, error } = await sb.from("neighborhoods").select("*").eq("settlement", settlement).order("name");
  if (error) throw error;  // THROWS — unhandled in callers
  return (data ?? []) as Neighborhood[];
}
```

All `SupabaseStore` methods throw on error. Callers in `app/api/valuation/route.ts`:

```ts
// app/api/valuation/route.ts:33
const neighborhoods = await store.listNeighborhoods("נתניה");
// No try/catch — if Supabase is down, this throws → Next.js returns 500
```

The landing page (`app/page.tsx`) uses `.catch(() => 0)` for `countLeads()` and `.catch(() => ({dealCount:0, neighborhoodCount:0}))` for `getStats()` — **graceful for landing page stats.**

But the API routes do not wrap store calls in try/catch. A Supabase outage causes **unhandled 500 errors** across `/api/valuation`, `/api/lead`, `/api/neighborhoods`, and admin routes.

---

## 6. leads.json Backup Mechanism

**VERIFIED — NO backup mechanism.**

```ts
// lib/store.ts:104–116
async insertLead(lead: Lead): Promise<Lead> {
  const file = path.join(DATA_DIR, "leads.json");
  const existing = await readJson<Lead[]>("leads.json", []);
  // ... mutate in memory ...
  await fs.writeFile(file, JSON.stringify(existing, null, 2), "utf8");
  return withMeta;
}
```

Issues:
1. **No atomic write.** `fs.writeFile` overwrites the file in place. If the process is killed between the write starting and finishing (e.g., OOM kill, server restart during high load), the file may be left partially written — resulting in invalid JSON that causes all subsequent reads to fail (silently returns `[]` due to the catch-and-fallback pattern, but all historical leads are effectively lost until the file is repaired).

2. **No backup/rotation.** There is no mechanism to create timestamped snapshots of `leads.json`.

3. **No concurrent-write protection.** Multiple simultaneous lead submissions race on the same file (read–modify–write without locking). Under concurrent traffic, leads can be silently dropped.

4. **Not relevant in Supabase mode** — Supabase handles durability. The LocalStore is intended for development only, but there is no hard guard preventing it from being used in production (`DATA_SOURCE` defaults to `"local"` if unset).

```ts
// lib/store.ts:12
const DATA_SOURCE = process.env.DATA_SOURCE || "local";
// "local" is the DEFAULT — production forgets to set DATA_SOURCE=supabase → leads written to disk
```

---

## 7. Data Freshness — Operator Visibility

**VERIFIED — `dataAsOf()` exists but is NOT surfaced in the UI.**

```ts
// lib/store.ts:170–174
async dataAsOf(): Promise<string> {
  const all = await this.deals();
  if (!all.length) return new Date().toISOString().slice(0, 10);
  return all.reduce((max, d) => (d.dealDate > max ? d.dealDate : max), all[0].dealDate);
}
```

The `dataAsOf` field is present in the `Valuation` object returned by `valuate()`:

```ts
// Valuation interface, ValuationWizard.tsx:58
asOf: string;
```

However, reviewing step 3 and step 4 of `ValuationWizard.tsx`, `valuation.asOf` is **never rendered** in the UI. The user and the operator cannot see how fresh the underlying deal data is from the front-end.

The admin dashboard may expose this separately — not audited in this pass (UNKNOWN).

---

## 8. Domain — Production Deployment Evidence

**VERIFIED — domain `shaviut-netanya.co.il` is the production target.**

The domain appears hardcoded (not behind an env var) in three files:

```ts
// app/layout.tsx:6
const BASE_URL = "https://shaviut-netanya.co.il"; // TODO: החלף בדומיין האמיתי

// app/robots.ts:4
const base = "https://shaviut-netanya.co.il"; // החלף בדומיין האמיתי

// app/sitemap.ts:4
const base = "https://shaviut-netanya.co.il"; // החלף בדומיין האמיתי
```

The TODO comments say "replace with the real domain" but the value already IS the production domain. This suggests the domain was set and the TODO was not removed. The domain is actively used as the canonical URL, OG URL, sitemap base, and robots.txt sitemap reference.

**Risk:** If the domain changes or the app is deployed to a staging subdomain, these hardcoded values will generate incorrect canonical URLs and SEO metadata. Should be `process.env.NEXT_PUBLIC_BASE_URL || "https://shaviut-netanya.co.il"`.

---

## 9. Missing Environment Variables for Production

The following variables are required for full production operation but are missing from `.env.local` (or would be missing in a fresh production deployment):

| Variable | Required For | Default in Dev | Risk if Missing in Prod |
|---|---|---|---|
| `DATA_SOURCE=supabase` | Persistent lead storage | `"local"` | Leads written to local JSON file — lost on server restart |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase connection | (empty) | SupabaseStore throws on init → all API routes crash |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase auth | (empty) | Same as above |
| `OTP_SECRET` | OTP signing security | (dev fallback in lib/otp.ts) | Weak/default secret → OTP codes forgeable |
| `GREEN_API_ID_INSTANCE` | WhatsApp lead notifications | (empty) | Leads received silently — operator not notified |
| `GREEN_API_TOKEN_INSTANCE` | WhatsApp lead notifications | (empty) | Same as above |
| `LEAD_NOTIFY_WHATSAPP` | Notification destination | (empty) | Operator phone unknown — no notifications sent |
| `GREEN_WEBHOOK_TOKEN` | Opt-out webhook security | (empty) | Unsigned webhooks accepted → anyone can fake STOP |
| `NEXT_PUBLIC_AGENT_NAME` | Legal display (broker law) | `"שם המתווך"` | Placeholder name shown to users — חוק המתווכים violation |
| `NEXT_PUBLIC_AGENT_LICENSE` | Legal display (broker law) | `"0000000"` | Fake license number shown — חוק המתווכים violation |
| `NEXT_PUBLIC_AGENT_PHONE` | WhatsApp float button | (empty) | WhatsApp button not shown |
| `NEXT_PUBLIC_GA4_ID` | Analytics | (empty) | No conversion tracking |
| `NEXT_PUBLIC_FB_PIXEL_ID` | Retargeting | (empty) | No Facebook ad optimization |

**Critical legal items:** `NEXT_PUBLIC_AGENT_NAME` and `NEXT_PUBLIC_AGENT_LICENSE` default to placeholder values. The app is live at the production domain, meaning these placeholders may be visible to users right now.

---

## 10. Build Failure Status

**VERIFIED — build currently FAILS.**

Per the audit brief, `middleware.ts` has a TypeScript error that prevents `next build` from completing. A failing build means:
- The production bundle cannot be generated.
- Any deployment attempt will fail.
- The only way to run the app is `next dev` (which skips strict type-checking).

**This is the single highest-priority blocker for production deployment.**

---

## Summary — Production Readiness Score

| Area | Status | Severity |
|---|---|---|
| Build passes | ❌ FAIL — TypeScript error in middleware.ts | BLOCKER |
| Error boundaries | ❌ NONE | HIGH |
| Server monitoring | ❌ NONE | HIGH |
| Security headers | ❌ NONE | HIGH |
| SupabaseStore error handling | ❌ Unhandled throws in API routes | HIGH |
| Agent name/license in env | ❌ Placeholder defaults visible | HIGH (legal) |
| `DATA_SOURCE` default is "local" | ❌ Leads lost on server restart | HIGH |
| OTP_SECRET has dev fallback | ❌ Insecure in production | HIGH |
| leads.json no atomic write | ❌ Data corruption risk | MEDIUM |
| leads.json no backup | ❌ No recovery path | MEDIUM |
| No Dockerfile/deploy config | ❌ Manual deployment only | MEDIUM |
| Domain hardcoded (not env var) | ⚠️ Inflexible | MEDIUM |
| `valuation.asOf` not in UI | ⚠️ Operator blind to data age | MEDIUM |
| `output: standalone` missing | ⚠️ Docker deploy complicated | LOW |
| no 404 / error.tsx pages | ❌ Generic error screens | LOW |
| No sitemap dynamic pages | ✅ N/A — single-page app | — |
| Canonical URL set | ✅ Correct | — |
| LocalStore degrades gracefully | ✅ Returns safe fallbacks | — |
| Landing page stats have .catch() | ✅ Graceful on DB failure | — |
