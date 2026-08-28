/**
 * scripts/audit-wave0g24-load-street-manifests.ts — Wave 0G-24 Phase 3:
 * enumerates the official street list for each of the 10 target PARTIAL
 * entities (all Wave 0G-16 PARTIAL entities except קריית השרון, already
 * fully investigated through Waves 0G-17-0G-23 and excluded per this
 * wave's hard boundary), reusing the proven, safe, unauthenticated
 * lib/nadlanCatalog.ts getOfficialEntityStreets() call — the same
 * mechanism Wave 0G-18 used for Kiryat's own 70-street manifest.
 *
 * No reCAPTCHA, no browser, no deal-data acquisition — this is discovery
 * only. Writes one manifest CSV + raw JSON per entity under audit/wave0g24/.
 */
import { promises as fs } from "fs";
import path from "path";
import { getOfficialEntityStreets } from "../lib/nadlanCatalog";

const OUT_DIR = path.join(process.cwd(), "audit/wave0g24");

const TARGET_ENTITIES = [
  { name: "אזור תעשיה פנחס ספי", sourceId: "65209689", officialTotal: 1021, baselineUnique: 1000 }, // ECC finding: matches audit/wave0g16/citywide_summary.json's canonical NAME exactly
  { name: "עיר ימים", sourceId: "65209703", officialTotal: 3060, baselineUnique: 2325 },
  { name: "קריית נורדאו", sourceId: "65209705", officialTotal: 3281, baselineUnique: 2265 },
  { name: "מרכז העיר", sourceId: "65209717", officialTotal: 9972, baselineUnique: 3282 },
  { name: "חוף הים והמלונות", sourceId: "65209727", officialTotal: 2612, baselineUnique: 2343 },
  { name: "רמת אפרים", sourceId: "65209736", officialTotal: 2266, baselineUnique: 2082 },
  { name: 'מע"ר - מרכז עירוני ר', sourceId: "65210243", officialTotal: 3273, baselineUnique: 2329 },
  { name: "אבו שדיד", sourceId: "65210245", officialTotal: 3082, baselineUnique: 2292 },
  { name: "רסקו", sourceId: "65210248", officialTotal: 2012, baselineUnique: 2010 },
  { name: "מכנס", sourceId: "65210752", officialTotal: 2375, baselineUnique: 2165 },
];

async function main() {
  console.log("=== WAVE 0G-24 PHASE 3: LOAD STREET MANIFESTS FOR 10 TARGET PARTIAL ENTITIES ===");
  await fs.mkdir(OUT_DIR, { recursive: true });

  const results: { name: string; sourceId: string; streetCount: number }[] = [];
  const allStreetsCsvLines = ["ENTITY,SOURCE_ID,STREET_ID,STREET_NAME"];
  let totalStreets = 0;
  const seenGlobalStreetIds = new Map<string, string>(); // streetId -> first entity that used it (streetIds may repeat across entities on boundary streets)

  for (const entity of TARGET_ENTITIES) {
    try {
      const streets = await getOfficialEntityStreets(entity.sourceId);
      console.log(`${entity.name} (${entity.sourceId}): ${streets.length} official streets`);
      results.push({ name: entity.name, sourceId: entity.sourceId, streetCount: streets.length });
      totalStreets += streets.length;
      for (const s of streets) {
        allStreetsCsvLines.push(`"${entity.name}",${entity.sourceId},${s.streetId},"${s.name.replace(/"/g, '""')}"`);
        if (!seenGlobalStreetIds.has(s.streetId)) seenGlobalStreetIds.set(s.streetId, entity.name);
      }
      await fs.writeFile(path.join(OUT_DIR, `street_manifest_${entity.sourceId}.json`), JSON.stringify({ entity: entity.name, sourceId: entity.sourceId, streets }, null, 2));
    } catch (e) {
      console.log(`ERROR fetching streets for ${entity.name} (${entity.sourceId}): ${(e as Error).message}`);
      results.push({ name: entity.name, sourceId: entity.sourceId, streetCount: -1 });
    }
    // Conservative pacing — this is a safe, unauthenticated JSON endpoint but still be polite.
    await new Promise((r) => setTimeout(r, 500));
  }

  await fs.writeFile(path.join(OUT_DIR, "all_target_streets_manifest.csv"), allStreetsCsvLines.join("\n") + "\n");

  console.log(`\nTOTAL_STREETS_ENUMERATED=${totalStreets}`);
  console.log(`DISTINCT_STREET_IDS_ACROSS_ENTITIES=${seenGlobalStreetIds.size} (a streetId reused across 2+ entities indicates a boundary street)`);
  console.log(JSON.stringify(results, null, 2));

  await fs.writeFile(path.join(OUT_DIR, "street_enumeration_summary.json"), JSON.stringify({ results, totalStreets, distinctStreetIds: seenGlobalStreetIds.size }, null, 2));
  console.log("=== DONE ===");
}

main().catch((e) => { console.error("ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
