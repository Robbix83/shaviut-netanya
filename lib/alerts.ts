/**
 * lib/alerts.ts
 * התאמת עסקאות חדשות ללידים שנרשמו להתראות ("עדכנו אותי כשתימכר דירה דומה").
 * מריצים אחרי הקציר החודשי (scripts/send-alerts.ts) — לא בזמן בקשה.
 */
import type { Deal, Lead } from "./types";

export interface AlertMatch {
  lead: Lead;
  deal: Deal;
}

/**
 * מוצא ללידים שנרשמו (alertOptIn) עסקה דומה *חדשה* באזורם:
 * אותה שכונה, אותו סוג נכס, חדרים ±1, שנמכרה ב-recentDays האחרונים,
 * ושעדיין לא נשלחה עליה התראה (lastAlertAt ישן מתאריך העסקה).
 */
export function matchAlerts(
  leads: Lead[],
  deals: Deal[],
  opts: { recentDays?: number; asOf?: Date } = {},
): AlertMatch[] {
  const recentDays = opts.recentDays ?? 35;
  const now = opts.asOf ?? new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - recentDays);
  const cutoffISO = cutoff.toISOString().slice(0, 10);

  const out: AlertMatch[] = [];
  for (const lead of leads) {
    if (!lead.alertOptIn || lead.optOutAt) continue;
    const lpt = lead.propertyType ?? "apartment";
    // עסקאות מתאימות, עדכניות, ממוינות לפי תאריך יורד
    const candidates = deals
      .filter((d) => d.neighborhood && lead.neighborhood && d.neighborhood === lead.neighborhood)
      .filter((d) => (d.propertyType ?? "apartment") === lpt)
      .filter((d) => d.dealDate >= cutoffISO)
      .filter((d) => {
        if (lpt === "land" || lead.rooms == null || d.rooms == null) return true;
        return Math.abs(d.rooms - lead.rooms) <= 1;
      })
      .sort((a, b) => (a.dealDate < b.dealDate ? 1 : -1));
    const newest = candidates[0];
    if (!newest) continue;
    // אל תשלח אם כבר התרענו אחרי תאריך העסקה הזו
    if (lead.lastAlertAt && lead.lastAlertAt.slice(0, 10) >= newest.dealDate) continue;
    out.push({ lead, deal: newest });
  }
  return out;
}

/** הודעת WhatsApp של התראת עסקה דומה */
export function buildAlertMessage(m: AlertMatch): string {
  const d = m.deal;
  const price = "₪" + Math.round(d.price).toLocaleString("he-IL");
  const desc =
    d.propertyType === "land"
      ? `מגרש ${d.plotSqm ?? "?"} מ"ר`
      : `${d.rooms ?? "?"} חד' · ${d.areaSqm ?? "?"} מ"ר`;
  return [
    `שלום ${m.lead.name} 👋`,
    `נמכרה דירה דומה ב${d.neighborhood}:`,
    `${d.street ? d.street + " · " : ""}${desc} — ${price}`,
    "",
    "רוצה לדעת איך זה משפיע על שווי הנכס שלך? אשמח לעדכן.",
    "להסרה מההתראות השב/י STOP.",
  ].join("\n");
}
