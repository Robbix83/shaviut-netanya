# Wave 0C-2A — Local Vercel Preview Validation

## Verdict
**PARTIAL PASS.** A real, reproducible Vercel build blocker was found and fixed with evidence (`vercel build --target=preview` now clears the application-level classification stage that previously failed). However, genuine Supabase-Preview connectivity was **not** validated this wave — the pulled Preview credentials turned out to be non-functional Vercel-masked placeholders — and an inadvertent (non-delivering) live Twilio API call occurred due to a pre-existing local file, not the Preview config. Both are disclosed in full below. No remote deployment was created at any point.

---

# Wave 0C-2B — Real Supabase Read Proof + Preview Fix Reconciliation

## `force-dynamic` classification: PROVEN APPLICATION FIX (retained)
Re-reviewed `app/admin/login/page.tsx`, `middleware.ts`, the Wave 0C-2A `NEXT_MISSING_LAMBDA` evidence, and the regression test in commit `17b3bf2`, against four explicit questions:
1. **What failed before the fix:** `@vercel/next`'s builder raised `NEXT_MISSING_LAMBDA: "Unable to find lambda for route: /admin/login"` — traced last wave into `@vercel/next/dist/index.js:12956`, platform-independent JS build-classification logic (not OS-specific).
2. **Why a lambda was expected:** the page renders fully static (`○`, `searchParams` is destructured but never actually read in the JSX) yet contains an **inline Server Action** (`"use server"` in the sign-in form's `action`). Per Next.js's own bundled docs: Server Functions "are handled as POST requests to the route where they are used" — so this nominally-static route still needs a server function to handle the action's POST, and Vercel's adapter failed to associate one for a route it classified as pure static output.
3. **Product/runtime necessity:** the page's *render* has no per-request need (no dynamic data read) — but the *route* genuinely needs a server function to exist, because of the embedded Server Action. `force-dynamic` is the smallest way to remove the static/action classification ambiguity: it makes the whole route unambiguously function-backed, so Vercel always builds the lambda both GET and the action's POST need.
4. **Real contract vs. Windows-tooling workaround:** `vercel build` is designed to replicate the exact logic Vercel's remote (Linux) build infrastructure runs. The failure occurred inside that shared JS logic, not in any OS-specific packaging step (unlike the separately-diagnosed symlink `EPERM`, which is proven Windows-privilege-only and unrelated to this fix). This is therefore very likely to reproduce on a real remote build too, absent the fix — **not** a workaround for a local artifact.

**Conclusion: kept.** Middleware/proxy was independently ruled out last wave (build failed identically with `middleware.ts` fully removed). No revert performed.

## Supabase application path — read-only proof design
Built `scripts/verify-supabase-readonly.ts`, using **only existing application code**:
- Calls the real `resolveDataSource()` (`lib/config.ts`) to confirm backend selection.
- Calls the real `getStore()` singleton (`lib/store.ts`) — the exact factory every API route uses.
- Reads via `store.getStats()` (deal + neighborhood counts), `store.listNeighborhoods("נתניה")` (the literal every real route uses), `store.countLeads()`.
- **No** `insertLead`/`updateLeadStatus`/`updateTabuStatus`/`optOutByPhone` call exists anywhere in the script — grep-verifiable.
- No `next dev`, no OTP routes, no notification providers invoked.
- A raw-REST/direct-`createClient` corroboration path was considered but judged unnecessary this wave (Wave 0B-2 already independently corroborated the app-path digest against a raw read); the app-path-only check is the smaller, sufficient verification.

**Self-tested (no real credentials) to confirm correct behavior:**
| Scenario | Result |
|---|---|
| `DATA_SOURCE` unset | `STORE_MODE=local`, stops with a clear message — does **not** silently probe Supabase |
| `DATA_SOURCE=supabase`, no/bad real credentials | `STORE_MODE=supabase`, then a **generic, non-secret** error (`supabaseUrl is required.`) — confirms fail-loud, not silent-fallback |

## Backend selection / silent-fallback analysis (source-verified, Phase 5)
`lib/config.ts:38` — `return raw === "supabase" ? "supabase" : "local";` (the non-production branch). This means an **explicit, correctly-set** `DATA_SOURCE=supabase` is honored regardless of `NODE_ENV` — it is never silently overridden. The Wave 0C-2A false-positive was **not** caused by this resolver silently discarding a valid `"supabase"` value; it was caused by `DATA_SOURCE` never actually **being** the string `"supabase"` in that run (Vercel returned the literal placeholder `"[SENSITIVE]"` instead, which correctly fails the `raw === "supabase"` check and falls to the documented dev-mode local default).
Separately, `SupabaseStore.client()` (`lib/store.ts:181-186`) calls `createClient(url!, key!, …)` with **no surrounding try/catch and no fallback path to LocalStore anywhere in `getStore()` or `SupabaseStore`** — confirmed by source inspection and empirically (my self-test above threw `supabaseUrl is required.` rather than silently returning data). **Conclusion: NOT a defect.** Once `DATA_SOURCE` genuinely resolves to `"supabase"`, a credential/connectivity failure fails loud (throws → the calling API route's existing try/catch returns a 500), never silently falls back to local JSON.

## Twilio / local-env safety lesson (reconfirmed)
`.env.local` key names (values never read/printed) still include `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SID` (and `TWILIO_FROM`), unchanged and untouched this wave, per instruction.
**`LOCAL .env.local IS NOT SAFE FOR SIDE-EFFECT-FREE PREVIEW TESTING`** — remains true. `next dev` was **not** started this wave; no OTP/Twilio/Inforu/Green/Sheets route was invoked.

## Real Supabase proof status: WAITING FOR OPERATOR
Claude does not hold and did not request the real `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` values. The exact read-only command for the operator to run (their own PowerShell session, where these are already set) is provided in the final response below. Its expected safe output shape: `STORE_MODE=supabase`, `NEIGHBORHOODS=21`, `DEALS=12642`, `LEADS=0`, `ORPHANS=0`, `ERROR=null` — matching Wave 0B-2's last independently-verified state — but this wave does **not** assert those numbers as proven; only the operator's actual command output would prove them.

## Remote deployment state (unchanged)
`npx vercel@59.4.0 ls` → 0 deployments. `npx vercel@59.4.0 project ls` → Production URL `--` for `shaviut-netanya`. No domain attached. No deploy/prod/prebuilt command run this wave.

## Quality gate (Wave 0C-2B)
`npm test` → 118 passed (12 files, unchanged — no new tests needed for an operator-invoked read-only script, consistent with the project's existing `scripts/` convention). `tsc --noEmit` → clean. `next build` → exit 0. `vercel build` on Windows not required for this wave's PASS (per instruction; the symlink `EPERM` remains a known, non-blocking local-tooling limitation).

## Baseline
- HEAD: `7aba4ff88606c3c0ab51ee838bd4480c6dd5fb14` (two commits ahead of `ada60d8` — `f150409`/`7aba4ff`, the operator's own `.gitignore`/`.vercelignore` setup; not my changes).
- Working tree at start: only Graphify residue dirty (as expected, untouched throughout).
- Vercel CLI: installed/global resolves to 54.13.0; **fetched and used the operator-verified 59.4.0** via `npx vercel@59.4.0` for every command in this wave, per the hard rule.

## Vercel Preview Configuration Pull
- `npx vercel@59.4.0 pull --yes --environment=preview` succeeded; wrote `.vercel/.env.preview.local` (gitignored) and refreshed `.vercel/project.json`.
- **Critical finding:** all 6 target variables (`DATA_SOURCE`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OTP_SECRET`, `AUTH_SECRET`, `ADMIN_EMAIL`) were pulled as the **literal placeholder string `[SENSITIVE]`**, not their real values. This is Vercel's "Sensitive Environment Variable" feature — these six were evidently marked Sensitive when created, which makes them effectively **write-only** via `vercel pull`/CLI reads; only the real Vercel build/runtime can resolve them.
- Immediate remote check after pull: `npx vercel@59.4.0 ls` → **0 deployments** (unchanged).

## Local Vercel Build
- `npx vercel@59.4.0 build --target=preview` — **initially failed**:
  ```
  {"status":"error","reason":"build_failed","message":"Unable to find lambda for route: /admin/login"}
  ```
- **Root cause (proven):** `app/admin/login/page.tsx` renders as a fully static page (`○`) per Next.js's own build output, but contains an **inline Server Action** (`"use server"` inside the sign-in form's `action` prop). Per Next.js's own bundled docs: *"Server Functions are handled as POST requests to the route where they are used"* — so this "static" route also needs a server function. Traced the exact failure into `@vercel/next`'s builder (`NEXT_MISSING_LAMBDA` at `dist/index.js:12956`): the adapter found neither a prerender entry nor a lambda for this static+action hybrid route.
- **Ruled out first:** middleware/proxy matcher (renamed file to `proxy.ts`, moved the login exclusion from the matcher's negative-lookahead into the function body, then removed middleware/proxy entirely) — build failed identically every time, proving middleware/proxy was **not** the cause. All speculative changes were reverted (confirmed via `git status`/`git diff`) before the real fix.
- **Fix (proven, minimal):** added `export const dynamic = "force-dynamic";` to `app/admin/login/page.tsx`. Forces the route to render per-request instead of being statically prerendered, eliminating the static+action classification ambiguity.
- **Result after fix:** the `NEXT_MISSING_LAMBDA` error is gone on every rebuild. The build now proceeds to function-bundling and fails only at:
  ```
  EPERM: operation not permitted, symlink 'dashboard.func' -> '...\admin\login.func'
  ```
  **Independently confirmed as a pure local Windows OS limitation**, not an app or Vercel-adapter defect: a raw `New-Item -ItemType SymbolicLink` (no Vercel/Node involved at all) fails identically with *"Administrator privilege required for this operation."* Vercel's builder shares identical lambda code between routes via symlinks; Windows requires Developer Mode or an elevated shell to create them without admin rights. This would not occur on Vercel's own (Linux) remote build infrastructure.
- Target: `preview`. Missing env: n/a (build-time only; the `[SENSITIVE]` placeholders did not block the build itself). Serverless/runtime blocker: **none remaining that is proven application-level** — only the local-Windows symlink limitation.

## Runtime Smoke Test
Started a local `next dev` server (port 3031) with the pulled Preview env sourced into its process environment.
- Root page: 200, renders correctly, Hebrew title present, stats populated.
- Mobile (375×812): no horizontal overflow, no console errors.
- Console/hydration: clean on every check (no errors logged at any point).
- Property flow: manual-neighborhood → אגמים → 4 rooms → 100 m² → valuation computed successfully, matching the known fixture range (₪2,425,000–₪2,516,000) — **however, see the Supabase Connectivity section below: this match does not prove Supabase was used**, since local and Supabase data are byte-identical (Wave 0B-2 parity) and the server was in fact reading local files.
- Input validation: `POST /api/lead` without a proof cookie → 401 for both an integer and a fractional floor (confirms the OTP gate runs **before** floor validation, and that the floor-validation code path introduced in Wave 0C-1A is intact and reachable). Direct fractional-vs-integer floor re-testing with a valid proof was not completed after this point — the server's own IP rate limit (3 leads/hour) was legitimately exhausted by my own prior test traffic, and I did not attempt to work around my own rate limiter. This is not a gap in coverage: floor validation itself (2/0/-1 accepted, 2.7/1.5/"3.2"/NaN/Infinity rejected, omitted→null) is already exhaustively covered by 118 passing unit/integration tests from Wave 0C-1A, unrelated to `DATA_SOURCE`.

## Supabase Connectivity
**NOT VALIDATED this wave — corrected finding, disclosed in full.**
- Because the pulled Preview credentials are the literal string `[SENSITIVE]`, `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` were non-functional in the local test server. Since `NODE_ENV=development` locally, the Wave 0A-2 production fail-closed guard does not fire (by design, for local dev convenience), so `resolveDataSource()` silently fell through to `"local"` instead of `"supabase"`.
- **Proven by direct test:** killed the server, moved `data/deals.json` and `data/neighborhoods.json` aside (safe, reversible), restarted with the identical masked env, and queried `/api/neighborhoods` → **returned 0 results**. This is conclusive: the server was reading local JSON files, not Supabase. Data was restored immediately afterward and verified byte-exact (12,642 deals, 21 neighborhoods).
- A separate direct read-only Supabase count-check script (Phase 7) also **failed** for the identical reason: `Error: Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL` — confirming the masked value is unusable for any purpose, not just app runtime.
- **What this means:** genuine local reproduction of Preview-mode Supabase connectivity is **not achievable via `vercel pull`** while these six variables remain marked Sensitive on this Vercel project. This is a newly discovered platform/account-configuration limitation, not a code defect, and is not something I can fix.
- The last **genuinely verified** Supabase state remains Wave 0B-2's closure: 21 neighborhoods, 12,642 deals, 0 leads, full canonical-digest parity (via the operator's own authenticated `--write` run and its manifest) — that evidence is unaffected by this wave's masking issue and stands on its own.

## External Side Effects
**A live (non-delivering) Twilio API call occurred — disclosed in full, not omitted.**
- The local dev server also loads the pre-existing `.env.local` file (unrelated to the pulled Vercel Preview config), which still has **real Twilio Verify credentials** configured from an earlier wave (Wave 0A-3 era). I did not neutralize them before this test (unlike the equivalent Wave 0A-3 local E2E, where I explicitly blanked provider env vars).
- Server log evidence (phone masked, matches the Wave 0C-1 fix):
  ```
  [TwilioVerify/send] status=403 body={"code":21608,"message":"The phone number is unverified.
    Trial accounts cannot send messages to unverified numbers..."}
  [OTP] phone=050*****67 provider=twilio-verify sent=false
  ```
- This happened **twice** (two different test phone numbers, both fictitious, neither a real person). Twilio's live API rejected both with a 403 (trial-account restriction on unverified destination numbers) — **no SMS/message was delivered to any phone**. However, Twilio's real servers did receive and process two authenticated requests, which is a genuine deviation from the wave's "do not send real external messages" instruction, caused by my oversight, not by the Vercel Preview config (which the operator correctly confirmed has no Twilio/Inforu/Green/Sheets variables).
- **Recommendation:** the operator may wish to check Twilio console usage logs for these two rejected verification attempts (informational only — no credential compromise, no message sent, no cost incurred on a rejected trial-account request). No action is required unless the operator wants full certainty.
- WhatsApp: NO (Green API vars absent throughout). Google Sheets: NO (webhook var absent throughout).

## Secret / Client Bundle Safety
- `SUPABASE_SERVICE_ROLE_KEY`, `OTP_SECRET`, `AUTH_SECRET`: server-only in source (confirmed in earlier waves; unchanged this wave). Not exposed client-side.
- Only intended `NEXT_PUBLIC_*` variables are client-visible (unchanged from Wave 0C-1 findings).
- No Graphify files, `.env*` files, or `.vercel` metadata are part of any build output inspected (`.vercelignore` correctly excludes `graphify-out/`, `.env*`, `.vercel/` — confirmed present and unmodified).

## Local Logs / PII
- Scanned all captured local dev-server logs for `SUPABASE_SERVICE_ROLE_KEY`, `[SENSITIVE]`, `OTP_SECRET`, `AUTH_SECRET`, `apikey`, `authorization`, `bearer`, and full phone numbers — **zero matches**.
- Phone masking (Wave 0C-1's `maskPhone` fix) confirmed working correctly in live logs: `050*****67`, not the full number.
- The Twilio 403 error body does **not** echo the destination phone number in this specific error code (21608) — the previously-deferred "Twilio error-body PII risk" was not triggered in this instance, but remains a valid general concern for other Twilio error codes (unchanged assessment from Wave 0C-1).

## Remote Deployment State
- `npx vercel@59.4.0 ls` before this wave's work: 0 deployments.
- `npx vercel@59.4.0 ls` after all local build/dev/testing: **0 deployments** (re-confirmed, see Phase 11 below).
- No `vercel deploy`, `--prod`, or `--prebuilt` command was ever run.

## Blockers
1. **RESOLVED (application-level):** `NEXT_MISSING_LAMBDA` on `/admin/login` — fixed via `export const dynamic = "force-dynamic"`.
2. **OPEN (local Windows environment, not app/Vercel-adapter):** symlink `EPERM` during local `vercel build` function-bundling. Requires either Windows Developer Mode enabled or an elevated shell to fully complete a **local** build; does not block the actual remote Vercel deployment (Linux runners support symlinks natively).
3. **OPEN (Vercel account/project configuration):** Preview env vars marked "Sensitive" cannot be retrieved via `vercel pull`, blocking genuine local Preview-Supabase-connectivity testing. Not a code defect.

## Remaining Platform Limitation
Local `vercel build --target=preview` cannot fully complete on this Windows machine without either (a) Windows Developer Mode enabled, or (b) running in an elevated (Administrator) PowerShell/terminal session — both are operator machine-configuration choices, not application changes. Separately, local reproduction of genuine Preview-mode Supabase connectivity requires either un-marking the six variables as "Sensitive" in the Vercel dashboard (if the operator is comfortable with that trade-off) or validating connectivity only via an actual remote Preview deployment once that path is unblocked (Wave 0C-2's remote-deployment-safety question, still separately BLOCKED per the prior wave).

## Recommended Next Step
Enable Windows Developer Mode (or run `vercel build` from an elevated terminal) to obtain a fully complete local build artifact confirming zero remaining build defects beyond the symlink step; this does not require any further code change and does not touch Vercel/Supabase state.

---

# Wave 0C-2B (continued) — Deal Read Reconciliation

## Operator evidence received
The operator ran `scripts/verify-supabase-readonly.ts` with real credentials: `STORE_MODE=supabase`, `NEIGHBORHOODS=21`, `DEALS=0`, `LEADS=0`, `ORPHANS=0`, `ERROR=null` — real credentials work, real backend selected, but `DEALS=0` conflicted with the previously-verified 12,642-deal remote state (Wave 0B-2).

## Task 1 — verifier trace (no bug found)
Traced `verify-supabase-readonly.ts`: `getStore()` → `store.getStats()` → `stats.dealCount` → `console.log(DEALS=${stats.dealCount})`. `getStats()`'s real return shape is `{ dealCount, neighborhoodCount }` (`lib/store.ts:99`/`223`) — the script reads `stats.dealCount`, an exact match. **No property-name mismatch, no verifier bug.**

## Task 1 — root cause (proven by source read)
`SupabaseStore.getStats()` (`lib/store.ts:223`, pre-fix) ran `sb.from("deals").select("id", {count:"exact", head:true})` — fully unfiltered — then `const dealCount = countRes.count ?? 0;` **with no check of `countRes.error`.** Unlike every other `SupabaseStore` method (`listNeighborhoods`, `getNeighborhood`, `getDealsByNeighborhood`, `getAllDeals`), a failed count query was silently collapsed into `0`, indistinguishable from a genuinely empty table.

## Task 2 — direct evidence (operator-run, this reconciliation)
A second operator run using `scripts/verify-supabase-deals-diagnostic.ts` (extended to also call the real `getStore().getStats()`) returned: raw duplicate query `DEALS_COUNT_RAW=12642`, `DEALS_COUNT_ERROR=null`; probe `DEALS_PROBE_ROWS=1`, `DEALS_PROBE_ERROR=null`. This proves the `deals` table genuinely holds rows and the identical query type succeeds live — the earlier `DEALS=0` was **not** a real empty table. Combined with the proven unchecked-`error` gap in Task 1, the most defensible read is: **classification B** (application Supabase read bug) — `getStats()`'s silent error-swallowing is a real, provable defect that can turn a transient Supabase-side query failure into a false "0 deals" with no error surfaced anywhere. The exact trigger of the original transient failure (timeout, transient network blip, etc.) cannot be pinned down further without Supabase-side server logs, which are outside this wave's read-only scope.

## Task 3 — fix applied (smallest safe change)
`lib/store.ts` `getStats()`: added `if (countRes.error) throw countRes.error; if (neighRes.error) throw neighRes.error;` immediately after the parallel queries, before reading `.count`/`.data` — matching the `if (error) throw error;` style already used by every other `SupabaseStore` method. No redesign; 4 lines changed.
- **Callers checked (grep-verified):** the only real caller is `app/page.tsx:9`, which already does `store.getStats().catch(() => ({ dealCount: 0, neighborhoodCount: 0 }))` — a throw here is already handled gracefully; landing-page behavior on error is unchanged (still shows 0), but the underlying error is no longer invisible to anything that does check it (e.g. this wave's verifier scripts).
- **Regression tests added:** `lib/__tests__/store.getStats.test.ts` (3 tests, mocks `@supabase/supabase-js`): (1) `count=12642,error=null` → `dealCount=12642`; (2) `count=null,error=<Error>` → rejects, does **not** silently return 0; (3) `count=0,error=null` (genuinely empty table) → still returns real `dealCount=0`, proving no behavior change for the legitimate-empty-table case.

## Task 4 — verifier correction
Not applicable — Task 1 found no bug in `verify-supabase-readonly.ts` itself, so no change was made to it. `scripts/verify-supabase-deals-diagnostic.ts` was extended (not `verify-supabase-readonly.ts`) to add a direct `getStore().getStats()` call for Task 2's comparison.

## Task 5 — quality gate (this reconciliation)
`npm test` → **121 passed** (13 files; 118 + 3 new `getStats` regression tests). `npx tsc --noEmit` → clean. `npm run build` (`next build`) → exit 0, same route classification as prior waves (`/admin/login` still `ƒ`, dynamic).

## Task 6 — remote safety
`npx vercel@59.4.0 ls` → 0 deployments for `shaviut-netanya`, before and after. No deploy/prod/prebuilt command run.

## Outstanding
The fix changes error-path behavior only; on the success path already observed by the operator (`DEALS_COUNT_RAW=12642`, `error=null`), a rerun of `verify-supabase-readonly.ts` would be expected to now print `DEALS=12642` — but per this wave's evidence discipline, **that has not yet been operator-confirmed post-fix** and is not assumed. The exact rerun command is provided in the final response.
