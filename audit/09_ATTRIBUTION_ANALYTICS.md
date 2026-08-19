# Attribution & Analytics Audit

**Audit date:** 2026-08-19  
**Confidence legend:** VERIFIED = traced in source code · LIKELY = inferred from code · UNKNOWN = no code found

---

## 1. Is GA4 wired up?

**VERIFIED — Conditionally yes.** `components/Analytics.tsx` lines 5–22:

```ts
const ga4Id = process.env.NEXT_PUBLIC_GA4_ID;
if (!ga4Id && !fbId) return null;
// …
<Script src={`https://www.googletagmanager.com/gtag/js?id=${ga4Id}`} strategy="afterInteractive" />
<Script id="ga4-init" strategy="afterInteractive">{`
  window.dataLayer=window.dataLayer||[];
  function gtag(){dataLayer.push(arguments);}
  gtag('js',new Date());
  gtag('config','${ga4Id}');
`}</Script>
```

GA4 loads **only if `NEXT_PUBLIC_GA4_ID` is set** in the environment. If the env var is empty (which is its state in the checked-in `.env.example` or default), the `<Analytics />` component returns `null`. There is no fallback or warning.

The `<Analytics />` component is mounted in `app/layout.tsx` line 139, so it covers all pages when the env var is present.

**No Google Tag Manager** — gtag.js is loaded directly, not via GTM.

---

## 2. Is Facebook Pixel wired up?

**VERIFIED — Conditionally yes.** `components/Analytics.tsx` lines 25–36:

```ts
const fbId = process.env.NEXT_PUBLIC_FB_PIXEL_ID;
// …
fbq('init','${fbId}');
fbq('track','PageView');
```

Facebook Pixel loads **only if `NEXT_PUBLIC_FB_PIXEL_ID` is set**. PageView fires automatically on mount. Custom and standard events are fired via `lib/analytics.ts`.

---

## 3. Are UTM parameters captured at landing?

**VERIFIED — Partially.** `components/ValuationWizard.tsx` lines 575–578:

```ts
const p = new URLSearchParams(window.location.search);
source.current =
  p.get("utm_source") || p.get("utm_campaign") || document.referrer || "direct";
