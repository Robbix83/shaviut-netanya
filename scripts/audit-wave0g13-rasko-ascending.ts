/**
 * scripts/audit-wave0g13-rasko-ascending.ts — Wave 0G-13 Phase 3: acquire
 * Rasko's ASCENDING-sort surface, TWO windows deep (fetch_number 1 AND 2
 * within the ascending view), to test whether combining it with the
 * already-captured Wave 0G-12 descending data reconciles to Rasko's
 * official total_rows=2012 without ever touching fetch_number 3+ in
 * either sort direction.
 *
 * Reuses every proven mechanism, no new acquisition technique:
 *  - direct sourceId URL navigation (Wave 0G-8)
 *  - the real "מיון"/ascending-sort UI toggle (proven for נוף הטיילת only,
 *    Wave 0G-9) — this run is the first test of it on a SECOND entity
 *  - fetch_number continuation via the real "הבא" button (proven 1→2 for
 *    Rasko's DESCENDING order in Wave 0G-9/0G-10) — this run is the first
 *    test of continuing PAST fetch_number=1 while already in ascending
 *    order specifically
 *  - fail-closed identity validation on every exchange
 *
 * HARD STOP: never attempts fetch_number 3 in either sort direction. If
 * the login wall (proven Wave 0G-10 at ~101 clicks / ~1000 rows loaded)
 * appears, the script detects and reports it rather than pushing through.
 *
 * Shadow output: audit/wave0g13/shadow/ only, guarded by
 * assertSafeShadowOutputPath(). No canonical/Supabase writes anywhere.
 */
import { promises as fs } from "fs";
import path from "path";
import { buildDirectNeighborhoodUrl, assertDirectIdAcquisitionIdentity, decodeRequestEnvelope } from "../lib/nadlanAcquisition";
import { decodeDealData } from "../lib/dealNormalization";
import { parsePaginationContract, assertSafeShadowOutputPath, type PaginationContract } from "../lib/shadowRebuild";

