import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { notifyNewLead } from "@/lib/notify";
import { rateCheck, getIP } from "@/lib/rateLimit";
import { verifyLeadProof } from "@/lib/otp";
import { resolveAndValuate, type ValuationInput } from "@/lib/valuationService";
import type { Lead, Valuation } from "@/lib/types";

export const runtime = "nodejs";

interface Body {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  neighborhood?: string;
  propertyType?: "apartment" | "house" | "land";
  rooms?: number | null;
  areaSqm?: number | null;
  plotSqm?: number | null;
  floor?: number | null;
  houseNumber?: string | null;
  source?: string;
  consent?: boolean;
  sellTiming?: string;
  consentReport?: boolean;
  consentMarketing?: boolean;
  alertOptIn?: boolean;
  consentWordingVersion?: string;
  /** קלט חישוב השווי — השרת מחשב מחדש. פלטי-שווי מהלקוח אינם נאמנים ומתעלמים מהם. */
  valuationInput?: unknown;
}

const PHONE_RE = /^0\d{1,2}-?\d{7}$|^(\+?972|972)\d{8,9}$/;

/** ולידציה מינימלית של קלט השווי. neighborhoodId חובה כדי לשחזר את החישוב בצד-שרת. */
function validateValuationInput(vi: unknown): ValuationInput | null {
  if (!vi || typeof vi !== "object") return null;
  const o = vi as Record<string, unknown>;
  if (typeof o.neighborhoodId !== "string" || !o.neighborhoodId.trim()) return null;
  const num = (x: unknown): number | null =>
    typeof x === "number" && Number.isFinite(x) ? x : null;
  const pt = o.propertyType;
  const propertyType: "apartment" | "house" | "land" =
    pt === "house" || pt === "land" ? pt : "apartment";
  return {
    neighborhoodId: o.neighborhoodId.trim(),
    propertyType,
    rooms: num(o.rooms),
    areaSqm: num(o.areaSqm),
    plotSqm: num(o.plotSqm),
    floor: num(o.floor),
    yearBuilt: num(o.yearBuilt),
    houseNumber: typeof o.houseNumber === "string" ? o.houseNumber : null,
    streetName: typeof o.streetName === "string" ? o.streetName : null,
    streetX: num(o.streetX),
    streetY: num(o.streetY),
  };
}

export async function POST(req: NextRequest) {
  // Rate limit: 3 leads per IP per hour (מגן מפני לידים מזויפים)
  const ip = getIP(req);
  if (!rateCheck(`lead:${ip}`, 3, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: "rate_limit", message: "יותר מדי בקשות. נסו שוב בעוד שעה." },
      { status: 429 },
    );
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const name = (body.name || "").trim();
  const phone = (body.phone || "").trim().replace(/\s/g, "");

  if (name.length < 2) {
    return NextResponse.json({ error: "invalid_name", message: "נא להזין שם מלא" }, { status: 422 });
  }
  if (!PHONE_RE.test(phone)) {
    return NextResponse.json(
      { error: "invalid_phone", message: "מספר טלפון לא תקין" },
      { status: 422 },
    );
  }

  // אכיפת proof של אימות OTP בצד-שרת — הליד נחסם לפני DB/WhatsApp/Sheets אם אין הוכחה
  // תקפה שהטלפon הזה עבר אימות. הוכחה נשמרת ב-Cookie מסוג HttpOnly (הלקוח לא שולט בה).
  const proof = req.cookies.get("lead_proof")?.value;
  const proofResult = verifyLeadProof(proof, phone);
  if (!proofResult.valid) {
    // לא חושפים פרטי אבטחה ללקוח — קוד שגיאה יציב בלבד.
    return NextResponse.json({ error: "otp_verification_required" }, { status: 401 });
  }

  // הסכמה מפורשת לקבלת הדוח — דרישת חוק הגנת הפרטיות (תיקון 13) + חוק התקשורת
  const consentReport = body.consentReport ?? body.consent;
  if (consentReport !== true) {
    return NextResponse.json(
      { error: "consent_required", message: "נדרשת הסכמה לקבלת הדוח" },
      { status: 422 },
    );
  }

  // ולידציית קלט השווי — נדחה קלט לא-תקין לפני כל שמירה/התראה.
  const valuationInput = validateValuationInput(body.valuationInput);
  if (!valuationInput) {
    return NextResponse.json(
      { error: "invalid_valuation_input", message: "נתוני הנכס חסרים או שגויים" },
      { status: 422 },
    );
  }

  // חישוב שווי סמכותי בצד-שרת — פלטים מהלקוח אינם נאמנים ומתעלמים מהם לחלוטין.
  // אם החישוב נכשל (נתונים לא מספיקים/שגיאה): שומרים את הליד ללא אומדן (מצב בטוח
  // הקיים בסכימה) במקום לאבד ליד מוכר לאחר שכבר עבר OTP. השרת לעולם לא שומר ערך מהלקוח.
  let serverValuation: Valuation | null = null;
  try {
    const outcome = await resolveAndValuate(valuationInput);
    if (outcome.ok) {
      serverValuation = outcome.valuation;
    } else {
      console.warn(`[lead] valuation unavailable: ${outcome.error}`); // ללא PII
    }
  } catch (e) {
    console.error("[lead] valuation recompute error:", e instanceof Error ? e.message : "unknown");
    serverValuation = null;
  }

  const lead: Lead = {
    name,
    phone,
    email: body.email?.trim() || null,
    address: body.address?.trim() || null,
    // השכונה הסמכותית מגיעה מחישוב השרת; טקסט התצוגה מהלקוח משמש רק כגיבוי אם אין חישוב.
    neighborhood: serverValuation?.neighborhood ?? (body.neighborhood?.trim() || null),
    propertyType: body.propertyType ?? "apartment",
    rooms: body.rooms ?? null,
    areaSqm: body.areaSqm ?? null,
    plotSqm: body.plotSqm ?? null,
    floor: body.floor ?? null,
    houseNumber: body.houseNumber?.trim() || null,
    // אומדנים מחישוב השרת בלבד (null אם החישוב לא זמין).
    estimateLow: serverValuation?.estimateLow ?? null,
    estimateHigh: serverValuation?.estimateHigh ?? null,
    source: body.source?.trim() || null,
    consent: true,
    // מטא-דאטה של הסכמה (לתיעוד חוקי)
    sellTiming: body.sellTiming ?? null,
    consentReport: true,
    consentMarketing: body.consentMarketing === true,
    alertOptIn: body.alertOptIn === true,
    consentWordingVersion: body.consentWordingVersion ?? null,
    consentAt: new Date().toISOString(),
    optOutAt: null,
    lastAlertAt: null,
  };

  let saved: Lead;
  try {
    saved = await getStore().insertLead(lead);
  } catch (e) {
    console.error("lead insert failed", e);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  // התראות best-effort — עם חישוב השרת בלבד (לא ערכי הלקוח) — לא חוסמות את התגובה.
  notifyNewLead(saved, serverValuation).catch((e) => console.error("notify failed", e));

  // מנקים את ה-proof לאחר שימוש מוצלח — מצמצם את חלון ה-replay בדפדפן זה.
  const res = NextResponse.json({ ok: true, id: saved.id });
  res.cookies.set("lead_proof", "", { path: "/", maxAge: 0 });
  return res;
}
