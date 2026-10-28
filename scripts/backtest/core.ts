/**
 * scripts/backtest/core.ts
 * Pure pieces of the valuation backtest: who is eligible to be a "search", the seeded sample,
 * the time split, and the metrics. No I/O here, so it can be unit-tested.
 */
import type { Deal } from "../../lib/types";

export type Track = "engine" | "pipeline";
export type AsOfMode = "sale" | "today";
export type Split = "dev" | "test" | "all";

/** One replayed search. `errPct` = (estimateMid − price) / price. */
export interface BacktestRow {
  id: string;
  date: string;
  type: string;
  neighborhoodId: string;
  neighborhood: string | null;
  street: string | null;
  house: string | null;
  rooms: number | null;
  area: number | null;
  plot: number | null;
  floor: number | null;
  year: number | null;
  price: number;
  status: "ok" | "insufficient" | "no_match" | "street_not_in_index" | "error";
  err?: string;
  low?: number;
  mid?: number;
  high?: number;
  errPct?: number;
  inRange?: boolean;
  confidence?: string;
  scope?: string | null;
  basedOn?: number;
  windowMonths?: number;
  manualReview?: boolean;
  /** neighbourhood id the engine actually ran with (pipeline: after server resolution) */
  usedNeighborhoodId?: string | null;
  getAllDealsCalls: number;
  ms: number;
}

// dealNature values that describe a home. null nature is kept (unknown, not known-commercial).
const RES_APT = new Set(["דירה בבית קומות", "דירה", "דירת גן", "דירת גג", "מגורים", "דירת נופש", "דופלקס", "פנטהאוז"]);
const RES_HOUSE = new Set(["קוטג' דו משפחתי", "קוטג' חד משפחתי", "קוטג' טורי", "בית בודד", "מגורים"]);

