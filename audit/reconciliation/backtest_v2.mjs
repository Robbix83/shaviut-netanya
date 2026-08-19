/**
 * backtest_v2.mjs — LEAK-FREE historical backtest V2 of the valuation engine.
 *
 * AUDIT-ONLY. Read-only on all source/data. Writes nothing except stdout + an
 * optional JSON dump under audit/reconciliation/. Does NOT modify production.
 *
 * WHY AN ADAPTER (not the real production valuate()):
 *   The production `valuate()` in lib/valuation.ts cannot be executed leak-free
 *   without editing production code, for TWO independent reasons:
 *     1. TIME ANCHOR: every rolling-window cutoff is computed from `new Date()`
 *        (see cutoffDate() and store.monthsAgoISO()). There is no "as-of T"
 *        parameter. To anchor windows to the target's own dealDate T we would
 *        have to change valuation.ts/store.ts.
 *     2. DATASET INJECTION + NO UPPER DATE BOUND: valuate() reads the whole
 *        deals.json through getStore() (module-private `_localDeals` cache and a
 *        private `_store` singleton — no injection seam). Its date filter is a
 *        LOWER bound only (`d.dealDate >= cutoff`); it never excludes deals with
 *        dealDate > T. In production that is fine (the DB only holds deals up to
 *        today) but in a historical backtest it leaks every future transaction.
 *        Removing future deals requires feeding the store a filtered dataset,
 *        which the store offers no hook for.
 *   Editing either file is forbidden by the audit mandate, so V2 is the SMALLEST
 *   faithful port of the production apartment comparable-selection + percentile
 *   logic, driven by a per-target as-of clock. Every deviation is listed in
 *   PARITY_NOTES below and in 21_BACKTEST_V2.md.
 *
 * Run:  node C:\leads\audit\reconciliation\backtest_v2.mjs
 */

import { readFileSync, writeFileSync } from "fs";

// ─── Production constants (mirrored verbatim from lib/valuation.ts) ────────────
const GEO_MONTHS = 60;
const WINDOWS = [6, 12, 24, 48];
const MIN_DEALS_FOR_ROOM_FILTER = 6;
const MIN_DEALS_FOR_ESTIMATE = 3;
const MIN_DEALS_FOR_FLOOR_FILTER = 5;
const AREA_TOLERANCE_RATIO = 0.5;
const FLOOR_TOLERANCE = 2;
const BUILDING_RADIUS = 60;
const STREET_RADIUS = 350;
const COMP_RADIUS_LADDER = [500];
const AGE_TOLERANCES = { building: 10, street: 15, radius: 20 };
const MIN_PPSQM_APARTMENT = 8_000;
const HOUSE_NUMBER_RANGE = 12;
const STREET_PREFIX = /^(שד'?|שדרות|רחוב|רח')\s*/i;

// ─── Helpers ───────────────────────────────────────────────────────────────────
const normalizeStreet = (s) => s.replace(STREET_PREFIX, "").trim();
const itmDistance = (x1, y1, x2, y2) => Math.hypot(x1 - x2, y1 - y2);

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank), hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (rank - lo) * (sorted[hi] - sorted[lo]);
}

/**
 * cutoff(months) RELATIVE TO the target's dealDate T (NOT today).
 * Mirrors production cutoffDate() but with T as the anchor instead of new Date().
 * Date math on UTC to avoid TZ drift; T is 'yyyy-mm-dd'.
 */
