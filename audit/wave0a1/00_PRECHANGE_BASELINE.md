# 00 — PRE-CHANGE BASELINE (Wave 0A-1)

**Date:** 2026-08-20
**Mode:** Surgical implementation, test-first, LOCAL ONLY, no deploy.
**Secrets:** none printed.

---

## Environment
- Next.js **16.2.6** (Turbopack), next-auth **5.0.0-beta.31**, React **19.0.0**, TypeScript 5.9.3, Node 24.x.
- Package manager: npm; `package-lock.json` present (114,031 bytes).
- `C:\leads\.git`: **absent** (no VCS yet).

## Current build failure (reproduced VERIFIED)
`npx tsc --noEmit` and `npx next build` both fail:
```
middleware.ts(11,11): error TS2352: Conversion of type '(...next-auth auth overloads...)'
to type '(req: NextRequest) => Promise<NextResponse<unknown>>' may be a mistake ...
Target signature provides too few arguments. Expected 2 or more, but got 1.
```
Root cause: `middleware.ts:11` casts `auth` to a single-arg middleware signature — incompatible with the installed next-auth beta.31 `auth` overload set. Build compiles JS successfully, then fails at the TypeScript type-check step.
(Non-fatal warning also emitted: "the `middleware` file convention is deprecated, use `proxy`" — left unchanged this wave.)

## Source hashes (SHA-256) of files in scope
| File | SHA-256 |
|------|---------|
| middleware.ts | `236482f4…29eab7` |
| auth.ts | `1751a2d9…dddeaa` |
| lib/otp.ts | `e4ccf22e…190a09` |
| app/api/lead/route.ts | `d6547664…6748f3` |
| app/api/otp/verify/route.ts | `ead5c102…324e76` |
| app/api/otp/send/route.ts | `637510f4…199bbd` |
| lib/store.ts | `d944e96b…f86c5` (read-only ref; `normalizePhone` reused, file not modified) |
| package.json | `d1fd1926…c165e59` |
| .gitignore | `0bfc4899…6aa18e` (pre-edit) |

## `.gitignore` before this wave
Ignored: `/node_modules`, `/.next/`, `/out/`, `/build`, `.env`, `.env*.local`, `/data/*.json`, `*.tsbuildinfo`, `next-env.d.ts`, `*.pem`.
**Gap:** several non-source files sit at repo root and were NOT ignored (fixed in 01_GIT_SAFETY).

## Sensitive / non-source files that must never be tracked
| File | Bytes | Nature | Action |
|------|-------|--------|--------|
| `.env.local` | 1354 | **real secrets** | already ignored (`.env*.local`) |
| `.env.example` | 2064 | template (empty values) | tracked OK |
| `data/leads.json` | 20,086 | **PII (lead contacts)** | already ignored (`/data/*.json`) |
| `data/*.json` (deals, neighborhoods, etc.) | — | dev data | already ignored |
| `leadssa.json` | 52,896 | data.gov/ArcGIS catalog dump (no secrets) | **now ignored** (root gap) |
| `cbs_search3/4.json`, `census_sample.json`, `nh_map2.json`, `s5.json` | small–51KB | data.gov API scratch dumps | **now ignored** |
| `.ac.json` | 23 | autocomplete scratch (`{"suggestions":[]}`) | **now ignored** |
| `C:leads.claude/` (dir), `C:leads.claudelaunch.json`, `C:leadserr.txt` | — | **junk** from earlier mis-quoted Windows paths (curl stderr, stray dir) | **now ignored** (not deleted — no destructive op authorized) |

Verified: none of the scratch dumps contain credentials or PII (all are public data.gov.il API responses).

## Rollback anchor
This document + the SHA-256 table are the pre-change anchor. Once Git is initialized (01_GIT_SAFETY), the baseline commit is the authoritative rollback point.
