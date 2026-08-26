/**
 * scripts/audit-wave0g16-load-catalog.ts — Wave 0G-16 Phase 2: load the
 * official nadlan.gov.il catalog (plain unauthenticated GET, no reCAPTCHA)
 * and report entity/name counts. Fails closed on an empty/invalid catalog.
 */
import { promises as fs } from "fs";
import path from "path";
import { getOfficialNetanyaEntities } from "../lib/nadlanCatalog";

async function main() {
  const entities = await getOfficialNetanyaEntities();
  const uniqueIds = new Set(entities.map((e) => e.sourceId));
  const uniqueNames = new Set(entities.map((e) => e.name));
  console.log("CATALOG_ENTITY_COUNT=" + entities.length);
  console.log("UNIQUE_SOURCE_IDS=" + uniqueIds.size);
  console.log("UNIQUE_NAMES=" + uniqueNames.size);
  for (const e of entities) console.log(`  sourceId=${e.sourceId} name=${e.name}`);

  await fs.mkdir(path.join(process.cwd(), "audit/wave0g16"), { recursive: true });
  await fs.writeFile(
    path.join(process.cwd(), "audit/wave0g16/catalog_snapshot.json"),
    JSON.stringify({ fetchedAt: "wave0g16-phase2", count: entities.length, entities }, null, 2),
  );
  console.log("DONE");
}

main().catch((e) => { console.error("CATALOG_LOAD_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
