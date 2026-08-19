/**
 * scripts/send-alerts.ts
 * מריצים אחרי הקציר החודשי: שולח התראת "נמכרה דירה דומה" ללידים שנרשמו (alertOptIn).
 * דורש Green API מוגדר. שימוש: npx tsx scripts/send-alerts.ts  (הוסף --dry להרצה יבשה)
 */
import { getStore } from "../lib/store";
import { matchAlerts, buildAlertMessage } from "../lib/alerts";

async function main() {
  const dry = process.argv.includes("--dry");
  const store = getStore();
  const leads = await store.getLeads();
  // טוען עסקאות מכל השכונות (איחוד)
  const neighborhoods = await store.listNeighborhoods("נתניה");
  const deals = (
    await Promise.all(neighborhoods.map((n) => store.getDealsByNeighborhood(n.id, { monthsBack: 2 })))
  ).flat();

  const matches = matchAlerts(leads, deals);
  console.log(`🔔 ${matches.length} התראות מתאימות (מתוך ${leads.filter((l) => l.alertOptIn && !l.optOutAt).length} נרשמים)`);

  if (dry) {
    for (const m of matches) console.log(`— ${m.lead.phone}: ${m.deal.neighborhood} ${m.deal.dealDate} ₪${m.deal.price}`);
    console.log("(dry-run — לא נשלח דבר)");
    return;
  }

  const id = process.env.GREEN_API_ID_INSTANCE;
  const token = process.env.GREEN_API_TOKEN_INSTANCE;
  if (!id || !token) {
    console.warn("⚠️ Green API לא מוגדר — לא נשלחו התראות. (הרץ עם --dry לבדיקה)");
    return;
  }

  let sent = 0;
  for (const m of matches) {
    let chatId = m.lead.phone.replace(/[-\s]/g, "");
    if (chatId.startsWith("0")) chatId = "972" + chatId.slice(1);
    try {
      const r = await fetch(`https://api.green-api.com/waInstance${id}/sendMessage/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: `${chatId}@c.us`, message: buildAlertMessage(m) }),
      });
      if (r.ok) sent++;
      await new Promise((res) => setTimeout(res, 1200)); // קצב מנומס
    } catch (e) {
      console.error("send failed", m.lead.phone, (e as Error).message);
    }
  }
  console.log(`✅ נשלחו ${sent} התראות. (סמן lastAlertAt ב-store אם תרצה למנוע כפילות בריצה הבאה)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
