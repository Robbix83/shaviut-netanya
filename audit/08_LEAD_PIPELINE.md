# Lead Pipeline Audit

**Audit date:** 2026-08-19  
**Confidence legend:** VERIFIED = traced in source code · LIKELY = inferred from code · UNKNOWN = no code found

---

## 1. What data is POSTed on lead submission?

**VERIFIED** — `components/ValuationWizard.tsx` line 736–757:

```ts
body: JSON.stringify({
  name, phone,
  address: address.trim() || neighborhoodName,
  neighborhood: valuation?.neighborhood || neighborhoodName,
  propertyType, rooms, areaSqm, plotSqm, floor, houseNumber,
  sellTiming,
  source: source.current,          // utm_source | utm_campaign | referrer | "direct"
  consent: consentReport,          // backward-compat alias
  consentReport,
  consentMarketing,
  alertOptIn,
  consentWordingVersion: "2026-06-v1",
  valuation,                       // full Valuation object incl. comparableDeals
})
```

**Notable omission:** `email` is defined in the `Body` interface (`app/api/lead/route.ts` line 12) but is **never sent by the wizard**. No email field exists in the contact form.

---

## 2. Server-side validation

**VERIFIED** — `app/api/lead/route.ts` lines 50–69:

| Field | Rule | Error code |
|---|---|---|
| `name` | length ≥ 2 after trim | `invalid_name` / 422 |
| `phone` | `/^0\d{1,2}-?\d{7}$|^(\+?972|972)\d{8,9}$/` | `invalid_phone` / 422 |
| `consentReport` | must be exactly `true` (with `body.consent` as fallback) | `consent_required` / 422 |

All other fields (`neighborhood`, `address`, `propertyType`, `rooms`, `areaSqm`, `valuation`, etc.) are **accepted without validation** — they are set to null/defaults if missing.

**VERIFIED** — The regex at line 31 (`PHONE_RE`) accepts Israeli formats: `05X-XXXXXXX`, `+9725XXXXXXXX`, `9725XXXXXXXX`. International non-Israeli numbers are rejected.

---

## 3. DB insertion code path

**VERIFIED** — `lib/store.ts` `LocalStore.insertLead` (lines 104–117):

```ts
async insertLead(lead: Lead): Promise<Lead> {
  const file = path.join(DATA_DIR, "leads.json");
  const existing = await readJson<Lead[]>("leads.json", []);
  const withMeta: Lead = {
    ...lead,
    id: lead.id ?? `lead_${Date.now()}`,
    createdAt: lead.createdAt ?? new Date().toISOString(),
    status: lead.status ?? "new",
  };
  existing.push(withMeta);
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(existing, null, 2), "utf8");
  return withMeta;
}
```

**VERIFIED** — `SupabaseStore.insertLead` (lines 233–237):

```ts
const { data, error } = await sb.from("leads").insert(lead).select().single();
if (error) throw error;
return data as Lead;
```

Path: `POST /api/lead` → `getStore().insertLead(lead)` → `leads.json` (local) or Supabase `leads` table (production).

---

## 4. If DB insertion succeeds but WhatsApp fails

**VERIFIED** — `app/api/lead/route.ts` lines 107–109:

```ts
// best-effort — לא חוסמות את התגובה למשתמש
notifyNewLead(saved, body.valuation).catch((e) => console.error("notify failed", e));
return NextResponse.json({ ok: true, id: saved.id });
```

`notifyNewLead` is called **fire-and-forget** (`.catch` swallows the error). The `200 { ok: true }` response is returned to the client regardless of WhatsApp outcome. The lead **is saved** and the error is only logged to `console.error`. The operator receives no alert about the failed notification.

---

## 5. If WhatsApp succeeds but DB fails

**VERIFIED** — `app/api/lead/route.ts` lines 99–104:

```ts
try {
  saved = await getStore().insertLead(lead);
} catch (e) {
  console.error("lead insert failed", e);
  return NextResponse.json({ error: "save_failed" }, { status: 500 });
}
```

A DB failure returns `500 { error: "save_failed" }` to the client and **does not call `notifyNewLead`**. However: the wizard frontend treats any non-2xx response as an error and does not set `submitted=true` or advance to step 4, so the user sees "אירעה שגיאה. נסו שוב." — but WhatsApp hasn't been sent (it's called after DB, not before), so there is no scenario where WhatsApp fires before DB under the current code order.

---

## 6. If Google Sheets webhook fails

**VERIFIED** — `lib/notify.ts` `notifyNewLead` lines 144–151:

