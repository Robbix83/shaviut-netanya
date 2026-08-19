# 00 — PRE-CHANGE BASELINE (Wave 0A-2)

**Date:** 2026-08-20 · **Mode:** surgical, test-first, LOCAL ONLY, no deploy, no valuation-math change.

## HEAD (start)
`cad9e3683b9e44dd7ec2a49e8e165ddbccb7852d` — `docs: wave 0a1 build-fix and final report`

## git status
Clean working tree at start (verified).

## Gate before changes
- `npm test` → **26 passed** (3 files).
- `npx tsc --noEmit` → clean.
- `npx next build` → exit 0.

## Source hashes (SHA-256, first 16) in scope
| File | Hash (before) |
|------|----------------|
| app/api/valuation/route.ts | `05bc57b6592ff5d6` |
| app/api/lead/route.ts | `7d4388382beb401c` |
| app/api/webhook/green/route.ts | `60b946f151fa54ab` |
| app/api/dev/save-streets/route.ts | `1092fbfdb4314fc6` |
| lib/store.ts | `d944e96beaebaf89` |
| **lib/valuation.ts** | **`eda487155c0645c6`** (must remain unchanged) |
| components/ValuationWizard.tsx | `e330c3db11db97b8` |

## Confirmed pre-existing facts
- `app/api/dev/save-streets/route.ts` already returns **403 in production** (`NODE_ENV==="production"`) — dev mutation already fail-closed; only a test was added.
- `store.ts` read `DATA_SOURCE` at **import** with `|| "local"` fallback — silent local in production.
- Green webhook auth was **fail-open** when `GREEN_WEBHOOK_TOKEN` unset (`if (expected && …)`).
- `/api/lead` trusted **client `valuation`** for `estimateLow/High` and forwarded the client object to `notifyNewLead`.

## Characterization fixtures captured (before implementation)
Real `valuate()` outputs (local data), pinned in `lib/__tests__/valuation.fixture.test.ts`:
- אגמים (66239255), 4rm/100m²: low 2,425,000 · mid 2,498,000 · high 2,516,000 · deals 7 · conf low · ppsqmMid 24,977.
- קריית השרון (66239241), 3rm/80m²: low 1,967,000 · mid 1,996,000 · high 2,055,000 · deals 6 · conf low · ppsqmMid 24,948.

These must remain identical after the trust-ownership change (proof of no math change).
