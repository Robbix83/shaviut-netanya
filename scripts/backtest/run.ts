/**
 * scripts/backtest/run.ts — replay real Netanya sales as valuation searches.
 *
 *   npx tsx scripts/backtest/run.ts --label baseline [--track engine|pipeline] [--asof sale|today]
 *                                   [--split dev|test|all] [--size all|N] [--seed N]
 *
 * Each eligible sale becomes one search through the real server path (resolveAndValuate → valuate),
 * on an in-memory copy of the dataset, with no network (govmap geocoding off: the sale's own
 * coordinates stand in for a successful browser geocode).
 *
 *  track engine   — the engine gets the sale's true neighbourhood id and street name (an oracle input).
 *  track pipeline — the engine gets what the browser sends: the neighbourhood id and street label of
 *                   the matching data/street-index.json entry (what /api/autocomplete hands the wizard).
 *  asof sale      — leakage-safe: the engine sees only deals dated before the sale, and its time
 *                   windows count back from the sale date.
 *  asof today     — the engine as production runs it today (windows from today); only the sale
 *                   itself is hidden. Results drift with the calendar.
 *
 * Output: audit/backtest/runs/<label>/results.json (+ summary.md). Never writes leads or the DB.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { MemoryStore, setStoreForTesting } from "../../lib/store";
import { resolveAndValuate } from "../../lib/valuationService";
import { withNeighborhoodName, withNeighborhoodTitle } from "../../lib/neighborhoodNames";
import type { Deal, Neighborhood } from "../../lib/types";
import {
  drawSample, metrics, breakdown, priceBand, formatMetricsTable,
  type BacktestRow, type Track, type AsOfMode, type Split,
} from "./core";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(__dirname, "../..");
const label = arg("label", "run");
const track = arg("track", "engine") as Track;
const asOfMode = arg("asof", "sale") as AsOfMode;
const split = arg("split", "dev") as Split;
const sizeArg = arg("size", "all");
const seed = Number(arg("seed", "20261027"));
const dataPath = path.resolve(ROOT, arg("data", "data/v2-candidate/deals-v2.json"));
const neighPath = path.resolve(ROOT, arg("neighborhoods", "data/v2-candidate/neighborhoods-v2.json"));
const outDir = path.resolve(ROOT, arg("out", `audit/backtest/runs/${label}`));

const STREET_PREFIX = /^(שד'?|שדרות|רחוב|רח')\s*/i;
const norm = (s: string) => s.replace(STREET_PREFIX, "").trim();

