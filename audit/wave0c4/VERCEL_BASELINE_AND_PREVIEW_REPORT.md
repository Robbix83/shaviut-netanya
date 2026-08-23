# Wave 0C-4 — Controlled Vercel Baseline + First True Preview

## Status: PASS

**The first Production-target deployment is a Vercel-required technical baseline, not the application's Production launch.** It has no custom domain, is not publicly accessible (confirmed protected), was not promoted, and remains in place unmodified. The second deployment, created after the baseline existed, was correctly classified **Preview** — directly confirming Vercel Support's explanation of first-deployment behavior.

---

## Phase 1 — Deployment protection (verified before any deploy)
`npx vercel@59.4.0 project protection shaviut-netanya --json`:
```json
{
  "projectId": "prj_znbqXwl7Nf4N3qMtnsl5LJcHchlP",
  "name": "shaviut-netanya",
  "ssoProtection": { "deploymentType": "all_except_custom_domains" },
  "gitForkProtection": true
}
```
`ssoProtection.deploymentType = "all_except_custom_domains"` means every deployment URL is protected by Vercel Authentication **unless** it's on a custom domain. Since this project has (and will have) no custom domain, both the baseline and the Preview are covered. Reconfirmed before deploying: `vercel ls` → 0 deployments; `vercel project ls` → Production URL `--`, no domain attached.

## Phase 2 — Environment safety for the baseline
Static review before deploying, to determine whether the build could succeed with **zero** Production application secrets:
- `lib/config.ts:29` — `resolveDataSource()`'s fail-closed check only applies when `NODE_ENV==="production"` **and** `NEXT_PHASE !== "phase-production-build"`. Next.js sets `NEXT_PHASE=phase-production-build` itself during `next build`, so this known check does not fire at build time regardless of `DATA_SOURCE` being entirely absent from Production scope — proven from source, not assumed.
- Grepped for module-scope (eager, outside any function) `process.env` reads across the app: none found reading any of the 6 Preview-only vars. `auth.ts`'s `NextAuth({...})` call constructs providers at module scope but only *reads* `ADMIN_EMAIL` lazily inside a callback (not at construction) — confirmed by source.
- Preferred baseline posture (no Supabase service-role key, no OTP secret, no notification/provider credentials, no DEV-bypass vars in Production) was honored: **zero** Production env vars were added. Fail-closed behavior was not weakened.
- This static analysis was subsequently confirmed correct by the real deploy: the baseline built and deployed successfully with no Production secrets configured (see Phase 4).

## Phase 3 — Pre-deploy gate
`git status --short` → only pre-existing, out-of-scope `graphify-out/` residue dirty; HEAD = `1de8658` (matches expected). `npm test` → 124 passed (13 files). `npx tsc --noEmit` → clean. `npm run build` → success, same route classification as prior waves. No unrelated source change — gate proceeded.

## Phase 4 — First staged baseline deployment
```
npx vercel@59.4.0 deploy --prod --skip-domain
```
Result:
| Field | Value |
|---|---|
| Deployment ID | `dpl_JCLjnpuag2S5eB2xLHgzg1LKgRbd` |
| URL | `https://shaviut-netanya-6ycwo1czg-robbublils-projects.vercel.app` |
| Alias | `https://shaviut-netanya-robbublils-projects.vercel.app` (default project alias — a `.vercel.app` subdomain, **not** a custom domain) |
| Vercel classification | **Production** (`"target": "production"`) — exactly as Vercel Support said the first deployment would be |
| Custom/project production domain assigned | **NONE** — `--skip-domain` worked as intended |
| Build result | Succeeded with zero Production application secrets configured, confirming the Phase 2 analysis |

This is the authorized platform-bootstrap baseline only — not a public launch.

## Phase 5 — Access-protection verification
Checked both URLs as an unauthenticated client (`curl`, no Vercel session/cookies):
```
GET https://shaviut-netanya-6ycwo1czg-robbublils-projects.vercel.app/
→ HTTP/1.1 302 Found
  Location: https://vercel.com/sso-api?url=...
  X-Robots-Tag: noindex
```
Same result for the aliased URL. Both redirect straight to Vercel's SSO login (`vercel.com/login`) — **no application content, no functional app, reachable anonymously.** Confirmed protected by Vercel Authentication, not by (or in addition to) fail-closed missing-runtime-config, since Deployment Protection intercepts the request before it ever reaches the app. No STOP condition triggered.

## Phase 6 — Baseline retained
Not deleted. Will remain in place per the hard rule (Vercel Support confirmed returning to 0 deployments resets first-deployment behavior).

