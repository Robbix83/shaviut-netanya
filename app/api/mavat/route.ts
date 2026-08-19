import { NextRequest, NextResponse } from "next/server";
import { fetchMavatData } from "@/lib/mavat";
import { resolvePoint } from "@/lib/govmap";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

/**
 * GET /api/mavat?address=...&neighborhood=...
 * GET /api/mavat?x=187799&y=693538
 * מחזיר נתוני MAVAT לכתובת/קואורדינטות.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  let x = p.get("x") ? Number(p.get("x")) : null;
  let y = p.get("y") ? Number(p.get("y")) : null;

  // אם אין קואורדינטות — נפתור מהכתובת
  if ((!x || !y) && p.get("address")) {
    const pt = await resolvePoint(p.get("address")!);
    if (pt) { x = pt.x; y = pt.y; }
  }

  // fallback: מרכז השכונה
  if ((!x || !y) && p.get("neighborhood")) {
    const neighborhoods = await getStore().listNeighborhoods("נתניה");
    const n = neighborhoods.find((nb) => nb.name === p.get("neighborhood"));
    if (n?.x && n?.y) { x = n.x; y = n.y; }
  }

  if (!x || !y) {
    return NextResponse.json({ error: "לא ניתן לפתור כתובת" }, { status: 400 });
  }

  const data = await fetchMavatData(x, y);
  if (!data) return NextResponse.json({ error: "אין נתוני תכנון באזור זה" }, { status: 404 });

  return NextResponse.json({ data });
}
