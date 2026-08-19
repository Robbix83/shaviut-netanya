import { NextRequest, NextResponse } from "next/server";
import { verifyToken, signLeadProof } from "@/lib/otp";

export const runtime = "nodejs";

const LEAD_PROOF_MAX_AGE = 15 * 60; // שניות — תואם ל-LEAD_PROOF_TTL_MS

/** מנפיק Cookie proof מסוג HttpOnly לאחר אימות מוצלח (הדפדפן לא קורא את הערך) */
function attachLeadProof(res: NextResponse, phone: string): NextResponse {
  res.cookies.set("lead_proof", signLeadProof(phone), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: LEAD_PROOF_MAX_AGE,
  });
  return res;
}

export async function POST(req: NextRequest) {
  let body: { token?: string; code?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ valid: false }, { status: 400 }); }

  if (!body.token || !body.code) {
    return NextResponse.json({ valid: false, message: "חסרים פרמטרים" }, { status: 400 });
  }

  const result = verifyToken(body.token, body.code);

  if (!result.valid) {
    const message =
      result.error === "expired"
        ? "הקוד פג תוקף — שלחו מחדש."
        : result.error === "wrong_code"
        ? "קוד שגוי — נסו שנית."
        : "שגיאה. נסו שנית.";
    return NextResponse.json({ valid: false, message }, { status: 422 });
  }

  // Twilio Verify — הtoken תקין אבל הקוד עצמו נבדק מול Twilio
  if (result.isTwilioVerify) {
    const ok = await checkTwilioVerify(result.phone!, body.code);
    if (!ok) return NextResponse.json({ valid: false, message: "קוד שגוי — נסו שנית." }, { status: 422 });
  }

  // אימות הצליח בכל מסלול ספק → מנפיקים proof בצד-שרת לשלב שליחת הליד
  return attachLeadProof(
    NextResponse.json({ valid: true, phone: result.phone }),
    result.phone!,
  );
}

async function checkTwilioVerify(phone: string, code: string): Promise<boolean> {
  const sid        = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SID;
  if (!sid || !authToken || !serviceSid) return false;
  const to = phone.startsWith("0") ? "+972" + phone.slice(1) : phone;
  try {
    const r = await fetch(
      `https://verify.twilio.com/v2/Services/${serviceSid}/VerificationCheck`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${sid}:${authToken}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, Code: code }).toString(),
      },
    );
    const data = await r.json();
    return data.status === "approved";
  } catch { return false; }
}
