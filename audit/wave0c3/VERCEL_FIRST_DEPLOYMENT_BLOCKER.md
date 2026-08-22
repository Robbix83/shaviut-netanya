# Wave 0C-3 — Vercel First-Deployment Platform Blocker

## Status
**BLOCKED.** No Vercel-supported, explicitly-guaranteed procedure was found this wave that ensures a fresh project's first deployment is classified strictly Preview, with zero Production deployments, zero Production aliases, and no placeholder Production baseline. No deployment was attempted. The project remains at exactly 0 deployments.

---

## Phase 1 — Read-only state snapshot (sanitized, no values)

Captured via `npx vercel@59.4.0` (operator-verified CLI version), read-only commands only.

| Field | Value |
|---|---|
| Project | `robbublils-projects/shaviut-netanya` (`prj_znbqXwl7Nf4N3qMtnsl5LJcHchlP`) |
| Org / team | `team_R1uw7cwaZ5qEdTljXglFjTdo` (`robbublils-projects`) |
| Deployment count | **0** (`vercel ls` → "No deployments found under robbublils-projects.") |
| Production URL | `--` (none) — via `vercel project ls` |
| Custom domain (project-scoped) | **NONE** — the only domain in the account-wide `vercel domains ls` (`sikuma.co.il`) belongs to an unrelated project (`sikuma`), confirmed via `vercel project ls` |
| Git integration | **NONE** — `.vercel/project.json` has no git-repo linkage field; `vercel git` only offers `connect`/`disconnect` (no read/status subcommand exists in this CLI version to query link state without mutating it — absence of the field in `project.json` is the read-only proof used here) |
| Environment variables | 6/6 configured, all scoped **Preview only**, all marked **Sensitive** (values never retrieved — `vercel env ls` shows names/scope/type only): `ADMIN_EMAIL`, `AUTH_SECRET`, `OTP_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `DATA_SOURCE` |
| Production application env vars | NONE |
| CLI version used | `59.4.0` (via `npx vercel@59.4.0`, matching the operator-verified version — never the locally-resolved global 54.13.0) |
| Team/plan tier | **Not retrievable via this CLI's read-only commands.** `vercel teams ls` returns team identity only, no plan/billing tier. No `vercel plan`/`vercel billing` command exists in this CLI version. If plan tier matters for Phase 3 (Custom Environments availability), the operator would need to check the Vercel dashboard (Settings → Billing) directly — not inferred or guessed here. |

No mutating command was run. No environment variable value was retrieved or printed.

---

## Phase 2 — Documented behavior vs. current first-deployment evidence

| | Documented behavior | Current (July 2026) staff/community-reported behavior |
|---|---|---|
| **Standard `vercel deploy` (no flag)** | Creates a Preview deployment | Reported to sometimes deploy to Production, specifically on a **fresh, Git-disconnected project's first deployment** |
| **`vercel deploy --target=preview`** | Explicitly requests Preview | Vercel Community reports (including from Vercel staff) describe reproductions where the **first** deployment of a fresh project was still classified Production despite this explicit flag |
| **Deploying from a non-production Git branch** | Standard workflow produces Preview | Reported to not prevent first-deployment Production classification on a project with **no Git integration connected** — the reports specifically concern the *first deployment of a fresh project*, a condition distinct from normal branch-based Preview flows on an already-initialized project |
| **Dashboard-triggered Preview deploy flows** | Preview by dashboard convention | Also reported affected in the same first-deployment-only window |
| **`vercel --prod --skip-domain`** (the commonly suggested workaround) | Explicitly targets Production | Confirmed to work as documented — but it **creates a real Production-target deployment** (a "staged Production baseline"). This satisfies the symptom (subsequent deploys behave normally) but does **not** satisfy this project's release policy, which prohibits any Production-target deployment or Production artifact prior to a verified Preview |

**No source found this wave (or in prior waves) constitutes an explicit, current, Vercel-documented guarantee that a fresh project's first deployment can be forced to Preview classification without first creating some Production artifact.** This is a reported platform behavior under active community discussion, not something resolvable by CLI flag choice alone. This wave does not claim certainty beyond what is stated here — only that no supported bypass was identified.

---

## Phase 3 — Plan capability check

- Current plan/team tier: **not determined** (CLI does not expose it read-only; not guessed).
- Custom Environments: availability on this team's plan **not determined** this wave.
- Even if Custom Environments are available, **this wave does not assume they bypass first-deployment Production classification** — no explicit Vercel documentation or staff statement was found this wave claiming that guarantee for a fresh, zero-deployment project. If the operator confirms plan tier and Custom Environments are available, this remains an open question for Vercel Support to answer explicitly (see Phase 4 request), not an assumed workaround.

---

## Phase 4 — Prepared Vercel Support request

See the message below. Contains **no secrets**: no env var values, no Supabase keys, no OTP/AUTH secret values, no deployment URLs (there are none, since deployment count is 0), and no unnecessary internal code details — only the project facts needed for Vercel Support to answer the one direct question.

### Support message (ready to submit, operator's own Vercel account)

> **Subject: Guaranteed Preview-only first deployment for a fresh, Git-disconnected project**
>
> Project: `shaviut-netanya` (team `robbublils-projects`)
> Current state:
> - Deployment count: 0
> - No custom domain attached
> - No Production deployment exists
> - No Git integration connected
> - 6 Preview-scoped environment variables configured (Sensitive)
> - Vercel CLI version: 59.4.0
>
> We have a release policy that prohibits creating any Production-target deployment or Production alias before a verified Preview deployment exists. We're aware of recent community reports (including from Vercel staff, July 2026) that a fresh project's *first* deployment may be classified Production even when using `vercel deploy`, `vercel deploy --target=preview`, a non-production Git branch, or the Dashboard Preview flow. We're also aware that `vercel --prod --skip-domain` is a commonly suggested workaround, but that still creates a real Production-target deployment, which does not satisfy our policy.
>
> **Question:** What currently supported procedure guarantees that the first deployment of a fresh Vercel project is classified strictly as Preview, with no Production-target deployment or Production alias being created at any point?

---

## Phase 5 — Decision matrix

| State | Condition | Action |
|---|---|---|
| **A — Provider confirms safe Preview-first method** | Vercel Support/docs explicitly names a supported procedure guaranteeing Preview classification for a fresh project's first deployment | Use only that explicitly supported method, and only after operator approval |
| **B — Provider confirms first Production baseline is required** | Vercel Support confirms no such guarantee currently exists; a first Production deployment (or equivalent artifact) is unavoidable | Remain BLOCKED. Do not deploy. Operator must explicitly decide whether to relax the no-Production-before-Preview release policy — that decision is not made by this wave |
| **C — No provider confirmation** | No response, or an ambiguous/non-committal response | Remain BLOCKED. Do not experiment on the real project. Do not recommend a speculative deployment |

This wave does not select among these states — that depends on Vercel's actual response, which has not yet been obtained.

---

## Phase 6 — Repository

Only this document was added. No application source, Supabase state, or Vercel remote state changed. `graphify-out/` residue untouched (pre-existing, out of scope).

## Final remote safety check
`npx vercel@59.4.0 ls` → 0 deployments (reconfirmed). Production deployment: NONE. Custom domain: NONE. No deploy/prod/skip-domain/mutating command was run at any point this wave.

## Operator-authenticated verification (final)
The operator independently ran `npx vercel@59.4.0 ls` in their own authenticated session and confirmed:
```
Vercel CLI 59.4.0
Logged in as robbublil
Active team: robbublils-projects
No deployments found under robbublils-projects.
```
This is authenticated, operator-run confirmation (not just Claude's own CLI session) that the project remains at exactly 0 deployments. No remote deployment was executed by either party. First-deployment Preview-only behavior remains **unresolved** — this wave closes with `WAITING_FOR_PROVIDER`, pending the Vercel Support response to the prepared message above.

Application and Supabase readiness (Wave 0C-2B, `PASS`) are unaffected and were not reopened or re-investigated this wave.