```ts
await Promise.allSettled([
  notifyWhatsApp(msg),
  sendReportToLead(lead, v),
  appendToSheet(lead, v),
]);
```

All three operations run via `Promise.allSettled`, which never rejects. `appendToSheet` catches its own exceptions (lines 138–140) and returns `false`. **Failure is silent** — no exception propagates, no error is surfaced to the operator or to `notifyNewLead`'s caller. The lead is already saved in DB before `notifyNewLead` is called. No retry, no dead-letter queue.

---

## 7. Idempotency — can double-click create two leads?

**VERIFIED — YES, it can.**

The `LocalStore.insertLead` function reads the file, appends, and writes back. There is **no uniqueness check on phone or any other field**. Two simultaneous calls from the same user (double-click, network retry) will each read the same file state and both append independently.

The `SupabaseStore` path relies on the Supabase `leads` table. There is **no unique constraint visible in application code** (no `.upsert`, no conflict handling). Whether a DB-level unique index exists is unknown from this codebase.

The rate limiter (`lib/rateLimit.ts`) is **in-memory, per-serverless-instance**. On Vercel, different lambda invocations may have separate memory, so the rate limit (3/hr/IP) cannot reliably prevent duplicate submissions. On a single long-running Node process (local dev), it works correctly.

**VERIFIED** — The client-side `submitted` flag (`useState(false)`) prevents the wizard from re-advancing after a successful submit, but does not prevent a second API call from a form re-render, browser back-navigation, or script.

---

## 8. Success response to client

**VERIFIED** — `app/api/lead/route.ts` line 109:

```ts
return NextResponse.json({ ok: true, id: saved.id });
```

The client receives `{ ok: true, id: "lead_<timestamp>" }` (local) or `{ ok: true, id: "<uuid>" }` (Supabase). The wizard reads `!r.ok` to detect failure, but ignores `j.id`.

---

## 9. Rate limits on lead endpoint

**VERIFIED** — `app/api/lead/route.ts` lines 35–41:

```ts
const ip = getIP(req);
if (!rateCheck(`lead:${ip}`, 3, 60 * 60 * 1000)) {
  return NextResponse.json({ error: "rate_limit", ... }, { status: 429 });
}
```

Limit: **3 submissions per IP per hour**.

**Critical caveat — VERIFIED** — `lib/rateLimit.ts` line 11: `const _buckets = new Map<string, Bucket>();` — this is a **module-level in-memory store**. On serverless (Vercel), each cold-start spawns a new instance with an empty map. A bad actor can bypass the limit by triggering new cold-starts (e.g. after idle timeout). The comment in the file acknowledges this: `// לפרודקשן רציני: החלף ב-Upstash Redis`.

---

## 10. Bot protection on lead endpoint

**VERIFIED — NONE beyond the rate limiter.** There is no CAPTCHA, no honeypot field, no request-signing token, no turnstile. The only protection is:

1. The in-memory IP rate limit (3/hr, bypassable on serverless).
2. The OTP phone verification — a WhatsApp OTP must be verified before `submitLead()` is called (in the normal flow). However:
   - **VERIFIED** — `NEXT_PUBLIC_DEV_BYPASS_OTP === "true"` renders a visible "skip OTP" button (`ValuationWizard.tsx` line 1281–1289). If this env var is set in production, the OTP gate is fully disabled.
   - The OTP is a meaningful bot barrier in normal production operation.

---

## 11. Opt-out flow (STOP WhatsApp webhook)

**VERIFIED** — `app/api/webhook/green/route.ts`:

Trigger words: `STOP_RE = /^\s*(stop|הסר|הסרה|להסיר|תסיר|unsubscribe|בטל)\s*$/i`

Flow:
1. Green API sends `POST /api/webhook/green?token=<GREEN_WEBHOOK_TOKEN>` for every incoming message.
2. If the token query param doesn't match `GREEN_WEBHOOK_TOKEN` env var → 401 (when token is configured; if env var is unset, all requests pass).
3. Only `typeWebhook === "incomingMessageReceived"` is processed.
4. Sender phone is parsed from `senderData.chatId` (e.g. `9725XXXXXXXX@c.us` → `05XXXXXXXX`).
5. `getStore().optOutByPhone(phone)` is called.
6. `LocalStore.optOutByPhone`: sets `optOutAt = now`, `consentMarketing = false` on all matching phone records.
7. `SupabaseStore.optOutByPhone`: updates all matching normalized phone variants (`0...`, `972...`, `+972...`).
8. A confirmation message is sent back via WhatsApp (best-effort).

