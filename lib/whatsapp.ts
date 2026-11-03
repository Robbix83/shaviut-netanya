/**
 * קישורי wa.me — המבקר שולח מהטלפון שלו למתווך, כך שהמתווך רואה שהמספר אמיתי.
 * מספר המתווך מגיע מ-NEXT_PUBLIC_AGENT_PHONE בלבד; הקורא מעביר אותו (Next מטמיע env רק כביטוי מפורש).
 */

/** 05X-XXXXXXX / 972… / +972… → 972XXXXXXXXX. null אם חסר או לא תקין. */
export function toWaNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.replace(/[-\s+()]/g, "");
  if (s.startsWith("0")) s = "972" + s.slice(1);
  return /^972\d{8,9}$/.test(s) ? s : null;
}

/** קישור wa.me עם טקסט מוכן. null כשאין מספר תקין — ואז לא מציגים כפתור. */
export function buildWaLink(rawPhone: string | null | undefined, text: string): string | null {
  const number = toWaNumber(rawPhone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/** מס' פנייה קצר מתוך מזהה הליד — מוצג למבקר ובלוח הניהול כדי להתאים בין השניים. */
export function leadRef(id: string | null | undefined): string | null {
  if (!id) return null;
  const clean = id.replace(/[^a-zA-Z0-9]/g, "");
  return clean ? clean.slice(-6).toUpperCase() : null;
}

export interface ReportRequest {
  propertyType: "apartment" | "house" | "land";
  street: string | null;
  houseNumber: string | null;
  rooms: number | null;
  areaSqm: number | null;
  plotSqm: number | null;
  ref: string | null;
}

const PT_LABEL = { apartment: "לדירה", house: "לבית", land: "למגרש" } as const;

/** הודעה קצרה למתווך. בלי שם ובלי טלפון — וואטסאפ כבר מציג אותם. */
export function reportRequestText(r: ReportRequest): string {
  const place = [r.street?.trim(), r.houseNumber?.trim()].filter(Boolean).join(" ");
  const parts = [`היי, ביקשתי הערכת שווי ${PT_LABEL[r.propertyType]}${place ? ` ב${place}` : ""}`];
  if (r.propertyType !== "land" && r.rooms) parts.push(`${r.rooms} חד'`);
  if (r.propertyType !== "land" && r.areaSqm) parts.push(`${r.areaSqm} מ"ר`);
  if (r.propertyType !== "apartment" && r.plotSqm) parts.push(`מגרש ${r.plotSqm} מ"ר`);
  let text = parts.join(", ") + ".";
  if (r.ref) text += ` מס' פנייה: ${r.ref}`;
  return text;
}
