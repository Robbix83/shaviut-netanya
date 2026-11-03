import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { rateCheck, getIP } from "@/lib/rateLimit";
import { resolveAndValuate, type ValuationInput } from "@/lib/valuationService";
import { isValidHouseNumber } from "@/lib/houseNumberRule";
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
  /** מלכודת בוטים — שדה מוסתר בטופס. אדם לא ממלא אותו. */
  website?: string;
  /** קלט חישוב השווי — השרת מחשב מחדש. פלטי-שווי מהלקוח אינם נאמנים ומתעלמים מהם. */
  valuationInput?: unknown;
}

/** נייד ישראלי: 05 + 8 ספרות, אחרי הסרת מקפים ורווחים. מחזיר null אם לא תקין. */
export function normalizeMobile(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[-\s]/g, "");
  return /^05\d{8}$/.test(s) ? s : null;
}

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** ולידציית floor (עמודת int ב-DB). לא מעגלים קלט משתמש:
 *  - חסר/null → null (שדה רשות)
 *  - מספר שלם סופי → אותו ערך (כולל 0 ושליליים כמו מרתף)
 *  - ערך שסופק אך אינו שלם (שברי / NaN / Infinity / מחרוזת) → נדחה (invalid). */
export function validateFloor(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v === "number" && Number.isInteger(v)) return { ok: true, value: v };
  return { ok: false };
}

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
  const houseNumber = typeof o.houseNumber === "string" ? o.houseNumber : null;
  // אכיפת שרת עצמאית לחובת מספר בית (דירה/בית) — לא סומכים על ה-UI בלבד.
  if (!isValidHouseNumber(propertyType, houseNumber)) return null;
  return {
    neighborhoodId: o.neighborhoodId.trim(),
    propertyType,
    rooms: num(o.rooms),
    areaSqm: num(o.areaSqm),
    plotSqm: num(o.plotSqm),
    floor: num(o.floor),
    yearBuilt: num(o.yearBuilt),
    houseNumber,
    streetName: typeof o.streetName === "string" ? o.streetName : null,
    streetX: num(o.streetX),
    streetY: num(o.streetY),
  };
}

export async function POST(req: NextRequest) {
  // Rate limit: 10 leads per IP per hour — מחליף את ה-OTP כהגנה מפני לידים מזויפים
  const ip = getIP(req);
  if (!rateCheck(`lead:${ip}`, 10, 60 * 60 * 1000)) {
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

  // מלכודת בוטים: שדה מוסתר מולא → מחזירים הצלחה בלי לשמור (הבוט לא לומד שנחסם).
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const name = (body.name || "").trim();

  if (name.length < 2) {
    return NextResponse.json({ error: "invalid_name", message: "נא להזין שם מלא" }, { status: 422 });
  }
  const phone = normalizeMobile(body.phone);
  if (!phone) {
    return NextResponse.json(
      { error: "invalid_phone", message: "נא להזין מספר נייד תקין (05X-XXXXXXX)" },
      { status: 422 },
    );
  }

  // הסכמה מפורשת לקבלת הדוח — דרישת חוק הגנת הפרטיות (תיקון 13) + חוק התקשורת
  const consentReport = body.consentReport ?? body.consent;
  if (consentReport !== true) {
    return NextResponse.json(
      { error: "consent_required", message: "נדרשת הסכמה לקבלת הדוח" },
      { status: 422 },
    );
  }

  // ולידציית קומה — אין לעגל קלט משתמש. ערך שברי/לא-תקין נדחה (לא נשמר, לא null שקט).
  const floorCheck = validateFloor(body.floor);
  if (!floorCheck.ok) {
    return NextResponse.json(
      { error: "invalid_floor", message: "מספר קומה חייב להיות מספר שלם" },
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
  // הקיים בסכימה) במקום לאבד ליד מוכר. השרת לעולם לא שומר ערך מהלקוח.
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
    floor: floorCheck.value, // validated integer (or null); fractional input already rejected above
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
    const store = getStore();
    // אותו טלפון + אותה כתובת (רחוב + מספר בית) ב-24 השעות האחרונות → לא יוצרים שורה נוספת.
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
    // בדיקת הכפילות לא חוסמת: אם היא נכשלת, עדיף ליד כפול מליד אבוד.
    const existing = await store
      .findRecentLead({ phone, address: lead.address ?? null, houseNumber: lead.houseNumber ?? null }, since)
      .catch((e) => {
        console.error("[lead] dedupe lookup failed:", e instanceof Error ? e.message : "unknown");
        return null;
      });
    if (existing) return NextResponse.json({ ok: true, id: existing.id });
    saved = await store.insertLead(lead);
  } catch (e) {
    console.error("lead insert failed", e);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  // בכוונה אין כאן התראה (notifyNewLead) — הליד מופיע בלוח הניהול בלבד.
  return NextResponse.json({ ok: true, id: saved.id });
}
