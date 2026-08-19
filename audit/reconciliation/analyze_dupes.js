// READ-ONLY forensic analysis of near-duplicate deal candidates.
// Does NOT write, delete, dedupe, or modify deals.json. Only reads + prints.
// Usage: node analyze_dupes.js
'use strict';
const path = require('path');
const DEALS = path.resolve('C:/leads/data/deals.json');
const deals = require(DEALS);

const TOL = 0.05; // ±5% price tolerance (matches prior audit §6)

// ---- helpers ----
const norm = (v) => (v === null || v === undefined || v === '') ? null : String(v).trim();
const withinPct = (a, b, tol) => {
  if (!a || !b) return false;
  return Math.abs(a - b) <= tol * Math.max(a, b);
};

// ---- Step: field inventory ----
const keys = new Set();
for (const r of deals) for (const k of Object.keys(r)) keys.add(k);

// ---- Reproduce candidate groups: same street+houseNumber+dealDate, price within ±5% ----
// Group by (street|houseNumber|dealDate). Require BOTH street and houseNumber present
// (matches prior audit which keyed on street+houseNumber+dealDate).
// NOTE: prior audit (§6) treated a MISSING houseNumber as an empty bucket, i.e. it
// effectively grouped on street+houseNumber(blank-ok)+dealDate (== address+date).
// That is what reproduces its 3,011-pair figure, so we key the same way here.
const groups = new Map();
let missingKeyFields = 0;
for (const r of deals) {
  const st = norm(r.street), dt = norm(r.dealDate);
  if (!st || !dt) { missingKeyFields++; continue; }
  const key = `${st}|${norm(r.houseNumber) ?? ''}|${dt}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

// A "candidate group" = a location+date bucket where at least one pair is within ±5% price.
// Count both PAIRS (prior audit metric) and GROUPS.
let pairCount = 0;
let sameAreaPairs = 0, diffAreaPairs = 0;
const candidateGroups = []; // groups containing >=1 qualifying pair

for (const [key, recs] of groups) {
  if (recs.length < 2) continue;
  let groupHasPair = false;
  const membersInPairs = new Set();
  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      const A = recs[i], B = recs[j];
      if (withinPct(A.price, B.price, TOL)) {
        pairCount++;
        groupHasPair = true;
        membersInPairs.add(i); membersInPairs.add(j);
        const aA = A.areaSqm, aB = B.areaSqm;
        const sameArea = (aA != null && aB != null && Math.abs(aA - aB) < 0.5);
        if (sameArea) sameAreaPairs++; else diffAreaPairs++;
      }
    }
  }
  if (groupHasPair) {
    const members = [...membersInPairs].map(idx => recs[idx]);
    candidateGroups.push({ key, members });
  }
}

// ---- Step 3: classify each candidate group ----
// Available identity fields: id(derived), price, areaSqm, rooms, floor, yearBuilt,
// propertyType, dealNature, address, x, y. NO gush/helka/subparcel/source-id.
const cls = {
  EXACT_DUPLICATE_HIGH_CONFIDENCE: 0,
  LIKELY_DUPLICATE: 0,
  LIKELY_DISTINCT_UNITS: 0,
  AMBIGUOUS: 0,
};
const examples = { EXACT_DUPLICATE_HIGH_CONFIDENCE: [], LIKELY_DUPLICATE: [], LIKELY_DISTINCT_UNITS: [], AMBIGUOUS: [] };

const eq = (a, b) => a != null && b != null && a === b;
const areaEq = (a, b) => a != null && b != null && Math.abs(a - b) < 0.5;

for (const g of candidateGroups) {
  // classify the WHOLE group by its strongest internal pairing signal
  const recs = g.members;
  let label = 'AMBIGUOUS';
  let bestRank = 0; // 0 amb,1 distinct,2 likelydup,3 exact
  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      const A = recs[i], B = recs[j];
      if (!withinPct(A.price, B.price, TOL)) continue;

      const priceIdentical = A.price === B.price;
      const areaSame = areaEq(A.areaSqm, B.areaSqm);
      const areaBothPresent = A.areaSqm != null && B.areaSqm != null;
      const roomsSame = eq(A.rooms, B.rooms);
      const floorDiff = (A.floor != null && B.floor != null && A.floor !== B.floor);
      const areaDiff = (areaBothPresent && !areaSame);
      const roomsDiff = (A.rooms != null && B.rooms != null && A.rooms !== B.rooms && A.rooms !== 0 && B.rooms !== 0);

      const crossNb = A.neighborhoodId !== B.neighborhoodId;
      const ybEq = eq(A.yearBuilt, B.yearBuilt) || (A.yearBuilt === 0 && B.yearBuilt === 0);
      const allIdentityEqual = priceIdentical && areaSame && roomsSame &&
        eq(A.floor, B.floor) && ybEq && A.propertyType === B.propertyType && A.areaSqm != null;

      let rank, lab;
      if (areaDiff || floorDiff || roomsDiff) {
        // provably different physical unit sold same building+date
        rank = 1; lab = 'LIKELY_DISTINCT_UNITS';
      } else if (allIdentityEqual && crossNb) {
        // byte-identical content differing ONLY in the neighborhoodId label:
        // a harvest boundary-overlap artifact (same deal ingested under two
        // neighborhood polygons). Strongest available signal — but still NOT
        // EXACT because no gush/helka/subparcel or stable source id exists.
        rank = 2; lab = 'LIKELY_DUPLICATE';
      } else if (priceIdentical && areaSame && A.areaSqm != null) {
        // same neighborhood + identical price+area: by the id-construction this
        // cannot actually occur (would collapse to one id); kept for completeness.
        rank = 2; lab = 'LIKELY_DUPLICATE';
      } else {
        // price within 5% but not identical, or area missing — cannot decide
        rank = 0; lab = 'AMBIGUOUS';
      }
      if (rank > bestRank) { bestRank = rank; label = lab; }
    }
  }
  cls[label]++;
  if (examples[label].length < 4) {
    examples[label].push({
      key: g.key,
      recs: recs.map(r => ({ id: r.id, price: r.price, area: r.areaSqm, rooms: r.rooms, floor: r.floor, yb: r.yearBuilt }))
    });
  }
}

// EXACT_DUPLICATE_HIGH_CONFIDENCE stays 0: impossible without a stable source id /
// gush-helka-subparcel key, because all ids are unique-by-construction.

// ---- report ----
const out = {
  totalDeals: deals.length,
  fields: [...keys].sort(),
  identityFieldsPresent: {
    gush: keys.has('gush'), helka: keys.has('helka'), subparcel: keys.has('subparcel'),
    dealId: keys.has('dealId'), keyValue: keys.has('keyValue'), stableSourceId: false,
    derivedIdUnique: new Set(deals.map(d => d.id)).size === deals.length,
  },
  recordsSkippedMissingStreetOrHouseNoOrDate: missingKeyFields,
  groupsWithMultipleRecords: [...groups.values()].filter(g => g.length > 1).length,
  nearDuplicatePairs: pairCount,
  pairs_sameArea: sameAreaPairs,
  pairs_diffArea: diffAreaPairs,
  candidateGroups: candidateGroups.length,
  classCounts: cls,
  examples,
};
console.log(JSON.stringify(out, null, 2));
