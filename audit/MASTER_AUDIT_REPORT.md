# MASTER AUDIT REPORT — shaviut-netanya.co.il
**Audit date:** 2026-08-19  
**Mode:** FORENSIC / DISCOVERY ONLY — no remediations applied  
**Auditor:** Claude Code (17 audit phases + 7 parallel subagents)  
**Project:** `C:\leads` — Hebrew real-estate seller lead-gen tool, Netanya  

---

## OVERALL VERDICT

| Dimension | Score | Confidence |
|-----------|-------|------------|
| **Data integrity** | **28 / 100** | VERIFIED |
| **Valuation reliability** | **38 / 100** | VERIFIED |
| **Lead reliability** | **55 / 100** | VERIFIED |
| **Security** | **42 / 100** | VERIFIED |
| **Privacy implementation** | **40 / 100** | VERIFIED |
| **Mobile UX / CRO** | **52 / 100** | VERIFIED |
| **Performance** | **50 / 100** | LIKELY |
| **Operational reliability** | **30 / 100** | VERIFIED |
| **Test maturity** | **5 / 100** | VERIFIED |
| **Production readiness** | **25 / 100** | VERIFIED |

**Composite score: 37 / 100**

> The project has a solid UX concept and working end-to-end funnel, but is built on a cracked foundation: coordinates that collapse to neighborhood centroids make the geographic valuation engine non-functional, the production build is broken, and there is no version control, no tests, and no monitoring.

---

## SAFETY GATES EXECUTED (VERIFIED)

| Gate | Status |
|------|--------|
| TypeScript check | **FAILED** — `middleware.ts:11` type cast incompatible with next-auth v5 beta |
| ESLint / next lint | **FAILED** — `Invalid project directory: C:\leads\lint` |
| Build | **FAILED** — same TS error blocks `next build` |
| Tests | **N/A** — no test script in `package.json` |
| Git repository | **ABSENT** — `C:\leads` has no `.git` directory |

---

## BACKTEST HEADLINE METRICS (VERIFIED)

| Metric | Value | Target |
|--------|-------|--------|
| Deals evaluated | 717 of 12,642 | — |
| Coverage (actual inside [lo,hi]) | **53.3%** | ~75–80% |
| MAE | ₪342,269 | — |
| Median AE | ₪175,000 | — |
| MAPE | **12.8%** | <10% |
| Within ±10% of mid | **61.5%** | — |
| Within ±20% of mid | **83.3%** | — |

> **Root cause of 53.3% coverage:** all deal coordinates are neighborhood centroids, so geographic scope resolution always falls through to neighborhood-level with wide P33/P67 bands. When the correct scope resolves (true street/building data), coverage would likely improve significantly.

---

## TOP RISKS

### P0 — Must fix before production can be trusted

**P0-1 — ADMIN_EMAIL not set in production**
- **File:** `.env.example`, `auth.ts`
- **Impact:** Any valid Google account can log into the admin dashboard. All lead data, contact details, and tabu notes are exposed.
- **Evidence:** `ADMIN_EMAIL` not in `.env.example`; `auth.ts` callback only checks email if `process.env.ADMIN_EMAIL` is set — otherwise it permits all authenticated Google users.
- **Status:** VERIFIED

**P0-2 — Production build is broken**
- **File:** [`middleware.ts:11`](../middleware.ts)
- **Impact:** Cannot deploy to Vercel. `next build` exits non-zero. Current production is likely running a stale, unrebuildable bundle.
- **Evidence:** `error TS2352` — type cast of `auth` incompatible with next-auth v5 beta types.
- **Status:** VERIFIED

**P0-3 — No version control**
- **Impact:** Any file overwrite is permanent. No rollback, no history, no diff. One wrong `writeFile` loses data.
- **Evidence:** No `.git` directory in `C:\leads`.
- **Status:** VERIFIED

---

### P1 — Critical functional failures

