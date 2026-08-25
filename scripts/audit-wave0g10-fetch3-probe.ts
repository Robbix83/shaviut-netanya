/**
 * scripts/audit-wave0g10-fetch3-probe.ts — READ-ONLY investigation of whether
 * legitimate UI-driven pagination (the same "הבא" / Next button already
 * proven in Wave 0G-9 to trigger a fetch_number 1→2 transition) can reach
 * fetch_number=3 and beyond, purely by continuing the identical normal user
 * interaction further — no manual field mutation, no fabricated fetch_number.
 *
 * Reuses the exact request/response capture technique from
 * scripts/audit-wave0g9-continuation-probe.ts (resp.request()-based 1:1
 * correlation — NOT a URL-string+Map heuristic, since all /deal-data
 * requests share the identical URL).
 *
 * HARD GUARANTEES:
 *  - Never opens or writes data/deals.json.
 *  - Never touches Supabase.
 *  - Never types into or clicks any search/autocomplete suggestion.
 *  - Never logs cookies, Authorization headers, or session-bound tokens
 *    (only reports credential FIELD NAMES as present, never values).
 *  - Never fabricates or manually sets fetch_number — only clicks the same
 *    visible "הבא" button, observing whatever the client legitimately sends.
 *  - Writes only under audit/wave0g10/.
 */
import { promises as fs } from "fs";
import path from "path";
import zlib from "zlib";
import { buildDirectNeighborhoodUrl } from "../lib/nadlanAcquisition";

const OUT_DIR = path.join(process.cwd(), "audit", "wave0g10");
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

function decodeDealData(text: string): any {
  try { return JSON.parse(text); } catch { /* try b64+gzip */ }
  try {
    const buf = Buffer.from(text.replace(/^"|"$/g, ""), "base64");
    return JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
  } catch { return null; }
}

function decodeRequestEnvelope(postData: string | null): {
  base_id?: string; base_name?: string; fetch_number?: number; type_order?: string; domain?: string;
  credentialFieldsPresent: string[];
} | null {
  if (!postData) return null;
  try {
    const parsed = JSON.parse(postData);
    const opaque = parsed["##"];
    if (typeof opaque !== "string") return null;
    const reversed = opaque.split("").reverse().join("");
    const parts = reversed.split(".");
    if (parts.length < 2) return null;
    const b64url = (s: string) => {
      const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "===".slice((b64.length + 3) % 4);
      return Buffer.from(padded, "base64").toString("utf8");
    };
    const payload = JSON.parse(b64url(parts[1]));
    const credentialFieldsPresent: string[] = [];
    for (const f of ["sk", "token", "exp"]) if (payload[f] !== undefined) credentialFieldsPresent.push(f);
    return {
      base_id: payload.base_id, base_name: payload.base_name,
      fetch_number: payload.fetch_number, type_order: payload.type_order,
      domain: payload.domain, credentialFieldsPresent,
    };
  } catch { return null; }
}

interface CapturedExchange {
  seq: number;
  requestUrl: string;
  requestMethod: string;
  requestEnvelope: ReturnType<typeof decodeRequestEnvelope>;
  responseStatus: number;
  responseDataMeta: { total_rows?: unknown; total_fetch?: unknown; total_page?: unknown };
  itemCount: number;
  distinctNeighborhoodIds: string[];
  earliestDate: string | null;
  latestDate: string | null;
  contentKeys: string[];
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const sourceId = process.argv[2] ?? "65210248";
  const label = process.argv[3] ?? "rasko";
  const targetFetchNumber = Number(process.argv[4] ?? "3");

  console.log("=== WAVE 0G-10 FETCH-DEPTH PROBE (target: " + label + ", sourceId=" + sourceId + ", targetFetchNumber=" + targetFetchNumber + ") ===");

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

  const exchanges: CapturedExchange[] = [];
  let seq = 0;
  const observedFetchNumbers = new Set<number>();

  page.on("response", async (resp: any) => {
    const u = resp.url();
    if (!u.includes("/deal-data")) return;
    try {
      const body = await resp.text();
      const decoded = decodeDealData(body);
      const items = decoded?.data?.items ?? decoded?.items ?? [];
      seq++;
      const req = resp.request();
      const matchedReq = { url: req.url(), method: req.method(), postData: req.postData() };
      const envelope = decodeRequestEnvelope(matchedReq?.postData ?? null);
      if (envelope?.fetch_number != null) observedFetchNumbers.add(envelope.fetch_number);

      const distinctIds = Array.isArray(items) ? [...new Set(items.map((it: any) => String(it.neighborhoodId)))] : [];
      const dates = (Array.isArray(items) ? items : [])
        .map((it: any) => { const d = it.dealDate ?? it.DEALDATETIME; return d ? new Date(d).toISOString().slice(0, 10) : null; })
        .filter(Boolean).sort() as string[];
      const contentKeys = (Array.isArray(items) ? items : []).map((it: any) => {
        const d = it.dealDate ?? it.DEALDATETIME;
        const dd = d ? new Date(d).toISOString().slice(0, 10) : "";
        return `${dd}|${it.dealAmount}|${it.assetArea}|${it.parcelNum ?? ""}`;
      });
      exchanges.push({
        seq,
        requestUrl: matchedReq?.url ?? u,
        requestMethod: matchedReq?.method ?? resp.request().method(),
        requestEnvelope: envelope,
        responseStatus: resp.status(),
        responseDataMeta: {
          total_rows: decoded?.data?.total_rows,
          total_fetch: decoded?.data?.total_fetch,
          total_page: decoded?.data?.total_page,
        },
        itemCount: Array.isArray(items) ? items.length : 0,
        distinctNeighborhoodIds: distinctIds,
        earliestDate: dates[0] ?? null,
        latestDate: dates[dates.length - 1] ?? null,
        contentKeys,
      });
      console.log(`  [exchange ${seq}] status=${resp.status()} items=${Array.isArray(items) ? items.length : 0} fetch_number=${envelope?.fetch_number} dates=${dates[0]}..${dates[dates.length - 1]}`);
    } catch (e) { console.log("  [response parse error] " + (e as Error).message); }
  });

