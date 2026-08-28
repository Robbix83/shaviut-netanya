/**
 * scripts/audit-wave0g22-spiegelman-fetch2.ts — Wave 0G-22: single-street
 * fetch2 contract proof for אברהם שפיגלמן (streetId=74000875), the entity's
 * best-evidenced pagination candidate (total_rows=533, total_fetch=2,
 * fetch1_rows=500 — see audit/wave0g18/street_pagination_summary.csv).
 *
 * CRITICAL RULE this wave enforces in code, not just prose: fetch_number=2
 * is NEVER hand-constructed. It is observed only as a byproduct of clicking
 * the real, visible "הבא" (Next) pagination control on the live street page
 * — the exact mechanism already proven general at the ENTITY level in Wave
 * 0G-9 (scripts/audit-wave0g9-continuation-probe.ts, נוף הטיילת + רסקו, both
 * confirmed fetch 1->2 with zero overlap). This script reuses that same
 * click-through/rows-per-page-derivation technique, applied to a STREET url
 * for the first time, and verifies the result rather than assuming the
 * entity-level proof transfers automatically.
 *
 * Reuses fetch1 from the already-committed evidence
 * (audit/wave0g18/shadow/street_65209683_74000875.json, 500 rows) rather
 * than re-deriving it — Phase 2's instruction. The live page load does fire
 * its own fetch1 request as an unavoidable side effect of reaching fetch2;
 * that live fetch1 is captured ONLY as a cross-check, never substituted for
 * the committed fetch1 dataset used in all reconciliation math below.
 *
 * Applies the unchanged Wave 0G-20 per-row identity policy
 * (lib/streetRowAcceptance.ts) to fetch2 exactly as to any other batch — no
 * whole-batch rejection, no zero/foreign broadening.
 */
import { promises as fs } from "fs";
import path from "path";
import { decodeRequestEnvelope } from "../lib/nadlanAcquisition";
import { decodeDealData } from "../lib/dealNormalization";
import { toShadowDeal, assertSafeShadowOutputPath, transactionKey, type ShadowDeal } from "../lib/shadowRebuild";
import { classifyRowForAcceptance, classifyBatchForAcceptance, classifyBatchStatus } from "../lib/streetRowAcceptance";
import { classifyTransactionGroups } from "./audit-wave0g18-aggregate";
import { extractPrevDealEvents, prevDealKey, type RawPrevDealEvent } from "./audit-wave0g16-citywide-shadow";
import type { Neighborhood } from "../lib/types";
import type { StreetResult } from "./audit-wave0g18-street-runner";

const PARENT_SOURCE_ID = "65209683"; // קריית השרון
const STREET_ID = "74000875";
const STREET_NAME = "אברהם שפיגלמן";
const EXPECTED_STREET_TOTAL_ROWS = 533;
const OUT_DIR_REL = "audit/wave0g22/shadow";
const OUT_DIR = path.join(process.cwd(), OUT_DIR_REL);
const REPORT_DIR = path.join(process.cwd(), "audit/wave0g22");
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

interface CapturedExchange {
  fetchNumber: number | null;
  baseId: string | null;
  baseName: string | null;
  typeOrder: string | null;
  domain: string | null;
  totalRows: number | null;
  totalFetch: number | null;
  totalPage: number | null;
  items: any[];
}

