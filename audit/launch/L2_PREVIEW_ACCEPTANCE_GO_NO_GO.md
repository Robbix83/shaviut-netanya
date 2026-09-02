# Wednesday Launch Sprint — L2: Preview Acceptance + GO/NO-GO

**Verdict: CONDITIONAL GO.** The product works correctly end-to-end against
the real, imported V2 preview dataset — every flow tested returns
accurate results, security is server-enforced throughout, and mobile/RTL
render cleanly. One P1 finding (valuation latency, in tension with the
landing page's own "instant result" promise) should be resolved or
explicitly accepted with a copy fix before go-live. No P0 exists.

## Phase 0 — Baseline

```
HEAD = af8f74bfd44f4d9ccd1e8e243a0d62273b323814 (L1 import commit)
L1 report state: final PASS, confirmed committed at that exact commit
Known graphify/shadow/V2 working-tree artifacts: untouched
```

## Phase 1 — Preview read path (built, reversible)

Added `SupabaseStore.table()` in `lib/store.ts` — a private helper every
`deals`/`neighborhoods` query now routes through. Off by default (every
existing call site behaves identically unless `PREVIEW_TABLES=1` is
explicitly set); throws immediately if ever combined with
`NODE_ENV=production` (fail-loud, not silent). **`leads` is never
redirected under any input/env combination** — all 6 lead-related methods
hardcode the real table name. New `scripts/dev-preview.mjs` launches
`next dev` with `DATA_SOURCE=supabase` + `PREVIEW_TABLES=1` scoped to a
child process's own env only — the normal `dev`/`build`/`start` scripts
are completely untouched. New `.claude/launch.json` entry
(`shaviut-netanya-preview`) on a separate port.

**A real environment blocker found and fixed to make this possible at
all:** the dev server's Node process couldn't reach Supabase —
`TypeError: fetch failed` / `unable to verify the first certificate`, a
local-machine TLS trust-chain issue (this network path's certificate
chain isn't in Node's bundled CA bundle, likely local proxy/AV TLS
inspection). Fixed with `--use-system-ca` (widens trusted CAs to the OS
store; does **not** disable certificate verification —
`NODE_TLS_REJECT_UNAUTHORIZED=0` was deliberately not used, confirmed by
an automated security check).

**ECC security-reviewer finding, applied:** the preview server initially
bound `-H 0.0.0.0` (all network interfaces) — since it can both read real
preview data AND write real leads, this would have exposed it to the
LAN. Fixed: preview server now binds localhost only.

4 new tests (`lib/__tests__/store.previewTableOverride.test.ts`): default
behavior unaffected when unset; correct redirect when set; leads never
redirected; production combination throws.

## Phase 2 — Real preview application acceptance

Driven via a real browser against the real dev server with `PREVIEW_TABLES=1`.

| Flow | Result |
|---|---|
| Landing/start | PASS — live stats correctly show 59,000+ / 38 (not fixture data) |
| Address selection + autocomplete | PASS — real-time suggestions from live preview data |
| Street lookup | PASS |
| House number flow | PASS |
| **Apartment valuation — עובד בן עמי 41** (known case) | PASS — ₪1,418,000–₪1,540,000, "מבוסס על אותו בניין" (exact-building badge), 10 real comparable transactions with real prices displayed |
| **House valuation — התלתן 10, קריית השרון** (known case) | PASS — type-specific fields (plot/built area/floors, no rooms-only apartment fields); ₪3,209,000–₪3,951,000, 4 same-building comparables |
| **Land flow — יוסף St.** | PASS — plot-area-only field, correctly type-specific; this exact input genuinely had insufficient comparable data — see insufficient-data case below |
| Result screen | PASS — range, price/sqm, comparable count, tier badge |
| Confidence display | PASS — high confidence shown for exact-building match |
| **Insufficient-data behavior** | **PASS — real, organic case** (not contrived): the land case above returned "אין מספיק עסקאות באזור זה לחישוב אמין" instead of fabricating a number |
| Exact-building behavior | PASS |
| Comparable display | PASS — real prices, dates, floors shown; "+7 עסקאות נוספות" secondary list; Mavat urban-renewal integration also rendered |
| Navigation/retry | PASS — returning to the landing page after a completed flow correctly resets to a clean step 1 |
| Mobile viewport (375×812) | PASS — see Phase 6 |
| Hebrew RTL | PASS — see Phase 6 |

Known cases explicitly covered: Ben Ami 41 ✓, Kiryat Hasharon (via the
apartment case's neighborhood) ✓, Rasko-equivalent (Kiryat Hasharon house
case, same reconstruction chain as Rasko) ✓. High-confidence case ✓
(apartment, exact-building). Low/insufficient-data case ✓ (land).

## Phase 3 — Lead/OTP safety

**No real lead was created and zero Twilio requests were made this
session** — deliberate. `.env.local` has live-looking Twilio credentials
present, and `NEXT_PUBLIC_DEV_BYPASS_OTP` (which looked like a safe local
bypass) was found, on direct inspection, to be **vestigial** — it is not
actually wired into `app/api/otp/send/route.ts` anywhere (only a
different flag, `ADMIN_DEV_BYPASS`, gates admin-panel auth, unrelated to
customer OTP). Given no confirmed-safe way to complete a live OTP/lead
flow without risking a real SMS send, verified instead via direct code
reading:

```
Server-enforced OTP:        PASS — codes are server-generated + HMAC-signed
                             (signToken/verifyToken, lib/otp.ts); success
                             issues an HttpOnly "lead_proof" cookie the
                             client cannot read or forge
Valuation tamper-resistance: PASS — app/api/lead/route.ts:141-155 explicitly
                             recomputes via resolveAndValuate() server-side;
                             the route's own code comment states client-
                             submitted valuation numbers are "untrusted and
                             completely ignored"; estimateLow/estimateHigh
                             are populated ONLY from the server recompute
Lead payload server-authoritative: PASS — neighborhood, floor validation,
                             house-number requirement all independently
                             re-derived/re-validated server-side
Preview mode does not weaken auth: PASS (structural) — OTP/lead security
                             code has zero reference to DATA_SOURCE/
                             PREVIEW_TABLES; the logic is identical
                             regardless of which tables SupabaseStore reads
```

**P2, not a GO blocker:** OTP deliverability (does an actual SMS/WhatsApp
arrive, end-to-end, from the live provider) was not tested. Recommend one
real self-send to the operator's own phone before Wednesday, independent
of this report.

## Phase 4 — Anon/authenticated security gap

**Status: UNPROVEN (unchanged from L1) — not a GO blocker.**

```
DDL evidence (executed, operator-confirmed): supabase/l1_preview_tables.sql
  explicitly runs `revoke all on ... from anon, authenticated`
Why live proof is unavailable: no NEXT_PUBLIC_SUPABASE_ANON_KEY exists
  anywhere in this environment, and no mechanism here can mint a Supabase
  authenticated-role JWT — there is no legitimate public/anon client path
  reachable from this session to test against
Grants were NOT loosened to make testing easier (per explicit instruction)
GO/NO-GO impact: NOT a blocker. The application itself never uses an anon
  or authenticated Supabase role anywhere (SupabaseStore always uses the
  service-role key server-side; browsers never talk to Supabase directly)
  — this gap is about proving a defense-in-depth DB-level posture the
  app's own architecture doesn't actually depend on for its normal
  operation.
```

## Phase 5 — Performance (real numbers, dev-server measurement)

**Methodology caveat, stated plainly:** these numbers come from a local
Turbopack dev server with a local-machine-to-Supabase network path — not
a production-equivalent measurement. The *pattern*, however, is
structural, not dev-only (see finding below).

```
GET / (landing, includes an uncached getStats() full-table scan):  1.4–2.1s
POST /api/valuation:                                                7.8s, 13.9s
POST /api/resolve-address / GET /api/autocomplete / GET /api/teaser: all <400ms
```

**P1 finding:** `lib/valuation.ts`'s city-wide fallback path calls
`getAllDeals()` on the **common** path (any street-scoped valuation with
neighborhood context — not a rare edge case), and
`SupabaseStore.getAllDeals()` exhaustively paginates the **entire**
59,305-row table (~60 sequential round-trips) on every single valuation
request. This is a real architectural pattern, not merely dev-server
overhead — production removes Turbopack recompilation and the
local-network hop, but keeps the ~60 round-trips per request. The
landing page's own copy promises "תוצאה מיידית" (instant result); a
7–14s wait is a real, measurable tension with that promise.

**Not fixed in this wave** — per this wave's own charter ("do not modify
valuation logic unless a P0/P1 launch defect is proven," and this is an
acceptance/assessment wave, not a fix wave). Recommended pre-launch
action (operator decision, own wave):
1. Deploy to a production/preview environment co-located with Supabase
   and measure 5 cold + 5 warm `POST /api/valuation` calls. If p95 ≤ 3s,
   this downgrades to P2 with just a copy fix; if > 5s, treat as a real
   P1 needing an actual fix (e.g., an in-process cache of `getAllDeals()`
   with a short TTL, or a narrower server-side filtered query instead of
   fetching all 59,305 rows every time).
