/**
 * GET /api/autocomplete?q=<query>
 * חיפוש רחובות בנתניה ממאגר מקומי מלא (street-index.json — כל 1,048 הרחובות הרשמיים,
 * ממופים לשכונה). מיידי, ללא תלות ב-govmap, ללא rate-limiting.
 * נופל-לאחור ל-streets.json הישן אם street-index.json לא קיים.
 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { buildCanonicalStreetMap, type StreetIndexEntry } from "@/lib/streetAliasDedup";

export const runtime = "nodejs";

type IndexedStreet = StreetIndexEntry;

let cache: IndexedStreet[] | null = null;
let canonicalMapCache: Map<string, IndexedStreet> | null = null;

async function buildIndex(): Promise<IndexedStreet[]> {
  if (cache) return cache;
  const dir = path.join(process.cwd(), "data");

  // מקור ראשי: street-index.json (כל הרחובות הרשמיים + שכונה)
  try {
    const raw = await fs.readFile(path.join(dir, "street-index.json"), "utf8");
    const arr: any[] = JSON.parse(raw);
    const idx = arr
      .filter((s) => s.street)
      .map((s) => ({
        street: String(s.street),
        code: typeof s.code === "number" ? s.code : null,
        neighborhoodId: String(s.neighborhoodId ?? ""),
        neighborhoodName: String(s.neighborhoodName ?? ""),
        x: typeof s.x === "number" ? s.x : null,
        y: typeof s.y === "number" ? s.y : null,
      }));
    if (idx.length > 0) { cache = idx; return idx; }
  } catch {}

  // fallback: streets.json (neighborhood → [streets])
  try {
    const [streetsRaw, neighRaw] = await Promise.all([
      fs.readFile(path.join(dir, "streets.json"), "utf8"),
      fs.readFile(path.join(dir, "neighborhoods.json"), "utf8"),
    ]);
    const streets: Record<string, string[]> = JSON.parse(streetsRaw);
    const neighborhoods: { id: string; name: string }[] = JSON.parse(neighRaw);
    const nameToId = new Map(neighborhoods.map((n) => [n.name, n.id]));
    const idx: IndexedStreet[] = [];
    for (const [nName, list] of Object.entries(streets)) {
      const id = nameToId.get(nName) ?? "";
      for (const street of list) idx.push({ street, code: null, neighborhoodId: id, neighborhoodName: nName, x: null, y: null });
    }
    if (idx.length > 0) cache = idx;
    return idx;
  } catch {
    return [];
  }
}

/** Alias groups (Wave 0F-1) — computed once per index build, from the index
 * itself; no separate alias database. See lib/streetAliasDedup.ts. */
function getCanonicalMap(index: IndexedStreet[]): Map<string, IndexedStreet> {
  if (canonicalMapCache) return canonicalMapCache;
  canonicalMapCache = buildCanonicalStreetMap(index);
  return canonicalMapCache;
}

/**
 * בודק אם רחוב מכיל את כל המילים של השאילתה (בכל סדר).
 * כך "אהוד מנור" מוצא "מנור אהוד" ו-"אהוד בן גרא".
 * בנוסף — חיפוש רצף רגיל (prefix/substring) לביטויים חד-מיליים.
 */
function streetMatches(street: string, q: string): boolean {
  if (street.includes(q)) return true;          // התאמה ישירה (מהירה)
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;           // מילה אחת — כבר נבדק למעלה
  return tokens.every((t) => street.includes(t)); // כל המילים קיימות, בכל סדר
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 1) return NextResponse.json({ suggestions: [] });

  const index = await buildIndex();
  const canonicalMap = getCanonicalMap(index);

  // מתאימים לפי המחרוזת הגולמית (כך שכל כינוי — למשל "ויצמן" — נשאר ניתן לחיפוש),
  // אך מציגים ומדובבים לפי הכניסה הקנונית של קבוצת הכינויים (Wave 0F-1).
  const seenCanonical = new Set<string>();
  const hits: IndexedStreet[] = [];
  for (const s of index) {
    if (!streetMatches(s.street, q)) continue;
    const canonical = canonicalMap.get(s.street) ?? s;
    if (seenCanonical.has(canonical.street)) continue;
    seenCanonical.add(canonical.street);
    hits.push(canonical);
    if (hits.length >= 12) break;
  }

  const suggestions = hits.map((s) => ({
    label: s.neighborhoodName ? `${s.street}, ${s.neighborhoodName}` : s.street,
    street: s.street,
    neighborhoodId: s.neighborhoodId,
    neighborhoodName: s.neighborhoodName,
    x: s.x,
    y: s.y,
  }));

  return NextResponse.json({ suggestions });
}
