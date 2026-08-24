/**
 * scripts/audit-wave0g1.ts — READ-ONLY citywide deal-data completeness audit.
 * Reads data/deals.json and data/street-index.json / netanya-streets-raw.json.
 * Writes only under audit/wave0g1/. No mutation of any canonical source.
 */
import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const OUT_DIR = path.join(process.cwd(), "audit", "wave0g1");

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvEscape(r[c])).join(","));
  return lines.join("\n") + "\n";
}

const STREET_PREFIX = /^(שד'?|שדרות|רחוב|רח')\s*/i;
const normSt = (s: string) => s.replace(STREET_PREFIX, "").trim();

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const deals: any[] = JSON.parse(await fs.readFile(path.join(DATA_DIR, "deals.json"), "utf8"));
  const streetIndexRaw: any[] = JSON.parse(await fs.readFile(path.join(DATA_DIR, "street-index.json"), "utf8"));
  const municipalRaw: any[] = JSON.parse(await fs.readFile(path.join(DATA_DIR, "netanya-streets-raw.json"), "utf8"));
  const neighborhoods: any[] = JSON.parse(await fs.readFile(path.join(DATA_DIR, "neighborhoods.json"), "utf8"));

  const today = "2026-08-24"; // session date, fixed constant (Date.now() unreliable in some contexts here)
  const fiveYearsAgo = "2021-08-24";

  // ---------- Phase 2: yearly counts ----------
  const yearMap = new Map<string, any[]>();
  for (const d of deals) {
    const y = (d.dealDate || "").slice(0, 4);
    if (!y) continue;
    if (!yearMap.has(y)) yearMap.set(y, []);
    yearMap.get(y)!.push(d);
  }
  const years = [...yearMap.keys()].sort();
  const yearlyRows: Record<string, unknown>[] = [];
  let prevTotal: number | null = null;
  for (const y of years) {
    const rows = yearMap.get(y)!;
    const apt = rows.filter((d) => d.propertyType === "apartment").length;
    const house = rows.filter((d) => d.propertyType === "house").length;
    const land = rows.filter((d) => d.propertyType === "land").length;
    const other = rows.length - apt - house - land;
    const validStreet = rows.filter((d) => d.street && d.street !== "0" && String(d.street).trim() !== "").length;
    const validHn = rows.filter((d) => d.houseNumber && String(d.houseNumber).trim() !== "").length;
    const street0 = rows.filter((d) => d.street === "0").length;
    const missingStreet = rows.filter((d) => !d.street || String(d.street).trim() === "").length;
    const yoy = prevTotal != null ? (((rows.length - prevTotal) / prevTotal) * 100).toFixed(1) : "";
    yearlyRows.push({
      YEAR: y, TOTAL_DEALS: rows.length, APARTMENT: apt, HOUSE: house, LAND: land, OTHER: other,
      ROWS_WITH_VALID_STREET: validStreet, ROWS_WITH_VALID_HOUSE_NUMBER: validHn,
      ROWS_WITH_STREET_0: street0, ROWS_WITH_MISSING_STREET: missingStreet,
      YEAR_OVER_YEAR_CHANGE_PERCENT: yoy,
    });
    prevTotal = rows.length;
  }
  await fs.writeFile(path.join(OUT_DIR, "yearly_counts.csv"), toCsv(yearlyRows, [
    "YEAR","TOTAL_DEALS","APARTMENT","HOUSE","LAND","OTHER","ROWS_WITH_VALID_STREET","ROWS_WITH_VALID_HOUSE_NUMBER","ROWS_WITH_STREET_0","ROWS_WITH_MISSING_STREET","YEAR_OVER_YEAR_CHANGE_PERCENT",
  ]));
  console.log("=== YEARLY (2015-2026) ===");
  for (const r of yearlyRows.filter((r) => (r.YEAR as string) >= "2015")) console.log(JSON.stringify(r));

  // ---------- Phase 3: monthly counts 2021-2026 ----------
  const monthMap = new Map<string, number>();
  for (const d of deals) {
    const ym = (d.dealDate || "").slice(0, 7);
    if (!ym || ym < "2021-01") continue;
    monthMap.set(ym, (monthMap.get(ym) || 0) + 1);
  }
  const months = [...monthMap.keys()].sort();
  const monthlyRows = months.map((m) => ({ YYYY_MM: m, TOTAL_DEALS: monthMap.get(m) }));
  await fs.writeFile(path.join(OUT_DIR, "monthly_counts.csv"), toCsv(monthlyRows, ["YYYY_MM", "TOTAL_DEALS"]));
  console.log("\n=== MONTHLY 2021-2026 (all) ===");
  for (const r of monthlyRows) console.log(r.YYYY_MM, r.TOTAL_DEALS);

  // ---------- Phase 4: property type / dealNature distribution ----------
  const dealNatureMap = new Map<string, { count: number; first: string; last: string }>();
  for (const d of deals) {
    const dn = d.dealNature || "(null)";
    const dt = d.dealDate || "";
    if (!dealNatureMap.has(dn)) dealNatureMap.set(dn, { count: 0, first: dt, last: dt });
    const e = dealNatureMap.get(dn)!;
    e.count++;
    if (dt && dt < e.first) e.first = dt;
    if (dt && dt > e.last) e.last = dt;
  }
  const dealNatureRows = [...dealNatureMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([k, v]) => ({ DEAL_NATURE: k, COUNT: v.count, FIRST_DATE: v.first, LAST_DATE: v.last }));
  console.log("\n=== DEAL_NATURE DISTRIBUTION (distinct raw values) ===");
  for (const r of dealNatureRows) console.log(JSON.stringify(r));
  const vacationRelated = dealNatureRows.filter((r) => /נופש|מלונ|תיירות/.test(r.DEAL_NATURE as string));
  console.log("VACATION/HOTEL-RELATED dealNature values:", JSON.stringify(vacationRelated));

  // ---------- Phase 5/6: street universe & distribution ----------
  const municipalCodes = new Map<string, number>();
  for (const m of municipalRaw) if (m.name) municipalCodes.set(m.name, m.code);
  const officialStreetCount = municipalRaw.length;
  const officialCodedCount = municipalRaw.filter((m) => m.code != null).length;

  const dealStreetsRaw = new Set(deals.map((d) => d.street).filter((s) => s && s !== "0"));
  const dealStreetsNorm = new Set([...dealStreetsRaw].map((s) => normSt(s as string)));

  // official normalized set (from municipal raw list — the true registry)
  const officialNorm = new Set(municipalRaw.filter((m) => m.name).map((m) => normSt(m.name)));
  const officialWithAnyDeal = [...officialNorm].filter((s) => dealStreetsNorm.has(s));
  const officialWithNoDeal = [...officialNorm].filter((s) => !dealStreetsNorm.has(s));

  const dealStreetsNorm5y = new Set(
    deals.filter((d) => d.street && d.street !== "0" && d.dealDate >= fiveYearsAgo).map((d) => normSt(d.street)),
  );
  const officialWithDeal5y = [...officialNorm].filter((s) => dealStreetsNorm5y.has(s));
  const officialWithZeroDeal5y = [...officialNorm].filter((s) => !dealStreetsNorm5y.has(s));

  console.log("\n=== STREET UNIVERSE ===");
  console.log("OFFICIAL_STREET_COUNT=", officialStreetCount);
  console.log("OFFICIAL_CODED_STREET_COUNT=", officialCodedCount);
  console.log("DEAL_STREET_DISTINCT_RAW=", dealStreetsRaw.size);
  console.log("DEAL_STREET_DISTINCT_NORMALIZED=", dealStreetsNorm.size);
  console.log("OFFICIAL_STREETS_WITH_ANY_DEAL=", officialWithAnyDeal.length, "/", officialNorm.size,
    "(" + ((officialWithAnyDeal.length / officialNorm.size) * 100).toFixed(1) + "%)");
  console.log("OFFICIAL_STREETS_WITH_NO_DEALS_EVER=", officialWithNoDeal.length,
    "(" + ((officialWithNoDeal.length / officialNorm.size) * 100).toFixed(1) + "%)");
  console.log("OFFICIAL_STREETS_WITH_DEAL_LAST_5Y=", officialWithDeal5y.length,
    "(" + ((officialWithDeal5y.length / officialNorm.size) * 100).toFixed(1) + "%)");
  console.log("OFFICIAL_STREETS_WITH_ZERO_DEALS_LAST_5Y=", officialWithZeroDeal5y.length,
    "(" + ((officialWithZeroDeal5y.length / officialNorm.size) * 100).toFixed(1) + "%)");

  // per-street distribution (by normalized name)
  const streetGroups = new Map<string, any[]>();
  for (const d of deals) {
    if (!d.street || d.street === "0") continue;
    const key = normSt(d.street);
    if (!streetGroups.has(key)) streetGroups.set(key, []);
    streetGroups.get(key)!.push(d);
  }
  const streetRows = [...streetGroups.entries()].map(([norm, rows]) => {
    const dates = rows.map((d) => d.dealDate).filter(Boolean).sort();
    const last5y = rows.filter((d) => d.dealDate >= fiveYearsAgo).length;
    const hns = new Set(rows.map((d) => d.houseNumber).filter(Boolean));
    const placeholder = rows.filter((d) => d.street === "0").length; // always 0 here since we excluded street="0" above; kept for schema
    const types = [...new Set(rows.map((d) => d.propertyType))].join("|");
    const code = municipalCodes.get(rows[0].street) ?? (municipalCodes.has(norm) ? municipalCodes.get(norm) : "") ?? "";
    return {
      STREET: norm, MUNICIPAL_CODE_IF_AVAILABLE: code, TOTAL_DEALS: rows.length, DEALS_LAST_5Y: last5y,
      FIRST_DEAL_DATE: dates[0] || "", LAST_DEAL_DATE: dates[dates.length - 1] || "",
      DISTINCT_HOUSE_NUMBERS: hns.size, PLACEHOLDER_STREET_ROWS: placeholder, PROPERTY_TYPES: types,
    };
  }).sort((a, b) => (b.TOTAL_DEALS as number) - (a.TOTAL_DEALS as number));
  await fs.writeFile(path.join(OUT_DIR, "street_coverage.csv"), toCsv(streetRows, [
    "STREET","MUNICIPAL_CODE_IF_AVAILABLE","TOTAL_DEALS","DEALS_LAST_5Y","FIRST_DEAL_DATE","LAST_DEAL_DATE","DISTINCT_HOUSE_NUMBERS","PLACEHOLDER_STREET_ROWS","PROPERTY_TYPES",
  ]));
  console.log("\n=== TOP 25 STREETS BY TOTAL DEALS ===");
  for (const r of streetRows.slice(0, 25)) console.log(JSON.stringify(r));
  console.log("\n=== BOTTOM 15 (non-zero) STREETS ===");
  for (const r of streetRows.slice(-15)) console.log(JSON.stringify(r));
  console.log("\n=== OFFICIAL STREETS WITH ZERO DEALS EVER (first 40 of", officialWithNoDeal.length, ") ===");
  console.log(JSON.stringify(officialWithNoDeal.slice(0, 40)));

  // suspicious: street==="0" placeholder count and its own row
  const streetZeroRows = deals.filter((d) => d.street === "0");
  console.log("\nSTREET_LITERAL_ZERO_TOTAL_ROWS=", streetZeroRows.length);

  // streets with only 1-2 house numbers despite many deals (flag)
  const suspiciousFewHN = streetRows.filter((r) => (r.TOTAL_DEALS as number) >= 10 && (r.DISTINCT_HOUSE_NUMBERS as number) <= 2);
  console.log("\n=== SUSPICIOUS: >=10 deals but <=2 distinct house numbers (", suspiciousFewHN.length, ") ===");
  for (const r of suspiciousFewHN.slice(0, 20)) console.log(JSON.stringify(r));

  // streets whose last deal is years ago despite being a real official street
  const staleStreets = streetRows.filter((r) => (r.LAST_DEAL_DATE as string) && (r.LAST_DEAL_DATE as string) < "2020-01-01" && (r.TOTAL_DEALS as number) >= 5);
  console.log("\n=== STREETS WHOSE DATA STOPS BEFORE 2020 (>=5 total deals) (", staleStreets.length, ") ===");
  for (const r of staleStreets.slice(0, 20)) console.log(JSON.stringify(r));

  // ---------- Phase 7: address/data quality ----------
  const total = deals.length;
  const validStreetAll = deals.filter((d) => d.street && d.street !== "0" && String(d.street).trim() !== "").length;
  const streetZeroAll = deals.filter((d) => d.street === "0").length;
  const nullStreetAll = deals.filter((d) => d.street == null).length;
  const emptyStreetAll = deals.filter((d) => d.street != null && String(d.street).trim() === "" && d.street !== "0").length;
  const validHnAll = deals.filter((d) => d.houseNumber && String(d.houseNumber).trim() !== "").length;
  const nullHnAll = deals.filter((d) => d.houseNumber == null).length;
  const hnZeroAll = deals.filter((d) => d.houseNumber === "0").length;
  const validPrice = deals.filter((d) => d.price != null && d.price > 0).length;
  const validArea = deals.filter((d) => d.areaSqm != null && d.areaSqm > 0).length;
  const validRooms = deals.filter((d) => d.rooms != null).length;
  const validCoords = deals.filter((d) => d.x != null && d.y != null).length;
  const validNeigh = deals.filter((d) => d.neighborhoodId != null && String(d.neighborhoodId).trim() !== "").length;

  const pct = (n: number) => ((n / total) * 100).toFixed(2) + "%";
  console.log("\n=== GLOBAL ADDRESS/DATA QUALITY ===");
  console.log("TOTAL_ROWS=", total);
  console.log("VALID_STREET_ROWS=", validStreetAll, pct(validStreetAll));
  console.log("STREET_LITERAL_ZERO_ROWS=", streetZeroAll, pct(streetZeroAll));
  console.log("NULL_STREET_ROWS=", nullStreetAll, pct(nullStreetAll));
  console.log("EMPTY_STREET_ROWS=", emptyStreetAll, pct(emptyStreetAll));
  console.log("VALID_HOUSE_NUMBER_ROWS=", validHnAll, pct(validHnAll));
  console.log("NULL_HOUSE_NUMBER_ROWS=", nullHnAll, pct(nullHnAll));
  console.log("HOUSE_NUMBER_ZERO_ROWS=", hnZeroAll, pct(hnZeroAll));
  console.log("VALID_PRICE_ROWS=", validPrice, pct(validPrice));
  console.log("VALID_AREA_ROWS=", validArea, pct(validArea));
  console.log("VALID_ROOMS_ROWS=", validRooms, pct(validRooms));
  console.log("VALID_COORDINATES_ROWS=", validCoords, pct(validCoords));
  console.log("VALID_NEIGHBORHOOD_ID_ROWS=", validNeigh, pct(validNeigh));

  const qualityByYearRows: Record<string, unknown>[] = [];
  for (const y of years.filter((y) => y >= "2021")) {
    const rows = yearMap.get(y)!;
    const t = rows.length;
    const vs = rows.filter((d) => d.street && d.street !== "0" && String(d.street).trim() !== "").length;
    const s0 = rows.filter((d) => d.street === "0").length;
    const vhn = rows.filter((d) => d.houseNumber && String(d.houseNumber).trim() !== "").length;
    const vp = rows.filter((d) => d.price != null && d.price > 0).length;
    const va = rows.filter((d) => d.areaSqm != null && d.areaSqm > 0).length;
    const vr = rows.filter((d) => d.rooms != null).length;
    const vc = rows.filter((d) => d.x != null && d.y != null).length;
    qualityByYearRows.push({
      YEAR: y, TOTAL: t,
      VALID_STREET_PCT: ((vs / t) * 100).toFixed(1),
      STREET_0_PCT: ((s0 / t) * 100).toFixed(1),
      VALID_HOUSE_NUMBER_PCT: ((vhn / t) * 100).toFixed(1),
      VALID_PRICE_PCT: ((vp / t) * 100).toFixed(1),
      VALID_AREA_PCT: ((va / t) * 100).toFixed(1),
      VALID_ROOMS_PCT: ((vr / t) * 100).toFixed(1),
      VALID_COORDS_PCT: ((vc / t) * 100).toFixed(1),
    });
  }
  await fs.writeFile(path.join(OUT_DIR, "data_quality.csv"), toCsv(qualityByYearRows, [
    "YEAR","TOTAL","VALID_STREET_PCT","STREET_0_PCT","VALID_HOUSE_NUMBER_PCT","VALID_PRICE_PCT","VALID_AREA_PCT","VALID_ROOMS_PCT","VALID_COORDS_PCT",
  ]));
  console.log("\n=== QUALITY BY YEAR 2021-2026 ===");
  for (const r of qualityByYearRows) console.log(JSON.stringify(r));

  // ---------- Phase 8: neighborhood coverage ----------
  const neighGroups = new Map<string, any[]>();
  for (const d of deals) {
    const id = d.neighborhoodId || "(none)";
    if (!neighGroups.has(id)) neighGroups.set(id, []);
    neighGroups.get(id)!.push(d);
  }
  const neighRows = [...neighGroups.entries()].map(([id, rows]) => {
    const name = neighborhoods.find((n) => String(n.id) === String(id))?.name || rows[0]?.neighborhood || "(unknown)";
    const last5y = rows.filter((d) => d.dealDate >= fiveYearsAgo).length;
    const streets = new Set(rows.map((d) => d.street).filter((s) => s && s !== "0"));
    const hns = new Set(rows.map((d) => d.houseNumber).filter(Boolean));
    const street0Count = rows.filter((d) => d.street === "0").length;
    return {
      NEIGHBORHOOD: name, NEIGHBORHOOD_ID: id, TOTAL_DEALS: rows.length, DEALS_LAST_5Y: last5y,
      DISTINCT_STREETS: streets.size, DISTINCT_HOUSE_NUMBERS: hns.size,
      STREET_0_COUNT: street0Count, STREET_0_PCT: ((street0Count / rows.length) * 100).toFixed(1),
    };
  }).sort((a, b) => (b.TOTAL_DEALS as number) - (a.TOTAL_DEALS as number));
  console.log("\n=== NEIGHBORHOOD COVERAGE ===");
  for (const r of neighRows) console.log(JSON.stringify(r));
  const heavyZeroNeigh = neighRows.filter((r) => parseFloat(r.STREET_0_PCT as string) >= 20);
  console.log("\n=== NEIGHBORHOODS WITH >=20% street=0 rows ===");
  for (const r of heavyZeroNeigh) console.log(JSON.stringify(r));

  // ---------- Phase 9: concentration ----------
  const sortedByCount = [...streetRows].sort((a, b) => (b.TOTAL_DEALS as number) - (a.TOTAL_DEALS as number));
  const totalStreetDeals = sortedByCount.reduce((s, r) => s + (r.TOTAL_DEALS as number), 0);
  const top10 = sortedByCount.slice(0, 10).reduce((s, r) => s + (r.TOTAL_DEALS as number), 0);
  const top25 = sortedByCount.slice(0, 25).reduce((s, r) => s + (r.TOTAL_DEALS as number), 0);
  const top50 = sortedByCount.slice(0, 50).reduce((s, r) => s + (r.TOTAL_DEALS as number), 0);
  const counts = sortedByCount.map((r) => r.TOTAL_DEALS as number).sort((a, b) => a - b);
  const pctile = (p: number) => counts[Math.floor((p / 100) * (counts.length - 1))];
  console.log("\n=== CONCENTRATION ===");
  console.log("TOTAL_STREETS_WITH_DEALS=", sortedByCount.length, "TOTAL_STREET_DEALS=", totalStreetDeals);
  console.log("TOP_10_STREETS_PCT=", ((top10 / totalStreetDeals) * 100).toFixed(1) + "%");
  console.log("TOP_25_STREETS_PCT=", ((top25 / totalStreetDeals) * 100).toFixed(1) + "%");
  console.log("TOP_50_STREETS_PCT=", ((top50 / totalStreetDeals) * 100).toFixed(1) + "%");
  console.log("MEDIAN_DEALS_PER_STREET=", pctile(50));
  console.log("P25=", pctile(25), "P75=", pctile(75), "P90=", pctile(90), "MAX=", counts[counts.length - 1]);

  // ---------- Phase 10: duplicate/truncation checks ----------
  const idCounts = new Map<string, number>();
  for (const d of deals) idCounts.set(d.id, (idCounts.get(d.id) || 0) + 1);
  const dupIds = [...idCounts.entries()].filter(([, c]) => c > 1);
  console.log("\n=== DUPLICATE ID CHECK === duplicate ids:", dupIds.length);

  const exactDupKey = new Map<string, number>();
  for (const d of deals) {
    const k = [d.dealDate, d.price, d.areaSqm, d.street, d.houseNumber, d.neighborhoodId].join("|");
    exactDupKey.set(k, (exactDupKey.get(k) || 0) + 1);
  }
  const exactDups = [...exactDupKey.entries()].filter(([, c]) => c > 1);
  console.log("EXACT date+price+area+street+houseNumber+neighborhood duplicate groups:", exactDups.length,
    "extra rows:", exactDups.reduce((s, [, c]) => s + (c - 1), 0));

  // per-neighborhood row counts near 500/1000 boundaries (PostgREST-style page caps)
  const neighCountsArr = [...neighGroups.entries()].map(([id, rows]) => ({ id, count: rows.length }));
  const near500 = neighCountsArr.filter((n) => n.count >= 490 && n.count <= 510 && n.count !== 500);
  const exactly500or1000 = neighCountsArr.filter((n) => n.count === 500 || n.count === 1000);
  console.log("Neighborhoods with count exactly 500 or 1000:", JSON.stringify(exactly500or1000));
  console.log("Neighborhoods with count near 500 (490-510, not exactly 500):", JSON.stringify(near500));

  console.log("\nDONE");
}

main().catch((e) => { console.error("AUDIT_ERROR=" + (e instanceof Error ? e.stack : String(e))); process.exit(1); });
