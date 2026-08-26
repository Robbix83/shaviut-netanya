/**
 * scripts/audit-wave0g17-street-counts.ts — Wave 0G-17 Phase 16: fetches the
 * MEASURED official street count for each of the 11 PARTIAL entities via
 * the safe, unauthenticated `https://data.nadlan.gov.il/api/pages/
 * neighborhood/buy/{id}.json` endpoint's `otherNeighborhoodStreets` field
 * (the same endpoint lib/nadlanCatalog.ts already uses for entity
 * discovery — no browser, no reCAPTCHA needed).
 *
 * Committed as a reusable script per ECC silent-failure-hunter finding: the
 * first version of this number was computed via an ad-hoc inline snippet,
 * not independently reproducible from anything under scripts/.
 */
import { promises as fs } from "fs";
import path from "path";
import { buildNadlanNeighborhoodPageUrl } from "../lib/nadlanCatalog";
import { assertSafeShadowOutputPath } from "../lib/shadowRebuild";

const OUT_DIR_REL = "audit/wave0g17/shadow";
const OUT_DIR = path.join(process.cwd(), OUT_DIR_REL);

const PARTIAL_ENTITIES: { id: string; name: string }[] = [
  { id: "65209717", name: "מרכז העיר" },
  { id: "65209683", name: "קריית השרון" },
  { id: "65209705", name: "קריית נורדאו" },
  { id: "65210243", name: 'מע"ר - מרכז עירוני ר' },
  { id: "65210245", name: "אבו שדיד" },
  { id: "65209703", name: "עיר ימים" },
  { id: "65209727", name: "חוף הים והמלונות" },
  { id: "65210752", name: "מכנס" },
  { id: "65209736", name: "רמת אפרים" },
  { id: "65210248", name: "רסקו" },
  { id: "65209689", name: "אזור תעשיה פנחס ספי" },
];

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/official_street_counts.json`);
  console.log("=== WAVE 0G-17 PHASE 16: OFFICIAL STREET COUNTS FOR 11 PARTIAL ENTITIES ===");

  const results: { id: string; name: string; streetCount: number | null; error: string | null }[] = [];
  let total = 0;
  for (const { id, name } of PARTIAL_ENTITIES) {
    try {
      const url = buildNadlanNeighborhoodPageUrl(id);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: any = await res.json();
      const streets = data.otherNeighborhoodStreets;
      if (!Array.isArray(streets)) throw new Error("otherNeighborhoodStreets missing or not an array");
      results.push({ id, name, streetCount: streets.length, error: null });
      total += streets.length;
      console.log(`  ${name} (${id}): ${streets.length} streets`);
    } catch (e) {
      results.push({ id, name, streetCount: null, error: (e as Error).message });
      console.log(`  ${name} (${id}): ERROR ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 300)); // polite delay between plain GETs
  }

  console.log("TOTAL_OFFICIAL_STREETS=" + total);
  await fs.writeFile(path.join(OUT_DIR, "official_street_counts.json"), JSON.stringify({ results, total }, null, 2));
  console.log("DONE");
}

main().catch((e) => { console.error("STREET_COUNTS_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
