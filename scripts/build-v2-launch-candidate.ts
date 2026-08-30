/**
 * scripts/build-v2-launch-candidate.ts — Wednesday Launch Sprint L0.
 *
 * Deterministically reconstructs the proven-safe 59,305-row citywide
 * transaction union from already-committed/already-acquired Wave 0G
 * artifacts (ZERO new network requests — acquisition is frozen), and
 * writes it as a V2 launch-candidate dataset. Read-only with respect to
 * every wave artifact it consumes; writes only to data/v2-candidate/.
 *
 * Composition (must equal exactly 59,305):
 *   27 originally-COMPLETE entities (Wave 0G-16 baseline = final, never
 *     augmented)                                          = 25,110
 *   + Kiryat Hasharon's final accepted union, reconstructed by replaying
 *     the EXACT Wave 0G-18 -> 0G-19 -> 0G-20 -> 0G-21 classification
 *     chain over already-persisted result files (no new logic)
 *                                                          =  5,145
 *   + 10 target PARTIAL entities' Wave 0G-24B augmented unions,
 *     reconstructed by replaying that wave's own baseline+street-result
 *     union (same logic Wave 0G-26 already proved correct)
 *                                                          = 29,050
 *                                                          ---------
 *                                                          = 59,305
 *
 * Usage: npx tsx scripts/build-v2-launch-candidate.ts
 */
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { pathToFileURL } from "url";
import { toShadowDeal, transactionKey, type ShadowDeal } from "../lib/shadowRebuild";
import { classifyRowForAcceptance } from "../lib/streetRowAcceptance";
import { classifyTransactionGroups } from "./audit-wave0g18-aggregate";
import { detectAmbiguousCollisions } from "./audit-wave0g16-citywide-shadow";
import { TARGET_ENTITIES } from "./audit-wave0g24-multi-entity-street-runner";
import { type StreetResult, type StreetStatus } from "./audit-wave0g18-street-runner";
import type { Deal, Neighborhood } from "../lib/types";

const REPO_ROOT = process.cwd();
const BASELINE_DIR = path.join(REPO_ROOT, "audit/wave0g16/shadow-output");
const W18_SHADOW_DIR = path.join(REPO_ROOT, "audit/wave0g18/shadow");
const W24_DIR = path.join(REPO_ROOT, "audit/wave0g24");
const W24_SHADOW_DIR = path.join(W24_DIR, "shadow");
const OUT_DIR = path.join(REPO_ROOT, "data/v2-candidate");
const KIRYAT_SOURCE_ID = "65209683";
const SETTLEMENT = "נתניה";
const successStatuses: StreetStatus[] = ["SUCCESS_ROWS", "SUCCESS_MIXED_PARTIAL", "SUCCESS_EMPTY", "PARTIAL_MORE_FETCHES_INDICATED"];

// Windows temp-path rule (this sprint's own hard requirement, after Wave
// 0G-26 exposed a real Bash-vs-Node /tmp mismatch): never hardcode /tmp;
// always resolve via os.tmpdir(), log the exact resolved path, verify
// existence before use and verify deletion after cleanup.
function resolveTempPath(name: string): string {
  const p = path.resolve(os.tmpdir(), name);
  console.log(`TEMP_PATH_RESOLVED=${p}`);
  return p;
}

const DEAL_FIELDS: (keyof Deal)[] = [
  "id", "dealDate", "price", "propertyType", "rooms", "areaSqm", "plotSqm",
  "floor", "yearBuilt", "dealNature", "address", "houseNumber", "street",
  "neighborhoodId", "neighborhood", "settlement", "x", "y", "pricePerSqm",
];
/** Strips a ShadowDeal down to the EXACT production Deal shape (19 keys,
 * no more, no less) — never redesigns the schema, per Phase 5.
 * ECC planner finding: coerces an absent/undefined field to `null` rather
 * than leaving it `undefined` — `Deal`'s own type has no optional fields,
 * so every key must survive JSON.stringify (which silently DROPS an
 * `undefined`-valued key, whereas explicit `null` survives and matches
 * Supabase's own column semantics for a future L1 import). */
function toPureDeal(d: ShadowDeal): Deal {
  const out: any = {};
  for (const k of DEAL_FIELDS) out[k] = (d as any)[k] ?? null;
  return out as Deal;
}

