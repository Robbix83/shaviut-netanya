import { NextRequest, NextResponse } from "next/server";
import { resolveAndValuate, type ValuationInput } from "@/lib/valuationService";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: ValuationInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const outcome = await resolveAndValuate(body);

  if (!outcome.ok) {
    if (outcome.error === "no_match") {
      return NextResponse.json(
        { error: "no_match", message: "לא הצלחנו לזהות את האזור. נסו לבחור כתובת מהרשימה." },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: "insufficient_data", message: "אין מספיק עסקאות באזור זה לחישוב אמין." },
      { status: 422 },
    );
  }

  return NextResponse.json({ valuation: outcome.valuation });
}
