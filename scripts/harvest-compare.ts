/**
 * scripts/harvest-compare.ts — step 2 of the safe data refresh (docs/HARVEST.md).
 *
 *   npx tsx scripts/harvest-compare.ts data/harvest/2026-11/harvested.json
 *
 * Compares a file-only harvest (HARVEST_OUT) against the dataset production serves
 * (data/v2-candidate/deals-v2.json, checked against its manifest sha and the live row count).
 * READ-ONLY for every database. Writes next to the input file:
 *   added.json   — rows that are genuinely new (safe to upload in step 3)
 *   suspect.json — rows that look like an existing sale under a different id (NOT uploaded)
 *   merged.json  — base + added (for the market index and the backtest)
 *   report.md    — what to look at before approving the upload
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Deal } from "../lib/types";
import { mergeIncrementalDeals } from "../lib/dealNormalization";

const ROOT = path.resolve(__dirname, "..");
const inFile = process.argv[2];
if (!inFile || !existsSync(inFile)) {
  console.error("usage: npx tsx scripts/harvest-compare.ts <harvested.json>");
  process.exit(1);
}
const outDir = path.dirname(path.resolve(inFile));

const basePath = path.join(ROOT, "data/v2-candidate/deals-v2.json");
const manifest = JSON.parse(readFileSync(path.join(ROOT, "data/v2-candidate/manifest.json"), "utf8"));
const baseRaw = readFileSync(basePath);
const baseSha = createHash("sha256").update(baseRaw).digest("hex");
const base = JSON.parse(baseRaw.toString("utf8")) as Deal[];
const fresh = JSON.parse(readFileSync(inFile, "utf8")) as Deal[];

// 1) the project's own merge (same id / legacy key rules as scripts/harvest.ts)
const { added: byId, skippedDuplicateCount } = mergeIncrementalDeals(base, fresh);

// 2) extra, neighbourhood-agnostic duplicate check: a harvested neighbourhood id can differ from the
//    V2 entity id, which defeats the legacy key. Same date + price + (street+number or area) = same sale.
const norm = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();
const keyAddr = (d: Deal) => `${d.dealDate}|${d.price}|${norm(d.street)}|${norm(d.houseNumber)}`;
const keyArea = (d: Deal) => `${d.dealDate}|${d.price}|${d.areaSqm ?? d.plotSqm ?? "null"}`;
const baseAddr = new Set(base.filter((d) => d.street).map(keyAddr));
const baseArea = new Set(base.map(keyArea));
const added: Deal[] = [];
const suspect: Deal[] = [];
for (const d of byId) (baseAddr.has(keyAddr(d)) || baseArea.has(keyArea(d)) ? suspect : added).push(d);

// 3) sanity
const baseLast = base.reduce((m, d) => (d.dealDate > m ? d.dealDate : m), "");
const month = (d: Deal) => d.dealDate.slice(0, 7);
const countBy = <T,>(rows: T[], k: (r: T) => string) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(k(r), (m.get(k(r)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
};
const oldAdded = added.filter((d) => d.dealDate <= baseLast);
const bad = added.filter(
  (d) => !d.dealDate || !(d.price > 0) || !d.neighborhoodId ||
    (d.propertyType === "apartment" && (d.pricePerSqm == null || d.pricePerSqm < 5_000 || d.pricePerSqm > 150_000)),
);

const merged = base.concat(added);
writeFileSync(path.join(outDir, "added.json"), JSON.stringify(added));
writeFileSync(path.join(outDir, "suspect.json"), JSON.stringify(suspect));
writeFileSync(path.join(outDir, "merged.json"), JSON.stringify(merged));

const lines = [
  `# Harvest comparison — ${path.basename(outDir)}`,
  "",
  `Base: data/v2-candidate/deals-v2.json — ${base.length} rows, last sale ${baseLast}, sha ${baseSha === manifest.sha256 ? "matches manifest" : "**DOES NOT match manifest**"}.`,
  `Harvested: ${fresh.length} rows.`,
  "",
  "| | rows |",
  "| --- | ---: |",
  `| already in base (same id / legacy key) | ${skippedDuplicateCount} |`,
  `| look like an existing sale under another id (suspect.json, not uploaded) | ${suspect.length} |`,
  `| **new (added.json)** | **${added.length}** |`,
  `| — of them dated on/before the base's last sale (${baseLast}) | ${oldAdded.length} |`,
  `| — of them failing sanity checks | ${bad.length} |`,
  "",
  "## New rows by month",
  "",
  "| month | rows |",
  "| --- | ---: |",
  ...countBy(added, month).map(([m, n]) => `| ${m} | ${n} |`),
  "",
  "## New rows by neighbourhood",
  "",
  "| neighbourhood | rows |",
  "| --- | ---: |",
  ...countBy(added, (d) => d.neighborhood ?? d.neighborhoodId).sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${k} | ${n} |`),
  "",
  "## Before approving the upload",
  "",
  "- Most new rows should be dated after the base's last sale. Many older ones usually mean ids changed upstream: stop and check.",
  "- Rows failing sanity checks should be zero or a handful.",
  "- Harvested rows ≪ previous coverage for a neighbourhood means the site blocked that page: re-run the harvest.",
];
writeFileSync(path.join(outDir, "report.md"), lines.join("\n"));
console.log(lines.slice(0, 16).join("\n"));
console.log(`\nWrote added.json, suspect.json, merged.json, report.md in ${outDir}`);