```

**What is captured:** a single string value, priority order: `utm_source` → `utm_campaign` → `document.referrer` → `"direct"`.

**What is NOT captured:**
- `utm_medium` — ignored.
- `utm_content` — ignored.
- `utm_term` — ignored.
- `utm_campaign` (only used as fallback to `utm_source`, meaning if both are present, `utm_campaign` is dropped).
- The full raw query string is not stored.

This means **two different Facebook campaigns** with the same `utm_source=facebook` but different `utm_campaign` values will produce identical `source` values in the lead record.

---

## 4. Are UTM params passed through the wizard to the lead record?

**VERIFIED — The single captured string is passed.** `components/ValuationWizard.tsx` line 749:

```ts
source: source.current,
```

The server receives it as `body.source` and stores it verbatim:

```ts
source: body.source?.trim() || null,  // app/api/lead/route.ts line 85
```

So the lead record's `source` field contains one of: `utm_source` value, `utm_campaign` value, the full referrer URL, or the string `"direct"`. There is no structured UTM object, no campaign ID, no ad set ID, no click ID (fbclid/gclid).

---

## 5. Is valuation completion tracked as a conversion event?

**VERIFIED — YES.** `components/ValuationWizard.tsx` lines 664–669:

```ts
trackEvent("valuation_viewed", {
  neighborhood: j.valuation.neighborhood,
  propertyType,
  rooms,
  confidence: j.valuation.confidence,
});
```

`lib/analytics.ts` maps this to:
- GA4: `gtag("event", "valuation_viewed", { neighborhood, propertyType, rooms, confidence })`.
- Facebook: `fbq("trackCustom", "valuation_viewed", ...)` (not a standard FB event; `ViewContent` is mapped to `valuation_viewed` in `FB_STANDARD`, but **note** the map key is `"valuation_viewed"` → `"ViewContent"`, so this fires as `fbq("track", "ViewContent", ...)`).

**VERIFIED** — `lib/analytics.ts` line 6: `valuation_viewed: "ViewContent"` — this does fire the standard FB `ViewContent` event.

---

## 6. Is lead submission tracked as a conversion event?

**VERIFIED — YES.** `components/ValuationWizard.tsx` lines 764–766:

```ts
trackEvent("lead_submitted", { sellTiming, consentMarketing, alertOptIn });
```

`lib/analytics.ts` line 5: `lead_submitted: "Lead"` — maps to FB standard `fbq("track", "Lead", ...)` and GA4 `gtag("event", "lead_submitted", ...)`.

This event fires **after** the server returns `{ ok: true }` (line 763 confirms `!r.ok` check passed), so it reflects genuine server-accepted leads.

Also tracked:
- `wizard_step1_complete` — when user clicks Continue on step 1 (line 866).
- `otp_requested` — when OTP send is triggered (line 695).
- `shevah_only_property` / `shevah_not_only_property` — capital gains tax interaction (lines 377, 388).
- `shevah_cta_click` — when user clicks the tax CTA (line 424).

---

## 7. Can the operator tell which ad campaign generated which lead?

**VERIFIED — ONLY at coarse granularity.**

What is queryable per lead:
- `source` field = one string (utm_source OR utm_campaign OR referrer OR "direct").

What is NOT available:
- `utm_medium` (cannot distinguish organic vs paid traffic on the same source).
- `utm_campaign` when `utm_source` is present.
- `utm_content`, `utm_term`.
- Facebook `fbclid` or Google `gclid` click IDs.
- Any session-level attribution beyond the first UTM param.

**Practical implication:** If the operator runs Facebook ads (utm_source=facebook) and Google ads (utm_source=google) simultaneously, they can distinguish those. But they cannot distinguish which of two Facebook ad sets or which specific ad creative generated a lead. Campaign-level ROAS measurement is not possible from lead data alone.

GA4/FB Pixel will attribute conversions via their own session/cookie tracking (independent of the `source` field), so platform-native attribution reports (GA4 conversions, FB Ads Manager) will have campaign-level data — but the lead record in the DB/Sheets will not.

---

## 8. What funnel stages are measurable today?

**VERIFIED** — events found in code:

| Stage | Event | Platform | Measurable |
|---|---|---|---|
| Page load / PageView | `PageView` (FB auto) | FB Pixel | YES (if fbId set) |
| Step 1 complete (location chosen) | `wizard_step1_complete` | GA4 + FB custom | YES |
| Valuation calculated | `valuation_viewed` → `ViewContent` | GA4 + FB standard | YES |
| OTP requested | `otp_requested` | GA4 + FB custom | YES |
| Lead submitted | `lead_submitted` → `Lead` | GA4 + FB standard | YES |
| Opt-out | (none) | — | NO |
| Status changes (admin) | (none) | — | NO |

**Measurable drop-off points:**
- Landing → Step 1 complete (address entry friction)
- Step 1 → Valuation viewed (property detail friction)
- Valuation viewed → OTP requested (form + phone friction)
- OTP requested → Lead submitted (OTP verification friction)

**NOT measurable today:**
- Time-on-page / scroll depth before engagement.
- Step 2 intermediate interactions (e.g. rooms selected but not submitted).
- Error events (invalid phone, consent not given).
- Form abandonment vs. successful completion rate.
- Lead quality by source (no campaign-level breakdown in DB).
- Revenue or deal closure (no CRM integration).

---

## Summary

| Check | Status |
|---|---|
| GA4 present | VERIFIED — conditional on `NEXT_PUBLIC_GA4_ID` |
| Facebook Pixel present | VERIFIED — conditional on `NEXT_PUBLIC_FB_PIXEL_ID` |
| UTM captured at landing | VERIFIED — single field only, lossy |
| UTM in lead record | VERIFIED — stored as `source`, one string |
| Valuation conversion tracked | VERIFIED — `ViewContent` (FB) + `valuation_viewed` (GA4) |
| Lead submission tracked | VERIFIED — `Lead` (FB standard) + `lead_submitted` (GA4) |
| Campaign-level attribution in DB | NOT PRESENT — coarse source only |
| Full funnel measurable | PARTIAL — 4 of ~6 meaningful stages |
