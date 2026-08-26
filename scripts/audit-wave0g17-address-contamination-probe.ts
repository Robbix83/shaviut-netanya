/**
 * scripts/audit-wave0g17-address-contamination-probe.ts — Wave 0G-17 Phase
 * 8/9/13 bounded live test: clicks a real, Netanya-scoped address
 * suggestion (default: "הר שגיא 3 נתניה") and measures, for קריית השרון
 * specifically (not the different entity/street Wave 0G-3 tested 3 waves
 * ago), how many rows return, how many are genuinely on-street vs
 * contaminated from neighboring streets, and whether entity identity holds.
 *
 * This IS the free-text/autocomplete `addressId` path — a real, clean,
 * single-address LOOKUP mechanism (not enumerable; requires an already-known
 * address), distinct from the free-text/scroll path Wave 0G-3 found
 * contamination-prone. It is a SEPARATE, narrower mechanism from the
 * `streetCode`-based direct street query this same wave later discovered and
 * proved (see scripts/audit-wave0g17-street-fetch.ts,
 * scripts/audit-wave0g17-street-url-probe.ts) — that street-level mechanism
 * supersedes this one in practical value for closing PARTIAL entities' gaps
 * (see the wave report's corrected Phase 5/6/9), but this script's own
 * addressId finding remains valid, independent evidence about the address-
 * level (not street-level) contract specifically.
 *
 * Single bounded interaction. No fetch_number>=2 attempted (this mechanism
 * has never been proven safe past its own natural stop condition). No
 * canonical/Supabase writes.
 */
import { promises as fs } from "fs";
import path from "path";
import { assertDirectIdAcquisitionIdentity, decodeRequestEnvelope } from "../lib/nadlanAcquisition";
import { decodeDealData } from "../lib/dealNormalization";
import { assertSafeShadowOutputPath } from "../lib/shadowRebuild";

const SOURCE_ID = "65209683"; // קריית השרון
const OUT_DIR_REL = "audit/wave0g17/shadow";
const OUT_DIR = path.join(process.cwd(), OUT_DIR_REL);
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

