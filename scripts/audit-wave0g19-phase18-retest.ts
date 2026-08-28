/**
 * scripts/audit-wave0g19-phase18-retest.ts — Wave 0G-19 Phase 18: compares
 * OLD policy (Wave 0G-18's all-or-nothing assertDirectIdAcquisitionIdentity)
 * vs NEW policy (lib/streetIdentityPolicy.ts's classifyRowIdentity) on the
 * ALREADY-CAPTURED Phase 12 probe data. No new live fetch.
 */
import { promises as fs } from "fs";
import path from "path";
import { classifyRowIdentity, summarizeRowIdentityDecisions } from "../lib/streetIdentityPolicy";

const PARENT_SOURCE_ID = "65209683";

async function main() {
  for (const streetId of ["74001232", "74001260"]) {
    const probe = JSON.parse(await fs.readFile(path.join(process.cwd(), `audit/wave0g19/shadow/probe_${streetId}.json`), "utf8"));
    const { streetName, rawItems: items } = probe;

    const oldAccepted = items.every((it: any) => String(it.neighborhoodId) === PARENT_SOURCE_ID) ? items.length : 0;
    const decisions = items.map((it: any) => classifyRowIdentity(it, PARENT_SOURCE_ID, streetId, streetName).decision);
    const summary = summarizeRowIdentityDecisions(decisions);
    const newAccepted = summary.acceptedParent + summary.acceptedZero;

    console.log(`LIVE_STREET=${streetName} (${streetId})`);
    console.log(`RAW_ROWS=${items.length}`);
    console.log(`OLD_POLICY_ACCEPTED=${oldAccepted}`);
    console.log(`NEW_POLICY_ACCEPTED=${newAccepted}`);
    console.log(`ZERO_NEWLY_ACCEPTED=${summary.acceptedZero}`);
    console.log(`FOREIGN_STILL_REJECTED=${summary.rejectedForeign}`);
    console.log(`FULL_SUMMARY=${JSON.stringify(summary)}`);
    console.log("---");
  }
}
main().catch((e) => { console.error("PHASE18_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
