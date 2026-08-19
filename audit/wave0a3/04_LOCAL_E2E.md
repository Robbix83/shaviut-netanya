# 04 — LIVE LOCAL E2E (Wave 0A-3)

**Setup:** `next dev` on `127.0.0.1:3030`, `DATA_SOURCE=local`, **all outbound providers neutralized** (TWILIO_*/GREEN_*/INFORU_*/GOOGLE_SHEETS_WEBHOOK/LEAD_NOTIFY_WHATSAPP set empty). Verified no outbound: `/api/otp/send` → `sent:false`, `devOtp` echoed (dev only). `data/leads.json` backed up and **restored byte-identical** afterwards (39→39). Real HTTP + real route handlers exercised.

## Result matrix
| # | Check | Method | Result |
|---|-------|--------|--------|
| 1 | Landing page loads | browser DOM read | ✅ heading, stats (12,000+/40+), wizard rendered; **no console errors** |
| 2 | Address autocomplete | (not driven — govmap external) | ⚠️ NOT exercised (used deterministic manual-neighborhood path instead to avoid external geocode); autocomplete route exists |
| 3 | Property input → valuation | browser: neighborhood אגמים → 4 rooms → 100 m² → compute | ✅ progressed |
| 4 | Valuation renders | browser DOM | ✅ **₪2,425,000 – ₪2,516,000**, ₪24,977/m², comparable deals shown |
| 5 | Displayed == server valuation | compare UI vs `/api/valuation` | ✅ **exact match** to server (and to fixture) |
| 6 | Lead form shown | browser DOM | ✅ name, phone, 3 consent checkboxes; **dead OTP-bypass button confirmed ABSENT** |
| 7 | OTP send | browser click → `/api/otp/send` | ✅ 200; wizard advanced to 6-digit code entry |
| 8 | Incorrect OTP rejected | API: verify wrong code | ✅ **422**, no proof cookie set |
| 9 | Correct OTP accepted | API: verify devOtp | ✅ **200** + `lead_proof` Set-Cookie |
| 10 | Lead accepted only after OTP | API: lead with proof cookie | ✅ **200**, saved |
| 11 | Lead without OTP rejected | API: lead, no cookie | ✅ **401** `otp_verification_required` |
| 12 | Server recomputation occurs | inspect saved lead | ✅ estimates from server recompute |
| 13 | Step 4 / report unlocks | browser | ✅ report/lead step rendered after valuation; OTP entry reached (final submit proven at API level) |
| 14 | Saved lead uses SERVER estimate | inspect `data/leads.json` | ✅ **2,425,000–2,516,000** (server), NOT client `1/999,999,999`; neighborhood **"אגמים"**, NOT client `"CLIENT-FAKE"` |
| 15 | No real WhatsApp/SMS/Sheets left env | provider neutralization + logs | ✅ `sent:false`; no outbound; server log shows `provider=sms sent=false` |

## Viewports
- **Desktop (1280×720):** funnel rendered and drove correctly; all `/api/*` calls 200; no duplicate requests.
- **Mobile (375×812):** landing reloaded; **no horizontal overflow** (scrollWidth 375 == viewport); primary CTA visible; wizard present; **no console errors**.

## Console / network health
- Console errors: **none** (desktop and mobile) — no React/hydration errors.
- Network: `/api/neighborhoods`, `/api/valuation`, `/api/teaser`, `/api/otp/send` all **200**; no 500s; no unexpected duplicates.

## Honest scope notes
- The **UI** OTP verify→final-submit last click was not fully clicked through in-browser (the dev OTP code is only in the send response body); that exact transition (verify correct → lead saved with server valuation) was proven at the **API** boundary with real HTTP and the saved lead inspected. The browser confirmed every stage up to and including OTP code-entry.
- **Autocomplete** (govmap) was deliberately not exercised to avoid external calls; the manual-neighborhood path gives deterministic, offline coverage of the valuation flow.
- **PII finding (reported, not fixed — out of scope):** `app/api/otp/send/route.ts:56` logs the full phone number (`[OTP] phone=05… provider=… sent=…`). The OTP **code is not** logged. Same phone-in-log pattern in the Green opt-out webhook. Recommend masking in a later wave.

## Verbatim evidence log (captured live during the E2E run)
Because the E2E is **non-destructive** — the single API-test lead was removed when `data/leads.json` was restored — the persisted lead is intentionally **not** left in the repo. The live results captured during the run are recorded here so the claim is checkable:

```
# Provider neutralization (no outbound):
/api/otp/send -> sent: false | devOtp present: true | token present: true

# Security flow (real HTTP against 127.0.0.1:3030):
2. verify WRONG code -> HTTP 422
3. verify CORRECT code -> HTTP 200 ; Set-Cookie: lead_proof present
4. lead WITHOUT proof cookie -> HTTP 401
5. lead WITH proof + tampered client valuation -> HTTP 200 {"ok":true,"id":"lead_1787179904489"}

# Persisted lead inspected in data/leads.json BEFORE restore:
saved lead estimate: 2425000 - 2516000
  client sent 1 / 999999999 -> ignored? true
saved neighborhood: "אגמים" (client sent CLIENT-FAKE -> ignored? true)
  matches server fixture (2425000-2516000)? true

# /api/valuation determinism (same input x3, no houseNumber => no govmap):
run 1: 2425000 2498000 2516000 | scope: neighborhood | deals: 7 | conf: low | nbhd: אגמים
run 2: 2425000 2498000 2516000 | scope: neighborhood | deals: 7 | conf: low | nbhd: אגמים
run 3: 2425000 2498000 2516000 | scope: neighborhood | deals: 7 | conf: low | nbhd: אגמים

# Restore proof: data/leads.json restored byte-identical to pre-E2E backup (39 -> 39 leads).
```
The `2425000-2516000` values coincide with `notify.test.ts`'s fixture only because that fixture was itself captured from the same real dataset for the same input; the E2E value above came from the **persisted lead** (id `lead_1787179904489`) inspected live before restore, not from the test fixture.
