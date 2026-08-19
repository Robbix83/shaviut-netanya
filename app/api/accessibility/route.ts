/**
 * GET /api/accessibility?address=...&neighborhoodId=...&neighborhood=...
 *
 * מחזיר ציון נגישות ומרחקים לתחנת רכבת/אוטובוס/בי"ס/פארק לכתובת הליד,
 * + כתובת iframe של govmap למפה ממוזערת.
 *
 * דיוק:
 *  - אם יש כתובת מלאה → resolvePoint (govmap) לנקודה מדויקת (precise).
 *  - אחרת → מרכז השכונה (approximate=true) — מסומן בבירור בממשק, ללא המצאות.
 *
 * המקור לנקודות-העניין: data/poi.json (נאסף ע"י npm run fetch:poi).
 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { resolvePoint, computeAccessibility, govmapEmbedUrl } from "@/lib/govmap";
import type { Poi } from "@/lib/govmap";

export const runtime = "nodejs";

let _pois: Poi[] | null = null;
async function loadPois(): Promise<Poi[]> {
  if (_pois !== null) return _pois;
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "data", "poi.json"), "utf8");
    _pois = JSON.parse(raw) as Poi[];
  } catch {
    _pois = [];
  }
  return _pois;
}

async function neighborhoodCentroid(
  id: string | null,
  name: string | null,
): Promise<{ x: number; y: number; name: string } | null> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "data", "neighborhoods.json"), "utf8");
    const list = JSON.parse(raw) as { id: string; name: string; x: number | null; y: number | null }[];
    const hit =
      (id && list.find((n) => n.id === id)) ||
      (name && list.find((n) => n.name === name || n.name.includes(name) || name.includes(n.name)));
    if (hit && hit.x != null && hit.y != null) return { x: hit.x, y: hit.y, name: hit.name };
  } catch {}
  return null;
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const address = p.get("address")?.trim() || null;
  const neighborhoodId = p.get("neighborhoodId") || null;
  const neighborhood = p.get("neighborhood") || null;
  const qx = p.get("x") ? Number(p.get("x")) : null;
  const qy = p.get("y") ? Number(p.get("y")) : null;

  const pois = await loadPois();
  if (pois.length === 0) {
    return NextResponse.json({ error: "no_poi_data" }, { status: 503 });
  }

  // --- נקודה מדויקת מהכתובת ---
  let point: { x: number; y: number } | null = null;
  let approximate = false;
  let locationLabel: string | null = null;

  // קואורדינטות ישירות — הכי מדויק, ללא resolvePoint
  if (qx && qy) {
    point = { x: qx, y: qy };
    locationLabel = address || neighborhood || null;
  } else if (address) {
    const query = address.includes("נתניה") ? address : `${address} נתניה`;
    const resolved = await resolvePoint(query);
    if (resolved) {
      point = { x: resolved.x, y: resolved.y };
      locationLabel = resolved.label;
    }
  }

  // --- fallback: מרכז השכונה (מסומן כמשוער) ---
  if (!point) {
    const centroid = await neighborhoodCentroid(neighborhoodId, neighborhood);
    if (centroid) {
      point = { x: centroid.x, y: centroid.y };
      approximate = true;
      locationLabel = centroid.name;
    }
  }

  if (!point) {
    return NextResponse.json({ error: "no_location" }, { status: 404 });
  }

  const accessibility = computeAccessibility(point.x, point.y, pois);
  return NextResponse.json({
    accessibility,
    approximate,
    locationLabel,
    embedUrl: govmapEmbedUrl(point.x, point.y),
  });
}