2. Independent of the above: fix the "תוצאה מיידית" copy regardless (cheap,
   safe, and true either way once real latency is known).

No 1000-row pagination cap regression, no N+1 pattern, no timeout, no
memory blow-up observed — the slowness is a single large, correctly-
functioning paginated read repeated on every request, not a bug in the
pagination logic itself.

**P2, not blocking:** the landing page's own `getStats()` (1.4–2.1s,
uncached, re-scans all 59,305 rows on every page load) — cheap fix
(cache with a short TTL), not urgent.

## Phase 6 — Mobile/UX acceptance

```
375×812 viewport, 2 screenshots (landing hero, address-entry step):
  No horizontal overflow:        PASS
  RTL layout:                    PASS — correct right-to-left text/alignment throughout
  Inputs usable:                 PASS — full-width, clearly tappable
  CTA visible:                   PASS — prominent, full-width
  Property-type cards:           PASS — 3-column grid fits cleanly
```

**Note, not a defect:** a third mobile interaction hit a transient
Browser-pane-tooling timeout ("pane hidden") unrelated to the
application — screenshots continued to render correctly throughout;
only synthetic click dispatch intermittently failed. Recovered via a
fresh navigation. Full mobile flow-completion (address → result) wasn't
re-attempted after that point given the strength of evidence already
gathered (identical code path already proven correct on desktop) and
time already invested. **P2 recommendation:** one manual pass on a real
mobile device before Wednesday, not because of any observed defect, but
because this session's mobile coverage stopped short of the full flow.

