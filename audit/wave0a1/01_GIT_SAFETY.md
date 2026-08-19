# 01 — GIT SAFETY GATE (Wave 0A-1)

**Date:** 2026-08-20 · **Secrets:** none printed.

---

## GIT_SAFETY_VERDICT: **SAFE**

Git was initialized only after proving no secret, PII, dependency, build-output, or junk file can be committed.

## IGNORED_SENSITIVE_PATHS (verified via `git ls-files` after `git add -A`)
| Path / pattern | Reason | Confirmed untracked |
|----------------|--------|---------------------|
| `.env`, `.env*.local` | real secrets (Twilio, OTP, NextAuth) | ✅ `.env.local` not tracked |
| `/data/*.json` | dev data incl. **`data/leads.json` (PII)** | ✅ not tracked |
| `/node_modules`, `/.next/`, `/out/`, `/build` | deps & build output | ✅ not tracked |
| `/leadssa.json` | data.gov/ArcGIS catalog dump (root) | ✅ not tracked |
| `/cbs_search*.json`, `/census_sample.json`, `/nh_map2.json`, `/s5.json`, `/.ac.json` | data.gov API scratch dumps | ✅ not tracked |
| `C*leads.claude/`, `C*leads.claudelaunch.json`, `C*leaderr.txt` | junk from earlier mis-quoted paths — filenames use a **fullwidth colon (U+FF1A)**, matched via `C*leads*` glob | ✅ not tracked |

**Tracked (correct):** `.env.example` (empty template), `.claude/launch.json` (dev launch config, no secrets), all app/lib/scripts/audit source, `package.json`, `package-lock.json`, `tsconfig.json`. Total: **146 files**.

## PII_TRACKING_RISK: **NONE**
`data/leads.json` (lead contact PII) is ignored and confirmed untracked. No other file containing personal data is staged. The scratch dumps were inspected — all are public data.gov.il API responses, no PII.

## SECRET_TRACKING_RISK: **NONE**
`.env.local` (the only file with real credentials) is ignored and untracked. A pattern scan of the staged set for credential-shaped strings returned nothing new beyond the already-cleared cases in 18_SECRET_HYGIENE. No `NEXT_PUBLIC_*` secret. No PEM/key files.

## Notable finding — fullwidth-colon junk
The stray root artifacts are literally named `Cﾺleads.claude/`, `Cﾺleads.claudelaunch.json`, `Cﾺleaderr.txt` using U+FF1A (fullwidth colon), created when an earlier tool mis-handled the Windows path `C:\leads`. An initial ASCII-colon ignore pattern silently failed to match them and they were briefly staged; caught by `git ls-files` inspection **before any commit**, corrected with a `C*leads*` glob, index reset, and re-verified clean. They were **not deleted** (no destructive op authorized) — only excluded from version control.

## Baseline commit
- Message: `baseline: pre-wave-0a1 safe snapshot`
- Contains: current source (unmodified), hardened `.gitignore`, and the Wave 0R + Wave 0A-1 audit docs.
- No production source logic was changed before this commit.
- **Not pushed.** No remote configured.

## Post-commit proof
See `git status` / `git ls-files` output recorded in `WAVE0A1_REPORT.md` §11 confirming `.env.local`, `data/leads.json`, `leadssa.json`, `node_modules`, `.next` are all untracked.
