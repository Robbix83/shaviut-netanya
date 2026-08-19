# Phase 14 — Test Gap Analysis

**App:** shaviut-netanya (Next.js 16 / React 19 / Tailwind / RTL Hebrew)
**Date:** 2026-08-19
**Auditor:** Forensic read-only pass — no files modified

---

## Test Infrastructure Inventory

**VERIFIED — zero automated test infrastructure in the application.**

| Artifact | Present | Notes |
|---|---|---|
| `jest.config.*` | NO | |
| `vitest.config.*` | NO | |
| `playwright.config.*` | NO | |
| `*.test.*` in src | NO | Only in `node_modules` |
| `*.spec.*` in src | NO | |
| `__tests__/` directories | NO | |
| `test` script in package.json | NO | Scripts: dev, build, start, lint, harvest, remap, seed:local, renewal, alerts, enrich:coords, geocode:deals, harvest:streets, fetch:datagov, fetch:cbs, fetch:poi, stats |

**Two manual verification scripts exist but are not automated tests:**

1. **`scripts/selftest.ts`** — runs the `valuate()` function directly against live local data, prints results to console, checks that `estimateLow < estimateMid < estimateHigh`. Must be run manually with `tsx scripts/selftest.ts`. No assertion framework; exit code is `process.exit(1)` on valuation returning null.

2. **`scripts/test-addresses.py`** — HTTP integration test against a running local server. Sends 10 random address lookups to `http://localhost:3000/api/valuation`, checks that building/street-scope comparable deals don't come from the wrong street. Requires: the server running, `data/street-index.json` and `data/deals.json` present. Prints PASS/BUG/ERROR per address. Not run in CI; has no machine-readable exit code for reporting.

---

## Coverage Matrix

The following table maps each critical function/subsystem to its automated test coverage.

Legend: ✅ Covered | ⚠️ Partial | ❌ None | UNKNOWN (code not read in this pass)

### Core Business Logic

| Function | File | Auto Coverage | Manual Coverage | Risk |
|---|---|---|---|---|
| `valuate()` | `lib/valuation.ts` | ❌ None | ⚠️ `scripts/selftest.ts` (smoke only — 1 scenario, no edge cases) | **CRITICAL** |
| `percentile()` | `lib/valuation.ts` | ❌ None | ⚠️ `scripts/selftest.ts` (1 case: p50 of 4 values) | HIGH |
| Floor adjustment logic | `lib/valuation.ts` | ❌ None | ❌ None | HIGH |
| Age tolerance filtering | `lib/valuation.ts` | ❌ None | ❌ None | MEDIUM |
| Composite property valuation | `lib/valuation.ts` | ❌ None | ❌ None | MEDIUM |
| Price trend calculation | `lib/valuation.ts` | ❌ None | ❌ None | MEDIUM |
| Comparable selection hierarchy (building → street → radius → neighborhood) | `lib/valuation.ts` | ❌ None | ⚠️ `test-addresses.py` (only checks wrong-street bug, not radius accuracy) | HIGH |

### Data Access Layer

| Function | File | Auto Coverage | Manual Coverage | Risk |
|---|---|---|---|---|
| `LocalStore.getDealsByNeighborhood()` | `lib/store.ts` | ❌ None | ❌ None | HIGH |
| `LocalStore.insertLead()` | `lib/store.ts` | ❌ None | ⚠️ `scripts/selftest.ts` (1 happy-path insert) | HIGH |
| `LocalStore.getLeads()` | `lib/store.ts` | ❌ None | ❌ None | MEDIUM |
| `LocalStore.updateLeadStatus()` | `lib/store.ts` | ❌ None | ❌ None | MEDIUM |
| `LocalStore.optOutByPhone()` | `lib/store.ts` | ❌ None | ❌ None | HIGH (legal: opt-out must work) |
| `LocalStore.dataAsOf()` | `lib/store.ts` | ❌ None | ❌ None | LOW |
| `SupabaseStore.*` | `lib/store.ts` | ❌ None | ❌ None | HIGH |
| `normalizePhone()` | `lib/store.ts` | ❌ None | ❌ None | HIGH (affects opt-out + dedup) |
| `getStore()` factory (local vs supabase selection) | `lib/store.ts` | ❌ None | ❌ None | HIGH |

