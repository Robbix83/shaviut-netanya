/**
 * scripts/audit-wave0g9-continuation-probe.ts — READ-ONLY investigation of
 * whether nadlan.gov.il exposes any legitimate mechanism to retrieve
 * transactions beyond the first 500-row response for a direct-ID query.
 *
 * Uses ONLY the already-proven direct-URL navigation (Wave 0G-8:
 * https://www.nadlan.gov.il/?view=neighborhood&id={sourceId}&page=deals) and
 * NORMAL, LEGITIMATE user interactions (scrolling, clicking visible controls)
 * to observe what, if anything, the official UI itself triggers. Does NOT
 * mutate any request field by hand, does NOT loop arbitrary values, does NOT
 * decode/replay/forge session-bound credentials.
 *
 * Captures the request body's NON-CREDENTIAL fields only (base_id, base_name,
 * fetch_number, type_order, domain) via the same passive reversal+base64
 * technique already used and reviewed safe in Wave 0G-5 — the embedded
 * session-bound sk/token/exp fields are read only to confirm their presence
 * (never logged, never reused).
 *
 * HARD GUARANTEES:
 *  - Never opens or writes data/deals.json.
 *  - Never touches Supabase.
 *  - Never types into or clicks any search/autocomplete suggestion.
 *  - Never logs cookies, Authorization headers, or session-bound tokens.
 *  - Writes only under audit/wave0g9/.
 */
import { promises as fs } from "fs";
import path from "path";
import zlib from "zlib";
import { buildDirectNeighborhoodUrl } from "../lib/nadlanAcquisition";

const OUT_DIR = path.join(process.cwd(), "audit", "wave0g9");
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

function decodeDealData(text: string): any {
  try { return JSON.parse(text); } catch { /* try b64+gzip */ }
  try {
    const buf = Buffer.from(text.replace(/^"|"$/g, ""), "base64");
    return JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
  } catch { return null; }
}