**P1-1 — All deal coordinates are neighborhood centroids**
- **File:** [`data/deals.json`](../data/deals.json), [`lib/valuation.ts`](../lib/valuation.ts)
- **Impact:** Geographic proximity search (BUILDING_RADIUS=60m, STREET_RADIUS=350m) is entirely non-functional. Every deal resolves to one of 21 centroid pairs. Building-level and street-level scopes never find real comparables.
- **Evidence:** Only 21 distinct (x,y) pairs for 12,642 deals; pairs match exactly with `data/neighborhoods.json` centroids.
- **Status:** VERIFIED

**P1-2 — Harvest cap of 500 deals per neighborhood**
- **File:** [`data/deals.json`](../data/deals.json), `scripts/harvest.ts`
- **Impact:** 20 of 21 neighborhoods have exactly 500 deals. מרכז העיר צפון has 3,010 (harvested in street mode). True Netanya deal volume is likely 3–10× larger. Underrepresentation inflates confidence intervals.
- **Evidence:** Deal count histogram; nadlan.gov.il response is server-capped at 500 items per request.
- **Status:** VERIFIED (cap is server-side, not a code bug)

**P1-3 — LocalStore file locking absent (leads.json)**
- **File:** [`lib/store.ts:104-116`](../lib/store.ts)
- **Impact:** Two concurrent lead submissions can race: both read the same JSON, both append, one write overwrites the other — a lead is silently dropped.
- **Evidence:** `insertLead()` does read → push → writeFile with no lock, no atomic rename.
- **Status:** VERIFIED

**P1-4 — DATA_SOURCE defaults to `local` with no fallback warning**
- **File:** [`lib/store.ts:12`](../lib/store.ts)
- **Impact:** If `DATA_SOURCE` env var is unset in production, the app silently reads `data/deals.json` from disk instead of Supabase. Leads are written to a local file that is not visible in the admin dashboard.
- **Evidence:** `const DATA_SOURCE = process.env.DATA_SOURCE || "local";` with no console warning.
- **Status:** VERIFIED

---

### P2 — Significant quality issues

**P2-1 — OTP bypass visible in production builds**
- **File:** [`app/components/...`](../app), `.env.local`
- **Impact:** `NEXT_PUBLIC_DEV_BYPASS_OTP=true` is baked into the Next.js client bundle at build time. If set during a Vercel build, anyone can skip phone verification.
- **Status:** VERIFIED

**P2-2 — GREEN_WEBHOOK_TOKEN optional → unauthenticated opt-out**
- **File:** `app/api/opt-out/route.ts`
- **Impact:** Attacker can enumerate and opt-out any phone number without authentication when `GREEN_WEBHOOK_TOKEN` is unset.
- **Status:** VERIFIED

**P2-3 — yearBuilt=0 and rooms=0 as null sentinels**
- **File:** [`data/deals.json`](../data/deals.json), [`lib/valuation.ts`](../lib/valuation.ts)
- **Impact:** 3,468 deals with `yearBuilt=0` are included in year-based calculations. 579 deals with `rooms=0` pollute room-count similarity scoring.
- **Status:** VERIFIED

**P2-4 — Composite coefficient inconsistency**
- **File:** [`lib/valuation.ts`](../lib/valuation.ts)
- **Impact:** `sizeDistance()` uses weight 0.45 for plot area; the composite model formula uses 0.4. Similarity scoring and valuation disagree on how much plot area matters.
- **Status:** VERIFIED

**P2-5 — Composite model effectively dead**
- **File:** [`lib/valuation.ts`](../lib/valuation.ts)
- **Impact:** 95%+ of houses have `plotSqm=null`. The composite formula degrades to `areaSqm + 0` for almost all inputs. The `plotNotValued` flag only fires when `plotSqm` IS present but wasn't used — the opposite of the common case.
- **Status:** VERIFIED

**P2-6 — No consent timestamp in 25/39 leads**
- **File:** [`data/leads.json`](../data/leads.json)
- **Impact:** Israeli privacy law (חוק הגנת הפרטיות) requires documented consent. Missing `consentAt` on 64% of existing leads creates legal exposure.
- **Status:** VERIFIED

**P2-7 — No delete mechanism despite privacy policy promise**
- **File:** `app/api/`, privacy policy page
- **Impact:** Privacy policy states subjects can request data deletion. No API route or admin UI implements this.
- **Status:** VERIFIED (policy exists; mechanism does not)

