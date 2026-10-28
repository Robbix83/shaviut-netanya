/**
 * scripts/backtest/latency.ts — end-to-end timing of POST /api/valuation against a running server,
 * with the payload the wizard really sends (street-index neighbourhood id + street label).
 *
 *   npx tsx scripts/backtest/latency.ts [--base http://localhost:3031] [--n 25]
 *
 * Point it at `npm run dev:preview` (Supabase V2 preview tables, read-only) for a
 * production-like measurement. Reads only; never submits a lead.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { drawSample } from "./core";
import type { Deal } from "../../lib/types";

const arg = (n: string, f: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : f; };
const ROOT = path.resolve(__dirname, "../..");
const base = arg("base", "http://localhost:3031");
const n = Number(arg("n", "25"));
const norm = (s: string) => s.replace(/^(שד'?|שדרות|רחוב|רח')\s*/i, "").trim();

async function main() {
  const deals: Deal[] = JSON.parse(readFileSync(path.join(ROOT, "data/v2-candidate/deals-v2.json"), "utf8"));
  const lastDate = deals.reduce((m, d) => (d.dealDate > m ? d.dealDate : m), "");
  const index: any[] = [
    ...JSON.parse(readFileSync(path.join(ROOT, "data/street-index.json"), "utf8")),
    ...JSON.parse(readFileSync(path.join(ROOT, "data/street-index-extra.json"), "utf8")),
  ];
  const sample = drawSample(deals, { lastDate, split: "dev", size: "all", seed: 20261027 }).rows
    .filter((d) => (d.propertyType ?? "apartment") === "apartment").slice(0, n);

  const times: number[] = [];
  let ok = 0;
  for (const [i, d] of sample.entries()) {
    const hit = index.find((s) => s.street === d.street) ?? index.find((s) => s.street && norm(s.street) === norm(d.street!));
    const body = {
      neighborhoodId: hit?.neighborhoodId ?? "", propertyType: "apartment", rooms: d.rooms, areaSqm: d.areaSqm,
      plotSqm: null, floor: d.floor, yearBuilt: null, houseNumber: String(d.houseNumber),
      streetName: hit?.street ?? d.street, streetX: d.x ?? hit?.x ?? null, streetY: d.y ?? hit?.y ?? null,
    };
    const t = Date.now();
    const res = await fetch(`${base}/api/valuation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const ms = Date.now() - t;
    const j: any = await res.json().catch(() => ({}));
    if (i > 0) times.push(ms); // the first request includes route compilation
    if (res.ok) ok++;
    console.log(`${String(ms).padStart(6)} ms  ${res.status}  ${d.street} ${d.houseNumber} → ${j.valuation?.neighborhood ?? j.error} ${j.valuation ? `₪${j.valuation.estimateMid}` : ""}`);
  }
  const s = [...times].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  console.log(`\n${ok}/${sample.length} ok · median ${q(0.5)} ms · p90 ${q(0.9)} ms · max ${s[s.length - 1]} ms (first request excluded)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
