/**
 * scripts/audit-wave0g21-final-verification.ts — Wave 0G-21: bounded live
 * fetch1 re-probe for the 2 remaining unverified mixed streets from Wave
 * 0G-20 (הפארק=74000826, הרב נרייה=74001235), completing the CLASS-A
 * verification Wave 0G-20 left as a disclosed residual (62 raw rows, no
 * row-level data).
 *
 * Reuses, does not reimplement:
 *  - lib/streetRowAcceptance.ts's classifyBatchForAcceptance/classifyRowForAcceptance
 *    (Wave 0G-20's per-row identity policy, UNCHANGED this wave).
 *  - scripts/audit-wave0g18-aggregate.ts's classifyTransactionGroups (the
 *    same field-agreement-aware dedup/ambiguity classifier every prior wave
 *    used, per the ECC database-reviewer finding from Wave 0G-20: a
 *    hand-rolled key-only dedup risks silently merging distinct transactions
 *    sharing a key).
 *
 * Reconstructs the CURRENT accepted union (5109 rows) by exactly replaying
 * Wave 0G-20's own recovery (old 4831-row Wave 0G-18 union + its 278
 * genuinely-new CLASS A rows from 3 already-verified streets), then treats
 * this wave's 2 newly-verified streets as a further "virtual street" input
 * to the SAME classifier — never a fresh, independently-derived union.
 *
 * fetch_number=1 ONLY, exactly 2 live street requests (one per remaining
 * street), no fetch2, no other streets, no canonical/Supabase writes.
 */
import { promises as fs } from "fs";
import path from "path";
import { decodeRequestEnvelope } from "../lib/nadlanAcquisition";
import { decodeDealData } from "../lib/dealNormalization";
import { toShadowDeal, assertSafeShadowOutputPath, type ShadowDeal } from "../lib/shadowRebuild";
import { classifyRowForAcceptance, classifyBatchForAcceptance, classifyBatchStatus } from "../lib/streetRowAcceptance";
import { classifyTransactionGroups } from "./audit-wave0g18-aggregate";
import type { Neighborhood } from "../lib/types";
import type { StreetResult } from "./audit-wave0g18-street-runner";

const PARENT_SOURCE_ID = "65209683"; // קריית השרון
const OUT_DIR_REL = "audit/wave0g21/shadow";
const OUT_DIR = path.join(process.cwd(), OUT_DIR_REL);
const REPORT_DIR = path.join(process.cwd(), "audit/wave0g21");
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

const TARGET_STREETS = [
  { id: "74000826", name: "הפארק" },
  { id: "74001235", name: "הרב נרייה" },
];

const POST_NAV_SETTLE_MS = 9000;
const MAX_CAPTURE_ATTEMPTS = 3; // same street only — retries a flaky network capture, never a new street

async function liveFetchStreetOnce(streetId: string): Promise<{ envelope: ReturnType<typeof decodeRequestEnvelope>; items: any[] } | null> {
  const headless = process.env.HARVEST_HEADLESS === "true";
  const { chromium: pwChromium } = await import("playwright");
  const ctx = await pwChromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless, slowMo: headless ? 0 : 50,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  let captured: { envelope: ReturnType<typeof decodeRequestEnvelope>; items: any[] } | null = null;
  const handler = async (resp: any) => {
    const u = resp.url();
    if (!u.includes("/deal-data")) return;
    try {
      const body = await resp.text();
      const decoded = decodeDealData(body);
      const items = decoded?.data?.items ?? decoded?.items ?? [];
      const req = resp.request();
      const envelope = decodeRequestEnvelope(req.postData());
      if (captured) return;
      const isMatch = envelope?.base_name === "streetCode" && envelope.base_id != null && String(envelope.base_id) === streetId;
      if (isMatch) captured = { envelope, items };
    } catch (e) {
      console.log("  [parse error] " + (e as Error).message);
    }
  };

  try {
    const page = await ctx.newPage();
    await page.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
    page.on("response", handler);
    const url = `https://www.nadlan.gov.il/?view=street&id=${streetId}&page=deals`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(POST_NAV_SETTLE_MS);
    page.off("response", handler);
  } finally {
    await ctx.close();
  }
  return captured;
}