interface EntityUnion { sourceId: string; name: string; officialTotal: number; rows: ShadowDeal[]; status: "COMPLETE" | "PARTIAL"; }

async function load27CompleteEntities(): Promise<EntityUnion[]> {
  const manifest = JSON.parse(await fs.readFile(path.join(BASELINE_DIR, "manifest.json"), "utf8"));
  const completeIds = Object.entries(manifest).filter(([, v]: any) => v.status === "COMPLETE").map(([id]) => id);
  const out: EntityUnion[] = [];
  for (const sourceId of completeIds) {
    const f = JSON.parse(await fs.readFile(path.join(BASELINE_DIR, `${sourceId}.json`), "utf8"));
    if (f.officialTotalRows !== f.uniqueRows.length) {
      throw new Error(`INTEGRITY_FAIL: COMPLETE entity ${sourceId} (${f.name}) has officialTotalRows=${f.officialTotalRows} !== uniqueRows.length=${f.uniqueRows.length} — not actually complete, STOP.`);
    }
    out.push({ sourceId, name: f.name, officialTotal: f.officialTotalRows, rows: f.uniqueRows, status: "COMPLETE" });
  }
  return out;
}

/** Exact replay of Wave 0G-18 -> 0G-19 -> 0G-20 -> 0G-21's classification
 * chain for Kiryat Hasharon, using only already-persisted result files.
 * Mirrors scripts/audit-wave0g21-final-verification.ts's own Phase 2/6
 * reconstruction verbatim (same functions, same inputs, same order) —
 * makes ZERO live requests (that script's live-fetch phases are skipped
 * entirely; its 2 already-fetched results are loaded from disk instead). */
