# Privacy Implementation Audit

**Audit date:** 2026-08-19  
**Confidence legend:** VERIFIED = traced in source code · LIKELY = inferred from code · UNKNOWN = no code found

---

## 1. Is consent stored with timestamp?

**VERIFIED — YES.** `app/api/lead/route.ts` line 93:

```ts
consentAt: new Date().toISOString(),
```

The `consentAt` timestamp is set server-side at the moment the POST is processed, regardless of when the user ticked the checkbox. This is appropriate — the server timestamp is authoritative.

**Gap:** 25 out of 39 existing leads in `data/leads.json` lack a `consentAt` field. These are legacy records predating the current code. They have no verifiable consent timestamp.

---

## 2. Is consent wording versioned?

**VERIFIED — YES, at a basic level.** `components/ValuationWizard.tsx` line 755:

```ts
consentWordingVersion: "2026-06-v1",
```

The version string is a **hardcoded constant** in the component. It is sent to the server and stored verbatim in the lead record. The lead record stores both `consentWordingVersion` and `consentAt`.

**Gap:** The actual consent wording displayed at that version is not stored alongside the record — only the version identifier. If the wording at `"2026-06-v1"` is later disputed, the operator must locate the wording from git history or other records. There is no wording registry or changelog in the codebase.

**Gap:** The `consentWordingVersion` field is missing from 25/39 existing leads in `data/leads.json` (same legacy set lacking `consentAt`).

---

## 3. Can a user submit without marketing consent?

**VERIFIED — YES, by design.** `components/ValuationWizard.tsx` line 461:

```ts
const [consentMarketing, setConsentMarketing] = useState(false); // רשות: שיווק
```

The marketing consent checkbox starts **unchecked** (opt-in, not pre-selected). The consent wording reads:

> "אני מאשר/ת יצירת קשר ודיוור שיווקי בנוגע לנכס (לא חובה · ניתן להסיר בכל עת)."

The server stores `consentMarketing: body.consentMarketing === true` — defaults to `false` if not sent.

This is legally correct under Israeli spam law (amendment 40 to the Communications Law). Only `consentReport` (receiving the valuation report) is mandatory.

---

## 4. Is the opt-out flow actually wired to the webhook?

**VERIFIED — YES.** `app/api/webhook/green/route.ts` lines 51–58:

```ts
if (text && phone && STOP_RE.test(text)) {
  try {
    const removed = await getStore().optOutByPhone(phone);
    console.log(`[opt-out] ${phone} removed=${removed}`);
    void confirmOptOut(phone);
  } catch (e) {
    console.error("opt-out failed", e);
  }
}
```

The webhook:
1. Validates an optional `?token=` query param against `GREEN_WEBHOOK_TOKEN` env var.
2. Accepts `STOP`, `הסר`, `הסרה`, `להסיר`, `תסיר`, `unsubscribe`, `בטל` (case-insensitive, whitespace-trimmed).
3. Calls `optOutByPhone(phone)` which sets `optOutAt` and clears `consentMarketing`.
4. Sends a confirmation WhatsApp reply (best-effort).

**Gap:** If `GREEN_WEBHOOK_TOKEN` is not set in the environment (no `expected` value), the check at line 37 is skipped entirely:

```ts
const expected = process.env.GREEN_WEBHOOK_TOKEN;
if (expected && req.nextUrl.searchParams.get("token") !== expected) {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
```

`if (expected && ...)` — when `expected` is empty/undefined, the guard is bypassed. **Any unauthenticated caller can trigger mass opt-outs** by POSTing spoofed `incomingMessageReceived` payloads.

---

## 5. Is there a data deletion mechanism?

**VERIFIED — PARTIAL.** 

**Soft deletion (marketing opt-out):** `lib/store.ts` `optOutByPhone` exists and is callable via the WhatsApp STOP flow. It marks `optOutAt` and clears `consentMarketing` but does **not delete** the lead record.

**Hard deletion:** There is **no API endpoint, admin UI button, or script** for permanently deleting a lead record. The privacy policy (`app/privacy/page.tsx`) states:

> "באפשרותכם לבקש בכל עת לעיין במידע שנאסף עליכם, לתקנו או למחקו, בפנייה אלינו."

Deletion is promised via manual operator intervention ("פנייה אלינו") but there is no implementation. An operator would need to manually edit `leads.json` or execute a SQL DELETE in Supabase.

