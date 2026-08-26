/**
 * scripts/audit-wave0g14-rasko-rooms-sort.ts — Wave 0G-14 Phase 8: SECOND
 * (and final, per this wave's 2-request budget) alternate-sort test.
 * Acquires Rasko's ROOM-COUNT-DESCENDING sort surface, fetch_number=1 ONLY.
 *
 * Price-descending (Phase 6/7) recovered only 2 of the 12 missing rows
 * (2002/2012, delta=10) — both landing exactly in the known ~3-month gap
 * window, but far from complete. Room-count is the last remaining legitimate
 * sort option found in Phase 4 ("מס' חדרים - סדר יורד"/"עולה").
 *
 * HARD STOP: fetch_number=1 only. No "הבא" clicks. No fetch 2. This is the
 * SECOND and LAST new-sort live request this wave (budget = 2, per Phase 8).
 */
import { promises as fs } from "fs";
import path from "path";
import { buildDirectNeighborhoodUrl, assertDirectIdAcquisitionIdentity, decodeRequestEnvelope } from "../lib/nadlanAcquisition";
import { decodeDealData } from "../lib/dealNormalization";
import { parsePaginationContract, assertSafeShadowOutputPath, type PaginationContract } from "../lib/shadowRebuild";

const SOURCE_ID = "65210248";
const ENTITY_NAME = "רסקו";
const OUT_DIR_REL = "audit/wave0g14/shadow";
const OUT_DIR = path.join(process.cwd(), OUT_DIR_REL);
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

