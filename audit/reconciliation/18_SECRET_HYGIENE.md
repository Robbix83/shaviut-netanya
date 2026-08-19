# 18 — SECRET HYGIENE GATE

**Phase:** WAVE 0R
**Rule:** Presence only. **No secret values are printed anywhere in this report.** No Git initialized. No credentials rotated.

---

## METHOD

Repository-wide regex scan (values never emitted) across 119 files under `C:\leads`, excluding `node_modules`, `.next`, `graphify-out`. Patterns: Twilio SID (`AC`+32 hex), 32-char hex tokens, Supabase JWT (`eyJ…`), Google Apps Script `/macros/s/…` URLs, E.164 IL phone numbers, Green API instance ids, Bearer tokens, PEM private keys. Cross-checked `.gitignore`.

---

## SECRET INVENTORY (by TYPE and LOCATION only)

| SECRET_TYPE | FILES_FOUND_IN | LIKELY_REAL | CLIENT_EXPOSED | AUDIT_FILE_EXPOSED | GITIGNORED | ROTATION_REQUIRED | SAFE_FOR_GIT |
|-------------|----------------|-------------|----------------|--------------------|-----------|-------------------|--------------|
| Twilio Account SID | `.env.local` | LIKELY | No | **No** | **YES** (`.env*.local`) | No (not exposed) | N/A — gitignored |
| Twilio Auth Token | `.env.local` | LIKELY | No | **No** | **YES** | Only if `.env.local` ever leaves the machine | N/A — gitignored |
| Twilio From / Verify SID | `.env.local` | LIKELY | No | No | YES | No | N/A |
| NextAuth secret | `.env.local` (key present) | LIKELY | No | No | YES | No | N/A |
| OTP secret | `.env.local` (key present) | LIKELY | No | No | YES | No | N/A |
| Supabase URL / service-role key | **not found in repo** (keys only in `.env.example`, empty) | — | — | No | YES | No | N/A |
| Green API id/token | **not found in repo** (empty in `.env.example`) | — | — | No | YES | No | N/A |
| Google Apps Script webhook | **not found in repo** | — | — | No | YES | No | N/A |
| Inforu credentials | **not found in repo** | — | — | No | YES | No | N/A |
| Private keys (PEM) | **none** | — | — | No | — | No | — |

### Two scanner hits that are NOT secret leaks (cleared)

1. **`audit/15_TEST_GAPS.md`** matched an E.164 phone pattern. **Cleared:** it is an illustrative example phone inside prose (`+9725XXXXXXXX` style), not a real number, and it does **not** match any real lead in `data/leads.json` (checked via normalized comparison). No PII leak. Recommend masking it anyway for tidiness.
2. **`leadssa.json`** matched 32-hex-char patterns. **Cleared:** these are **data.gov.il/ArcGIS resource identifiers** (`id`, `itemId`, `serviceItemId`, `self`, `esriRest` fields) from a public dataset catalog response — not credentials. File is a harvested public-API artifact, not secret-bearing.

---

## AUDIT-FILE SECRET EXPOSURE — RECONCILES ISSUE (A)

**Prior contradiction:** `10_SECURITY.md` reportedly claimed live Twilio credentials were copied into `audit/01_SYSTEM_MAP.md`; `MASTER_AUDIT_REPORT.md` claimed no secrets were exposed in audit files.

**Verified finding:** `audit/01_SYSTEM_MAP.md` contains **only Twilio KEY NAMES and flow descriptions** (e.g. "TWILIO_VERIFY_SID set", "Twilio Verify API") — **no credential VALUES**. A targeted scan for `AC`+32-hex, 32-char hex tokens, and E.164 numbers in that file returned **zero value matches**.
**Classification: the "secrets copied into audit file" claim is CONTRADICTED.** MASTER's statement ("no evidence of secrets exposed in the audit files") is **CONFIRMED**. No audit file requires redaction for secret values.

---

## GIT SAFETY VERDICT

**GIT_SAFETY_VERDICT = SAFE-TO-INIT-WITH-EXISTING-IGNORE, WITH ONE PRECONDITION.**

- `.gitignore` correctly excludes `.env`, `.env*.local`, and `/data/*.json` (keeps real credentials and the PII-bearing `leads.json` out of version control). **[VERIFIED]**
- The only real credentials on disk live in `.env.local`, which is gitignored. **[VERIFIED]**
- No audit file contains real secret values. **[VERIFIED]**
- **Precondition before any future `git add`:** confirm `leadssa.json` (52 KB, repo root, **not** under `/data/`, so **NOT covered by the `/data/*.json` ignore**) contains no PII before committing. It appears to be a public data.gov catalog dump (no secrets found), but it is currently **not gitignored** and would be committed. Recommend adding it to `.gitignore` or moving it under `/data/`.

> **No Git was initialized in this phase (prohibited).** This verdict informs the later Git-safety step only.

---

## REDACTION PLAN

| Item | Action | Priority |
|------|--------|----------|
| `audit/15_TEST_GAPS.md` example phone | Mask to `+9725XXXXXXXX` (cosmetic; not a real number) | LOW |
| `leadssa.json` at repo root | Add to `.gitignore` OR move under `/data/`; verify no PII before it can be committed | MEDIUM (before any Git init) |
| `.env.local` | Leave as-is; already gitignored; **do not commit** | — |

**MANUAL_ROTATION_REQUIRED = NO** — no real credential is exposed in a committable/client-visible location. (Rotation would only become necessary if `.env.local` was ever shared, pushed, or pasted somewhere trackable — no evidence of that here.)

**No credentials were rotated automatically (prohibited).**
