/**
 * scripts/audit-wave0g19-analyze.ts — Wave 0G-19 Phases 4-8: read-only
 * analysis of the raw rows captured by audit-wave0g19-zero-id-probe.ts
 * (2 streets: בני רייך 74001232, טום לנטוס 74001260 — 20 of the 21 total
 * zero-id rows found across Wave 0G-18's 7 FAILED_IDENTITY streets).
 *
 * No network calls. No acceptance/merge decision. Pure inspection +
 * cross-reference against the already-committed/captured entity-level
 * baseline (audit/wave0g16/shadow-output/65209683.json).
 */
import { promises as fs } from "fs";
import path from "path";

const PARENT_SOURCE_ID = "65209683";
const OUT_DIR_REL = "audit/wave0g19";
const OUT_DIR = path.join(process.cwd(), OUT_DIR_REL);

function txKey(parcelNum: any, dealDate: any, dealAmount: any): string {
  const parcel = parcelNum != null ? String(parcelNum) : "∅NULL_PARCEL∅";
  const date = dealDate ? new Date(dealDate).toISOString().slice(0, 10) : "";
  const amount = typeof dealAmount === "number" ? dealAmount : Number(String(dealAmount ?? "").replace(/[^\d.]/g, ""));
  return `${parcel}|${date ? "1" : "0"}:${date}|${amount}`;
}

