/**
 * scripts/audit-wave0g12-shadow-acquire.ts — Wave 0G-12 Shadow Rebuild V2
 * pilot: live acquisition for ONE official nadlan entity.
 *
 * Uses ONLY mechanisms already proven in prior waves:
 *  - direct sourceId URL navigation (lib/nadlanAcquisition.ts, Wave 0G-8)
 *  - fetch_number continuation via the real, visible "הבא" button. The
 *    `maxFetchNumber` CLI arg is a boolean gate ("continue past fetch 1 at
 *    all?"), NOT a configurable depth — the actual click-loop target is
 *    HARD-CODED to fetch_number>=2 (see the `reachedTarget` check below) and
 *    cannot be raised by any caller value, because 1→2 is the only depth
 *    Wave 0G-9/0G-10 proved safe; fetch 3+ is NOT proven and this script
 *    will never attempt it regardless of what's passed in.
 *  - the real ascending-sort UI toggle, only if the caller opts in
 *    (proven for נוף הטיילת only — Wave 0G-9)
 *
 * Every response is validated with the shared, fail-closed
 * assertDirectIdAcquisitionIdentity() — a batch with even one row from a
 * different entity fails the ENTIRE acquisition, never gets filtered and
 * silently continued.
 *
 * fetch_number itself is read from the REQUEST (via the shared
 * decodeRequestEnvelope()), never the response — Wave 0G-12 found the
 * response body never carries that field (data keys are exactly
 * total_rows/total_fetch/total_page/items).
 *
 * Shadow output is written ONLY under audit/wave0g12/shadow/, guarded by
 * assertSafeShadowOutputPath() (refuses data/deals.json, neighborhoods.json,
 * and any Supabase-shaped path).
 *
 * HARD GUARANTEES: read-only against canonical data, no Supabase, no
 * credential VALUES logged (field names only), no autocomplete/name search,
 * no GovMap fallback, no fabricated fetch_number.
 *
 * Usage:
 *   npx tsx scripts/audit-wave0g12-shadow-acquire.ts <sourceId> <label> <entityName> [maxFetchNumber] [useAscendingSort]
 */
import { promises as fs } from "fs";
import path from "path";
import { buildDirectNeighborhoodUrl, assertDirectIdAcquisitionIdentity, decodeRequestEnvelope } from "../lib/nadlanAcquisition";
import { decodeDealData } from "../lib/dealNormalization";
import {
  toShadowDeal, parsePaginationContract, dedupByTransactionKey,
  assertSafeShadowOutputPath, type ShadowDeal, type PaginationContract,
} from "../lib/shadowRebuild";
import type { Neighborhood } from "../lib/types";

const OUT_DIR_REL = "audit/wave0g12/shadow";
const OUT_DIR = path.join(process.cwd(), OUT_DIR_REL);
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

interface ExchangeRecord {
  seq: number;
  contract: PaginationContract;
  identity: ReturnType<typeof assertDirectIdAcquisitionIdentity>;
  itemCount: number;
  fetchNumber: number | null; // from the REQUEST envelope, not the response
  typeOrder: string | null;
}

