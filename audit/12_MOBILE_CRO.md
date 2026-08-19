# Phase 11 — Mobile UX + CRO Audit

**App:** shaviut-netanya (Next.js 16 / React 19 / Tailwind / RTL Hebrew)
**Date:** 2026-08-19
**Auditor:** Forensic read-only pass — no files modified

---

## 1. Wizard Steps

**VERIFIED — 4 internal steps; Stepper displays 3 labels.**

| Internal step | `setStep(n)` | Stepper label | Content |
|---|---|---|---|
| 1 | `step === 1` | מיקום | Property type (3 buttons), address autocomplete, house-number field, "המשך" CTA |
| 2 | `step === 2` | פרטי הנכס | Rooms selector (9 options), area m², plot m², floor, year-built picker |
| 3 | `step === 3` | התוצאה | Valuation card → value factors → teaser locked data → **lead form** (name, phone, sell timing, 3 consents, OTP send) → OTP code entry |
| 4 | `step === 4` | (no label) | Full report: all comparable deals grouped by tier + CBS + MAVAT + Accessibility panels |

Evidence: `const [step, setStep] = useState<1 | 2 | 3 | 4>(1);` — `ValuationWizard.tsx:437`

---

## 2. Taps / Fields Before Seeing Any Valuation Value

**VERIFIED — minimum 7 discrete interactions.**

| # | Interaction | Field |
|---|---|---|
| 1 | Type in address search | Keyboard |
| 2 | Select autocomplete suggestion | Tap |
| 3 | Type house number | Keyboard |
| 4 | Tap "המשך" | Tap |
| 5 | Tap rooms count (e.g. 4) | Tap |
| 6 | Type area in m² | Keyboard |
| 7 | Tap "חשב שווי" | Tap |

Floor and year-built are optional, so minimum is 7 actions. Property type defaults to "apartment" so no tap required there.

**CRO risk:** 7 interactions is high friction for a conversion tool. Competitor tools (Madlan, Yad2 estimates) require 3–4 steps. The "30 second" tagline is implausible (see item 7).

---

## 3. Address Autocomplete — Mobile Keyboard Friendliness

**LIKELY — partially keyboard-friendly; one RTL concern.**

- `AddressSearch.tsx:127`: the main input has `dir="ltr"`. Hebrew addresses typed in an LTR input cause right-to-left cursor confusion on iOS Safari — users see text appended from the left side of the field rather than right-to-left. Should be `dir="auto"` or `dir="rtl"`.
- Dropdown results use `className="text-right"` (line 192, 197) — correct for RTL display.
- `inputMode` is not set on the address search field; adding `inputMode="search"` would suppress the numeric keyboard on mobile.
- No `autocomplete` attribute on the address field; the house-number input (`houseNumber`) lacks `inputMode="numeric"`.

Evidence:
```tsx
// AddressSearch.tsx:127
dir="ltr"
```

---

## 4. Tap Target Sizes ≥ 44 px

**VERIFIED — most targets meet the standard; two classes are borderline.**

- `btn-primary` uses `py-3.5` = 14px × 2 + ~20px base ≈ 48px. **PASS.**
- Room option buttons: `min-h-[44px]` explicit. **PASS.**
- Property type buttons: `min-h-[56px]` explicit. **PASS.**
- Year-built era buttons: `min-h-[44px]` explicit. **PASS.**
- ValueFactors chips: `min-h-[44px]`. **PASS.**
- Lead-wall unlock button: `min-h-[44px]`. **PASS.**
- Stepper dots: `h-8 w-8` = 32px × 32px. **FAIL** — below 44 px, but they are not primary interactive targets (navigation only).
- Checkbox labels in lead form: uses `label` wrapping `input[type=checkbox]`; entire label is tappable but the checkbox itself is `h-4 w-4` (16px). **MARGINAL** — label wraps fully so effective target is larger, but the visual affordance is small on mobile.

---

## 5. Progress Indicator

**VERIFIED — `<Stepper step={step} />` present.**

