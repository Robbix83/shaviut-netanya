/**
 * scripts/audit-wave0g20-live-control-probe.ts — Wave 0G-20 Phase 18:
 * bounded live control. AT MOST ONE fresh street fetch1 from a previously
 * mixed street, to (a) verify the mixed-identity phenomenon still
 * reproduces live and (b) supply the row-level raw data Wave 0G-18's
 * runner never persisted for FAILED_IDENTITY streets — needed for Phase
 * 3's retrospective CLASS A replay (moved earlier out of necessity, same
 * as Wave 0G-19's own Phase 12 reordering, disclosed in the report).
 *
 * fetch_number=1 ONLY. No canonical/Supabase writes. No fetch2. No second
 * street unless this one fails to reproduce.
 *
 * Usage: npx tsx scripts/audit-wave0g20-live-control-probe.ts <streetId> <streetName>
 */
import { promises as fs } from "fs";
import path from "path";
import { decodeRequestEnvelope } from "../lib/nadlanAcquisition";
import { decodeDealData } from "../lib/dealNormalization";
import { assertSafeShadowOutputPath } from "../lib/shadowRebuild";
import { classifyBatchForAcceptance, classifyBatchStatus } from "../lib/streetRowAcceptance";

const PARENT_SOURCE_ID = "65209683"; // קריית השרון
const OUT_DIR_REL = "audit/wave0g20/shadow";
const OUT_DIR = path.join(process.cwd(), OUT_DIR_REL);
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

async function main() {
  const streetId = process.argv[2];
  const streetName = process.argv[3] ?? streetId;
  if (!streetId) throw new Error("USAGE: npx tsx scripts/audit-wave0g20-live-control-probe.ts <streetId> <streetName>");

  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log(`=== WAVE 0G-20 PHASE 18: BOUNDED LIVE CONTROL — ${streetName} (${streetId}) ===`);

  const headless = process.env.HARVEST_HEADLESS === "true";
  const { chromium: pwChromium } = await import("playwright");
  const ctx = await pwChromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless, slowMo: headless ? 0 : 50,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  let captured: { envelope: ReturnType<typeof decodeRequestEnvelope>; items: any[] } | null = null;

  const handler = async (resp: any) => {
    const u = resp.url();
    if (!u.includes("/deal-data")) return;
    try {
      const body = await resp.text();
      const decoded = decodeDealData(body);
      const items = decoded?.data?.items ?? decoded?.items ?? [];
      const req = resp.request();
      const envelope = decodeRequestEnvelope(req.postData());
      if (captured) return;
      const isMatch = envelope?.base_name === "streetCode" && envelope.base_id != null && String(envelope.base_id) === streetId;
      if (isMatch) captured = { envelope, items };
    } catch (e) {
      console.log("  [parse error] " + (e as Error).message);
    }
  };

  try {
    const page = await ctx.newPage();
    await page.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
    page.on("response", handler);
    const url = `https://www.nadlan.gov.il/?view=street&id=${streetId}&page=deals`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(6000);
    page.off("response", handler);
  } finally {
    await ctx.close();
  }

  if (!captured) {
    console.log("FAILED: no matching streetCode exchange captured");
    process.exit(1);
  }
  const { envelope, items } = captured as { envelope: ReturnType<typeof decodeRequestEnvelope>; items: any[] };
  console.log(`RAW_ROWS=${items.length} fetch_number=${envelope?.fetch_number} base_id=${envelope?.base_id}`);
  if (envelope?.fetch_number != null && envelope.fetch_number !== 1) {
    throw new Error(`SAFETY_VIOLATION: captured exchange has fetch_number=${envelope.fetch_number}, this wave requires exactly 1`);
  }

  const counts = classifyBatchForAcceptance(items, PARENT_SOURCE_ID);
  const batchStatus = classifyBatchStatus(counts);
  console.log(`LIVE_STREET=${streetName}`);
  console.log(`ACCEPTED_PARENT=${counts.acceptedParent}`);
  console.log(`REJECTED_ZERO=${counts.rejectedZero}`);
  console.log(`REJECTED_FOREIGN=${counts.rejectedForeign}`);
  console.log(`REJECTED_MISSING=${counts.rejectedMissing}`);
  console.log(`REJECTED_MALFORMED=${counts.rejectedMalformed}`);
  console.log(`ACCOUNTING_MATCH=${counts.acceptedParent + counts.rejectedZero + counts.rejectedForeign + counts.rejectedMissing + counts.rejectedMalformed === counts.rawRows}`);
  console.log(`BATCH_STATUS=${batchStatus}`);

  const outFileRel = `${OUT_DIR_REL}/live_control_${streetId}.json`;
  assertSafeShadowOutputPath(outFileRel);
  await fs.writeFile(path.join(OUT_DIR, `live_control_${streetId}.json`), JSON.stringify({
    streetId, streetName, parentSourceId: PARENT_SOURCE_ID, envelope, counts, batchStatus, rawItems: items,
  }, null, 2));
  console.log("DONE");
}

main().catch((e) => { console.error("LIVE_CONTROL_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