async function reconstructKiryatFinalUnion(): Promise<ShadowDeal[]> {
  const baseline = JSON.parse(await fs.readFile(path.join(BASELINE_DIR, `${KIRYAT_SOURCE_ID}.json`), "utf8"));
  const w18manifest = JSON.parse(await fs.readFile(path.join(W18_SHADOW_DIR, "street_run_manifest.json"), "utf8"));
  const w18streetIds = Object.keys(w18manifest);
  const w18Results: StreetResult[] = [];
  for (const id of w18streetIds) {
    w18Results.push(JSON.parse(await fs.readFile(path.join(W18_SHADOW_DIR, `street_${KIRYAT_SOURCE_ID}_${id}.json`), "utf8")));
  }
  const w18SuccessStatuses = ["SUCCESS_ROWS", "SUCCESS_EMPTY", "PARTIAL_MORE_FETCHES_INDICATED"];
  const w18Successful = w18Results.filter((r) => w18SuccessStatuses.includes(r.status));
  const oldClassification = classifyTransactionGroups(baseline.uniqueRows, w18Successful.map((r) => ({ streetId: r.streetId, rows: r.rows })));
  if (oldClassification.augmentedUnion.length !== 4831) {
    throw new Error(`RECONSTRUCTION_MISMATCH: Kiryat Wave 0G-18 union expected 4831, got ${oldClassification.augmentedUnion.length}`);
  }

  const neighborhood: Neighborhood = { id: KIRYAT_SOURCE_ID, name: "קריית השרון", settlement: SETTLEMENT, x: null, y: null };
  const wave20Probed = [
    { path: "audit/wave0g19/shadow/probe_74001232.json", itemsKey: "rawItems" },
    { path: "audit/wave0g19/shadow/probe_74001260.json", itemsKey: "rawItems" },
    { path: "audit/wave0g20/shadow/live_control_74000865.json", itemsKey: "rawItems" },
  ];
  // ECC silent-failure-hunter finding: this wave's replay of Wave 0G-21's
  // own logic had DROPPED that wave's own ECC-added SHADOW_CONVERSION_DROP
  // guard (scripts/audit-wave0g21-final-verification.ts:181-187) — a
  // toShadowDeal() null (normalization failure) was silently skipped with
  // no counter. Restored here: the exact-count assertions below would
  // still have caught a drop this run, but with an uninformative generic
  // RECONSTRUCTION_MISMATCH rather than pinpointing the actual cause.
  const wave20RecoveredRows: ShadowDeal[] = [];
  for (const p of wave20Probed) {
    const probe = JSON.parse(await fs.readFile(path.join(REPO_ROOT, p.path), "utf8"));
    const items = probe[p.itemsKey] as any[];
    const acceptedItems = items.filter((it: any) => classifyRowForAcceptance(it, KIRYAT_SOURCE_ID) === "ACCEPT_PARENT");
    const streetRows: ShadowDeal[] = [];
    for (const raw of acceptedItems) {
      const shadowRow = toShadowDeal(raw, neighborhood, KIRYAT_SOURCE_ID);
      if (shadowRow) streetRows.push(shadowRow);
    }
    if (streetRows.length !== acceptedItems.length) {
      throw new Error(`SHADOW_CONVERSION_DROP: ${p.path} had ${acceptedItems.length} ACCEPT_PARENT rows but only ${streetRows.length} converted to ShadowDeal — ${acceptedItems.length - streetRows.length} row(s) silently dropped by toShadowDeal (likely missing/non-finite dealAmount)`);
    }
    wave20RecoveredRows.push(...streetRows);
  }
  const currentUnionClassification = classifyTransactionGroups(oldClassification.augmentedUnion, [{ streetId: "WAVE_0G20_RECOVERED_CLASS_A", rows: wave20RecoveredRows }]);
  if (currentUnionClassification.augmentedUnion.length !== 5109) {
    throw new Error(`RECONSTRUCTION_MISMATCH: Kiryat Wave 0G-20 union expected 5109, got ${currentUnionClassification.augmentedUnion.length}`);
  }

  const w21Streets = [
    { id: "74000826", file: "audit/wave0g21/shadow/street_fetch_74000826.json" },
    { id: "74001235", file: "audit/wave0g21/shadow/street_fetch_74001235.json" },
  ];
  const newlyAcceptedRowSets: { streetId: string; rows: ShadowDeal[] }[] = [];
  for (const s of w21Streets) {
    const fetchResult = JSON.parse(await fs.readFile(path.join(REPO_ROOT, s.file), "utf8"));
    const items = fetchResult.rawItems as any[];
    const acceptedItems = items.filter((it: any) => classifyRowForAcceptance(it, KIRYAT_SOURCE_ID) === "ACCEPT_PARENT");
    const rows: ShadowDeal[] = [];
    for (const raw of acceptedItems) {
      const shadowRow = toShadowDeal(raw, neighborhood, KIRYAT_SOURCE_ID);
      if (shadowRow) rows.push(shadowRow);
    }
    if (rows.length !== acceptedItems.length) {
      throw new Error(`SHADOW_CONVERSION_DROP: ${s.file} had ${acceptedItems.length} ACCEPT_PARENT rows but only ${rows.length} converted to ShadowDeal — ${acceptedItems.length - rows.length} row(s) silently dropped by toShadowDeal (likely missing/non-finite dealAmount)`);
    }
    newlyAcceptedRowSets.push({ streetId: s.id, rows });
  }
  const finalClassification = classifyTransactionGroups(currentUnionClassification.augmentedUnion, newlyAcceptedRowSets);
  if (finalClassification.ambiguousCollisions > 0) {
    throw new Error(`INTEGRITY_FAIL: Kiryat final reconstruction has ${finalClassification.ambiguousCollisions} ambiguous collision(s)`);
  }
  if (finalClassification.augmentedUnion.length !== 5145) {
    throw new Error(`RECONSTRUCTION_MISMATCH: Kiryat final union expected 5145, got ${finalClassification.augmentedUnion.length}`);
  }
  return finalClassification.augmentedUnion;
}

/** Exact replay of Wave 0G-24B's per-entity augmentation for one of the
 * 10 target entities: baseline union + every street it successfully
 * accepted rows from, via the SAME classifyTransactionGroups classifier. */