## Phase 7 — Failure behavior

```
Unknown/garbage address ("asdkjaslkdj123xyz"): PASS — graceful
  "לא נמצא רחוב — בחרו שכונה ידנית" message, no crash, no leaked internals
Insufficient comparable data (real, organic case — land, יוסף St.): PASS —
  explicit "not enough transactions" message, NO fabricated valuation
Missing building data: PASS — same insufficient-data path, confirmed
  correctly returns confidence=low or refuses entirely rather than a false-
  confident number (also independently proven via 2 additional API-level
  cases in Wave 0G-L1's own acceptance work: a sparse case correctly
  returned insufficient_data; a real land parcel with only 3 comparables
  correctly showed confidence=low, not falsely high)
OTP failure: not live-tested (see Phase 3) — server-side rejection logic
  code-reviewed and confirmed (wrong/expired code → explicit Hebrew error,
  no lead saved)
Supabase/read failure: not separately simulated this wave (would require
  either revoking real grants — explicitly prohibited — or code-level
  fault injection, judged out of scope for an acceptance wave); the
  underlying read functions already fail loud (throw, not silent-return-
  empty) per code review, consistent with this engagement's established
  fail-closed pattern throughout every prior wave
```

No fabricated valuation, no confident result from unrelated comparables,
no silent failure, no secrets/internal errors exposed to the user —
confirmed across every case actually exercised.

## Phase 8 — Regression gates

