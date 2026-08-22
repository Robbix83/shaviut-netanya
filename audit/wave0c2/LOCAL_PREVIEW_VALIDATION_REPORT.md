# Wave 0C-2A — Local Vercel Preview Validation

## Verdict
**PARTIAL PASS.** A real, reproducible Vercel build blocker was found and fixed with evidence (`vercel build --target=preview` now clears the application-level classification stage that previously failed). However, genuine Supabase-Preview connectivity was **not** validated this wave — the pulled Preview credentials turned out to be non-functional Vercel-masked placeholders — and an inadvertent (non-delivering) live Twilio API call occurred due to a pre-existing local file, not the Preview config. Both are disclosed in full below. No remote deployment was created at any point.

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