// Address house number is parameterized (ECC planner finding): the wave's
// own captured trend data (filter_panel_text.txt) shows "הר שגיא 4" has a
// documented ~15.8-year price-growth trend, implying real pre-2025 sale
// history that a single test on "הר שגיא 3" (a 2025-only result) could not
// have surfaced — a more discriminating second data point than re-testing
// an equally-recent address would have been.
const HOUSE_NUMBER = process.argv[2] ?? "3";
const STREET_QUERY = "הר שגיא";
const TARGET_SUGGESTION_TEXT = `${STREET_QUERY} ${HOUSE_NUMBER} נתניה`;
const OUT_FILE = `address_contamination_probe_raw_${HOUSE_NUMBER}.json`;

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/${OUT_FILE}`);
  console.log(`=== WAVE 0G-17 ADDRESS-SUGGESTION CONTAMINATION PROBE: ${TARGET_SUGGESTION_TEXT} ===`);

  const headless = process.env.HARVEST_HEADLESS === "true";
  const { chromium: pwChromium } = await import("playwright");
  const ctx = await pwChromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless, slowMo: headless ? 0 : 60,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  const exchanges: any[] = [];
  let networkRequests = 0;

  try {
    const page = await ctx.newPage();
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
        networkRequests++;
        const req = resp.request();
        const envelope = decodeRequestEnvelope(req.postData());
        const identity = assertDirectIdAcquisitionIdentity(items, SOURCE_ID);
        exchanges.push({
          seq: exchanges.length + 1, itemCount: items.length,
          fetchNumber: envelope?.fetch_number ?? null, typeOrder: envelope?.type_order ?? null,
          base_id: envelope?.base_id ?? null, base_name: envelope?.base_name ?? null,
          identityValid: identity.valid, identityError: identity.error, distinctIds: identity.distinctIds,
          items,
        });
        console.log(`  [exchange ${exchanges.length}] items=${items.length} base_id=${envelope?.base_id} base_name=${envelope?.base_name} identity_valid=${identity.valid} distinctIds=${JSON.stringify(identity.distinctIds)}`);
      } catch (e) {
        console.log("  [response parse error] " + (e as Error).message);
      }
    });

    const url = "https://www.nadlan.gov.il/?view=neighborhood&id=" + SOURCE_ID + "&page=deals";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);

    const input = page.locator("input[placeholder*='כתובת']").first();
    await input.click({ timeout: 5000 });
    await input.type(STREET_QUERY, { delay: 120 });
    await page.waitForTimeout(2000);

    const targetOption = page.locator("li, [class*='suggestion']", { hasText: TARGET_SUGGESTION_TEXT }).first();
    if ((await targetOption.count()) === 0) throw new Error("TARGET_SUGGESTION_NOT_FOUND");
    await targetOption.click({ timeout: 5000 });
    await page.waitForTimeout(6000);

    console.log("EXCHANGES_CAPTURED=" + exchanges.length);
  } catch (e) {
    console.log("ERROR=" + (e as Error).message);
  } finally {
    await ctx.close();
  }

  console.log("TOTAL_DEAL_DATA_RESPONSES=" + networkRequests);

  // Methodological correction: only the addressId-scoped exchange IS the
  // address-click result. The two neighborhoodId exchanges (500 items each)
  // are the page's own baseline entity-level fetches (one on initial load,
  // one apparently re-triggered after the click) — already fully represented
  // in the Wave 0G-16 entity-level corpus, NOT new address-search output.
  // Pooling them together (an earlier draft of this script did) wrongly
  // computed a ~99% "contamination rate" that was actually just measuring
  // the unrelated neighborhood-wide baseline against a single-street filter.
  //
  // ECC silent-failure-hunter finding: .find() silently takes only the
  // FIRST addressId exchange — if a second ever fired, its rows would be
  // dropped from every downstream count with no warning. Now explicit.
  const addressExchanges = exchanges.filter((e) => e.base_name === "addressId");
  if (addressExchanges.length > 1) {
    console.log(`  WARNING: ${addressExchanges.length} addressId exchanges observed, expected exactly 1 — using only the first; the rest are NOT counted below`);
  }
  const unexpectedExchanges = exchanges.filter((e) => e.base_name !== "addressId" && e.base_name !== "neighborhoodId");
  if (unexpectedExchanges.length > 0) {
    console.log(`  WARNING: ${unexpectedExchanges.length} exchange(s) with an unexpected base_name observed: ${JSON.stringify(unexpectedExchanges.map((e) => e.base_name))} — not classified as either baseline or address-scoped`);
  }
  const addressExchange = addressExchanges[0];
  const addressItems = addressExchange?.items ?? [];
  const onStreet = addressItems.filter((r: any) => typeof r.address === "string" && r.address.includes(STREET_QUERY));
  const otherAddr = addressItems.filter((r: any) => !(typeof r.address === "string" && r.address.includes(STREET_QUERY)));

  console.log("ADDRESS_SCOPED_EXCHANGE_FOUND=" + !!addressExchange);
  console.log("ADDRESS_ID=" + addressExchange?.base_id);
  console.log("ADDRESS_SCOPED_RAW_ROWS=" + addressItems.length);
  console.log("ADDRESS_SCOPED_ON_STREET_ROWS=" + onStreet.length);
  console.log("ADDRESS_SCOPED_OTHER_ROWS=" + otherAddr.length);
  for (const r of addressItems) console.log("  ITEM: " + JSON.stringify({ address: r.address, dealDate: r.dealDate, dealAmount: r.dealAmount, parcelNum: r.parcelNum, neighborhoodId: r.neighborhoodId }));
  if (otherAddr.length > 0) console.log("OTHER_ADDRESS_SAMPLE=" + JSON.stringify(otherAddr.slice(0, 15).map((r: any) => r.address)));

  const allIdentityValid = exchanges.every((e) => e.identityValid || e.itemCount === 0);
  console.log("ALL_EXCHANGES_IDENTITY_VALID=" + allIdentityValid);
  const allDistinctIds = new Set(exchanges.flatMap((e) => e.distinctIds ?? []));
  console.log("ENTITY_IDENTITY_ACROSS_EXCHANGES=" + JSON.stringify([...allDistinctIds]));

  await fs.writeFile(
    path.join(OUT_DIR, OUT_FILE),
    JSON.stringify({
      sourceId: SOURCE_ID,
      exchanges: exchanges.map((e) => ({
        seq: e.seq, itemCount: e.itemCount, fetchNumber: e.fetchNumber, typeOrder: e.typeOrder,
        base_id: e.base_id, base_name: e.base_name, identityValid: e.identityValid, distinctIds: e.distinctIds,
        // Keep full items only for the small addressId-scoped exchange; the
        // two neighborhoodId exchanges are 500-row baseline re-fetches, not
        // the address-level result itself — no need to persist those here.
        items: e.base_name === "addressId" ? e.items : undefined,
      })),
      addressScopedRawRows: addressItems.length, addressScopedOnStreetRows: onStreet.length,
      addressScopedOtherRows: otherAddr.length, otherAddressSample: otherAddr.slice(0, 15).map((r: any) => r.address),
    }, null, 2),
  );
  console.log("DONE");
}

main().catch((e) => { console.error("CONTAMINATION_PROBE_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
