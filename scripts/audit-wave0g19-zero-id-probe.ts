/**
 * scripts/audit-wave0g19-zero-id-probe.ts — Wave 0G-19 Phase 12 (moved
 * earlier out of necessity, disclosed in the report): bounded live
 * fetch1-only re-acquisition of AT MOST 2 streets, to obtain the row-level
 * raw data Wave 0G-18's runner never persisted for FAILED_IDENTITY streets
 * (it discarded the whole batch before writing anything beyond aggregate
 * counts — see scripts/audit-wave0g18-street-runner.ts's classifyStreetExchange,
 * the `empty` spread on the FAILED_IDENTITY branch). Without this, Phases
 * 4-11's row-level field inventory, street-name consistency, and
 * parcel/address bridging analysis have no data to work from.
 *
 * UNLIKE the Wave 0G-18 runner, this script does NOT apply the fail-closed
 * identity filter at capture time — it persists EVERY raw row returned,
 * with its own neighborhoodId, so every row can be classified into CLASS
 * A/B/C/D for analysis. It performs NO acceptance/merge decision itself.
 *
 * fetch_number=1 ONLY. No canonical/Supabase writes. No fetch2.
 *
 * Usage: npx tsx scripts/audit-wave0g19-zero-id-probe.ts <streetId1> <streetId2>
 */
import { promises as fs } from "fs";
import path from "path";
import { decodeRequestEnvelope } from "../lib/nadlanAcquisition";
import { decodeDealData } from "../lib/dealNormalization";
import { assertSafeShadowOutputPath } from "../lib/shadowRebuild";

const PARENT_SOURCE_ID = "65209683"; // קריית השרון
const OUT_DIR_REL = "audit/wave0g19/shadow";
const OUT_DIR = path.join(process.cwd(), OUT_DIR_REL);
const PROFILE_DIR = process.env.CHROME_PROFILE_DIR
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".harvest-chrome");

async function probeOneStreet(page: any, streetId: string, streetName: string) {
  console.log(`=== PROBING streetId=${streetId} (${streetName}) ===`);
  let captured: { envelope: ReturnType<typeof decodeRequestEnvelope>; items: any[]; decoded: any } | null = null;

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
      // ECC specialist finding: the previous `envelope.base_id == null`
      // fallback would accept ANY response whose envelope failed to decode
      // a base_id, regardless of which street it actually answers — the
      // same latent bug class Wave 0G-18 had to fix (a stray/wrong-street
      // exchange silently misattributed). Didn't manifest in this run's 2
      // captures (both decoded base_id correctly), but must not ship as a
      // reusable pattern. base_id must now match exactly, no null bypass.
      const isMatch = envelope?.base_name === "streetCode" && envelope.base_id != null && String(envelope.base_id) === streetId;
      if (isMatch) captured = { envelope, items, decoded };
    } catch (e) {
      console.log("  [parse error] " + (e as Error).message);
    }
  };
  page.on("response", handler);
  try {
    const url = `https://www.nadlan.gov.il/?view=street&id=${streetId}&page=deals`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(6000);
  } finally {
    page.off("response", handler);
  }

  if (!captured) {
    console.log("  FAILED: no matching streetCode exchange captured");
    return { streetId, streetName, captured: false, items: [] as any[], envelope: null as any };
  }
  const c = captured as { envelope: ReturnType<typeof decodeRequestEnvelope>; items: any[]; decoded: any };
  console.log(`  fetch_number=${c.envelope?.fetch_number} base_id=${c.envelope?.base_id} items=${c.items.length}`);
  if (c.envelope?.fetch_number != null && c.envelope.fetch_number !== 1) {
    throw new Error(`SAFETY_VIOLATION: captured exchange has fetch_number=${c.envelope.fetch_number}, this wave requires exactly 1`);
  }
  return { streetId, streetName, captured: true, items: c.items, envelope: c.envelope };
}

async function main() {
  const streetId1 = process.argv[2];
  const streetId2 = process.argv[3];
  if (!streetId1) throw new Error("USAGE: npx tsx scripts/audit-wave0g19-zero-id-probe.ts <streetId1> [streetId2]");

  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log("=== WAVE 0G-19 PHASE 12: BOUNDED ZERO-ID LIVE CONFIRMATION (fetch1 only) ===");

  const targets = [
    { id: streetId1, name: process.argv[4] ?? streetId1 },
    ...(streetId2 ? [{ id: streetId2, name: process.argv[5] ?? streetId2 }] : []),
  ];
  if (targets.length > 2) throw new Error("SAFETY_VIOLATION: at most 2 streets allowed this wave");

  const headless = process.env.HARVEST_HEADLESS === "true";
  const { chromium: pwChromium } = await import("playwright");
  const ctx = await pwChromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome", headless, slowMo: headless ? 0 : 50,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  try {
    const page = await ctx.newPage();
    await page.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });

    for (const t of targets) {
      const result = await probeOneStreet(page, t.id, t.name);

      const items = result.items;
      const classCounts = { A_parent: 0, B_zero: 0, C_foreign: 0, D_other: 0 };
      for (const it of items) {
        const nid = it?.neighborhoodId != null ? String(it.neighborhoodId) : null;
        if (nid === PARENT_SOURCE_ID) classCounts.A_parent++;
        else if (nid === "0") classCounts.B_zero++;
        else if (nid != null) classCounts.C_foreign++;
        else classCounts.D_other++;
      }
      console.log(`  CLASS_BREAKDOWN=${JSON.stringify(classCounts)}`);

      const outFileRel = `${OUT_DIR_REL}/probe_${t.id}.json`;
      assertSafeShadowOutputPath(outFileRel);
      await fs.writeFile(path.join(OUT_DIR, `probe_${t.id}.json`), JSON.stringify({
        streetId: t.id, streetName: t.name, parentSourceId: PARENT_SOURCE_ID,
        captured: result.captured, envelope: result.envelope, classCounts,
        rawItems: items, // full raw, uncommitted — analysis-only
      }, null, 2));

      await page.waitForTimeout(1500);
    }
  } finally {
    await ctx.close();
  }

  console.log("=== PROBE COMPLETE ===");
}

main().catch((e) => { console.error("ZERO_ID_PROBE_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