/** Why a sale cannot serve as a search, or null when it can. Mirrors what a seller could type. */
export function ineligibleReason(d: Deal): string | null {
  const t = d.propertyType ?? "apartment";
  if (!d.street || d.street === "0" || !d.houseNumber) return "no_full_address";
  if (!d.price || d.price <= 0) return "no_price";
  if (t === "land") return d.plotSqm ? null : "land_no_plot";
  if (d.dealNature && !(t === "house" ? RES_HOUSE : RES_APT).has(d.dealNature)) return "non_residential_nature";
  if (!d.areaSqm || d.areaSqm < 20) return "no_built_area";
  if (t === "apartment" && !d.rooms) return "apartment_no_rooms";
  if (d.price / d.areaSqm < (t === "house" ? 12_000 : 8_000)) return "ppsqm_below_floor";
  return null;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SampleSpec {
  /** last sale date in the dataset; the evaluation year is the 12 months before it */
  lastDate: string;
  split: Split;
  /** "all" or a sample size */
  size: number | "all";
  seed: number;
}

export interface SampleResult {
  rows: Deal[];
  fromISO: string;
  splitISO: string;
  candidates: number;
  excluded: Record<string, number>;
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * The evaluation year = the 12 months up to the last sale. dev = its first 6 months,
 * test = its last 6 months (held out: look at it only to confirm a finished change).
 * Rows are sorted by id before shuffling, so the sample does not depend on file order.
 */
export function drawSample(deals: Deal[], spec: SampleSpec): SampleResult {
  const fromISO = addMonths(spec.lastDate, -12);
  const splitISO = addMonths(spec.lastDate, -6);
  const excluded: Record<string, number> = {};
  const inYear = deals.filter((d) => d.dealDate > fromISO && d.dealDate <= spec.lastDate);
  const inSplit = inYear.filter((d) =>
    spec.split === "all" ? true : spec.split === "dev" ? d.dealDate <= splitISO : d.dealDate > splitISO,
  );
  const eligible = inSplit.filter((d) => {
    const why = ineligibleReason(d);
    if (why) excluded[why] = (excluded[why] ?? 0) + 1;
    return !why;
  });
  const pool = [...eligible].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const r = rng(spec.seed);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const rows = spec.size === "all" ? pool : pool.slice(0, spec.size);
  return { rows, fromISO, splitISO, candidates: inSplit.length, excluded };
}

// ---------- metrics ----------

const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface Metrics {
  searches: number;
  numeric: number;
  insufficient: number;
  noMatch: number;
  notInIndex: number;
  manualReview: number;
  errors: number;
  mdape: number;
  mape: number;
  bias: number;
  within: Record<"5" | "10" | "15" | "20" | "30", number>;
  coverage: number;
  halfWidth: number;
  getAllDealsShare: number;
  msMedian: number;
}

/** Accuracy over rows that returned a number (manual-review land and failures are counted, not scored). */
export function metrics(rows: BacktestRow[]): Metrics {
  const num = rows.filter((r) => r.status === "ok" && !r.manualReview && (r.mid ?? 0) > 0);
  const ape = num.map((r) => Math.abs(r.errPct!));
  const share = (k: number) => (num.length ? num.filter((r) => Math.abs(r.errPct!) <= k).length / num.length : NaN);
  return {
    searches: rows.length,
    numeric: num.length,
    insufficient: rows.filter((r) => r.status === "insufficient").length,
    noMatch: rows.filter((r) => r.status === "no_match").length,
    notInIndex: rows.filter((r) => r.status === "street_not_in_index").length,
    manualReview: rows.filter((r) => r.manualReview).length,
    errors: rows.filter((r) => r.status === "error").length,
    mdape: median(ape),
    mape: ape.length ? ape.reduce((a, b) => a + b, 0) / ape.length : NaN,
    bias: median(num.map((r) => r.errPct!)),
    within: { "5": share(0.05), "10": share(0.1), "15": share(0.15), "20": share(0.2), "30": share(0.3) },
    coverage: num.length ? num.filter((r) => r.inRange).length / num.length : NaN,
    halfWidth: median(num.map((r) => (r.high! - r.low!) / r.mid! / 2)),
    getAllDealsShare: rows.length ? rows.filter((r) => r.getAllDealsCalls > 0).length / rows.length : NaN,
    msMedian: median(rows.map((r) => r.ms)),
  };
}

export function priceBand(price: number): string {
  if (price < 1_500_000) return "<1.5M";
  if (price < 2_500_000) return "1.5-2.5M";
  if (price < 3_500_000) return "2.5-3.5M";
  if (price < 5_000_000) return "3.5-5M";
  return ">5M";
}

export function breakdown(rows: BacktestRow[], key: (r: BacktestRow) => string): Record<string, Metrics> {
  const groups: Record<string, BacktestRow[]> = {};
  for (const r of rows) (groups[key(r)] ??= []).push(r);
  return Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, metrics(g)]));
}

const pc = (x: number, d = 1) => (Number.isFinite(x) ? (x * 100).toFixed(d) + "%" : "—");

export function formatMetricsTable(named: Record<string, Metrics>): string {
  const head = "| group | searches | numeric | insuff. | MdAPE | MAPE | bias | ±5% | ±10% | ±15% | ±20% | ±30% | in range | half-width | getAllDeals |";
  const sep = "|" + "---|".repeat(15);
  const lines = Object.entries(named).map(([k, m]) =>
    `| ${k} | ${m.searches} | ${m.numeric} | ${m.insufficient + m.noMatch + m.notInIndex} | ${pc(m.mdape)} | ${pc(m.mape)} | ${pc(m.bias)} | ${pc(m.within["5"], 0)} | ${pc(m.within["10"], 0)} | ${pc(m.within["15"], 0)} | ${pc(m.within["20"], 0)} | ${pc(m.within["30"], 0)} | ${pc(m.coverage, 0)} | ±${pc(m.halfWidth, 0)} | ${pc(m.getAllDealsShare, 0)} |`,
  );
  return [head, sep, ...lines].join("\n");
}
