# 17 — AUDIT RECONCILIATION

**Reconciliation date:** 2026-08-19
**Auditor:** Forensic reconciliation subagent (read-only)
**Authority order:** SOURCE CODE + DATA > MASTER_AUDIT_REPORT.md > individual phase files
**Scope:** Reconcile contradictions/overstatements in the 17-file audit against authoritative source.
**Secrets policy:** No credential values are reproduced. Findings describe secrets by TYPE and LOCATION only.

Classification vocabulary: CONFIRMED / CONDITIONAL / OVERSTATED / UNDERSTATED / CONTRADICTED / NOT VERIFIED.
For production-inference findings (Issue B): LOCAL_VERIFIED / PRODUCTION_VERIFIED / CONDITIONAL_PRODUCTION_RISK / UNKNOWN.

---

## Executive verdict table

| Issue | Topic | Classification | Corrected one-line fact |
|-------|-------|----------------|--------------------------|
| A | Secrets in 01_SYSTEM_MAP | **CONTRADICTED** | 01_SYSTEM_MAP.md contains ZERO credential values — only env-var key names. |
| B | Local vs production inference | **OVERSTATED** | Every "production" finding rests on local artifacts; none can be VERIFIED (Vercel env inaccessible). |
| C | 500-deal cap | **OVERSTATED** | Ceiling is CONFIRMED in data; harvest script imposes none; server-side cause is LIKELY, not VERIFIED. |
| D | Geo/coordinate valuation | **OVERSTATED / UNDERSTATED (nuanced)** | Text matching runs FIRST and works; only the geo-radius sublayers are broken. |
| E | Framework version | **CONTRADICTED** | Installed Next.js is 16.2.6; the "Next.js 14 … VERIFIED" claim is false. |
| F | Middleware fix | **CONTRADICTED** | Installed next-auth types prescribe `export default auth((req)=>…)` wrapper; `auth as any` is wrong. |
| G | Duplicate deletion | **BLOCKED (OVERSTATED)** | The 2,155 "duplicates" are largely legitimate distinct units; deletion is blocked pending identity proof. |
| H | Other contradictions | Multiple | 05 vs MASTER on geo; dead-code coefficient; internal 03 duplicate contradiction; Next16 "middleware deprecated" tension. |

---

## A. SECRET CONTRADICTION — was any live credential copied into 01_SYSTEM_MAP.md?

**The competing claims**
- `10_SECURITY.md:24-34` (P0-1): *"The credentials were reproduced verbatim inside `audit/01_SYSTEM_MAP.md`, which IS a tracked project file."* Lists four Twilio values by truncated prefix.
- `MASTER_AUDIT_REPORT.md:363`: *"No evidence of secrets exposed in the audit files themselves."*

**Counter-evidence (direct scan of the file)**
Scanned `audit/01_SYSTEM_MAP.md` (428 lines) for credential VALUE patterns:
- Twilio Account SID `AC` + 32 hex → **0 matches**
- Twilio Verify SID `VA` + hex → **0 matches**
- Standalone 32-char hex tokens (auth-token shape) → **0 matches**
- Any 10+ char hex run → **0 matches**
- `+1…` / `+9725…` phone-number values → **0 matches**
- The only Twilio-related text is env-var KEY NAMES inside mermaid diagrams: `TWILIO_VERIFY_SID`, `TWILIO_ACCOUNT_SID` at `01_SYSTEM_MAP.md:20,166,168,391,395`.