async function main() {
  const probe1 = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit/wave0g19/shadow/probe_74001232.json"), "utf8"));
  const probe2 = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit/wave0g19/shadow/probe_74001260.json"), "utf8"));
  const probes = [probe1, probe2];

  const baseline = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit/wave0g16/shadow-output/65209683.json"), "utf8"));
  const baselineByKey = new Map<string, any>();
  for (const r of baseline.uniqueRows) baselineByKey.set(txKey(r.parcelNum, r.dealDate, r.price), r);

  console.log("=== WAVE 0G-19 PHASE 4-8 ANALYSIS ===");

  const allZeroRows: { streetId: string; streetName: string; item: any }[] = [];
  const allParentRows: { streetId: string; streetName: string; item: any }[] = [];
  for (const p of probes) {
    for (const item of p.rawItems) {
      const nid = item.neighborhoodId != null ? String(item.neighborhoodId) : null;
      if (nid === "0") allZeroRows.push({ streetId: p.streetId, streetName: p.streetName, item });
      else if (nid === PARENT_SOURCE_ID) allParentRows.push({ streetId: p.streetId, streetName: p.streetName, item });
    }
  }
  console.log(`ZERO_ROWS_TOTAL=${allZeroRows.length} (12 from בני רייך + 8 from טום לנטוס)`);
  console.log(`PARENT_ROWS_TOTAL_SAME_BATCHES=${allParentRows.length}`);

  // --- Phase 4: field inventory ---
  const fieldCounts: Record<string, number> = {};
  const fieldExamples: Record<string, any> = {};
  for (const { item } of allZeroRows) {
    for (const [k, v] of Object.entries(item)) {
      if (v !== null && v !== undefined && v !== "") {
        fieldCounts[k] = (fieldCounts[k] ?? 0) + 1;
        if (fieldExamples[k] === undefined) fieldExamples[k] = v;
      }
    }
  }
  console.log("PHASE4_FIELD_INVENTORY=" + JSON.stringify(Object.keys(fieldCounts).map((k) => ({
    field: k, presentRate: `${fieldCounts[k]}/${allZeroRows.length}`, example: typeof fieldExamples[k] === "object" ? JSON.stringify(fieldExamples[k]) : fieldExamples[k],
  })), null, 2));

  const zeroWithRequestedStreetId = allZeroRows.filter(({ streetId, item }) => item.streetCode != null && String(item.streetCode) === streetId).length;
  const zeroWithOtherStreetId = allZeroRows.filter(({ streetId, item }) => item.streetCode != null && String(item.streetCode) !== streetId).length;
  const zeroWithNoStreetId = allZeroRows.filter(({ item }) => item.streetCode == null).length;
  console.log(`ZERO_ROWS_WITH_REQUESTED_STREET_ID=${zeroWithRequestedStreetId}`);
  console.log(`ZERO_ROWS_WITH_OTHER_STREET_ID=${zeroWithOtherStreetId}`);
  console.log(`ZERO_ROWS_WITH_NO_STREET_ID=${zeroWithNoStreetId}`);

  // --- Phase 5: street-name/address consistency ---
  let exactName = 0, otherName = 0, missingName = 0, validHouse = 0, streetZeroTxt = 0;
  for (const { streetName, item } of allZeroRows) {
    const addr: string = item.address ?? "";
    if (!addr) { missingName++; continue; }
    if (addr.startsWith(streetName + " ") || addr === streetName) exactName++;
    else otherName++;
    const m = addr.trim().match(/^(.+?)\s+(\d+[א-ת]?)$/);
    if (m && m[2]) validHouse++;
    if (item.address === "0" || (item.address ?? "").trim() === "0") streetZeroTxt++;
  }
  console.log(`ZERO_ROWS_EXACT_REQUESTED_STREET_NAME=${exactName}`);
  console.log(`ZERO_ROWS_OTHER_STREET_NAME=${otherName}`);
  console.log(`ZERO_ROWS_MISSING_STREET_NAME=${missingName}`);
  console.log(`ZERO_ROWS_VALID_HOUSE_NUMBER=${validHouse}`);
  console.log(`ZERO_ROWS_STREET_ZERO_TEXT=${streetZeroTxt}`);

  // --- Phase 6: cross-check against entity-level baseline corpus ---
  let alreadyInBaseline = 0, notInBaseline = 0;
  const entityCopyIds: string[] = [];
  const bridgeDetails: any[] = [];
  for (const { streetId, streetName, item } of allZeroRows) {
    const key = txKey(item.parcelNum, item.dealDate, item.dealAmount);
    const match = baselineByKey.get(key);
    if (match) {
      alreadyInBaseline++;
      entityCopyIds.push(String(match.neighborhoodId));
      bridgeDetails.push({ streetId, streetName, parcelNum: item.parcelNum, dealDate: item.dealDate, address: item.address, baselineNeighborhoodId: match.neighborhoodId, evidence: "PRESENT_IN_ENTITY_BASELINE_WITH_PARENT_ID" });
    } else {
      notInBaseline++;
      bridgeDetails.push({ streetId, streetName, parcelNum: item.parcelNum, dealDate: item.dealDate, address: item.address, baselineNeighborhoodId: null, evidence: "NOT_IN_ENTITY_BASELINE" });
    }
  }
  console.log(`ZERO_ROWS_ALREADY_PRESENT_IN_PARENT_ENTITY_CORPUS=${alreadyInBaseline}`);
  console.log(`ZERO_ROWS_NOT_PRESENT_IN_PARENT_ENTITY_CORPUS=${notInBaseline}`);
  const entityCopyParentId = entityCopyIds.filter((x) => x === PARENT_SOURCE_ID).length;
  const entityCopyZeroId = entityCopyIds.filter((x) => x === "0").length;
  const entityCopyOtherId = entityCopyIds.filter((x) => x !== PARENT_SOURCE_ID && x !== "0").length;
  console.log(`ENTITY_COPY_PARENT_ID=${entityCopyParentId} ENTITY_COPY_ZERO_ID=${entityCopyZeroId} ENTITY_COPY_OTHER_ID=${entityCopyOtherId}`);

  // --- Phase 8: parcel/address bridge to explicit-parent rows in SAME batch ---
  const parentParcels = new Set(allParentRows.map(({ item }) => item.parcelNum));
  const parentAddresses = new Set(allParentRows.map(({ item }) => item.address));
  let parcelBridged = 0, addressBridged = 0, bothBridged = 0, noBridge = 0;
  for (const { item } of allZeroRows) {
    const pBridge = parentParcels.has(item.parcelNum);
    const aBridge = parentAddresses.has(item.address);
    if (pBridge && aBridge) bothBridged++;
    else if (pBridge) parcelBridged++;
    else if (aBridge) addressBridged++;
    else noBridge++;
  }
  console.log(`ZERO_ROWS_PARCEL_BRIDGED_TO_PARENT_SAME_BATCH=${parcelBridged}`);
  console.log(`ZERO_ROWS_ADDRESS_BRIDGED_TO_PARENT_SAME_BATCH=${addressBridged}`);
  console.log(`ZERO_ROWS_BOTH_BRIDGED_SAME_BATCH=${bothBridged}`);
  console.log(`ZERO_ROWS_NO_BRIDGE_SAME_BATCH=${noBridge}`);

  // --- Phase 7: evidence-level classification ---
  // Criteria (defined explicitly, not invented ad hoc per row):
  //   LEVEL_3_STRONG: already present in trusted entity-level baseline WITH parent id (Phase 6 direct proof)
  //   LEVEL_2_MODERATE: not in baseline, but source-native streetCode matches request AND address text matches requested street exactly (Phase 4/5 proof)
  //   LEVEL_1_WEAK: source-native streetCode matches but address text does not exactly match (partial evidence)
  //   UNRESOLVED: neither streetCode nor address evidence supports the requested street
  let level3 = 0, level2 = 0, level1 = 0, unresolved = 0;
  for (const { streetId, streetName, item } of allZeroRows) {
    const key = txKey(item.parcelNum, item.dealDate, item.dealAmount);
    const inBaseline = baselineByKey.has(key);
    const streetIdMatch = item.streetCode != null && String(item.streetCode) === streetId;
    const addr: string = item.address ?? "";
    const nameMatch = addr.startsWith(streetName + " ") || addr === streetName;
    if (inBaseline) level3++;
    else if (streetIdMatch && nameMatch) level2++;
    else if (streetIdMatch) level1++;
    else unresolved++;
  }
  console.log(`EVIDENCE_LEVEL_3_STRONG=${level3}`);
  console.log(`EVIDENCE_LEVEL_2_MODERATE=${level2}`);
  console.log(`EVIDENCE_LEVEL_1_WEAK=${level1}`);
  console.log(`UNRESOLVED=${unresolved}`);

  await fs.mkdir(OUT_DIR, { recursive: true });
  const csvLines = ["STREET_ID,STREET_NAME,PARCEL_NUM,DEAL_DATE,ADDRESS,STREET_CODE_MATCH,NAME_MATCH,IN_BASELINE,BASELINE_NEIGHBORHOOD_ID,EVIDENCE_LEVEL"];
  for (const { streetId, streetName, item } of allZeroRows) {
    const key = txKey(item.parcelNum, item.dealDate, item.dealAmount);
    const match = baselineByKey.get(key);
    const streetIdMatch = item.streetCode != null && String(item.streetCode) === streetId;
    const addr: string = item.address ?? "";
    const nameMatch = addr.startsWith(streetName + " ") || addr === streetName;
    const level = match ? "LEVEL_3_STRONG" : (streetIdMatch && nameMatch) ? "LEVEL_2_MODERATE" : streetIdMatch ? "LEVEL_1_WEAK" : "UNRESOLVED";
    csvLines.push([streetId, streetName, item.parcelNum, item.dealDate, `"${addr}"`, streetIdMatch, nameMatch, !!match, match?.neighborhoodId ?? "", level].join(","));
  }
  await fs.writeFile(path.join(OUT_DIR, "zero_id_evidence.csv"), csvLines.join("\n") + "\n");

  console.log("BRIDGE_DETAILS=" + JSON.stringify(bridgeDetails, null, 2));
  console.log("=== ANALYSIS COMPLETE ===");
}

main().catch((e) => { console.error("ANALYZE_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