/** Passive decode of the request envelope's NON-CREDENTIAL claims only.
 * Reverses the captured string and base64-decodes it (no signing key
 * accessed, nothing forged) — same technique reviewed safe in Wave 0G-5.
 * Returns null for the credential-shaped fields' VALUES (never exposes them),
 * only reports whether they were present. */
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
  responseTopLevelKeys: string[];
  responseDataKeys: string[];
  responseDataMeta: { total_rows?: unknown; total_fetch?: unknown; total_page?: unknown };
  itemCount: number;
  itemSampleKeys: string[];
  distinctNeighborhoodIds: string[];
  earliestDate: string | null;
  latestDate: string | null;
  contentKeys: string[]; // dealDate|dealAmount|assetArea, for cross-batch overlap analysis
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const sourceId = process.argv[2] ?? "65210195";
  const label = process.argv[3] ?? "nof_hatayelet";

  console.log("=== WAVE 0G-9 CONTINUATION PROBE (target: " + label + ", sourceId=" + sourceId + ") ===");

  const headless = process.env.HARVEST_HEADLESS === "true";
  const { chromium: pwChromium } = await import("playwright");
  const ctx = await pwChromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless, slowMo: headless ? 0 : 80,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  // newPage()/addInitScript() wrapped so a failure here still closes ctx
  // rather than leaking the browser process — a minor gap a code review
  // flagged this wave (previously only the code AFTER this point was
  // protected by the outer try/finally below).
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

  // Correlate strictly via resp.request() — the actual originating Request
  // object for THIS response — not a URL-string heuristic. Both requests
  // share the identical URL, so a separate request-listener + Map lookup can
  // misattribute a response to the WRONG request under near-simultaneous
  // firing (caught and fixed mid-wave, see scripts/audit-wave0g9-sort-probe.ts).
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

      const distinctIds = Array.isArray(items) ? [...new Set(items.map((it: any) => String(it.neighborhoodId)))] : [];
      const dates = (Array.isArray(items) ? items : [])
        .map((it: any) => { const d = it.dealDate ?? it.DEALDATETIME; return d ? new Date(d).toISOString().slice(0, 10) : null; })
        .filter(Boolean).sort() as string[];

      const responseDataMeta = {
        total_rows: decoded?.data?.total_rows,
        total_fetch: decoded?.data?.total_fetch,
        total_page: decoded?.data?.total_page,
      };
      const contentKeys = (Array.isArray(items) ? items : []).map((it: any) => {
        const d = it.dealDate ?? it.DEALDATETIME;
        const dd = d ? new Date(d).toISOString().slice(0, 10) : "";
        return `${dd}|${it.dealAmount}|${it.assetArea}|${it.parcelNum ?? ""}`;
      });
      exchanges.push({
        seq,
        requestUrl: matchedReq?.url ?? u,
        requestMethod: matchedReq?.method ?? resp.request().method(),
        requestEnvelope: decodeRequestEnvelope(matchedReq?.postData ?? null),
        responseStatus: resp.status(),
        responseTopLevelKeys: decoded ? Object.keys(decoded) : [],
        responseDataKeys: decoded?.data ? Object.keys(decoded.data) : [],
        responseDataMeta,
        itemCount: Array.isArray(items) ? items.length : 0,
        itemSampleKeys: Array.isArray(items) && items.length > 0 ? Object.keys(items[0]) : [],
        distinctNeighborhoodIds: distinctIds,
        earliestDate: dates[0] ?? null,
        latestDate: dates[dates.length - 1] ?? null,
        contentKeys,
      });
      console.log(`  [exchange ${seq}] status=${resp.status()} items=${Array.isArray(items) ? items.length : 0} meta=${JSON.stringify(responseDataMeta)} fetch_number=${decodeRequestEnvelope(matchedReq?.postData ?? null)?.fetch_number}`);
    } catch (e) { console.log("  [response parse error] " + (e as Error).message); }
  });

  let uiObservations: Record<string, unknown> = {};

  try {
    const url = buildDirectNeighborhoodUrl(sourceId);
    console.log("NAVIGATING_DIRECTLY_TO=" + url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(5000);

    console.log("\n=== Phase 4: observing normal UI continuation controls ===");
    // Look for visible pagination / load-more / sort / date-filter controls —
    // READ-ONLY inspection, not yet clicking anything.
    const bodyText = await page.evaluate(() => document.body.innerText);
    const hasLoadMoreText = /טען עוד|הצג עוד|עוד תוצאות|load more/i.test(bodyText);
    const paginationButtons = await page.locator("button, a").evaluateAll((els: any[]) =>
      els.map((el) => (el.textContent || "").trim()).filter((t) => /^\d+$/.test(t) || /הבא|הקודם|next|prev/i.test(t))
    );
    console.log("HAS_LOAD_MORE_TEXT=" + hasLoadMoreText);
    console.log("PAGINATION_BUTTON_CANDIDATES=" + JSON.stringify(paginationButtons.slice(0, 20)));

    // Look for a sort control (dropdown/select/button group near the results).
    const sortControls = await page.locator("select, [role='combobox'], button").evaluateAll((els: any[]) =>
      els.map((el) => (el.textContent || el.getAttribute("aria-label") || "").trim())
         .filter((t) => /מיין|מיון|סדר|sort/i.test(t))
    );
    console.log("SORT_CONTROL_CANDIDATES=" + JSON.stringify(sortControls.slice(0, 20)));

    // Look for a date-range filter control.
    const dateControls = await page.locator("input[type='date'], select, button").evaluateAll((els: any[]) =>
      els.map((el) => (el.textContent || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim())
         .filter((t) => /תאריך|שנה|טווח|תקופה|date|year|period|range/i.test(t))
    );
    console.log("DATE_FILTER_CONTROL_CANDIDATES=" + JSON.stringify(dateControls.slice(0, 20)));

    uiObservations = {
      hasLoadMoreText, paginationButtons, sortControls, dateControls,
      bodyTextLength: bodyText.length,
    };

    const itemCountBeforeScroll = exchanges.reduce((s, e) => s + e.itemCount, 0);
    console.log("\n=== Scrolling to bottom (normal user interaction) — item count before: " + itemCountBeforeScroll + " ===");
    let idleRounds = 0;
    let lastExchangeCount = exchanges.length;
    for (let round = 0; round < 60; round++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
      if (exchanges.length === lastExchangeCount) {
        idleRounds++;
        if (idleRounds >= 5) break;
      } else { idleRounds = 0; lastExchangeCount = exchanges.length; }
    }
    console.log("EXCHANGES_AFTER_SCROLL=" + exchanges.length);

    // Dump structural info about the pagination area for diagnosis before clicking.
    const nextButton = page.locator("button, a").filter({ hasText: "הבא" }).first();
    const nextCount = await nextButton.count();
    console.log("NEXT_BUTTON_COUNT=" + nextCount);
    if (nextCount > 0) {
      const outerHtml = await nextButton.evaluate((el: any) => el.outerHTML).catch(() => "N/A");
      const isDisabled = await nextButton.evaluate((el: any) => el.disabled || el.getAttribute("aria-disabled") === "true" || el.classList.contains("disabled")).catch(() => "N/A");
      const isVisible = await nextButton.isVisible().catch(() => false);
      console.log("NEXT_BUTTON_HTML=" + outerHtml.slice(0, 400));
      console.log("NEXT_BUTTON_DISABLED=" + isDisabled);
      console.log("NEXT_BUTTON_VISIBLE=" + isVisible);

      // Determine rows-per-page directly from the DOM (not guessed) so the
      // number of clicks needed to exhaust the locally-loaded 500 rows is
      // data-derived, not an arbitrary loop count. Uses the page indicator
      // text (e.g. "1 / 128") together total_rows to compute this.
      const pageIndicatorText = await page.locator("*", { hasText: /^\d+\s*\/\s*\d+$/ }).first().textContent().catch(() => null);
      console.log("PAGE_INDICATOR_TEXT=" + pageIndicatorText);
      const totalRowsFromResponse = exchanges[0]?.responseDataMeta?.total_rows as number | undefined;
      const totalPageFromResponse = exchanges[0]?.responseDataMeta?.total_page as number | undefined;
      let rowsPerPage: number | null = null;
      if (totalRowsFromResponse && totalPageFromResponse) {
        rowsPerPage = Math.round(totalRowsFromResponse / totalPageFromResponse);
      }
      console.log("DERIVED_ROWS_PER_PAGE=" + rowsPerPage + " (from total_rows=" + totalRowsFromResponse + " / total_page=" + totalPageFromResponse + ")");

      const locallyLoadedItemCount = exchanges.reduce((s, e) => s + e.itemCount, 0);
      const pagesInLocalBatch = rowsPerPage ? Math.ceil(locallyLoadedItemCount / rowsPerPage) : null;
      console.log("LOCALLY_LOADED_ITEMS=" + locallyLoadedItemCount + " PAGES_IN_LOCAL_BATCH=" + pagesInLocalBatch);

      const exchangeCountBeforeNext = exchanges.length;
      console.log("\n=== Clicking 'הבא' (Next) repeatedly, up to the data-derived local-batch boundary (" + pagesInLocalBatch + " clicks), watching for a NEW network exchange ===");
      const maxClicks = pagesInLocalBatch ?? 55; // fallback only if metadata absent
      let newExchangeDetectedAtClick: number | null = null;
      for (let i = 1; i <= maxClicks + 3; i++) { // small margin past the computed boundary
        try {
          await nextButton.click({ timeout: 5000 });
        } catch (e) {
          console.log(`  [click ${i}] FAILED: ` + (e as Error).message);
          break;
        }
        await page.waitForTimeout(600);
        if (exchanges.length > exchangeCountBeforeNext) {
          newExchangeDetectedAtClick = i;
          console.log(`  [click ${i}] NEW NETWORK EXCHANGE DETECTED`);
          await page.waitForTimeout(3000); // let it fully complete
          break;
        }
      }
      console.log("NEW_EXCHANGE_DETECTED_AT_CLICK=" + newExchangeDetectedAtClick);
      console.log("EXCHANGES_AFTER_NEXT_CLICKS=" + exchanges.length + " (was " + exchangeCountBeforeNext + ")");
    } else {
      console.log("NO_NEXT_BUTTON_FOUND");
      // Dump a broader snapshot of any element containing "1 /" (a common
      // "current page / total pages" indicator pattern seen in this UI's own
      // page text, e.g. "1 / 128") to locate the real pagination widget.
      const pageIndicator = await page.locator("*", { hasText: /^\d+\s*\/\s*\d+$/ }).first();
      if (await pageIndicator.count()) {
        const html = await pageIndicator.evaluate((el: any) => el.outerHTML).catch(() => "N/A");
        console.log("PAGE_INDICATOR_HTML=" + html.slice(0, 500));
        const parentHtml = await pageIndicator.evaluate((el: any) => el.parentElement?.outerHTML ?? "N/A").catch(() => "N/A");
        console.log("PAGE_INDICATOR_PARENT_HTML=" + parentHtml.slice(0, 1500));
      } else {
        console.log("NO_PAGE_INDICATOR_FOUND");
      }
    }
  } catch (e) {
    console.log("ERROR=" + (e as Error).message);
  } finally {
    await ctx.close();
  }

  await fs.writeFile(path.join(OUT_DIR, `continuation_exchanges_${label}.json`), JSON.stringify(exchanges, null, 2));
  await fs.writeFile(path.join(OUT_DIR, `ui_observations_${label}.json`), JSON.stringify(uiObservations, null, 2));

  console.log("\nTOTAL_EXCHANGES=" + exchanges.length);
  console.log("DONE");
}

main().catch((e) => { console.error("PROBE_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