- Three labeled dots: "מיקום", "פרטי הנכס", "התוצאה" with completed (green), active (brand blue), and future (grey) states.
- Step 4 (full report) has no corresponding dot — the user has no visual cue that they have reached the final state.

Evidence: `ValuationWizard.tsx:783`, `function Stepper` at line 1480.

---

## 6. Validation Error Display

**LIKELY — inline text only; missing ARIA on step-2 errors.**

- Step 2 error: `{error && <p className="text-sm font-medium text-red-600">{error}</p>}` — line 975. **No `role="alert"`** — screen readers and VoiceOver will not announce the error on mobile.
- Step 3 lead form errors: `<p role="alert" className="text-sm font-medium text-red-600">` — lines 1268, 1317. **PASS** for accessibility.
- Error text is placed below the offending field grouping, which is correct. But on small screens the button may push errors off-screen if the user taps without scrolling.
- No field-level red border highlighting; the error message is the only visual signal.

---

## 7. The "30-Second" Promise — Is It Achievable?

**VERIFIED — NO. Realistic minimum path is 60–120 seconds.**

The hero copy states: `"גלו תוך 30 שניות את שווי הנכס שלכם"` (layout.tsx:87 and page.tsx:62).

Realistic mobile path:
- Address typing + autocomplete selection: ~15–20 s
- House-number entry + govmap geocode debounce (600 ms + 4 s timeout): ~5–10 s
- Tap "המשך": 1 s
- Rooms tap + area typing: ~10–15 s
- Tap calculate + API response: ~2–5 s

**Total: ~33–51 s under ideal conditions; 60–90 s under typical mobile conditions.**

The valuation API call itself has no client-side timeout configured:
```tsx
// ValuationWizard.tsx:641
const r = await fetch("/api/valuation", { method: "POST", ... });
// No AbortSignal.timeout()
```

If the API is slow, the user stares at "מחשב..." indefinitely.

---

## 8. What Is Teased Before the Lead Wall

**VERIFIED — significant value shown free; gating is primarily the full deal list.**

Shown **before** entering name/phone:
- Full valuation range (estimateLow–estimateHigh in ₪)
- Price per m² (mid)
- Number of comparable deals used
- Top 3 comparable deal cards (fully unblurred: address, rooms, area, price, date, tier badge)
- ValueFactors interactive adjustment widget
- Shevah (capital gains tax) section
- Price trend chart (if data available)
- Urban renewal panel (if within radius)

**Gated** (requires submitting name/phone + OTP):
- Remaining comparable deals (4th deal onward — blurred overlay with CTA button)
- CBS neighborhood profile score (shown as numeric score but "פרטים" button scrolls to lead form)
- Accessibility score (same pattern)
- MAVAT planning status (same pattern)
- Full CBS/MAVAT/Accessibility panels (step 4 only)

**Assessment:** The value proposition before the wall is generous. Users see enough to trust the tool. The gating mechanic (blurred deals) is a standard pattern. The OTP requirement adds two additional steps beyond a simple name/phone form.

---

## 9. Required vs Nice-to-Have Fields

**VERIFIED.**

```ts
// ValuationWizard.tsx:617
const canCalc =
  (!needsArea || !!area) && (!needsPlot || !!plot) && (isLand || isHouse || !!rooms);
```

**Required for valuation:**
- `neighborhoodId` (from address) — hard required; no neighborhood = 422 error
- `rooms` — required for apartments
- `areaSqm` — required for apartments and houses
- `plotSqm` — required for land and houses

**Optional (improve accuracy but not blocking):**
- `floor`
- `yearBuilt`
- `houseNumber` (improves geocoding accuracy for building-level scope)
- `streetName` / `streetX` / `streetY`

**CRO observation:** requiring `houseNumber` for precise geocoding is not enforced — the wizard proceeds without it. This means many users will get neighborhood-level valuations ("🏘️ מבוסס על השכונה") instead of building-level, which may reduce trust.

---

## 10. Loading State During Valuation

**VERIFIED — text-only; no visual spinner.**

```tsx
// ValuationWizard.tsx:985
{loading ? "מחשב..." : "חשב שווי לפי עסקאות אמיתיות"}
```

