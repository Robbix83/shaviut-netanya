/**
 * GET /api/cbs?neighborhood=...
 * מחזיר פרופיל חברתי-כלכלי לפי שכונה (מפקד 2022, למ"ס).
 */
import { NextRequest, NextResponse } from "next/server";
import { getNeighborhoodProfile } from "@/lib/cbs";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const neighborhood = req.nextUrl.searchParams.get("neighborhood") ?? null;
  const profile = await getNeighborhoodProfile(neighborhood);
  if (!profile) {
    return NextResponse.json({ error: "אין נתוני למ\"ס זמינים" }, { status: 503 });
  }
  return NextResponse.json({ profile });
}
