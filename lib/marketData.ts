/**
 * lib/marketData.ts
 * שירות נתוני שוק — מחשב השוואת מחיר ועסקאות אחרונות לפי ליד.
 * משתמש בנתוני ה-store הקיים (deals.json / Supabase) ולא מחייב API חיצוני.
 */
import { getStore } from "./store";
import { percentile } from "./valuation";
import type { Deal, Lead, ComparableDeal, PriceTrend } from "./types";

export type PriceBadge = "below" | "match" | "above";

export interface MarketAnalysis {
  neighborhoodId: string;
  neighborhood: string | null;
  medianPricePerSqm: number;
  avgPricePerSqm: number;
  basedOnDeals: number;
  windowMonths: number;
  /** ₪/מ"ר לפי האומדן שחישבנו לליד */
  leadPricePerSqm: number | null;
  /** אחוז הפרש: חיובי = יקר מהשוק, שלילי = זול מהשוק */
  priceDiffPct: number | null;
  priceBadge: PriceBadge | null;
  /** true = מחיר מתחת לשוק → ליד חם (פוטנציאל מכירה מהירה) */
  isHotLead: boolean;
  recentDeals: ComparableDeal[];
  trend: PriceTrend | null;
  asOf: string;
  /** ניתוח ברמת רחוב/בניין (כשיש שם רחוב) */
  streetScope: "building" | "street" | null;
  streetMedianPricePerSqm: number | null;
  streetBasedOnDeals: number | null;
}

const BADGE_THRESHOLD = 0.12; // ±12% — מחוץ לטווח = מחיר גבוה/נמוך מהשוק
const MIN_DEALS = 3;
const WINDOWS = [6, 12, 24, 48];
const MAX_RECENT = 8;

const STREET_PREFIX_RE = /^(שד'?|שדרות|רחוב|רח')\s*/i;
const normStreet = (s: string) => s.replace(STREET_PREFIX_RE, "").trim();

export async function analyzeLeadMarket(
  lead: Lead,
  streetName?: string | null,
  houseNumber?: string | null,
): Promise<MarketAnalysis | null> {
  // נסה למצוא את ה-neighborhoodId דרך שם השכונה אם אין ישירות בליד
  const store = getStore();
  const asOf = await store.dataAsOf();

  let neighborhoodId: string | null = null;
  let neighborhoodName = lead.neighborhood ?? null;

  if ((lead as any).neighborhoodId) {
    neighborhoodId = (lead as any).neighborhoodId;
  } else if (neighborhoodName) {
    const all = await store.listNeighborhoods("נתניה");
    const match = all.find(
      (n) => n.name === neighborhoodName || neighborhoodName!.includes(n.name) || n.name.includes(neighborhoodName!),
    );
    if (match) { neighborhoodId = match.id; neighborhoodName = match.name; }
  }

  if (!neighborhoodId) return null;

  const ptype = (lead as any).propertyType ?? "apartment";
  const isLand = ptype === "land";
  const leadSize = isLand ? (lead as any).plotSqm : lead.areaSqm;

  // בחר חלון זמן עם מינימום עסקאות
  let deals: Deal[] = [];
  let windowMonths = WINDOWS[WINDOWS.length - 1];
  for (const months of WINDOWS) {
    const all = (await store.getDealsByNeighborhood(neighborhoodId, { monthsBack: months }))
      .filter((d) => (d.propertyType ?? "apartment") === ptype);
    const roomFiltered =
      !isLand && lead.rooms != null
        ? all.filter((d) => d.rooms != null && Math.abs(d.rooms - lead.rooms!) <= 1)
        : all;
    deals = roomFiltered.length >= MIN_DEALS ? roomFiltered : all;
    windowMonths = months;
    if (deals.length >= MIN_DEALS) break;
  }

  const ppsqm = deals
    .map((d) => d.pricePerSqm)
    .filter((v): v is number => v != null && v > 0 && isFinite(v));

  if (ppsqm.length < MIN_DEALS) return null;

  const medianPricePerSqm = Math.round(percentile(ppsqm, 50));
  const avgPricePerSqm    = Math.round(ppsqm.reduce((a, b) => a + b, 0) / ppsqm.length);

  // ₪/מ"ר של הליד לפי האומדן (חציון של low/high)
  const estimateMid =
    lead.estimateLow && lead.estimateHigh
      ? (lead.estimateLow + lead.estimateHigh) / 2
      : null;
  const leadPricePerSqm =
    estimateMid && leadSize && leadSize > 0 ? Math.round(estimateMid / leadSize) : null;

  let priceDiffPct: number | null = null;
  let priceBadge: PriceBadge | null = null;
  let isHotLead = false;

  if (leadPricePerSqm && medianPricePerSqm > 0) {
    priceDiffPct = Math.round(((leadPricePerSqm - medianPricePerSqm) / medianPricePerSqm) * 100);
    if (priceDiffPct < -BADGE_THRESHOLD * 100) {
      priceBadge = "below";
      isHotLead = true;
    } else if (priceDiffPct > BADGE_THRESHOLD * 100) {
      priceBadge = "above";
    } else {
      priceBadge = "match";
    }
  }

  // עסקאות אחרונות רלוונטיות להצגה
  const recentDeals: ComparableDeal[] = [...deals]
    .sort((a, b) => (a.dealDate < b.dealDate ? 1 : -1))
    .slice(0, MAX_RECENT)
    .map((d) => ({
      dealDate:   d.dealDate,
      price:      d.price,
      rooms:      d.rooms,
      areaSqm:    d.areaSqm,
      plotSqm:    d.plotSqm,
      floor:      d.floor,
      yearBuilt:  d.yearBuilt ?? null,
      dealNature: d.dealNature ?? null,
      street:     d.street,
      houseNumber:(d as any).houseNumber ?? null,
      address:    d.address ?? null,
      neighborhood: d.neighborhood ?? null,
      pricePerSqm: d.pricePerSqm,
    }));

  // ─── ניתוח ברמת רחוב/בניין ───
  // שם רחוב → text-match על pool 48 חודשים; מספר בית → ±12 מספרים
  let streetScope: MarketAnalysis["streetScope"] = null;
  let streetMedianPricePerSqm: number | null = null;
  let streetBasedOnDeals: number | null = null;

  if (streetName) {
    const snNorm = normStreet(streetName);
    const pool48 = (await store.getDealsByNeighborhood(neighborhoodId, { monthsBack: 48 }))
      .filter((d) => (d.propertyType ?? "apartment") === ptype);

    const onStreet = pool48.filter((d) => {
      if (!d.street) return false;
      const ds = normStreet(d.street);
      return ds === snNorm || snNorm.includes(ds);
    });

    let streetPool = onStreet;
    if (houseNumber && onStreet.length > 0) {
      const hn = parseInt(houseNumber);
      const inBuilding = !isNaN(hn)
        ? onStreet.filter((d) => {
            const dhn = parseInt(d.houseNumber ?? "");
            return !isNaN(dhn) && Math.abs(dhn - hn) <= 12;
          })
        : onStreet;
      if (inBuilding.length >= MIN_DEALS) {
        streetPool = inBuilding;
        streetScope = "building";
      } else if (onStreet.length >= MIN_DEALS) {
        streetScope = "street";
      }
    } else if (onStreet.length >= MIN_DEALS) {
      streetScope = "street";
    }

    if (streetScope) {
      const minPps = ptype === "house" ? 12_000 : 8_000;
      const sPps = streetPool
        .map((d) => d.pricePerSqm)
        .filter((v): v is number => v != null && v >= minPps && isFinite(v));
      if (sPps.length >= MIN_DEALS) {
        streetMedianPricePerSqm = Math.round(percentile(sPps, 50));
        streetBasedOnDeals = sPps.length;
      } else {
        streetScope = null;
      }
    }
  }

  return {
    neighborhoodId,
    neighborhood: neighborhoodName,
    medianPricePerSqm,
    avgPricePerSqm,
    basedOnDeals: ppsqm.length,
    windowMonths,
    leadPricePerSqm,
    priceDiffPct,
    priceBadge,
    isHotLead,
    recentDeals,
    trend: computeTrend(deals),
    asOf,
    streetScope,
    streetMedianPricePerSqm,
    streetBasedOnDeals,
  };
}