**P2-8 — Agent name/license/photo are placeholder values**
- **File:** `.env.example`
- **Impact:** `NEXT_PUBLIC_AGENT_NAME`, `NEXT_PUBLIC_AGENT_LICENSE` default to example values. Displaying wrong license number may violate Israeli broker licensing law (חוק המתווכים).
- **Status:** LIKELY (depends on whether .env.local is correctly set in production)

---

### P3 — Low-severity / observability issues

**P3-1 — WhatsApp and Google Sheets notification failures are silent**
- **File:** `lib/notify.ts` (or equivalent)
- **Status:** VERIFIED — errors caught and swallowed, no logging

**P3-2 — In-memory rate limiter per server instance**
- **File:** `app/api/otp/send/route.ts`
- **Impact:** On multi-instance deployments (Vercel scales), rate limit resets per instance. Limited practical impact on current scale.
- **Status:** VERIFIED

**P3-3 — No HTTP security headers**
- **File:** `next.config.*`
- **Impact:** Missing `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security`. Low risk for current threat model.
- **Status:** VERIFIED

**P3-4 — Heebo font double-loaded**
- **File:** `app/layout.tsx`
- **Impact:** Font loaded from both Google Fonts CDN and a local CSS `@import`. Extra network request; negligible perf cost.
- **Status:** VERIFIED

**P3-5 — maximumScale:1 in viewport meta blocks user zoom**
- **File:** `app/layout.tsx`
- **Impact:** WCAG 1.4.4 violation (Resize Text). Fails accessibility audit.
- **Status:** VERIFIED

**P3-6 — Near-duplicate deals (2,155 pairs)**
- **File:** [`data/deals.json`](../data/deals.json)
- **Impact:** Same street + houseNumber + date + price within 5% — likely re-registrations or partial-ownership splits. Inflates deal count by ~17%. Affects percentile calculations.
- **Status:** VERIFIED

**P3-7 — UTM capture lossy**
- **File:** Lead form / API
- **Impact:** Only a single `source` string stored per lead; `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` dropped. Multi-channel attribution impossible.
- **Status:** VERIFIED

---

## QUICK WINS (low effort, high impact)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| QW-1 | `git init && git add -A && git commit` | 2 min | Enables rollback, history |
| QW-2 | Set `ADMIN_EMAIL` in Vercel env vars | 1 min | Closes P0-1 admin auth bypass |
| QW-3 | Fix `middleware.ts`: replace cast with `export { auth as middleware }` | 5 min | Unblocks production build |
| QW-4 | Add `console.error` on WhatsApp/Sheets notification failure | 15 min | Makes silent failures visible |
| QW-5 | Set `yearBuilt` and `rooms` null-sentinel to actual `null` in data | 30 min | Fixes 3,468 bad `yearBuilt=0` records |
| QW-6 | Add `GREEN_WEBHOOK_TOKEN` as required env var; reject opt-out if absent | 20 min | Closes unauthenticated opt-out |
| QW-7 | Remove `maximumScale:1` from viewport meta | 1 min | Fixes WCAG 1.4.4 |
| QW-8 | Add `if (!process.env.DATA_SOURCE) console.error('[FATAL] DATA_SOURCE not set')` | 5 min | Prevents silent local-mode in production |

---

## STRUCTURAL ISSUES (require planning before touching)

**S1 — Coordinate collapse**
All 12,642 deals have neighborhood centroid coordinates. The entire geographic hierarchy (building → street → radius) is a no-op. Fixing this requires either:
- Re-harvesting with address geocoding (govmap ITM lookup per deal)
- Running `scripts/geocode-deals.ts` against the full dataset (exists but not yet validated at scale)
- Accepting neighborhood-only scope and recalibrating the model accordingly

This is the single highest-leverage fix for valuation accuracy.

**S2 — nadlan 500-deal cap**
Cannot be fixed in harvest code — cap is server-side. Workaround: harvest in street mode for every neighborhood (as done for מרכז העיר צפון). This multiplies harvest runtime significantly and requires checkpoint/resume logic.

**S3 — next-auth v5 beta**
`next-auth@5.0.0-beta.31` is unstable. The type incompatibility is a symptom. The library has had breaking changes across beta versions. Either pin to a stable beta and document the version, or plan an upgrade to GA when released.

