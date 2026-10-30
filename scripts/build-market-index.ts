/**
 * scripts/build-market-index.ts — monthly Netanya apartment price index for the valuation time adjustment.
 *
 *   npx tsx scripts/build-market-index.ts [--data data/v2-candidate/deals-v2.json]
 *
 * For each month: the median ₪/m² of apartment sales in the 6 months ending that month.
 * Writes data/market-index.json (aggregates only). Re-run after every data refresh.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const i = process.argv.indexOf("--data");
const dataPath = path.resolve(ROOT, i >= 0 ? process.argv[i + 1] : "data/v2-candidate/deals-v2.json");

const MIN_PPSQM = 8_000, MAX_PPSQM = 120_000, MIN_DEALS = 30, WINDOW = 6;

const deals = JSON.parse(readFileSync(dataPath, "utf8")) as {
  dealDate: string; propertyType?: string; pricePerSqm?: number | null;
}[];
const byMonth = new Map<string, number[]>();
for (const d of deals) {
  const p = d.pricePerSqm;
  if ((d.propertyType ?? "apartment") !== "apartment" || p == null || p < MIN_PPSQM || p > MAX_PPSQM) continue;
  const m = d.dealDate.slice(0, 7);
  byMonth.set(m, [...(byMonth.get(m) ?? []), p]);
}

const months = [...byMonth.keys()].sort();
const shift = (m: string, by: number) => {
  const d = new Date(`${m}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
};
const index: Record<string, number> = {};
for (let m = months[0]; m <= months[months.length - 1]; m = shift(m, 1)) {
  const window = Array.from({ length: WINDOW }, (_, k) => byMonth.get(shift(m, -k)) ?? []).flat().sort((a, b) => a - b);
  if (window.length >= MIN_DEALS) index[m] = window[window.length >> 1];
}

writeFileSync(path.join(ROOT, "data/market-index.json"), JSON.stringify(index, null, 0) + "\n");
console.log(`market index: ${Object.keys(index).length} months, last ${Object.keys(index).pop()}`);