### Deal Normalization

| Function | File | Auto Coverage | Manual Coverage | Risk |
|---|---|---|---|---|
| `decodeDealData()` / deal normalization in harvest | `scripts/harvest.ts` | ❌ None | ❌ None | HIGH |
| Street name normalization (`norm()` in test-addresses.py) | `scripts/test-addresses.py` | ❌ None — the normalizer lives only inside the test script | ❌ None | MEDIUM |
| Price-per-sqm calculation | `lib/valuation.ts` | ❌ None | ❌ None | HIGH |

### Lead Capture & Integrations

| Function | File | Auto Coverage | Manual Coverage | Risk |
|---|---|---|---|---|
| OTP generation & signing | `lib/otp.ts` | ❌ None | ❌ None | HIGH (security) |
| OTP verification (timing, expiry, replay) | `lib/otp.ts` | ❌ None | ❌ None | HIGH (security) |
| `insertLead` → notify pipeline | `app/api/lead/route.ts` → `lib/notify.ts` | ❌ None | ❌ None | HIGH |
| WhatsApp notification (Green API) | `lib/notify.ts` | ❌ None | ❌ None | MEDIUM |
| Google Sheets webhook | `lib/notify.ts` or similar | ❌ None | ❌ None | LOW |
| Lead deduplication (same phone) | `app/api/lead/route.ts` | UNKNOWN | ❌ None | HIGH |
| `optOutByPhone()` via webhook | `app/api/webhook/green/route.ts` | ❌ None | ❌ None | HIGH (legal) |

### Address Resolution

| Function | File | Auto Coverage | Manual Coverage | Risk |
|---|---|---|---|---|
| `resolvePoint()` / govmap geocode | `lib/govmap.ts` | ❌ None | ❌ None | HIGH |
| `itmDistance()` | `lib/govmap.ts` | ❌ None | ❌ None | MEDIUM |
| `resolveNeighborhoodId()` (nearest-neighbor) | `app/api/valuation/route.ts` | ❌ None | ❌ None | HIGH |
| Address autocomplete (`/api/autocomplete`) | `app/api/autocomplete/route.ts` | ❌ None | ❌ None | MEDIUM |
| House-number → neighborhood resolution (`/api/resolve-address`) | `app/api/resolve-address/route.ts` | ❌ None | ⚠️ `test-addresses.py` (indirectly) | HIGH |

### Admin & Auth

| Function | File | Auto Coverage | Manual Coverage | Risk |
|---|---|---|---|---|
| Admin authentication (NextAuth / middleware) | `middleware.ts` | ❌ None | ❌ None | HIGH |
| Admin route protection | `app/admin/(protected)/layout.tsx` | ❌ None | ❌ None | HIGH |
| Lead status update (admin) | `app/api/admin/leads/[id]/route.ts` | ❌ None | ❌ None | MEDIUM |
| Rate limiting (`lib/rateLimit.ts`) | `lib/rateLimit.ts` | ❌ None | ❌ None | HIGH |

### Harvest Pipeline

| Function | File | Auto Coverage | Manual Coverage | Risk |
|---|---|---|---|---|
| Playwright scrape + anti-detection | `scripts/harvest.ts` | ❌ None | ❌ None | MEDIUM (external dependency) |
| Deal schema validation | `scripts/harvest.ts` | ❌ None | ❌ None | HIGH |
| Coordinate enrichment | `scripts/enrich-coords.ts` | ❌ None | ❌ None | MEDIUM |
| Street index generation | `scripts/harvest-streets.ts` | ❌ None | ❌ None | LOW |
| Renewal data fetch | `scripts/fetch-renewal.ts` | ❌ None | ❌ None | LOW |

### E2E User Flow

