/** Wave 0G-12 Phase 2 — one cheap catalog fetch to pick Entity C candidates. */
import { getOfficialNetanyaEntities, inferEntityCategoryHint } from "../lib/nadlanCatalog";

async function main() {
  const entities = await getOfficialNetanyaEntities();
  console.log("TOTAL=" + entities.length);
  for (const e of entities) {
    console.log(`${e.sourceId}\t${e.name}\t${inferEntityCategoryHint(e.name)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
