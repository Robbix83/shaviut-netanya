/**
 * POST /api/dev/save-streets
 * מקבל מיפוי רחוב→שכונה שנקצר בדפדפן וכותב:
 *   data/streets.json        — { neighborhoodName: [streetNames] }  (פורמט קיים)
 *   data/street-index.json   — [{ street, neighborhoodId, neighborhoodName, x, y }]
 * פיתוח בלבד (כותב לדיסק; ב-Vercel ה-FS read-only).
 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

interface MappedStreet {
  street: string;
  neighborhoodId: string;
  neighborhoodName: string;
  x?: number;
  y?: number;
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "disabled_in_production" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const mapped: MappedStreet[] = body?.mapped ?? [];
  if (!Array.isArray(mapped) || mapped.length === 0) {
    return NextResponse.json({ error: "no_data" }, { status: 422 });
  }

  // בנה streets.json (neighborhood → [streets])
  const byNeigh: Record<string, string[]> = {};
  for (const m of mapped) {
    if (!m.neighborhoodName || !m.street) continue;
    (byNeigh[m.neighborhoodName] ||= []).push(m.street);
  }
  for (const k of Object.keys(byNeigh)) {
    byNeigh[k] = Array.from(new Set(byNeigh[k])).sort((a, b) => a.localeCompare(b, "he"));
  }

  const dir = path.join(process.cwd(), "data");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "streets.json"), JSON.stringify(byNeigh, null, 2), "utf8");
  await fs.writeFile(path.join(dir, "street-index.json"), JSON.stringify(mapped, null, 2), "utf8");

  const mappedCount = mapped.filter((m) => m.neighborhoodId).length;
  return NextResponse.json({
    ok: true,
    totalStreets: mapped.length,
    mappedToNeighborhood: mappedCount,
    unmapped: mapped.length - mappedCount,
    neighborhoods: Object.keys(byNeigh).length,
  });
}
