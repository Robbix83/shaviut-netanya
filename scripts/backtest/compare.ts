/**
 * scripts/backtest/compare.ts — row-by-row comparison of two backtest runs.
 *
 *   npx tsx scripts/backtest/compare.ts <runA> <runB> [--identical]
 *
 * Runs are labels under audit/backtest/runs/ (or paths to results.json). Rows are joined on the
 * sale id. --identical exits 1 unless every shared row has the same status and estimates
 * (used to prove a refactor did not change behaviour).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { metrics, formatMetricsTable, type BacktestRow } from "./core";

const ROOT = path.resolve(__dirname, "../..");
const load = (ref: string): { meta: any; rows: BacktestRow[] } => {
  const p = existsSync(ref) ? ref : path.join(ROOT, "audit/backtest/runs", ref, "results.json");
  return JSON.parse(readFileSync(p, "utf8"));
};

const [refA, refB] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const wantIdentical = process.argv.includes("--identical");
const A = load(refA), B = load(refB);
const bById = new Map(B.rows.map((r) => [r.id, r]));
const shared = A.rows.filter((r) => bById.has(r.id));

let identical = 0, statusChanged = 0, better = 0, worse = 0, same = 0;
const moves: { id: string; a: number; b: number; r: BacktestRow }[] = [];
for (const a of shared) {
  const b = bById.get(a.id)!;
  const eq = a.status === b.status && a.low === b.low && a.mid === b.mid && a.high === b.high;
  if (eq) identical++;
  if (a.status !== b.status) statusChanged++;
  if (a.errPct != null && b.errPct != null) {
    const da = Math.abs(a.errPct), db = Math.abs(b.errPct);
    if (db < da - 1e-9) better++; else if (db > da + 1e-9) worse++; else same++;
    if (Math.abs(db - da) > 1e-9) moves.push({ id: a.id, a: da, b: db, r: b });
  }
}

console.log(`A = ${A.meta.label} (${A.meta.track}, asof ${A.meta.asOfMode}, ${A.meta.split})`);
console.log(`B = ${B.meta.label} (${B.meta.track}, asof ${B.meta.asOfMode}, ${B.meta.split})`);
if (A.meta.sha256 !== B.meta.sha256) console.log("WARNING: different datasets");
console.log(formatMetricsTable({ [`A ${A.meta.label}`]: metrics(A.rows), [`B ${B.meta.label}`]: metrics(B.rows) }));
console.log(`\nshared rows ${shared.length} · identical ${identical} · status changed ${statusChanged}`);
console.log(`both numeric: B closer ${better} · B further ${worse} · equal ${same}`);
const pct = (x: number) => (x * 100).toFixed(1) + "%";
const top = (list: typeof moves, n: number) => list.slice(0, n)
  .map((m) => `  ${m.r.street} ${m.r.house} (${m.r.neighborhood}, ${m.r.date}) ${pct(m.a)} → ${pct(m.b)}`).join("\n");
console.log("\nlargest improvements:\n" + top([...moves].sort((x, y) => (y.a - y.b) - (x.a - x.b)), 5));
console.log("largest regressions:\n" + top([...moves].sort((x, y) => (y.b - y.a) - (x.b - x.a)), 5));

if (wantIdentical && (identical !== shared.length || shared.length !== A.rows.length || A.rows.length !== B.rows.length)) {
  console.error(`\nNOT IDENTICAL: ${A.rows.length - identical} of ${A.rows.length} rows differ`);
  process.exit(1);
}
