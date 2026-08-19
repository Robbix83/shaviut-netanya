# Audit Baseline — shaviut-netanya

**Audit date:** 2026-08-19
**Auditor:** Claude Code (forensic / discovery only — no remediations applied)

---

## Git / Version Control

| Item | Value |
|------|-------|
| Repository | **NOT A GIT REPOSITORY** — `C:\leads` has no `.git` directory |
| Branch | UNKNOWN |
| HEAD commit | UNKNOWN |
| Git status | UNKNOWN |

> ⚠️ **CRITICAL:** No version control. No rollback, no history, no diff capability.

---

## Runtime Environment

| Item | Value |
|------|-------|
| Platform | Windows 11 Pro |
| Node.js | v24.16.0 |
| npm | 11.13.0 |
| Package manager | npm (package-lock.json present) |
| Shell DATA_SOURCE | Not set in shell env (defaults to `local` via code) |
| `.env.local` DATA_SOURCE | `local` |
| NODE_ENV | Not observed (Next.js sets `production` during build) |

---

## Framework / Library Versions

| Package | Version | Note |
|---------|---------|------|
| next | 16.2.6 | Cutting edge; `middleware` file deprecated → use `proxy` |
| react | 19.0.0 | Latest stable |
| react-dom | 19.0.0 | |
| next-auth | **5.0.0-beta.31** | ⚠️ BETA — not production stable |
| @supabase/supabase-js | 2.106.2 | |
| typescript | 5.9.3 | |
| playwright | ^1.60.0 | For harvest |
| tsx | ^4.19.2 | Script runner |

---

## Available Scripts

```
dev           next dev -H 0.0.0.0
build         next build
start         next start
lint          next lint
harvest       tsx scripts/harvest.ts
harvest:missing  tsx scripts/harvest-missing.ts
remap         remap-streets + remap-deals
seed:local    seed-local.ts
renewal       fetch-renewal.ts
alerts        send-alerts.ts
enrich:coords enrich-coords.ts
geocode:deals geocode-deals.ts
harvest:streets harvest-streets.ts
fetch:datagov fetch-datagov.ts
fetch:cbs     fetch-cbs.ts
fetch:poi     fetch-poi.ts
stats         stats.ts
```

**Test scripts:** NONE — no `test` script in package.json.

---

## Environment Variable Names (from .env.example + .env.local)

### .env.example keys
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GREEN_API_ID_INSTANCE`
- `GREEN_API_TOKEN_INSTANCE`
- `LEAD_NOTIFY_WHATSAPP`
- `GREEN_WEBHOOK_TOKEN`
- `GOOGLE_SHEETS_WEBHOOK`
- `OTP_SECRET`
- `NEXT_PUBLIC_AGENT_NAME`
- `NEXT_PUBLIC_AGENT_LICENSE`
- `NEXT_PUBLIC_AGENT_PHOTO`
- `NEXT_PUBLIC_AGENT_TESTIMONIAL`
- `NEXT_PUBLIC_AGENT_PHONE`
- `NEXT_PUBLIC_GA4_ID`
- `NEXT_PUBLIC_FB_PIXEL_ID`
- `DATA_SOURCE`

### .env.local keys (additional/override)
- `DATA_SOURCE` (set to `local`)
- `ADMIN_DEV_BYPASS`
- `NEXT_PUBLIC_DEV_BYPASS_OTP`
- `OTP_SECRET`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM`
- `TWILIO_VERIFY_SID`

> Note: `.env.local` has Twilio credentials (OTP via SMS) not documented in `.env.example`.

---

## Data Files (local mode)

| File | Size | Records |
|------|------|---------|
| data/deals.json | 6,744 KB | **12,642 deals** |
| data/neighborhoods.json | 2.9 KB | **21 neighborhoods** |
| data/leads.json | 19.6 KB | **39 leads** |
| data/renewal.json | 15.6 KB | Urban renewal complexes |
| data/streets.json | 15.9 KB | Street index |
| data/street-index.json | 172.2 KB | Extended street index |
| data/netanya-streets-raw.json | 59.3 KB | Raw street discovery |
| data/cbs-netanya.json | 18.2 KB | CBS demographic data |
| data/poi.json | 96.7 KB | Points of interest |
| data/debug-raw-deal.json | 1 KB | Debug artifact |

---

## Safety Gates Executed

### TypeScript Check
**STATUS: FAILED (exit 2)**
```
middleware.ts(11,11): error TS2352
  Conversion of type '...' to type '(req: NextRequest) => Promise<NextResponse<unknown>>'
  may be a mistake because neither type sufficiently overlaps with the other.
  Target signature provides too few arguments. Expected 2 or more, but got 1.
```
Cause: `next-auth@5.0.0-beta.31` type incompatibility with `auth as (req: NextRequest) => Promise<NextResponse>` cast in `middleware.ts`.

### Lint
**STATUS: FAILED (exit 1)**
```
Invalid project directory provided, no such directory: C:\leads\lint
```
Likely a Next.js 16 / eslint config issue. `next lint` invocation fails before running.

### Build
**STATUS: FAILED (exit 1)**
Same TypeScript error in middleware.ts blocks production build.
Warning: `middleware` file convention deprecated in Next.js 16 → use `proxy`.

### Tests
**STATUS: N/A — no test script defined in package.json**

---

## Data Quick Stats (VERIFIED from local data)

### Deals (12,642 total)
- **Years covered:** 1998–2026 (recent years dominant: 2024=2556, 2025=2472, 2026=798)
- **Unique IDs:** 12,642 (0 duplicates by ID)
- **All have coordinates:** x ✓, y ✓ (0 missing)
- **Property types:** apartment 11,951 / house 391 / land 300
- **Missing floor:** 3,829 (30.3%)
- **Missing rooms:** 300 (2.4%)
- **Missing areaSqm:** 494 (3.9%)
- **Missing yearBuilt:** 3,468 (27.4%)
- **Missing houseNumber:** 2,608 (20.6%)
- **PPSQM P5:** ₪4,778/m² — **P95:** ₪43,731/m²
- **Suspicious PPSQM** (<₪3k or >₪80k): 434 deals (3.4%)

### ⚠️ CRITICAL: Deal Cap Per Neighborhood
```
מרכז העיר צפון: 3,010 deals
All other 20 neighborhoods: exactly 500, 500, 500, 500... (or slightly less)
```
Counts: 3010, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 498, 498, 493, 493, 490, 455, 205

**FINDING:** 20 of 21 neighborhoods have ≤500 deals — strongly suggests a harvest pagination cap of 500 results per neighborhood. The true Netanya transaction volume is likely far larger.

### Leads (39 total)
- All have `status: "new"` — no leads have been processed/updated
- 36/39 have a `source` field (free text, e.g. "selftest")
- No structured UTM fields (`utm_source`, `utm_medium`, `utm_campaign`)
- `consentAt` missing from 25/39 leads
- Lead structure in data is **narrower** than `types.ts` definition (missing: `floor`, `sellTiming`, `consentReport`, `consentWordingVersion`, `houseNumber`, `yearBuilt`, `propertyType`, `alertOptIn`)
