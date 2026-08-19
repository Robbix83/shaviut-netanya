import { NextRequest, NextResponse } from "next/server";
import { resolvePoint, itmDistance } from "@/lib/govmap";
import { valuate } from "@/lib/valuation";
import { getStore } from "@/lib/store";
import type { Neighborhood } from "@/lib/types";

export const runtime = "nodejs";

interface Body {
  query?: string; // טקסט הכתובת/השכונה שנבחרה
  neighborhoodId?: string; // אם ידוע ישירות
  propertyType?: "apartment" | "house" | "land";
  rooms?: number | null;
  areaSqm?: number | null;
  plotSqm?: number | null;
  floor?: number | null;
  yearBuilt?: number | null;
  houseNumber?: string | null;
  streetName?: string | null; // שם הרחוב — לגיאוקוד מדויק כשיש מספר בית
  streetX?: number | null;
  streetY?: number | null;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const store = getStore();
  const neighborhoods = await store.listNeighborhoods("נתניה");

  // 1) זיהוי השכונה
  let neighborhoodId = body.neighborhoodId || null;
  let neighborhoodName: string | null = null;

  if (!neighborhoodId && body.query) {
    neighborhoodId = await resolveNeighborhoodId(body.query, neighborhoods);
  }
  if (neighborhoodId) {
    neighborhoodName = neighborhoods.find((n) => n.id === neighborhoodId)?.name ?? null;
  }

  if (!neighborhoodId) {
    return NextResponse.json(
      { error: "no_match", message: "לא הצלחנו לזהות את האזור. נסו לבחור כתובת מהרשימה." },
      { status: 422 },
    );
  }

  // 2) קואורדינטות: אם יש מספר בית + שם רחוב, נגאוקד את הכתובת המדויקת
  //    (רחוב ארוך כמו ויצמן — מ-10 ל-100 ייתן נקודות שונות)
  let streetX = body.streetX ?? null;
  let streetY = body.streetY ?? null;
  if (body.houseNumber && body.streetName) {
    const fullAddr = `${body.streetName} ${body.houseNumber} נתניה`;
    const precise = await resolvePoint(fullAddr);
    if (precise) { streetX = precise.x; streetY = precise.y; }
  }

  // 3) חישוב השווי
  const valuation = await valuate({
    neighborhoodId,
    neighborhood: neighborhoodName,
    propertyType: body.propertyType ?? "apartment",
    rooms: body.rooms ?? null,
    areaSqm: body.areaSqm ?? null,
    plotSqm: body.plotSqm ?? null,
    floor: body.floor ?? null,
    yearBuilt: body.yearBuilt ?? null,
    houseNumber: body.houseNumber ?? null,
    streetName: body.streetName ?? null,
    streetX,
    streetY,
  });

  if (!valuation) {
    return NextResponse.json(
      { error: "insufficient_data", message: "אין מספיק עסקאות באזור זה לחישוב אמין." },
      { status: 422 },
    );
  }

  return NextResponse.json({ valuation });
}

/** ממפה טקסט כתובת/שכונה למזהה שכונה מה-DB שלנו */
async function resolveNeighborhoodId(
  query: string,
  neighborhoods: Neighborhood[],
): Promise<string | null> {
  // א) ניסיון לפי קואורדינטות → השכונה הקרובה ביותר (מדויק)
  const pt = await resolvePoint(query);
  if (pt) {
    let best: { id: string; dist: number } | null = null;
    for (const n of neighborhoods) {
      if (n.x == null || n.y == null) continue;
      const dist = itmDistance(pt.x, pt.y, n.x, n.y);
      if (!best || dist < best.dist) best = { id: n.id, dist };
    }
    if (best) return best.id;
  }
  // ב) נפילה לאחור: התאמת שם שכונה לפי טקסט
  const cleaned = query.replace(/,?\s*נתניה\s*$/, "").trim();
  const byName = neighborhoods.find(
    (n) => n.name === cleaned || query.includes(n.name) || n.name.includes(cleaned),
  );
  return byName?.id ?? null;
}
