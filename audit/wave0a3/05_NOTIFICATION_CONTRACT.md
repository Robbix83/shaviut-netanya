# 05 — NOTIFICATION CONTRACT (Wave 0A-3)

**Method:** code analysis of `lib/notify.ts` + `app/api/lead/route.ts`; behavior confirmed in local E2E (providers neutralized).

## Per-function contract
| Function | Input | Return | Timeout | Error behavior | Retry | Caller awaits? | Failure stored? | Operator visibility |
|----------|-------|--------|---------|----------------|-------|----------------|-----------------|---------------------|
| `notifyNewLead(lead, v)` | Lead + server Valuation\|null | `Promise<void>` | none | `Promise.allSettled` — swallows all | none | **NO** — `notifyNewLead(...).catch(...)` fire-and-forget after response | NO | none |
| `notifyWhatsApp(text)` (agent) | string | `Promise<boolean>` | **none** (bare `fetch`) | `try/catch → false`; no logging | none | via allSettled | NO | **none** (silent) |
| `sendReportToLead(lead, v)` (user) | Lead + Valuation\|null | `Promise<boolean>` | **none** | `catch → false`; returns false if no Green id | none | via allSettled | NO | **none** |
| `appendToSheet(lead, v)` | Lead + Valuation\|null | `Promise<boolean>` | **none** | `catch → false` | none | via allSettled | NO | **none** |

## Verdict
- **Insert-before-notify ordering is correct** — the lead is persisted and the HTTP response returned before notifications run; a notification failure cannot lose the lead. The store is the sole source of truth.
- **All three channels fail silently** — no timeout, no retry, no delivery-state persistence, no operator alert. Because the utils resolve `false` (never throw), even the route's `.catch(console.error)` effectively never fires. This is a real reliability gap (confirmed from Wave 0R `26_LEAD_ATTRIBUTION_FACTS`), unchanged this wave and a Wave 1 candidate (retry/outbox + delivery status).
- **No external timeout** on any provider `fetch` → a hung upstream can occupy the serverless invocation until the platform limit; low user-facing impact since notifications run post-response.

## Option B / null-valuation handling (verified + fixed this wave)
| Output | Behavior with null valuation | Status |
|--------|------------------------------|--------|
| DB / store | `estimateLow/High = null` (nullable columns) | honest |
| `buildLeadMessage` (agent WA) | **now shows** `⚠️ שווי לא חושב אוטומטית — נדרשת בדיקה ידנית` (was: silent omission) | **fixed** |
| `buildReportMessage` (user WA) | **now** `קיבלנו את בקשתך…` + `מכינים עבורך…` and **no price** (was: `הנה דוח השווי שביקשת` with empty numbers — misleading) | **fixed** |
| `appendToSheet` | `estimateLow/High = ""` (empty) | honest (unchanged) |
| `fmtNis(null)` | `"—"` (em-dash) | honest — no `NaN`/`₪0`/`undefined` |

Fix committed as `bbcfada` with `lib/__tests__/notify.test.ts` (4 cases). No fabricated price is ever produced.