async function liveFetchStreet(streetId: string, streetName: string): Promise<{ envelope: ReturnType<typeof decodeRequestEnvelope>; items: any[] }> {
  let captured: { envelope: ReturnType<typeof decodeRequestEnvelope>; items: any[] } | null = null;
  for (let attempt = 1; attempt <= MAX_CAPTURE_ATTEMPTS && !captured; attempt++) {
    if (attempt > 1) console.log(`  [retry ${attempt}/${MAX_CAPTURE_ATTEMPTS}] no capture on prior attempt, re-requesting same street`);
    captured = await liveFetchStreetOnce(streetId);
  }
  if (!captured) throw new Error(`NO_CAPTURE: no matching streetCode exchange for ${streetName} (${streetId}) after ${MAX_CAPTURE_ATTEMPTS} attempts`);
  const { envelope } = captured as { envelope: ReturnType<typeof decodeRequestEnvelope>; items: any[] };
  if (envelope?.fetch_number != null && envelope.fetch_number !== 1) {
    throw new Error(`SAFETY_VIOLATION: captured exchange for ${streetName} has fetch_number=${envelope.fetch_number}, this wave requires exactly 1`);
  }
  return captured;
}

async function main() {
  console.log("=== WAVE 0G-21: FINAL MIXED-STREET CLASS-A VERIFICATION ===");
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(REPORT_DIR, { recursive: true });

  // --- Phase 2: reconstruct the CURRENT 5109-row accepted union exactly as
  // Wave 0G-20's own replay did (old 4831-row Wave 0G-18 union + 278
  // genuinely-new CLASS A rows recovered from the 3 already-verified streets). ---
  const baseline = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit/wave0g16/shadow-output/65209683.json"), "utf8"));
  const streetsDir = path.join(process.cwd(), "audit/wave0g18/shadow");
  const manifest = JSON.parse(await fs.readFile(path.join(streetsDir, "street_run_manifest.json"), "utf8"));
  const streetIds = Object.keys(manifest);
  const streetResults: StreetResult[] = [];
  for (const id of streetIds) {
    streetResults.push(JSON.parse(await fs.readFile(path.join(streetsDir, `street_${PARENT_SOURCE_ID}_${id}.json`), "utf8")));
  }
  const successStatuses = ["SUCCESS_ROWS", "SUCCESS_EMPTY", "PARTIAL_MORE_FETCHES_INDICATED"];
  const successfulResults = streetResults.filter((r) => successStatuses.includes(r.status));
  const oldClassification = classifyTransactionGroups(baseline.uniqueRows, successfulResults.map((r) => ({ streetId: r.streetId, rows: r.rows })));
  if (oldClassification.augmentedUnion.length !== 4831) {
    throw new Error(`RECONSTRUCTION_MISMATCH: expected old union 4831, got ${oldClassification.augmentedUnion.length} — STOP`);
  }

  const neighborhood: Neighborhood = { id: PARENT_SOURCE_ID, name: "קריית השרון", settlement: "נתניה", x: null, y: null };
  const wave20Probed = [
    { id: "74001232", path: "audit/wave0g19/shadow/probe_74001232.json", itemsKey: "rawItems" },
    { id: "74001260", path: "audit/wave0g19/shadow/probe_74001260.json", itemsKey: "rawItems" },
    { id: "74000865", path: "audit/wave0g20/shadow/live_control_74000865.json", itemsKey: "rawItems" },
  ];
  const wave20RecoveredRows: ShadowDeal[] = [];
  for (const p of wave20Probed) {
    const probe = JSON.parse(await fs.readFile(path.join(process.cwd(), p.path), "utf8"));
    const items = probe[p.itemsKey] as any[];
    const acceptedItems = items.filter((it: any) => classifyRowForAcceptance(it, PARENT_SOURCE_ID) === "ACCEPT_PARENT");
    for (const raw of acceptedItems) {
      const shadowRow = toShadowDeal(raw, neighborhood, PARENT_SOURCE_ID);
      if (shadowRow) wave20RecoveredRows.push(shadowRow);
    }
  }
  const currentUnionClassification = classifyTransactionGroups(oldClassification.augmentedUnion, [{ streetId: "WAVE_0G20_RECOVERED_CLASS_A", rows: wave20RecoveredRows }]);
  const CURRENT_ACCEPTED_UNIQUE = currentUnionClassification.augmentedUnion.length;
  console.log(`CURRENT_ACCEPTED_UNIQUE=${CURRENT_ACCEPTED_UNIQUE}`);
  if (CURRENT_ACCEPTED_UNIQUE !== 5109) {
    throw new Error(`RECONSTRUCTION_MISMATCH: expected current union 5109, got ${CURRENT_ACCEPTED_UNIQUE} — STOP`);
  }
  const currentUnion = currentUnionClassification.augmentedUnion;

  // --- Phases 4-5: bounded live fetch1 for exactly the 2 remaining streets ---
  const perStreet: any[] = [];
  const newlyAcceptedRowSets: { streetId: string; rows: ShadowDeal[] }[] = [];

  for (const target of TARGET_STREETS) {
    console.log(`--- LIVE FETCH1: ${target.name} (${target.id}) ---`);
    const { envelope, items } = await liveFetchStreet(target.id, target.name);
    console.log(`  RAW_ROWS=${items.length} fetch_number=${envelope?.fetch_number} base_id=${envelope?.base_id}`);

    const counts = classifyBatchForAcceptance(items, PARENT_SOURCE_ID);
    const batchStatus = classifyBatchStatus(counts);
    console.log(`  PARENT=${counts.acceptedParent} ZERO=${counts.rejectedZero} FOREIGN=${counts.rejectedForeign} MISSING=${counts.rejectedMissing} MALFORMED=${counts.rejectedMalformed} STATUS=${batchStatus}`);

    const otherRows = counts.rejectedMissing + counts.rejectedMalformed;
    const accountingOk = counts.acceptedParent + counts.rejectedZero + counts.rejectedForeign + otherRows === counts.rawRows;
    if (!accountingOk) throw new Error(`ACCOUNTING_MISMATCH for ${target.name}`);

    const outFileRel = `${OUT_DIR_REL}/street_fetch_${target.id}.json`;
    assertSafeShadowOutputPath(outFileRel);
    await fs.writeFile(path.join(OUT_DIR, `street_fetch_${target.id}.json`), JSON.stringify({
      streetId: target.id, streetName: target.name, parentSourceId: PARENT_SOURCE_ID, envelope, counts, batchStatus, rawItems: items,
    }, null, 2));

    const acceptedItems = items.filter((it: any) => classifyRowForAcceptance(it, PARENT_SOURCE_ID) === "ACCEPT_PARENT");
    const streetRows: ShadowDeal[] = [];
    for (const raw of acceptedItems) {
      const shadowRow = toShadowDeal(raw, neighborhood, PARENT_SOURCE_ID);
      if (shadowRow) streetRows.push(shadowRow);
    }
    // ECC finding (silent-failure-hunter): toShadowDeal() can return null for
    // an accepted-parent row (e.g. missing/non-finite dealAmount), which was
    // previously dropped with no counter and no error — a future run with a
    // malformed accepted row would silently under-report newAcceptedUnique.
    // Fail closed instead of silently reconciling by coincidence.
    if (streetRows.length !== acceptedItems.length) {
      throw new Error(`SHADOW_CONVERSION_DROP: ${target.name} (${target.id}) had ${acceptedItems.length} ACCEPT_PARENT rows but only ${streetRows.length} converted to ShadowDeal — ${acceptedItems.length - streetRows.length} row(s) silently dropped by toShadowDeal (likely missing/non-finite dealAmount)`);
    }
    newlyAcceptedRowSets.push({ streetId: target.id, rows: streetRows });

    perStreet.push({
      streetId: target.id, name: target.name,
      rawRows: counts.rawRows, parentRows: counts.acceptedParent, zeroRows: counts.rejectedZero,
      foreignRows: counts.rejectedForeign, otherRows,
      batchStatus,
    });
  }

  // --- Phase 6: dedup the 2 newly accepted row sets against the CURRENT
  // 5109-row union, using the same classifyTransactionGroups classifier. ---
  const finalClassification = classifyTransactionGroups(currentUnion, newlyAcceptedRowSets);
  const TRUE_DUPLICATES = finalClassification.trueDuplicateEntityVsStreet + finalClassification.trueDuplicateStreetVsStreet;
  const AMBIGUOUS_COLLISIONS = finalClassification.ambiguousCollisions;
  const TOTAL_GENUINELY_NEW = finalClassification.genuinelyNewStreetRows;
  console.log(`TRUE_DUPLICATES=${TRUE_DUPLICATES}`);
  console.log(`AMBIGUOUS_COLLISIONS=${AMBIGUOUS_COLLISIONS}`);
  console.log(`TOTAL_GENUINELY_NEW=${TOTAL_GENUINELY_NEW}`);

  // Phase 7 hard requirement.
  if (AMBIGUOUS_COLLISIONS > 0) {
    throw new Error(`INTEGRITY_FAIL: ${AMBIGUOUS_COLLISIONS} ambiguous collision(s) — STOP per Phase 7 requirement (must be 0). See finalClassification.ambiguousExamples.`);
  }

  // Per-street genuinely-new breakdown (valid since the 2 streets don't overlap each other — verified below).
  let perStreetNewSum = 0;
  for (const s of newlyAcceptedRowSets) {
    const c = classifyTransactionGroups(currentUnion, [s]);
    const entry = perStreet.find((r) => r.streetId === s.streetId)!;
    entry.newRows = c.genuinelyNewStreetRows;
    entry.duplicateRows = c.trueDuplicateEntityVsStreet + c.trueDuplicateStreetVsStreet;
    perStreetNewSum += c.genuinelyNewStreetRows;
  }
  const parkVsNeriaOverlap = finalClassification.trueDuplicateStreetVsStreet;
  console.log(`PARK_VS_NERIA_STREET_VS_STREET_DUPLICATES=${parkVsNeriaOverlap}`);
  if (parkVsNeriaOverlap === 0 && perStreetNewSum !== TOTAL_GENUINELY_NEW) {
    throw new Error(`INTEGRITY_FAIL: per-street genuinely-new sum (${perStreetNewSum}) does not reconcile with combined TOTAL_GENUINELY_NEW (${TOTAL_GENUINELY_NEW}) — STOP and investigate.`);
  }

  const NEW_UNIQUE = finalClassification.augmentedUnion.length;
  const OFFICIAL_TOTAL = 5640;
  if (NEW_UNIQUE > OFFICIAL_TOTAL) {
    throw new Error(`INTEGRITY_FAIL: NEW_UNIQUE (${NEW_UNIQUE}) exceeds official total (${OFFICIAL_TOTAL}) — STOP and investigate.`);
  }
  const NEW_DELTA = OFFICIAL_TOTAL - NEW_UNIQUE;
  const NEW_COVERAGE_PERCENT = (NEW_UNIQUE / OFFICIAL_TOTAL) * 100;
  console.log(`OLD_UNIQUE=${CURRENT_ACCEPTED_UNIQUE}`);
  console.log(`NEW_UNIQUE=${NEW_UNIQUE}`);
  console.log(`NEW_DELTA=${NEW_DELTA}`);
  console.log(`NEW_COVERAGE_PERCENT=${NEW_COVERAGE_PERCENT.toFixed(2)}%`);

  const explicitParentAccepted = perStreet.reduce((s, r) => s + r.parentRows, 0);

  const summary = {
    currentAcceptedUniqueBefore: CURRENT_ACCEPTED_UNIQUE,
    officialTotal: OFFICIAL_TOTAL,
    perStreet,
    trueDuplicates: TRUE_DUPLICATES,
    ambiguousCollisions: AMBIGUOUS_COLLISIONS,
    parkVsNeriaStreetVsStreetDuplicates: parkVsNeriaOverlap,
    totalGenuinelyNew: TOTAL_GENUINELY_NEW,
    newAcceptedUnique: NEW_UNIQUE,
    newDelta: NEW_DELTA,
    newCoveragePercent: NEW_COVERAGE_PERCENT,
    explicitParentAccepted,
    zeroAccepted: 0,
    foreignAccepted: 0,
    perRowIdentityPolicyUnchanged: true,
  };
  await fs.writeFile(path.join(REPORT_DIR, "final_verification_summary.json"), JSON.stringify(summary, null, 2));

  const csvLines = ["STREET_ID,STREET_NAME,RAW_ROWS,PARENT_ROWS,ZERO_ROWS,FOREIGN_ROWS,OTHER_ROWS,PARENT_DUPLICATES,PARENT_GENUINELY_NEW,BATCH_STATUS"];
  for (const r of perStreet) csvLines.push([r.streetId, `"${r.name}"`, r.rawRows, r.parentRows, r.zeroRows, r.foreignRows, r.otherRows, r.duplicateRows ?? 0, r.newRows ?? 0, `"${r.batchStatus}"`].join(","));
  await fs.writeFile(path.join(REPORT_DIR, "two_street_recovery.csv"), csvLines.join("\n") + "\n");

  console.log("=== WAVE 0G-21 VERIFICATION COMPLETE ===");
}

main().catch((e) => { console.error("WAVE0G21_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