**Classification: CONTRADICTED** (10_SECURITY's P0-1 sub-claim is false).
- 10_SECURITY.md:32 claim that values were "reproduced verbatim inside 01_SYSTEM_MAP.md" — **CONTRADICTED**. No value of any kind exists there; only key names.
- MASTER:363 "no evidence of secrets exposed in the audit files themselves" — **CONFIRMED as to 01_SYSTEM_MAP.md**, but note one nuance below.

**Nuance (reported, not printed):** The document that actually contains partial secret material is `10_SECURITY.md:28` itself, which prints truncated credential prefixes (first 2-4 characters of the SID, auth token, from-number and verify-SID). These fragments are not usable credentials, but they mean MASTER's blanket "no secrets in the audit files" is marginally OVERSTATED — the exposure, such as it is, lives in 10_SECURITY.md, NOT in the file 10_SECURITY.md accuses. The real credential VALUES exist only in `.env.local` (untracked, gitignored). The remediation "delete values from 01_SYSTEM_MAP.md" (10_SECURITY.md:312) targets the wrong file and is a no-op.

---

## B. LOCAL vs PRODUCTION — findings that inferred prod state from local artifacts

**The structural contradiction**
MASTER labels `ADMIN_EMAIL not set in production` as **VERIFIED** (`MASTER:62-66`, P0-1), yet MASTER's own NOT-VERIFIED list admits *"Actual Vercel environment variables — … production env vars not accessible"* (`MASTER:318`). A production condition cannot be VERIFIED while the production environment is by MASTER's own admission inaccessible. Every finding below inherits this flaw.

| Finding | MASTER status | Evidence basis | Reclassification |
|---------|---------------|----------------|------------------|
| ADMIN_EMAIL unset in prod (P0-1) | VERIFIED | `auth.ts:10-11` guard is conditional; `.env.local` has it commented / `.env.example` omits it | **CONDITIONAL_PRODUCTION_RISK** — code path LOCAL_VERIFIED; prod value UNKNOWN |
| Production build broken (P0-2) | VERIFIED | `tsc` fails locally on `middleware.ts:11` cast | Build-fails-on-this-code = **PRODUCTION_VERIFIED** (same code compiles anywhere); *"production running a stale bundle"* = **UNKNOWN** (inference) |
| OTP bypass visible in prod builds (P2-1) | VERIFIED | `NEXT_PUBLIC_DEV_BYPASS_OTP` in local `.env.local`; local `.next/` chunks contain it (`10_SECURITY.md:64`) | **CONDITIONAL_PRODUCTION_RISK** — depends on the flag being set at the Vercel build; local build ≠ prod build. UNKNOWN whether prod set it |
| GREEN_WEBHOOK_TOKEN unset → open opt-out (P2-2) | VERIFIED | absent from local `.env.local` | **CONDITIONAL_PRODUCTION_RISK** — prod value UNKNOWN |
| DATA_SOURCE defaults to local (P1-4) | VERIFIED | `store.ts:12` default confirmed | Default is **LOCAL_VERIFIED (code fact)**; whether prod sets `supabase` is **UNKNOWN** |
| OTP_SECRET dev fallback (10 P2-1) | — | `lib/otp.ts` fallback string confirmed in code | Code fact **LOCAL_VERIFIED**; prod value **UNKNOWN** |
| Agent name/license placeholders (P2-8) | LIKELY | `.env.example` defaults | **CONDITIONAL_PRODUCTION_RISK** — already correctly LIKELY, not VERIFIED |
| Domain is production target (16 §8) | VERIFIED | hardcoded in `layout.tsx`/`robots.ts`/`sitemap.ts` | Hardcoded-domain = **LOCAL_VERIFIED**; that a live deployment exists/serves = **UNKNOWN** |

**Classification: OVERSTATED.** The underlying code/config facts are real and LOCAL_VERIFIED, but every "in production" consequence is an inference against an environment the audit could not read. Corrected fact: **no production-state finding in this audit may carry the VERIFIED label; the honest ceiling is CONDITIONAL_PRODUCTION_RISK.**

---

## C. 500-DEAL CAP — separate the observed ceiling from its cause

| Layer | Question | Finding | Evidence |
|-------|----------|---------|----------|
| 1. Observed ceiling in data | Do counts cap at ~500? | **CONFIRMED** | `03_DATA_QUALITY.md:11-33`: 14 neighborhoods at exactly 500; מרכז העיר צפון 3,010 (street-mode); tail under 500 (נווה איתמר 205) |
| 2. Harvest SCRIPT imposes it? | Any 500/pageSize/limit in code? | **CONTRADICTED / NOT the cause** | `scripts/harvest.ts` has NO 500 / pageSize / result-limit. Pagination is scroll-based: `MAX_SCROLL_ROUNDS=200`, `SCROLL_IDLE_ROUNDS=4` (harvest.ts:253-262). The only literal `500` is a Supabase upsert batch size (`harvest.ts:524-525`), unrelated to harvest volume |
| 3. nadlan BACKEND imposes it? | Is the server the cause? | **LIKELY, not proven** | Circumstantial only: sharp exactly-500 boundary + street-mode bypass yielding 3,010. No captured `/deal-data` API response demonstrating a server-side 500 window exists in the audit |
| 4. Inference vs proof | Did MASTER promote it? | **OVERSTATED** | `MASTER:89-93` P1-2 status = *"VERIFIED (cap is server-side, not a code bug)"*. The source phase file it derives from, `03_DATA_QUALITY.md:339`, says **"LIKELY — … imposed by nadlan.gov.il's backend"**. MASTER upgraded LIKELY→VERIFIED without added evidence |

**Classification: OVERSTATED.** Corrected fact: **the ceiling is observationally CONFIRMED and is definitively NOT a harvest-script limit; the server-side attribution remains LIKELY (circumstantial) and must not be labeled VERIFIED without a captured API response.**

---

## D. COORDINATE / GEO — per-layer verdict (not one collapsed statement)

**Data reality (re-verified):** 12,642 deals collapse to **21 distinct (x,y) pairs** (one per neighborhood centroid); 0 missing coords. BUT text fields are well populated: **12,642 have `street`, 10,034 have both `street` + `houseNumber`.** The subject address supplied by the user carries a real per-street ITM coordinate (from the street index), while comparable deals sit at centroids.

**Order of operations in `lib/valuation.ts`:** the TEXT layer (lines 224-272) runs **before** the geo layer (lines 274-370).

| Layer | Code | Verdict | Why |
|-------|------|---------|-----|
| TEXT MATCHING (exact building / near-street / street) | `byExactBuilding`/`byBuildingNumber`/`byStreetName`, lines 185-249; city-wide text fallback 254-272 | **WORKING** | Independent of coordinates; matches on `street`+`houseNumber` which 10,034/12,642 deals carry; runs first and is the primary path |
| GEO BUILDING 60M | `filterByRadius(BUILDING_RADIUS=60)`, lines 283-312 | **BROKEN** | All same-neighborhood deals share one centroid → distance is identical for all; 60m cannot isolate a building. Acts only as a crude "is the subject street within 60m of the centroid" gate, usually empty → falls through |
| GEO STREET 350M | `filterByRadius(STREET_RADIUS=350)`, lines 316-324 | **BROKEN** | Same centroid-collapse; 350m either admits the whole neighborhood or none. Cannot discriminate a street. Correctly self-labels scope `radius` (not `street`), which is the one honest touch |
| RADIUS FALLBACK (500m + cross-neighborhood 500/750/1000) | lines 327-338 and 356-368 | **PARTIAL** | Because different neighborhoods have distinct centroids hundreds of meters apart, a 500-1000m radius from the subject's real street coord CAN pull in adjacent-neighborhood centroids. Works at neighborhood granularity only, never building/street |
| NEIGHBORHOOD FALLBACK | default scope; `getDealsByNeighborhood` window ladder 6→12→24→48m, lines 148-162 | **WORKING** | Always functional; the reliable backbone of the estimate |

**MASTER's claim** (`MASTER:26,83-88`, P1-1): geographic valuation engine *"non-functional"*, *"Building-level and street-level scopes never find real comparables."*

**Classification: OVERSTATED (with an UNDERSTATED omission).** The geo-radius sublayers are indeed BROKEN (CONFIRMED), but MASTER omits that the **text path runs first and does find real building/street comparables** for the ~79% of deals with house numbers. The phase file `05_VALUATION_LOGIC.md:229` states this plainly: *"What saves the valuation: the text-based path (T1-T3) runs first … finds the correct deals without needing real coordinates."* Corrected fact: **the valuation engine is functional via text matching; only the geo-radius building/street layers are dead — do not describe the whole engine as non-functional.**

---

## E. FRAMEWORK VERSION

**Counter-evidence:** `package.json:27` → `"next": "^16.2.6"`; `package-lock.json` resolved `node_modules/next` = **16.2.6** (verified via lockfile). `next-auth` resolved = 5.0.0-beta.31.

**Contradiction located:** `01_SYSTEM_MAP.md:3` and `:13` state *"Next.js 14 (App Router) … VERIFIED."* Every other file is correct: `00_BASELINE.md:39` (16.2.6), `10_SECURITY.md:6`, `12/13/15/16` all say Next.js 16.

**Classification: CONTRADICTED.** Corrected fact: **the installed framework is Next.js 16.2.6; the "Next.js 14 … VERIFIED" label in 01_SYSTEM_MAP.md is wrong** (and carrying a VERIFIED tag on a false value is the more serious defect).

---

## F. AUTH MIDDLEWARE FIX — version-specific correct pattern

**Installed types (authoritative):** `node_modules/next-auth` = 5.0.0-beta.31. Its `index.d.ts:118-129` documents two supported patterns for `middleware.ts`:
1. `export { auth as middleware } from "./auth"` (plain re-export), and
2. wrapper — `import { auth } from "./auth"; export default auth((req) => { /* req.auth */ })`.

The `auth` overload signature (`index.d.ts:209-211`) includes `((...args: [NextAuthMiddleware]) => NextMiddleware)`, confirming `auth(fn)` returns a properly-typed `NextMiddleware` — no cast required.

**The competing recommendations**
- `MASTER:386` proposes `return (auth as any)(req)` as a temporary unblock.
- `10_SECURITY.md:94-98` (P1-3) recommends `export { auth as middleware }`.

**Assessment against this codebase.** The current `middleware.ts:4-12` is a *wrapper* that adds an `ADMIN_DEV_BYPASS` branch before delegating to `auth`. Therefore:
- `auth as any` (MASTER) — **CONTRADICTED**. It re-introduces the exact cast that breaks the build, suppresses the type system (the very concern 10_SECURITY raises), and can silently return undefined → unauthenticated access. Wrong fix.
- `export { auth as middleware }` (10_SECURITY) — **valid pattern but INCOMPLETE here**: a bare re-export deletes the `ADMIN_DEV_BYPASS` branch. Correct only if that branch is abandoned.
- **Recommended (version-specific, preserves behavior):** the wrapper form
  `export default auth((req) => { if (bypass) return NextResponse.next(); /* authorized handled by callback */ })`
  per `index.d.ts:124-129`. This keeps the dev-bypass, satisfies the beta types without a cast, and lets the `authorized` callback enforce access.

**Classification: CONTRADICTED** (of MASTER's `auth as any`). Corrected fact: **the installed beta types prescribe the `export default auth((req)=>…)` wrapper; neither the `as any` cast nor a bare re-export is the right fix for this file.** (Recommendation only — no code was modified. Secondary note: `00_BASELINE.md:39,151` flags that Next 16 deprecates the `middleware` convention in favor of `proxy`; that is a separate migration and does not change the correct next-auth pattern.)

---

## G. DUPLICATE DELETION — reclassify the MASTER recommendation

**MASTER recommendation:** `MASTER:179-182` (P3-6) marks 2,155 near-duplicate pairs **VERIFIED**; `MASTER:259` (Wave 1) proposes *"Deduplicate near-identical deals … removes 17% of records."*

**Counter-evidence inside the source phase file:** `03_DATA_QUALITY.md:216-238` (§6) shows the matching key is `street+houseNumber+dealDate+price±5%` and its own worked samples are **legitimately different units** in the same building on the same day:
```
שמורת נחל בניאס|7|2024-05-28  A: 126m²  B: 104m²  → "different area, different ID = legitimately different units"
```
03 itself labels the near-duplicate finding **LIKELY** (not VERIFIED) and warns these *"may be legitimate near-simultaneous sales of identical units in a new building."* The ID scheme already deduplicates exact collisions (`{neighborhoodId}-{date}-{price}-{area}`), so records surviving as distinct IDs are, by construction, distinguishable transactions.

**Classification: BLOCKED — pending identity proof (MASTER's VERIFIED is OVERSTATED).** Deleting ~2,155 rows on this heuristic would erase real distinct-unit sales (new-build lot closings, multi-unit same-day transactions), biasing percentiles. Corrected fact: **the deduplication recommendation is BLOCKED; it must not run until true row identity is proven per-pair (a separate deep-duplicate study owns that proof). MASTER's VERIFIED label on the 2,155-pair deletion is unsupported.**

---

## H. OTHER CONTRADICTIONS FOUND

| # | Contradiction | Evidence | Classification |
|---|---------------|----------|----------------|
| H1 | **Geo "non-functional" (MASTER) vs "text path saves it" (05)** | `MASTER:26,85` vs `05_VALUATION_LOGIC.md:10,229` | MASTER **OVERSTATED**; 05 is correct (matches source). Same root as Issue D |
| H2 | **Composite coefficient inconsistency is DEAD CODE** | `MASTER:126-129` (P2-4) says similarity scoring (0.45) and valuation (0.4) disagree. Source: the 0.55/0.45 weights live only in `valuation.ts:565` `sizeDistance()`, which is **defined but never called** (0 call sites). The live comparable path uses `COMP_PLOT_WEIGHT=0.4` (`valuation.ts:583`), consistent with valuation `PLOT_WEIGHT=0.4` (`valuation.ts:462`) | **OVERSTATED** — no runtime disagreement; the inconsistency exists only in unused code |
| H3 | **"Composite model effectively dead" vs it having a working fallback** | `MASTER:131-134` (P2-5). Source `valuation.ts:470-521` does degrade to built-only when `plotSqm` is null, but this is a deliberate guarded fallback with a `HOUSE_MAX_PPSQM_BUILT` sanity reset, not a defect. The `plotNotValued` flag (`valuation.ts:551`) is intentionally the "plot present but unused" signal | **CONDITIONAL** — technically true for null-plot houses, but framed as a bug rather than designed degradation; overstated in tone |
| H4 | **Internal 03 contradiction on the 2,155 pairs** | `03_DATA_QUALITY.md:222` calls 2,155 *"Same area (likely true duplicates)"* while its own samples at `:226-236` show **different** areas = different units | **CONTRADICTED (internal to 03)** — the "same area" label is inconsistent with the cited evidence |
| H5 | **yearBuilt "missing" rate: 27.4% vs 30.2%** | `00_BASELINE.md:168` / `MASTER:199` say 27.4% (counts `=0`); `03_DATA_QUALITY.md:198` corrects to 30.2% (adds `>2026` and `<1950` invalids), noting the field is never null so `==null` undercounts | **UNDERSTATED** in BASELINE/MASTER; 03's 30.2% is the correct "missing or invalid" figure |
| H6 | **Near-duplicate pair total: 2,155 (MASTER) vs 3,011 (03)** | `MASTER:180` cites 2,155; `03_DATA_QUALITY.md:219` reports **3,011 total** pairs (2,155 same-area + 856 different-area). MASTER silently dropped the 856 | **CONTRADICTED** (count mismatch); neither total justifies deletion (see G) |
| H7 | **Next.js 16 "middleware deprecated → use proxy" vs all remediations editing middleware.ts** | `00_BASELINE.md:151` warns the `middleware` convention is deprecated in Next 16; yet MASTER/10 remediations (F) all patch `middleware.ts` without addressing the deprecation | **CONDITIONAL** — fixes are correct for now but a Next 16 `proxy` migration is an unacknowledged follow-up |
| H8 | **DATA_SOURCE default "local" flagged as data-loss risk while store is documented dev-only** | `MASTER:101-104` (P1-4) VERIFIED vs `16_PRODUCTION_READINESS.md:151` "LocalStore is intended for development only" | **CONFIRMED as a real risk** (no hard guard exists), but the "silently in production" consequence is UNKNOWN (Issue B) — the code default is LOCAL_VERIFIED, the prod effect is not |

---

## Cross-cutting correction: VERIFIED inflation

The dominant systemic defect across the MASTER report is **label inflation** — findings that are LIKELY or code-only (LOCAL_VERIFIED) are stamped **VERIFIED**, including on at least one factually false value (Next.js 14, Issue E). The MASTER overview table (`MASTER:11-24`) marks 9 of 10 dimension scores "VERIFIED" despite the NOT-VERIFIED list (`MASTER:315-327`) conceding that production env, Supabase schema, delivery rates, and geocoding accuracy were never observed. Any downstream decision should treat MASTER's VERIFIED tags as **claims to re-check**, not settled facts.

---

*END OF RECONCILIATION — read-only. No source, data, or configuration modified. No secret values reproduced.*
