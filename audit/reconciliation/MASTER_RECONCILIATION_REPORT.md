# MASTER RECONCILIATION REPORT — shaviut-netanya
**Phase:** WAVE 0R — Audit Reconciliation, Security Baseline & Trust Verification
**Date:** 2026-08-19
**Mode:** Forensic / evidence-first / non-destructive. No production code, data, schema, Git, or deployment was changed.

---

## OVERALL RECONCILED VERDICT

The previous audit package (`audit/MASTER_AUDIT_REPORT.md`) contains **valuable evidence but a systemic reliability defect: it repeatedly stamped local-only, conditional, or inferred findings as "VERIFIED," and its headline valuation accuracy rested on a look-ahead-leaking backtest.** After reconciliation against source, data, safe local execution, a leak-free re-backtest, and an independent adversarial review:

- **The project's real risks are concentrated in the OTP→lead trust boundary and the broken build — not where the old report's severity ranking pointed.**
- **The valuation engine is more honestly characterized as ~10% median error / ~40% interval coverage with a systematic under-prediction bias** — not the previously implied ~53–83% "accuracy," which was inflated by leakage.
- **The single largest data problem (coordinate centroid-collapse) is real and confirmed**, but the previous "delete 2,155 duplicates" remedy is **unsafe and blocked**.
- **No secrets are exposed** in committable or client-visible locations; the "secrets leaked into audit files" alarm was false.

The application remains usable; nothing was broken by this phase. The corrected roadmap (`25_CORRECTED_ROADMAP.md`) reorders remediation around the actual evidence.

---

## PER-DIMENSION RECONCILIATION

### SECURITY
- **CONFIRMED RISKS:** Build blocker (`middleware.ts` cast, `tsc` reproduced by independent review). `/api/lead` requires no OTP proof (**P1**, provider-independent) and can be driven to send branded WhatsApp reports to arbitrary numbers (**P1**, operator cost/ban risk).
- **CONDITIONAL RISKS:** Admin fail-open **iff** `ADMIN_EMAIL` unset in prod (code-confirmed, prod env UNKNOWN). `NEXT_PUBLIC_DEV_BYPASS_OTP` client-baked bypass iff set in prod build. Unauthenticated opt-out iff `GREEN_WEBHOOK_TOKEN` unset (nuisance-level).
- **DISPROVED / OVERSTATED:** "Live Twilio secrets copied into audit files" — **CONTRADICTED** (only key names; `.env.local` gitignored). "OTP code embedded in plaintext in token" — **OVERSTATED**: true only on SMS-fallback path; the configured Twilio Verify path signs a `"VERIFY"` sentinel and validates server-to-server. "Any Google account can access admin (VERIFIED)" — **reclassified CONDITIONAL**.
- **UNKNOWN:** All production env values (Vercel not accessible).

### TRUST BOUNDARY
- **CONFIRMED:** OTP is decorative server-side — no server-side verified state exists (stateless by design), and `/api/lead` never checks any proof. Client alone gates verification. Client-supplied `valuation` is persisted and forwarded to admin/WhatsApp/Sheets without server recompute (**P2**).
- **CONDITIONAL:** Plaintext-code-in-token and `/api/otp/verify` brute-force apply only on SMS-fallback providers.
- **UNKNOWN:** Whether prod uses Twilio Verify or an SMS fallback (local config suggests Twilio Verify).

### VALUATION
- **CONFIRMED:** Leak-free backtest V2 (all 11,759 apartments; V1-comparable cohort N=3,650): **median APE 10.4%, mean MAPE 16.5%, ±10% 48.3%, ±20% 73.6%, interval coverage 39.6%, directional bias −₪146k median / 68% under-predicted.** Percentile band-width **inversion** confirmed (building 60pt … neighborhood 34pt — narrowest band on least-precise evidence). `yearBuilt===0` sentinel (27.4%) pollutes age filtering. House composite model inert (plotSqm 0% coverage for houses). `sizeDistance` 0.45 coefficient is dead code (never called); live weight is 0.4.
- **CONDITIONAL / UNKNOWN:** Real post-geocoding accuracy is UNKNOWN and must be measured, not predicted.
- **DISPROVED / OVERSTATED:** V1's 53.3% interval / 61.5% ±10 / 83.3% ±20 were **inflated by look-ahead leakage** (future comps not excluded; cutoff anchored to audit date). Independent ablation confirmed removing the future-bound lifts metrics back toward V1 levels. "Geographic valuation non-functional" — **nuanced**: text street+house matching WORKS; geo 60m/350m BROKEN (centroids); radius PARTIAL; neighborhood WORKS. "Fixing coordinates → 75–80% coverage" — **unsupported, removed.**

### DATA QUALITY
- **CONFIRMED:** Coordinate centroid-collapse (21 pairs for 21 neighborhoods) — geo tiers inert. Duplicate candidates exist (~3,011 pairs).
- **DISPROVED / OVERSTATED:** "Delete ~2,155 duplicates (VERIFIED)" — **BLOCKED**: 0 provably identical (no gush/helka/subparcel or source id in the schema; `id` is a derived composite). Split ≈1,450–1,490 cross-neighborhood harvest artifacts (fix at harvest) + ≈1,200–1,300 genuinely distinct units (never delete) + ~370 ambiguous. Count itself was inconsistent across the old report (2,155 vs 3,011).
- **OPEN:** Exact duplicate sub-counts differ by method (1,437 vs 1,491) — must be unified to one script before any Wave 2 action.

### HARVEST
- **CONFIRMED:** Observed 500-deal ceiling in ~14 neighborhoods.
- **OVERSTATED:** "Harvest script caps at 500" / "nadlan backend caps (VERIFIED)" — the **script imposes no cap** (scroll-based, `MAX_SCROLL_ROUNDS=200`; the lone `500` is a Supabase upsert batch size). Server-side cause is **LIKELY, not VERIFIED**.