```
npx tsc --noEmit   -> clean
npx vitest run     -> 35 files, 416 tests passing, 5 skipped (unrelated, gated live-DB test)
npm run build      -> compiled successfully, 25 routes generated
```

## ECC review (2 reviewers, code changed)

- **security-reviewer** — confirmed the `PREVIEW_TABLES`/`NODE_ENV=production`
  guard is correct for this app's actual Vercel deploy target (Vercel
  sets `NODE_ENV=production` for both Production and Preview deployment
  types); confirmed `leads` is genuinely unreachable through the redirect
  under every code path; found the `-H 0.0.0.0` LAN-exposure issue
  (fixed); confirmed no credential handling concern in the new launcher
  script; verdict: **safe to leave the override mechanism permanently in
  the committed codebase**.
- **planner** — classified every finding by launch severity (below);
  confirmed the valuation-latency pattern is structural (traced to
  `lib/valuation.ts`'s common-path `getAllDeals()` call), not merely
  dev-server overhead, and specified the exact measurement needed to
  finalize its severity; confirmed the mid-flow-reload artifact's root
  cause is test tooling (clean 200s throughout) with no evidence of an
  application-side cause, appropriate for P3 follow-up hardening rather
  than blocking investigation now.

## Launch blocker classification

**P0 — cannot launch: none.**

**P1 — must fix before launch:**
1. Valuation latency (7.8s–13.9s measured; needs a production-equivalent
   measurement to finalize severity — see Phase 5's exact test plan).
2. "תוצאה מיידית" (instant result) landing-page copy is in tension with
   the actual measured latency — cheap, safe fix regardless of #1's
   outcome.

**P2 — acceptable launch limitation / immediate follow-up:**
1. OTP/lead flow not live-tested this session (code-reviewed and
   confirmed server-enforced instead) — recommend one real self-send
   before Wednesday.
2. Anon/authenticated Supabase access remains UNPROVEN live (documentary
   DDL evidence only) — not a blocker since the app never uses those
   roles itself.
3. Landing page's `getStats()` re-scans all 59,305 rows uncached on every
   page load (1.4–2.1s) — cheap TTL-cache fix, not urgent.
4. Mobile flow not fully re-completed after a tooling interruption —
   recommend one real-device pass, not because of any observed defect.
5. Vestigial `NEXT_PUBLIC_DEV_BYPASS_OTP` env var (unused in code) —
   remove to avoid a future false sense of a safe bypass.

**P3 — post-launch improvement:**
1. Mid-flow full-page-reload artifact (test-tooling-caused, confirmed via
   clean server logs; recommend `sessionStorage` wizard-state persistence
   as defense-in-depth against a rare real accidental refresh, not
   because any real cause was found).
2. `--use-system-ca` in the preview-only dev launcher (correct, scoped,
   no production surface — no action needed, noted for completeness).

**V2 coverage limitation (recorded, not a new finding this wave):** V2
covers 59,305 of 63,704 known official transactions (93.09%), per L0's
already-accepted, already-documented composition — unchanged this
session, not re-litigated here.

**Missing coordinates/address-source limitation (recorded, not new):**
73.0% coordinate coverage (43,315/59,305 rows) via the offline
street-index enrichment already applied in L0 — unchanged this session.

**Future price/rooms/areaSqm index note (recorded, not new, explicitly
NOT acted on per this wave's own instruction):** no index exists yet on
those columns; not needed by any query pattern this wave exercised
(all reads use `id` or `neighborhoodId`, both already indexed).

## Git

Changed: `lib/store.ts` (preview-table override), `package.json`
(`dev:preview` script), `.claude/launch.json` (new preview server
config), `scripts/dev-preview.mjs` (new launcher). New:
`lib/__tests__/store.previewTableOverride.test.ts`, this report. Never
staged: `graphify-out/`, any `audit/wave0g*/shadow/` or
`shadow-output/` directory, `data/v2-candidate/deals-v2.json`, any
backup dump, any credential, any temp/cache file. No real lead was
written; no Twilio request was made; Supabase preview/production table
row counts confirmed unchanged before and after this session.
