/**
 * scripts/audit-wave0g17-street-fetch.ts — Wave 0G-17 Phase 8 (corrected):
 * proven direct street-level acquisition via `?view=street&id={streetCode}`
 * (base_name="streetCode"), discovered and proven live this wave. Fetches
 * ONE street's fetch_number=1 data, reports the pagination contract, and
 * measures overlap against the primary entity's Wave 0G-16 baseline.
 *
 * fetch_number=1 ONLY (this mechanism's safe depth has not been separately
 * proven beyond 1 — no "הבא" click attempted). No canonical/Supabase writes.
 *
 * Usage: npx tsx scripts/audit-wave0g17-street-fetch.ts <streetId> <streetName>
 */
import { promises as fs } from "fs";
import path from "path";
import { assertDirectIdAcquisitionIdentity, decodeRequestEnvelope } from "../lib/nadlanAcquisition";
import { decodeDealData } from "../lib/dealNormalization";
import { toShadowDeal, dedupByTransactionKey, transactionKey, parsePaginationContract, assertSafeShadowOutputPath, type ShadowDeal } from "../lib/shadowRebuild";
import type { Neighborhood } from "../lib/types";

const NEIGHBORHOOD_SOURCE_ID = "65209683"; // קריית השרון
const OUT_DIR_REL = "audit/wave0g17/shadow";
const OUT_DIR = path.join(process.cwd(), OUT_DIR_REL);
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