async function reconstructTargetEntityUnion(entity: { sourceId: string; name: string; officialTotal: number }): Promise<ShadowDeal[]> {
  const baseline = JSON.parse(await fs.readFile(path.join(BASELINE_DIR, `${entity.sourceId}.json`), "utf8"));
  const manifest = JSON.parse(await fs.readFile(path.join(W24_DIR, `street_manifest_${entity.sourceId}.json`), "utf8"));
  const streetIds: string[] = manifest.streets.map((s: any) => s.streetId);
  const streetResults: StreetResult[] = [];
  for (const streetId of streetIds) {
    streetResults.push(JSON.parse(await fs.readFile(path.join(W24_SHADOW_DIR, `street_${entity.sourceId}_${streetId}.json`), "utf8")));
  }
  const successfulResults = streetResults.filter((r) => successStatuses.includes(r.status));
  const classification = classifyTransactionGroups(baseline.uniqueRows, successfulResults.map((r) => ({ streetId: r.streetId, rows: r.rows })));
  if (classification.ambiguousCollisions > 0) {
    throw new Error(`INTEGRITY_FAIL: ${entity.name} reconstruction has ${classification.ambiguousCollisions} ambiguous collision(s)`);
  }
  if (classification.augmentedUnion.length > entity.officialTotal) {
    throw new Error(`INTEGRITY_FAIL: ${entity.name} reconstructed union (${classification.augmentedUnion.length}) exceeds official total (${entity.officialTotal})`);
  }
  return classification.augmentedUnion;
}

async function buildUnion(): Promise<{ entityUnions: EntityUnion[]; allRows: ShadowDeal[] }> {
  const entityUnions: EntityUnion[] = [];

  console.log("--- Loading 27 COMPLETE entities ---");
  const complete27 = await load27CompleteEntities();
  if (complete27.length !== 27) throw new Error(`INTEGRITY_FAIL: expected 27 COMPLETE entities, found ${complete27.length}`);
  entityUnions.push(...complete27);
  console.log(`27 COMPLETE entities loaded, sum=${complete27.reduce((s, e) => s + e.rows.length, 0)}`);

  // ECC planner finding: status must be DERIVED from actual achieved
  // coverage (rows.length === officialTotal), not hardcoded — רסקו
  // reached exact 2,012/2,012 in Wave 0G-24B (a genuine COMPLETE result)
  // but a hardcoded "PARTIAL" here contradicted this report's own Phase
  // 10 regression-fixture table, which correctly showed it as COMPLETE.
  function deriveStatus(rowCount: number, officialTotal: number): "COMPLETE" | "PARTIAL" {
    return rowCount === officialTotal ? "COMPLETE" : "PARTIAL";
  }

  console.log("\n--- Reconstructing Kiryat Hasharon final union (offline replay, zero live requests) ---");
  const kiryatRows = await reconstructKiryatFinalUnion();
  entityUnions.push({ sourceId: KIRYAT_SOURCE_ID, name: "קריית השרון", officialTotal: 5640, rows: kiryatRows, status: deriveStatus(kiryatRows.length, 5640) });
  console.log(`Kiryat reconstructed: ${kiryatRows.length} rows`);

  console.log("\n--- Reconstructing 10 target PARTIAL entities' Wave 0G-24B augmented unions ---");
  for (const entity of TARGET_ENTITIES) {
    const rows = await reconstructTargetEntityUnion(entity);
    entityUnions.push({ sourceId: entity.sourceId, name: entity.name, officialTotal: entity.officialTotal, rows, status: deriveStatus(rows.length, entity.officialTotal) });
    console.log(`  ${entity.name} (${entity.sourceId}): ${rows.length} rows`);
  }

  const allRows = entityUnions.flatMap((e) => e.rows);

  // ECC planner finding (real, material — not just an unfilled gap):
  // legacy data/deals.json has POPULATED x/y on all 12,642 rows (via
  // scripts/enrich-coords.ts's offline street-name -> coordinate lookup,
  // data/street-index.json). Every ShadowDeal reconstructed above has
  // x=null/y=null (no Wave 0G acquisition script ever passed streetCoords
  // to toShadowDeal/normalizeDeal). Adopting V2 as-is would be a CITYWIDE
  // REGRESSION from 100% to 0% coordinate coverage, disabling radius-tier
  // comparable search entirely (guarded, non-crashing, but a real feature
  // loss). Fixed using the EXACT SAME offline, already-committed
  // street-index.json the legacy pipeline used — zero new acquisition.
  // MUST live inside buildUnion() (not in main(), after the call) so both
  // the real build AND the determinism-check rebuild apply it identically
  // — an earlier version applied it only to the first call's rows,
  // producing a spurious non-determinism failure against the second,
  // unenriched rebuild.
  const streetIndexRaw = JSON.parse(await fs.readFile(path.join(REPO_ROOT, "data/street-index.json"), "utf8"));
  const streetCoordMap = new Map<string, { x: number; y: number }>();
  for (const s of streetIndexRaw) {
    if (s.street && typeof s.x === "number" && typeof s.y === "number") streetCoordMap.set(s.street, { x: s.x, y: s.y });
  }
  let coordEnriched = 0, coordMissing = 0;
  for (const r of allRows) {
    const coord = r.street ? streetCoordMap.get(r.street) : undefined;
    if (coord) { (r as any).x = coord.x; (r as any).y = coord.y; coordEnriched++; }
    else coordMissing++;
  }
  console.log(`COORD_ENRICHED=${coordEnriched} COORD_MISSING=${coordMissing} (${((coordEnriched / allRows.length) * 100).toFixed(1)}% coverage — up from 0%)`);

  return { entityUnions, allRows };
}

