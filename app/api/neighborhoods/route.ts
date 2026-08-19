import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const list = await getStore().listNeighborhoods("נתניה");
  // מחזירים רק שם ומזהה למיון נוח בצד הלקוח
  // מחזירים גם קואורדינטות ITM — נדרש ל-client-side address resolution
  const neighborhoods = list
    .map((n) => ({ id: n.id, name: n.name, x: n.x, y: n.y }))
    .sort((a, b) => a.name.localeCompare(b.name, "he"));
  // נתונים סטטיים — cache ל-24 שעות בדפדפן, stale-while-revalidate
  return NextResponse.json({ neighborhoods }, {
    headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600" },
  });
}
