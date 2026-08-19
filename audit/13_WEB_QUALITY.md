# Phase 12 — Web Quality / SEO / Performance Audit

**App:** shaviut-netanya (Next.js 16 / React 19 / Tailwind / RTL Hebrew)
**Date:** 2026-08-19
**Auditor:** Forensic read-only pass — no files modified

---

## 1. Canonical URL

**VERIFIED — canonical is set.**

```ts
// app/layout.tsx:14–16
alternates: {
  canonical: BASE_URL,   // "https://shaviut-netanya.co.il"
}
```

`metadataBase` is also set so relative OG image URLs resolve correctly. Both `BASE_URL` and the `canonical` point to `shaviut-netanya.co.il`, which appears to be the production domain (the TODO comment `"החלף בדומיין האמיתי"` was apparently left in but the value is already the real domain, confirmed by its use across robots.ts and sitemap.ts as well).

**Gap:** No `hreflang` tag. Not critical for a Hebrew-only, Israel-only tool.

---

## 2. OpenGraph Tags

**VERIFIED — complete and correct.**

| Tag | Value | Status |
|---|---|---|
| og:title | "כמה שווה הדירה שלך בנתניה?" | PASS |
| og:description | "סקירת מחירים לפי עסקאות אמיתיות..." | PASS |
| og:locale | "he_IL" | PASS |
| og:type | "website" | PASS |
| og:url | BASE_URL | PASS |
| og:site_name | "שווי דירה נתניה" | PASS |
| og:image | "/og-image.jpg" (1200×630) | PASS — file exists at `public/og-image.jpg` |
| og:image:alt | Hebrew alt text | PASS |
| twitter:card | "summary_large_image" | PASS |
| twitter:image | "/og-image.jpg" | PASS |

Twitter/X `site` and `creator` handle are absent — minor gap for X sharing attribution.

---

## 3. robots.txt

**VERIFIED — correctly configured.**

```ts
// app/robots.ts
rules: [{
  userAgent: "*",
  allow: ["/", "/privacy", "/terms"],
  disallow: ["/admin/", "/api/"],
}],
sitemap: "https://shaviut-netanya.co.il/sitemap.xml",
```

- Admin dashboard blocked: PASS
- All API routes blocked (no leaking of internal schema): PASS
- Sitemap reference included: PASS

**Gap:** `/api/valuation`, `/api/lead`, etc. are correctly blocked, but `/api/autocomplete` (used by AddressSearch for street suggestions) is also blocked — this prevents Googlebot from crawling any API responses. This is intentional and correct since these are dynamic JSON endpoints, not indexable content.

---

## 4. sitemap.ts

**VERIFIED — correct but minimal.**

```ts
// app/sitemap.ts — three entries
{ url: base, priority: 1, changeFrequency: "weekly" }
{ url: `${base}/privacy`, priority: 0.3, changeFrequency: "monthly" }
{ url: `${base}/terms`, priority: 0.3, changeFrequency: "monthly" }
```

`lastModified: new Date()` — sets the current date on every request. This is technically correct (Next.js will serve the sitemap with a fresh date) but provides no signal to search engines about which pages actually changed.

**Gap:** Admin routes (`/admin/*`) are not in the sitemap but are also not canonical pages — this is correct. No dynamic pages (neighborhoods, individual listings) exist; the site is single-page so the sitemap is complete as-is.

---

## 5. Structured Data (JSON-LD)

**VERIFIED — present and rich.**

Three schema types defined in `app/layout.tsx` (lines 49–109):

1. **`RealEstateAgent`** — name, description, url, areaServed (City: נתניה), credential (רישיון מתווך)
2. **`WebApplication`** — name, category (FinanceApplication), price: 0 ILS
3. **`FAQPage`** — 3 questions covering price, reliability, and cost

All three use `@id` anchors for graph relationships. The agent name is driven by `process.env.NEXT_PUBLIC_AGENT_NAME`, which defaults to `"מתווך מורשה נתניה"` — not ideal as it is a generic phrase, not a proper name. Until `NEXT_PUBLIC_AGENT_NAME` is set, the schema will have a non-specific agent name.