async function main() {
  const sourceId = process.argv[2];
  const label = process.argv[3];
  const entityName = process.argv[4] ?? label;
  const maxFetchNumber = Number(process.argv[5] ?? "1");
  const useAscendingSort = process.argv[6] === "true";

  if (!sourceId || !label) {
    console.error("Usage: <sourceId> <label> <entityName> [maxFetchNumber=1] [useAscendingSort=false]");
    process.exit(1);
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const outPathRel = `${OUT_DIR_REL}/${label}.json`;
  assertSafeShadowOutputPath(outPathRel); // fail fast, before any network I/O

  console.log(`=== WAVE 0G-12 SHADOW ACQUIRE (entity=${entityName}, sourceId=${sourceId}, maxFetchNumber=${maxFetchNumber}, ascendingSort=${useAscendingSort}) ===`);

  const neighborhood: Neighborhood = { id: sourceId, name: entityName, settlement: "נתניה", x: null, y: null };

  const headless = process.env.HARVEST_HEADLESS === "true";
  const { chromium: pwChromium } = await import("playwright");
  const ctx = await pwChromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless, slowMo: headless ? 0 : 80,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  let page: any;
  try {
    page = await ctx.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
  } catch (e) {
    await ctx.close();
    throw e;
  }

  const exchanges: ExchangeRecord[] = [];
  const allRawItems: any[] = [];
  let seq = 0;
  let entityFailed = false;
  let failureReason: string | null = null;
  const networkRequestCount = { v: 0 };
  const t0 = Date.now();

  page.on("response", async (resp: any) => {
    const u = resp.url();
    if (!u.includes("/deal-data")) return;
    try {
      const body = await resp.text();
      const decoded = decodeDealData(body);
      const items = decoded?.data?.items ?? decoded?.items ?? [];
      seq++;
      networkRequestCount.v++;
      const contract = parsePaginationContract(decoded, sourceId);
      const req = resp.request();
      const envelope = decodeRequestEnvelope(req.postData());

      // Defense-in-depth (ECC silent-failure-hunter finding, Wave 0G-12):
      // the click-loop's stop condition is a heuristic, not a hard
      // synchronization guarantee — a slow response could in principle let
      // one extra click through before the loop notices fetch_number=2 was
      // already reached, triggering an unproven fetch_number=3+ request.
      // If that ever happens, fail LOUDLY rather than silently accepting
      // data from a depth no prior wave proved safe.
      if (envelope?.fetch_number != null && envelope.fetch_number > 2) {
        entityFailed = true;
        failureReason = `UNEXPECTED_FETCH_NUMBER_BEYOND_PROVEN_DEPTH at exchange ${seq}: fetch_number=${envelope.fetch_number} (only 1 and 2 are proven safe)`;
      }

      // Fail-closed identity check on EVERY exchange — the shared helper
      // requires every single row to match, not "at least one". A mixed
      // batch fails this entity outright; never silently filtered.
      const identity = assertDirectIdAcquisitionIdentity(items, sourceId);
      if (!identity.valid) {
        entityFailed = true;
        failureReason = `IDENTITY_FAIL at exchange ${seq}: ${identity.error}`;
      } else if (!entityFailed) {
        allRawItems.push(...items);
      }

      exchanges.push({
        seq, contract, identity, itemCount: Array.isArray(items) ? items.length : 0,
        fetchNumber: envelope?.fetch_number ?? null, typeOrder: envelope?.type_order ?? null,
      });
      console.log(`  [exchange ${seq}] items=${items.length} identity_valid=${identity.valid} total_rows=${contract.totalRows} total_fetch=${contract.totalFetch} total_page=${contract.totalPage} fetch_number(req)=${envelope?.fetch_number ?? null} type_order=${envelope?.type_order ?? null}`);
    } catch (e) {
      console.log("  [response parse error] " + (e as Error).message);
    }
  });

  let firstContract: PaginationContract | null = null;

  try {
    const url = buildDirectNeighborhoodUrl(sourceId);
    console.log("NAVIGATING_DIRECTLY_TO=" + url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);

    firstContract = exchanges[0]?.contract ?? null;
    console.log("FIRST_CONTRACT=" + JSON.stringify(firstContract));

    // Only continue pagination if the caller-specified proven-safe depth
    // allows it AND the entity's own reported total_fetch says there's
    // more to get. Never push past maxFetchNumber, regardless of what
    // total_fetch claims — that would be exactly the un-proven depth this
    // pilot must not attempt.
    if (!entityFailed && maxFetchNumber > 1 && firstContract?.totalFetch && firstContract.totalFetch > 1) {
      const nextButton = page.locator("button, a").filter({ hasText: "הבא" }).first();
      const nextCount = await nextButton.count();
      if (nextCount > 0) {
        // rowsPerPage derived from the entity's own runtime metadata when
        // available (total_rows/total_page), falling back to the value
        // proven stable across every tested entity so far (Wave 0G-9/10)
        // only when total_page is unavailable in this response shape.
        const rowsPerPage = firstContract.totalRows && firstContract.totalPage
          ? Math.round(firstContract.totalRows / firstContract.totalPage)
          : 10;
        const clickBudget = Math.ceil(500 / rowsPerPage) + 3;
        console.log(`CLICK_BUDGET=${clickBudget} rowsPerPage=${rowsPerPage} (targeting fetch_number=2 only, per proven-safe depth)`);
        for (let i = 1; i <= clickBudget; i++) {
          const reachedTarget = exchanges.some((e) => (e.fetchNumber ?? 0) >= 2);
          if (reachedTarget) { console.log(`FETCH_NUMBER_2_REACHED_AT_CLICK=${i - 1}`); break; }
          try {
            await nextButton.click({ timeout: 5000 });
          } catch (e) {
            console.log(`  [click ${i}] FAILED: ${(e as Error).message}`);
            break;
          }
          await page.waitForTimeout(500);
        }
        await page.waitForTimeout(2500);
      } else {
        console.log("NO_NEXT_BUTTON_FOUND — cannot continue pagination");
      }
    }

    // Ascending-sort surface — ONLY if the caller asserts it's proven for
    // this entity (currently: נוף הטיילת only, Wave 0G-9).
    if (!entityFailed && useAscendingSort) {
      const sortWords = await page.locator("text=מיון").all();
      let toggle: any = null;
      for (const el of sortWords) { if (await el.isVisible().catch(() => false)) { toggle = el; break; } }
      if (toggle) {
        await toggle.click({ timeout: 5000 });
        await page.waitForTimeout(1500);
        const ascOption = page.locator("*", { hasText: "תאריך עסקה - סדר עולה" }).last();
        if (await ascOption.isVisible().catch(() => false)) {
          await ascOption.click({ timeout: 5000 });
          await page.waitForTimeout(6000);
          console.log("ASCENDING_SORT_EXCHANGE_CAPTURED");
        } else {
          console.log("ASC_OPTION_NOT_VISIBLE — ascending sort surface unavailable this run");
        }
      } else {
        console.log("NO_VISIBLE_SORT_TOGGLE_FOUND");
      }
    }
  } catch (e) {
    entityFailed = true;
    failureReason = `NAVIGATION_ERROR: ${(e as Error).message}`;
    console.log("ERROR=" + (e as Error).message);
  } finally {
    await ctx.close();
  }

  const elapsedSeconds = ((Date.now() - t0) / 1000).toFixed(1);

  if (entityFailed) {
    console.log("ENTITY_FAILED=true REASON=" + failureReason);
    await fs.writeFile(
      path.join(OUT_DIR, `${label}.json`),
      JSON.stringify({ sourceId, label, entityName, failed: true, failureReason, exchanges }, null, 2),
    );
    console.log("NETWORK_REQUESTS=" + networkRequestCount.v + " ELAPSED_SECONDS=" + elapsedSeconds);
    process.exit(1);
  }

  // Normalize every accepted raw row into the shadow shape, then dedup by
  // the shared transaction-safe key. toShadowDeal() returns null for a row
  // that fails the shared normalizeDeal() validation (e.g. unparseable
  // price) — this drop is now counted explicitly (ECC silent-failure-hunter
  // finding, Wave 0G-12) so a silent shrink between raw and normalized
  // counts is visible in the output rather than only inferable by
  // subtracting two unlabeled numbers.
  const shadowRowsWithNulls = allRawItems.map((raw) => toShadowDeal(raw, neighborhood, sourceId));
  const normalizationDrops = shadowRowsWithNulls.filter((d) => d === null).length;
  const shadowRows: ShadowDeal[] = shadowRowsWithNulls.filter((d): d is ShadowDeal => d !== null);
  const dedup = dedupByTransactionKey(shadowRows);

  const dates = dedup.uniqueRows.map((r) => r.dealDate).filter(Boolean).sort();
  const summary = {
    sourceId,
    label,
    entityName,
    firstContract,
    exchanges: exchanges.map((e) => ({ seq: e.seq, contract: e.contract, itemCount: e.itemCount, fetchNumber: e.fetchNumber, typeOrder: e.typeOrder, identityValid: e.identity.valid })),
    rawFetchedRows: allRawItems.length,
    normalizationDrops,
    dedup: {
      rawCount: dedup.rawCount, uniqueCount: dedup.uniqueCount, collisions: dedup.collisions,
      nullParcelNumCount: dedup.nullParcelNumCount, emptyDealDateCount: dedup.emptyDealDateCount,
    },
    earliestDate: dates[0] ?? null,
    latestDate: dates[dates.length - 1] ?? null,
    networkRequests: networkRequestCount.v,
    elapsedSeconds: Number(elapsedSeconds),
  };

  // Guard EVERY write target individually — a single guard on the label-
  // derived relative path earlier doesn't cover this second, separately-
  // named file (ECC planner finding).
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/${label}.json`);
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/${label}_summary.json`);
  await fs.writeFile(path.join(OUT_DIR, `${label}.json`), JSON.stringify({ ...summary, uniqueRows: dedup.uniqueRows }, null, 2));
  await fs.writeFile(path.join(OUT_DIR, `${label}_summary.json`), JSON.stringify(summary, null, 2));

  console.log("RAW_FETCHED_ROWS=" + allRawItems.length);
  console.log("NORMALIZATION_DROPS=" + normalizationDrops);
  console.log("UNIQUE_TRANSACTION_ROWS=" + dedup.uniqueCount);
  console.log("EARLIEST_DATE=" + summary.earliestDate);
  console.log("LATEST_DATE=" + summary.latestDate);
  console.log("NETWORK_REQUESTS=" + networkRequestCount.v + " ELAPSED_SECONDS=" + elapsedSeconds);
  console.log("DONE");
}

main().catch((e) => { console.error("SHADOW_ACQUIRE_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
