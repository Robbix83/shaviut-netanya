/**
 * scripts/build-street-index-extra.ts
 * Streets that have real sales in the dataset but are missing from data/street-index.json
 * (the street search offers only that file — e.g. שד' ניצה was not searchable at all).
 * Writes data/street-index-extra.json, which /api/autocomplete and /api/resolve-address read
 * next to street-index.json. Built from the deals only; nothing is invented.
 *
 *   npx tsx scripts/build-street-index-extra.ts [--data data/v2-candidate/deals-v2.json] [--min 2]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { withNeighborhoodName } from "../lib/neighborhoodNames";
import type { Deal } from "../lib/types";

const ROOT = path.resolve(__dirname, "..");
const arg = (n: string, f: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : f; };
const dataPath = path.resolve(ROOT, arg("data", "data/v2-candidate/deals-v2.json"));
const MIN_DEALS = Number(arg("min", "2"));

const STREET_PREFIX = /^(שד'?|שדרות|רחוב|רח')\s*/i;
const norm = (s: string) => s.replace(STREET_PREFIX, "").trim();
/** same words in any order ("שפירא אברהם" = "אברהם שפירא") — how /api/autocomplete matches */
const tokenKey = (s: string) => norm(s).split(/\s+/).filter(Boolean).sort().join(" ");
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

const index: { street: string }[] = JSON.parse(readFileSync(path.join(ROOT, "data/street-index.json"), "utf8"));
const known = new Set(index.filter((s) => s.street).flatMap((s) => [norm(s.street), tokenKey(s.street)]));

const deals: Deal[] = (JSON.parse(readFileSync(dataPath, "utf8")) as Deal[]).map(withNeighborhoodName);
const groups = new Map<string, Deal[]>();
for (const d of deals) {
  if (!d.street || d.street === "0" || /^\d+$/.test(d.street.trim())) continue;
  const k = norm(d.street);
  if (!k || known.has(k) || known.has(tokenKey(d.street))) continue;
  (groups.get(k) ?? groups.set(k, []).get(k)!).push(d);
}

const extra = [...groups.entries()]
  .filter(([, ds]) => ds.length >= MIN_DEALS)
  .map(([, ds]) => {
    const count = (key: (d: Deal) => string) => {
      const m = new Map<string, number>();
      for (const d of ds) m.set(key(d), (m.get(key(d)) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
    };
    const street = count((d) => d.street!.trim()); // the spelling the deals use most
    const neighborhoodId = count((d) => d.neighborhoodId);
    const located = ds.filter((d) => d.x != null && d.y != null);
    return {
      street,
      code: null,
      neighborhoodId,
      neighborhoodName: ds.find((d) => d.neighborhoodId === neighborhoodId)?.neighborhood ?? "",
      x: located.length ? Math.round(median(located.map((d) => d.x!))) : null,
      y: located.length ? Math.round(median(located.map((d) => d.y!))) : null,
      source: "deals",
      deals: ds.length,
    };
  })
  .sort((a, b) => b.deals - a.deals);

writeFileSync(path.join(ROOT, "data/street-index-extra.json"), JSON.stringify(extra, null, 1));
console.log(`${extra.length} streets added (≥${MIN_DEALS} deals each); top: ${extra.slice(0, 12).map((s) => `${s.street} (${s.deals})`).join(", ")}`);
