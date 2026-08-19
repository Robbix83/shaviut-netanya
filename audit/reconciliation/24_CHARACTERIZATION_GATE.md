# 24 — CHARACTERIZATION TEST GATE

**Phase:** WAVE 0R
**Purpose:** Define the MINIMUM automated test set that must exist and pass BEFORE any remediation begins, so that behavior-changing fixes can be made safely. This is a **specification**, not an implementation. No production code changed. (Audit-only proof tests, if any, live under `audit/reconciliation/`.)

**Framework note:** `package.json` has **no test runner and no `test` script** [VERIFIED]. The gate below is small and high-value by design — it is a safety net for Wave 0A/1, not a coverage drive. Recommended runner: Vitest (fast, ESM/TS-native, minimal config) — decision deferred to roadmap, not made here.

---

## GATE PRINCIPLE

A characterization test pins **current** behavior (even buggy behavior) so a later fix's diff is visible and intentional. Where current behavior is a **known defect** (e.g. `/api/lead` accepts no OTP proof), the test documents the defect explicitly and is marked `EXPECTED-TO-CHANGE`, so the remediation flips it to the correct assertion.

---

## MINIMUM GATE (priority order)

### A. Build & config gates
| # | Test | Current expectation | Note |
|---|------|---------------------|------|
| 1 | Production build gate: `next build` exits 0 | **CURRENTLY FAILS** (`middleware.ts` type error) | Must go green before any behavioral remediation ships. See 17_AUDIT_RECONCILIATION issue F for the version-specific fix pattern. |
| 14 | `DATA_SOURCE` production fail-closed: with `NODE_ENV=production` and `DATA_SOURCE` unset, app must not silently serve local JSON | **CURRENTLY defaults to `local`** (`store.ts:12`) — `EXPECTED-TO-CHANGE` | Characterize current default, then remediation makes prod fail-closed. |

### B. Admin auth gates (source: `auth.ts`, `middleware.ts`, `app/api/admin/leads/route.ts`)
| # | Test | Current expectation |
|---|------|---------------------|
| 2 | Unauthenticated request to `/api/admin/leads` → 401 | PASSES today (`route.ts:9`) — pin it |
| 3 | Authenticated Google user whose email ≠ `ADMIN_EMAIL` → rejected | Holds **only if `ADMIN_EMAIL` set**; with it unset, **any** Google user is accepted — `EXPECTED-TO-CHANGE` (fail-closed when unset) |
| 4 | Authorized admin (email = `ADMIN_EMAIL`) → accepted | Pin |

### C. OTP + lead trust-boundary gates (source: `lib/otp.ts`, `otp/verify`, `lib/store`, `api/lead`) — HIGHEST VALUE
| # | Test | Current expectation |
|---|------|---------------------|
| 5 | OTP wrong code → `{valid:false}` 422 | PASSES (`verify/route.ts:16-24`) — pin |
| 6 | OTP expired token → rejected | PASSES (`otp.ts:51`) — pin |
| 7 | OTP replay: same token+code verifies more than once within TTL | **CURRENTLY SUCCEEDS repeatedly** — pin as `EXPECTED-TO-CHANGE` (should be single-use) |
| 8 | Lead submission requires server-verifiable OTP proof | **CURRENTLY NOT REQUIRED** (`api/lead` has no token) — pin as `EXPECTED-TO-CHANGE`; this test is the guardrail for the Wave 0A/1 fix |
| 9 | Lead request phone must match the verified OTP phone | **CURRENTLY UNENFORCED** — `EXPECTED-TO-CHANGE` |
| — | (bonus) OTP code must NOT be recoverable from any client-visible token | **CURRENTLY RECOVERABLE** (`base64url` plaintext) — `EXPECTED-TO-CHANGE` |

### D. Phone / opt-out gates (source: `lib/store.ts normalizePhone`, `api/webhook/green`)
| # | Test | Current expectation |
|---|------|---------------------|
| 10 | `normalizePhone` variants: `+97250…`, `97250…`, `050-…`, `050 …` all normalize to one canonical form | PASSES (`store.ts:41-46`) — pin (guards opt-out matching) |
| 12 | Opt-out webhook rejects wrong/missing `token` when `GREEN_WEBHOOK_TOKEN` is set | Holds only if token set (`green/route.ts:36-39`) — pin; `EXPECTED-TO-CHANGE` to fail-closed |
| 13 | Opt-out phone normalization: `STOP` from `9725…@c.us` matches a lead stored as `050…` | Pin (`green/route.ts:26-32` + `optOutByPhone`) |
| 11 | Lead duplicate/retry/idempotency: two identical rapid submissions | **No idempotency today** (`LocalStore.insertLead` has no uniqueness/lock) — pin current behavior; do NOT add a UNIQUE constraint without business analysis (blocked) |

### E. Valuation characterization gates (source: `lib/valuation.ts`) — pin numbers, do not change logic
| # | Test | Current expectation |
|---|------|---------------------|
| 15 | `percentile()` deterministic fixtures (known array → known P20/P25/P33/P67/P75/P80) | Pin exact outputs |
| 16 | Fixed-address valuation fixtures: 3–5 canned `PropertyInput`s → snapshot the returned `Valuation` (low/mid/high/scope/confidence/basedOnDeals) | Pin as golden snapshots against current data |
| 17 | Exact-building text match selects building-scope path | Pin |
| 18 | Near-building selection behavior | Pin |
| 19 | Street fallback path | Pin |
| 20 | Radius fallback path | Pin |
| 21 | Neighborhood fallback path | Pin |
| 22 | Non-numeric house number does not crash and takes a defined path | Pin (see 22_VALUATION_CALIBRATION for the suspected bug) |
| 23 | Floor filtering (±2) behavior | Pin |
| 24 | Sparse deal pool (< MIN_DEALS_FOR_ESTIMATE) → returns null / low-confidence as coded | Pin |
| 25 | House/land path (composite model) behavior | Pin |

> Snapshot tests (16, 17-25) must be generated from the **current** engine and data so they are a true characterization baseline. If centroid-collapse means several "scope" fixtures resolve identically, the test should assert that reality (and reference 17_AUDIT_RECONCILIATION issue D), not a fictional geo split.

---

## WHAT THIS GATE DELIBERATELY EXCLUDES
- No exhaustive unit coverage of every helper.
- No E2E browser suite (deferred).
- No load/perf tests.
- No test that asserts a *desired future* behavior as if it were current — future-facing assertions are explicitly tagged `EXPECTED-TO-CHANGE` so they fail loudly the day the fix lands (turning them into the fix's acceptance test).

**Smallest high-value gate = tests #1–#16 as the blocking set for Wave 0A; #17–#25 as the valuation safety net before any Wave 3/4 valuation work.**
