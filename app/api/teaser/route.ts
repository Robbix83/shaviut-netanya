/**
 * GET /api/teaser?neighborhood=...&x=...&y=...
 * מחזיר 3 אותות "נעולים" לתצוגת teaser בשלב 3 של ה-wizard:
 * CBS (מקובץ מקומי), MAVAT (live), נגישות (אם poi.json קיים).
 * מיועד להיות מהיר — CBS/poi מקבצים, MAVAT אסינכרוני עם timeout.
 */
import { NextRequest, NextResponse } from "next/server";
import { getNeighborhoodProfile }    from "@/lib/cbs";
import { fetchMavatData }            from "@/lib/mavat";
import { resolvePoint, computeAccessibility } from "@/lib/govmap";
import { promises as fs }            from "fs";
import path                          from "path";
import type { Poi }                  from "@/lib/govmap";

export const runtime = "nodejs";

let _pois: Poi[] | null = null;
async function loadPois(): Promise<Poi[]> {
  if (_pois !== null) return _pois;
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "data", "poi.json"), "utf8");
    _pois = JSON.parse(raw);
  } catch { _pois = []; }
  return _pois!;
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const neighborhood = p.get("neighborhood") ?? null;
  const x = p.get("x") ? Number(p.get("x")) : null;
  const y = p.get("y") ? Number(p.get("y")) : null;

  // ── 1. CBS — מקובץ מקומי, תמיד מהיר ──
  const cbsPromise = getNeighborhoodProfile(neighborhood).catch(() => null);

  // ── 2. MAVAT — live, עם fallback null ──
  let mavatPromise: Promise<{ upside: boolean; demolition: boolean } | null> =
    Promise.resolve(null);

  let ptX = x, ptY = y;

  if (!ptX || !ptY) {
    // resolve from neighborhood center via govmap if no coords
    if (neighborhood) {
      try {
        const store = (await import("@/lib/store")).getStore();
        const nbs = await store.listNeighborhoods("נתניה");
        const nb = nbs.find((n) => n.name === neighborhood);
        if (nb?.x && nb?.y) { ptX = nb.x; ptY = nb.y; }
      } catch { /* ignore */ }
    }
  }

  if (!ptX || !ptY && neighborhood) {
    // last resort: govmap resolve
    try {
      const pt = await resolvePoint(`${neighborhood} נתניה`);
      if (pt) { ptX = pt.x; ptY = pt.y; }
    } catch { /* ignore */ }
  }

  if (ptX && ptY) {
    mavatPromise = fetchMavatData(ptX, ptY)
      .then((d) => d ? { upside: d.potentialValueIncrease, demolition: d.hasDemolition } : null)
      .catch(() => null);
  }

  // ── 3. נגישות — מקובץ poi.json ──
  const accessPromise = (async () => {
    if (!ptX || !ptY) return null;
    const pois = await loadPois();
    if (!pois.length) return null;
    return computeAccessibility(ptX, ptY, pois);
  })();

  const [cbs, mavat, access] = await Promise.all([cbsPromise, mavatPromise, accessPromise]);

  return NextResponse.json({ cbs, mavat, access });
}
