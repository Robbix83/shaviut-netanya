/**
 * scripts/audit-wave0g16-aggregate.ts — Wave 0G-16 Phases 12-15, 18-19:
 * reads every entity result under audit/wave0g16/shadow-output/*.json
 * (produced by audit-wave0g16-citywide-shadow.ts) and produces the
 * citywide scorecard, aggregate summary, completeness distribution,
 * request-efficiency stats, a READ-ONLY canonical comparison, and a
 * neighborhood-label-mismatch audit. READ-ONLY — no new network calls, no
 * canonical writes.
 */
import { promises as fs } from "fs";
import path from "path";
import { assertSafeShadowOutputPath } from "../lib/shadowRebuild";

const SHADOW_DIR = path.join(process.cwd(), "audit/wave0g16/shadow-output");
const OUT_DIR_REL = "audit/wave0g16";
const OUT_DIR = path.join(process.cwd(), OUT_DIR_REL);

function csvEscape(v: any): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function toCsv(rows: any[], columns: string[]): string {
  const lines = [columns.join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvEscape(r[c])).join(","));
  return lines.join("\n") + "\n";
}

async function main() {
  const files = (await fs.readdir(SHADOW_DIR)).filter((f) => f.endsWith(".json") && f !== "manifest.json");
  const entities = await Promise.all(files.map(async (f) => JSON.parse(await fs.readFile(path.join(SHADOW_DIR, f), "utf8"))));
  console.log("ENTITY_RESULT_COUNT=" + entities.length);

  // === Phase 12: per-entity scorecard ===
  const scorecardRows = entities.map((e: any) => {
    const addrTotal = e.uniqueRows?.length ?? e.uniqueTopLevel ?? 0;
    const validAddressRate = addrTotal > 0 ? (e.validAddressRows / addrTotal) : null;
    const streetZeroRate = addrTotal > 0 ? (e.streetZeroRows / addrTotal) : null;
    return {
      SOURCE_ID: e.sourceId, NAME: e.name, OFFICIAL_TOTAL_ROWS: e.officialTotalRows, OFFICIAL_TOTAL_FETCH: e.officialTotalFetch,
      SAFE_SURFACES_USED: e.surfacesUsed.join("|"), RAW_ROWS_FETCHED: e.rawTopLevelRows, UNIQUE_TOP_LEVEL: e.uniqueTopLevel,
      DELTA: e.delta, STATUS: e.status, EARLIEST_DATE: e.earliestDate, LATEST_DATE: e.latestDate,
      NORMALIZATION_DROPS: e.normalizationDrops, PREVDEAL_UNIQUE: e.uniquePrevDealEvents,
      VALID_ADDRESS_RATE: validAddressRate != null ? validAddressRate.toFixed(4) : "",
      STREET_ZERO_RATE: streetZeroRate != null ? streetZeroRate.toFixed(4) : "",
      MINUS_ZERO_ROWS: e.minusZeroRows, NETWORK_REQUESTS: e.networkRequests, ELAPSED_SECONDS: e.elapsedSeconds,
      FAILURE_REASON: e.failureReason ?? "",
    };
  }).sort((a: any, b: any) => (b.OFFICIAL_TOTAL_ROWS ?? 0) - (a.OFFICIAL_TOTAL_ROWS ?? 0));
  const scorecardCols = ["SOURCE_ID", "NAME", "OFFICIAL_TOTAL_ROWS", "OFFICIAL_TOTAL_FETCH", "SAFE_SURFACES_USED", "RAW_ROWS_FETCHED", "UNIQUE_TOP_LEVEL", "DELTA", "STATUS", "EARLIEST_DATE", "LATEST_DATE", "NORMALIZATION_DROPS", "PREVDEAL_UNIQUE", "VALID_ADDRESS_RATE", "STREET_ZERO_RATE", "MINUS_ZERO_ROWS", "NETWORK_REQUESTS", "ELAPSED_SECONDS", "FAILURE_REASON"];
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/citywide_entity_scorecard.csv`);
  await fs.writeFile(path.join(OUT_DIR, "citywide_entity_scorecard.csv"), toCsv(scorecardRows, scorecardCols));
  console.log("WROTE citywide_entity_scorecard.csv");

  // === Phase 13: citywide aggregate ===
  const complete = entities.filter((e: any) => e.status === "COMPLETE");
  const partial = entities.filter((e: any) => e.status === "PARTIAL");
  const failed = entities.filter((e: any) => e.status === "FAILED");
  const officialSum = entities.reduce((s: number, e: any) => s + (e.officialTotalRows ?? 0), 0);
  const uniqueSum = entities.reduce((s: number, e: any) => s + (e.uniqueTopLevel ?? 0), 0);
  const rawPrevDealSum = entities.reduce((s: number, e: any) => s + (e.rawPrevDealEvents ?? 0), 0);
  const uniquePrevDealSum = entities.reduce((s: number, e: any) => s + (e.uniquePrevDealEvents ?? 0), 0);
  const normDropsSum = entities.reduce((s: number, e: any) => s + (e.normalizationDrops ?? 0), 0);

  // === Phase 14: completeness distribution ===
  function pct(e: any): number | null {
    if (!e.officialTotalRows) return null;
    return (e.uniqueTopLevel / e.officialTotalRows) * 100;
  }
  const dist = { at100: 0, from99to100: 0, from95to99: 0, below95: 0 };
  const partialDetail: any[] = [];
  for (const e of entities) {
    const p = pct(e);
    if (p == null) continue;
    if (p >= 100) dist.at100++;
    else if (p >= 99) dist.from99to100++;
    else if (p >= 95) dist.from95to99++;
    else dist.below95++;
    if (e.status === "PARTIAL") {
      partialDetail.push({
        NAME: e.name, SOURCE_ID: e.sourceId, OFFICIAL_TOTAL: e.officialTotalRows, SHADOW_UNIQUE: e.uniqueTopLevel,
        DELTA: e.delta, COVERAGE_PERCENT: p != null ? p.toFixed(2) : "", SURFACES_EXHAUSTED: e.surfacesUsed.join("|"),
      });
    }
  }

  // === Phase 15: request efficiency ===
  const totalRequests = entities.reduce((s: number, e: any) => s + (e.networkRequests ?? 0), 0);
  const totalElapsed = entities.reduce((s: number, e: any) => s + (e.elapsedSeconds ?? 0), 0);
  const avgRequestsPerEntity = entities.length ? totalRequests / entities.length : 0;
  // Classify by the LAST surface actually used (by SURFACE_PLAN order), not
  // by presence/absence of an intermediate surface (ECC code-reviewer +
  // specialist finding): the runner deliberately SKIPS date_desc_2/date_asc_2
  // for entities with officialTotalRows<=500 or officialTotalFetch<=1 — that
  // skip is indistinguishable from "attempted and failed" under a presence
  // check, which would misfile a small entity that legitimately needed a
  // LATER surface (e.g. date_asc_1) into the "afterDesc1" bucket.
  const SURFACE_ORDER = ["date_desc_1", "date_desc_2", "date_asc_1", "date_asc_2", "price_desc_1", "price_asc_1", "rooms_desc_1", "rooms_asc_1"];
  const depthCounts = { afterDesc1: 0, afterDesc2: 0, afterAsc1: 0, afterAsc2: 0, afterAlternate: 0, stillPartial: 0 };
  for (const e of entities) {
    const s: string[] = e.surfacesUsed;
    if (e.status === "PARTIAL" || e.status === "FAILED") { depthCounts.stillPartial++; continue; }
    const lastIdx = Math.max(...s.map((x) => SURFACE_ORDER.indexOf(x)).filter((i) => i >= 0), 0);
    if (lastIdx <= 0) depthCounts.afterDesc1++;
    else if (lastIdx === 1) depthCounts.afterDesc2++;
    else if (lastIdx === 2) depthCounts.afterAsc1++;
    else if (lastIdx === 3) depthCounts.afterAsc2++;
    else depthCounts.afterAlternate++;
  }

  // === Phase 11: property semantics ===
  const dealNatureTotals: Record<string, number> = {};
  let rowsWithDealNature = 0;
  for (const e of entities) {
    for (const [k, v] of Object.entries(e.dealNatureCounts ?? {})) {
      dealNatureTotals[k] = (dealNatureTotals[k] ?? 0) + (v as number);
      if (k !== "∅NONE∅") rowsWithDealNature += v as number;
    }
  }
  const nofeshRows = dealNatureTotals["דירת נופש"] ?? 0;
  const dealNatureCsvRows = Object.entries(dealNatureTotals).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ DEAL_NATURE: k, COUNT: v }));
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/dealnature_summary.csv`);
  await fs.writeFile(path.join(OUT_DIR, "dealnature_summary.csv"), toCsv(dealNatureCsvRows, ["DEAL_NATURE", "COUNT"]));
  console.log("WROTE dealnature_summary.csv");

  // === Phase 10: address quality (citywide) ===
  const totalUniqueRowsAcrossAll = entities.reduce((s: number, e: any) => s + (e.uniqueRows?.length ?? 0), 0);
  const validAddrSum = entities.reduce((s: number, e: any) => s + (e.validAddressRows ?? 0), 0);
  const streetZeroSum = entities.reduce((s: number, e: any) => s + (e.streetZeroRows ?? 0), 0);
  const missingHouseSum = entities.reduce((s: number, e: any) => s + (e.missingHouseRows ?? 0), 0);

  // === Phase 18: canonical comparison (READ-ONLY, transaction-evidence based, NOT neighborhoodId) ===
  const canonical = JSON.parse(await fs.readFile(path.join(process.cwd(), "data/deals.json"), "utf8"));
  function canonKey(d: any): string {
    return `${d.dealDate}|${d.price}|${d.street ?? ""}|${d.houseNumber ?? ""}`;
  }
  const canonMap = new Map<string, any[]>();
  for (const d of canonical) {
    const k = canonKey(d);
    if (!canonMap.has(k)) canonMap.set(k, []);
    canonMap.get(k)!.push(d);
  }
  let shadowMatched = 0;
  let shadowOnly = 0;
  const mismatchCounts = new Map<string, { oldLabel: string; officialLabel: string; count: number }>();
  const matchedCanonKeys = new Set<string>();
  for (const e of entities) {
    for (const row of e.uniqueRows ?? []) {
      const k = canonKey(row);
      const canonRows = canonMap.get(k);
      if (canonRows && canonRows.length > 0) {
        shadowMatched++;
        matchedCanonKeys.add(k);
        for (const cr of canonRows) {
          if (cr.neighborhood && cr.neighborhood !== e.name) {
            const mk = `${cr.neighborhood}→${e.name}`;
            if (!mismatchCounts.has(mk)) mismatchCounts.set(mk, { oldLabel: cr.neighborhood, officialLabel: e.name, count: 0 });
            mismatchCounts.get(mk)!.count++;
          }
        }
      } else {
        shadowOnly++;
      }
    }
  }
  const canonicalOnly = canonical.filter((d: any) => !matchedCanonKeys.has(canonKey(d))).length;

  // Zero-cost staleness check (ECC planner suggestion): compare the latest
  // dealDate on each side. If canonical's max date is materially older than
  // shadow's, that alone would explain most of the shadow-only rows as
  // simply-newer transactions, without needing a bounded manual sample.
  const canonicalDates = canonical.map((d: any) => d.dealDate).filter(Boolean).sort();
  const shadowDatesAll = entities.flatMap((e: any) => (e.uniqueRows ?? []).map((r: any) => r.dealDate)).filter(Boolean).sort();
  const canonicalMaxDate = canonicalDates[canonicalDates.length - 1] ?? null;
  const shadowMaxDate = shadowDatesAll[shadowDatesAll.length - 1] ?? null;
  const canonicalMinDate = canonicalDates[0] ?? null;
  const shadowMinDate = shadowDatesAll[0] ?? null;
  // Two DISTINCT rates (ECC planner finding — an earlier version reported
  // only the shadow-side rate under the misleading label
  // "canonicalMatchedTopLevel", which is a SHADOW-row count, not a
  // canonical-row count; the two differ whenever multiple shadow rows or
  // multiple canonical rows share the same key):
  //   shadow-side:    what fraction of shadow rows found SOME canonical match
  //   canonical-side: what fraction of canonical rows found SOME shadow match
  const canonicalMatchedRows = canonical.length - canonicalOnly;
  const shadowSideMatchRate = totalUniqueRowsAcrossAll > 0 ? (shadowMatched / totalUniqueRowsAcrossAll) : 0;
  const canonicalSideMatchRate = canonical.length > 0 ? (canonicalMatchedRows / canonical.length) : 0;

  const mismatchRows = [...mismatchCounts.values()].sort((a, b) => b.count - a.count)
    .map((m) => ({ OLD_LABEL: m.oldLabel, OFFICIAL_LABEL: m.officialLabel, COUNT: m.count }));
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/neighborhood_label_mismatches.csv`);
  await fs.writeFile(path.join(OUT_DIR, "neighborhood_label_mismatches.csv"), toCsv(mismatchRows, ["OLD_LABEL", "OFFICIAL_LABEL", "COUNT"]));
  console.log("WROTE neighborhood_label_mismatches.csv");

  const summary = {
    officialEntities: entities.length, completeEntities: complete.length, partialEntities: partial.length, failedEntities: failed.length,
    officialTopLevelRowsSum: officialSum, shadowTopLevelUniqueSum: uniqueSum, totalTopLevelDelta: officialSum - uniqueSum,
    rawPrevDealEvents: rawPrevDealSum, uniquePrevDealEvents: uniquePrevDealSum, normalizationDropsSum: normDropsSum,
    totalShadowTransactionEventsTopLevelOnly: uniqueSum,
    totalShadowTransactionEventsCombined: uniqueSum + uniquePrevDealSum,
    completenessDistribution: dist,
    partialEntitiesDetail: partialDetail,
    requestEfficiency: { totalNetworkRequests: totalRequests, totalElapsedSeconds: Number(totalElapsed.toFixed(1)), avgRequestsPerEntity: Number(avgRequestsPerEntity.toFixed(2)), depthDistribution: depthCounts },
    addressQuality: {
      totalUniqueRows: totalUniqueRowsAcrossAll, validAddressRows: validAddrSum, streetZeroRows: streetZeroSum, missingHouseRows: missingHouseSum,
      validAddressRate: totalUniqueRowsAcrossAll ? Number((validAddrSum / totalUniqueRowsAcrossAll).toFixed(4)) : null,
      streetZeroRate: totalUniqueRowsAcrossAll ? Number((streetZeroSum / totalUniqueRowsAcrossAll).toFixed(4)) : null,
      missingHouseRate: totalUniqueRowsAcrossAll ? Number((missingHouseSum / totalUniqueRowsAcrossAll).toFixed(4)) : null,
    },
    propertySemantics: { rowsWithDealNature, distinctDealNatureValues: Object.keys(dealNatureTotals).filter((k) => k !== "∅NONE∅").length, nofeshRows },
    canonicalComparison: {
      canonicalRows: canonical.length, shadowTopLevelRows: totalUniqueRowsAcrossAll, shadowHistoricalPrevDeals: uniquePrevDealSum,
      shadowRowsWithAnyCanonicalMatch: shadowMatched, canonicalRowsWithAnyShadowMatch: canonicalMatchedRows,
      shadowTopLevelOnly: shadowOnly, canonicalOnly,
      shadowSideMatchRate: Number(shadowSideMatchRate.toFixed(4)), canonicalSideMatchRate: Number(canonicalSideMatchRate.toFixed(4)),
      neighborhoodLabelMismatchRows: [...mismatchCounts.values()].reduce((s, m) => s + m.count, 0),
      dateRangeCheck: { canonicalMinDate, canonicalMaxDate, shadowMinDate, shadowMaxDate },
    },
    ambiguousCollisionsTotal: entities.reduce((s: number, e: any) => s + (e.ambiguousCollisions ?? 0), 0),
    minusZeroRowsTotal: entities.reduce((s: number, e: any) => s + (e.minusZeroRows ?? 0), 0),
    minusZeroCollisionsTotal: entities.reduce((s: number, e: any) => s + (e.minusZeroCollisions ?? 0), 0),
  };
  assertSafeShadowOutputPath(`${OUT_DIR_REL}/citywide_summary.json`);
  await fs.writeFile(path.join(OUT_DIR, "citywide_summary.json"), JSON.stringify(summary, null, 2));
  console.log("WROTE citywide_summary.json");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => { console.error("AGGREGATE_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