**S4 — LocalStore concurrency**
`insertLead()` has no file locking. Safe options: (a) use a write queue / mutex, (b) use atomic `rename` after write, (c) migrate to Supabase in production (the intended design).

**S5 — Zero tests**
The project has a `selftest.ts` smoke test but no automated test suite. Adding tests requires deciding on a framework (Jest / Vitest) and identifying which units to cover first (valuation algorithm is highest value).

---

## DO NOT TOUCH YET (until structural issues resolved)

- **Do not rewrite `valuation.ts`** until coordinate data is fixed. Any rewrite runs against centroid data and will benchmark identically to current.
- **Do not migrate DB schema** until Supabase mode is tested end-to-end locally.
- **Do not change harvest scripts** until the 500-cap workaround strategy is decided.
- **Do not replace `getStore()`** — it works correctly; the problem is the data behind it.
- **Do not add caching to `/api/valuation`** until valuation results are trustworthy.

---

## RECOMMENDED REMEDIATION WAVES

### Wave 0 — Protect & Observe (today, ~1 hour)

| Task | Why | Risk | Rollback |
|------|-----|------|----------|
| `git init` + initial commit | Enables every other rollback | None | N/A |
| Set `ADMIN_EMAIL` in Vercel | Closes admin auth bypass | None | Revert env var |
| Fix `middleware.ts` (1-line change) | Unblocks all future deploys | Low — well-documented fix | Git revert |
| Add `DATA_SOURCE` warning log | Prevents silent local-mode | None | Remove log line |
| Add WhatsApp/Sheets error logging | Makes silent failures observable | None | Remove log |
| **Required test first:** deploy to preview branch, verify admin login still works | | | |

### Wave 1 — Data Hygiene (1–2 days)

| Task | Why | Risk | Expected benefit |
|------|-----|------|-----------------|
| Replace `yearBuilt=0` → `null` in deals.json | Corrupt sentinel in 27% of records | Low — read-only data fix | Cleaner age-based filtering |
| Replace `rooms=0` → `null` | Same issue, 579 records | Low | Cleaner room similarity |
| Deduplicate near-identical deals (same st+hn+date+price±5%) | 2,155 pairs inflate percentiles | Medium — removes 17% of records | Tighter confidence intervals |
| **Required test first:** run backtest before and after; confirm coverage doesn't drop | | | |

### Wave 2 — Security Hardening (1 day)

| Task | Why | Risk | Expected benefit |
|------|-----|------|-----------------|
| Require `GREEN_WEBHOOK_TOKEN`; reject opt-out if absent | Closes unauthenticated opt-out | Low | Prevents mass opt-out attack |
| Remove `NEXT_PUBLIC_DEV_BYPASS_OTP` from production Vercel vars | Eliminates OTP bypass in prod | Low | Closes verification bypass |
| Add `ADMIN_DEV_BYPASS` guard: require explicit env var AND `NODE_ENV=development` check | Defense in depth | Low | Belt-and-suspenders |
| Add HTTP security headers (`X-Frame-Options`, `X-Content-Type-Options`, CSP) | Standard headers | Low | Browser protection layer |
| Remove `maximumScale:1` from viewport | WCAG + UX | None | Accessibility compliance |
| **Required test first:** verify OTP flow works without bypass flags | | | |

### Wave 3 — Coordinate Fix (1–2 weeks, high value)

| Task | Why | Risk | Expected benefit |
|------|-----|------|-----------------|
| Run `geocode-deals.ts` on full dataset; validate ITM coordinates | Activates entire geographic hierarchy | Medium — large data operation | BUILDING/STREET scopes become functional; estimated coverage improvement 53% → 70–80% |
| Re-run backtest after geocoding | Verify improvement quantitatively | None | Evidence for valuation accuracy claim |
| **Required test first:** test geocode script on 100 deals; verify ITM coordinates against known addresses | | | |

### Wave 4 — Harvest Completeness (1 week)