/** ממוצע ₪/מ"ר לכל השכונות (לדשבורד) */
export async function getNeighborhoodStats(): Promise<
  Array<{
    id: string;
    name: string;
    medianPricePerSqm: number;
    dealCount: number;
    lastDealDate: string;
    trend: PriceTrend | null;
  }>
> {
  const store = getStore();
  const neighborhoods = await store.listNeighborhoods("נתניה");
  const results = [];

  for (const n of neighborhoods) {
    const deals = (await store.getDealsByNeighborhood(n.id, { monthsBack: 24 }))
      .filter((d) => d.propertyType === "apartment");
    const ppsqm = deals
      .map((d) => d.pricePerSqm)
      .filter((v): v is number => v != null && v > 0);
    if (ppsqm.length < MIN_DEALS) continue;

    const sorted = [...deals].sort((a, b) => (a.dealDate < b.dealDate ? 1 : -1));
    results.push({
      id:                 n.id,
      name:               n.name,
      medianPricePerSqm:  Math.round(percentile(ppsqm, 50)),
      dealCount:          ppsqm.length,
      lastDealDate:       sorted[0]?.dealDate ?? "",
      trend:              computeTrend(deals),
    });
  }

  return results.sort((a, b) => b.medianPricePerSqm - a.medianPricePerSqm);
}

function computeTrend(deals: Deal[]): PriceTrend | null {
  const vals = deals.filter((d) => d.pricePerSqm && d.pricePerSqm > 0 && d.dealDate);
  if (vals.length < 6) return null;
  const buckets = new Map<string, number[]>();
  for (const d of vals) {
    const [y, m] = d.dealDate.split("-").map(Number);
    const q = Math.floor((m - 1) / 3) + 1;
    const key = `${y}-Q${q}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(d.pricePerSqm!);
  }
  const points = [...buckets.entries()]
    .map(([label, arr]) => ({ label, ppsqm: Math.round(percentile(arr, 50)) }))
    .filter((p) => p.ppsqm > 0)
    .sort((a, b) => (a.label < b.label ? -1 : 1));
  if (points.length < 2) return null;
  const first = points[0].ppsqm, last = points[points.length - 1].ppsqm;
  return {
    points,
    changePct: first > 0 ? Math.round(((last - first) / first) * 100) : 0,
    months: points.length * 3,
  };
}
