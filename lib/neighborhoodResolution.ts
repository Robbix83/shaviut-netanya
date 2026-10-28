/**
 * lib/neighborhoodResolution.ts
 * Which neighbourhood of the ACTIVE dataset an address belongs to.
 *
 * The wizard sends the neighbourhood id it got from data/street-index.json. That file carries the
 * V1 ids; the V2 dataset numbers its neighbourhoods differently (zero overlap), so on V2 the id
 * matched nothing and every search fell to the city-wide fallback (docs/VALUATION_ENGINE_CURRENT_STATE.md §2.1).
 * The server therefore keeps the client's id only when the active dataset knows it, and otherwise
 * derives the id from the dataset's own deals on that street.
 */
import { itmDistance } from "./govmap";
import type { Store } from "./store";
import type { Deal } from "./types";

export interface NeighborhoodHint {
  neighborhoodId?: string | null;
  streetName?: string | null;
  houseNumber?: string | null;
  streetX?: number | null;
  streetY?: number | null;
  asOf?: string | null;
}

export type ResolutionSource = "client" | "building" | "street_nearest" | "street_majority" | "none";

/** The most frequent neighbourhood among `deals` (ties: the one seen first). */
function majority(deals: Deal[], known: Set<string>): string | null {
  const counts = new Map<string, number>();
  for (const d of deals) if (known.has(d.neighborhoodId)) counts.set(d.neighborhoodId, (counts.get(d.neighborhoodId) ?? 0) + 1);
  let best: string | null = null, n = 0;
  for (const [id, c] of counts) if (c > n) { best = id; n = c; }
  return best;
}

export async function resolveDatasetNeighborhood(
  hint: NeighborhoodHint,
  knownIds: Set<string>,
  store: Store,
): Promise<{ id: string | null; source: ResolutionSource }> {
  // רשימת שכונות ריקה = תקלת הגדרה, לא "שום מזהה לא תקף": סומכים על הלקוח כמו קודם
  if (hint.neighborhoodId && (knownIds.size === 0 || knownIds.has(hint.neighborhoodId))) {
    return { id: hint.neighborhoodId, source: "client" };
  }
  if (!hint.streetName) return { id: null, source: "none" };

  const onStreet = (await store.getDealsByStreet(hint.streetName, { asOf: hint.asOf })).filter((d) => knownIds.has(d.neighborhoodId));
  if (!onStreet.length) return { id: null, source: "none" };

  // 1) same building number on that street
  const hn = parseInt(hint.houseNumber ?? "");
  if (!isNaN(hn)) {
    const id = majority(onStreet.filter((d) => parseInt(d.houseNumber ?? "") === hn), knownIds);
    if (id) return { id, source: "building" };
  }
  // 2) the nearest located deal on the street (long streets cross neighbourhoods)
  if (hint.streetX != null && hint.streetY != null) {
    let best: Deal | null = null, bestDist = Infinity;
    for (const d of onStreet) {
      if (d.x == null || d.y == null) continue;
      const dist = itmDistance(hint.streetX, hint.streetY, d.x, d.y);
      if (dist < bestDist) { bestDist = dist; best = d; }
    }
    if (best) return { id: best.neighborhoodId, source: "street_nearest" };
  }
  // 3) where most of the street's deals are
  const id = majority(onStreet, knownIds);
  return id ? { id, source: "street_majority" } : { id: null, source: "none" };
}
