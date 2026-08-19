/**
 * scripts/fetch-cbs.ts
 * npm run fetch:cbs
 *
 * מוריד נתוני מפקד 2022 לנתניה (63 אזורים סטטיסטיים + עיר כוללת)
 * מ-data.gov.il (CKAN API) ושומר ב-data/cbs-netanya.json.
 *
 * ⚠️ Windows: נדרש --ssl-no-revoke (ראו package.json).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { writeFileSync } from "fs";
import path from "path";
import type { CbsRaw } from "@/lib/cbs";

const RESOURCE_ID = "9a9e085f-3bc8-41df-b15f-be0daaf99e30"; // מפקד 2022 — יישובים ואזורים סטטיסטיים
const NETANYA_CODE = "7400";

async function fetchPage(offset: number): Promise<any[]> {
  const url =
    `https://data.gov.il/api/3/action/datastore_search` +
    `?resource_id=${RESOURCE_ID}&q=${NETANYA_CODE}&limit=100&offset=${offset}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "shaviut-netanya-cbs-fetcher/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return (j.result?.records ?? []).filter(
    (r: any) => String(r.LocalityCode) === NETANYA_CODE,
  );
}

function normalise(r: any): CbsRaw {
  return {
    statArea:    r.StatArea ? Number(r.StatArea) : null,
    statAreaCmb: r.StatAreaCmb ?? null,
    pop:         r.pop_approx ?? null,
    density:     r.pop_density != null ? Number(r.pop_density) : null,
    ageMedian:   r.age_median ?? null,
    age0_19:     Number(r.age0_19_pcnt) || 0,
    age20_64:    Number(r.age20_64_pcnt) || 0,
    age65:       Number(r.age65_pcnt) || 0,
    academicPct: Number(r.AcadmCert_pcnt) || 0,
    medWage:     r.employeesAnnual_medWage ? Number(r.employeesAnnual_medWage) : null,
    ownPct:      Number(r.own_pcnt) || 0,
    wrkPct:      Number(r.WrkY_pcnt) || 0,
  };
}

async function main() {
  const records = await fetchPage(0);
  const city = records.find((r) => !r.StatArea);
  const statAreas = records.filter((r) => r.StatArea);

  const out = {
    city: city ? normalise(city) : null,
    statAreas: statAreas.map(normalise),
  };

  const dest = path.join(process.cwd(), "data", "cbs-netanya.json");
  writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(`✅ שמור: עיר + ${out.statAreas.length} אזורים סטטיסטיים → ${dest}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