## Phase 7 — First true Preview deployment
```
npx vercel@59.4.0 deploy --target=preview
```
Result:
| Field | Value |
|---|---|
| Deployment ID | `dpl_G9nSPAgcSXeuyuLFvvDSDpdzTNxK` |
| URL | `https://shaviut-netanya-ilp5agjed-robbublils-projects.vercel.app` |
| Vercel classification | **Preview** (`"target": null` in the API response; `vercel ls` explicitly lists `Environment = Preview`, distinct from the baseline's `Production` row) |
| Commit/HEAD | `1de8658` (same tree as the pre-deploy gate — no source changed between the two deployments) |
| Build result | Succeeded |
| Env scope used | The 6 Preview-scoped variables (confirmed indirectly: real Supabase data is served, see Phase 8 — this could only happen if `DATA_SOURCE=supabase` and the real Supabase credentials resolved correctly for this deployment) |

`npx vercel@59.4.0 ls` after both deployments:
```
Age   Deployment                                                        Status   Environment   
57s   .../shaviut-netanya-ilp5agjed-robbublils-projects.vercel.app     Ready    Preview
2m    .../shaviut-netanya-6ycwo1czg-robbublils-projects.vercel.app     Ready    Production
```
**Preview classification confirmed — not Production.** This directly validates Vercel Support's explanation: once a first deployment exists, subsequent CLI deployments classify normally.

## Phase 8 — Preview smoke test
Since the Preview deployment is correctly SSO-protected (Phase 1/5), it cannot be reached by a plain unauthenticated request or by the Claude Browser tool (which has no way to complete Vercel's SSO login). Used `npx vercel@59.4.0 curl`, which uses the operator's own authenticated CLI session to generate a short-lived Deployment Protection bypass token internally — **the token itself was never printed, retrieved, or used outside this single CLI-managed flow**, consistent with "do not expose secrets in output."

| Check | Result |
|---|---|
| Root page | `GET /` → **HTTP 200** |
| DATA_SOURCE=supabase behavior | **Confirmed via real rendered data**, not assumed: the SSR stat badges render `21` ("שכונות בנתניה") and `12,000+` ("עסקאות במאגר", i.e. `Math.floor(12642/1000)*1000+"+"`) — only possible if `getStats()` resolved to Supabase and read the real, now-fixed 21/12,642 values (the pre-fix bug would have shown `3`, not `21`) |
| No local JSON fallback | Confirmed by the above — a local-JSON fallback would still show correct numbers for this fixture-parity dataset, so the stronger proof is the next row |
| Address/property flow — real Supabase-backed result | `GET /api/neighborhoods` → 21 real neighborhoods with real Hebrew names and ITM coordinates (e.g. `אגמים` / `66239255`), matching the known reference set exactly |
| Valuation (known Supabase-backed result path) | `POST /api/valuation` with `{neighborhoodId:"66239255", propertyType:"apartment", rooms:4, areaSqm:100, floor:2}` → `estimateLow=2,425,000`, `estimateHigh=2,516,000` — **matches the known reference fixture range from prior waves exactly**, with real comparable deals (2026 dates, real streets, real prices) |
| Integer floor accepted | Confirmed — floor=2 was accepted and used in the request above |
| Fractional floor rejected | **Not tested this wave.** Floor-integer validation (`validateFloor`) lives specifically in `/api/lead` (`app/api/lead/route.ts:120`), not `/api/valuation` (confirmed by source read: `/api/valuation` has no floor-integer check — the `floorAdjusted:false` field in its response is a comp-adjustment flag, unrelated to input validation). Testing it would require invoking `/api/lead`, which this wave's hard rules explicitly forbid ("Do not bypass OTP. Do not complete a real lead submission."). This behavior is unchanged from prior waves and already covered by the existing 124-test suite (unaffected by this wave — no source changed) |
| Mobile viewport (~375×812), hydration errors, console errors | **Not performed this wave — disclosed gap, not assumed passing.** These require a real browser session; the Preview deployment is correctly SSO-protected, and driving an authenticated browser session against it would require extracting the Deployment Protection bypass token, which is itself a sensitive credential — extracting/using it outside the single CLI-managed `vercel curl` flow was avoided per the "do not expose secrets" hard rule. Root-page HTML was inspected directly instead (Phase 8 above) and is well-formed, correctly hydrated-shape React/Next.js output with the real data values already confirmed |
| OTP-provider calls | NO — `/api/otp/send`, `/api/otp/verify` were never invoked |
| WhatsApp / Sheets | NO — no Green API or Sheets-related endpoint was invoked |

## Phase 9 — Database read-safety
Reconfirmed **live, from the deployed Preview app itself** (stronger evidence than a script, since it's the actual running application): 21 neighborhoods (via `/api/neighborhoods`), and Supabase-backed deal comps consistent with the known 12,642-deal dataset (via `/api/valuation`'s real comparable deals and price trend). A fresh `leads=0` re-read from the Preview app was **not performed** — the only path to it is the admin dashboard, which requires Google OAuth sign-in; attempting that sign-in on the operator's behalf is outside what Claude will do regardless of wave instructions (account authentication is never performed by Claude). No lead-creating endpoint was invoked this wave, so no new lead could have been written — a valid logical inference, not a fresh read, and stated as such rather than assumed equivalent to one.

## Phase 10 — Log / privacy check
`npx vercel@59.4.0 logs <preview-url>`:
```
info  λ POST /api/valuation
info  λ POST /api/valuation
info  ◇ POST /api/valuation
info  λ GET /api/neighborhoods
info  ◇ GET /
info  ◇ GET /
```
Six log lines total, exactly matching the requests made this wave. No request/response bodies logged. No service-role key, `OTP_SECRET`, `AUTH_SECRET`, phone numbers, or raw sensitive request bodies present — Vercel's runtime logs at this tier show route/method/status only, not payloads. No error-level logs.

---

## Summary tables

### Baseline
| | |
|---|---|
| Classification | Production |
| Purpose | Vercel-required first-deployment technical bootstrap only |
| Protected status | YES — confirmed via unauthenticated `curl`, 302 to Vercel SSO login |
| Aliases | `shaviut-netanya-robbublils-projects.vercel.app` (`.vercel.app` subdomain only) |
| Custom domain | NONE |
| Functional/public status | NOT publicly functional — protected, unauthenticated requests never reach the app |

### Preview
| | |
|---|---|
| Classification | Preview (confirmed, not Production) |
| URL | `shaviut-netanya-ilp5agjed-robbublils-projects.vercel.app` |
| Build | Succeeded |
| Supabase connectivity | Confirmed live via real rendered/API data (21 neighborhoods, matching-fixture valuation) |
| Smoke result | Root 200; neighborhoods/valuation correct and Supabase-backed; fractional-floor and full browser/hydration checks not performed this wave (disclosed) |
| External side effects | NONE (no OTP/WhatsApp/Sheets calls) |
| DB counts | neighborhoods=21, deals-backed valuation consistent with 12,642; leads not freshly re-read (no writes possible, since no write endpoint was called) |

**The first Production-target deployment is a Vercel-required technical baseline, not the application's Production launch.**

---

## Wave 0C-4B — Operator-authenticated Preview smoke test

The Claude Browser pane's session was not authenticated to Vercel (confirmed: navigating to the Preview URL redirected to `vercel.com`'s login page — no bypass or credential entry was attempted, per hard rules). The operator instead performed the authenticated smoke test manually in their own logged-in Chrome session and reported the evidence below.

### Desktop (operator-authenticated, real evidence)
| Check | Result |
|---|---|
| Authenticated access | PASS — Preview loaded after normal Vercel Authentication (no bypass used) |
| Root render | PASS — no 500, no error boundary |
| RTL layout | PASS — Hebrew RTL rendered correctly |
| Desktop layout | PASS — visually intact, property entry UI usable |
| Property flow | PASS — operator exercised the public flow through to a valuation result |
| Valuation | PASS — displayed `₪2,090,000 – ₪2,300,000`, ~₪22,004/m², 100 m² property, based on 18 comparable transactions, same-street comparable tier shown. This is real, operator-observed output from the live Preview, distinct from the `אגמים` fixture value checked via `vercel curl` in Wave 0C-4 (different neighborhood/inputs) — both are genuine, non-fabricated evidence, not the same number repeated |
| Hydration | PASS, based on observed evidence — no hydration error reported |
| Material application console errors | NONE |
| Favicon | `/favicon.ico` → 404 — **non-blocking cosmetic follow-up**, not fixed this wave |

**Supabase-backed runtime:** not re-derived from this smoke test alone (the operator correctly did not claim the valuation number alone proves Supabase — that exact mistake was already identified and corrected in Wave 0C-2A, since local and Supabase datasets were proven data-identical). The Supabase-backed runtime itself remains proven by Wave 0C-2B's real-credential, application-store-path evidence (`STORE_MODE=supabase`, `neighborhoods=21`, `deals=12642`, `leads=0`, `orphans=0`, `error=null`) and by Wave 0C-4's direct `vercel curl` evidence against this same Preview deployment (real 21-neighborhood API response, matching-fixture valuation). Not reopened or re-investigated this wave.

**Console attribution:** `MaxListenersExceededWarning` and `ObjectMultiplex - orphaned data...` both originate from `contentscript.js` — a browser-extension-injected script, not an application bundle. Classified as **not an application defect**.

### Mobile (375×812) — STILL PENDING
No operator evidence supplied yet. **Not tested, not assumed.** Required before this wave can close: no horizontal overflow, no clipped Hebrew RTL content, property form usable, CTA visible/usable, no major layout break, no new application-origin console errors.

### Deployment state (reconfirmed, read-only)
`npx vercel@59.4.0 ls`: 2 deployments total — Preview (`...ilp5agjed...`) and Production (`...6ycwo1czg...`, the baseline), both `Ready`, unchanged classifications from Wave 0C-4. No custom domain. Neither deployment was touched, deleted, or modified this wave.

### Open non-blocking follow-up
- `favicon.ico` → 404 on the deployed Preview. Cosmetic only; not fixed this wave.

---

## Wave 0C-4C — Responsive fix deployed to a new Preview

The responsive fix from Wave 0C-4B (commit `5a1b2b5`, `components/ValuationWizard.tsx` only — flex-wrap + `whitespace-nowrap` around both valuation-range price spans) was deployed to a **new** Preview deployment. The retained baseline and the prior Preview were left untouched.

### Deployment
| Field | Value |
|---|---|
| Deployed HEAD | `5a1b2b5` |
| Deployment ID | `dpl_5U7oT9v2kUQXndm6bHWUU93MPhzT` |
| URL | `https://shaviut-netanya-nfbbwhcvo-robbublils-projects.vercel.app` |
| Classification | **Preview** (`"target": null` in the API response; `vercel ls` lists it under `Environment = Preview`) |
| Build result | Succeeded |

`npx vercel@59.4.0 ls` after this deploy: **3 deployments total** — this new Preview, the prior Preview (`...ilp5agjed...`, retained, untouched), and the Production baseline (`...6ycwo1czg...`, retained, untouched). No custom domain.

### Runtime / safe property-flow smoke (via `npx vercel@59.4.0 curl`, same technique as Wave 0C-4 — no bypass token extracted or printed)
| Check | Result |
|---|---|
| Root | `GET /` → HTTP 200 |
| Address/property data | `GET /api/neighborhoods` → 21 real neighborhoods, identical to prior deployments |
| Valuation (Supabase-backed) | `POST /api/valuation` with the same `אגמים`/4-room/100m² input as Wave 0C-4 → identical result (`estimateLow=2,425,000`, `estimateHigh=2,516,000`) — confirms Supabase-backed runtime and no regression from the CSS-only change |
| Logs | 3 entries, exactly matching the 3 requests made (`GET /`, `GET /api/neighborhoods`, `POST /api/valuation`) — no secrets, no errors, no unexpected calls |
| OTP/Twilio/WhatsApp/Sheets | NONE invoked |
| Lead submitted | NO |

### Responsive viewport check — NOT independently re-verified against this live Preview
The Browser pane's session is still not authenticated to Vercel (confirmed again: navigating to this new Preview URL redirected straight to `vercel.com`'s login page, same as Wave 0C-4B). Per the hard rule against extracting/using bypass tokens outside the CLI's own managed flow, and since `vercel curl` only returns raw HTML/JSON (the valuation-result markup is generated client-side after a wizard interaction, not present in the static root response), there is no way to obtain real rendered-viewport DOM measurements against this specific live Preview URL without either an authenticated browser session or the operator's own testing.

**What stands in its place:** Wave 0C-4B already proved the fix correct via real browser DOM-geometry measurements (`getBoundingClientRect`, `scrollWidth` overflow checks) at all 5 required viewports (375×812, 390×844, 400×800, 768×1024, 1440 desktop) against a local dev server running the **exact same commit** (`5a1b2b5`) now deployed here — zero horizontal overflow, no mid-price wrap, clean centered stacking on narrow widths, single line preserved on tablet/desktop, RTL order correct. Since Tailwind CSS is compiled deterministically at build time from the same source and the layout is pure CSS (no data- or environment-dependent behavior), this is strong evidence the same behavior will hold here — but it is evidence from the prior wave's local testing, not a fresh observation of this deployed Preview, and is reported as such rather than re-asserted as freshly proven.

**Outstanding:** a quick operator glance at `https://shaviut-netanya-nfbbwhcvo-robbublils-projects.vercel.app` around 375–400px width (their own authenticated Chrome session) would close this gap with direct evidence, but is not required to trust the fix given the local proof already obtained on the identical committed code.