const SOURCE_ID = "65210248";
const ENTITY_NAME = "רסקו";
const OUT_DIR_REL = "audit/wave0g13/shadow";
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
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/rasko_ascending.json`);

  console.log(`=== WAVE 0G-13 PHASE 3: RASKO ASCENDING DUAL-WINDOW (sourceId=${SOURCE_ID}) ===`);

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
  let seq = 0;
  let entityFailed = false;
  let failureReason: string | null = null;
  let loginWallDetected = false;
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
      const contract = parsePaginationContract(decoded, SOURCE_ID);
      const req = resp.request();
      const envelope = decodeRequestEnvelope(req.postData());

      if (envelope?.fetch_number != null && envelope.fetch_number > 2) {
        entityFailed = true;
        failureReason = `UNEXPECTED_FETCH_NUMBER_BEYOND_PROVEN_DEPTH at exchange ${seq}: fetch_number=${envelope.fetch_number} type_order=${envelope.type_order}`;
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

  try {
    const url = buildDirectNeighborhoodUrl(SOURCE_ID);
    console.log("NAVIGATING_DIRECTLY_TO=" + url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    console.log("BASELINE_DESC_LOADED=" + (exchanges[0]?.itemCount ?? 0));

    // Switch to ascending sort — the real, visible "מיון" toggle.
    const sortWords = await page.locator("text=מיון").all();
    let toggle: any = null;
    for (const el of sortWords) { if (await el.isVisible().catch(() => false)) { toggle = el; break; } }
    if (!toggle) throw new Error("NO_VISIBLE_SORT_TOGGLE_FOUND");
    await toggle.click({ timeout: 5000 });
    await page.waitForTimeout(1500);
    const ascOption = page.locator("*", { hasText: "תאריך עסקה - סדר עולה" }).last();
    if (!(await ascOption.isVisible().catch(() => false))) throw new Error("ASC_OPTION_NOT_VISIBLE");
    const exCountBeforeAsc = exchanges.length;
    await ascOption.click({ timeout: 5000 });
    await page.waitForTimeout(6000);
    console.log("ASC_FETCH_1_CAPTURED=" + (exchanges.length > exCountBeforeAsc));

    if (!entityFailed) {
      // Continue clicking "הבא" WITHIN the ascending view to reach ASC
      // fetch_number=2 — never attempted before on any entity in any prior
      // wave. Uses the same click-budget derivation and the same hard
      // fetch_number>2 tripwire as the descending case.
      const nextButton = page.locator("button, a").filter({ hasText: "הבא" }).first();
      const nextCount = await nextButton.count();
      if (nextCount > 0) {
        const ascFirst = exchanges[exchanges.length - 1]?.contract;
        const rowsPerPage = ascFirst?.totalRows && ascFirst?.totalPage
          ? Math.round(ascFirst.totalRows / ascFirst.totalPage) : 10;
        const clickBudget = Math.ceil(500 / rowsPerPage) + 3;
        console.log(`CLICK_BUDGET=${clickBudget} rowsPerPage=${rowsPerPage} (targeting ASC fetch_number=2)`);
        let dialogDismissAttempts = 0;
        let loginWallHits = 0;
        for (let i = 1; i <= clickBudget; i++) {
          const reachedTarget = exchanges.some((e) => e.typeOrder === "dealDate_up" && (e.fetchNumber ?? 0) >= 2);
          if (reachedTarget) { console.log(`ASC_FETCH_NUMBER_2_REACHED_AT_CLICK=${i - 1}`); break; }
          try {
            await nextButton.click({ timeout: 5000 });
          } catch (e) {
            // Same login-wall detection/dismissal thresholds proven in Wave
            // 0G-10 (loginWallHits>=3, dialogDismissAttempts>15) — the
            // close-button selector list below is widened to match 0G-10's
            // fuller set (ECC code-reviewer noted the first version here
            // only tried one selector).
            dialogDismissAttempts++;
            const dlg = page.locator("div.modal.show, div[class*='contanctModal']").first();
            if (await dlg.count().catch(() => 0)) {
              const html = await dlg.evaluate((el: any) => el.outerHTML).catch(() => "");
              if (/התחברות|לצפייה בנתונים נוספים/.test(html)) {
                loginWallHits++;
                console.log(`  [click ${i}] LOGIN_WALL_MODAL_DETECTED (hit ${loginWallHits})`);
              }
            }
            if (loginWallHits >= 3) { loginWallDetected = true; console.log("  LOGIN_WALL_CONFIRMED — stopping, per safety rules"); break; }
            if (dialogDismissAttempts > 15) { console.log("  TOO_MANY_DISMISS_ATTEMPTS — stopping"); break; }
            let dismissed = false;
            const closeSelectors = [
              "button.closeModalBtnContainer", "div[role='dialog'] button.close", "div[role='dialog'] [aria-label='Close']",
              "div[role='dialog'] .btn-close", "div[role='dialog'] button[class*='close']",
              "div.modal.show button[class*='close']", "div.modal.show [aria-label='סגור']",
            ];
            for (const sel of closeSelectors) {
              const closeBtn = page.locator(sel).first();
              if (await closeBtn.count().catch(() => 0)) {
                try { await closeBtn.click({ timeout: 2000 }); dismissed = true; break; } catch { /* try next */ }
              }
            }
            if (!dismissed) { await page.keyboard.press("Escape").catch(() => {}); }
            await page.waitForTimeout(500);
            i--;
            continue;
          }
          await page.waitForTimeout(500);
        }
        await page.waitForTimeout(2500);
      } else {
        console.log("NO_NEXT_BUTTON_FOUND_IN_ASC_VIEW");
      }
    }
  } catch (e) {
    entityFailed = true;
    failureReason = `NAVIGATION_ERROR: ${(e as Error).message}`;
    console.log("ERROR=" + (e as Error).message);
  } finally {
    await ctx.close();
  }

  // Full-entity discard on ANY failure (ECC silent-failure-hunter finding):
  // per-exchange `rawItems` only self-zeroes for the exchange that itself
  // failed — an exchange captured BEFORE entityFailed flipped true would
  // otherwise keep its populated rawItems with no retroactive purge. This
  // run had entityFailed=false throughout, so it was moot in practice, but
  // the guarantee now holds structurally for any future run.
  if (entityFailed) {
    for (const e of exchanges) e.rawItems = [];
  }

  const elapsedSeconds = ((Date.now() - t0) / 1000).toFixed(1);
  const out = {
    sourceId: SOURCE_ID, entityName: ENTITY_NAME, entityFailed, failureReason, loginWallDetected,
    exchanges: exchanges.map((e) => ({
      seq: e.seq, contract: e.contract, itemCount: e.itemCount, fetchNumber: e.fetchNumber,
      typeOrder: e.typeOrder, identityValid: e.identity.valid, rawItemCount: e.rawItems.length,
    })),
    networkRequests: networkRequestCount.v, elapsedSeconds: Number(elapsedSeconds),
  };
  await fs.writeFile(path.join(OUT_DIR, "rasko_ascending_meta.json"), JSON.stringify(out, null, 2));

  // Also persist the raw items for the flattening/comparison work in later
  // phases. NOTE: this file is large (full third-party row data) and is
  // NOT git-ignored — it must be excluded manually at `git add` time
  // (explicit path staging, matching the Wave 0G-12 commit pattern), same
  // as this wave's rasko_four_window_union.json output.
  const allRawByExchange = exchanges.map((e) => ({ seq: e.seq, typeOrder: e.typeOrder, fetchNumber: e.fetchNumber, items: e.rawItems }));
  await fs.writeFile(path.join(OUT_DIR, "rasko_ascending_raw.json"), JSON.stringify(allRawByExchange, null, 2));

  console.log("ENTITY_FAILED=" + entityFailed + (failureReason ? " REASON=" + failureReason : ""));
  console.log("LOGIN_WALL_DETECTED=" + loginWallDetected);
  console.log("NETWORK_REQUESTS=" + networkRequestCount.v + " ELAPSED_SECONDS=" + elapsedSeconds);
  console.log("DONE");
}

main().catch((e) => { console.error("RASKO_ASCENDING_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
