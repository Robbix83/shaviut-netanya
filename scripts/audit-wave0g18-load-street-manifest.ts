/**
 * scripts/audit-wave0g18-load-street-manifest.ts — Wave 0G-18 Phase 3: loads
 * the official, source-native street enumeration for ONE entity (קריית
 * השרון, sourceId=65209683) via the safe unauthenticated
 * `https://data.nadlan.gov.il/api/pages/neighborhood/buy/{id}.json` endpoint
 * (the same endpoint lib/nadlanCatalog.ts already uses for entity discovery
 * — no browser, no reCAPTCHA needed), and persists a compact safe manifest.
 *
 * Reuses lib/nadlanCatalog.ts's getOfficialEntityStreets() (Wave 0G-18
 * addition), which fails closed on a duplicate streetId or a missing/blank
 * title — this script adds no separate validation of its own beyond that.
 */
import { promises as fs } from "fs";
import path from "path";
import { getOfficialEntityStreets } from "../lib/nadlanCatalog";
import { assertSafeShadowOutputPath } from "../lib/shadowRebuild";

const ENTITY_SOURCE_ID = "65209683"; // קריית השרון
const OUT_DIR_REL = "audit/wave0g18";
const OUT_DIR = path.join(process.cwd(), OUT_DIR_REL);
const OUT_FILE_REL = `${OUT_DIR_REL}/kiryat_hasharon_street_manifest.csv`;

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  assertSafeShadowOutputPath(OUT_FILE_REL);
  console.log(`=== WAVE 0G-18 PHASE 3: OFFICIAL STREET MANIFEST FOR ${ENTITY_SOURCE_ID} ===`);

  const streets = await getOfficialEntityStreets(ENTITY_SOURCE_ID);

  const uniqueIds = new Set(streets.map((s) => s.streetId));
  const uniqueNames = new Set(streets.map((s) => s.name));
  console.log("OFFICIAL_STREET_COUNT=" + streets.length);
  console.log("UNIQUE_STREET_IDS=" + uniqueIds.size);
  console.log("UNIQUE_STREET_NAMES=" + uniqueNames.size);
  if (uniqueIds.size !== streets.length) {
    // getOfficialEntityStreets already fails closed on this — this is a
    // defense-in-depth assertion, never expected to fire.
    throw new Error("INTEGRITY_FAIL: duplicate streetId survived parseNadlanStreetCatalog's own guard");
  }
  if (uniqueNames.size !== streets.length) {
    console.log(`NOTE: ${streets.length - uniqueNames.size} street name(s) shared by 2+ distinct streetIds (expected — identity is streetId, not name; no collapse occurred)`);
  }

  const lines = ["STREET_ID,STREET_NAME"];
  for (const s of streets) lines.push(`${csvEscape(s.streetId)},${csvEscape(s.name)}`);
  await fs.writeFile(path.join(process.cwd(), OUT_FILE_REL), lines.join("\n") + "\n");

  await fs.writeFile(
    path.join(OUT_DIR, "street_manifest_raw.json"),
    JSON.stringify({ entitySourceId: ENTITY_SOURCE_ID, streetCount: streets.length, streets }, null, 2),
  );
  console.log("DONE");
}

main().catch((e) => { console.error("STREET_MANIFEST_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
