/**
 * lib/otp.ts
 * OTP stateless — HMAC-SHA256 signed token (phone:code:expires|sig).
 * לא דורש DB. עובד ב-Vercel serverless (ללא state בין invocations).
 * Set OTP_SECRET in .env.local (random 32+ char string).
 */
import crypto from "crypto";
import { normalizePhone } from "./store";

const OTP_TTL_MS = 5 * 60 * 1000; // 5 דקות
const LEAD_PROOF_TTL_MS = 15 * 60 * 1000; // 15 דקות — חלון להשלמת הטופס אחרי אימות
const DEV_SECRET_FALLBACK = "dev-otp-secret-change-in-production";
export const LEAD_PROOF_PURPOSE = "lead-submit";

/**
 * סוד חתימה בצד-שרת. Fail-closed בפרודקשן:
 * אם OTP_SECRET לא מוגדר (או נשאר ברירת-המחדל הפומבית) — זורק ב-runtime בלבד
 * (לא ב-import), כדי לא לשבור `next build` בסביבות שאינן מריצות routes.
 */
function secret(): string {
  const s = process.env.OTP_SECRET;
  if (!s || s === DEV_SECRET_FALLBACK) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("OTP_SECRET is not configured (production requires a strong secret)");
    }
    return DEV_SECRET_FALLBACK;
  }
  return s;
}

/** השוואת חתימות בזמן קבוע (מונע timing attacks) */
function sigEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
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
    if (!sigEquals(sig, expected)) return { valid: false, error: "bad_sig" };
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

/* ============================================================
 * Lead-submit proof (server-enforced OTP → lead gate)
 * ------------------------------------------------------------
 * After a successful OTP verification, the server issues a short-lived,
 * HMAC-signed proof bound to the *normalized verified phone*. POST /api/lead
 * requires this proof and re-checks it server-side. The proof:
 *   - never contains the OTP code
 *   - is signed with the server-only secret (fail-closed in production)
 *   - carries purpose = LEAD_PROOF_PURPOSE and an expiry
 * It is delivered as an HttpOnly cookie; the browser never reads its value.
 * ============================================================ */

/** חותם proof לאחר אימות OTP מוצלח. הטלפון נשמר מנורמל. */
export function signLeadProof(phone: string): string {
  const p = normalizePhone(phone);
  const issued = Date.now();
  const expires = issued + LEAD_PROOF_TTL_MS;
  const payload = `${p}:${LEAD_PROOF_PURPOSE}:${issued}:${expires}`;
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("hex").slice(0, 24);
  return Buffer.from(`${payload}|${sig}`).toString("base64url");
}

/**
 * מאמת proof מול הטלפון שנשלח בבקשת הליד.
 * מחזיר valid=false עם קוד שגיאה מדויק (לשימוש פנימי/בדיקות; לא נחשף ללקוח).
 */
export function verifyLeadProof(
  token: string | undefined | null,
  phone: string,
): { valid: boolean; error?: string } {
  if (!token) return { valid: false, error: "missing" };
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
    if (!sigEquals(sig, expected)) return { valid: false, error: "bad_sig" };
    const parts = payload.split(":");
    if (parts.length < 4) return { valid: false, error: "bad_payload" };
    const proofPhone = parts[0];
    const purpose = parts[1];
    const expires = Number(parts[3]);
    if (purpose !== LEAD_PROOF_PURPOSE) return { valid: false, error: "bad_purpose" };
    if (!Number.isFinite(expires) || Date.now() > expires) return { valid: false, error: "expired" };
    if (normalizePhone(phone) !== proofPhone) return { valid: false, error: "phone_mismatch" };
    return { valid: true };
  } catch {
    return { valid: false, error: "exception" };
  }
}