**Gap:** The opt-out only clears `consentMarketing` and sets `optOutAt`. The `consentReport` field is **not cleared**, meaning the lead record still shows they consented to receive the report. This is correct (they did consent at submission), but if the operator interprets `consentReport` as ongoing marketing permission, the distinction may be lost.

**Gap:** If `GREEN_WEBHOOK_TOKEN` is not set in `.env`, **any caller** can trigger opt-outs by POSTing to `/api/webhook/green`.

---

## 12. Can a lead be submitted without consent=true?

**VERIFIED — NO** (in server-validated code).

`app/api/lead/route.ts` lines 63–69:
```ts
const consentReport = body.consentReport ?? body.consent;
if (consentReport !== true) {
  return NextResponse.json({ error: "consent_required", ... }, { status: 422 });
}
```

The wizard also sets `consentReport` to `true` by default (`useState(true)`) and blocks OTP send if unchecked. However, since this is a client-side default of `true`, the checkbox appears pre-checked when the form loads. A user who deliberately unchecks it cannot submit (client validation + server validation both block). A raw API call without `consentReport` also fails server validation.

**Notable:** `consentMarketing` is optional (`body.consentMarketing === true`, not required). A lead CAN be saved without marketing consent.

---

## 13. Does the Google Sheets webhook contain personal data?

**VERIFIED — YES.** `lib/notify.ts` `appendToSheet` (lines 117–142) sends:

```ts
{
  createdAt, name, phone, email, address, neighborhood,
  rooms, areaSqm, estimateLow, estimateHigh, source
}
```

This payload is sent as a plain HTTP POST to the Google Apps Script `/exec` URL. The URL is stored in `GOOGLE_SHEETS_WEBHOOK` env var (not secret on the Apps Script side — anyone with the URL can POST data). **No authentication or signature on the Google side** (the `.gs` script has `Who has access: Anyone`). This means:

- Full name + phone + address stored in Google Sheets (third-party service).
- Any actor who discovers the Apps Script URL can inject arbitrary rows.
- Privacy policy mentions Google Sheets is not explicitly listed as a data processor — it names Supabase and Green API but not Google.

---

## Test Case Traces

### Normal lead
1. Rate limit passes (< 3 requests this hour from IP).
2. `name.length >= 2` ✓, `PHONE_RE.test(phone)` ✓, `consentReport === true` ✓.
3. `lead` object built with `consentAt = new Date().toISOString()`.
4. `insertLead(lead)` → appended to `leads.json`.
5. `notifyNewLead` fires async (WhatsApp alert to agent, WhatsApp report to lead, Google Sheets row).
6. Response: `{ ok: true, id: "lead_1234567890" }`.
7. Client advances to step 4.

### Missing phone
1. Rate limit passes.
2. `(body.phone || "").trim().replace(/\s/g, "")` → empty string `""`.
3. `PHONE_RE.test("")` → false → `{ error: "invalid_phone" }` 422.
4. Nothing saved, no notifications.

### Missing consent
1. `body.consentReport ?? body.consent` → `undefined ?? undefined` → `undefined`.
2. `undefined !== true` → `{ error: "consent_required" }` 422.

### Double submission (same phone)
1. Both requests pass rate limit (if within 3/hr/IP window).
2. Both pass validation independently.
3. In **LocalStore**: second call reads the file after first write — the second appends a second record. Two records with different `id` (different `Date.now()`) but same phone. **No deduplication.**
4. In **SupabaseStore**: two `INSERT` calls. Unless a DB-level unique constraint exists on `phone`, both succeed.
5. Both trigger WhatsApp notifications (two messages to agent, two to lead).

### WhatsApp down
1. DB insert succeeds → `{ ok: true }` returned to client.
2. `notifyWhatsApp` → `fetch(green-api.com)` throws / returns non-OK → `sendWhatsApp` catches and returns `false`.
3. `Promise.allSettled` swallows → `notifyNewLead` resolves normally.
4. Error logged: `console.error("notify failed", e)` — **only** if the outer `.catch` in route.ts fires (it fires on `notifyNewLead` rejection, but `notifyNewLead` never rejects due to `allSettled`). The route-level `.catch` will only fire on an unexpected synchronous throw, not on the settled promise. **Operator receives no alert.**

### Google Sheets down
1. `appendToSheet` → `fetch(webhook)` throws or returns non-OK → caught by try/catch → returns `false`.
2. `Promise.allSettled` settles with `{ status: "fulfilled", value: false }`.
3. No error propagates. Lead is saved. WhatsApp still fires. **Silent failure.**
