/**
 * POST /api/webhook/green
 * Webhook ל-Green API להודעות נכנסות. אם הליד שולח "STOP"/"הסר"/"הסרה" →
 * מסמנים אותו כמוסר מדיוור (optOutAt) — דרישת חוק הספאם (תיקון 40).
 * הגדרה: ב-Green API → Settings → webhookUrl = https://<domain>/api/webhook/green,
 * והפעלת incomingWebhook. אבטחה: אסימון משותף ב-?token= (GREEN_WEBHOOK_TOKEN).
 */
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { phoneToChatId } from "@/lib/notify";
import { isWebhookAuthorized } from "@/lib/config";

export const runtime = "nodejs";

// מילות הסרה מקובלות
const STOP_RE = /^\s*(stop|הסר|הסרה|להסיר|תסיר|unsubscribe|בטל)\s*$/i;

function extractText(body: any): string | null {
  const md = body?.messageData;
  return (
    md?.textMessageData?.textMessage ??
    md?.extendedTextMessageData?.text ??
    body?.text ??
    null
  );
}
function extractSender(body: any): string | null {
  // chatId כמו "9725XXXXXXXX@c.us" → טלפון
  const chatId = body?.senderData?.chatId ?? body?.senderData?.sender ?? null;
  if (!chatId) return null;
  const digits = String(chatId).split("@")[0].replace(/\D/g, "");
  return digits.startsWith("972") ? "0" + digits.slice(3) : digits;
}

export async function POST(req: NextRequest) {
  // אימות אסימון — כשל-סגור בפרודקשן: אם GREEN_WEBHOOK_TOKEN לא מוגדר בפרודקשן, נדחה.
  const authorized = isWebhookAuthorized({
    expected: process.env.GREEN_WEBHOOK_TOKEN,
    provided: req.nextUrl.searchParams.get("token"),
    isProduction: process.env.NODE_ENV === "production",
  });
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: true }); }

  // מעניין רק הודעות נכנסות
  if (body?.typeWebhook !== "incomingMessageReceived") {
    return NextResponse.json({ ok: true });
  }

  const text = extractText(body);
  const phone = extractSender(body);
  if (text && phone && STOP_RE.test(text)) {
    try {
      const removed = await getStore().optOutByPhone(phone);
      console.log(`[opt-out] ${phone} removed=${removed}`);
      // אישור הסרה ללקוח (best-effort) — מותר/מומלץ לשלוח אישור הסרה
      void confirmOptOut(phone);
    } catch (e) {
      console.error("opt-out failed", e);
    }
  }
  return NextResponse.json({ ok: true });
}

async function confirmOptOut(phone: string) {
  const id = process.env.GREEN_API_ID_INSTANCE;
  const token = process.env.GREEN_API_TOKEN_INSTANCE;
  if (!id || !token) return;
  try {
    await fetch(`https://api.green-api.com/waInstance${id}/sendMessage/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: phoneToChatId(phone),
        message: "הוסרת מרשימת הדיוור ולא תקבל/י הודעות נוספות. תודה.",
      }),
    });
  } catch {
    /* ignore */
  }
}
