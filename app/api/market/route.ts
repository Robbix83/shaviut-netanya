import { NextRequest, NextResponse } from "next/server";
import { analyzeLeadMarket, getNeighborhoodStats } from "@/lib/marketData";
import type { Lead } from "@/lib/types";

export const runtime = "nodejs";

/** GET /api/market?neighborhoodId=X&rooms=Y&areaSqm=Z&estimateLow=A&estimateHigh=B&propertyType=apartment */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  // מצב 1: stats כלל-שכונות
  if (p.get("scope") === "neighborhoods") {
    const stats = await getNeighborhoodStats();
    return NextResponse.json({ stats });
  }

  // מצב 2: ניתוח ליד ספציפי
  const lead: Partial<Lead> & { neighborhoodId?: string } = {
    neighborhoodId:  p.get("neighborhoodId") ?? undefined,
    neighborhood:    p.get("neighborhood") ?? null,
    propertyType:    (p.get("propertyType") as any) ?? "apartment",
    rooms:           p.get("rooms") ? Number(p.get("rooms")) : null,
    areaSqm:         p.get("areaSqm") ? Number(p.get("areaSqm")) : null,
    plotSqm:         p.get("plotSqm") ? Number(p.get("plotSqm")) : null,
    estimateLow:     p.get("estimateLow") ? Number(p.get("estimateLow")) : null,
    estimateHigh:    p.get("estimateHigh") ? Number(p.get("estimateHigh")) : null,
    name: "", phone: "", address: null, consent: false,
  };

  const analysis = await analyzeLeadMarket(
    lead as Lead,
    p.get("streetName") ?? null,
    p.get("houseNumber") ?? null,
  );
  if (!analysis) return NextResponse.json({ error: "אין מספיק נתונים לשכונה זו" }, { status: 404 });
  return NextResponse.json({ analysis });
}