function cutoffFromT(T, months) {
  const d = new Date(T + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

function monthsBetween(fromISO, toISO) {
  const a = new Date(fromISO + "T00:00:00Z");
  const b = new Date(toISO + "T00:00:00Z");
  return (b - a) / (1000 * 60 * 60 * 24 * 30.4375);
}

// ─── Alternate-representation exclusion ────────────────────────────────────────
// A "high-confidence alternate representation" of the same transaction = same
// street + houseNumber + price, dealDate within ±7 days, area within ±3 sqm,
// but a DIFFERENT id (typically the same deal registered under two overlapping
// neighborhoodIds). NOTE: because a strict `dealDate < T` pool already removes
// anything on T itself (all exact duplicates share the target's dealDate), this
// rule is belt-and-suspenders for near-date re-registrations. Alternates are
// NEVER deleted from source data — only skipped in the in-memory pool.
function isAlternateOf(d, target) {
  if (d.id === target.id) return true;
  if (d.street !== target.street) return false;
  if ((d.houseNumber ?? null) !== (target.houseNumber ?? null)) return false;
  if (target.price > 0 && Math.abs(d.price - target.price) / target.price > 0.005) return false;
  const dd = Math.abs(new Date(d.dealDate + "T00:00:00Z") - new Date(target.dealDate + "T00:00:00Z")) / 86400000;
  if (dd > 7) return false;
  const ta = target.areaSqm ?? 0, da = d.areaSqm ?? 0;
  if (ta > 0 && Math.abs(da - ta) > 3) return false;
  return true;
}

/**
 * Leak-free apartment valuation as-of T.
 * @param target the deal under test
 * @param allDeals full dataset (unfiltered)
 * Returns { estimateLow, estimateMid, estimateHigh, compSearchScope, resolutionPath,
 *           basedOnDeals, windowMonths, medianCompAgeMonths } or null.
 */
function valuateAsOf(target, allDeals) {
  const T = target.dealDate;
  const minPpsqm = MIN_PPSQM_APARTMENT;

  // LEAK-FREE UNIVERSE: strictly before T, apartments, exclude target + alternates.
  const past = allDeals.filter(
    (d) => (d.propertyType ?? "apartment") === "apartment" && d.dealDate < T && !isAlternateOf(d, target)
  );

  // ── pool4yr: same neighborhood, apartment, dealDate >= T-60mo (mirrors fetchDeals(60)) ──
  const cutoffGeo = cutoffFromT(T, GEO_MONTHS);
  const pool4yr = past.filter((d) => d.neighborhoodId === target.neighborhoodId && d.dealDate >= cutoffGeo);

  const roomSubset4yr =
    target.rooms != null ? pool4yr.filter((d) => d.rooms != null && Math.abs(d.rooms - target.rooms) <= 1) : pool4yr;
  const geoPool = roomSubset4yr.length >= MIN_DEALS_FOR_ROOM_FILTER ? roomSubset4yr : pool4yr;

  // ── neighborhood window loop (6→12→24→48), anchored to T ──
  let deals = geoPool;
  let windowMonths = GEO_MONTHS;
  let resolutionPath = "neighborhood-window";
  for (const months of WINDOWS) {
    const cutoff = cutoffFromT(T, months);
    const recent = pool4yr.filter((d) => d.dealDate >= cutoff);
    const roomRecent =
      target.rooms != null ? recent.filter((d) => d.rooms != null && Math.abs(d.rooms - target.rooms) <= 1) : recent;
    deals = roomRecent.length >= MIN_DEALS_FOR_ROOM_FILTER ? roomRecent : recent;
    windowMonths = months;
    if (deals.length >= MIN_DEALS_FOR_ESTIMATE) break;
  }

  const ageFilter = (ds, tol) => {
    if (target.yearBuilt == null) return ds;
    const f = ds.filter((d) => d.yearBuilt != null && Math.abs(d.yearBuilt - target.yearBuilt) <= tol);
    return f.length >= MIN_DEALS_FOR_ESTIMATE ? f : ds;
  };

  const inputStreetNorm = target.street ? normalizeStreet(target.street) : null;
  const byStreetName = (p) => {
    if (!inputStreetNorm) return [];
    return p.filter((d) => {
      if (!d.street) return false;
      const ds = normalizeStreet(d.street);
      return ds === inputStreetNorm || inputStreetNorm.includes(ds);
    });
  };
  const byExactBuilding = (p) => {
    const onStreet = byStreetName(p);
    if (!target.houseNumber || onStreet.length === 0) return [];
    const hn = parseInt(target.houseNumber);
    if (isNaN(hn)) return onStreet;
    return onStreet.filter((d) => { const dhn = parseInt(d.houseNumber ?? ""); return !isNaN(dhn) && dhn === hn; });
  };
  const byBuildingNumber = (p) => {
    const onStreet = byStreetName(p);
    if (!target.houseNumber || onStreet.length === 0) return [];
    const hn = parseInt(target.houseNumber);
    if (isNaN(hn)) return onStreet;
    return onStreet.filter((d) => { const dhn = parseInt(d.houseNumber ?? ""); return !isNaN(dhn) && Math.abs(dhn - hn) <= HOUSE_NUMBER_RANGE; });
  };

  let compSearchScope = "neighborhood";

  // ── text hierarchy: exact building → near-street(±12) → full street ──
  if (inputStreetNorm) {
    const exact = ageFilter(byExactBuilding(geoPool), AGE_TOLERANCES.building);
    if (exact.length >= MIN_DEALS_FOR_ESTIMATE) {
      deals = exact; compSearchScope = "building"; windowMonths = GEO_MONTHS; resolutionPath = "text-exact-building";
    } else {
      const near = ageFilter(byBuildingNumber(geoPool), AGE_TOLERANCES.street);
      if (near.length >= MIN_DEALS_FOR_ESTIMATE) {
        deals = near; compSearchScope = "street"; windowMonths = GEO_MONTHS; resolutionPath = "text-near-street";
      } else {
        const street = ageFilter(byStreetName(geoPool), AGE_TOLERANCES.street);
        if (street.length >= MIN_DEALS_FOR_ESTIMATE) {
          deals = street; compSearchScope = "street"; windowMonths = GEO_MONTHS; resolutionPath = "text-street";
        }
      }
    }
  }

  // ── city-wide text fallback (thin neighborhood) ──
  // Production uses ALL city deals with NO date bound here; we add `dealDate < T`
  // (leak-free deviation #LF-1) — otherwise this path leaks future data.
  if (compSearchScope === "neighborhood" && inputStreetNorm && geoPool.length < MIN_DEALS_FOR_ROOM_FILTER) {
    const cityPool = past; // already apartment + dealDate < T
    const cityB = ageFilter(byBuildingNumber(cityPool), AGE_TOLERANCES.building);
    if (cityB.length >= MIN_DEALS_FOR_ESTIMATE) {
      deals = cityB; compSearchScope = "building"; windowMonths = GEO_MONTHS; resolutionPath = "city-text-building";
    } else {
      const cityS = ageFilter(byStreetName(cityPool), AGE_TOLERANCES.street);
      if (cityS.length >= MIN_DEALS_FOR_ESTIMATE) {
        deals = cityS; compSearchScope = "street"; windowMonths = GEO_MONTHS; resolutionPath = "city-text-street";
      }
    }
  }

  // ── geo hierarchy (coords present on every deal; centroid-collapsed) ──
  if (target.x != null && target.y != null) {
    const located = geoPool.filter((d) => d.x != null && d.y != null);
    const unlocated = geoPool.filter((d) => d.x == null || d.y == null);
    const filterByRadius = (R) => located.filter((d) => itmDistance(target.x, target.y, d.x, d.y) <= R);

    if (compSearchScope !== "building") {
      const withinBuilding = filterByRadius(BUILDING_RADIUS);
      const sameStreetInBuilding = inputStreetNorm
        ? withinBuilding.filter((d) => { if (!d.street) return false; const ds = normalizeStreet(d.street); return ds === inputStreetNorm || inputStreetNorm.includes(ds); })
        : withinBuilding;
      const inBuilding = ageFilter(
        sameStreetInBuilding.length >= MIN_DEALS_FOR_ESTIMATE ? sameStreetInBuilding : withinBuilding,
        AGE_TOLERANCES.building
      );
      const allSameStreet =
        !inputStreetNorm || inBuilding.every((d) => { if (!d.street) return true; const ds = normalizeStreet(d.street); return ds === inputStreetNorm || inputStreetNorm.includes(ds); });
      if (inBuilding.length >= MIN_DEALS_FOR_ESTIMATE) {
        deals = inBuilding.concat(unlocated);
        compSearchScope = allSameStreet ? "building" : "radius";
        windowMonths = GEO_MONTHS;
        resolutionPath = allSameStreet ? "geo-building" : "geo-radius(60)";
      }
    }
    if (compSearchScope !== "building" && compSearchScope !== "street") {
      const onStreet = ageFilter(filterByRadius(STREET_RADIUS), AGE_TOLERANCES.street);
      if (onStreet.length >= MIN_DEALS_FOR_FLOOR_FILTER) {
        deals = onStreet.concat(unlocated); compSearchScope = "radius"; windowMonths = GEO_MONTHS; resolutionPath = "geo-radius(350)";
      }
    }
    if (compSearchScope === "neighborhood") {
      for (const R of COMP_RADIUS_LADDER) {
        const within = ageFilter(filterByRadius(R), AGE_TOLERANCES.radius);
        if (within.length >= MIN_DEALS_FOR_FLOOR_FILTER) {
          deals = within.concat(unlocated); compSearchScope = "radius"; windowMonths = GEO_MONTHS; resolutionPath = "geo-radius(500)"; break;
        }
      }
    }

    // step 5: cross-neighborhood fallback (thin pool). Leak-free: dealDate < T.
    const prePpsqm = deals.map((d) => d.pricePerSqm).filter((v) => v != null && v >= minPpsqm && isFinite(v));
    if (deals.length < MIN_DEALS_FOR_ESTIMATE || prePpsqm.length < MIN_DEALS_FOR_ESTIMATE) {
      const cutoff = cutoffFromT(T, GEO_MONTHS);
      const typeFiltered = past.filter((d) => d.dealDate >= cutoff);
      const roomF = target.rooms != null ? typeFiltered.filter((d) => d.rooms != null && Math.abs(d.rooms - target.rooms) <= 1) : typeFiltered;
      const xPool = roomF.length >= MIN_DEALS_FOR_ROOM_FILTER ? roomF : typeFiltered;
      for (const R of [500, 750, 1000]) {
        const inR = xPool.filter((d) => d.x != null && d.y != null && itmDistance(target.x, target.y, d.x, d.y) <= R);
        const inRPps = inR.map((d) => d.pricePerSqm).filter((v) => v != null && v >= minPpsqm && isFinite(v));
        if (inR.length >= MIN_DEALS_FOR_ESTIMATE && inRPps.length >= MIN_DEALS_FOR_ESTIMATE) {
          deals = inR; compSearchScope = "radius"; windowMonths = GEO_MONTHS; resolutionPath = `cross-neighborhood(${R})`; break;
        }
      }
    }
  }

  // ── floor filter (±2) ──
  if (target.floor != null) {
    const ff = deals.filter((d) => d.floor != null && Math.abs(d.floor - target.floor) <= FLOOR_TOLERANCE);
    if (ff.length >= MIN_DEALS_FOR_FLOOR_FILTER) deals = ff;
  }
  // ── area filter (±50%) ──
  if (target.areaSqm != null && target.areaSqm > 0) {
    const lo = target.areaSqm * (1 - AREA_TOLERANCE_RATIO), hi = target.areaSqm * (1 + AREA_TOLERANCE_RATIO);
    const af = deals.filter((d) => d.areaSqm != null && d.areaSqm >= lo && d.areaSqm <= hi);
    if (af.length >= MIN_DEALS_FOR_ESTIMATE) deals = af;
  }

  const contributing = deals.filter((d) => d.pricePerSqm != null && d.pricePerSqm >= minPpsqm && isFinite(d.pricePerSqm));
  const ppsqm = contributing.map((d) => d.pricePerSqm);
  if (ppsqm.length < MIN_DEALS_FOR_ESTIMATE) return null;

  const scopePct = compSearchScope === "building" ? { lo: 20, hi: 80 }
                 : compSearchScope === "street"   ? { lo: 25, hi: 75 }
                 :                                  { lo: 33, hi: 67 };
  const lo = percentile(ppsqm, scopePct.lo);
  const mid = percentile(ppsqm, 50);
  const hi = percentile(ppsqm, scopePct.hi);

  const size = target.areaSqm;
  if (!size || size <= 0) return null;
  const round = (n) => Math.round(n / 1000) * 1000;

  const ages = contributing.map((d) => monthsBetween(d.dealDate, T));
  const medianCompAgeMonths = percentile(ages, 50);

  return {
    estimateLow: round(size * lo),
    estimateMid: round(size * mid),
    estimateHigh: round(size * hi),
    compSearchScope,
    resolutionPath,
    basedOnDeals: ppsqm.length,
    windowMonths,
    medianCompAgeMonths,
  };
}

// ─── Metrics helpers ───────────────────────────────────────────────────────────
const median = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
const pct = (n, d) => (d ? (n / d) * 100 : 0);

function computeMetrics(rows) {
  const n = rows.length;
  if (n === 0) return null;
  const ae = rows.map((r) => Math.abs(r.mid - r.actual));
  const ape = rows.map((r) => Math.abs(r.mid - r.actual) / r.actual);
  const signed = rows.map((r) => r.mid - r.actual);
  const w = (t) => pct(rows.filter((r) => Math.abs(r.mid - r.actual) / r.actual <= t).length, n);
  return {
    n,
    mae: Math.round(mean(ae)),
    medianAE: Math.round(median(ae)),
    mape: +(mean(ape) * 100).toFixed(2),
    medianAPE: +(median(ape) * 100).toFixed(2),
    within5: +w(0.05).toFixed(1),
    within10: +w(0.10).toFixed(1),
    within15: +w(0.15).toFixed(1),
    within20: +w(0.20).toFixed(1),
    insideInterval: +pct(rows.filter((r) => r.actual >= r.lo && r.actual <= r.hi).length, n).toFixed(1),
    medianSignedErr: Math.round(median(signed)),
    meanSignedErr: Math.round(mean(signed)),
    pctOver: +pct(rows.filter((r) => r.mid > r.actual).length, n).toFixed(1),
    pctUnder: +pct(rows.filter((r) => r.mid < r.actual).length, n).toFixed(1),
  };
}

function breakdown(rows, keyFn, label) {
  const groups = new Map();
  for (const r of rows) { const k = keyFn(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const out = [];
  for (const [k, g] of groups) out.push({ key: k, ...computeMetrics(g) });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { label, rows: out };
}

// ─── Main ───────────────────────────────────────────────────────────────────────
function main() {
  const all = JSON.parse(readFileSync("C:\\leads\\data\\deals.json", "utf8"));

  // Eligible apartment targets: apartment, area>0, price>0, valid pricePerSqm.
  // We do NOT pre-filter targets by pricePerSqm floor (that would bias the target
  // universe); the MIN_PPSQM floor applies only to the COMPARABLE pool, exactly
  // as production does.
  const aptTargets = all.filter(
    (d) => (d.propertyType ?? "apartment") === "apartment" && d.areaSqm > 0 && d.price > 0 && d.dealDate
  );

  const results = [];
  let nullCount = 0;
  for (const target of aptTargets) {
    const v = valuateAsOf(target, all);
    if (!v) { nullCount++; continue; }
    results.push({
      id: target.id,
      year: target.dealDate.slice(0, 4),
      neighborhood: target.neighborhood ?? target.neighborhoodId,
      actual: target.price,
      mid: v.estimateMid, lo: v.estimateLow, hi: v.estimateHigh,
      scope: v.compSearchScope,
      resolutionPath: v.resolutionPath,
      basedOn: v.basedOnDeals,
      confidence: v.basedOnDeals >= 25 ? "high" : v.basedOnDeals >= 10 ? "medium" : "low",
      areaSqm: target.areaSqm,
      medianCompAgeMonths: v.medianCompAgeMonths,
    });
  }

  const N_eligible = aptTargets.length;
  const N_evaluated = results.length;

  console.log("=== LEAK-FREE BACKTEST V2 — APARTMENT COHORT ===");
  console.log(`N eligible apartment targets: ${N_eligible}`);
  console.log(`N evaluated:                  ${N_evaluated}`);
  console.log(`N null (no estimate):         ${nullCount}  (${pct(nullCount, N_eligible).toFixed(1)}%)`);

  const overall = computeMetrics(results);
  console.log("\n--- OVERALL (all evaluated apartment targets, all years) ---");
  console.log(JSON.stringify(overall, null, 2));

  // 2023-2024 subset — same target WINDOW V1 used.
  const sub2324 = results.filter((r) => r.year === "2023" || r.year === "2024");
  console.log("\n--- SUBSET 2023-2024 (matches V1 target window) ---");
  console.log(JSON.stringify(computeMetrics(sub2324), null, 2));

  // V1-COMPARABLE cohort: V1 filtered its TARGETS to pricePerSqm >= 8000 and
  // subsampled every-5th. We keep the same target eligibility (ppsqm>=8000,
  // 2023-2024) but evaluate ALL of them, so the ONLY methodology difference vs
  // V1 is leakage removal + full port. This isolates the leakage effect.
  const aptById = new Map(aptTargets.map((t) => [t.id, t]));
  const v1comp = sub2324.filter((r) => { const t = aptById.get(r.id); return t && t.pricePerSqm != null && t.pricePerSqm >= MIN_PPSQM_APARTMENT; });
  console.log("\n--- V1-COMPARABLE cohort (2023-2024, target pricePerSqm>=8000) ---");
  console.log(JSON.stringify(computeMetrics(v1comp), null, 2));

  // Outlier diagnostic: extreme APE targets are overwhelmingly BELOW-market
  // (mid > actual) — partial/family/rights transfers that pass the 8K floor.
  const extreme = results.filter((r) => Math.abs(r.mid - r.actual) / r.actual > 0.5);
  const extremeBelow = extreme.filter((r) => r.mid > r.actual).length;
  console.log(`\n--- OUTLIER DIAGNOSTIC ---`);
  console.log(`  targets with APE>50%: ${extreme.length} (${pct(extreme.length, N_evaluated).toFixed(1)}% of evaluated)`);
  console.log(`  of those, mid>actual (below-market target): ${extremeBelow} (${pct(extremeBelow, extreme.length).toFixed(1)}%)`);
  console.log(`  => mean MAPE is outlier-dominated; median APE is the robust headline.`);

  // Breakdowns
  const sizeBand = (r) => r.areaSqm < 60 ? "<60" : r.areaSqm < 90 ? "60-89" : r.areaSqm < 120 ? "90-119" : r.areaSqm < 150 ? "120-149" : "150+";
  const compBand = (r) => r.basedOn < 5 ? "3-4" : r.basedOn < 10 ? "5-9" : r.basedOn < 25 ? "10-24" : r.basedOn < 50 ? "25-49" : "50+";
  const ageBand = (r) => { const m = r.medianCompAgeMonths; return m < 12 ? "<12mo" : m < 24 ? "12-24mo" : m < 36 ? "24-36mo" : "36mo+"; };

  const breakdowns = [
    breakdown(results, (r) => r.year, "year"),
    breakdown(results, (r) => r.neighborhood, "neighborhood"),
    breakdown(results, (r) => r.scope, "compSearchScope"),
    breakdown(results, (r) => r.resolutionPath, "resolutionPath"),
    breakdown(results, (r) => r.confidence, "confidence"),
    breakdown(results, compBand, "numComparables"),
    breakdown(results, sizeBand, "propertySizeBand"),
    breakdown(results, ageBand, "compAgeBand"),
  ];
  for (const b of breakdowns) {
    console.log(`\n--- BREAKDOWN: ${b.label} ---`);
    for (const row of b.rows) {
      console.log(`  ${String(row.key).padEnd(22)} n=${String(row.n).padStart(5)}  MAPE=${String(row.mape).padStart(5)}%  medAPE=${String(row.medianAPE).padStart(5)}%  ±10=${String(row.within10).padStart(5)}%  ±20=${String(row.within20).padStart(5)}%  inside=${String(row.insideInterval).padStart(5)}%  medSignErr=${String(row.medianSignedErr).padStart(10)}`);
    }
  }

  // Dump machine-readable results for the report.
  const dump = {
    generatedAt: new Date().toISOString(),
    method: "leak-free as-of-T adapter; strict dealDate<T; alternates excluded; all eligible apartment targets (no sampling)",
    N_eligible, N_evaluated, N_null: nullCount, nullPct: +pct(nullCount, N_eligible).toFixed(2),
    overall,
    subset_2023_2024: computeMetrics(sub2324),
    v1_comparable_2023_2024_ppsqm_ge_8000: computeMetrics(v1comp),
    outlierDiagnostic: { apeGt50: extreme.length, apeGt50Pct: +pct(extreme.length, N_evaluated).toFixed(1), ofWhichBelowMarket: extremeBelow, belowMarketPct: +pct(extremeBelow, extreme.length).toFixed(1) },
    breakdowns,
  };
  writeFileSync("C:\\leads\\audit\\reconciliation\\backtest_v2_results.json", JSON.stringify(dump, null, 2), "utf8");
  console.log("\nWrote audit/reconciliation/backtest_v2_results.json");
}

main();