**Gap:** Under Israeli Privacy Protection Law amendment 13 and GDPR-equivalent frameworks, right-to-erasure requests must be fulfillable. The current system has no automated erasure path.

---

## 6. Does the admin dashboard expose phone numbers?

**VERIFIED — YES.** `app/admin/(protected)/dashboard/LeadsTable.tsx` line 182:

```ts
<td className="px-4 py-3 text-slate-600 font-mono text-xs">{lead.phone}</td>
```

Phone numbers are displayed in plain text in the leads table. Additionally:

- Line 232: A direct WhatsApp deep-link is rendered for each lead: `https://wa.me/972${lead.phone.replace(/^0/, "")}`.
- Names, addresses, neighborhoods, valuation estimates, and `source` are all visible.

The dashboard is protected by `auth()` check in `app/api/admin/leads/route.ts` (line 8) and the `(protected)` layout group, so only authenticated admins can access it.

**LIKELY** — The auth mechanism (`@/auth`) is not audited here. Its strength determines whether the PII exposure in the dashboard is adequately protected.

---

## 7. Are there any logs that might contain PII?

**VERIFIED — YES, several locations.**

**Route-level logs:**

1. `app/api/lead/route.ts` line 102:
   ```ts
   console.error("lead insert failed", e);
   ```
   The `e` object from a DB failure may include the serialized lead payload if the ORM/driver echoes it back. Depends on the Supabase client error format.

2. `app/api/lead/route.ts` line 107:
   ```ts
   notifyNewLead(saved, body.valuation).catch((e) => console.error("notify failed", e));
   ```
   The `saved` lead object (name, phone, address) is in scope here. If the logger captures the full call stack with context, PII could appear in server logs.

3. `app/api/webhook/green/route.ts` line 55:
   ```ts
   console.log(`[opt-out] ${phone} removed=${removed}`);
   ```
   **VERIFIED** — Phone number is logged in plain text for every opt-out event.

4. `app/api/webhook/green/route.ts` line 56:
   ```ts
   console.error("opt-out failed", e);
   ```

5. `lib/notify.ts` `buildLeadMessage` (lines 21–39): The WhatsApp notification text includes `lead.name`, `lead.phone`, `lead.address`. This text is passed to `fetch` as a request body — it may appear in network-level logs or any HTTP debugging middleware.

**On Vercel:** `console.log`/`console.error` output appears in the Vercel dashboard's Function Logs, which are retained for a limited period. Phone numbers appearing in `[opt-out]` logs are accessible to anyone with dashboard access.

---

## 8. Privacy Policy completeness check

**VERIFIED** — `app/privacy/page.tsx` covers:
- What data is collected (name, phone, optionally email + property details).
- Purpose (sending valuation report, agent contact, marketing with separate consent).
- Data processors named: Green API/WhatsApp, Supabase.
- Opt-out mechanism described (STOP reply).
- Rights (access, correction, deletion) referenced.

**Gap:** Google (Google Sheets via Apps Script) is not listed as a data processor even though lead PII (name, phone, address) is sent there via `appendToSheet`.

**Gap:** The privacy policy says "updated June 2026" but does not provide a contact email or specific contact channel for privacy requests — only "פרטי הקשר המופיעים באתר", but no such contact details appear anywhere on the page or in the footer.

---

## Summary Table

| Privacy Check | Status | Notes |
|---|---|---|
| Consent stored with timestamp | VERIFIED | `consentAt` set server-side; missing from 25 legacy leads |
| Consent wording versioned | VERIFIED | Hardcoded `"2026-06-v1"`; wording not archived in code |
| Can submit without marketing consent | VERIFIED — YES (by design) | Separate opt-in checkbox, unchecked by default |
| Opt-out webhook wired | VERIFIED | STOP → `optOutByPhone`; webhook token guard bypassable if env var unset |
| Data deletion mechanism | PARTIAL | Soft opt-out only; no hard delete API or UI |
| Admin dashboard exposes phones | VERIFIED | Plain text display + wa.me links; behind auth |
| Logs contain PII | VERIFIED | Phone number in `[opt-out]` logs; potential PII in error logs |
| Privacy policy names all processors | GAP | Google Sheets not listed |
| Contact channel for privacy requests | GAP | Undefined in policy text |
