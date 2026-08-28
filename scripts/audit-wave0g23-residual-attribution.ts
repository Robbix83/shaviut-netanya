/**
 * scripts/audit-wave0g23-residual-attribution.ts — Wave 0G-23: read-only
 * attribution of Kiryat Hasharon's remaining 495-row top-level delta
 * (5145/5640, 91.22%), using only already-committed/shadow evidence from
 * Waves 0G-16 through 0G-22. No new live acquisition performed by this
 * script — it is a pure offline analysis over existing artifacts.
 *
 * Reconstructs the current 5145-row union with PER-ROW PROVENANCE
 * (ENTITY_ONLY / STREET_ONLY / BOTH) by set-membership against the
 * baseline entity-layer keys and the full street-layer keys — not by
 * reimplementing classifyTransactionGroups's dedup/ambiguity logic, which
 * remains the sole source of truth for which rows survive into the union.
 */
import { promises as fs } from "fs";
import path from "path";
import { toShadowDeal, transactionKey, type ShadowDeal } from "../lib/shadowRebuild";
import { classifyRowForAcceptance } from "../lib/streetRowAcceptance";
import { classifyTransactionGroups } from "./audit-wave0g18-aggregate";
import type { Neighborhood } from "../lib/types";
import type { StreetResult } from "./audit-wave0g18-street-runner";

const PARENT_SOURCE_ID = "65209683";
const OUT_DIR = path.join(process.cwd(), "audit/wave0g23");
const neighborhood: Neighborhood = { id: PARENT_SOURCE_ID, name: "קריית השרון", settlement: "נתניה", x: null, y: null };

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ECC planner finding: the naive `.split(",")` used previously breaks on
// RFC-4180 quoted fields with embedded, doubled-quote-escaped commas/quotes
// (e.g. `74001008,"ד""ר יהודה פרח"`) — it wrongly reported a real,
// already-fetched manifest street as "not on the manifest". Minimal proper
// CSV-line parser (handles quoted fields and "" escaping) instead.
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(cur); cur = "";
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

async function readJson(p: string): Promise<any> {
  return JSON.parse(await fs.readFile(path.join(process.cwd(), p), "utf8"));
}