The button label changes to "מחשב..." and `disabled={loading}` prevents double-submit. There is no spinner, skeleton, progress bar, or intermediate feedback. On a slow connection (common on Israeli 4G in buildings), the user sees a disabled button with changed text for potentially 5–10 seconds.

**Risk:** Users may assume the tap did not register and attempt to tap again; the disable guard prevents double-submit but the UX is poor.

---

## 11. Result Page Trust Design

**VERIFIED — strong trust signals present.**

- Scope badge (building / street / radius / neighborhood) with color coding
- Deal count: "מבוסס על N עסקאות"
- Individual deal cards with actual addresses (where published), rooms, area, price, date
- Tier badges per deal (same building / same street / nearby / neighborhood)
- Floor-adjusted indicator
- Data-as-of date visible via `asOf` field in valuation (not prominently displayed in the UI — UNKNOWN if rendered)
- Urban renewal warning if applicable
- Disclaimer at bottom of wizard: `"ההערכה היא אינדיקציה המבוססת על עסקאות פומביות"` (line 1446)
- Agent card in lead form with license number

**Gap:** The `valuation.asOf` date is not rendered anywhere visible in step 3 or step 4. Operator cannot see how stale the underlying data is from the user-facing UI.

---

## 12. User Actions: Landing → Valuation Result

**VERIFIED — 7 actions minimum.**

1. Type address
2. Select autocomplete suggestion
3. Type house number (or skip — loses precision)
4. Tap "המשך"
5. Tap rooms count
6. Type area m²
7. Tap "חשב שווי"

---

## 13. User Actions: Landing → Submitted Lead

**VERIFIED — 13–15 actions total.**

Actions 1–7 as above, then:

8. Optionally select sell timing (3 buttons)
9. Type name
10. Type phone
11. Review consent checkboxes (pre-checked for report; marketing unchecked)
12. Tap "שלחו לי את הדוח 📲"
13. Receive WhatsApp message
14. Type 6-digit OTP
15. Tap "פתחו את הדוח ←" (or auto-submits at character 6 after 120 ms delay)

**Note:** The OTP auto-submit (`if (v.length === 6) setTimeout(verifyAndSubmit, 120)`) reduces friction at step 14 → 15.

---

## 14. RTL Issues — Hardcoded LTR

**VERIFIED — 3 intentional LTR uses and 1 potential bug.**

| Location | Code | Assessment |
|---|---|---|
| `AddressSearch.tsx:127` | `dir="ltr"` on text input | **POTENTIAL BUG** — Hebrew street names typed in LTR context; should be `dir="auto"` |
| `ValuationWizard.tsx:183` | `dir="ltr"` on bar chart container | INTENTIONAL — LTR bar chart ordering is correct for time series |
| `ValuationWizard.tsx:1299` | `dir="ltr"` on OTP input | INTENTIONAL — numeric code is LTR |
| `ValuationWizard.tsx:345` | `className="shrink-0 text-left"` on price column | **POTENTIAL BUG** — `text-left` in RTL context aligns to physical left (= logical end). In an RTL layout this pushes price to the logical start. Should be `text-start` or `text-end` based on intent. |

No hardcoded `margin-left` / `padding-left` / `left:` CSS found in component code (Tailwind logical properties not consistently used, but no LTR-specific spacing overrides detected).

---

## Summary — CRO Priority Issues

| Priority | Issue |
|---|---|
| HIGH | "30 seconds" promise unachievable — actual time is 60–120 s |
| HIGH | No timeout on `/api/valuation` fetch — UI freezes on slow API |
| HIGH | No spinner/skeleton during calculation — user cannot tell if tap registered |
| MEDIUM | Address input `dir="ltr"` causes RTL keyboard confusion on iOS |
| MEDIUM | Step-2 errors missing `role="alert"` — not announced by VoiceOver |
| MEDIUM | `valuation.asOf` not surfaced in UI — data freshness invisible to user |
| LOW | Step 4 has no Stepper dot — user has no "done" marker |
| LOW | `text-left` on price column may misalign in RTL layout |
