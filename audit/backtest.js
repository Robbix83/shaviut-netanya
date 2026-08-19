/**
 * backtest.js — Valuation Engine Backtest (Phase 5)
 *
 * Loads deals.json and for each 2023-2024 apartment deal:
 *   1. Removes the target deal from the pool
 *   2. Runs the valuation algorithm inline (JS re-implementation of lib/valuation.ts)
 *   3. Compares predicted range vs. actual price
 *
 * Run: node C:\leads\audit\backtest.js
 */

"use strict";
const fs = require("fs");
const path = require("path");

// ─── Constants (mirrored from lib/valuation.ts) ───────────────────────────────
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function normalizeStreet(s) {
  return s.replace(STREET_PREFIX, "").trim();
}

function cutoffISO(months) {
  const d = new Date("2026-08-19"); // audit date
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

// ITM distance (Euclidean — valid for short distances in Israel)
function itmDistance(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

// Percentile with linear interpolation (matches valuation.ts)
function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (rank - lo) * (sorted[hi] - sorted[lo]);
}

/**
 * Core valuation — apartment only (simplification for backtest).
 * pool: all deals EXCEPT the target deal
 * target: the deal being tested
 * Returns { estimateLow, estimateMid, estimateHigh, compSearchScope, basedOnDeals } or null
 */
function valuate(target, pool) {
  const minPpsqm = MIN_PPSQM_APARTMENT;
  const cutoffGeo = cutoffISO(GEO_MONTHS);

  // 1. Build neighborhood pool (same neighborhood, apartment, within 60 months)
  const geoPool = pool.filter(
    (d) =>
      d.neighborhoodId === target.neighborhoodId &&
      (d.propertyType ?? "apartment") === "apartment" &&
      d.dealDate >= cutoffGeo
  );

  // 2. Room subset (±1 room)
  const roomSubset =
    target.rooms != null
      ? geoPool.filter((d) => d.rooms != null && Math.abs(d.rooms - target.rooms) <= 1)
      : geoPool;
  const geoPoolEffective =
    roomSubset.length >= MIN_DEALS_FOR_ROOM_FILTER ? roomSubset : geoPool;

  // 3. Neighborhood window fallback (most recent window with ≥3 deals)
  let deals = geoPoolEffective;
  let windowMonths = GEO_MONTHS;
  for (const months of WINDOWS) {
    const cutoff = cutoffISO(months);
    const recent = geoPool.filter((d) => d.dealDate >= cutoff);
    const roomRecent =
      target.rooms != null
        ? recent.filter((d) => d.rooms != null && Math.abs(d.rooms - target.rooms) <= 1)
        : recent;
    deals = roomRecent.length >= MIN_DEALS_FOR_ROOM_FILTER ? roomRecent : recent;
    windowMonths = months;
    if (deals.length >= MIN_DEALS_FOR_ESTIMATE) break;
  }

  // 4. Age filter helper
  const ageFilter = (ds, toleranceYrs) => {
    if (target.yearBuilt == null) return ds;
    const filtered = ds.filter(
      (d) => d.yearBuilt != null && Math.abs(d.yearBuilt - target.yearBuilt) <= toleranceYrs
    );
    return filtered.length >= MIN_DEALS_FOR_ESTIMATE ? filtered : ds;
  };

  // 5. Street name helpers
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
    return onStreet.filter((d) => {
      const dhn = parseInt(d.houseNumber ?? "");
      return !isNaN(dhn) && dhn === hn;
    });
  };

  const byBuildingNumber = (p) => {
    const onStreet = byStreetName(p);
    if (!target.houseNumber || onStreet.length === 0) return [];
    const hn = parseInt(target.houseNumber);
    if (isNaN(hn)) return onStreet;
    return onStreet.filter((d) => {
      const dhn = parseInt(d.houseNumber ?? "");
      return !isNaN(dhn) && Math.abs(dhn - hn) <= HOUSE_NUMBER_RANGE;
    });
  };

  // 6. Text-based hierarchy: exact building → near building (±12) → full street
  let compSearchScope = "neighborhood";

  if (inputStreetNorm) {
    const exactBuilding = ageFilter(byExactBuilding(geoPoolEffective), AGE_TOLERANCES.building);
    if (exactBuilding.length >= MIN_DEALS_FOR_ESTIMATE) {
      deals = exactBuilding;
      compSearchScope = "building";
      windowMonths = GEO_MONTHS;
    } else {
      const nearStreet = ageFilter(byBuildingNumber(geoPoolEffective), AGE_TOLERANCES.street);
      if (nearStreet.length >= MIN_DEALS_FOR_ESTIMATE) {
        deals = nearStreet;
        compSearchScope = "street";
        windowMonths = GEO_MONTHS;
      } else {
        const street = ageFilter(byStreetName(geoPoolEffective), AGE_TOLERANCES.street);
        if (street.length >= MIN_DEALS_FOR_ESTIMATE) {
          deals = street;
          compSearchScope = "street";
          windowMonths = GEO_MONTHS;
        }
      }
    }
  }

  // 7. Geo-based hierarchy (if we have coordinates)
  if (target.x != null && target.y != null) {
    const located = geoPoolEffective.filter((d) => d.x != null && d.y != null);
    const unlocated = geoPoolEffective.filter((d) => d.x == null || d.y == null);

    const filterByRadius = (R) =>
      located.filter((d) => itmDistance(target.x, target.y, d.x, d.y) <= R);

    if (compSearchScope !== "building") {
      const withinBuilding = filterByRadius(BUILDING_RADIUS);
      const sameStreetInBuilding = inputStreetNorm
        ? withinBuilding.filter((d) => {
            if (!d.street) return false;
            const ds = normalizeStreet(d.street);
            return ds === inputStreetNorm || inputStreetNorm.includes(ds);
          })
        : withinBuilding;
      const inBuilding = ageFilter(
        sameStreetInBuilding.length >= MIN_DEALS_FOR_ESTIMATE
          ? sameStreetInBuilding
          : withinBuilding,
        AGE_TOLERANCES.building
      );
      if (inBuilding.length >= MIN_DEALS_FOR_ESTIMATE) {
        deals = inBuilding.concat(unlocated);
        compSearchScope = "building";
        windowMonths = GEO_MONTHS;
      }
    }

    if (compSearchScope !== "building" && compSearchScope !== "street") {
      const onStreet = ageFilter(filterByRadius(STREET_RADIUS), AGE_TOLERANCES.street);
      if (onStreet.length >= MIN_DEALS_FOR_FLOOR_FILTER) {
        deals = onStreet.concat(unlocated);
        compSearchScope = "radius";
        windowMonths = GEO_MONTHS;
      }
    }

    if (compSearchScope === "neighborhood") {
      for (const R of COMP_RADIUS_LADDER) {
        const within = ageFilter(filterByRadius(R), AGE_TOLERANCES.radius);
        if (within.length >= MIN_DEALS_FOR_FLOOR_FILTER) {
          deals = within.concat(unlocated);
          compSearchScope = "radius";
          windowMonths = GEO_MONTHS;
          break;
        }
      }
    }
  }

  // 8. Floor filter (±2, apartments only, ≥5 needed)
  if (target.floor != null) {
    const fs = deals.filter(
      (d) => d.floor != null && Math.abs(d.floor - target.floor) <= FLOOR_TOLERANCE
    );
    if (fs.length >= MIN_DEALS_FOR_FLOOR_FILTER) {
      deals = fs;
    }
  }

  // 9. Area filter (±50%, ≥3 needed)
  if (target.areaSqm != null && target.areaSqm > 0) {
    const areaMin = target.areaSqm * (1 - AREA_TOLERANCE_RATIO);
    const areaMax = target.areaSqm * (1 + AREA_TOLERANCE_RATIO);
    const areaFiltered = deals.filter(
      (d) => d.areaSqm != null && d.areaSqm >= areaMin && d.areaSqm <= areaMax
    );
    if (areaFiltered.length >= MIN_DEALS_FOR_ESTIMATE) deals = areaFiltered;
  }

  // 10. MIN_PPSQM filter + collect ppsqm values
  const ppsqm = deals
    .map((d) => d.pricePerSqm)
    .filter((v) => v != null && v >= minPpsqm && isFinite(v));

  if (ppsqm.length < MIN_DEALS_FOR_ESTIMATE) return null;

  // 11. Percentile ranges by scope
  const scopePct =
    compSearchScope === "building"
      ? { lo: 20, hi: 80 }
      : compSearchScope === "street"
      ? { lo: 25, hi: 75 }
      : { lo: 33, hi: 67 };

  const lo = percentile(ppsqm, scopePct.lo);
  const mid = percentile(ppsqm, 50);
  const hi = percentile(ppsqm, scopePct.hi);

  const size = target.areaSqm;
  if (!size || size <= 0) return null;

  const round = (n) => Math.round(n / 1000) * 1000;

  return {
    estimateLow: round(size * lo),
    estimateMid: round(size * mid),
    estimateHigh: round(size * hi),
    pricePerSqmLo: Math.round(lo),
    pricePerSqmMid: Math.round(mid),
    pricePerSqmHi: Math.round(hi),
    compSearchScope,
    basedOnDeals: ppsqm.length,
    windowMonths,
  };
}