async function main() {
  const streetId = process.argv[2];
  const streetName = process.argv[3] ?? streetId;
  if (!streetId) throw new Error("USAGE: npx tsx scripts/audit-wave0g17-street-fetch.ts <streetId> <streetName>");

  await fs.mkdir(OUT_DIR, { recursive: true });
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/street_fetch_${streetId}.json`);
  console.log(`=== WAVE 0G-17 STREET FETCH: ${streetName} (streetId=${streetId}) ===`);

  const headless = process.env.HARVEST_HEADLESS === "true";
  const { chromium: pwChromium } = await import("playwright");
  const ctx = await pwChromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless, slowMo: headless ? 0 : 60,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  let entityFailed = false;
  let failureReason: string | null = null;
  let zeroTransactions = false;
  let items: any[] = [];
  let contract: any = null;
  let identityResult: any = null;

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
        const respItems = decoded?.data?.items ?? decoded?.items ?? [];
        const req = resp.request();
        const envelope = decodeRequestEnvelope(req.postData());
        if (!envelope) { entityFailed = true; failureReason = "UNDECODABLE_ENVELOPE"; return; }
        if (envelope.base_name !== "streetCode") { entityFailed = true; failureReason = `WRONG_BASE_NAME: ${envelope.base_name}`; return; }
        if (envelope.fetch_number != null && envelope.fetch_number > 1) { entityFailed = true; failureReason = `UNSUPPORTED_FETCH_DEPTH: ${envelope.fetch_number}`; return; }
        contract = parsePaginationContract(decoded, NEIGHBORHOOD_SOURCE_ID);
        identityResult = assertDirectIdAcquisitionIdentity(respItems, NEIGHBORHOOD_SOURCE_ID);
        if (!identityResult.valid) {
          // Classification fix (ECC code-reviewer finding): assertDirectIdAcquisitionIdentity
          // returns valid=false with error="EMPTY_RESULT" for a street that
          // genuinely has 0 transactions, which is NOT the same failure class
          // as a real identity mismatch (a non-empty batch with the wrong
          // sourceId). Conflating them under one entityFailed flag would make
          // a legitimate empty street indistinguishable from a real error at
          // citywide scale. Both still stop this run (a 0-row street has
          // nothing to acquire either way), but the reason is now distinct.
          zeroTransactions = respItems.length === 0 && identityResult.error === "EMPTY_RESULT";
          entityFailed = true;
          failureReason = zeroTransactions ? "ZERO_TRANSACTIONS_ON_STREET (legitimate empty result, not an error)" : `IDENTITY_FAIL: ${identityResult.error}`;
          return;
        }
        items = respItems;
      } catch (e) {
        console.log("  [parse error] " + (e as Error).message);
      }
    });

    const url = `https://www.nadlan.gov.il/?view=street&id=${streetId}&page=deals`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(6000);
  } catch (e) {
    entityFailed = true;
    failureReason = `NAV_ERROR: ${(e as Error).message}`;
  } finally {
    await ctx.close();
  }

  if (entityFailed || identityResult === null) {
    // Residual ambiguity, disclosed not resolved (ECC silent-failure-hunter
    // finding): if NO /deal-data response was captured at all (identityResult
    // still null), this script cannot distinguish a transient failure from a
    // genuinely empty street — unlike the zeroTransactions case above, which
    // IS distinguished because a response did arrive with 0 items. At
    // citywide scale, this residual case should be retried at least once
    // before being trusted as either outcome.
    const reason = failureReason ?? "NO_DEAL_DATA_RESPONSE_CAPTURED (ambiguous: transient failure vs. genuinely empty street cannot be distinguished when no response arrives at all)";
    console.log("FAILED reason=" + reason + " zeroTransactions=" + zeroTransactions);
    await fs.writeFile(path.join(OUT_DIR, `street_fetch_${streetId}.json`), JSON.stringify({ streetId, streetName, entityFailed: true, zeroTransactions, failureReason: reason }, null, 2));
    console.log("DONE");
    return;
  }

  console.log("CONTRACT=" + JSON.stringify(contract));
  console.log("RAW_ROWS=" + items.length);
  console.log("IDENTITY_VALID=" + identityResult.valid + " distinctIds=" + JSON.stringify(identityResult.distinctIds));

  // Compare against Wave 0G-16 baseline for this entity.
  const neighborhood: Neighborhood = { id: NEIGHBORHOOD_SOURCE_ID, name: "קריית השרון", settlement: "נתניה", x: null, y: null };
  const shadowRows = items.map((r: any) => toShadowDeal(r, neighborhood, NEIGHBORHOOD_SOURCE_ID)).filter((d: ShadowDeal | null): d is ShadowDeal => d !== null);
  const streetDedup = dedupByTransactionKey(shadowRows);
  console.log("NORMALIZED_ROWS=" + shadowRows.length + " UNIQUE_WITHIN_STREET_BATCH=" + streetDedup.uniqueCount);

  const baseline = JSON.parse(await fs.readFile(path.join(process.cwd(), "audit/wave0g16/shadow-output/65209683.json"), "utf8"));
  const baselineKeys = new Set(baseline.uniqueRows.map((r: any) => transactionKey(r)));
  const newRows = streetDedup.uniqueRows.filter((r) => !baselineKeys.has(transactionKey(r)));
  console.log("ALREADY_IN_BASELINE=" + (streetDedup.uniqueCount - newRows.length));
  console.log("NEW_VS_BASELINE=" + newRows.length);
  for (const r of newRows.slice(0, 10)) console.log(`  NEW: parcelNum=${(r as any).parcelNum} dealDate=${r.dealDate} price=${r.price} street=${r.street} houseNumber=${r.houseNumber}`);

  // Contamination check: does every row's own `street` field genuinely match?
  const onStreet = shadowRows.filter((r) => r.street === streetName || (r as any).address?.includes(streetName));
  console.log("ON_STREET_BY_ADDRESS_FIELD=" + onStreet.length + "/" + shadowRows.length);

  await fs.writeFile(
    path.join(OUT_DIR, `street_fetch_${streetId}.json`),
    JSON.stringify({
      streetId, streetName, entityFailed: false, contract, rawRows: items.length,
      normalizedRows: shadowRows.length, uniqueWithinBatch: streetDedup.uniqueCount,
      alreadyInBaseline: streetDedup.uniqueCount - newRows.length, newVsBaseline: newRows.length,
      onStreetByAddressField: onStreet.length, identityDistinctIds: identityResult.distinctIds,
      newRows, allRows: shadowRows,
    }, null, 2),
  );
  console.log("DONE");
}

main().catch((e) => { console.error("STREET_FETCH_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