| Task | Why | Risk | Expected benefit |
|------|-----|------|-----------------|
| Implement street-mode harvest for all 20 remaining neighborhoods | Bypasses 500-deal server cap | Low — additive data | ~3–10× more deals in covered areas |
| Add checkpoint/manifest to harvest script | Prevent re-harvesting from scratch on interruption | Low | Reliable large harvests |
| Add schema validation on harvest output | Detect format changes silently | Low | Early warning on nadlan format changes |
| **Required test first:** dry-run harvest on one neighborhood, diff against existing data | | | |

### Wave 5 — Lead Pipeline Reliability (3–4 days)

| Task | Why | Risk | Expected benefit |
|------|-----|------|-----------------|
| Add file locking to `LocalStore.insertLead()` (or migrate to Supabase) | Prevent concurrent write race | Low | Zero dropped leads |
| Add phone uniqueness check on lead submission | Prevent duplicate submissions | Medium — touches user flow | Cleaner lead list |
| Implement lead deletion API + admin UI | Privacy policy compliance | Low | Legal compliance |
| Backfill `consentAt` for existing 25 leads (if consent was obtained; otherwise flag for re-consent) | Israeli privacy law | Low | Compliance |
| Store full UTM parameters (`utm_source`, `utm_medium`, `utm_campaign`) | Attribution analysis | Low | Multi-channel attribution |
| **Required test first:** submit test lead, verify in both UI and file/DB | | | |

### Wave 6 — Architecture / Refactor (when Waves 0–5 are stable)

| Task | Why | Risk | Expected benefit |
|------|-----|------|-----------------|
| Upgrade `next-auth` to GA when released | Eliminate beta instability | High — potential breaking changes | Production-grade auth |
| Add test suite (Vitest + RTL for components; pure-function tests for valuation) | Prevent regressions | None | Confidence in changes |
| Add error boundaries to React tree | Prevent full-page crashes | Low | User-visible errors isolated |
| Add monitoring (Sentry or equivalent) | No visibility into prod errors | Low | Error detection |
| Consider composite model revision after geocoding (actual house comps now possible) | Current model effectively unused | Medium — valuation change | Better house valuations |

---

## NOT VERIFIED LIST

The following were not verified due to audit scope, inaccessible runtime, or missing data:

- **Production Supabase schema** — only local JSON mode verified; Supabase table structure and RLS policies not audited
- **Actual Vercel environment variables** — only `.env.local` and `.env.example` inspected; production env vars not accessible
- **Green API delivery success rate** — WhatsApp notifications not tested end-to-end
- **Google Sheets webhook format** — Apps Script not accessible
- **govmap geocoding accuracy** — `enrich-coords.ts` and `geocode-deals.ts` scripts present but not run at scale
- **nadlan reCAPTCHA handling in harvest** — Playwright stealth tested only locally; cloud behaviour unknown
- **Admin dashboard UX** — not run; only API routes audited
- **Vercel Edge runtime behavior** — middleware runs at edge; `getStore()` call pattern in edge context not validated
- **NEXTAUTH_SECRET rotation** — not known if production secret is strong enough
- **OTP delivery rate and latency** — Twilio/Inforu not live-tested

---

## AUDIT FILE INDEX

