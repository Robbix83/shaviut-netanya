/**
 * lib/otp.ts
 * OTP stateless — HMAC-SHA256 signed token (phone:code:expires|sig).
 * לא דורש DB. עובד ב-Vercel serverless (ללא state בין invocations).
 * Set OTP_SECRET in .env.local (random 32+ char string).
 */
import crypto from "crypto";

const OTP_TTL_MS = 5 * 60 * 1000; // 5 דקות
function secret() {
  return process.env.OTP_SECRET || "dev-otp-secret-change-in-production";
}

/** מייצר קוד 6 ספרות */
export function generateOTP(): string {
  return String(100000 + (crypto.randomInt(900000)));
}

/** חותם token עבור phone+otp עם פקיעה */
export function signToken(phone: string, otp: string): string {
  const expires = Date.now() + OTP_TTL_MS;
  const payload = `${phone}:${otp}:${expires}`;
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("hex").slice(0, 24);
  return Buffer.from(`${payload}|${sig}`).toString("base64url");
}

/** מוודא token + קוד שהמשתמש הזין.
 *  כאשר הtoken נחתם עם otp="VERIFY" (Twilio Verify), הפונקציה מחזירה isTwilioVerify=true
 *  והbody של verify/route.ts אחראי על הבדיקה מול Twilio. */
export function verifyToken(
  token: string,
  inputCode: string,
): { valid: boolean; phone?: string; error?: string; isTwilioVerify?: boolean } {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const pipe = decoded.lastIndexOf("|");
    if (pipe < 0) return { valid: false, error: "bad_token" };
    const payload = decoded.slice(0, pipe);
    const sig = decoded.slice(pipe + 1);
    const expected = crypto
      .createHmac("sha256", secret())
      .update(payload)
      .digest("hex")
      .slice(0, 24);
    if (sig !== expected) return { valid: false, error: "bad_sig" };
    const parts = payload.split(":");
    if (parts.length < 3) return { valid: false, error: "bad_payload" };
    const phone = parts[0];
    const otp = parts[1];
    const expires = Number(parts[2]);
    if (Date.now() > expires) return { valid: false, error: "expired" };
    if (otp === "VERIFY") return { valid: true, phone, isTwilioVerify: true };
    if (otp !== inputCode.trim()) return { valid: false, error: "wrong_code" };
    return { valid: true, phone };
  } catch {
    return { valid: false, error: "exception" };
  }
}
