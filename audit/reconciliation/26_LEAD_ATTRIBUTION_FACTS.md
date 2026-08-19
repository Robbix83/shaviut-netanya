# 26 — LEAD PIPELINE / ATTRIBUTION FACT CHECK

**Phase:** WAVE 0R
**Method:** Source inspection (VERIFIED). No tracking added. No code changed.

---

## PERSISTENCE-BEFORE-NOTIFICATION ORDER

**VERIFIED — order is correct.** [`app/api/lead/route.ts:98-109`](../../app/api/lead/route.ts):
1. `saved = await getStore().insertLead(lead)` (line 100) — **awaited**; on throw, returns 500 and **no notification is attempted** (lines 101-104).
2. Only after a successful insert: `notifyNewLead(saved, body.valuation).catch(...)` (line 107) — fire-and-forget.

So the database/store insert is the source of truth and happens before notifications. A notification failure cannot lose the lead; an insert failure aborts before notifying. Good.

---

## PER-INTEGRATION BEHAVIOR

Source: [`lib/notify.ts`](../../lib/notify.ts), `notifyNewLead` (lines 144-151) runs all three via `Promise.allSettled`.

| Integration | Awaited? | Errors propagated? | Errors logged? | Retry? | Delivery state persisted? | Operator alerted on failure? |
|-------------|----------|--------------------|----------------|--------|---------------------------|------------------------------|
| Agent WhatsApp (`notifyWhatsApp`) | Inside `allSettled` (not awaited by the route — route uses `.catch`) | **NO** — `sendWhatsApp` catches and returns `false` (`notify.ts:63-65`) | **NO** — silent `catch { return false }` | NO | **NO** | **NO** |
| Client WhatsApp report (`sendReportToLead`) | Same | **NO** — returns `false` if no Green id or on throw (`notify.ts:112-115`, `63-65`) | **NO** | NO | **NO** | **NO** |
| Google Sheets (`appendToSheet`) | Same | **NO** — `catch { return false }` (`notify.ts:139-141`) | **NO** | NO | **NO** | **NO** |

**Consequence [VERIFIED]:** All three notification channels **fail silently**. A boolean `false` is returned and discarded by `Promise.allSettled`; nothing is logged, retried, persisted, or surfaced. If Green API or the Sheets webhook is down or misconfigured, the agent simply never learns a lead arrived via those channels. The lead is still safely stored (see order above), so the **admin dashboard / store is the only reliable source of truth** — the WhatsApp alert and Sheet are best-effort and unmonitored.

> This CONFIRMS the prior "silent notification failure" finding (P3), and refines it: the failure is silent at BOTH the util level (`catch`→`false`) AND the route level (`.catch(console.error)` only fires for a thrown rejection, but the utils never throw — they resolve `false`). So even the `console.error("notify failed")` on `lead/route.ts:107` will essentially never fire. **Notification failures produce no log line at all.**

---

## SOURCE OF TRUTH FOR LEADS

**VERIFIED:** the store (`LocalStore` → `data/leads.json`, or `SupabaseStore` → `leads` table, selected by `DATA_SOURCE`). Notifications are derivative and unmonitored. Google Sheet and WhatsApp must NOT be treated as authoritative or complete.

---

## UTM / ATTRIBUTION CAPTURE

**VERIFIED — attribution is effectively a single free-text field.**

- The lead `Body` interface ([`lead/route.ts:9-29`](../../app/api/lead/route.ts)) accepts **only `source?: string`**. There are **no** `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, `gclid`, `gbraid`, `wbraid`, or `referrer` fields.
- Stored: `source: body.source?.trim() || null` (line 85) — one string, client-supplied.
- Forwarded to Sheet: `source` only (`notify.ts:135`).

| Parameter | Captured | Stored | Discarded | Only in analytics platform |
|-----------|----------|--------|-----------|----------------------------|
| `utm_source` | Possibly folded into free-text `source` by the client | As part of `source` string at best | Structured form discarded | GA4/Pixel (client-side) if configured |
| `utm_medium` | **No** | No | **Discarded** | GA4/Pixel only |
| `utm_campaign` | **No** | No | **Discarded** | GA4/Pixel only |
| `utm_content` | **No** | No | **Discarded** | GA4/Pixel only |
| `utm_term` | **No** | No | **Discarded** | GA4/Pixel only |
| `fbclid` | **No** | No | **Discarded** | Meta Pixel only |
| `gclid` / `gbraid` / `wbraid` | **No** | No | **Discarded** | GA4/Ads only |
| `referrer` | **No** | No | **Discarded** | GA4 only |

**Consequence [VERIFIED]:** Server-side, per-lead multi-touch attribution is impossible. At most a single `source` label survives if the client chooses to populate it. Any real channel attribution lives only inside GA4 / Meta (client-side, if those IDs are configured — see 19_PRODUCTION_FACTS, both UNKNOWN in prod) and cannot be joined to an individual stored lead. This CONFIRMS the prior "lossy UTM" finding and quantifies it precisely.

**No tracking was added.** Recommendation deferred to roadmap (Wave 5, Observability + Attribution).