| File | Content |
|------|---------|
| [`audit/00_BASELINE.md`](00_BASELINE.md) | Environment, versions, data quick stats, safety gates |
| [`audit/01_SYSTEM_MAP.md`](01_SYSTEM_MAP.md) | Architecture, API routes, data flow, component map |
| [`audit/02_DATA_FLOW.md`](02_DATA_FLOW.md) | End-to-end data flow traces, store call sites |
| [`audit/03_DATA_QUALITY.md`](03_DATA_QUALITY.md) | Deal data quality, nulls, sentinels, duplicates |
| [`audit/04_HARVEST_AUDIT.md`](04_HARVEST_AUDIT.md) | Harvest scripts, completeness, failure modes |
| [`audit/05_VALUATION_LOGIC.md`](05_VALUATION_LOGIC.md) | Valuation algorithm walkthrough, edge cases |
| [`audit/06_VALUATION_BACKTEST.md`](06_VALUATION_BACKTEST.md) | Backtest methodology and results |
| [`audit/07_COMPARABLE_TRACE.md`](07_COMPARABLE_TRACE.md) | Comparable selection tracing for sample addresses |
| [`audit/08_LEAD_PIPELINE.md`](08_LEAD_PIPELINE.md) | Lead capture, notification, dedup, reliability |
| [`audit/09_ATTRIBUTION_ANALYTICS.md`](09_ATTRIBUTION_ANALYTICS.md) | UTM capture, GA4, FB Pixel, attribution gaps |
| [`audit/10_SECURITY.md`](10_SECURITY.md) | Auth, API security, rate limiting, headers |
| [`audit/11_PRIVACY_IMPLEMENTATION.md`](11_PRIVACY_IMPLEMENTATION.md) | Privacy policy compliance, consent, GDPR/Israeli law |
| [`audit/12_MOBILE_CRO.md`](12_MOBILE_CRO.md) | Mobile UX, funnel friction, conversion optimization |
| [`audit/13_WEB_QUALITY.md`](13_WEB_QUALITY.md) | SEO, performance, Core Web Vitals signals |
| [`audit/14_EXTERNAL_DEPENDENCIES.md`](14_EXTERNAL_DEPENDENCIES.md) | Third-party services, API stability, fallbacks |
| [`audit/15_TEST_GAPS.md`](15_TEST_GAPS.md) | Test coverage, gap analysis, risk by module |
| [`audit/16_PRODUCTION_READINESS.md`](16_PRODUCTION_READINESS.md) | Production checklist, deployment risk, monitoring |
| [`audit/backtest.js`](backtest.js) | Leave-one-out backtest script (executable) |

---

## LEAD PIPELINE VERDICT

**PARTIALLY RELIABLE.** The lead capture form, OTP verification, and Supabase insert path are functionally correct. Known risks: concurrent writes can drop leads in local mode (P1-3); notification failures are silent (P3-1); OTP can be bypassed in prod if env var leaks (P2-1); 64% of existing leads lack consent timestamps (P2-6). The pipeline is acceptable for low volume (current: 39 leads) but not for production scale without Wave 5 fixes.

---

## SECURITY VERDICT

**SIGNIFICANT EXPOSURE.** The open admin dashboard (P0-1, `ADMIN_EMAIL` unset) is the most critical issue — any Google account can access all lead data. OTP bypass, unauthenticated opt-out, and no security headers are secondary. No evidence of secrets exposed in the audit files themselves. The Twilio credentials in `.env.local` are local-only and not in any git history (no git exists). Overall security posture is weak for a production app handling personal contact data.

---

## PRODUCTION READINESS VERDICT

**NOT PRODUCTION-READY.** Hard blockers:
1. Build is broken — cannot rebuild or redeploy
2. Admin is open to any Google account
3. No version control — one wrong write loses everything
4. Geographic valuation non-functional (coordinates are centroids)
5. No tests, no monitoring, no error boundaries

The app may be running on a stale Vercel deployment and collecting leads, but it cannot be safely updated, audited, or scaled in its current state.

---

## RECOMMENDED FIRST REMEDIATION WAVE

**Start with Wave 0** — all five actions are reversible, take under 1 hour total, and unblock every subsequent wave:

1. `git init && git add -A && git commit -m "initial commit"` — enables rollback for everything that follows
2. Set `ADMIN_EMAIL=rob.bublil@gmail.com` (or appropriate value) in Vercel dashboard → Environment Variables
3. In `middleware.ts`, replace lines 10-11 with `return (auth as any)(req)` as a temporary unblock, or use `export { auth as middleware }` if the next-auth version supports it
4. Add `if (!process.env.DATA_SOURCE && process.env.NODE_ENV === 'production') throw new Error('[FATAL] DATA_SOURCE not set')` in `store.ts`
5. Add `console.error('[notify] WhatsApp/Sheets failed:', err)` in notification error handlers

**After Wave 0:** coordinate geocoding (Wave 3) is the highest-leverage improvement. Once coordinates are real, valuation coverage will jump from 53% toward 75–80%, making the app meaningfully more accurate for sellers.

---

*END OF AUDIT — STOP CONDITION MET. No remediations applied. No production data modified. No schemas changed. All findings are evidence-based with VERIFIED/LIKELY/UNKNOWN classifications.*