async function main() {
  if (!existsSync(dataPath)) throw new Error(`dataset not found: ${dataPath}`);
  const raw = readFileSync(dataPath);
  const sha256 = createHash("sha256").update(raw).digest("hex");
  const manifestPath = path.join(path.dirname(dataPath), "manifest.json");
  const manifestSha = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")).sha256 : null;
  const deals: Deal[] = (JSON.parse(raw.toString("utf8")) as Deal[]).map(withNeighborhoodName);
  const neighborhoods: Neighborhood[] = (JSON.parse(readFileSync(neighPath, "utf8")) as Neighborhood[]).map(withNeighborhoodTitle);
  const lastDate = deals.reduce((m, d) => (d.dealDate > m ? d.dealDate : m), "");

  const store = new MemoryStore(deals, neighborhoods);
  let allDealsCalls = 0;
  const getAll = store.getAllDeals.bind(store);
  store.getAllDeals = async () => { allDealsCalls++; return getAll(); };
  setStoreForTesting(store);

  // what /api/autocomplete offers: data/street-index.json (exact name first, then without the שד'/רחוב prefix)
  // (+ data/street-index-extra.json when present), matched by exact name, then without the prefix,
  // then by the same words in any order — the way /api/autocomplete finds them
  const extraPath = path.join(ROOT, "data/street-index-extra.json");
  const index: { street: string; neighborhoodId: string; x: number | null; y: number | null }[] = [
    ...JSON.parse(readFileSync(path.join(ROOT, "data/street-index.json"), "utf8")),
    ...(existsSync(extraPath) && !process.argv.includes("--no-extra") ? JSON.parse(readFileSync(extraPath, "utf8")) : []),
  ];
  const tokens = (s: string) => norm(s).split(/\s+/).filter(Boolean).sort().join(" ");
  const byName = new Map<string, (typeof index)[number]>();
  const byNorm = new Map<string, (typeof index)[number]>();
  const byTokens = new Map<string, (typeof index)[number]>();
  for (const s of index) {
    if (!s.street || !s.neighborhoodId) continue;
    if (!byName.has(s.street)) byName.set(s.street, s);
    if (!byNorm.has(norm(s.street))) byNorm.set(norm(s.street), s);
    if (!byTokens.has(tokens(s.street))) byTokens.set(tokens(s.street), s);
  }

  const sample = drawSample(deals, {
    lastDate, split, seed, size: sizeArg === "all" ? "all" : Number(sizeArg),
  });

  const rows: BacktestRow[] = [];
  const t0 = Date.now();
  for (const d of sample.rows) {
    const type = d.propertyType ?? "apartment";
    const base: BacktestRow = {
      id: d.id, date: d.dealDate, type, neighborhoodId: d.neighborhoodId, neighborhood: d.neighborhood ?? null,
      street: d.street ?? null, house: d.houseNumber ?? null, rooms: d.rooms ?? null, area: d.areaSqm ?? null,
      plot: d.plotSqm ?? null, floor: d.floor ?? null, year: d.yearBuilt && d.yearBuilt > 1900 ? d.yearBuilt : null,
      price: d.price, status: "ok", getAllDealsCalls: 0, ms: 0,
    };

    let neighborhoodId = d.neighborhoodId;
    let streetName = d.street!;
    let streetX = d.x ?? null;
    let streetY = d.y ?? null;
    if (track === "pipeline") {
      const hit = byName.get(d.street!) ?? byNorm.get(norm(d.street!)) ?? byTokens.get(tokens(d.street!));
      if (!hit) { rows.push({ ...base, status: "street_not_in_index" }); continue; }
      neighborhoodId = String(hit.neighborhoodId);
      streetName = hit.street;
      streetX = d.x ?? hit.x;
      streetY = d.y ?? hit.y;
    }

    store.hide.clear();
    store.hide.add(d.id); // the engine must never see the sale it is asked about
    const callsBefore = allDealsCalls;
    const started = Date.now();
    try {
      const out = await resolveAndValuate({
        neighborhoodId,
        propertyType: type as "apartment" | "house" | "land",
        rooms: type === "land" ? null : d.rooms ?? null,
        areaSqm: type === "land" ? null : d.areaSqm ?? null,
        plotSqm: type === "apartment" ? null : d.plotSqm ?? null,
        floor: type === "apartment" ? d.floor ?? null : null,
        yearBuilt: base.year,
        houseNumber: String(d.houseNumber),
        streetName,
        streetX,
        streetY,
        asOf: asOfMode === "sale" ? d.dealDate : null,
      }, { geocode: false });
      const ms = Date.now() - started;
      const calls = allDealsCalls - callsBefore;
      if (!out.ok) {
        rows.push({ ...base, status: out.error === "no_match" ? "no_match" : "insufficient", ms, getAllDealsCalls: calls });
        continue;
      }
      const v = out.valuation;
      rows.push({
        ...base, ms, getAllDealsCalls: calls,
        low: v.estimateLow, mid: v.estimateMid, high: v.estimateHigh,
        errPct: v.estimateMid > 0 ? (v.estimateMid - d.price) / d.price : undefined,
        inRange: v.estimateMid > 0 ? d.price >= v.estimateLow && d.price <= v.estimateHigh : undefined,
        confidence: v.confidence, scope: v.compSearchScope ?? null, basedOn: v.basedOnDeals,
        windowMonths: v.windowMonths, manualReview: !!v.manualReview, usedNeighborhoodId: out.neighborhoodId,
      });
    } catch (e) {
      rows.push({ ...base, status: "error", err: String((e as Error)?.message ?? e), ms: Date.now() - started });
    }
  }
  store.hide.clear();

  const meta = {
    label, track, asOfMode, split, seed, size: sizeArg,
    dataset: path.relative(ROOT, dataPath).replace(/\\/g, "/"), sha256, manifestShaMatches: manifestSha ? manifestSha === sha256 : null,
    rows: deals.length, lastDate, evaluationFrom: sample.fromISO, splitAt: sample.splitISO,
    candidates: sample.candidates, eligible: sample.rows.length + 0, excluded: sample.excluded,
    seconds: Math.round((Date.now() - t0) / 1000), ranAt: new Date().toISOString(),
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ meta, rows }, null, 1));

  const conf = (r: BacktestRow) => r.confidence ?? "—";
  const summary = [
    `# Backtest — ${label}`,
    "",
    "```json",
    JSON.stringify(meta, null, 2),
    "```",
    "",
    "## Overall",
    formatMetricsTable({ all: metrics(rows) }),
    "",
    "## Existing homes vs off-plan sales (built after the sale year)",
    formatMetricsTable(breakdown(rows, (r) => (r.year != null && r.year > Number(r.date.slice(0, 4)) ? "off-plan" : "existing"))),
    "",
    "## By property type",
    formatMetricsTable(breakdown(rows, (r) => r.type)),
    "",
    "## By comparable tier (scope)",
    formatMetricsTable(breakdown(rows.filter((r) => r.status === "ok"), (r) => r.scope ?? "—")),
    "",
    "## By confidence",
    formatMetricsTable(breakdown(rows.filter((r) => r.status === "ok"), conf)),
    "",
    "## By price band (apartments)",
    formatMetricsTable(breakdown(rows.filter((r) => r.type === "apartment"), (r) => priceBand(r.price))),
    "",
    "## By neighbourhood (≥15 searches)",
    formatMetricsTable(Object.fromEntries(
      Object.entries(breakdown(rows, (r) => r.neighborhood ?? "—")).filter(([, m]) => m.searches >= 15),
    )),
    "",
  ].join("\n");
  writeFileSync(path.join(outDir, "summary.md"), summary);
  console.log(`${label}: ${rows.length} searches in ${meta.seconds}s → ${path.relative(ROOT, outDir)}`);
  console.log(formatMetricsTable({ [label]: metrics(rows) }));
  setStoreForTesting(null);
}

main().catch((e) => { console.error(e); process.exit(1); });