### LEAD RELIABILITY
- **CONFIRMED:** Insert-before-notify ordering is correct (lead never lost to a notification failure). Store is the sole reliable source of truth.
- **CONFIRMED (elevated):** All three notification channels fail **silently** (`catch→false`; route `.catch` never fires). Attribution is a single free-text `source` field — all `utm_*`/`gclid`/`fbclid`/`referrer` discarded server-side.
- **UNKNOWN:** Prod delivery success rates.

### PRODUCTION READINESS
- **CONFIRMED BLOCKERS:** Build failure; no version control.
- **CONFIRMED HIGH (conditional on prod env):** admin fail-open; `DATA_SOURCE` must be `supabase` (serverless FS is ephemeral); OTP→lead boundary (environment-independent).
- **DISPROVED / OVERSTATED:** "Production running a stale unrebuildable bundle" — **UNKNOWN**. "No Dockerfile / no `output: standalone`" — **not blockers** on Vercel.

### TEST MATURITY
- **CONFIRMED:** No test runner, no `test` script, zero automated tests. This is the true floor; the minimum characterization gate (24) is defined and gated ahead of remediation.

---

## TOP 10 RECONCILED RISKS (by severity)

| # | Risk | Severity | Status |
|---|------|----------|--------|
| 1 | Production build broken (`middleware.ts`) — nothing can deploy | **BLOCKER** | VERIFIED (tsc reproduced) |
| 2 | `/api/lead` requires no OTP proof → forged leads | **P1** | VERIFIED, provider-independent |
| 3 | Same gap → server sends branded WhatsApp reports to arbitrary numbers (cost/ban) | **P1** | VERIFIED (review-elevated) |
| 4 | No version control → no rollback/reproducibility | **HIGH** | VERIFIED |
| 5 | Admin fail-open if `ADMIN_EMAIL` unset in prod | **HIGH** | CONDITIONAL (prod UNKNOWN) |
| 6 | `DATA_SOURCE` must be `supabase` in prod or leads vanish on serverless | **HIGH** | CONDITIONAL (prod UNKNOWN) |
| 7 | Client-supplied valuation persisted/forwarded unverified | **P2** | VERIFIED |
| 8 | Valuation under-predicts (−₪146k median, 68%) + band-width inversion | **P2** | VERIFIED (leak-free backtest) |
| 9 | Notifications fail silently; attribution lossy (source-only) | **P2/P3** | VERIFIED |
| 10 | OTP verify not rate-limited + code-in-token (SMS-fallback path only) | **P2** | VERIFIED, CONDITIONAL on provider |

---

## PREVIOUS-AUDIT FINDINGS THAT WERE OVERSTATED OR INCORRECT

1. **Secrets leaked into `01_SYSTEM_MAP.md`** — false (only key names).
2. **Backtest 53%/61%/83% as historical accuracy** — invalid (look-ahead leakage).
3. **"Fix coordinates → 75–80% coverage"** — unsupported projection.
4. **"Delete ~2,155 duplicates"** — unsafe; 0 provably identical; also count-inconsistent (2,155 vs 3,011).
5. **"Any Google account accesses admin (VERIFIED)"** — conditional on unknown prod `ADMIN_EMAIL`.
6. **"Geographic valuation non-functional"** — text matching actually works; only geo-radius tiers are inert.
7. **`auth as any` middleware fix** — wrong; installed types require the `export default auth((req)=>…)` wrapper.
8. **"Harvest caps at 500 (VERIFIED)"** — script imposes no cap; server-side cause only LIKELY.
9. **"Next.js 14"** (some docs) — actually 16.2.6.
10. **Multiple production states asserted VERIFIED** from local files — reclassified CONDITIONAL/UNKNOWN.

**The reconciliation's single strongest contribution:** disciplined LOCAL vs PRODUCTION separation — no production fact is tagged VERIFIED without production evidence. (Independent review upheld this as the package's most robust property.)

---

## MISSED BY PRIOR AUDIT, SURFACED HERE
- OTP→lead trust boundary (P1) — entirely absent before.
- Outbound-WhatsApp-to-arbitrary-numbers abuse (P1).
- `sizeDistance` dead code; house composite inertness (plotSqm 0%).
- Silent-at-both-levels notification failure (route `.catch` never fires).

---

## UNKNOWN (requires access this session did not have)
Production Vercel env vars; live deployment/build id; prod `DATA_SOURCE` and Supabase state; prod OTP provider (Twilio Verify vs SMS fallback); real notification delivery rates; post-geocoding valuation accuracy; unified exact duplicate sub-counts.

---

## AUDIT PACKAGE (this phase)
`00_ECC_EXECUTION_LOG.md` · `17_AUDIT_RECONCILIATION.md` · `18_SECRET_HYGIENE.md` · `19_PRODUCTION_FACTS.md` · `20_LEAD_TRUST_BOUNDARY.md` · `21_BACKTEST_V2.md` (+ `backtest_v2.mjs`, `backtest_v2_results.json`) · `22_VALUATION_CALIBRATION_GAPS.md` · `23_DUPLICATE_IDENTITY.md` (+ `analyze_dupes.js`) · `24_CHARACTERIZATION_GATE.md` · `25_CORRECTED_ROADMAP.md` · `26_LEAD_ATTRIBUTION_FACTS.md` · `27_PRODUCTION_READINESS_RECONCILED.md` · `28_INDEPENDENT_REVIEW.md` · `MASTER_RECONCILIATION_REPORT.md`

**STOP CONDITION MET.** No remediation implemented. No production code/data/schema/Git/deploy changes. Next action is the operator's decision on Wave 0A.
