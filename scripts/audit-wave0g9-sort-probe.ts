/**
 * scripts/audit-wave0g9-sort-probe.ts — READ-ONLY test of the official UI's
 * OWN, visibly-exposed ascending-date sort option (confirmed present this
 * wave: a dropdown option literally reading "תאריך עסקה - סדר עולה" / "deal
 * date - ascending order"). Selects it via a normal UI interaction (no field
 * mutation by hand) and observes the resulting request/response.
 *
 * HARD GUARANTEES: same as scripts/audit-wave0g9-continuation-probe.ts —
 * read-only, no canonical writes, no Supabase, no credential capture.
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

function decodeRequestEnvelope(postData: string | null) {
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
    return { base_id: payload.base_id, base_name: payload.base_name, fetch_number: payload.fetch_number, type_order: payload.type_order, domain: payload.domain };
  } catch { return null; }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const sourceId = "65210195";

  console.log("=== WAVE 0G-9 SORT PROBE (target: נוף הטיילת, sourceId=" + sourceId + ") ===");

  const headless = process.env.HARVEST_HEADLESS === "true";
  const { chromium: pwChromium } = await import("playwright");
  const ctx = await pwChromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless, slowMo: headless ? 0 : 80,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  // newPage()/addInitScript() wrapped so a failure here still closes ctx
  // rather than leaking the browser process — a minor gap a code review
  // flagged this wave.
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

  const exchanges: any[] = [];
  let seq = 0;

  // Correlate strictly via resp.request() — the actual originating Request
  // object for THIS response, not a URL-string heuristic (both requests
  // share the identical URL, so a Map keyed by URL can misattribute under
  // near-simultaneous requests; this was caught and fixed mid-wave).
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
      const contentKeys = (Array.isArray(items) ? items : []).map((it: any) => {
        const d = it.dealDate ?? it.DEALDATETIME;
        const dd = d ? new Date(d).toISOString().slice(0, 10) : "";
        return `${dd}|${it.dealAmount}|${it.assetArea}|${it.parcelNum ?? ""}`;
      });
      exchanges.push({
        seq,
        requestEnvelope: decodeRequestEnvelope(matchedReq?.postData ?? null),
        responseStatus: resp.status(),
        responseDataMeta: { total_rows: decoded?.data?.total_rows, total_fetch: decoded?.data?.total_fetch, total_page: decoded?.data?.total_page },
        itemCount: Array.isArray(items) ? items.length : 0,
        distinctNeighborhoodIds: distinctIds,
        earliestDate: dates[0] ?? null,
        latestDate: dates[dates.length - 1] ?? null,
        contentKeys,
      });
      console.log(`  [exchange ${seq}] items=${Array.isArray(items) ? items.length : 0} type_order=${decodeRequestEnvelope(matchedReq?.postData ?? null)?.type_order} dates=${dates[0]}..${dates[dates.length-1]}`);
    } catch (e) { console.log("  [response parse error] " + (e as Error).message); }
  });

  try {
    const url = buildDirectNeighborhoodUrl(sourceId);
    console.log("NAVIGATING_DIRECTLY_TO=" + url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(8000);
    console.log("BASELINE_DESC_ROWS=" + (exchanges[0]?.itemCount ?? 0));

    // Dump the accessibility tree around "מיון" to find the real toggle —
    // must properly OPEN the dropdown (a normal click a real user would
    // perform) rather than force-clicking a hidden option, which does not
    // reliably trigger the site's own selection handler.
    const sortWords = await page.locator("text=מיון").all();
    console.log("SORT_WORD_MATCHES=" + sortWords.length);
    for (let i = 0; i < sortWords.length; i++) {
      const tag = await sortWords[i].evaluate((el: any) => el.tagName).catch(() => "?");
      const cls = await sortWords[i].evaluate((el: any) => el.className).catch(() => "?");
      const vis = await sortWords[i].isVisible().catch(() => false);
      console.log(`  [${i}] tag=${tag} class=${cls} visible=${vis}`);
    }

    if (sortWords.length > 0) {
      // Click the first VISIBLE "מיון" element (the actual toggle button).
      let toggle = null;
      for (const el of sortWords) { if (await el.isVisible().catch(() => false)) { toggle = el; break; } }
      if (toggle) {
        await toggle.click({ timeout: 5000 });
        await page.waitForTimeout(1500);
        const ascOption = page.locator("*", { hasText: "תאריך עסקה - סדר עולה" }).last();
        const ascVisibleNow = await ascOption.isVisible().catch(() => false);
        console.log("ASC_OPTION_VISIBLE_AFTER_TOGGLE=" + ascVisibleNow);
        if (ascVisibleNow) {
          const exCountBefore = exchanges.length;
          await ascOption.click({ timeout: 5000 });
          await page.waitForTimeout(6000);
          console.log("EXCHANGES_AFTER_ASC_SELECT=" + exchanges.length + " (was " + exCountBefore + ")");
        } else {
          console.log("ASC_OPTION_STILL_NOT_VISIBLE_AFTER_TOGGLE");
        }
      } else {
        console.log("NO_VISIBLE_SORT_TOGGLE_FOUND");
      }
    } else {
      console.log("ASC_OPTION_NOT_FOUND_AT_ALL");
    }
  } catch (e) {
    console.log("ERROR=" + (e as Error).message);
  } finally {
    await ctx.close();
  }

  await fs.writeFile(path.join(OUT_DIR, "sort_exchanges.json"), JSON.stringify(exchanges, null, 2));
  console.log("\nTOTAL_EXCHANGES=" + exchanges.length);
  console.log("DONE");
}

main().catch((e) => { console.error("SORT_PROBE_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