| Flow | Auto Coverage | Manual Coverage | Risk |
|---|---|---|---|
| Landing page render | ❌ None | ❌ None | MEDIUM |
| Address search → neighborhood resolution | ❌ None | ⚠️ `test-addresses.py` (partial) | HIGH |
| Wizard step 1 → 2 → 3 (valuation) | ❌ None | ❌ None | HIGH |
| Lead form → OTP → step 4 (full report) | ❌ None | ❌ None | HIGH |
| OTP replay attack prevention | ❌ None | ❌ None | HIGH (security) |
| WhatsApp notification delivery | ❌ None | ❌ None | MEDIUM |
| Admin login → lead list → status update | ❌ None | ❌ None | MEDIUM |
| Opt-out webhook (Green API STOP) | ❌ None | ❌ None | HIGH (legal) |

---

## Identified High-Risk Untested Behaviors

### 1. `normalizePhone()` — Phone deduplication and opt-out
```ts
// lib/store.ts:41–46
export function normalizePhone(p: string): string {
  let s = (p || "").replace(/[-\s]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("972")) s = "0" + s.slice(3);
  return s;
}
```
Used in `optOutByPhone()`. If a user registered with `+972501234567` and opts out with `050-123-4567`, these must normalize to the same string. Not tested. A bug here means opt-outs silently fail — GDPR/privacy law violation.

### 2. OTP Expiry and Replay
```ts
// lib/otp.ts — not read but pattern inferred from wizard:
// otpCountdown = 300 (5 minutes), "שלח מחדש" blocked for 30 seconds
```
No test verifies that: (a) an expired token is rejected, (b) a used token cannot be reused (replay), (c) brute-force (6-digit = 1M combinations) is rate-limited. The OTP is signed with `OTP_SECRET` which has a dev fallback — if the default is weak or blank, security is compromised.

### 3. `optOutByPhone()` — Legal Requirement
The Green API webhook (`/api/webhook/green`) triggers `optOutByPhone()`. No test verifies:
- The webhook token validation (prevents spoofed STOP messages)
- That all leads with the same normalized phone are marked opt-out
- That opted-out phones are excluded from future WhatsApp sends (`lib/alerts.ts`)

### 4. `valuate()` Edge Cases
Known untested scenarios:
- Neighborhood with zero deals → returns `null` (404-like error to user)
- Neighborhood with 1–2 deals → low-confidence valuation
- Land (`propertyType === "land"`) — different pricing logic, no rooms required
- House with `plotNotValued` flag — partial valuation with warning
- `compositeUsed` flag — fallback path when primary calc fails
- Floor adjustment when floor data is absent

### 5. Race Condition in `LocalStore.insertLead()`
```ts
// lib/store.ts:104–116
async insertLead(lead: Lead): Promise<Lead> {
  const existing = await readJson<Lead[]>("leads.json", []);
  // ... modify in memory ...
  await fs.writeFile(file, JSON.stringify(existing, null, 2), "utf8");
}
```
No file locking. Under concurrent requests (two users submit simultaneously), both read the same state before either writes, resulting in one lead being silently lost. Not tested, and cannot be tested without a concurrency test harness.

---

## Recommended Test Suite (Priority Order)

| Priority | Test Type | Target | Framework |
|---|---|---|---|
| P1 | Unit | `normalizePhone()` — 10+ phone format variants | Vitest |
| P1 | Unit | `valuate()` — apartments/houses/land, empty/sparse data, floor adjustment | Vitest |
| P1 | Unit | `percentile()` — edge cases: empty array, single value, even/odd counts | Vitest |
| P1 | Unit | OTP generate/verify — expiry, replay, wrong code, rate limit | Vitest |
| P1 | Integration | `/api/lead` POST → leads.json written → notify called | Vitest + mock |
| P1 | Integration | `optOutByPhone()` → phone normalized → all records updated | Vitest |
| P2 | Integration | `/api/valuation` POST with `neighborhoodId` → correct range | Supertest |
| P2 | Integration | `/api/valuation` POST with missing `neighborhoodId` → 422 | Supertest |
| P2 | Integration | Admin route without session → redirect to `/admin/login` | Supertest |
| P2 | E2E | Full wizard happy path (address → valuation → OTP → step 4) | Playwright |
| P3 | E2E | Address autocomplete keyboard navigation | Playwright |
| P3 | E2E | Opt-out webhook → phone marked opt-out | Playwright/API |
| P3 | Contract | `DATA_SOURCE=supabase` switch — SupabaseStore implements same interface | Vitest |