async function main() {
  console.log("=== WAVE 0G-22: SPIEGELMAN (74000875) FETCH2 CONTRACT PROOF ===");
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(REPORT_DIR, { recursive: true });

  // --- Phase 2: reuse the already-committed fetch1 evidence, do not refetch ---
  const fetch1Evidence: StreetResult = JSON.parse(
    await fs.readFile(path.join(process.cwd(), "audit/wave0g18/shadow/street_65209683_74000875.json"), "utf8"),
  );
  console.log(`FETCH1_EVIDENCE: streetId=${fetch1Evidence.streetId} fetchNumberUsed=${(fetch1Evidence as any).fetchNumberUsed} rowsReturned=${(fetch1Evidence as any).rowsReturned} totalRowsIfExposed=${(fetch1Evidence as any).totalRowsIfExposed} totalFetchIfExposed=${(fetch1Evidence as any).totalFetchIfExposed}`);
  const fetch1RowsAll = fetch1Evidence.rows as unknown as ShadowDeal[];
  if (fetch1RowsAll.length !== 500) throw new Error(`FETCH1_EVIDENCE_MISMATCH: expected 500 committed fetch1 rows, got ${fetch1RowsAll.length} — STOP per Phase 2`);
  if ((fetch1Evidence as any).totalRowsIfExposed !== 533) throw new Error(`FETCH1_EVIDENCE_MISMATCH: expected totalRowsIfExposed=533, got ${(fetch1Evidence as any).totalRowsIfExposed} — STOP`);
  if ((fetch1Evidence as any).totalFetchIfExposed !== 2) throw new Error(`FETCH1_EVIDENCE_MISMATCH: expected totalFetchIfExposed=2, got ${(fetch1Evidence as any).totalFetchIfExposed} — STOP`);

  // NOTE (ECC code-reviewer finding, Wave 0G-22): this is NOT an independent
  // re-verification of fetch1's identity purity. fetch1RowsAll are ShadowDeal
  // rows produced by lib/dealNormalization.ts's normalizeDeal(), which always
  // force-sets neighborhoodId to the CALLER-supplied parent id regardless of
  // the raw item's own value — so this loop can only ever report
  // parent=500/zero=0/foreign=0 for any committed fetch1 evidence, by
  // construction. fetch1's true identity purity was already established at
  // ingestion time by Wave 0G-18's runner (which only keeps ACCEPT_PARENT
  // rows in its `rows` array in the first place). This block exists only to
  // surface that count in the same shape as fetch2's classification below,
  // for report symmetry — not as a fresh check.
  let fetch1Parent = 0, fetch1Zero = 0, fetch1Foreign = 0, fetch1Other = 0;
  for (const r of fetch1RowsAll) {
    const decision = classifyRowForAcceptance({ neighborhoodId: (r as any).neighborhoodId }, PARENT_SOURCE_ID);
    if (decision === "ACCEPT_PARENT") fetch1Parent++;
    else if (decision === "REJECT_ZERO") fetch1Zero++;
    else if (decision === "REJECT_FOREIGN") fetch1Foreign++;
    else fetch1Other++;
  }
  console.log(`FETCH1_RECLASSIFIED (report-symmetry only, not an independent check — see comment above): parent=${fetch1Parent} zero=${fetch1Zero} foreign=${fetch1Foreign} other=${fetch1Other}`);
  const fetch1Dates = fetch1RowsAll.map((r) => r.dealDate).filter(Boolean).sort() as string[];
  const FETCH1_EARLIEST = fetch1Dates[0] ?? null;
  const FETCH1_LATEST = fetch1Dates[fetch1Dates.length - 1] ?? null;
  console.log(`FETCH1_DATE_RANGE: ${FETCH1_EARLIEST} to ${FETCH1_LATEST}`);

  // --- Phase 3/4: legitimate live click-through to fetch2, exactly one street, exactly one second-window request ---
  const headless = process.env.HARVEST_HEADLESS === "true";
  const { chromium: pwChromium } = await import("playwright");
  const ctx = await pwChromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless, slowMo: headless ? 0 : 80,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  const exchanges: CapturedExchange[] = [];
  const handler = async (resp: any) => {
    const u = resp.url();
    if (!u.includes("/deal-data")) return;
    try {
      const body = await resp.text();
      const decoded = decodeDealData(body);
      const items = decoded?.data?.items ?? decoded?.items ?? [];
      const req = resp.request();
      const envelope = decodeRequestEnvelope(req.postData());
      if (envelope?.base_name !== "streetCode" || String(envelope?.base_id) !== STREET_ID) return; // not our street's exchange
      exchanges.push({
        fetchNumber: envelope?.fetch_number ?? null,
        baseId: envelope?.base_id != null ? String(envelope.base_id) : null,
        baseName: envelope?.base_name ?? null,
        typeOrder: envelope?.type_order ?? null,
        domain: envelope?.domain ?? null,
        totalRows: decoded?.data?.total_rows ?? null,
        totalFetch: decoded?.data?.total_fetch ?? null,
        totalPage: decoded?.data?.total_page ?? null,
        items,
      });
      console.log(`  [exchange ${exchanges.length}] fetch_number=${envelope?.fetch_number} type_order=${envelope?.type_order} domain=${envelope?.domain} items=${items.length} total_rows=${decoded?.data?.total_rows} total_fetch=${decoded?.data?.total_fetch} total_page=${decoded?.data?.total_page}`);
    } catch (e) {
      console.log("  [parse error] " + (e as Error).message);
    }
  };

  let triggerMechanism: "UI_CONTROL" | "LOCAL_PAGE_EXHAUSTION" | "OTHER_PROVEN_MECHANISM" | "NOT_PROVEN" = "NOT_PROVEN";
  let requestFieldMutationProven = false;
  let newExchangeDetectedAtClick: number | null = null;
  let liveFetch1: CapturedExchange | null = null;
  let nextButtonFound: boolean | null = null;

  try {
    let page: any;
    try {
      page = await ctx.newPage();
      await page.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
    } catch (e) {
      await ctx.close();
      throw e;
    }
    page.on("response", handler);

    const url = `https://www.nadlan.gov.il/?view=street&id=${STREET_ID}&page=deals`;
    console.log("NAVIGATING_TO=" + url);
    const MAX_LOAD_ATTEMPTS = 3; // same street/page only — retries a flaky initial capture, never a different street
    for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS && exchanges.length === 0; attempt++) {
      if (attempt > 1) {
        console.log(`  [retry ${attempt}/${MAX_LOAD_ATTEMPTS}] no fetch1 exchange captured yet, reloading same page`);
        await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
      } else {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      }
      await page.waitForTimeout(9000);
    }

    console.log(`EXCHANGES_AFTER_LOAD=${exchanges.length}`);
    liveFetch1 = exchanges.find((e) => e.fetchNumber === 1) ?? null;
    if (!liveFetch1) throw new Error("NO_LIVE_FETCH1_CAPTURED: could not observe the page's own fetch1 exchange for cross-check after 3 attempts");
    console.log(`LIVE_FETCH1_CROSS_CHECK: items=${liveFetch1.items.length} total_rows=${liveFetch1.totalRows} total_fetch=${liveFetch1.totalFetch} total_page=${liveFetch1.totalPage}`);

    // Find the real, visible "הבא" (Next) button — the same UI-exposed
    // control proven at entity level in Wave 0G-9. Never invented.
    const nextButton = page.locator("button, a").filter({ hasText: "הבא" }).first();
    const nextCount = await nextButton.count();
    nextButtonFound = nextCount > 0;
    console.log("NEXT_BUTTON_COUNT=" + nextCount);
    if (nextCount === 0) {
      console.log("STREET_FETCH2_CONTRACT_NOT_PROVEN: no visible 'הבא' pagination control found on the street page");
    } else {
      triggerMechanism = "UI_CONTROL";
      const totalRowsFromResp = liveFetch1.totalRows ?? undefined;
      const totalPageFromResp = liveFetch1.totalPage ?? undefined;
      const rowsPerPage = totalRowsFromResp && totalPageFromResp ? Math.round(totalRowsFromResp / totalPageFromResp) : 10;
      const locallyLoadedItems = liveFetch1.items.length;
      const pagesInLocalBatch = Math.ceil(locallyLoadedItems / rowsPerPage);
      console.log(`DERIVED_ROWS_PER_PAGE=${rowsPerPage} (total_rows=${totalRowsFromResp} total_page=${totalPageFromResp}) PAGES_IN_LOCAL_BATCH=${pagesInLocalBatch}`);

      const maxClicks = pagesInLocalBatch + 3; // small margin past the computed, data-derived boundary
      const exchangeCountBefore = exchanges.length;
      for (let i = 1; i <= maxClicks; i++) {
        try {
          await nextButton.click({ timeout: 5000 });
        } catch (e) {
          console.log(`  [click ${i}] FAILED: ` + (e as Error).message);
          break;
        }
        await page.waitForTimeout(600);
        if (exchanges.length > exchangeCountBefore) {
          newExchangeDetectedAtClick = i;
          console.log(`  [click ${i}] NEW NETWORK EXCHANGE DETECTED`);
          await page.waitForTimeout(3000);
          break;
        }
      }
      console.log("NEW_EXCHANGE_DETECTED_AT_CLICK=" + newExchangeDetectedAtClick);
      // ECC planner finding (real bug): the loop above already waits 3s after
      // detecting a new exchange, but if the click budget is EXHAUSTED
      // without detection, there was previously no drain — a response still
      // in flight (slow network, slow recaptcha re-verification) could be
      // lost the instant ctx.close() runs. Give any in-flight response a
      // chance to land before closing, regardless of which exit path was taken.
      if (newExchangeDetectedAtClick == null) {
        console.log("  [drain] click budget exhausted without detecting a new exchange — waiting 5s for any in-flight response before closing");
        await page.waitForTimeout(5000);
      }
    }
    page.off("response", handler);
  } finally {
    await ctx.close();
  }

  const fetch2Exchange = exchanges.find((e) => e.fetchNumber === 2);
  if (!fetch2Exchange) {
    console.log("STREET_FETCH2_CONTRACT=STREET_FETCH2_CONTRACT_NOT_PROVEN");
    // ECC code-reviewer finding (LOW): distinguish all 3 failure modes in the
    // PERSISTED artifact, not just the console log.
    const reason = nextButtonFound === false
      ? "no visible 'הבא' pagination control found on the street page — mechanism never had a chance to fire"
      : newExchangeDetectedAtClick == null
        ? "'הבא' control found and clicked through the full data-derived budget, but no new network exchange was ever observed — mechanism did not fire"
        : "a new network exchange was observed after clicking, but it did not carry fetch_number=2 for this street (wrong street or wrong fetch_number)";
    await fs.writeFile(path.join(REPORT_DIR, "fetch2_summary.json"), JSON.stringify({
      streetId: STREET_ID, streetName: STREET_NAME, contract: "NOT_PROVEN",
      reason,
      nextButtonFound, newExchangeDetectedAtClick,
      exchangesObserved: exchanges.map((e) => ({ fetchNumber: e.fetchNumber, itemCount: e.items.length, totalRows: e.totalRows, totalFetch: e.totalFetch })),
    }, null, 2));
    console.log("=== WAVE 0G-22 ENDED: CONTRACT NOT PROVEN ===");
    return;
  }
  requestFieldMutationProven = true;
  console.log(`FETCH2_CAPTURED: baseId=${fetch2Exchange.baseId} fetchNumber=${fetch2Exchange.fetchNumber} items=${fetch2Exchange.items.length} totalRows=${fetch2Exchange.totalRows} totalFetch=${fetch2Exchange.totalFetch}`);

  // Hard safety: identity preserved, no fetch_number>=3 ever attempted.
  if (fetch2Exchange.baseId !== STREET_ID) throw new Error(`SAFETY_VIOLATION: fetch2 exchange base_id=${fetch2Exchange.baseId} does not match requested streetId=${STREET_ID}`);
  if (exchanges.some((e) => (e.fetchNumber ?? 0) >= 3)) throw new Error("SAFETY_VIOLATION: a fetch_number>=3 exchange was observed — this wave authorizes fetch2 only");

  // ECC planner finding: reproduce Wave 0G-9's "FIELD_DIFFERENCES = fetch_number
  // only" claim explicitly rather than assuming it — compare every envelope
  // field, not just base_id/fetch_number.
  const fieldDiffs: string[] = [];
  if (liveFetch1.baseId !== fetch2Exchange.baseId) fieldDiffs.push("baseId");
  if (liveFetch1.baseName !== fetch2Exchange.baseName) fieldDiffs.push("baseName");
  if (liveFetch1.typeOrder !== fetch2Exchange.typeOrder) fieldDiffs.push("typeOrder");
  if (liveFetch1.domain !== fetch2Exchange.domain) fieldDiffs.push("domain");
  console.log(`FETCH1_VS_FETCH2_FIELD_DIFFERENCES=${fieldDiffs.length === 0 ? "fetch_number only (base_id/base_name/type_order/domain unchanged)" : fieldDiffs.join(",") + " (UNEXPECTED — more than fetch_number changed)"}`);

  // ECC planner finding: assert fetch2's own reported total_rows agrees with
  // the official street total — don't silently accept a mismatched total.
  if (fetch2Exchange.totalRows != null && fetch2Exchange.totalRows !== EXPECTED_STREET_TOTAL_ROWS) {
    console.log(`NOTE: fetch2Exchange.totalRows=${fetch2Exchange.totalRows} differs from the official street total_rows=${EXPECTED_STREET_TOTAL_ROWS} known from committed fetch1 evidence — not thrown as an error since the site is the source of truth here, but surfaced for the report.`);
  }

  const outFileRel = `${OUT_DIR_REL}/street_fetch2_${STREET_ID}.json`;
  assertSafeShadowOutputPath(outFileRel);
  await fs.writeFile(path.join(OUT_DIR, `street_fetch2_${STREET_ID}.json`), JSON.stringify({
    streetId: STREET_ID, streetName: STREET_NAME, parentSourceId: PARENT_SOURCE_ID,
    fetchNumber: fetch2Exchange.fetchNumber, totalRows: fetch2Exchange.totalRows, totalFetch: fetch2Exchange.totalFetch,
    rawItems: fetch2Exchange.items,
  }, null, 2));

  // --- Phase 4/8: per-row identity classification (unchanged Wave 0G-20 policy) ---
  const fetch2RawItems = fetch2Exchange.items;
  const counts = classifyBatchForAcceptance(fetch2RawItems, PARENT_SOURCE_ID);
  const batchStatus = classifyBatchStatus(counts);
  const fetch2Other = counts.rejectedMissing + counts.rejectedMalformed;
  console.log(`FETCH2_CLASSIFICATION: raw=${counts.rawRows} parent=${counts.acceptedParent} zero=${counts.rejectedZero} foreign=${counts.rejectedForeign} other=${fetch2Other} status=${batchStatus}`);
  if (counts.acceptedParent + counts.rejectedZero + counts.rejectedForeign + fetch2Other !== counts.rawRows) {
    throw new Error("ACCOUNTING_MISMATCH: fetch2 row classification does not sum to rawRows");
  }

  // --- Phase 11: normalization, measured across ALL raw fetch2 rows regardless of identity class ---
  const neighborhood: Neighborhood = { id: PARENT_SOURCE_ID, name: "קריית השרון", settlement: "נתניה", x: null, y: null };
  let fetch2Normalized = 0;
  const fetch2AcceptedShadowRows: ShadowDeal[] = [];
  const acceptedRawItems = fetch2RawItems.filter((it: any) => classifyRowForAcceptance(it, PARENT_SOURCE_ID) === "ACCEPT_PARENT");
  for (const raw of fetch2RawItems) {
    const shadowRow = toShadowDeal(raw, neighborhood, PARENT_SOURCE_ID);
    if (shadowRow) fetch2Normalized++;
  }
  for (const raw of acceptedRawItems) {
    const shadowRow = toShadowDeal(raw, neighborhood, PARENT_SOURCE_ID);
    if (shadowRow) fetch2AcceptedShadowRows.push(shadowRow);
  }
  const normalizationDrops = counts.rawRows - fetch2Normalized;
  console.log(`FETCH2_NORMALIZATION: raw=${counts.rawRows} normalized=${fetch2Normalized} drops=${normalizationDrops}`);
  // ECC code-reviewer finding (HIGH): a soft NOTE here would let an
  // accepted-parent row that also fails normalization silently shrink
  // fetch2AcceptedShadowRows, which feeds ALL downstream reconciliation math
  // (STREET_UNIQUE, GENUINELY_NEW_TO_KIRYAT, isFetch2WorthScaling) with no
  // error. Fail closed instead, matching Wave 0G-21's SHADOW_CONVERSION_DROP fix.
  if (fetch2AcceptedShadowRows.length !== acceptedRawItems.length) {
    throw new Error(`SHADOW_CONVERSION_DROP: ${STREET_NAME} (${STREET_ID}) fetch2 had ${acceptedRawItems.length} ACCEPT_PARENT rows but only ${fetch2AcceptedShadowRows.length} converted to ShadowDeal — ${acceptedRawItems.length - fetch2AcceptedShadowRows.length} row(s) silently dropped by toShadowDeal (likely missing/non-finite dealAmount)`);
  }

  const fetch2AllDates = fetch2RawItems
    .map((it: any) => { const d = it.dealDate; return d ? new Date(d).toISOString().slice(0, 10) : null; })
    .filter(Boolean).sort() as string[];
  const FETCH2_EARLIEST = fetch2AllDates[0] ?? null;
  const FETCH2_LATEST = fetch2AllDates[fetch2AllDates.length - 1] ?? null;
  console.log(`FETCH2_DATE_RANGE(all raw rows): ${FETCH2_EARLIEST} to ${FETCH2_LATEST}`);

  let fetch2Semantics: string;
  if (FETCH1_LATEST && FETCH2_EARLIEST && FETCH2_LATEST && FETCH1_EARLIEST) {
    if (FETCH2_LATEST < FETCH1_EARLIEST) fetch2Semantics = "OLDER_CONTINUATION (fetch2's latest date is strictly older than fetch1's earliest date)";
    else if (FETCH2_EARLIEST === FETCH1_EARLIEST && FETCH2_LATEST === FETCH1_LATEST) fetch2Semantics = "DUPLICATE_WINDOW (identical date range to fetch1)";
    else fetch2Semantics = "MIXED_OR_OVERLAPPING_WINDOW (date ranges overlap with fetch1)";
  } else {
    fetch2Semantics = "OTHER (insufficient date data to classify)";
  }
  console.log(`FETCH2_SEMANTICS=${fetch2Semantics}`);

  // --- Phase 5: street-level reconciliation (fetch1 + fetch2, same-street dedup) ---
  const streetClassification = classifyTransactionGroups(fetch1RowsAll, [{ streetId: `${STREET_ID}_fetch2`, rows: fetch2AcceptedShadowRows }]);
  const STREET_UNIQUE = streetClassification.augmentedUnion.length;
  const STREET_TRUE_DUPLICATES = streetClassification.trueDuplicateEntityVsStreet + streetClassification.trueDuplicateStreetVsStreet;
  const STREET_AMBIGUOUS = streetClassification.ambiguousCollisions;
  console.log(`STREET_RECONCILIATION: fetch1Raw=${fetch1RowsAll.length} fetch2AcceptedRaw=${fetch2AcceptedShadowRows.length} combinedUnique=${STREET_UNIQUE} trueDuplicates=${STREET_TRUE_DUPLICATES} ambiguousCollisions=${STREET_AMBIGUOUS}`);
  if (STREET_AMBIGUOUS > 0) {
    throw new Error(`INTEGRITY_FAIL: ${STREET_AMBIGUOUS} ambiguous collision(s) in street-level reconciliation — STOP per Phase 9 requirement. See streetClassification.ambiguousExamples.`);
  }
  const EXPECTED_STREET_TOTAL = EXPECTED_STREET_TOTAL_ROWS;
  if (STREET_UNIQUE > EXPECTED_STREET_TOTAL) {
    throw new Error(`INTEGRITY_FAIL: STREET_UNIQUE (${STREET_UNIQUE}) exceeds official street total_rows (${EXPECTED_STREET_TOTAL}) — STOP and investigate per Phase 5.`);
  }
  const STREET_DELTA = EXPECTED_STREET_TOTAL - STREET_UNIQUE;
  const streetCompleteness: "PROVEN" | "PARTIAL" | "FAILED" = STREET_UNIQUE === EXPECTED_STREET_TOTAL ? "PROVEN" : "PARTIAL";
  console.log(`STREET_DELTA=${STREET_DELTA} SPIEGELMAN_STREET_COMPLETENESS=${streetCompleteness}`);

  // ECC planner finding: a separate RAW-row accounting check, independent of
  // the identity/normalization-filtered STREET_UNIQUE above — distinguishes
  // "the site withheld rows" (this check) from "we rejected/dropped rows we
  // did receive" (STREET_UNIQUE/streetCompleteness above). The two can
  // legitimately diverge (e.g. fetch2 contains zero/foreign rows) without
  // either being wrong.
  const RAW_STREET_TOTAL_OBSERVED = fetch1RowsAll.length + counts.rawRows;
  console.log(`RAW_STREET_TOTAL_OBSERVED=${RAW_STREET_TOTAL_OBSERVED} (fetch1=${fetch1RowsAll.length} + fetch2=${counts.rawRows}) vs official total_rows=${EXPECTED_STREET_TOTAL_ROWS}`);
  if (RAW_STREET_TOTAL_OBSERVED !== EXPECTED_STREET_TOTAL_ROWS) {
    console.log(`NOTE: RAW_STREET_TOTAL_OBSERVED (${RAW_STREET_TOTAL_OBSERVED}) differs from official total_rows (${EXPECTED_STREET_TOTAL_ROWS}) — this is the SITE's own raw row count across both fetches, before any identity filtering or normalization on our side. A mismatch here would point at the site (missing/duplicated raw rows across windows), separate from streetCompleteness above, which reflects OUR post-filter unique count.`);
  }

  // --- Phase 7: Kiryat-wide incremental value — reconstruct the CURRENT 5145-row union exactly as Wave 0G-21 did, then extend by its own 36-row recovery ---
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
  if (oldClassification.augmentedUnion.length !== 4831) throw new Error(`RECONSTRUCTION_MISMATCH: expected old union 4831, got ${oldClassification.augmentedUnion.length} — STOP`);

  const wave20Probed = [
    { id: "74001232", path: "audit/wave0g19/shadow/probe_74001232.json" },
    { id: "74001260", path: "audit/wave0g19/shadow/probe_74001260.json" },
    { id: "74000865", path: "audit/wave0g20/shadow/live_control_74000865.json" },
  ];
  const wave2021RecoveredRows: ShadowDeal[] = [];
  for (const p of wave20Probed) {
    const probe = JSON.parse(await fs.readFile(path.join(process.cwd(), p.path), "utf8"));
    const items = probe.rawItems as any[];
    const accepted = items.filter((it: any) => classifyRowForAcceptance(it, PARENT_SOURCE_ID) === "ACCEPT_PARENT");
    for (const raw of accepted) { const s = toShadowDeal(raw, neighborhood, PARENT_SOURCE_ID); if (s) wave2021RecoveredRows.push(s); }
  }
  for (const id of ["74000826", "74001235"]) {
    const probe = JSON.parse(await fs.readFile(path.join(process.cwd(), `audit/wave0g21/shadow/street_fetch_${id}.json`), "utf8"));
    const items = probe.rawItems as any[];
    const accepted = items.filter((it: any) => classifyRowForAcceptance(it, PARENT_SOURCE_ID) === "ACCEPT_PARENT");
    for (const raw of accepted) { const s = toShadowDeal(raw, neighborhood, PARENT_SOURCE_ID); if (s) wave2021RecoveredRows.push(s); }
  }
  const currentUnionClassification = classifyTransactionGroups(oldClassification.augmentedUnion, [{ streetId: "WAVE_0G20_0G21_RECOVERED_CLASS_A", rows: wave2021RecoveredRows }]);
  const CURRENT_KIRYAT_UNIQUE = currentUnionClassification.augmentedUnion.length;
  console.log(`CURRENT_KIRYAT_UNIQUE=${CURRENT_KIRYAT_UNIQUE}`);
  if (CURRENT_KIRYAT_UNIQUE !== 5145) throw new Error(`RECONSTRUCTION_MISMATCH: expected current Kiryat union 5145, got ${CURRENT_KIRYAT_UNIQUE} — STOP`);
  const currentKiryatUnion = currentUnionClassification.augmentedUnion;

  const kiryatClassification = classifyTransactionGroups(currentKiryatUnion, [{ streetId: "WAVE_0G22_SPIEGELMAN_FETCH2", rows: fetch2AcceptedShadowRows }]);
  const KIRYAT_AMBIGUOUS = kiryatClassification.ambiguousCollisions;
  const GENUINELY_NEW_TO_KIRYAT = kiryatClassification.genuinelyNewStreetRows;
  const DUPLICATE_VS_CURRENT_KIRYAT = kiryatClassification.trueDuplicateEntityVsStreet + kiryatClassification.trueDuplicateStreetVsStreet;
  console.log(`KIRYAT_IMPACT: fetch2ParentRows=${fetch2AcceptedShadowRows.length} duplicateVsCurrentKiryat=${DUPLICATE_VS_CURRENT_KIRYAT} genuinelyNewToKiryat=${GENUINELY_NEW_TO_KIRYAT} ambiguousCollisions=${KIRYAT_AMBIGUOUS}`);
  if (KIRYAT_AMBIGUOUS > 0) {
    throw new Error(`INTEGRITY_FAIL: ${KIRYAT_AMBIGUOUS} ambiguous collision(s) at Kiryat-wide scope — STOP per Phase 9. See kiryatClassification.ambiguousExamples.`);
  }
  // ECC database-reviewer finding: the "should agree" argument below depends
  // on fetch1RowsAll's keys actually being a SUBSET of currentKiryatUnion's
  // keys — never previously verified, only assumed. Check the containment
  // directly (hard throw) rather than relying on a soft NOTE if the two
  // genuinely-new counts happen to differ.
  const currentKiryatUnionKeys = new Set(currentKiryatUnion.map((r) => transactionKey(r)));
  const fetch1KeysNotInKiryatUnion = fetch1RowsAll.filter((r) => !currentKiryatUnionKeys.has(transactionKey(r)));
  if (fetch1KeysNotInKiryatUnion.length > 0) {
    throw new Error(`INTEGRITY_FAIL: ${fetch1KeysNotInKiryatUnion.length} of fetch1RowsAll's 500 rows are NOT present in the current 5145-row Kiryat union — the "fetch1 already inside 5145" assumption underlying the street-vs-Kiryat cross-check does not hold. STOP and investigate (Wave 0G-18's own street run may have excluded some of this street's rows from the citywide union, e.g. via an ambiguous-collision exclusion).`);
  }
  // With containment now verified, the street-level "genuinely new" (vs
  // fetch1 alone) and the Kiryat-wide "genuinely new" (vs the full 5145
  // union) should agree unless a fetch2 row coincidentally collides with a
  // DIFFERENT street's already-unioned row — checked explicitly, not assumed.
  const streetGenuinelyNew = streetClassification.genuinelyNewStreetRows;
  if (streetGenuinelyNew !== GENUINELY_NEW_TO_KIRYAT) {
    console.log(`NOTE: street-level genuinely-new (${streetGenuinelyNew}) differs from Kiryat-wide genuinely-new (${GENUINELY_NEW_TO_KIRYAT}) — at least one fetch2 row collides with a different street's already-unioned row (fetch1's own containment in the 5145 union is verified above, so this divergence has a legitimate explanation). Not an error; Kiryat-wide is the authoritative figure for coverage purposes.`);
  }

  const OFFICIAL_KIRYAT_TOTAL = 5640;
  const NEW_KIRYAT_UNIQUE = kiryatClassification.augmentedUnion.length;
  if (NEW_KIRYAT_UNIQUE > OFFICIAL_KIRYAT_TOTAL) throw new Error(`INTEGRITY_FAIL: NEW_KIRYAT_UNIQUE (${NEW_KIRYAT_UNIQUE}) exceeds official total (${OFFICIAL_KIRYAT_TOTAL})`);
  const NEW_KIRYAT_DELTA = OFFICIAL_KIRYAT_TOTAL - NEW_KIRYAT_UNIQUE;
  const NEW_KIRYAT_COVERAGE = (NEW_KIRYAT_UNIQUE / OFFICIAL_KIRYAT_TOTAL) * 100;
  console.log(`NEW_KIRYAT_UNIQUE=${NEW_KIRYAT_UNIQUE} NEW_KIRYAT_DELTA=${NEW_KIRYAT_DELTA} NEW_KIRYAT_COVERAGE=${NEW_KIRYAT_COVERAGE.toFixed(2)}%`);

  // --- Phase 9: transaction safety across fetch1 + fetch2 + current Kiryat union ---
  const rawTransactionEvents = fetch1RowsAll.length + fetch2AcceptedShadowRows.length + currentKiryatUnion.length;
  const allKeysSet = new Set<string>([...currentKiryatUnion, ...fetch1RowsAll, ...fetch2AcceptedShadowRows].map((r) => transactionKey(r)));
  console.log(`TRANSACTION_SAFETY: rawEventsAcrossInputs=${rawTransactionEvents} distinctKeysAcrossInputs=${allKeysSet.size} ambiguousCollisions(street)=${STREET_AMBIGUOUS} ambiguousCollisions(kiryat)=${KIRYAT_AMBIGUOUS}`);

  // --- Phase 10: prevDeals, measured separately, never counted toward top-level totals ---
  let rawFetch2PrevDeals = 0;
  let fetch2RowsWithPrevDeals = 0;
  const fetch2PrevDealEvents: RawPrevDealEvent[] = [];
  for (const raw of fetch2RawItems) {
    const { events } = extractPrevDealEvents(raw, PARENT_SOURCE_ID);
    if (Array.isArray((raw as any).prevDeals) && (raw as any).prevDeals.length > 0) fetch2RowsWithPrevDeals++;
    rawFetch2PrevDeals += events.length;
    fetch2PrevDealEvents.push(...events);
  }
  const uniqueFetch2PrevDealKeys = new Set(fetch2PrevDealEvents.map(prevDealKey));
  // "New historical events vs existing tier": compare against the existing
  // entity baseline's own uniquePrevDeals (already-known historical events),
  // never asserted equal — just measured.
  const existingPrevDealKeys = new Set((baseline.uniquePrevDeals as RawPrevDealEvent[]).map(prevDealKey));
  const newHistoricalEvents = [...uniqueFetch2PrevDealKeys].filter((k) => !existingPrevDealKeys.has(k)).length;
  console.log(`PREVDEALS: fetch2RowsWithPrevDeals=${fetch2RowsWithPrevDeals} rawFetch2PrevDeals=${rawFetch2PrevDeals} uniqueFetch2PrevDeals=${uniqueFetch2PrevDealKeys.size} newHistoricalEventsVsExistingTier=${newHistoricalEvents}`);

  // --- Phase 12/13/14 verdicts ---
  // ECC planner finding: by this point in the code, requestFieldMutationProven
  // is always true (the `if (!fetch2Exchange)` branch above already returned
  // early for the "mechanism never fired" case, writing its own NOT_PROVEN
  // summary). So the contract verdict here is about mechanism legitimacy +
  // identity preservation + dedup safety — NOT about how many rows it
  // yielded. A mechanism that fires correctly but returns 0 accepted rows
  // (e.g. all zero/foreign) is a PROVEN mechanism with a separate, explicitly
  // reported zero-yield fact, never silently folded into a FAILED verdict.
  const streetFetch2Contract: "PROVEN" | "PARTIAL" | "FAILED" = requestFieldMutationProven && STREET_AMBIGUOUS === 0 ? "PROVEN" : "FAILED";
  const fetch2YieldedAcceptedRows = fetch2AcceptedShadowRows.length > 0;
  console.log(`FETCH2_YIELDED_ACCEPTED_ROWS=${fetch2YieldedAcceptedRows} (${fetch2AcceptedShadowRows.length} rows) — reported separately from STREET_FETCH2_CONTRACT, which reflects mechanism legitimacy only`);
  const generalization = "ONE_STREET_PROVEN";
  const remainingKnownOpportunities = { zeroIdMaxRaw: 21, foreignIdRows: "unresolved/unsafe", noStreetSourceGaps: "unresolved" };
  const isFetch2WorthScaling = GENUINELY_NEW_TO_KIRYAT > 0 && streetCompleteness === "PROVEN" ? "YES" : (GENUINELY_NEW_TO_KIRYAT > 0 ? "PARTIAL" : "NO");
  console.log(`STREET_FETCH2_CONTRACT=${streetFetch2Contract} SPIEGELMAN_STREET_COMPLETENESS=${streetCompleteness} STREET_FETCH2_GENERALIZATION=${generalization} IS_FETCH2_WORTH_SCALING=${isFetch2WorthScaling}`);

  // --- Write compact artifacts ---
  const summary = {
    street: { id: STREET_ID, name: STREET_NAME, officialTotalRows: EXPECTED_STREET_TOTAL, totalFetch: 2 },
    fetch1: { rows: fetch1RowsAll.length, parent: fetch1Parent, zero: fetch1Zero, foreign: fetch1Foreign, other: fetch1Other, earliestDate: FETCH1_EARLIEST, latestDate: FETCH1_LATEST },
    fetch2: {
      legitimatelyTriggered: requestFieldMutationProven, triggerMechanism, rowsReturned: counts.rawRows,
      parent: counts.acceptedParent, zero: counts.rejectedZero, foreign: counts.rejectedForeign, other: fetch2Other,
      earliestDate: FETCH2_EARLIEST, latestDate: FETCH2_LATEST, semantics: fetch2Semantics,
      normalizedRows: fetch2Normalized, normalizationDrops,
    },
    streetReconciliation: { fetch1Raw: fetch1RowsAll.length, fetch2Raw: counts.rawRows, fetch2AcceptedRaw: fetch2AcceptedShadowRows.length, trueDuplicates: STREET_TRUE_DUPLICATES, ambiguousCollisions: STREET_AMBIGUOUS, unique: STREET_UNIQUE, official: EXPECTED_STREET_TOTAL, delta: STREET_DELTA, completeness: streetCompleteness },
    kiryatImpact: { oldUnique: CURRENT_KIRYAT_UNIQUE, fetch2ParentRows: fetch2AcceptedShadowRows.length, duplicateVsCurrentKiryat: DUPLICATE_VS_CURRENT_KIRYAT, genuinelyNewToKiryat: GENUINELY_NEW_TO_KIRYAT, newUnique: NEW_KIRYAT_UNIQUE, officialTotal: OFFICIAL_KIRYAT_TOTAL, newDelta: NEW_KIRYAT_DELTA, newCoveragePercent: NEW_KIRYAT_COVERAGE },
    transactionSafety: { ambiguousCollisionsStreet: STREET_AMBIGUOUS, ambiguousCollisionsKiryat: KIRYAT_AMBIGUOUS, distinctKeysAcrossInputs: allKeysSet.size },
    prevDeals: { fetch2RowsWithPrevDeals, rawFetch2PrevDeals, uniqueFetch2PrevDeals: uniqueFetch2PrevDealKeys.size, newHistoricalEventsVsExistingTier: newHistoricalEvents },
    verdicts: { streetFetch2Contract, fetch2YieldedAcceptedRows, spiegelmanStreetCompleteness: streetCompleteness, streetFetch2Generalization: generalization, isFetch2WorthScaling, remainingKnownOpportunities },
  };
  await fs.writeFile(path.join(REPORT_DIR, "fetch2_summary.json"), JSON.stringify(summary, null, 2));

  const csvLines = [
    "WINDOW,RAW_ROWS,PARENT,ZERO,FOREIGN,OTHER,EARLIEST_DATE,LATEST_DATE",
    `FETCH1,${fetch1RowsAll.length},${fetch1Parent},${fetch1Zero},${fetch1Foreign},${fetch1Other},${FETCH1_EARLIEST},${FETCH1_LATEST}`,
    `FETCH2,${counts.rawRows},${counts.acceptedParent},${counts.rejectedZero},${counts.rejectedForeign},${fetch2Other},${FETCH2_EARLIEST},${FETCH2_LATEST}`,
  ];
  await fs.writeFile(path.join(REPORT_DIR, "fetch_window_comparison.csv"), csvLines.join("\n") + "\n");

  console.log("=== WAVE 0G-22 COMPLETE ===");
}

main().catch((e) => { console.error("WAVE0G22_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
