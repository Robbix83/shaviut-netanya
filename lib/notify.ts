import type { Lead, Valuation } from "./types";

/**
 * התראות על ליד חדש:
 *  1) הודעת WhatsApp מיידית אליך (Green API)
 *  2) הוספת שורה לגיליון Google (דרך Apps Script Web App — חינמי ופשוט)
 * שתיהן best-effort: כישלון באחת לא מפיל את קליטת הליד.
 */

function fmtNis(n: number | null | undefined): string {
  if (!n) return "—";
  return "₪" + n.toLocaleString("he-IL");
}

const TIMING_LABEL: Record<string, string> = {
  now: "🔥 חם — שוקל למכור בקרוב (עד 3 ח׳)",
  year: "🟡 בשנה הקרובה",
  curious: "⚪ בודק שווי בלבד",
};

export function buildLeadMessage(lead: Lead, v?: Valuation | null): string {
  const hot = lead.sellTiming === "now";
  const lines = [
    hot ? "🔥🔥 *ליד חם — שווי דירה נתניה*" : "🔔 *ליד חדש — שווי דירה נתניה*",
    lead.sellTiming ? TIMING_LABEL[lead.sellTiming] ?? null : null,
    `👤 ${lead.name}`,
    `📞 ${lead.phone}`,
    lead.address ? `📍 ${lead.address}` : null,
    lead.neighborhood ? `🏘️ ${lead.neighborhood}` : null,
    lead.rooms || lead.areaSqm
      ? `🏠 ${lead.rooms ?? "?"} חד' · ${lead.areaSqm ?? "?"} מ"ר`
      : null,
    v && v.estimateLow
      ? `💰 אומדן: ${fmtNis(v.estimateLow)}–${fmtNis(v.estimateHigh)}`
      : "⚠️ שווי לא חושב אוטומטית — נדרשת בדיקה ידנית",
    lead.consentMarketing ? "✅ אישר דיוור שיווקי" : "⚠️ ללא הסכמת דיוור (דוח בלבד)",
    lead.source ? `📊 מקור: ${lead.source}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

/** המרת טלפון ישראלי (05XXXXXXXX) ל-chatId של Green API (9725XXXXXXXX@c.us) */
export function phoneToChatId(phone: string): string {
  let p = phone.replace(/[-\s]/g, "");
  if (p.startsWith("0")) p = "972" + p.slice(1);
  else if (p.startsWith("+")) p = p.slice(1);
  return `${p}@c.us`;
}

/** שליחת הודעת WhatsApp לכל chatId דרך Green API */
async function sendWhatsApp(chatId: string, text: string): Promise<boolean> {
  const id = process.env.GREEN_API_ID_INSTANCE;
  const token = process.env.GREEN_API_TOKEN_INSTANCE;
  if (!id || !token) return false;
  try {
    const url = `https://api.green-api.com/waInstance${id}/sendMessage/${token}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, message: text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** התראה אליך (הסוכן) */
export async function notifyWhatsApp(text: string): Promise<boolean> {
  const to = process.env.LEAD_NOTIFY_WHATSAPP;
  if (!to) return false;
  return sendWhatsApp(`${to}@c.us`, text);
}

/** הדוח שנשלח ללקוח עצמו ב-WhatsApp */
export function buildReportMessage(lead: Lead, v?: Valuation | null): string {
  // Option B (Wave 0A-2/0A-3): if server valuation is unavailable, represent the lead
  // honestly ("preparing manually") instead of claiming a report that has no numbers.
  const hasValuation = !!(v && v.estimateLow);
  const lines = [
    hasValuation
      ? `שלום ${lead.name}, הנה דוח השווי שביקשת 🏠`
      : `שלום ${lead.name}, קיבלנו את בקשתך לדוח השווי 🏠`,
    lead.neighborhood ? `📍 ${lead.neighborhood}, נתניה` : null,
    lead.rooms || lead.areaSqm ? `🏠 ${lead.rooms ?? "?"} חד' · ${lead.areaSqm ?? "?"} מ"ר` : null,
    "",
    hasValuation
      ? `💰 טווח שווי משוער:\n${fmtNis(v!.estimateLow)} – ${fmtNis(v!.estimateHigh)}`
      : null,
    hasValuation
      ? `📊 ≈ ${fmtNis(v!.pricePerSqmMid)} למ"ר · מבוסס על ${v!.basedOnDeals} עסקאות אמיתיות באזור`
      : null,
    !hasValuation
      ? "אנחנו מכינים עבורך אינדיקציית שווי מותאמת ונחזור אליך בהקדם עם הנתונים."
      : null,
    "",
    hasValuation && v!.comparableDeals.length
      ? "עסקאות שנמכרו לאחרונה באזורך:\n" +
        v!.comparableDeals
          .slice(0, 4)
          .map((c) => `• ${c.street ?? ""} ${c.rooms ?? "?"} חד' ${c.areaSqm ?? "?"} מ"ר — ${fmtNis(c.price)}`)
          .join("\n")
      : null,
    "",
    "אחזור אליך בהקדם עם סקירה מותאמת אישית. נשמח לעמוד לרשותך!",
    "",
    `— ${agentName()}, מתווך מורשה${agentLicense() ? ` (רישיון ${agentLicense()})` : ""}`,
    "* אינדיקציית מחיר לפי עסקאות פומביות (רשות המסים) — אינה הערכת שמאי.",
    "להסרה מרשימת הדיוור השב/י STOP.",
  ].filter((l) => l !== null);
  return lines.join("\n");
}

function agentName(): string {
  return process.env.NEXT_PUBLIC_AGENT_NAME || process.env.AGENT_NAME || "המתווך";
}
function agentLicense(): string {
  return process.env.NEXT_PUBLIC_AGENT_LICENSE || process.env.AGENT_LICENSE || "";
}

/** שליחת הדוח ללקוח (best-effort) */
export async function sendReportToLead(lead: Lead, v?: Valuation | null): Promise<boolean> {
  if (!process.env.GREEN_API_ID_INSTANCE) return false;
  return sendWhatsApp(phoneToChatId(lead.phone), buildReportMessage(lead, v));
}

export async function appendToSheet(lead: Lead, v?: Valuation | null): Promise<boolean> {
  const webhook = process.env.GOOGLE_SHEETS_WEBHOOK;
  if (!webhook) return false;
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        createdAt: lead.createdAt ?? new Date().toISOString(),
        name: lead.name,
        phone: lead.phone,
        email: lead.email ?? "",
        address: lead.address ?? "",
        neighborhood: lead.neighborhood ?? "",
        rooms: lead.rooms ?? "",
        areaSqm: lead.areaSqm ?? "",
        estimateLow: v?.estimateLow ?? lead.estimateLow ?? "",
        estimateHigh: v?.estimateHigh ?? lead.estimateHigh ?? "",
        source: lead.source ?? "",
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function notifyNewLead(lead: Lead, v?: Valuation | null): Promise<void> {
  const msg = buildLeadMessage(lead, v);
  await Promise.allSettled([
    notifyWhatsApp(msg), // התראה אליך (הסוכן)
    sendReportToLead(lead, v), // הדוח אל הלקוח
    appendToSheet(lead, v), // שמירה בגיליון
  ]);
}