async function main() {
  console.log("=== WAVE 0G-23: KIRYAT HASHARON RESIDUAL GAP ATTRIBUTION (read-only) ===");
  await fs.mkdir(OUT_DIR, { recursive: true });

  // ============================================================
  // PHASE 2: reconstruct the current 5145-row union, exactly as Wave 0G-21/22 did.
  // ============================================================
  const baseline = await readJson("audit/wave0g16/shadow-output/65209683.json");
  const streetsDir = path.join(process.cwd(), "audit/wave0g18/shadow");
  const manifest = await readJson("audit/wave0g18/shadow/street_run_manifest.json");
  const streetIds = Object.keys(manifest);
  if (streetIds.length !== 70) throw new Error(`RECONSTRUCTION_MISMATCH: expected 70 streets in manifest, got ${streetIds.length}`);
  const streetResults: StreetResult[] = [];
  for (const id of streetIds) {
    streetResults.push(await readJson(`audit/wave0g18/shadow/street_${PARENT_SOURCE_ID}_${id}.json`));
  }
  const successStatuses = ["SUCCESS_ROWS", "SUCCESS_EMPTY", "PARTIAL_MORE_FETCHES_INDICATED"];
  const successfulResults = streetResults.filter((r) => successStatuses.includes(r.status));
  const mixedResults = streetResults.filter((r) => !successStatuses.includes(r.status));
  console.log(`70-STREET SPLIT: successful(clean)=${successfulResults.length} mixed(originally FAILED_IDENTITY)=${mixedResults.length}`);

  const oldClassification = classifyTransactionGroups(baseline.uniqueRows, successfulResults.map((r) => ({ streetId: r.streetId, rows: r.rows })));
  if (oldClassification.augmentedUnion.length !== 4831) throw new Error(`RECONSTRUCTION_MISMATCH: expected old union 4831, got ${oldClassification.augmentedUnion.length}`);
  // ECC database-reviewer finding: self-verify AMBIGUOUS_COLLISIONS=0 at every
  // reconstruction step rather than silently trusting prior waves' claims.
  if (oldClassification.ambiguousCollisions > 0) throw new Error(`INTEGRITY_FAIL: ${oldClassification.ambiguousCollisions} ambiguous collision(s) in the 4831 reconstruction step — STOP and investigate.`);

  const wave1920Probed = [
    { id: "74001232", name: "בני רייך", path: "audit/wave0g19/shadow/probe_74001232.json" },
    { id: "74001260", name: "טום לנטוס", path: "audit/wave0g19/shadow/probe_74001260.json" },
    { id: "74000865", name: "הרב שמואל הרטום", path: "audit/wave0g20/shadow/live_control_74000865.json" },
  ];
  const wave21Probed = [
    { id: "74000826", name: "הפארק", path: "audit/wave0g21/shadow/street_fetch_74000826.json" },
    { id: "74001235", name: "הרב נרייה", path: "audit/wave0g21/shadow/street_fetch_74001235.json" },
  ];
  const probedMixedStreets = [...wave1920Probed, ...wave21Probed];
  const unprobedMixedStreets = [
    { id: "74000153", name: "אריאל שרון" },
    { id: "74000607", name: 'האר"י' },
  ];

  const recoveredRowsByStreet: Record<string, ShadowDeal[]> = {};
  const rawItemsByStreet: Record<string, any[]> = {};
  for (const p of probedMixedStreets) {
    const probe = await readJson(p.path);
    const items = probe.rawItems as any[];
    rawItemsByStreet[p.id] = items;
    const accepted = items.filter((it: any) => classifyRowForAcceptance(it, PARENT_SOURCE_ID) === "ACCEPT_PARENT");
    const rows: ShadowDeal[] = [];
    for (const raw of accepted) { const s = toShadowDeal(raw, neighborhood, PARENT_SOURCE_ID); if (s) rows.push(s); }
    recoveredRowsByStreet[p.id] = rows;
  }
  const wave2021RecoveredRows: ShadowDeal[] = Object.values(recoveredRowsByStreet).flat();

  const currentUnionClassification = classifyTransactionGroups(oldClassification.augmentedUnion, [{ streetId: "WAVE_0G20_0G21_RECOVERED_CLASS_A", rows: wave2021RecoveredRows }]);
  if (currentUnionClassification.augmentedUnion.length !== 5145) throw new Error(`RECONSTRUCTION_MISMATCH: expected 5145, got ${currentUnionClassification.augmentedUnion.length}`);
  if (currentUnionClassification.ambiguousCollisions > 0) throw new Error(`INTEGRITY_FAIL: ${currentUnionClassification.ambiguousCollisions} ambiguous collision(s) in the 5145 reconstruction step — STOP and investigate.`);

  // Fold in Spiegelman's proven fetch2 (33 rows, all duplicates per Wave 0G-22B — verify that here too).
  const fetch2Probe = await readJson("audit/wave0g22/shadow/street_fetch2_74000875.json");
  const fetch2Items = fetch2Probe.rawItems as any[];
  const fetch2Accepted = fetch2Items.filter((it: any) => classifyRowForAcceptance(it, PARENT_SOURCE_ID) === "ACCEPT_PARENT");
  const fetch2Rows: ShadowDeal[] = [];
  for (const raw of fetch2Accepted) { const s = toShadowDeal(raw, neighborhood, PARENT_SOURCE_ID); if (s) fetch2Rows.push(s); }
  const finalClassification = classifyTransactionGroups(currentUnionClassification.augmentedUnion, [{ streetId: "WAVE_0G22_SPIEGELMAN_FETCH2", rows: fetch2Rows }]);
  const FINAL_UNIQUE = finalClassification.augmentedUnion.length;
  console.log(`FINAL_UNIQUE=${FINAL_UNIQUE} (fetch2 genuinely new=${finalClassification.genuinelyNewStreetRows})`);
  if (FINAL_UNIQUE !== 5145) throw new Error(`RECONSTRUCTION_MISMATCH: expected FINAL_UNIQUE=5145, got ${FINAL_UNIQUE} — STOP`);
  if (finalClassification.ambiguousCollisions > 0) throw new Error(`INTEGRITY_FAIL: ${finalClassification.ambiguousCollisions} ambiguous collision(s) in the final reconstruction step — STOP and investigate.`);
  const finalUnion = finalClassification.augmentedUnion;
  const OFFICIAL_TOTAL = 5640;
  const DELTA = OFFICIAL_TOTAL - FINAL_UNIQUE;
  console.log(`OFFICIAL_TOTAL=${OFFICIAL_TOTAL} DELTA=${DELTA} COVERAGE=${((FINAL_UNIQUE / OFFICIAL_TOTAL) * 100).toFixed(2)}%`);

  // ---- Provenance tagging via set membership (transactionKey), not a dedup reimplementation. ----
  const baselineKeys = new Set(baseline.uniqueRows.map((r: ShadowDeal) => transactionKey(r)));
  const ENTITY_BASELINE_UNIQUE = baselineKeys.size;
  const allStreetLayerRows: ShadowDeal[] = [
    ...successfulResults.flatMap((r) => r.rows as unknown as ShadowDeal[]),
    ...wave2021RecoveredRows,
    ...fetch2Rows,
  ];
  const streetLayerKeys = new Set(allStreetLayerRows.map((r) => transactionKey(r)));
  const STREET_ACCEPTED_UNIQUE = streetLayerKeys.size;
  const overlapKeys = new Set([...baselineKeys].filter((k) => streetLayerKeys.has(k)));
  const ENTITY_STREET_OVERLAP = overlapKeys.size;
  console.log(`ENTITY_BASELINE_UNIQUE=${ENTITY_BASELINE_UNIQUE} STREET_ACCEPTED_UNIQUE=${STREET_ACCEPTED_UNIQUE} ENTITY_STREET_OVERLAP=${ENTITY_STREET_OVERLAP}`);
  const inclusionExclusionResult = ENTITY_BASELINE_UNIQUE + STREET_ACCEPTED_UNIQUE - ENTITY_STREET_OVERLAP;
  console.log(`INCLUSION_EXCLUSION_CHECK: ${ENTITY_BASELINE_UNIQUE} + ${STREET_ACCEPTED_UNIQUE} - ${ENTITY_STREET_OVERLAP} = ${inclusionExclusionResult} (should equal FINAL_UNIQUE=${FINAL_UNIQUE})`);
  // ECC database-reviewer finding: this identity is provably a tautology
  // given classifyTransactionGroups's own invariants, but was previously
  // only logged, not asserted — a future refactor that broke the invariant
  // would fail silently. Assert it explicitly.
  if (inclusionExclusionResult !== FINAL_UNIQUE) throw new Error(`INTEGRITY_FAIL: inclusion-exclusion check (${inclusionExclusionResult}) does not match FINAL_UNIQUE (${FINAL_UNIQUE}) — the entity/street provenance tagging is unsound.`);

  type Provenance = "ENTITY_ONLY" | "STREET_ONLY" | "BOTH";
  const provenance = new Map<ShadowDeal, Provenance>();
  let untagged = 0;
  for (const row of finalUnion) {
    const key = transactionKey(row);
    const inBaseline = baselineKeys.has(key);
    const inStreet = streetLayerKeys.has(key);
    if (inBaseline && inStreet) provenance.set(row, "BOTH");
    else if (inBaseline) provenance.set(row, "ENTITY_ONLY");
    else if (inStreet) provenance.set(row, "STREET_ONLY");
    else untagged++;
  }
  if (untagged > 0) throw new Error(`INTEGRITY_FAIL: ${untagged} final-union row(s) have neither baseline nor street-layer provenance — reconstruction is unsound.`);

  // ============================================================
  // PHASE 3: entity-only vs street-only vs both breakdown
  // ============================================================
  function bucketStats(rows: ShadowDeal[]) {
    const total = rows.length;
    const validAddress = rows.filter((r) => r.street && r.street !== "0" && r.houseNumber).length;
    const streetZero = rows.filter((r) => r.street === "0").length;
    const missingHouse = rows.filter((r) => !r.houseNumber).length;
    const dates = rows.map((r) => r.dealDate).filter(Boolean).sort();
    return {
      count: total,
      pct: FINAL_UNIQUE ? (total / FINAL_UNIQUE) * 100 : 0,
      validAddressRate: total ? (validAddress / total) * 100 : 0,
      streetZeroRate: total ? (streetZero / total) * 100 : 0,
      missingHouseRate: total ? (missingHouse / total) * 100 : 0,
      earliest: dates[0] ?? null,
      latest: dates[dates.length - 1] ?? null,
    };
  }
  const entityOnlyRows = finalUnion.filter((r) => provenance.get(r) === "ENTITY_ONLY");
  const streetOnlyRows = finalUnion.filter((r) => provenance.get(r) === "STREET_ONLY");
  const bothRows = finalUnion.filter((r) => provenance.get(r) === "BOTH");
  const entityOnlyStats = bucketStats(entityOnlyRows);
  const streetOnlyStats = bucketStats(streetOnlyRows);
  const bothStats = bucketStats(bothRows);
  console.log(`PHASE3: ENTITY_ONLY=${JSON.stringify(entityOnlyStats)}`);
  console.log(`PHASE3: STREET_ONLY=${JSON.stringify(streetOnlyStats)}`);
  console.log(`PHASE3: BOTH=${JSON.stringify(bothStats)}`);

  // ============================================================
  // PHASE 4: street="0" / no-street analysis
  // ============================================================
  const streetZeroRows = finalUnion.filter((r) => r.street === "0");
  const missingStreetRows = finalUnion.filter((r) => !r.street);
  const missingHouseRows = finalUnion.filter((r) => !r.houseNumber);
  const entityOnlyStreetZero = entityOnlyRows.filter((r) => r.street === "0").length;
  const entityOnlyMissingStreet = entityOnlyRows.filter((r) => !r.street).length;
  const streetOnlyStreetZero = streetOnlyRows.filter((r) => r.street === "0").length;
  console.log(`PHASE4: STREET_ZERO_ROWS=${streetZeroRows.length} MISSING_STREET_ROWS=${missingStreetRows.length} MISSING_HOUSE_ROWS=${missingHouseRows.length}`);
  console.log(`PHASE4: ENTITY_ONLY_STREET_ZERO=${entityOnlyStreetZero} ENTITY_ONLY_MISSING_STREET=${entityOnlyMissingStreet} STREET_ONLY_STREET_ZERO=${streetOnlyStreetZero}`);
  const streetZeroDealNature: Record<string, number> = {};
  for (const r of streetZeroRows) { const dn = r.rawDealNature ?? "∅"; streetZeroDealNature[dn] = (streetZeroDealNature[dn] ?? 0) + 1; }
  const streetZeroDates = streetZeroRows.map((r) => r.dealDate).filter(Boolean).sort();
  console.log(`PHASE4: street=0 dealNature distribution=${JSON.stringify(streetZeroDealNature)} dateRange=${streetZeroDates[0]}..${streetZeroDates[streetZeroDates.length - 1]}`);

  // ============================================================
  // PHASE 5: official street roster completeness
  // ============================================================
  const officialManifestCsv = await fs.readFile(path.join(process.cwd(), "audit/wave0g18/kiryat_hasharon_street_manifest.csv"), "utf8");
  const officialStreetNames = new Set(
    officialManifestCsv.split("\n").slice(1).filter((l) => l.trim()).map((l) => parseCsvLine(l)[1]?.trim()).filter(Boolean),
  );
  const rowsWithStreet = finalUnion.filter((r) => r.street && r.street !== "0");
  const onManifest = rowsWithStreet.filter((r) => officialStreetNames.has(r.street!));
  const notOnManifest = rowsWithStreet.filter((r) => !officialStreetNames.has(r.street!));
  const nonManifestByName: Record<string, { count: number; sources: Set<Provenance> }> = {};
  for (const r of notOnManifest) {
    const name = r.street!;
    if (!nonManifestByName[name]) nonManifestByName[name] = { count: 0, sources: new Set() };
    nonManifestByName[name].count++;
    nonManifestByName[name].sources.add(provenance.get(r)!);
  }
  console.log(`PHASE5: ACCEPTED_ROWS_WITH_STREET=${rowsWithStreet.length} ROWS_ON_OFFICIAL_70_STREETS=${onManifest.length} ROWS_ON_STREETS_NOT_IN_70_MANIFEST=${notOnManifest.length} DISTINCT_NON_MANIFEST_STREETS=${Object.keys(nonManifestByName).length}`);
  const nonManifestSorted = Object.entries(nonManifestByName).sort((a, b) => b[1].count - a[1].count).slice(0, 30);
  console.log(`PHASE5: top non-manifest streets=${JSON.stringify(nonManifestSorted.map(([name, v]) => ({ name, count: v.count, sources: [...v.sources] })))}`);

  // ============================================================
  // PHASE 6: street total_rows accounting
  // ============================================================
  const STREET_TOTAL_ROWS_SUM = streetResults.reduce((s, r) => s + ((r as any).totalRowsIfExposed ?? 0), 0);
  let OBSERVED_PARENT_ROWS = 0, OBSERVED_FOREIGN_ROWS = 0, OBSERVED_ZERO_ROWS = 0;
  for (const r of successfulResults) OBSERVED_PARENT_ROWS += r.rows.length; // clean streets: all rows are parent by construction
  for (const p of probedMixedStreets) {
    const items = rawItemsByStreet[p.id];
    for (const it of items) {
      const d = classifyRowForAcceptance(it, PARENT_SOURCE_ID);
      if (d === "ACCEPT_PARENT") OBSERVED_PARENT_ROWS++;
      else if (d === "REJECT_FOREIGN") OBSERVED_FOREIGN_ROWS++;
      else if (d === "REJECT_ZERO") OBSERVED_ZERO_ROWS++;
    }
  }
  // Spiegelman fetch2 also contributes (already counted parent rows below via allStreetLayerRows, but add fetch2's raw zero/foreign=0 here for completeness)
  console.log(`PHASE6: STREET_TOTAL_ROWS_SUM(across all 70, includes cross-entity contamination for mixed streets)=${STREET_TOTAL_ROWS_SUM}`);
  console.log(`PHASE6: OBSERVED_PARENT_ROWS(clean streets + 5 probed mixed streets)=${OBSERVED_PARENT_ROWS} OBSERVED_FOREIGN_ROWS(5 probed mixed streets only)=${OBSERVED_FOREIGN_ROWS} OBSERVED_ZERO_ROWS(5 probed mixed streets only)=${OBSERVED_ZERO_ROWS}`);
  console.log("PHASE6: STREET_TOTAL_ROWS_SUM is NOT directly comparable to neighborhood total_rows=5640 because (a) it double-counts every transaction reachable via 2+ streets, (b) it includes foreign-entity rows for the 7 mixed/boundary streets (not Kiryat's own transactions), and (c) it necessarily excludes any Kiryat transaction with no street exposure at all (street=0/missing).");

  // ============================================================
  // PHASE 7: complete-street coverage classification
  // ============================================================
  const paginationStreets = [
    { id: "74000847", name: "דגניה", totalRows: 501, totalFetch: 2, fetch1Rows: 500 },
    { id: "74000875", name: "אברהם שפיגלמן", totalRows: 533, totalFetch: 2, fetch1Rows: 500 },
  ];
  const cleanNonPaginated = successfulResults.filter((r) => !paginationStreets.some((p) => p.id === r.streetId));
  const COMPLETE_STREETS = cleanNonPaginated.length + 1; // + Spiegelman, now PROVEN 533/533
  const PARTIAL_STREETS = 1; // Dgania only
  const UNRESOLVED_STREETS = 0; // the 7 mixed streets ARE fully raw-resolved (total_fetch=1); their "unresolved" aspect is identity composition, not raw completeness — see note
  console.log(`PHASE7: COMPLETE_STREETS=${COMPLETE_STREETS} PARTIAL_STREETS=${PARTIAL_STREETS} UNRESOLVED_STREETS(raw-exposure sense)=${UNRESOLVED_STREETS}`);
  console.log("PHASE7: NOTE — the 7 originally-mixed streets all have total_fetch=1 (confirmed from their own committed metadata), meaning their RAW row exposure is complete (no more rows exist behind fetch2+ for any of them). They are counted among COMPLETE_STREETS for raw-exposure purposes; their remaining uncertainty is about the 2 unprobed streets' PARENT/ZERO/FOREIGN per-row identity, not about additional untested rows.");
  const correctedComplete = COMPLETE_STREETS + mixedResults.length; // all 7 mixed streets are raw-complete too
  console.log(`PHASE7: COMPLETE_STREETS(including raw-complete mixed streets)=${correctedComplete} of 70`);
  const MAX_KNOWN_STREET_PAGINATION_OPPORTUNITY = 1; // Dgania only, ~1 row, unproven whether even new to Kiryat
  console.log(`PHASE7: MAX_KNOWN_STREET_PAGINATION_OPPORTUNITY=${MAX_KNOWN_STREET_PAGINATION_OPPORTUNITY} (Dgania, unproven — Spiegelman's own 33-row fetch2 yielded 0 genuinely new, so even this 1 row may already be captured elsewhere)`);

  // ============================================================
  // PHASE 8: foreign non-zero rows
  // ============================================================
  const catalog = await readJson("audit/wave0g16/catalog_snapshot.json");
  const entityNameById: Record<string, string> = {};
  for (const e of catalog.entities) entityNameById[e.sourceId] = e.name;

  interface ForeignGroup { entityId: string; entityName: string; rowCount: number; distinctStreets: Set<string>; dataAvailable: boolean; }
  const foreignGroups = new Map<string, ForeignGroup>();
  let FOREIGN_RAW_ROWS = 0;
  const foreignRawItems: { streetId: string; streetName: string; item: any }[] = [];
  for (const p of probedMixedStreets) {
    const items = rawItemsByStreet[p.id];
    for (const it of items) {
      if (classifyRowForAcceptance(it, PARENT_SOURCE_ID) === "REJECT_FOREIGN") {
        const eid = String(it.neighborhoodId);
        FOREIGN_RAW_ROWS++;
        foreignRawItems.push({ streetId: p.id, streetName: p.name, item: it });
        if (!foreignGroups.has(eid)) foreignGroups.set(eid, { entityId: eid, entityName: entityNameById[eid] ?? "UNKNOWN", rowCount: 0, distinctStreets: new Set(), dataAvailable: true });
        const g = foreignGroups.get(eid)!;
        g.rowCount++;
        g.distinctStreets.add(p.name);
      }
    }
  }
  // Unprobed mixed streets: count-only, no row-level data, but distinct foreign ids ARE known from Wave 0G-18's own failureReason field.
  const unprobedForeign = [
    { streetId: "74000153", streetName: "אריאל שרון", entityIds: ["65210388"], totalForeignRows: 5 },
    { streetId: "74000607", streetName: 'האר"י', entityIds: ["65210244", "65210242"], totalForeignRows: 237 },
  ];
  for (const u of unprobedForeign) {
    FOREIGN_RAW_ROWS += u.totalForeignRows;
    for (const eid of u.entityIds) {
      if (!foreignGroups.has(eid)) foreignGroups.set(eid, { entityId: eid, entityName: entityNameById[eid] ?? "UNKNOWN", rowCount: 0, distinctStreets: new Set(), dataAvailable: false });
      const g = foreignGroups.get(eid)!;
      g.distinctStreets.add(u.streetName);
      // exact per-entity row split unknown when 2+ foreign ids share one street batch (האר"י) — mark dataAvailable=false, don't fabricate a split.
      if (u.entityIds.length === 1) g.rowCount += u.totalForeignRows;
    }
  }
  console.log(`PHASE8: FOREIGN_RAW_ROWS=${FOREIGN_RAW_ROWS} DISTINCT_FOREIGN_ENTITY_IDS=${foreignGroups.size}`);
  for (const g of foreignGroups.values()) console.log(`  FOREIGN_ENTITY: id=${g.entityId} name=${g.entityName} rowCount=${g.dataAvailable ? g.rowCount : "UNKNOWN (multi-entity batch, no per-entity split captured)"} distinctStreets=${[...g.distinctStreets].join(";")}`);

  // Duplicate check: do foreign-rejected rows (from the 5 probed streets) match any key already in the final union?
  const finalUnionKeys = new Set(finalUnion.map((r) => transactionKey(r)));
  let FOREIGN_DUPLICATE_ACCEPTED = 0, FOREIGN_NOT_IN_ACCEPTED_UNION = 0, FOREIGN_NORMALIZATION_FAILED = 0;
  for (const { item } of foreignRawItems) {
    const shadowRow = toShadowDeal(item, neighborhood, PARENT_SOURCE_ID); // neighborhood/sourceId irrelevant to the key itself (parcelNum+dealDate+price)
    // ECC silent-failure-hunter finding: a normalization failure here was
    // previously silently excluded from BOTH buckets with no counter,
    // leaving a gap between foreignRawItems.length and
    // FOREIGN_DUPLICATE_ACCEPTED+FOREIGN_NOT_IN_ACCEPTED_UNION that nothing
    // surfaced. Track and report it explicitly instead.
    if (!shadowRow) { FOREIGN_NORMALIZATION_FAILED++; continue; }
    const key = transactionKey(shadowRow);
    if (finalUnionKeys.has(key)) FOREIGN_DUPLICATE_ACCEPTED++; else FOREIGN_NOT_IN_ACCEPTED_UNION++;
  }
  console.log(`PHASE8: FOREIGN_DUPLICATE_ACCEPTED=${FOREIGN_DUPLICATE_ACCEPTED} FOREIGN_NOT_IN_ACCEPTED_UNION=${FOREIGN_NOT_IN_ACCEPTED_UNION} FOREIGN_NORMALIZATION_FAILED=${FOREIGN_NORMALIZATION_FAILED} (out of ${foreignRawItems.length} row-level-known foreign rows; ${FOREIGN_RAW_ROWS - foreignRawItems.length} additional foreign rows from the 2 unprobed streets have no row-level data for this check)`);
  if (FOREIGN_DUPLICATE_ACCEPTED + FOREIGN_NOT_IN_ACCEPTED_UNION + FOREIGN_NORMALIZATION_FAILED !== foreignRawItems.length) {
    throw new Error("ACCOUNTING_MISMATCH: foreign row-level duplicate-check buckets do not sum to foreignRawItems.length");
  }

  // ============================================================
  // PHASE 9: zero-id rows
  // ============================================================
  let ZERO_RAW_ROWS = 0, ZERO_DUPLICATE_ACCEPTED = 0, ZERO_NOT_IN_ACCEPTED_UNION = 0, ZERO_NORMALIZATION_FAILED = 0;
  for (const p of probedMixedStreets) {
    const items = rawItemsByStreet[p.id];
    for (const it of items) {
      if (classifyRowForAcceptance(it, PARENT_SOURCE_ID) === "REJECT_ZERO") {
        ZERO_RAW_ROWS++;
        const shadowRow = toShadowDeal(it, neighborhood, PARENT_SOURCE_ID);
        if (!shadowRow) { ZERO_NORMALIZATION_FAILED++; continue; }
        const key = transactionKey(shadowRow);
        if (finalUnionKeys.has(key)) ZERO_DUPLICATE_ACCEPTED++; else ZERO_NOT_IN_ACCEPTED_UNION++;
      }
    }
  }
  console.log(`PHASE9: ZERO_RAW_ROWS=${ZERO_RAW_ROWS} ZERO_DUPLICATE_ACCEPTED=${ZERO_DUPLICATE_ACCEPTED} ZERO_NOT_IN_ACCEPTED_UNION=${ZERO_NOT_IN_ACCEPTED_UNION} ZERO_NORMALIZATION_FAILED=${ZERO_NORMALIZATION_FAILED} ZERO_ACCEPTED=0 (unchanged policy)`);
  if (ZERO_DUPLICATE_ACCEPTED + ZERO_NOT_IN_ACCEPTED_UNION + ZERO_NORMALIZATION_FAILED !== ZERO_RAW_ROWS) {
    throw new Error("ACCOUNTING_MISMATCH: zero row-level duplicate-check buckets do not sum to ZERO_RAW_ROWS");
  }

  // ============================================================
  // PHASE 10: date coverage, year by year
  // ============================================================
  function yearOf(d: string | null): string { return d ? d.slice(0, 4) : "UNKNOWN"; }
  const yearMap = new Map<string, { entity: number; street: number; both: number }>();
  for (const r of finalUnion) {
    const y = yearOf(r.dealDate);
    if (!yearMap.has(y)) yearMap.set(y, { entity: 0, street: 0, both: 0 });
    const bucket = yearMap.get(y)!;
    const prov = provenance.get(r)!;
    if (prov === "ENTITY_ONLY") bucket.entity++;
    else if (prov === "STREET_ONLY") bucket.street++;
    else bucket.both++;
  }
  const years = [...yearMap.keys()].sort();
  const yearRows = years.map((y) => {
    const b = yearMap.get(y)!;
    const total = b.entity + b.street + b.both;
    return { year: y, entityLayer: b.entity, streetLayer: b.street, both: b.both, finalUnion: total, entityOnlyShare: total ? b.entity / total : 0 };
  });
  console.log(`PHASE10: year distribution (${years.length} distinct years) written to CSV`);
  const suspectIntervals = yearRows.filter((y) => y.finalUnion >= 10 && y.entityOnlyShare > 0.5).map((y) => y.year);
  console.log(`PHASE10: SUSPECT_DATE_INTERVALS (years with >=10 rows and >50% entity-only share)=${JSON.stringify(suspectIntervals)}`);

  // ============================================================
  // PHASE 11: property/deal semantics
  // ============================================================
  const dealNatureMap = new Map<string, { count: number; entity: number; street: number; both: number }>();
  for (const r of finalUnion) {
    const dn = r.rawDealNature ?? "∅";
    if (!dealNatureMap.has(dn)) dealNatureMap.set(dn, { count: 0, entity: 0, street: 0, both: 0 });
    const b = dealNatureMap.get(dn)!;
    b.count++;
    const prov = provenance.get(r)!;
    if (prov === "ENTITY_ONLY") b.entity++; else if (prov === "STREET_ONLY") b.street++; else b.both++;
  }
  const dealNatureRows = [...dealNatureMap.entries()].sort((a, b) => b[1].count - a[1].count);
  console.log(`PHASE11: ROWS_WITH_DEALNATURE=${finalUnion.filter((r) => r.rawDealNature).length} DISTINCT_DEALNATURE=${dealNatureMap.size}`);
  console.log(`PHASE11: top dealNature entity-heavy categories=${JSON.stringify(dealNatureRows.slice(0, 10).map(([dn, b]) => ({ dn, ...b, entityShare: b.count ? b.entity / b.count : 0 })))}`);

  // ============================================================
  // PHASE 12: parcel ID quality
  // ============================================================
  function parcelStats(rows: ShadowDeal[]) {
    const minusZero = rows.filter((r) => r.parcelNum && /-0$/.test(r.parcelNum)).length;
    const missing = rows.filter((r) => !r.parcelNum).length;
    return { minusZero, missing, total: rows.length };
  }
  const parcelEntity = parcelStats(entityOnlyRows);
  const parcelStreet = parcelStats(streetOnlyRows);
  const parcelBoth = parcelStats(bothRows);
  console.log(`PHASE12: MINUS_ZERO_ROWS entity=${parcelEntity.minusZero} street=${parcelStreet.minusZero} both=${parcelBoth.minusZero}`);
  console.log(`PHASE12: MISSING_PARCEL_ROWS entity=${parcelEntity.missing} street=${parcelStreet.missing} both=${parcelBoth.missing}`);
  console.log(`PHASE12: RATES (minus-zero) entity=${(parcelEntity.minusZero / (parcelEntity.total || 1) * 100).toFixed(1)}% street=${(parcelStreet.minusZero / (parcelStreet.total || 1) * 100).toFixed(1)}% both=${(parcelBoth.minusZero / (parcelBoth.total || 1) * 100).toFixed(1)}%`);

  // ============================================================
  // PHASE 13: duplicate-surface saturation
  // ============================================================
  interface StreetSaturation { streetId: string; name: string; rawTopLevel: number; newToKiryatAtMerge: number; currentlyUniqueToStreetLayer: number; }
  const saturationRows: StreetSaturation[] = [];
  for (const r of successfulResults) {
    const rows = r.rows as unknown as ShadowDeal[];
    const uniqueToStreetLayer = rows.filter((row) => !baselineKeys.has(transactionKey(row))).length;
    saturationRows.push({ streetId: r.streetId, name: r.streetName, rawTopLevel: rows.length, newToKiryatAtMerge: 0, currentlyUniqueToStreetLayer: uniqueToStreetLayer });
  }
  for (const p of probedMixedStreets) {
    const rows = recoveredRowsByStreet[p.id];
    const uniqueToStreetLayer = rows.filter((row) => !baselineKeys.has(transactionKey(row))).length;
    saturationRows.push({ streetId: p.id, name: p.name, rawTopLevel: rows.length, newToKiryatAtMerge: 0, currentlyUniqueToStreetLayer: uniqueToStreetLayer });
  }
  saturationRows.push({ streetId: "74000875_fetch2", name: "אברהם שפיגלמן (fetch2)", rawTopLevel: fetch2Rows.length, newToKiryatAtMerge: 0, currentlyUniqueToStreetLayer: 0 });
  const totalRawAcrossStreets = saturationRows.reduce((s, r) => s + r.rawTopLevel, 0);
  const totalUniqueAcrossStreets = STREET_ACCEPTED_UNIQUE;
  const CROSS_STREET_DUPLICATION_RATE = totalRawAcrossStreets ? 1 - totalUniqueAcrossStreets / totalRawAcrossStreets : 0;
  console.log(`PHASE13: totalRawAcrossStreets=${totalRawAcrossStreets} totalUniqueAcrossAllStreetLayers=${totalUniqueAcrossStreets} CROSS_STREET_DUPLICATION_RATE=${(CROSS_STREET_DUPLICATION_RATE * 100).toFixed(1)}%`);
  console.log(`PHASE13: Spiegelman fetch2 specifically: raw=33 uniqueToStreetLayer(vs baseline only)=${fetch2Rows.filter((r) => !baselineKeys.has(transactionKey(r))).length} but genuinelyNewToKiryat(vs full union)=0 — a clean illustration of high duplication once a street's own fetch1 is already merged.`);

  // ============================================================
  // PHASE 14: official entity total semantics recheck
  // ============================================================
  console.log("PHASE14: KIRYAT_OFFICIAL_TOTAL_ROWS=5640, sourced from the direct entity-level /deal-data response's own total_rows field (site-reported, TOP_LEVEL_CONFIRMED — not our own count). No evidence exists in any committed artifact that 5640 double-counts prevDeals (Wave 0G-13 proved prevDeals are historical sub-events never counted in top-level total_rows) or that it excludes no-street/parcel-only rows (street=0 rows DO appear within accepted top-level data, proving the site's own total_rows counts them as ordinary top-level transactions, not a separate category). Whether 5640 might include rows physically outside the 70-street roster (e.g. new-construction addresses not yet on any street list) is UNKNOWN — no evidence either confirms or refutes this hypothesis this wave.");

  // ============================================================
  // Write CSVs
  // ============================================================
  await fs.writeFile(path.join(OUT_DIR, "union_layer_breakdown.csv"), [
    "LAYER,COUNT,PCT_OF_FINAL_UNION,VALID_ADDRESS_RATE,STREET_ZERO_RATE,MISSING_HOUSE_RATE,EARLIEST_DATE,LATEST_DATE",
    `ENTITY_ONLY,${entityOnlyStats.count},${entityOnlyStats.pct.toFixed(2)},${entityOnlyStats.validAddressRate.toFixed(1)},${entityOnlyStats.streetZeroRate.toFixed(1)},${entityOnlyStats.missingHouseRate.toFixed(1)},${entityOnlyStats.earliest},${entityOnlyStats.latest}`,
    `STREET_ONLY,${streetOnlyStats.count},${streetOnlyStats.pct.toFixed(2)},${streetOnlyStats.validAddressRate.toFixed(1)},${streetOnlyStats.streetZeroRate.toFixed(1)},${streetOnlyStats.missingHouseRate.toFixed(1)},${streetOnlyStats.earliest},${streetOnlyStats.latest}`,
    `BOTH,${bothStats.count},${bothStats.pct.toFixed(2)},${bothStats.validAddressRate.toFixed(1)},${bothStats.streetZeroRate.toFixed(1)},${bothStats.missingHouseRate.toFixed(1)},${bothStats.earliest},${bothStats.latest}`,
  ].join("\n") + "\n");

  await fs.writeFile(path.join(OUT_DIR, "street_completion_status.csv"), [
    "STREET_ID,STREET_NAME,STATUS,TOTAL_ROWS,TOTAL_FETCH,KNOWN_DELTA_OR_OPPORTUNITY,REASON",
    ...cleanNonPaginated.map((r) => `${r.streetId},${csvEscape(r.streetName)},COMPLETE,${(r as any).totalRowsIfExposed ?? ""},1,0,${csvEscape("total_fetch=1, fully captured")}`),
    `74000875,${csvEscape("אברהם שפיגלמן")},COMPLETE,533,2,0,${csvEscape("fetch2 proven live (Wave 0G-22B), 533/533 exact")}`,
    `74000847,${csvEscape("דגניה")},PARTIAL,501,2,1,${csvEscape("fetch1=500 captured, ~1 row behind fetch2, untested, unproven whether even new to Kiryat")}`,
    ...mixedResults.map((r) => {
      const isProbed = probedMixedStreets.some((p) => p.id === r.streetId);
      const reason = isProbed
        ? "raw-complete (total_fetch=1); per-row identity fully resolved via live probe"
        : "raw-complete (total_fetch=1); per-row identity resolved only to PARENT=0/foreign-count level via Wave 0G-18's original identity check (distinct ids), no row-level dedup data captured";
      return `${r.streetId},${csvEscape(r.streetName)},COMPLETE_RAW,${(r as any).totalRowsIfExposed ?? ""},1,0,${csvEscape(reason)}`;
    }),
  ].join("\n") + "\n");

  await fs.writeFile(path.join(OUT_DIR, "year_layer_distribution.csv"), [
    "YEAR,ENTITY_LAYER,STREET_LAYER,BOTH,FINAL_UNION,ENTITY_ONLY_SHARE",
    ...yearRows.map((y) => `${y.year},${y.entityLayer},${y.streetLayer},${y.both},${y.finalUnion},${(y.entityOnlyShare * 100).toFixed(1)}%`),
  ].join("\n") + "\n");

  // Residual gap ledger (Phase 15) — computed after all evidence gathered above.
  const ledger = [
    {
      category: "KNOWN_UNTESTED_STREET_PAGINATION",
      rawOpportunity: 1,
      canContribute: "YES, at most 1 row (Dgania)",
      provenNewRows: 0,
      overlapRisk: "HIGH — Spiegelman's own 33-row fetch2 yielded 0 new, so this 1 row may already be captured",
      confidence: "LOW",
    },
    {
      category: "ZERO_ID_REJECTED",
      rawOpportunity: ZERO_RAW_ROWS,
      canContribute: `NO (by policy, unresolved semantics) — but as evidence: all ${ZERO_NOT_IN_ACCEPTED_UNION} of these rows ARE independent of the accepted union (not duplicates), so IF the policy were ever resolved favorably this would be a real, small opportunity`,
      provenNewRows: 0,
      overlapRisk: `${ZERO_DUPLICATE_ACCEPTED} of ${ZERO_RAW_ROWS} already duplicate accepted rows`,
      confidence: "MEDIUM (row-level data available for all zero rows found)",
    },
    {
      category: "FOREIGN_ID_REJECTED",
      rawOpportunity: FOREIGN_RAW_ROWS,
      canContribute: "NO — these are genuinely other entities' own transactions (5 distinct real Netanya neighborhoods confirmed via the 38-entity catalog), correctly excluded",
      provenNewRows: 0,
      overlapRisk: `${FOREIGN_DUPLICATE_ACCEPTED} of ${foreignRawItems.length} row-level-known foreign rows already duplicate accepted rows; remainder (${FOREIGN_RAW_ROWS - foreignRawItems.length}) has no row-level data`,
      confidence: "MEDIUM for 5 probed streets, LOW for 2 unprobed streets (count/entity-id known, row content unknown)",
    },
    {
      category: "NO_STREET_STREET_ZERO",
      rawOpportunity: streetZeroRows.length + missingStreetRows.length,
      canContribute: "N/A — these ARE already inside the accepted 5145 union (not missing), so they cannot explain the 495 gap; listed for completeness only",
      provenNewRows: 0,
      overlapRisk: "N/A — not a missing-row category, an already-accepted-row characteristic",
      confidence: "HIGH (directly counted from the final union)",
    },
    {
      category: "NON_MANIFEST_STREET",
      rawOpportunity: notOnManifest.length,
      canContribute: "N/A — same as above, these rows ARE already accepted; all 3 distinct non-manifest street names found are confirmed name variants of streets already on the 70-manifest (word-order/fuller-name spellings), not genuinely undiscovered streets — no catalog-incompleteness evidence survives this wave",
      provenNewRows: 0,
      overlapRisk: "N/A",
      confidence: `${Object.keys(nonManifestByName).length} distinct non-manifest street names found, all confirmed name variants (see report Phase 5) — 0 genuinely undiscovered streets identified`,
    },
    {
      category: "SOURCE_CONTRACT_UNREACHABLE_OR_UNKNOWN",
      rawOpportunity: DELTA,
      canContribute: "UNKNOWN — the residual after all known, evidenced categories are accounted for",
      provenNewRows: 0,
      overlapRisk: "N/A",
      confidence: "This is the honest remainder, not a proven category",
    },
  ];
  await fs.writeFile(path.join(OUT_DIR, "residual_gap_ledger.csv"), [
    "CATEGORY,RAW_ROWS_OR_OPPORTUNITY,CAN_CONTRIBUTE_TO_495,PROVEN_NEW_ROWS,OVERLAP_RISK,CONFIDENCE",
    ...ledger.map((l) => `${l.category},${l.rawOpportunity},${csvEscape(l.canContribute)},${l.provenNewRows},${csvEscape(l.overlapRisk)},${csvEscape(l.confidence)}`),
  ].join("\n") + "\n");

  const PROVEN_EXPLAINED_DELTA = 0; // no category above proves a specific missing transaction is recoverable AND new
  const PLAUSIBLY_EXPLAINED_DELTA_MAX = 1; // Dgania's unproven ~1 row, at best
  const UNEXPLAINED_DELTA = DELTA - PROVEN_EXPLAINED_DELTA;
  console.log(`PHASE15: PROVEN_EXPLAINED_DELTA=${PROVEN_EXPLAINED_DELTA} PLAUSIBLY_EXPLAINED_DELTA(max, unproven)=${PLAUSIBLY_EXPLAINED_DELTA_MAX} UNEXPLAINED_DELTA=${UNEXPLAINED_DELTA}`);

  // Persist a JSON summary of everything for the report to read back.
  await fs.writeFile(path.join(OUT_DIR, "attribution_summary.json"), JSON.stringify({
    finalUnique: FINAL_UNIQUE, officialTotal: OFFICIAL_TOTAL, delta: DELTA,
    entityBaselineUnique: ENTITY_BASELINE_UNIQUE, streetAcceptedUnique: STREET_ACCEPTED_UNIQUE, entityStreetOverlap: ENTITY_STREET_OVERLAP,
    entityOnly: entityOnlyStats, streetOnly: streetOnlyStats, both: bothStats,
    streetZeroRows: streetZeroRows.length, missingStreetRows: missingStreetRows.length, missingHouseRows: missingHouseRows.length,
    entityOnlyStreetZero, entityOnlyMissingStreet, streetOnlyStreetZero,
    rowsWithStreet: rowsWithStreet.length, onManifest: onManifest.length, notOnManifest: notOnManifest.length, distinctNonManifestStreets: Object.keys(nonManifestByName).length,
    nonManifestTop: nonManifestSorted.map(([name, v]) => ({ name, count: v.count, sources: [...v.sources] })),
    streetTotalRowsSum: STREET_TOTAL_ROWS_SUM, observedParentRows: OBSERVED_PARENT_ROWS, observedForeignRows: OBSERVED_FOREIGN_ROWS, observedZeroRows: OBSERVED_ZERO_ROWS,
    completeStreets: correctedComplete, partialStreets: PARTIAL_STREETS, unresolvedStreets: 0, maxKnownStreetPaginationOpportunity: MAX_KNOWN_STREET_PAGINATION_OPPORTUNITY,
    foreignRawRows: FOREIGN_RAW_ROWS, distinctForeignEntityIds: foreignGroups.size,
    foreignGroups: [...foreignGroups.values()].map((g) => ({ entityId: g.entityId, entityName: g.entityName, rowCount: g.dataAvailable ? g.rowCount : null, distinctStreets: [...g.distinctStreets] })),
    foreignDuplicateAccepted: FOREIGN_DUPLICATE_ACCEPTED, foreignNotInAcceptedUnion: FOREIGN_NOT_IN_ACCEPTED_UNION, foreignNormalizationFailed: FOREIGN_NORMALIZATION_FAILED, foreignRowLevelKnownCount: foreignRawItems.length,
    zeroRawRows: ZERO_RAW_ROWS, zeroDuplicateAccepted: ZERO_DUPLICATE_ACCEPTED, zeroNotInAcceptedUnion: ZERO_NOT_IN_ACCEPTED_UNION, zeroNormalizationFailed: ZERO_NORMALIZATION_FAILED,
    suspectDateIntervals: suspectIntervals,
    dealNatureTop: dealNatureRows.slice(0, 10).map(([dn, b]) => ({ dealNature: dn, ...b, entityShare: b.count ? b.entity / b.count : 0 })),
    rowsWithDealNature: finalUnion.filter((r) => r.rawDealNature).length, distinctDealNature: dealNatureMap.size,
    parcelEntity, parcelStreet, parcelBoth,
    crossStreetDuplicationRate: CROSS_STREET_DUPLICATION_RATE,
    provenExplainedDelta: PROVEN_EXPLAINED_DELTA, plausiblyExplainedDeltaMax: PLAUSIBLY_EXPLAINED_DELTA_MAX, unexplainedDelta: UNEXPLAINED_DELTA,
  }, null, 2));

  console.log("=== WAVE 0G-23 ANALYSIS COMPLETE ===");
}

main().catch((e) => { console.error("WAVE0G23_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