async function main() {
  console.log("=== L0: BUILD V2 LAUNCH CANDIDATE (offline, zero new acquisition) ===");
  await fs.mkdir(OUT_DIR, { recursive: true });

  const { entityUnions, allRows } = await buildUnion();

  console.log(`\n--- Phase 2: safe union invariant ---`);
  console.log(`SAFE_UNION_ROWS=${allRows.length}`);
  if (allRows.length !== 59305) {
    throw new Error(`STOP: SAFE_UNION_ROWS=${allRows.length} !== 59305 — discrepancy=${allRows.length - 59305}. Per Phase 2, do NOT repair this number or continue to candidate build.`);
  }

  console.log(`\n--- Phase 3: citywide transaction integrity (across ALL 38 entities at once) ---`);
  const crossEntityCheck = detectAmbiguousCollisions(allRows);
  console.log(`RAW_ACCEPTED_ROWS=${allRows.length}`);
  const uniqueKeys = new Set(allRows.map((r) => transactionKey(r)));
  console.log(`UNIQUE_TRANSACTION_KEYS=${uniqueKeys.size}`);
  console.log(`AMBIGUOUS_COLLISIONS_CROSS_ENTITY=${crossEntityCheck.ambiguousCount}`);
  if (crossEntityCheck.ambiguousCount > 0) {
    throw new Error(`STOP: ${crossEntityCheck.ambiguousCount} cross-entity ambiguous collision(s) found — a parcelNum+date+price key collides across DIFFERENT entities with disagreeing fields. Examples: ${JSON.stringify(crossEntityCheck.examples)}`);
  }
  if (uniqueKeys.size !== allRows.length) {
    // A same-key, same-fields duplicate WITHIN the combined set (i.e. a
    // legitimate true-duplicate that slipped through per-entity dedup as
    // a cross-entity duplicate — should be zero since each entity's own
    // reconstruction is independently deduped and entities are disjoint
    // by construction, but verify rather than assume).
    throw new Error(`STOP: ${allRows.length - uniqueKeys.size} duplicate transaction key(s) found ACROSS entities (same key, agreeing fields) — this would silently double-count a transaction under two different entities. Investigate before proceeding.`);
  }

  console.log(`\n--- Phase 4: entity reconciliation (all 38 entities) ---`);
  const entityTable = entityUnions.map((e) => ({
    entity: e.name, sourceId: e.sourceId, officialTotal: e.officialTotal, v2SafeRows: e.rows.length,
    delta: e.officialTotal - e.rows.length, coverage: (e.rows.length / e.officialTotal) * 100, status: e.status,
  }));
  const sumOfficial = entityTable.reduce((s, e) => s + e.officialTotal, 0);
  const sumSafe = entityTable.reduce((s, e) => s + e.v2SafeRows, 0);
  const sumDelta = entityTable.reduce((s, e) => s + e.delta, 0);
  console.log(`SUM_OFFICIAL=${sumOfficial} SUM_SAFE=${sumSafe} SUM_DELTA=${sumDelta}`);
  if (sumOfficial !== 63704) throw new Error(`STOP: SUM_OFFICIAL=${sumOfficial} !== 63704`);
  if (sumSafe !== 59305) throw new Error(`STOP: SUM_SAFE=${sumSafe} !== 59305`);
  if (sumDelta !== 4399) throw new Error(`STOP: SUM_DELTA=${sumDelta} !== 4399`);
  if (63704 - 59305 !== 4399) throw new Error("STOP: arithmetic identity failed");

  console.log(`\n--- Phase 6: data quality snapshot ---`);
  const validStreet = allRows.filter((r) => r.street && r.street !== "0").length;
  const streetZero = allRows.filter((r) => r.street === "0").length;
  const missingStreet = allRows.filter((r) => !r.street).length;
  const validHouse = allRows.filter((r) => r.houseNumber).length;
  const missingHouse = allRows.filter((r) => !r.houseNumber).length;
  const dates = allRows.map((r) => r.dealDate).filter(Boolean).sort();
  const zeroAmount = allRows.filter((r) => r.price === 0).length;
  const negativeAmount = allRows.filter((r) => r.price < 0).length;
  const invalidDate = allRows.filter((r) => !r.dealDate || !/^\d{4}-\d{2}-\d{2}$/.test(r.dealDate)).length;
  console.log(`VALID_STREET_ROWS=${validStreet} STREET_ZERO_ROWS=${streetZero} MISSING_STREET_ROWS=${missingStreet}`);
  console.log(`VALID_HOUSE_ROWS=${validHouse} MISSING_HOUSE_ROWS=${missingHouse}`);
  console.log(`EARLIEST_DATE=${dates[0]} LATEST_DATE=${dates[dates.length - 1]}`);
  console.log(`ZERO_AMOUNT_ROWS=${zeroAmount} NEGATIVE_AMOUNT_ROWS=${negativeAmount} INVALID_DATE_ROWS=${invalidDate}`);
  if (negativeAmount > 0 || zeroAmount > 0) {
    throw new Error(`STOP: ${zeroAmount} zero-amount and ${negativeAmount} negative-amount rows found — normalizeDeal() should have already rejected these (price<=0 rows return null), so their presence here indicates DATA_CORRUPTION in the reconstruction, not a source limitation.`);
  }

  console.log(`\n--- Phase 7: build V2 candidate (deterministic) ---`);
  // Deterministic stable sort: neighborhoodId, then dealDate, then id —
  // all 3 fields are always present and stable, giving a total order.
  function sortKey(d: ShadowDeal): string { return `${d.neighborhoodId}|${d.dealDate}|${d.id}`; }
  const pureDeals = allRows.map(toPureDeal).sort((a, b) => sortKey(a as any) < sortKey(b as any) ? -1 : sortKey(a as any) > sortKey(b as any) ? 1 : 0);
  // Re-attach neighborhoodId/dealDate/id for sortKey after stripping to
  // pure Deal (they're already Deal fields, so sortKey works directly on
  // the pure Deal objects too — no re-attachment needed).
  const json1 = JSON.stringify(pureDeals, null, 2);
  const sha1 = crypto.createHash("sha256").update(json1).digest("hex");

  // Determinism check: rebuild the ENTIRE union again from scratch and
  // compare. This re-reads every input file fresh — a genuine end-to-end
  // determinism proof, not just a serialization re-hash.
  console.log("Rebuilding a second time from scratch to verify determinism...");
  const { allRows: allRows2 } = await buildUnion();
  const pureDeals2 = allRows2.map(toPureDeal).sort((a, b) => sortKey(a as any) < sortKey(b as any) ? -1 : sortKey(a as any) > sortKey(b as any) ? 1 : 0);
  const json2 = JSON.stringify(pureDeals2, null, 2);
  const sha2 = crypto.createHash("sha256").update(json2).digest("hex");
  console.log(`RUN1_SHA=${sha1}`);
  console.log(`RUN2_SHA=${sha2}`);
  const deterministic = sha1 === sha2;
  console.log(`DETERMINISTIC_BUILD=${deterministic ? "YES" : "NO"}`);
  if (!deterministic) throw new Error("STOP: build is not deterministic — RUN1_SHA != RUN2_SHA. Launch gate requires YES.");

  const outFile = path.join(OUT_DIR, "deals-v2.json");
  await fs.writeFile(outFile, json1);
  const fileStat = await fs.stat(outFile);
  console.log(`V2_ROWS=${pureDeals.length}`);
  console.log(`V2_SHA256=${sha1}`);
  console.log(`V2_FILE_SIZE=${fileStat.size}`);

  // --- Companion neighborhoods-v2.json: REQUIRED for Deal.neighborhoodId
  // to resolve to anything at all. Current data/neighborhoods.json (21
  // entries) uses a legacy GovMap ID domain; every Wave 0G artifact (and
  // lib/neighborhoodDiscovery.ts, already wired into scripts/harvest.ts)
  // uses the nadlan sourceId domain instead — this candidate follows the
  // codebase's own already-intended direction, not a new invention. ---
  const w16manifest = JSON.parse(await fs.readFile(path.join(BASELINE_DIR, "manifest.json"), "utf8"));
  const catalog = JSON.parse(await fs.readFile(path.join(REPO_ROOT, "audit/wave0g16/catalog_snapshot.json"), "utf8"));
  const catalogById = new Map<string, string>(catalog.entities.map((e: any) => [String(e.sourceId), e.name]));
  const neighborhoodsV2 = Object.keys(w16manifest).sort().map((id) => ({ id, name: catalogById.get(id) ?? entityUnions.find((e) => e.sourceId === id)!.name, settlement: SETTLEMENT, x: null, y: null }));
  if (neighborhoodsV2.length !== 38) throw new Error(`STOP: expected 38 neighborhoods, got ${neighborhoodsV2.length}`);
  const nbJson = JSON.stringify(neighborhoodsV2, null, 2);
  await fs.writeFile(path.join(OUT_DIR, "neighborhoods-v2.json"), nbJson);
  console.log(`NEIGHBORHOODS_V2_COUNT=${neighborhoodsV2.length}`);
  console.log(`NEIGHBORHOODS_V2_SHA256=${crypto.createHash("sha256").update(nbJson).digest("hex")}`);

  // --- Phase 8: manifest ---
  const manifest = {
    candidateVersion: "v2-l0-2026-08-30",
    rowCount: pureDeals.length,
    sha256: sha1,
    officialTotalRows: 63704,
    knownDelta: 4399,
    coverage: Number(((pureDeals.length / 63704) * 100).toFixed(4)),
    entityCount: entityUnions.length,
    prevDealsIncluded: false,
    status: "LAUNCH_CANDIDATE",
    sourceEvidence: {
      headCommit: "86edc05f80900f8ae9a95f7d459f4949e3da0eda",
      contributingWaves: ["0G-16", "0G-17", "0G-18", "0G-19", "0G-20", "0G-21", "0G-22B", "0G-23", "0G-24", "0G-24B"],
      // Membership-based (NOT status-based): a target entity can now
      // dynamically show status="COMPLETE" if it achieved 100% coverage
      // (e.g. רסקו) — this must stay pinned to the original 27
      // never-augmented entities regardless of any target's derived status.
      complete27EntitiesSum: entityUnions.filter((e) => e.sourceId !== KIRYAT_SOURCE_ID && !TARGET_ENTITIES.some((t) => t.sourceId === e.sourceId)).reduce((s, e) => s + e.rows.length, 0),
      kiryatFinalUnion: kiryatRowsCount(entityUnions),
      target10AugmentedSum: entityUnions.filter((e) => TARGET_ENTITIES.some((t) => t.sourceId === e.sourceId)).reduce((s, e) => s + e.rows.length, 0),
    },
    buildMethod: "deterministic offline replay of already-committed/already-acquired Wave 0G artifacts; zero new network requests",
  };
  await fs.writeFile(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

  // --- Phase 4 CSV ---
  const entityCsvLines = ["ENTITY,SOURCE_ID,OFFICIAL_TOTAL,V2_SAFE_ROWS,DELTA,COVERAGE,STATUS"];
  for (const e of entityTable) entityCsvLines.push([csvEscape(e.entity), e.sourceId, e.officialTotal, e.v2SafeRows, e.delta, e.coverage.toFixed(2), e.status].join(","));
  await fs.mkdir(path.join(REPO_ROOT, "audit/launch"), { recursive: true });
  await fs.writeFile(path.join(REPO_ROOT, "audit/launch/entity_reconciliation.csv"), entityCsvLines.join("\n") + "\n");

  console.log("\n=== BUILD COMPLETE ===");
}

function kiryatRowsCount(entityUnions: EntityUnion[]): number {
  return entityUnions.find((e) => e.sourceId === KIRYAT_SOURCE_ID)?.rows.length ?? 0;
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const isDirectExecution = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  main().catch((e) => { console.error("BUILD_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
}

export { toPureDeal, DEAL_FIELDS, resolveTempPath };