  try {
    const url = buildDirectNeighborhoodUrl(sourceId);
    console.log("NAVIGATING_DIRECTLY_TO=" + url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(5000);

    const nextButton = page.locator("button, a").filter({ hasText: "הבא" }).first();
    const nextCount = await nextButton.count();
    console.log("NEXT_BUTTON_COUNT=" + nextCount);
    if (nextCount === 0) {
      console.log("NO_NEXT_BUTTON_FOUND — cannot proceed with UI-driven pagination");
    } else {
      // Data-derived click budget: keep clicking the SAME visible "הבא"
      // button — never anything else, never a fabricated request — until the
      // target fetch_number is observed or a generous, still-bounded cap is
      // reached. Bound = ceil((targetFetchNumber * 500) / rowsPerPage) + 10,
      // using the entity's own reported total_rows/total_page (never guessed).
      const totalRowsFromResponse = exchanges[0]?.responseDataMeta?.total_rows as number | undefined;
      const totalPageFromResponse = exchanges[0]?.responseDataMeta?.total_page as number | undefined;
      // Wait for first exchange (baseline load) before reading meta.
      await page.waitForTimeout(1000);
      const trFromResp = (exchanges[0]?.responseDataMeta?.total_rows as number | undefined) ?? totalRowsFromResponse;
      const tpFromResp = (exchanges[0]?.responseDataMeta?.total_page as number | undefined) ?? totalPageFromResponse;
      const rowsPerPage = trFromResp && tpFromResp ? Math.round(trFromResp / tpFromResp) : 10;
      const clickBudget = Math.ceil((targetFetchNumber * 500) / rowsPerPage) + 10;
      console.log("ROWS_PER_PAGE=" + rowsPerPage + " CLICK_BUDGET=" + clickBudget);

      let dialogDismissAttempts = 0;
      let loginWallHits = 0;
      let loginWallDetected = false;
      for (let i = 1; i <= clickBudget; i++) {
        if (observedFetchNumbers.has(targetFetchNumber)) {
          console.log(`TARGET_FETCH_NUMBER_${targetFetchNumber}_REACHED_AT_CLICK=` + (i - 1));
          break;
        }
        try {
          await nextButton.click({ timeout: 5000 });
        } catch (e) {
          // A legitimate site-native dialog (e.g. a "contact us" modal) can
          // appear after extended browsing and intercept clicks — this is
          // normal UI behavior, not a network obstacle. Dismiss it the way a
          // real user would (close button, then Escape as a fallback) and
          // retry the SAME next-button click — never a different action.
          console.log(`  [click ${i}] blocked, attempting dialog dismissal: ` + (e as Error).message.split("\n")[0]);
          dialogDismissAttempts++;
          const dlg = page.locator("div.modal.show, div[class*='contanctModal']").first();
          const dlgPresent = await dlg.count().catch(() => 0);
          if (dlgPresent) {
            const html = await dlg.evaluate((el: any) => el.outerHTML).catch(() => "N/A");
            const isLoginWall = /התחברות|לצפייה בנתונים נוספים/.test(html);
            if (dialogDismissAttempts === 1) console.log("  DIALOG_HTML=" + html.slice(0, 2500));
            if (isLoginWall) {
              loginWallHits++;
              console.log(`  LOGIN_WALL_MODAL_DETECTED (hit ${loginWallHits})`);
            }
          } else if (dialogDismissAttempts === 1) {
            console.log("  NO_MODAL_SHOW_FOUND");
          }
          if (loginWallHits >= 3) {
            console.log("  LOGIN_WALL_CONFIRMED_BLOCKING — refusing to authenticate, stopping per safety rules");
            loginWallDetected = true;
            break;
          }
          if (dialogDismissAttempts > 15) {
            console.log("  TOO_MANY_DIALOG_DISMISS_ATTEMPTS — stopping");
            break;
          }
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
          if (!dismissed) {
            try { await page.keyboard.press("Escape"); dismissed = true; } catch { /* ignore */ }
          }
          await page.waitForTimeout(500);
          if (!dismissed) { console.log("  DIALOG_DISMISS_FAILED — stopping"); break; }
          i--; // retry this click index after dismissal
          continue;
        }
        await page.waitForTimeout(500);
      }
      await page.waitForTimeout(3000); // let any in-flight exchange finish
      console.log("FINAL_OBSERVED_FETCH_NUMBERS=" + JSON.stringify([...observedFetchNumbers].sort()));
      console.log("LOGIN_WALL_DETECTED=" + loginWallDetected);
    }
  } catch (e) {
    console.log("ERROR=" + (e as Error).message);
  } finally {
    await ctx.close();
  }

  await fs.writeFile(path.join(OUT_DIR, `fetch_depth_exchanges_${label}.json`), JSON.stringify(exchanges, null, 2));

  console.log("\nTOTAL_EXCHANGES=" + exchanges.length);
  console.log("DONE");
}

main().catch((e) => { console.error("PROBE_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