---

## 6. Fonts — Self-Hosted vs Google Fonts

**VERIFIED — Google Fonts (external), loaded twice, performance risk.**

```ts
// app/layout.tsx:121–130
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700;900&display=swap" />
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700;900&display=swap" rel="stylesheet" />
```

```css
/* app/globals.css:2 */
@import url("https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800;900&display=swap");
```

**Double-load:** The `<link>` tag in layout.tsx requests weights 400, 500, 700, 900. The `@import` in globals.css requests weights 300, 400, 500, 600, 700, 800, 900 (7 weights vs 4). Both will be fetched. The browser may deduplicate, but two separate network requests to fonts.googleapis.com are issued.

**Performance implications:**
- Fonts are not self-hosted → additional DNS + TCP + TLS round trips.
- `display=swap` is used correctly → FOUT (flash of unstyled text) but no FOIT.
- `preconnect` hints help but do not eliminate the external dependency.
- Under ISP-level DNS filtering or Google Fonts CDN latency, Hebrew text will flash to system font (Arial) then swap.

**Recommendation:** Self-host Heebo via `next/font/google` which automatically optimizes, self-hosts, and eliminates the double-load.

---

## 7. Images — next/image Usage, Optimization

**VERIFIED — next/image is NOT used; risks present.**

- `og-image.jpg` in `public/` is referenced as a string URL in metadata. This is correct (metadata requires string URLs, not `<Image>` components).
- The video in `page.tsx:147` is a raw `<video>` from a CloudFront URL. No width/height attributes — potential CLS source.
- Agent photo in `ValuationWizard.tsx:1197` uses raw `<img>` (noted with eslint-disable-next-line comment):
  ```tsx
  // eslint-disable-next-line @next/next/no-img-element
  <img src={AGENT.photo} alt={AGENT.name} className="h-10 w-10 rounded-full object-cover" />
  ```
  This bypasses Next.js image optimization (resizing, WebP conversion, lazy loading).
- No other user-facing images found in component code — decorative elements are all CSS/SVG.

---

## 8. Core Web Vitals — Code-Visible Risks

### LCP (Largest Contentful Paint)

**LIKELY RISK.**

The hero `<section>` is `min-h-screen` with a background gradient (CSS, fast). The wizard card is server-rendered (SSR) so its text appears quickly. However:

- The CloudFront video (`page.tsx:148`) is below the fold on mobile but has `autoPlay` — browser may start fetching it immediately, competing with above-the-fold resources.
- Google Fonts are render-blocking until preconnect resolves (see item 6).
- No `priority` prop possible (no next/image used), but the hero section contains no images — LCP is likely the `<h1>` text, which is fine.

### CLS (Cumulative Layout Shift)

**LIKELY RISK — two sources.**

1. **Font swap:** Heebo has different metrics from the system fallback (Arial). `display=swap` causes layout shift when the font loads. No `size-adjust` CSS override defined.
2. **Video without dimensions:** `<video className="w-full aspect-video">` uses `aspect-video` which is CSS aspect-ratio. This should be stable if CSS loads before the element renders, but older Chrome may still shift.
3. **Dynamic stat display in hero:** `leadCount` and `stats` are fetched server-side (`getStore().countLeads()`) and inlined — no client-side fetch shift. PASS.

### INP (Interaction to Next Paint)

**LIKELY ACCEPTABLE.** React 19 concurrent features should keep INP low. The main risk is the govmap geocode debounce (600ms + 4s timeout) which runs on `houseNumber` change — but this is async and does not block the main thread.

---

## 9. Valuation API Caching

**VERIFIED — NO caching at any level.**

The valuation route (`app/api/valuation/route.ts`) has:
- `export const runtime = "nodejs"` — forces Node.js runtime (no edge caching).
- No `export const revalidate` directive.
- No `Cache-Control` headers set in the response.
- No `unstable_cache` wrapper around `valuate()`.
- No Redis or in-memory cache layer.

