/**
 * scripts/audit-wave0g17-street-url-probe.ts — Wave 0G-17 Phase 5
 * correction/follow-up: tests whether a direct street-level URL pattern,
 * analogous to the already-proven `?view=neighborhood&id={sourceId}`
 * (lib/nadlanAcquisition.ts's buildDirectNeighborhoodUrl, Wave 0G-8), exists
 * for the officially-enumerated street id discovered this wave via the safe
 * unauthenticated `/api/pages/neighborhood/buy/{id}.json` endpoint
 * (otherNeighborhoodStreets: [{id, title}]) — e.g. `?view=street&id={streetId}`.
 *
 * This is NOT request-field guessing in the sense of fabricating an opaque
 * POST body — it is testing a normal browser navigation URL pattern
 * structurally analogous to the one already proven safe, exactly how
 * buildDirectNeighborhoodUrl's own pattern was originally established. If
 * this doesn't resolve to a working street view, that is itself a clean,
 * reportable NOT_PROVEN result, not fabricated.
 */
import { promises as fs } from "fs";
import path from "path";
import { assertDirectIdAcquisitionIdentity, decodeRequestEnvelope } from "../lib/nadlanAcquisition";
import { decodeDealData } from "../lib/dealNormalization";
import { assertSafeShadowOutputPath } from "../lib/shadowRebuild";

const NEIGHBORHOOD_SOURCE_ID = "65209683"; // קריית השרון
const STREET_ID = "74001205"; // הר שגיא, from otherNeighborhoodStreets this wave
const OUT_DIR_REL = "audit/wave0g17/shadow";
const OUT_DIR = path.join(process.cwd(), OUT_DIR_REL);
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

const CANDIDATE_URLS = [
  `https://www.nadlan.gov.il/?view=street&id=${STREET_ID}&page=deals`,
  `https://www.nadlan.gov.il/?view=street&id=${STREET_ID}&neigh_id=${NEIGHBORHOOD_SOURCE_ID}&page=deals`,
  `https://www.nadlan.gov.il/?view=neighborhood&id=${NEIGHBORHOOD_SOURCE_ID}&street=${STREET_ID}&page=deals`,
];

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/street_url_probe_results.json`);
  console.log("=== WAVE 0G-17 STREET DIRECT-URL PROBE (streetId=" + STREET_ID + ") ===");

  const headless = process.env.HARVEST_HEADLESS === "true";
  const { chromium: pwChromium } = await import("playwright");
  const ctx = await pwChromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless, slowMo: headless ? 0 : 60,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  const results: any[] = [];

  try {
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    for (const url of CANDIDATE_URLS) {
      const exchanges: any[] = [];
      const handler = async (resp: any) => {
        const u = resp.url();
        if (!u.includes("/deal-data")) return;
        try {
          const body = await resp.text();
          const decoded = decodeDealData(body);
          const items = decoded?.data?.items ?? decoded?.items ?? [];
          const req = resp.request();
          const envelope = decodeRequestEnvelope(req.postData());
          const identity = assertDirectIdAcquisitionIdentity(items, NEIGHBORHOOD_SOURCE_ID);
          exchanges.push({
            itemCount: items.length, base_id: envelope?.base_id ?? null, base_name: envelope?.base_name ?? null,
            identityValid: identity.valid, distinctIds: identity.distinctIds,
          });
        } catch { /* parse error, skip */ }
      };
      page.on("response", handler);

      console.log("TRYING_URL=" + url);
      let finalUrl = "";
      let navError: string | null = null;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(5000);
        finalUrl = page.url();
      } catch (e) {
        navError = (e as Error).message;
      }
      page.off("response", handler);

      console.log(`  FINAL_URL=${finalUrl} REDIRECTED=${finalUrl !== url} EXCHANGES=${exchanges.length} NAV_ERROR=${navError ?? "none"}`);
      for (const e of exchanges) console.log(`    exchange: base_name=${e.base_name} base_id=${e.base_id} items=${e.itemCount} identity_valid=${e.identityValid}`);
      results.push({ triedUrl: url, finalUrl, redirected: finalUrl !== url, navError, exchanges });
    }
  } catch (e) {
    console.log("ERROR=" + (e as Error).message);
  } finally {
    await ctx.close();
  }

  await fs.writeFile(path.join(OUT_DIR, "street_url_probe_results.json"), JSON.stringify(results, null, 2));
  console.log("DONE");
}

main().catch((e) => { console.error("STREET_URL_PROBE_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
