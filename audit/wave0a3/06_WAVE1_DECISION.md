# 06 — WAVE 1 DESIGN INPUT (evidence-based, minimal)

Decisions below use **only verified contracts** from this wave. Nothing here is implemented.

## Precondition #0 (blocks everything) — reconcile the `leads` schema
The committed `supabase/schema.sql` `leads` table is **missing 10+ columns the app writes** (`02_SUPABASE_CONTRACT`). If production matches it, **every lead insert fails**. Wave 1's first action must be: operator verifies the live `leads` columns (read-only); if missing, apply an **additive** migration adding the missing nullable columns. This is a prerequisite to any lead-reliability work — improving idempotency is meaningless if inserts fail. (No schema change was made this wave.)

## Per-item evaluation
| Item | Verdict | Rationale (evidence) |
|------|---------|----------------------|
| **A. Lead idempotency** | **Wave 1 — YES, small** | Network retry / double-submit can double-insert (LocalStore has no lock; Supabase insert is atomic but not idempotent). Proof-cookie clear-on-success mitigates same-session double-click but not retries. |
| **B. OTP durable single-use / replay** | **Defer (LOW)** | Residual replay window is phone-bound, TTL-limited, cleared on success, rate-limited (`20_LEAD_TRUST_BOUNDARY`). A Supabase-backed `jti` used-token table (no Redis) is the option **if** abuse is observed. Not urgent. |
| **C. Notification retry / outbox** | **Defer** | Adds real complexity. Do **D** first. |
| **D. Notification delivery status + logging** | **Wave 1 — YES, cheap** | All 3 channels fail silently (`05_NOTIFICATION_CONTRACT`). Add per-channel error logging + a stored delivery flag so the operator sees failures. High value, low risk, no infra. |
| **E. Serverless-safe rate limiting** | **Defer** | In-memory per-instance resets; low impact at current scale. Revisit if abuse. |
| **F. getIP / x-forwarded-for trust** | **Note only** | Vercel edge sets the header correctly; risk depends on topology. Document; no change needed unless deployment differs. |
| **G. Lead duplicate semantics** | **Wave 1 — define carefully** | See below. |

## Lead duplicate semantics — DO NOT use `phone UNIQUE`
One person legitimately evaluates **multiple properties** and **the same property over time**. A `phone UNIQUE` constraint would reject legitimate repeat leads and is **explicitly rejected**.

**Candidate idempotency (for discussion in Wave 1, not decided here):**
- **Idempotency key:** treat a submission as a duplicate only when it repeats **the same verified phone + the same normalized property input** (`neighborhoodId + propertyType + rooms + areaSqm + plotSqm + floor`) **within a short window** (e.g. 2–5 minutes). Same person, different property → new lead. Same person, same property, weeks later → new lead (legitimate re-check).
- Implementation options (no new infra): a client-generated idempotency token echoed by the server, or a server-side lookup of recent leads by (phone, inputs, window). Prefer the smallest that removes accidental double-submits without blocking legitimate repeats.

## Recommended minimal Wave 1 scope
1. **[precondition]** Reconcile production `leads` schema (operator-verified, additive migration if needed).
2. **Lead idempotency** for accidental double-submit (short-window, input-scoped — NOT phone-unique).
3. **Notification delivery visibility** (logging + stored delivery flag; no outbox yet).
4. **(carry) PII log masking** for `[OTP] phone=…` and opt-out webhook — small privacy hardening surfaced this wave.

Explicitly **out of Wave 1** unless evidence appears: Redis, queues, Sentry, serverless rate-limit infra, notification outbox, phone-unique constraint, valuation-math changes.