interface ExchangeRecord {
  seq: number;
  contract: PaginationContract;
  identity: ReturnType<typeof assertDirectIdAcquisitionIdentity>;
  itemCount: number;
  fetchNumber: number | null;
  typeOrder: string | null;
  rawItems: any[];
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/rasko_rooms_sort_raw.json`);

  console.log(`=== WAVE 0G-14 PHASE 8: RASKO ROOMS-DESC FETCH 1 (sourceId=${SOURCE_ID}) ===`);

  const headless = process.env.HARVEST_HEADLESS === "true";
  const { chromium: pwChromium } = await import("playwright");
  const ctx = await pwChromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless, slowMo: headless ? 0 : 80,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  const exchanges: ExchangeRecord[] = [];
  let seq = 0;
  let entityFailed = false;
  let failureReason: string | null = null;
  const networkRequestCount = { v: 0 };
  const t0 = Date.now();

  let page: any;
  try {
    page = await ctx.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    page.on("response", async (resp: any) => {
      const u = resp.url();
      if (!u.includes("/deal-data")) return;
      try {
        const body = await resp.text();
        const decoded = decodeDealData(body);
        const items = decoded?.data?.items ?? decoded?.items ?? [];
        seq++;
        networkRequestCount.v++;
        const contract = parsePaginationContract(decoded, SOURCE_ID);
        const req = resp.request();
        const envelope = decodeRequestEnvelope(req.postData());

        if (!envelope) {
          entityFailed = true;
          failureReason = `UNDECODABLE_REQUEST_ENVELOPE at exchange ${seq} — cannot verify fetch_number/type_order, failing closed`;
        } else if (envelope.fetch_number != null && envelope.fetch_number > 1) {
          entityFailed = true;
          failureReason = `UNEXPECTED_FETCH_NUMBER_BEYOND_PHASE8_SCOPE at exchange ${seq}: fetch_number=${envelope.fetch_number} (this run is fetch_number=1 ONLY)`;
        }

        const identity = assertDirectIdAcquisitionIdentity(items, SOURCE_ID);
        if (!identity.valid) {
          entityFailed = true;
          failureReason = `IDENTITY_FAIL at exchange ${seq}: ${identity.error}`;
        }

        exchanges.push({
          seq, contract, identity, itemCount: Array.isArray(items) ? items.length : 0,
          fetchNumber: envelope?.fetch_number ?? null, typeOrder: envelope?.type_order ?? null,
          rawItems: identity.valid && !entityFailed ? items : [],
        });
        console.log(`  [exchange ${seq}] items=${items.length} identity_valid=${identity.valid} total_rows=${contract.totalRows} fetch_number(req)=${envelope?.fetch_number ?? null} type_order=${envelope?.type_order ?? null}`);
      } catch (e) {
        console.log("  [response parse error] " + (e as Error).message);
      }
    });

    const url = buildDirectNeighborhoodUrl(SOURCE_ID);
    console.log("NAVIGATING_DIRECTLY_TO=" + url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    console.log("BASELINE_DESC_LOADED=" + (exchanges[0]?.itemCount ?? 0));

    const sortWords = await page.locator("text=מיון").all();
    let toggle: any = null;
    for (const el of sortWords) { if (await el.isVisible().catch(() => false)) { toggle = el; break; } }
    if (!toggle) throw new Error("NO_VISIBLE_SORT_TOGGLE_FOUND");
    await toggle.click({ timeout: 5000 });
    await page.waitForTimeout(1500);

    const roomsDescOption = page.locator("*", { hasText: "מס' חדרים - סדר יורד" }).last();
    if (!(await roomsDescOption.isVisible().catch(() => false))) throw new Error("ROOMS_DESC_OPTION_NOT_VISIBLE");
    const exCountBefore = exchanges.length;
    await roomsDescOption.click({ timeout: 5000 });
    await page.waitForTimeout(6000);
    const capturedNewExchange = exchanges.some((e) => e.typeOrder === "roomNum_down");
    console.log("ROOMS_DESC_FETCH_1_CAPTURED=" + capturedNewExchange);
    // A visible+clicked option that produces no new roomNum_down exchange
    // (stale DOM, debounced handler, no-op re-click) must not be silently
    // reported as success with only baseline dealDate_down data (ECC
    // silent-failure-hunter finding).
    if (!capturedNewExchange && !entityFailed) {
      entityFailed = true;
      failureReason = "SORT_CLICK_PRODUCED_NO_NEW_FETCH: clicked the visible rooms-desc option but no roomNum_down /deal-data exchange was observed";
    }
  } catch (e) {
    entityFailed = true;
    failureReason = `NAVIGATION_ERROR: ${(e as Error).message}`;
    console.log("ERROR=" + (e as Error).message);
  } finally {
    await ctx.close();
  }

  if (entityFailed) {
    for (const e of exchanges) e.rawItems = [];
  }

  const elapsedSeconds = ((Date.now() - t0) / 1000).toFixed(1);
  const out = {
    sourceId: SOURCE_ID, entityName: ENTITY_NAME, selectedSortLabel: "מס' חדרים - סדר יורד",
    entityFailed, failureReason,
    exchanges: exchanges.map((e) => ({
      seq: e.seq, contract: e.contract, itemCount: e.itemCount, fetchNumber: e.fetchNumber,
      typeOrder: e.typeOrder, identityValid: e.identity.valid, rawItemCount: e.rawItems.length,
    })),
    networkRequests: networkRequestCount.v, elapsedSeconds: Number(elapsedSeconds),
  };
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/rasko_rooms_sort_meta.json`);
  await fs.writeFile(path.join(OUT_DIR, "rasko_rooms_sort_meta.json"), JSON.stringify(out, null, 2));

  const allRawByExchange = exchanges.map((e) => ({ seq: e.seq, typeOrder: e.typeOrder, fetchNumber: e.fetchNumber, items: e.rawItems }));
  await fs.writeFile(path.join(OUT_DIR, "rasko_rooms_sort_raw.json"), JSON.stringify(allRawByExchange, null, 2));

  console.log("ENTITY_FAILED=" + entityFailed + (failureReason ? " REASON=" + failureReason : ""));
  console.log("NETWORK_REQUESTS=" + networkRequestCount.v + " ELAPSED_SECONDS=" + elapsedSeconds);
  console.log("DONE");
}

main().catch((e) => { console.error("ROOMS_SORT_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
