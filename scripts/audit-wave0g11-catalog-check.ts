/**
 * scripts/audit-wave0g11-catalog-check.ts — bounded, single-fetch verification
 * that the official nadlan.gov.il catalog (lib/nadlanCatalog.ts) surfaces
 * entity 65210195 ("נוף הטיילת"). ONE network call, no per-entity coordinate
 * enrichment, no GovMap fallback — deliberately narrow, per the user's
 * explicit instruction to avoid a repeat of the earlier ~60-request run.
 */
import { getOfficialNetanyaEntities } from "../lib/nadlanCatalog";

async function main() {
  const t0 = Date.now();
  const entities = await getOfficialNetanyaEntities();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const target = entities.find((e) => e.sourceId === "65210195");
  console.log("CATALOG_ROWS=" + entities.length);
  console.log("TARGET_65210195_PRESENT=" + !!target);
  console.log("TARGET_NAME=" + (target?.name ?? "N/A"));
  console.log("TARGET_SOURCE_ID=" + (target?.sourceId ?? "N/A"));
  console.log("ELAPSED_SECONDS=" + elapsed);
  console.log("NETWORK_REQUEST_COUNT=1");
}

main().catch((e) => { console.error("ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