```ts
// app/api/valuation/route.ts:86
return NextResponse.json({ valuation });
// No cache headers added
```

Every valuation request recomputes from raw data. For the local JSON store, this means reading and filtering potentially thousands of deals on each POST. For Supabase, it means a DB query on every request.

**Risk:** Under traffic spikes (e.g., if a link goes viral), the API has no protection. A caching layer (even 60-second server-side cache keyed on `neighborhoodId + propertyType + rooms + area + floor`) would dramatically reduce load.

---

## 10. API Timeouts

**VERIFIED — mixed; client-side valuation call has NO timeout.**

| Call | Timeout | Location |
|---|---|---|
| Client → govmap geocode (house number) | `AbortSignal.timeout(4000)` | `ValuationWizard.tsx:502` |
| Client → `/api/resolve-address` | `AbortSignal.timeout(5000)` | `ValuationWizard.tsx:537` |
| Client → `/api/valuation` | **NONE** | `ValuationWizard.tsx:641` |
| Client → `/api/neighborhoods` | **NONE** | `ValuationWizard.tsx:580` |
| Client → `/api/teaser` | **NONE** | `ValuationWizard.tsx:597` |
| Server → govmap (in resolvePoint) | UNKNOWN — not verified |  |

The missing timeout on `/api/valuation` is the highest risk: if the server hangs, the user sees a spinning disabled button indefinitely.

---

## 11. next.config.mjs — Production Config Review

**VERIFIED — minimal; missing production hardening.**

```js
// next.config.mjs
const nextConfig = {
  reactStrictMode: process.env.NODE_ENV === "production",
  allowedDevOrigins: ["10.100.102.76"],
  onDemandEntries: { maxInactiveAge: 30 * 60 * 1000, pagesBufferLength: 5 },
};
```

Missing production-recommended config:
- No `output: "standalone"` — required for Docker or serverless deployment without node_modules.
- No `compress: true` — Next.js defaults to gzip compression but this is not explicit.
- No security headers (`headers()` function with CSP, HSTS, X-Frame-Options, etc.).
- No image `domains` or `remotePatterns` — if `next/image` is added later, this will be required.
- `allowedDevOrigins` contains a private IP — this should be env-conditional; in production this key is harmless but clutters the config.

---

## 12. Viewport Meta

**VERIFIED — `maximumScale: 1` blocks user zoom — accessibility concern.**

```ts
// app/layout.tsx:41–47
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,   // מונע zoom אוטומטי של iOS על שדות קלט
  viewportFit: "cover",
  themeColor: "#0d3efb",
};
```

The comment correctly notes this prevents iOS auto-zoom on input focus, which is a UX win. However, `maximumScale: 1` also prevents users from manually zooming in — this is a WCAG 2.1 Level AA failure (Success Criterion 1.4.4: Resize Text). Users with low vision who rely on browser zoom cannot zoom the page.

**Alternative:** iOS auto-zoom is triggered when `font-size < 16px` on an input. The `field-input` class sets `text-base` (16px). If all inputs are 16px+, iOS auto-zoom should not trigger and `maximumScale` can be removed.

---

## Summary Table

| Check | Status | Severity |
|---|---|---|
| Canonical URL | VERIFIED — set | — |
| OpenGraph complete | VERIFIED — complete | — |
| robots.txt | VERIFIED — correct | — |
| sitemap.ts | VERIFIED — minimal but correct | — |
| Structured data | VERIFIED — rich (3 types) | — |
| Fonts self-hosted | FAIL — Google Fonts, double-loaded | MEDIUM |
| next/image usage | FAIL — raw `<img>` for agent photo | LOW |
| CLS risks | LIKELY — font swap, video | MEDIUM |
| Valuation API caching | FAIL — no caching | HIGH |
| Client timeout on valuation | FAIL — no AbortSignal | HIGH |
| Security headers | FAIL — none configured | HIGH |
| maximumScale:1 blocks zoom | FAIL — WCAG 1.4.4 violation | MEDIUM |
| Production next.config | FAIL — no standalone/headers | MEDIUM |
