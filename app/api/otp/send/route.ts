import { NextRequest, NextResponse } from "next/server";
import { generateOTP, signToken } from "@/lib/otp";
import { rateCheck, getIP } from "@/lib/rateLimit";

export const runtime = "nodejs";

const PHONE_RE = /^0\d{8,9}$/;

export async function POST(req: NextRequest) {
  // Rate limit: 5 OTP requests per IP per hour (מגן מפני ספאם WhatsApp)
  const ip = getIP(req);
  if (!rateCheck(`otp:${ip}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: "rate_limit", message: "יותר מדי בקשות. נסו שוב בעוד שעה." },
      { status: 429 },
    );
  }

  let body: { phone?: string; name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const phone = (body.phone || "").replace(/[-\s]/g, "");
  if (!PHONE_RE.test(phone)) {
    return NextResponse.json({ error: "invalid_phone", message: "מספר טלפון לא תקין" }, { status: 422 });
  }

  // Rate limit נוסף: 3 OTP per phone per hour (מגן מפני ספאם למספר ספציפי)
  if (!rateCheck(`otp:phone:${phone}`, 3, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: "rate_limit", message: "שלחנו כבר מספר קודים למספר הזה. נסו שוב בעוד שעה." },
      { status: 429 },
    );
  }

  // Twilio Verify — הקוד מנוהל על-ידי Twilio, לא אנחנו
  const useTwilioVerify =
    !!(process.env.TWILIO_VERIFY_SID &&
       process.env.TWILIO_ACCOUNT_SID &&
       process.env.TWILIO_AUTH_TOKEN);

  let otp: string;
  let token: string;
  let sent: boolean;

  if (useTwilioVerify) {
    sent = await sendTwilioVerify(phone);
    otp = "VERIFY";
    token = signToken(phone, "VERIFY");
  } else {
    otp = generateOTP();
    token = signToken(phone, otp);
    sent = await sendOTP(phone, otp, body.name?.trim() || "");
  }

  const isDev = process.env.NODE_ENV !== "production";
  console.log(`[OTP] phone=${phone} provider=${useTwilioVerify ? "twilio-verify" : "sms"} sent=${sent}`);

  return NextResponse.json({
    token,
    sent,
    ...(isDev ? { devOtp: otp } : {}),
  });
}

async function sendTwilioVerify(phone: string): Promise<boolean> {
  const sid        = process.env.TWILIO_ACCOUNT_SID!;
  const authToken  = process.env.TWILIO_AUTH_TOKEN!;
  const serviceSid = process.env.TWILIO_VERIFY_SID!;
  const to = phone.startsWith("0") ? "+972" + phone.slice(1) : phone;
  try {
    const r = await fetch(
      `https://verify.twilio.com/v2/Services/${serviceSid}/Verifications`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${sid}:${authToken}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, Channel: "sms" }).toString(),
      },
    );
    if (!r.ok) console.error(`[TwilioVerify/send] status=${r.status} body=${await r.text()}`);
    return r.ok;
  } catch (e) { console.error("[TwilioVerify/send] exception:", e); return false; }
}

/** ניתוב אוטומטי: אינפורו → Twilio → Green API (WhatsApp) לפי מה שמוגדר */
async function sendOTP(phone: string, otp: string, name: string): Promise<boolean> {
  const msg = `קוד האימות לדוח שווי הדירה: ${otp}  (תקף 5 דקות)`;

  // 1. אינפורו SMS (ישראל) — INFORU_USER + INFORU_PASS
  if (process.env.INFORU_USER && process.env.INFORU_PASS) {
    return sendInforu(phone, msg);
  }

  // 2. Twilio SMS — TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    return sendTwilio(phone, msg);
  }

  // 3. Green API (WhatsApp) — GREEN_API_ID_INSTANCE + GREEN_API_TOKEN_INSTANCE
  if (process.env.GREEN_API_ID_INSTANCE && process.env.GREEN_API_TOKEN_INSTANCE) {
    return sendWhatsApp(phone, otp, name);
  }

  // לא מוגדר שום ספק — מצב פיתוח, הקוד מוחזר בלוג
  return false;
}

async function sendInforu(phone: string, msg: string): Promise<boolean> {
  // https://www.inforu.co.il/api-sms
  const xml = `<DocXml><Docdata><LoginInformation>` +
    `<Username>${process.env.INFORU_USER}</Username>` +
    `<Password>${process.env.INFORU_PASS}</Password>` +
    `</LoginInformation><MessageData>` +
    `<Message>${msg}</Message>` +
    `<PhoneNumber>${phone}</PhoneNumber>` +
    `</MessageData></DocXml>`;
  try {
    const r = await fetch(
      `https://api.inforu.co.il/SendMessageXml.ashx?InforuXML=${encodeURIComponent(xml)}`,
    );
    const text = await r.text();
    return text.includes("<Result>1</Result>") || text.includes("StatusCode>1<");
  } catch { return false; }
}

async function sendTwilio(phone: string, msg: string): Promise<boolean> {
  const sid   = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from  = process.env.TWILIO_FROM ?? ""; // מספר/שם ששרכשת ב-Twilio
  // המרת 05X → +9725X
  const to = phone.startsWith("0") ? "+972" + phone.slice(1) : phone;
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: msg }).toString(),
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error(`[Twilio] status=${r.status} body=${errText}`);
    }
    return r.ok;
  } catch (e) { console.error("[Twilio] exception:", e); return false; }
}

async function sendWhatsApp(phone: string, otp: string, name: string): Promise<boolean> {
  const id  = process.env.GREEN_API_ID_INSTANCE!;
  const tok = process.env.GREEN_API_TOKEN_INSTANCE!;
  let chatId = phone.startsWith("0") ? "972" + phone.slice(1) : phone;
  chatId += "@c.us";
  const greeting = name ? `שלום ${name}` : "שלום";
  const msg = `${greeting} 👋\n\nקוד האימות שלך:\n\n*${otp}*\n\nתקף ל-5 דקות.`;
  try {
    const r = await fetch(
      `https://api.green-api.com/waInstance${id}/sendMessage/${tok}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, message: msg }) },
    );
    return r.ok;
  } catch { return false; }
}