// ─── Main Backtest ─────────────────────────────────────────────────────────────
function runBacktest() {
  console.log("Loading deals.json...");
  const deals = JSON.parse(
    fs.readFileSync(path.join("C:\\leads\\data\\deals.json"), "utf8")
  );
  console.log(`Total deals: ${deals.length}`);

  // Test set: 2023-2024 apartments with area, price, pricePerSqm
  const testDeals = deals.filter(
    (d) =>
      d.dealDate >= "2023-01-01" &&
      d.dealDate <= "2024-12-31" &&
      (d.propertyType ?? "apartment") === "apartment" &&
      d.areaSqm != null &&
      d.areaSqm > 0 &&
      d.price > 0 &&
      d.pricePerSqm != null &&
      d.pricePerSqm >= MIN_PPSQM_APARTMENT
  );

  console.log(`Test set (2023-2024 apartments): ${testDeals.length}`);

  // Subsample for speed: use every 5th deal (still ~700 samples)
  const sample = testDeals.filter((_, i) => i % 5 === 0);
  console.log(`Subsampled (every 5th): ${sample.length}\n`);

  // Build index of deal ids for fast exclusion
  const results = [];
  let evaluated = 0;
  let nullResults = 0;

  for (const target of sample) {
    // Pool = all deals EXCEPT this target
    const pool = deals.filter((d) => d.id !== target.id);
    const val = valuate(target, pool);

    if (val === null) {
      nullResults++;
      continue;
    }

    evaluated++;
    const actual = target.price;
    const inside = actual >= val.estimateLow && actual <= val.estimateHigh;
    const absDiff = Math.abs(actual - val.estimateMid);
    const pctDiff = absDiff / actual;
    const withinTen = pctDiff <= 0.10;
    const withinTwenty = pctDiff <= 0.20;

    results.push({
      scope: val.compSearchScope,
      confidence:
        val.basedOnDeals >= 25 ? "high" : val.basedOnDeals >= 10 ? "medium" : "low",
      inside,
      absDiff,
      pctDiff,
      withinTen,
      withinTwenty,
      actual,
      mid: val.estimateMid,
      lo: val.estimateLow,
      hi: val.estimateHigh,
      basedOn: val.basedOnDeals,
    });
  }

  console.log(`Evaluated: ${evaluated}`);
  console.log(`Null results (no estimate): ${nullResults}`);
  console.log(`Null rate: ${((nullResults / sample.length) * 100).toFixed(1)}%\n`);

  // ─── Overall metrics ─────────────────────────────────────────────────────
  const inside = results.filter((r) => r.inside).length;
  const absDiffs = results.map((r) => r.absDiff).sort((a, b) => a - b);
  const mae = absDiffs.reduce((s, v) => s + v, 0) / absDiffs.length;
  const medianAE = absDiffs[Math.floor(absDiffs.length / 2)];
  const mape =
    (results.reduce((s, r) => s + r.pctDiff, 0) / results.length) * 100;
  const withinTen = results.filter((r) => r.withinTen).length;
  const withinTwenty = results.filter((r) => r.withinTwenty).length;

  console.log("=== OVERALL METRICS ===");
  console.log(`  Evaluated: ${evaluated}`);
  console.log(`  % actual inside [lo, hi]: ${((inside / evaluated) * 100).toFixed(1)}%`);
  console.log(`  MAE (₪): ${Math.round(mae).toLocaleString()}`);
  console.log(`  Median AE (₪): ${Math.round(medianAE).toLocaleString()}`);
  console.log(`  MAPE: ${mape.toFixed(1)}%`);
  console.log(`  % within ±10% of mid: ${((withinTen / evaluated) * 100).toFixed(1)}%`);
  console.log(`  % within ±20% of mid: ${((withinTwenty / evaluated) * 100).toFixed(1)}%`);

  // ─── By compSearchScope ───────────────────────────────────────────────────
  console.log("\n=== BY SCOPE ===");
  const scopes = ["building", "street", "radius", "neighborhood"];
  for (const sc of scopes) {
    const sub = results.filter((r) => r.scope === sc);
    if (sub.length === 0) continue;
    const insideSub = sub.filter((r) => r.inside).length;
    const mapeSub = (sub.reduce((s, r) => s + r.pctDiff, 0) / sub.length) * 100;
    const w10 = sub.filter((r) => r.withinTen).length;
    const w20 = sub.filter((r) => r.withinTwenty).length;
    const medianAESub =
      sub
        .map((r) => r.absDiff)
        .sort((a, b) => a - b)[Math.floor(sub.length / 2)];
    console.log(`  ${sc} (n=${sub.length}):`);
    console.log(
      `    inside range: ${((insideSub / sub.length) * 100).toFixed(1)}%  MAPE: ${mapeSub.toFixed(1)}%  MedianAE: ₪${Math.round(medianAESub).toLocaleString()}  ±10%: ${((w10/sub.length)*100).toFixed(1)}%  ±20%: ${((w20/sub.length)*100).toFixed(1)}%`
    );
  }

  // ─── By confidence ─────────────────────────────────────────────────────────
  console.log("\n=== BY CONFIDENCE ===");
  const confidences = ["high", "medium", "low"];
  for (const c of confidences) {
    const sub = results.filter((r) => r.confidence === c);
    if (sub.length === 0) continue;
    const insideSub = sub.filter((r) => r.inside).length;
    const mapeSub = (sub.reduce((s, r) => s + r.pctDiff, 0) / sub.length) * 100;
    const w10 = sub.filter((r) => r.withinTen).length;
    const medianAESub =
      sub
        .map((r) => r.absDiff)
        .sort((a, b) => a - b)[Math.floor(sub.length / 2)];
    console.log(`  ${c} (n=${sub.length}):`);
    console.log(
      `    inside range: ${((insideSub / sub.length) * 100).toFixed(1)}%  MAPE: ${mapeSub.toFixed(1)}%  MedianAE: ₪${Math.round(medianAESub).toLocaleString()}  ±10%: ${((w10/sub.length)*100).toFixed(1)}%`
    );
  }

  // ─── Failure analysis ─────────────────────────────────────────────────────
  console.log("\n=== WORST MISSES (actual vs. predicted mid, >40% off) ===");
  const bigMisses = results
    .filter((r) => r.pctDiff > 0.4)
    .sort((a, b) => b.pctDiff - a.pctDiff)
    .slice(0, 10);
  for (const m of bigMisses) {
    console.log(
      `  actual=₪${m.actual.toLocaleString()}  mid=₪${m.mid.toLocaleString()}  diff=${(m.pctDiff * 100).toFixed(0)}%  scope=${m.scope}  basedOn=${m.basedOn}`
    );
  }

  // ─── Scope distribution ────────────────────────────────────────────────────
  console.log("\n=== SCOPE DISTRIBUTION ===");
  for (const sc of scopes) {
    const n = results.filter((r) => r.scope === sc).length;
    console.log(`  ${sc}: ${n} (${((n / results.length) * 100).toFixed(1)}%)`);
  }
  console.log(`  null/no-estimate: ${nullResults} (${((nullResults / sample.length) * 100).toFixed(1)}%)`);

  // Return summary object for programmatic use
  return {
    evaluated,
    nullResults,
    insideRangePct: (inside / evaluated) * 100,
    mae: Math.round(mae),
    medianAE: Math.round(medianAE),
    mape,
    withinTenPct: (withinTen / evaluated) * 100,
    withinTwentyPct: (withinTwenty / evaluated) * 100,
  };
}

runBacktest();
