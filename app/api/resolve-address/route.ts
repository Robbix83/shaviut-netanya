/**
 * POST /api/resolve-address
 * Body: { address?: string; street?: string; x?: number; y?: number }
 *
 * סדר עדיפויות:
 *  1. שם רחוב מפורש (street) → street-index.json (המקור הסמכותי)
 *  2. כתובת טקסט → streets.json
 *  3. x,y → density מ-deals.json, ואז centroid
 *  4. govmap fallback
 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { resolvePoint, nearestNeighborhood, itmDistance } from "@/lib/govmap";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

/** חיפוש ישיר ב-street-index.json לפי שם רחוב מדויק — המקור הסמכותי */
async function streetIndexResolve(streetName: string) {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "data", "street-index.json"), "utf8");
    const index: any[] = JSON.parse(raw);
    const hit = index.find((s) => s.street === streetName && s.neighborhoodId);
    if (hit) return { neighborhoodId: String(hit.neighborhoodId), neighborhoodName: hit.neighborhoodName ?? "" };
  } catch {}
  return null;
}

async function localResolve(address: string) {
  try {
    const [streetsRaw, neighRaw] = await Promise.all([
      fs.readFile(path.join(process.cwd(), "data", "streets.json"), "utf8"),
      fs.readFile(path.join(process.cwd(), "data", "neighborhoods.json"), "utf8"),
    ]);
    const streets: Record<string, string[]> = JSON.parse(streetsRaw);
    const neighborhoods: { id: string; name: string }[] = JSON.parse(neighRaw);
    const nameToId = new Map(neighborhoods.map((n) => [n.name, n.id]));

    const q = address.trim().toLowerCase();
    for (const [neighName, streetList] of Object.entries(streets)) {
      for (const street of streetList) {
        if (street.toLowerCase().includes(q) || q.includes(street.toLowerCase())) {
          return { neighborhoodId: nameToId.get(neighName) ?? null, neighborhoodName: neighName };
        }
      }
    }
  } catch {}
  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { address, street, x, y } = body as { address?: string; street?: string; x?: number; y?: number };

  // --- מסלול 0: שם רחוב מפורש → street-index.json (המקור הסמכותי) ---
  if (street && typeof street === "string" && street.trim().length > 1) {
    const idx = await streetIndexResolve(street.trim());
    if (idx?.neighborhoodId) {
      return NextResponse.json({ ...idx, source: "street-index" });
    }
  }

  // --- מסלול 1: X,Y מהדפדפן — מזהה שכונה לפי עסקאות קרובות (data-driven) ---
  if (typeof x === "number" && typeof y === "number") {
    const store = getStore();
    const neighborhoods = await store.listNeighborhoods("נתניה");

    // חפש את השכונה הנפוצה ביותר בין העסקאות ברדיוס 1.5ק"מ
    try {
      const allDeals = await store.getAllDeals();
      const RADIUS = 1500;
      const counts = new Map<string, number>();
      for (const d of allDeals) {
        if (d.x == null || d.y == null) continue;
        const dist = itmDistance(x, y, d.x, d.y);
        if (dist <= RADIUS) {
          counts.set(d.neighborhoodId, (counts.get(d.neighborhoodId) ?? 0) + (RADIUS - dist)); // משקל לפי קרבה
        }
      }
      if (counts.size > 0) {
        const [bestId] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
        const bestNeigh = neighborhoods.find((n) => n.id === bestId);
        if (bestNeigh) {
          return NextResponse.json({ neighborhoodId: bestNeigh.id, neighborhoodName: bestNeigh.name, source: "deals" });
        }
      }
    } catch { /* fallback לcentroid */ }

    // fallback: centroid קרוב ביותר
    const pins = neighborhoods.map((n) => ({ id: n.id, name: n.name, x: n.x ?? 0, y: n.y ?? 0 }));
    const near = nearestNeighborhood(x, y, pins, 5000);
    if (!near) return NextResponse.json({ error: "outside_netanya" }, { status: 404 });
    return NextResponse.json({ neighborhoodId: near.id, neighborhoodName: near.name, source: "coords" });
  }

  if (!address || typeof address !== "string" || address.trim().length < 2) {
    return NextResponse.json({ error: "missing_address" }, { status: 422 });
  }

  // --- מסלול 2: חיפוש לוקאלי ב-streets.json ---
  const local = await localResolve(address);
  if (local?.neighborhoodId) {
    return NextResponse.json({ ...local, source: "local" });
  }

  // --- מסלול 3: govmap server-side (fallback, עלול להיחסם) ---
  const query = address.includes("נתניה") ? address : `${address} נתניה`;
  const point = await resolvePoint(query);
  if (!point) {
    return NextResponse.json({ error: "address_not_found" }, { status: 404 });
  }
  const neighborhoods = await getStore().listNeighborhoods("נתניה");
  const pins = neighborhoods.map((n) => ({ id: n.id, name: n.name, x: n.x ?? 0, y: n.y ?? 0 }));
  const near = nearestNeighborhood(point.x, point.y, pins, 5000);
  if (!near) return NextResponse.json({ error: "outside_netanya" }, { status: 404 });
  return NextResponse.json({
    neighborhoodId: near.id, neighborhoodName: near.name,
    streetLabel: point.label, source: "govmap",
  });
}
