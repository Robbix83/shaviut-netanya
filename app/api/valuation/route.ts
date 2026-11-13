import { NextRequest, NextResponse, after } from "next/server";
import { resolveAndValuate, publicValuation, type ValuationInput } from "@/lib/valuationService";
import { isValidHouseNumber, isHouseNumberRequired, hasStreetName, HOUSE_NUMBER_REQUIRED_MESSAGE, STREET_REQUIRED_MESSAGE } from "@/lib/houseNumberRule";
import { buildSearchRow, logSearch, type SearchRow } from "@/lib/searchLog";

/** שומר את החיפוש אחרי שהתשובה נשלחה. מחוץ לבקשה אמיתית (בדיקות) — שומר ברקע בלי לחכות. */
function record(row: SearchRow) {
  try {
    after(() => logSearch(row));
  } catch {
    void logSearch(row);
  }
}

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: ValuationInput & { source?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  // מנהל מחובר שבודק את האתר — החיפוש נשמר כבדיקה פנימית ולא נספר
  try {
    const { auth } = await import("@/auth"); // טעינה עצלה: next-auth לא נטען בבדיקות היחידה
    if (await auth()) body.source = "internal";
  } catch {}

  // אכיפת שרת עצמאית — לא סומכים על ולידציית ה-UI בלבד.
  if (!isValidHouseNumber(body.propertyType, body.houseNumber)) {
    record(buildSearchRow(body, "house_number_required", null));
    return NextResponse.json(
      { error: "house_number_required", message: HOUSE_NUMBER_REQUIRED_MESSAGE },
      { status: 422 },
    );
  }

  // דירה/בית: בלי שם רחוב אמיתי (לפחות שתי אותיות) אין כתובת, ולא נותנים שווי לפי מספרים בלבד
  if (isHouseNumberRequired(body.propertyType) && !hasStreetName(body.streetName)) {
    record(buildSearchRow(body, "no_match", null));
    return NextResponse.json({ error: "street_required", message: STREET_REQUIRED_MESSAGE }, { status: 422 });
  }

  // asOf הוא כלי לבדיקה לאחור בלבד — לקוח לא קובע את תאריך ההערכה
  const outcome = await resolveAndValuate({ ...body, asOf: null });
  // שווי שלא נשען על עסקאות מהבניין או מהרחוב לא מוצג כ"דיוק גבוה"
  if (outcome.ok) {
    const v = outcome.valuation;
    if (v.confidence === "high" && v.compSearchScope !== "building" && v.compSearchScope !== "street") {
      outcome.valuation = { ...v, confidence: "medium" };
    }
  }

  // כל חיפוש נשמר (גם בלי השארת פרטים), אחרי שהתשובה כבר נשלחה
  record(
    outcome.ok
      ? buildSearchRow(body, "ok", outcome.valuation, outcome.neighborhoodName)
      : buildSearchRow(body, outcome.error, null),
  );

  if (!outcome.ok) {
    if (outcome.error === "no_match") {
      return NextResponse.json(
        { error: "no_match", message: "לא הצלחנו לזהות את האזור. נסו לבחור כתובת מהרשימה." },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: "insufficient_data", message: "אין מספיק עסקאות באזור זה." },
      { status: 422 },
    );
  }

  return NextResponse.json({ valuation: publicValuation(outcome.valuation) });
}
