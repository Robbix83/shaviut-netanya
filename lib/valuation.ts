import type { Deal, Valuation, ComparableDeal, PropertyInput, RenewalInfo, NearbyComplex } from "./types";
import { getStore, type DealsQuery } from "./store";
import { itmDistance } from "./govmap";
import { promises as fs } from "fs";
import path from "path";
// מדד שוק חודשי: נבנה ב-scripts/build-market-index.ts, ארוז בקוד כדי שיגיע לכל פריסה
import marketIndex from "../data/market-index.json";

// רדיוסים (מטרים) — קרבה אמיתית במקום שכונה שלמה
const RENEWAL_VERY_CLOSE = 150;
const RENEWAL_NEAR = 500;
const RENEWAL_SUMMARY = 1000;
// היררכיית חיפוש עסקאות: בניין → רחוב → רדיוס → שכונה
const BUILDING_RADIUS = 60;   // ±60מ' ≈ אותו בניין / כניסה
const STREET_RADIUS = 350;    // ±350מ' ≈ אותו רחוב / מתחם
const COMP_RADIUS_LADDER = [500];
const AGE_TOLERANCES = { building: 10, street: 15, radius: 20 }; // שנים

// טעינת נתוני התחדשות עירונית (data/renewal.json) — מקור רשמי, נטען פעם אחת
let _renewal: any | undefined;
async function loadRenewal(): Promise<any | null> {
  if (_renewal !== undefined) return _renewal;
  try {
    _renewal = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "renewal.json"), "utf8"));
  } catch {
    _renewal = null;
  }
  return _renewal;
}

async function renewalFor(
  neighborhoodName: string | null,
  x?: number | null,
  y?: number | null,
): Promise<RenewalInfo | null> {
  const data = await loadRenewal();
  if (!data) return null;
  const officialMap = data.officialMap || "";
  const cityComplexes = data.totalComplexes ?? 0;

  // מסלול מדויק: יש קואורדינטות לכתובת → סינון לפי מרחק אמיתי
  if (x != null && y != null && Array.isArray(data.complexes)) {
    const withDist = data.complexes
      .filter((c: any) => c.x != null && c.y != null)
      .map((c: any) => ({ c, d: Math.round(itmDistance(x, y, c.x, c.y)) }))
      .sort((a: any, b: any) => a.d - b.d);
    const nearby: NearbyComplex[] = withDist
      .filter((e: any) => e.d <= RENEWAL_NEAR)
      .map((e: any) => ({
        name: e.c.name,
        distanceMeters: e.d,
        tier: e.d <= RENEWAL_VERY_CLOSE ? "veryClose" : "near",
        addedUnits: e.c.added ?? 0,
        mapLink: e.c.mapLink || officialMap,
      }));
    const moreNearbyCount = withDist.filter((e: any) => e.d > RENEWAL_NEAR && e.d <= RENEWAL_SUMMARY).length;
    if (nearby.length === 0 && moreNearbyCount === 0) return null; // אין התחדשות בקרבת מקום
    return {
      nearby,
      moreNearbyCount,
      complexes: nearby.length,
      addedUnits: nearby.reduce((s, n) => s + n.addedUnits, 0),
      examples: [],
      mapLink: officialMap,
      cityComplexes,
      neighborhoodOnly: false,
      asOf: data.asOf ?? "",
    };
  }

  // fallback: אין קואורדינטות → תצוגת שכונה (גס)
  if (!neighborhoodName) return null;
  const n = data.byNeighborhood?.[neighborhoodName];
  if (!n || !n.complexes) return null;
  return {
    nearby: [],
    moreNearbyCount: 0,
    complexes: n.complexes,
    addedUnits: n.addedUnits ?? 0,
    examples: n.examples ?? [],
    mapLink: n.mapLink || officialMap,
    cityComplexes,
    neighborhoodOnly: true,
    asOf: data.asOf ?? "",
  };
}

// חלון זמן לפולבק שכונתי (כשאין קואורדינטות): עדיפות לנתונים עדכניים.
// לחיפוש גיאוגרפי (בניין/רחוב/רדיוס) — תמיד 48 חודשים (4 שנים).
const WINDOWS = [6, 12, 24, 48];
const GEO_MONTHS = 60; // 5 שנים לחיפוש גיאוגרפי
const MIN_DEALS_FOR_ROOM_FILTER = 6;
const HOME_NATURES = new Set(["דירה בבית קומות", "דירה", "דירת גן", "דירת גג", "מגורים", "דירת נופש", "דופלקס", "פנטהאוז"]);
const SOLD_NEW_YEARS = 1; // עסקה עד שנה אחרי שנת הבנייה (או לפניה) = נמכרה מקבלן
const NEW_SUBJECT_YEARS = 2;
const MIN_DEALS_FOR_ESTIMATE = 3;
const MIN_COMPOSITE_DEALS = 6; // מינימום עסקאות למודל composite של בית (בנוי+מגרש) — צריך יותר נתונים
const MIN_DEALS_FOR_FLOOR_FILTER = 5; // סינון קומה מופעל רק אם נשארות מספיק עסקאות
const AREA_TOLERANCE_RATIO = 0.5;    // ±50% שטח — מסנן דירות קטנות/גדולות מאד
const HOUSE_MAX_PPSQM_BUILT = 40_000; // sanity: ₪/מ"ר בנוי > ₪40K לבית = composite לא אמין → fallback
const FLOOR_TOLERANCE = 2; // ±2 קומות

// התאמת זמן: כל עסקת השוואה מוצמדת לתאריך ההערכה לפי מגמת ₪/מ"ר בשכונה (60 ח', אותו סוג נכס).
// בלי זה עסקאות בנות 5 שנים מושכות את האומדן למטה (בדיקה לאחור: הטיה של ‎−9.6%).
const TIME_ADJUST = true;
const TREND_MIN_DEALS = 20;              // פחות עסקאות → בלי התאמה (מגמה לא יציבה)
const TREND_MAX_ANNUAL = 0.05;           // תקרת שינוי שנתי ±5% (בדיקה לאחור: 15% תיקן יתר — הטיה +7.5%)
const MARKET_INDEX_MAX_CHANGE = 0.3;     // תקרת התאמה לעסקה בודדת לפי מדד השוק (±30%)

// רצפת רוחב לטווח המוצג, סביב האומדן האמצעי. בבתים הסטייה גדולה יותר.
// קרקע: הסטייה החציונית הייתה 84% — לא מציגים מספר (manualReview).
// דירות: אין רצפה קבועה — הטווח נגזר מהעסקאות עצמן (appraiseApartment).
const MIN_RANGE_HALF: Record<string, number> = {
  house: 0.25,
};
// תקרת רוחב לדירות: מעל ±10% לא מציגים (החלטת המתווך, 30.10.2026; בדיקה על 5,000 מכירות: כ-49% בטווח). בתים: לא נמדד — בלי תקרה.
const MAX_RANGE_HALF: Record<string, number> = {
  apartment: 0.1,
};
// פיזור רחב מזה בעסקאות ההשוואה הוא הסימן לאומדן פחות בטוח (ביטחון נמוך), גם כשהתצוגה נחתכת לתקרה
const WIDE_SCATTER_HALF = 0.25;
// תקרה בשקלים לפער בין קצוות הטווח בדירות: באחוזים לבד, דירה של ₪4M+ תמיד מקבלת פער מעל מיליון.
const MAX_RANGE_SPAN_APARTMENT = 1_000_000;

// גישת ההשוואה בדירות: כל עסקה מותאמת לנכס הנבדק ומקבלת משקל לפי הדמיון אליו.
// כויל בבדיקה לאחור ללא זליגה (30.10.2026, rc7); המקדמים מהשוק המקומי, לא נורמה שמאית.
const APPRAISAL = {
  sizeElasticity: 0.5,    // ₪/מ"ר יורד עם השטח: מקדם גודל = (שטח עסקה ÷ שטח נכס)^0.5
  floorStep: 0.006,       // 0.6% לקומה, עד ±5 קומות
  floorMaxDiff: 5,
  recencyYears: 3,        // דעיכת משקל לפי גיל העסקה
  sameBuildingWeight: 2,  // עסקה באותו בניין שווה פי 2
  sizeWeightScale: 0.1,   // דעיכת משקל לפי פער שטח יחסי
  // חצי-רוחב הטווח = בסיס + מקדם×פיזור + תיקון למדגם קטן, עם רצפה
  rangeBase: 0.08,
  rangeDispersion: 0.75,
  rangeSample: 0.05,
  rangeMin: 0.12,
};

// סף מינימום ₪/מ"ר לפי סוג נכס — מסנן עסקאות חלקיות/זכויות שנדל"ן מפרסם ביחד
// עם עסקאות שוק רגילות (מכירת 25% מדירה, העברות בין קרובים בתמורה סמלית וכו')
const MIN_PPSQM: Record<string, number> = {
  apartment: 8_000,  // זול ביותר בנתניה ≈ ₪12K; 8K = ביטחון
  house:    12_000,  // P25 עסקאות שוק אמיתיות לבתים בנתניה ≈ ₪13.5K; סינון עסקאות חלקיות/זכויות
  land:        800,  // קרקע חקלאית → סף נמוך יותר
};

function cutoffDate(months: number, asOf?: string | null): string {
  const d = asOf ? new Date(asOf + "T00:00:00Z") : new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * הערכת שווי ברמת שכונה:
 * מחשבים התפלגות מחיר למ"ר מעסקאות אמיתיות בשכונה — מחלון הזמן העדכני ביותר
 * שיש בו מספיק נתונים (6 ח' כברירת מחדל), מעדיפים מספר חדרים דומה, ומתאימים לשטח.
 */
export async function valuate(input: PropertyInput): Promise<Valuation | null> {
  const store = getStore();
  const dataAsOf = await store.dataAsOf();
  // בדיקה לאחור: מעריכים "נכון לתאריך" — רק עסקאות שלפניו, וכל חלונות הזמן נספרים ממנו
  const asOf = input.asOf ?? null;

  const ptype = input.propertyType ?? "apartment";
  const isLand = ptype === "land";
  // לקרקע: המחיר למ"ר מתייחס לשטח מגרש; לדירה/בית: לשטח בנוי.
  const basis: "built" | "plot" = isLand ? "plot" : "built";
  const sizeInput = isLand ? input.plotSqm : input.areaSqm;
  // MIN_PPSQM מוגדר כאן מוקדם — נחוץ גם ב-cross-neighborhood fallback
  const minPpsqm = MIN_PPSQM[ptype] ?? 5_000;

  // lazy cache — store.getAllDeals() נקרא לכל היותר פעם אחת לבקשה
  let _allDealsCache: Deal[] | null = null;
  const lazyAllDeals = async (): Promise<Deal[]> => {
    if (!_allDealsCache) {
      const all = await store.getAllDeals();
      _allDealsCache = asOf ? all.filter((d) => d.dealDate < asOf) : all;
    }
    return _allDealsCache;
  };

  // עסקאות הרחוב בכל העיר — שאילתה אחת לפי רחוב במקום הורדת כל הטבלה (getAllDeals)
  let _streetCache: Deal[] | null = null;
  const lazyStreetDeals = async (): Promise<Deal[]> => {
    if (!_streetCache) _streetCache = input.streetName ? await store.getDealsByStreet(input.streetName, { asOf }) : [];
    return _streetCache;
  };

  // ===== pool גיאוגרפי: 4 שנים תמיד =====
  // חיפוש בניין/רחוב/רדיוס מחייב היסטוריה של 4 שנים — בניין בודד מוכר נדיר,
  // וחלון קצר יחמיץ עסקאות אמיתיות שם.
  // משרד/חנות/חניה מסומנים במאגר כ"דירה"; תיאור ריק נשאר (לא ידוע, לא מסחרי)
  const sameType = (d: Deal) =>
    (d.propertyType ?? "apartment") === ptype && (ptype !== "apartment" || !d.dealNature || HOME_NATURES.has(d.dealNature));
  let pool4yr = (await fetchDeals(input.neighborhoodId, GEO_MONTHS, asOf)).filter(sameType);
  // רחוב ארוך או רחוב-גבול חוצה שכונות (סוקולוב: זוגי ואי-זוגי בשכונות שונות) — כל הרחוב נשאר בהשוואה
  if (ptype === "apartment" && input.streetName) {
    const cutoff = cutoffDate(GEO_MONTHS, asOf);
    const seen = new Set(pool4yr.map((d) => d.id));
    pool4yr = pool4yr.concat((await lazyStreetDeals()).filter((d) => sameType(d) && d.dealDate >= cutoff && !seen.has(d.id)));
  }
  const roomSubset4yr =
    !isLand && input.rooms != null
      ? pool4yr.filter((d) => d.rooms != null && Math.abs(d.rooms - input.rooms!) <= 1)
      : pool4yr;
  let geoPool = roomSubset4yr.length >= MIN_DEALS_FOR_ROOM_FILTER ? roomSubset4yr : pool4yr;

  // ===== pool שכונתי: חלון מצומצם (6→12→24→48 ח') =====
  // כשאין קואורדינטות (פולבק לשכונה שלמה) — עדיפות לנתונים עדכניים.
  let deals: Deal[] = geoPool;
  let windowMonths = GEO_MONTHS;
  for (const months of WINDOWS) {
    const cutoff = cutoffDate(months, asOf);
    const recent = pool4yr.filter((d) => d.dealDate >= cutoff);
    const roomRecent =
      !isLand && input.rooms != null
        ? recent.filter((d) => d.rooms != null && Math.abs(d.rooms - input.rooms!) <= 1)
        : recent;
    deals = roomRecent.length >= MIN_DEALS_FOR_ROOM_FILTER ? roomRecent : recent;
    windowMonths = months;
    if (deals.length >= MIN_DEALS_FOR_ESTIMATE) break;
  }

  // ===== היררכיית חיפוש: בניין → רחוב → רדיוס → שכונה =====
  // גיאוגרפיה תמיד על geoPool (4 שנים); שכונה על deals (חלון מצומצם).
  let compRadiusMeters: number | null = null;
  let compSearchScope: import("./types").Valuation["compSearchScope"] = "neighborhood";

  const ageFilter = (ds: Deal[], toleranceYrs: number): Deal[] => {
    if (input.yearBuilt == null) return ds;
    const withAge = ds.filter((d) => d.yearBuilt != null && Math.abs(d.yearBuilt - input.yearBuilt!) <= toleranceYrs);
    return withAge.length >= MIN_DEALS_FOR_ESTIMATE ? withAge : ds;
  };

  // ─── נורמליזציה של שם רחוב: הסרת "שד'" / "שדרות" / "רחוב" / "רח'" ───
  // מאפשר התאמה בין "שד ויצמן" (כפי שנשמר ב-DB) ל-"ויצמן" (כפי שהמשתמש הקליד).
  const STREET_PREFIX = /^(שד'?|שדרות|רחוב|רח')\s*/i;
  const normalizeStreet = (s: string) => s.replace(STREET_PREFIX, "").trim();
  const inputStreetNorm = input.streetName ? normalizeStreet(input.streetName) : null;

  /** מסנן geoPool לפי שם רחוב (text-match, בלתי-תלוי קואורדינטות).
   *  כלל ההתאמה: שמות זהים אחרי נורמליזציה — או שם הרחוב מה-DB הוא תת-מחרוזת של הקלט
   *  (למשל "ויצמן" ← "שד ויצמן"), אך לא הפוך — מניעת false-match "אבא הלל" ← "אבא הלל סילבר".
   */
  const byStreetName = (pool: Deal[]): Deal[] => {
    if (!inputStreetNorm) return [];
    return pool.filter((d) => {
      if (!d.street) return false;
      const ds = normalizeStreet(d.street);
      // התאמה מדויקת — או שם ה-DB הוא חלק מהשם שהמשתמש הזין (קיצור / ללא תחילית)
      // אסור: ds.includes(input) — מונע "אבא הלל סילבר" להתאים ל"אבא הלל"
      return ds === inputStreetNorm || inputStreetNorm.includes(ds);
    });
  };

  /** אותו בניין: מספר זהה בדיוק (parseInt שווה) — מאחד כניסות "98א" ו-"98ב" של אותו בניין */
  const byExactBuilding = (pool: Deal[]): Deal[] => {
    const onStreet = byStreetName(pool);
    if (!input.houseNumber || onStreet.length === 0) return [];
    const hn = parseInt(input.houseNumber);
    if (isNaN(hn)) return onStreet;
    return onStreet.filter((d) => {
      const dhn = parseInt(d.houseNumber ?? "");
      return !isNaN(dhn) && dhn === hn;
    });
  };

  /** קרבת מספר בית: אותו רחוב + מספר בית בטווח ±HOUSE_RANGE (לחיפוש, לא לתיוג "בניין") */
  const HOUSE_RANGE = 12;
  const byBuildingNumber = (pool: Deal[]): Deal[] => {
    const onStreet = byStreetName(pool);
    if (!input.houseNumber || onStreet.length === 0) return [];
    const hn = parseInt(input.houseNumber);
    if (isNaN(hn)) return onStreet; // מספר לא מספרי → הרחוב כולו
    return onStreet.filter((d) => {
      const dhn = parseInt(d.houseNumber ?? "");
      return !isNaN(dhn) && Math.abs(dhn - hn) <= HOUSE_RANGE;
    });
  };

  // ─── שלב טקסטואלי: בניין מדויק → קרבת רחוב (±12) → רחוב שלם ───
  // "בניין" = אותו מספר בדיוק. ±12 מספרים = "רחוב" (לא "בניין") — מונע תיוג שגוי
  // של בניינים שכנים (כגון ויצמן 97 כ"אותו בניין" של ויצמן 98).
  if (inputStreetNorm) {
    const exactBuilding = ageFilter(byExactBuilding(geoPool), AGE_TOLERANCES.building);
    if (exactBuilding.length >= MIN_DEALS_FOR_ESTIMATE) {
      deals = exactBuilding;
      compSearchScope = "building";
      compRadiusMeters = null;
      windowMonths = GEO_MONTHS;
    } else {
      // ±12 מספרים: מספיק עסקאות השוואה, אבל scope = "street" (לא "building")
      const nearStreet = ageFilter(byBuildingNumber(geoPool), AGE_TOLERANCES.street);
      if (nearStreet.length >= MIN_DEALS_FOR_ESTIMATE) {
        deals = nearStreet;
        compSearchScope = "street";
        compRadiusMeters = null;
        windowMonths = GEO_MONTHS;
      } else {
        const street = ageFilter(byStreetName(geoPool), AGE_TOLERANCES.street);
        if (street.length >= MIN_DEALS_FOR_ESTIMATE) {
          deals = street;
          compSearchScope = "street";
          compRadiusMeters = null;
          windowMonths = GEO_MONTHS;
        }
      }
    }
  }

  // ─── שלב טקסטואלי עירוני: כשלא נמצאו מספיק מועמדים רלוונטיים — חפש לפי שם רחוב
  // בכל עסקאות העיר ───
  // קורה כשרחוב נמצא בשכונה שטרם נשאבה (למשל גבע → רמת אפרים), אבל עסקאותיו נשאבו
  // תחת neighborhoodId שונה (כגון שכונה סמוכה). מבטיח שמשתמש תמיד מקבל עסקאות רחובו.
  //
  // Wave 0F-2B: התנאי הקודם היה geoPool.length < MIN_DEALS_FOR_ROOM_FILTER — בודק את
  // גודל ה-pool הגולמי של השכונה שנפתרה, לא את כמות המועמדים הרלוונטיים בפועל
  // (בניין/רחוב) שנמצאו. compSearchScope === "neighborhood" בנקודה הזו כבר אומר
  // במדויק "אף אחד ממדרגי הטקסט (בניין/קרבת-מספר/רחוב) לא הגיע לסף הקיים
  // MIN_DEALS_FOR_ESTIMATE" — זה בדיוק אות "מספיק מועמדים רלוונטיים" שכבר קיים,
  // בלי צורך בסף שרירותי חדש. ה-gate הישן חסם את החילוץ הזה כשה-neighborhoodId
  // שנפתר (השגוי) היה בעצמו שכונה גדולה/מאוכלסת (למשל "עובד בן עמי" 45 — 500 עסקאות
  // בשכונה, 0 מהן ברחוב המבוקש) — למרות שאפס מועמדים רלוונטיים נמצאו בפועל.
  if (compSearchScope === "neighborhood" && inputStreetNorm) {
    const allCityDeals = await lazyStreetDeals();
    const cityPool = allCityDeals.filter((d) => (d.propertyType ?? "apartment") === ptype);
    // ±12 house numbers is the street, not the building (same rule as the neighbourhood tier above)
    const cityBuilding = ageFilter(byBuildingNumber(cityPool), AGE_TOLERANCES.building);
    if (cityBuilding.length >= MIN_DEALS_FOR_ESTIMATE) {
      deals = cityBuilding;
      const inputHn = parseInt(input.houseNumber ?? "");
      compSearchScope =
        !isNaN(inputHn) && cityBuilding.every((d) => parseInt(d.houseNumber ?? "") === inputHn) ? "building" : "street";
      compRadiusMeters = null;
      windowMonths = GEO_MONTHS;
    } else {
      const cityStreet = ageFilter(byStreetName(cityPool), AGE_TOLERANCES.street);
      if (cityStreet.length >= MIN_DEALS_FOR_ESTIMATE) {
        deals = cityStreet;
        compSearchScope = "street";
        compRadiusMeters = null;
        windowMonths = GEO_MONTHS;
      }
    }
  }

  if (input.streetX != null && input.streetY != null) {
    const located = geoPool.filter((d) => d.x != null && d.y != null);
    const unlocated = geoPool.filter((d) => d.x == null || d.y == null);
    const filterByRadius = (R: number) =>
      located.filter((d) => itmDistance(input.streetX!, input.streetY!, d.x!, d.y!) <= R);

    // שלב גיאוגרפי 1: אותו בניין (±60מ') — רק אם לא מצאנו כבר מהטקסט
    // תיקון: כשיש שם רחוב — מחייבים גם התאמת רחוב; אחרת עסקאות מרחוב שכן
    // (למשל "בן יהודה 13") מקבלות בטעות scope="building" עבור "רחל ברכות 8".
    if (compSearchScope !== "building") {
      const withinBuilding = filterByRadius(BUILDING_RADIUS);
      // אם יש שם רחוב — נסה קודם עסקאות מאותו רחוב בדיוק בתוך הרדיוס
      const sameStreetInBuilding = inputStreetNorm
        ? withinBuilding.filter((d) => {
            if (!d.street) return false;
            const ds = normalizeStreet(d.street);
            return ds === inputStreetNorm || inputStreetNorm.includes(ds);
          })
        : withinBuilding;
      const inBuilding = ageFilter(
        sameStreetInBuilding.length >= MIN_DEALS_FOR_ESTIMATE ? sameStreetInBuilding : withinBuilding,
        AGE_TOLERANCES.building,
      );
      // scope="building" רק אם כל העסקאות הן מאותו רחוב (או אין לנו שם רחוב)
      const allSameStreet =
        !inputStreetNorm ||
        inBuilding.every((d) => {
          if (!d.street) return true;
          const ds = normalizeStreet(d.street);
          return ds === inputStreetNorm || inputStreetNorm.includes(ds);
        });
      // the input x,y can be the street's point, not the house (the browser geocode failed), so 60m
      // around it is not "the same building": with a house number, every deal must carry that number
      const inputHn = parseInt(input.houseNumber ?? "");
      const allSameNumber =
        isNaN(inputHn) || inBuilding.every((d) => parseInt(d.houseNumber ?? "") === inputHn);
      if (inBuilding.length >= MIN_DEALS_FOR_ESTIMATE) {
        deals = inBuilding.concat(unlocated);
        compRadiusMeters = BUILDING_RADIUS;
        // same street and same number → building; same street only → street; otherwise → radius (כנה יותר)
        compSearchScope = allSameStreet ? (allSameNumber ? "building" : "street") : "radius";
        windowMonths = GEO_MONTHS;
      }
    }

    // שלב גיאוגרפי 2: קרבת רחוב (±350מ') — רק אם לא מצאנו ברמת בניין/רחוב טקסטואלי
    // מכוון: לא מסמן "street" כי לא ידוע שהעסקאות הן מאותו רחוב — רק בקרבת מקום גיאוגרפית
    if (compSearchScope !== "building" && compSearchScope !== "street") {
      const onStreet = ageFilter(filterByRadius(STREET_RADIUS), AGE_TOLERANCES.street);
      if (onStreet.length >= MIN_DEALS_FOR_FLOOR_FILTER) {
        deals = onStreet.concat(unlocated);
        compRadiusMeters = STREET_RADIUS;
        compSearchScope = "radius";
        windowMonths = GEO_MONTHS;
      }
    }

    // שלב גיאוגרפי 3: רדיוס מתרחב (500מ') — fallback כשגם הרחוב ריק
    if (compSearchScope === "neighborhood") {
      for (const R of COMP_RADIUS_LADDER) {
        const within = ageFilter(filterByRadius(R), AGE_TOLERANCES.radius);
        if (within.length >= MIN_DEALS_FOR_FLOOR_FILTER) {
          deals = within.concat(unlocated);
          compRadiusMeters = R;
          compSearchScope = "radius";
          windowMonths = GEO_MONTHS;
          break;
        }
      }
    }

    // שלב 5: cross-neighborhood — כשהשכונה לא נאספה עדיין (deals < MIN) וקיימות קואורדינטות.
    // גם כשיש deals גיאוגרפיים אבל ppsqm תקני נמוך מדי (למשל: בתים עם חדרים נדירים
    // שהגיאוגרפיה מחזירה 6 עסקאות אבל רק 1 תקנית אחרי MIN_PPSQM filter).
    const prePpsqm = deals
      .map((d) => d.pricePerSqm)
      .filter((v): v is number => v != null && v >= minPpsqm && isFinite(v));
    if (deals.length < MIN_DEALS_FOR_ESTIMATE || prePpsqm.length < MIN_DEALS_FOR_ESTIMATE) {
      const allDeals = await lazyAllDeals();
      const cutoff = cutoffDate(GEO_MONTHS, asOf);
      const typeFiltered = allDeals.filter(
        (d) => sameType(d) && d.dealDate >= cutoff,
      );
      const roomF = !isLand && input.rooms != null
        ? typeFiltered.filter((d) => d.rooms != null && Math.abs(d.rooms - input.rooms!) <= 1)
        : typeFiltered;
      const xPool = roomF.length >= MIN_DEALS_FOR_ROOM_FILTER ? roomF : typeFiltered;
      for (const R of [500, 750, 1000]) {
        const inR = xPool.filter(
          (d) => d.x != null && d.y != null && itmDistance(input.streetX!, input.streetY!, d.x!, d.y!) <= R,
        );
        const inRPps = inR.map((d) => d.pricePerSqm).filter((v): v is number => v != null && v >= minPpsqm && isFinite(v));
        if (inR.length >= MIN_DEALS_FOR_ESTIMATE && inRPps.length >= MIN_DEALS_FOR_ESTIMATE) {
          deals = inR;
          compRadiusMeters = R;
          compSearchScope = "radius";
          windowMonths = GEO_MONTHS;
          break;
        }
      }
    }
  }

  // עידון לפי קומה (±2) — מניע הדיוק הגדול ביותר; רק אם נשארות מספיק עסקאות.
  // קומה משפיעה דרמטית על המחיר למ"ר בדירות (קרקע/גן מול גבוהה).
  // לבית צמוד קרקע — קומה אינה רלוונטית: רוב עסקאות הבתים ב-nadlan מגיעות עם floor=null,
  // ופילטר קומה מרוקן את המדגם וגורם לכשלון האומדן.
  // דירה מקבלן נמכרת בתנאים אחרים מיד שנייה: לדירה שאינה חדשה משווים ליד שנייה, כשיש מספיק כאלה
  const subjectIsNew = input.yearBuilt != null && input.yearBuilt >= new Date(asOf ?? Date.now()).getFullYear() - NEW_SUBJECT_YEARS;
  if (ptype === "apartment" && !subjectIsNew) {
    const resale = deals.filter((d) => !(d.yearBuilt != null && d.yearBuilt >= parseInt(d.dealDate) - SOLD_NEW_YEARS));
    if (resale.length >= MIN_DEALS_FOR_ESTIMATE) deals = resale;
  }
  let floorFiltered = false;
  if (ptype === "apartment" && input.floor != null) {
    const fs = deals.filter(
      (d) => d.floor != null && Math.abs(d.floor - input.floor!) <= FLOOR_TOLERANCE,
    );
    if (fs.length >= MIN_DEALS_FOR_FLOOR_FILTER) {
      deals = fs;
      floorFiltered = true;
    }
  }

  // סינון גודל: ±50% מהשטח הנבדק — מונע השפעת דירות גדולות/קטנות מאד על מחיר/מ"ר
  // (דירות גדולות בד"כ זולות יותר למ"ר, קטנות — יקרות יותר)
  if (sizeInput != null && sizeInput > 0 && ptype !== "land") {
    const areaMin = sizeInput * (1 - AREA_TOLERANCE_RATIO);
    const areaMax = sizeInput * (1 + AREA_TOLERANCE_RATIO);
    const areaFiltered = deals.filter(
      (d) => d.areaSqm != null && d.areaSqm >= areaMin && d.areaSqm <= areaMax,
    );
    if (areaFiltered.length >= MIN_DEALS_FOR_ESTIMATE) deals = areaFiltered;
  }

  // התאמת זמן לפני חישוב האחוזונים (גם ל-geoPool, שמשמש את מודל ה-composite)
  let trendAnnual = 0;
  if (TIME_ADJUST) {
    trendAnnual = annualTrend(pool4yr, minPpsqm);
    const ref = asOf ?? new Date().toISOString().slice(0, 10);
    // דירות: מדד שוק חודשי של נתניה, גם בשנים של עלייה חדה (בדיקה לאחור 30.10.2026: 5,000 מכירות).
    // בלי מדד, ובבתים: מגמת השכונה עם התקרה השנתית.
    const market: Record<string, number> | null = ptype === "apartment" ? marketIndex : null;
    const adjust = (d: Deal) => adjustToMarket(d, market, ref) ?? adjustToDate(d, trendAnnual, ref);
    deals = deals.map(adjust);
    geoPool = geoPool.map(adjust);
  }

  deals = uniqueDeals(deals);

  const ppsqm = deals
    .map((d) => d.pricePerSqm)
    .filter((v): v is number => v != null && v >= minPpsqm && isFinite(v));

  if (ppsqm.length < MIN_DEALS_FOR_ESTIMATE) return null;

  // ─── city-wide exact-building augmentation for display ───
  // אם pool הסופי (אחרי כל ה-filtering) לא מכיל עסקאות ממספר הבית המדויק,
  // חפש בכל עסקאות העיר — כדי שה-comparable deals תמיד יציגו את הבניין הספציפי
  // (גם אם שכונתו שונה ב-DB, או אם הוא נסנן ע"י פילטר גודל/קומה).
  let displayDeals = deals.map(original);
  if (input.houseNumber && inputStreetNorm) {
    const ihn = parseInt(input.houseNumber);
    if (!isNaN(ihn)) {
      const hasExact = deals.some(d => {
        if (!d.street) return false;
        const ds = normalizeStreet(d.street);
        if (!(ds === inputStreetNorm || inputStreetNorm.includes(ds))) return false;
        const dhn = parseInt(d.houseNumber ?? '');
        return !isNaN(dhn) && dhn === ihn;
      });
      if (!hasExact) {
        const cutoff = cutoffDate(GEO_MONTHS, asOf);
        const allD = await lazyStreetDeals();
        const cityExact = allD.filter(d => {
          if ((d.propertyType ?? 'apartment') !== ptype) return false;
          if (d.dealDate < cutoff) return false;
          if (!d.street) return false;
          const ds = normalizeStreet(d.street);
          if (!(ds === inputStreetNorm || inputStreetNorm.includes(ds))) return false;
          const dhn = parseInt(d.houseNumber ?? '');
          return !isNaN(dhn) && dhn === ihn;
        });
        if (cityExact.length > 0) {
          const key = (d: Deal) => `${d.dealDate}|${d.price}|${d.street}|${d.houseNumber}`;
          const existing = new Set(displayDeals.map(key));
          const fresh = cityExact.filter(d => !existing.has(key(d)));
          if (fresh.length > 0) displayDeals = [...fresh, ...displayDeals];
        }
      }
    }
  }

  // טווח האומדן מצטמצם ככל שהנתונים קרובים יותר לנכס:
  // בניין (אותם תנאים בדיוק) → P20/P80; רחוב → P25/P75; רדיוס/שכונה → P33/P67
  const scopePct = compSearchScope === "building" ? { lo: 20, hi: 80 }
                 : compSearchScope === "street"   ? { lo: 25, hi: 75 }
                 :                                  { lo: 33, hi: 67 };
  let lo  = percentile(ppsqm, scopePct.lo);
  let mid = percentile(ppsqm, 50);
  let hi  = percentile(ppsqm, scopePct.hi);
  // דירה: עסקאות מותאמות ומשוקללות במקום חציון גולמי; הטווח משקף כמה הן מסכימות ביניהן
  const appraisal = ptype === "apartment" && input.areaSqm
    ? appraiseApartment(deals, input, asOf ?? new Date().toISOString().slice(0, 10), minPpsqm)
    : null;
  if (appraisal) {
    mid = appraisal.ppsqm;
    lo = mid * (1 - appraisal.half);
    hi = mid * (1 + appraisal.half);
  }

  const size = sizeInput && sizeInput > 0 ? sizeInput : null;
  const round = (n: number) => Math.round(n / 1000) * 1000;

  // ---- חישוב האומדן ----
  // דירה: ₪/מ"ר בנוי × שטח (השטח הוא המניע העיקרי).
  // בית/קרקע: לפי *המחיר הכולל* של עסקאות דומות בגודל (בנוי + מגרש) — כי המגרש מניע-שווי מרכזי,
  //           כך שהאומדן עקבי עם עסקאות ההשוואה המוצגות ומתחשב בשטח המגרש.
  let estLow: number, estMid: number, estHigh: number;
  let ppsLow = Math.round(lo), ppsMid = Math.round(mid), ppsHigh = Math.round(hi);
  let basedOn = ppsqm.length;

  // בית: גודל משוקלל = בנוי + 0.4×מגרש (קרקע שווה פחות למ"ר מבנוי). קרקע: מגרש בלבד.
  const PLOT_WEIGHT = 0.4;
  const composite = (built: number | null, plot: number | null): number | null => {
    if (isLand) return plot && plot > 0 ? plot : null;
    if (!built || built <= 0) return null;
    return built + PLOT_WEIGHT * (plot && plot > 0 ? plot : 0);
  };
  const subjComposite = composite(input.areaSqm ?? null, input.plotSqm ?? null);

  const useCompositeModel = (ptype === "house" || isLand) && subjComposite != null;
  let compositeUsed = false;
  if (useCompositeModel) {
    // ₪ למ"ר משוקלל מכל עסקה (מחיר כולל ÷ גודל משוקלל) — מנרמל בנוי+מגרש לכלל הגדלים
    const toPpsC = (pool: Deal[]) => pool
      .map((d) => {
        const cs = composite(d.areaSqm, d.plotSqm);
        if (!cs || d.price <= 0) return null;
        // סינון עסקאות חלקיות: לפי pricePerSqm (בנוי) — הסף 12K מכויל למ"ר בנוי,
        // לא למ"ר composite (שגדול יותר כי מכיל מגרש → ratio נמוך מ-12K גם בעסקאות שוק תקינות)
        if (d.pricePerSqm != null && d.pricePerSqm < minPpsqm) return null;
        const ratio = d.price / cs;
        return isFinite(ratio) ? ratio : null;
      })
      .filter((v): v is number => v != null);

    // כאשר הpool הגיאוגרפי (רדיוס/רחוב) קטן מדי — הרחב לכל עסקאות השכונה לחישוב ה-ppsqm בלבד.
    // עסקאות ההשוואה המוצגות נשארות מהpool הגיאוגרפי (קרוב לכתובת).
    let ppsC = toPpsC(deals);
    if (ppsC.length < MIN_COMPOSITE_DEALS) {
      const neighPpsC = toPpsC(geoPool);
      if (neighPpsC.length >= MIN_COMPOSITE_DEALS) ppsC = neighPpsC;
    }

    if (ppsC.length >= MIN_COMPOSITE_DEALS) {
      const cLo = percentile(ppsC, 25), cMid = percentile(ppsC, 50), cHi = percentile(ppsC, 75);
      estLow = round(subjComposite! * cLo);
      estMid = round(subjComposite! * cMid);
      estHigh = round(subjComposite! * cHi);
      basedOn = ppsC.length;
      // ₪/מ"ר לתצוגה: ביחס לשטח הרלוונטי (בנוי לבית, מגרש לקרקע)
      const dispSize = isLand ? input.plotSqm! : input.areaSqm!;
      ppsLow = Math.round(estLow / dispSize);
      ppsMid = Math.round(estMid / dispSize);
      ppsHigh = Math.round(estHigh / dispSize);
      compositeUsed = true;
      // sanity: אם ₪/מ"ר בנוי מחושב > ₪40K לבית — מודל composite לא אמין (מגרש גדול עם מעט עסקאות)
      if (!isLand && input.areaSqm && input.areaSqm > 0 && estMid / input.areaSqm > HOUSE_MAX_PPSQM_BUILT) {
        compositeUsed = false;
        // reset pps values — יאוכלסו מחדש מ-ppsqm הפשוט לאחר הבלוק הזה
        ppsLow = Math.round(lo);
        ppsMid = Math.round(mid);
        ppsHigh = Math.round(hi);
      }
    }
  }
  if (!compositeUsed) {
    // דירה (או נפילה-לאחור): ₪/מ"ר × שטח
    estLow = size ? round(size * lo) : 0;
    estMid = size ? round(size * mid) : 0;
    estHigh = size ? round(size * hi) : 0;
  }

  // רצפת רוחב: הטווח לא צר מ-±MIN_RANGE_HALF סביב האמצע (האמצע עצמו לא משתנה)
  const minHalf = MIN_RANGE_HALF[ptype];
  if (minHalf && estMid! > 0) {
    estLow = Math.min(estLow!, round(estMid! * (1 - minHalf)));
    estHigh = Math.max(estHigh!, round(estMid! * (1 + minHalf)));
    ppsLow = Math.min(ppsLow, Math.round(ppsMid * (1 - minHalf)));
    ppsHigh = Math.max(ppsHigh, Math.round(ppsMid * (1 + minHalf)));
  }
  // תקרת רוחב: הטווח המוצג לא רחב מ-±MAX_RANGE_HALF; פיזור מעל WIDE_SCATTER_HALF גם מוריד ביטחון לנמוך
  const maxHalf = MAX_RANGE_HALF[ptype];
  let rangeCapped = false;
  if (maxHalf && estMid! > 0) {
    const capLow = round(estMid! * (1 - maxHalf)), capHigh = round(estMid! * (1 + maxHalf));
    if (estLow! < round(estMid! * (1 - WIDE_SCATTER_HALF)) || estHigh! > round(estMid! * (1 + WIDE_SCATTER_HALF))) rangeCapped = true;
    estLow = Math.max(estLow!, capLow);
    estHigh = Math.min(estHigh!, capHigh);
    ppsLow = Math.max(ppsLow, Math.round(ppsMid * (1 - maxHalf)));
    ppsHigh = Math.min(ppsHigh, Math.round(ppsMid * (1 + maxHalf)));
  }
  // תקרה בשקלים: גוברת על הרצפות באחוזים. מחיר גבוה לבדו לא אומר ביטחון נמוך — לא מורידים ביטחון כאן
  let spanCapped = false;
  if (ptype === "apartment" && estMid! > 0 && estHigh! - estLow! > MAX_RANGE_SPAN_APARTMENT) {
    spanCapped = true;
    const halfSpan = MAX_RANGE_SPAN_APARTMENT / 2;
    estLow = Math.max(estLow!, estMid! - halfSpan);
    estHigh = Math.min(estHigh!, estMid! + halfSpan);
    if (size) {
      ppsLow = Math.max(ppsLow, Math.round(estLow / size));
      ppsHigh = Math.min(ppsHigh, Math.round(estHigh / size));
    }
  }

  // קרקע: האומדן לא אמין מספיק כדי להציג — לא חושפים מספר (גם לא ב-WhatsApp/גיליון), רק עסקאות השוואה.
  // בבנייה (שנת בנייה אחרי שנת ההערכה): בבדיקה לאחור האומדן יצא נמוך ב-31%–39% בחציון
  // (מחירי קבלן לא דומים לעסקאות יד-שנייה) — גם כאן בדיקה אישית במקום מספר.
  const valuationYear = Number((asOf ?? new Date().toISOString()).slice(0, 4));
  const isOffPlan = !isLand && input.yearBuilt != null && input.yearBuilt > valuationYear;
  const manualReview = isLand || isOffPlan;
  if (manualReview) {
    estLow = estMid = estHigh = 0;
    ppsLow = ppsMid = ppsHigh = 0;
  }

  const confidence = ptype === "apartment" && !rangeCapped ? confidenceFromCount(basedOn) : "low";

  const valuation: Valuation = {
    pricePerSqmLow: ppsLow,
    pricePerSqmMid: ppsMid,
    pricePerSqmHigh: ppsHigh,
    pricePerSqmBasis: basis,
    propertyType: ptype,
    estimateLow: estLow!,
    estimateMid: estMid!,
    estimateHigh: estHigh!,
    basedOnDeals: basedOn,
    windowMonths,
    floorAdjusted: floorFiltered,
    compRadiusMeters,
    compSearchScope,
    // 24 החודשים האחרונים מתוך ה-pool שכבר נטען (60 ח', אותו סוג) — בלי שאילתה נוספת
    priceTrend: computeTrend(pool4yr.filter((d) => d.dealDate >= cutoffDate(24, asOf))),
    neighborhood: input.neighborhood ?? null,
    // עסקאות השוואה: displayDeals כולל עסקאות בניין מדויקות גם ממקורות מחוץ לשכונה
    comparableDeals: buildComparableDeals(displayDeals, input, ptype, compRadiusMeters),
    buildingRights: null,
    // התחדשות עירונית רלוונטית לדירות/בתים (לא לקרקע ריקה) — לפי מרחק מהכתובת
    renewal: isLand ? null : await renewalFor(input.neighborhood ?? null, input.streetX, input.streetY),
    // בית/קרקע: הבדיקה לאחור הראתה סטייה גבוהה — תמיד ביטחון נמוך
    confidence,
    // ביטחון נמוך והטווח נחתך בתקרה: מציגים "הערכה ראשונית" ומציעים בדיקה אישית
    preliminary: !manualReview && confidence === "low" && (rangeCapped || spanCapped),
    asOf: dataAsOf,
    compositeUsed,
    manualReview,
    manualReviewReason: isLand ? "land" : isOffPlan ? "off_plan" : undefined,
    plotNotValued: ptype === "house" && (input.plotSqm ?? 0) > 200 && !compositeUsed,
  };
  return valuation;
}

/** מרחק-גודל מנורמל לעסקה מול הנכס: בית = בנוי(0.55)+מגרש(0.45); קרקע = מגרש בלבד */
function sizeDistance(d: Deal, input: PropertyInput, isLand: boolean): number {
  if (isLand) {
    const p = input.plotSqm;
    return p && d.plotSqm ? Math.abs(d.plotSqm - p) / p : 2;
  }
  const bi = input.areaSqm, pi = input.plotSqm;
  const builtD = bi && d.areaSqm ? Math.abs(d.areaSqm - bi) / bi : 1;
  const plotD = pi && d.plotSqm ? Math.abs(d.plotSqm - pi) / pi : builtD;
  return 0.55 * builtD + 0.45 * plotD;
}

async function fetchDeals(neighborhoodId: string, months: number, asOf?: string | null): Promise<Deal[]> {
  return getStore().getDealsByNeighborhood(neighborhoodId, { monthsBack: months, asOf });
}

/** בוחר עד 12 עסקאות הכי רלוונטיות להצגה (אותו סוג נכס), דומות בגודל/חדרים, עדכניות */
// ─── קבועי פילטר עסקאות השוואה ────────────────────────────────────────────
const MAX_SQM_DIFF    = 14; // ±14 מ"ר בנוי (ניסיון ראשון — דירה)
const MAX_SQM_WIDE    = 25; // ±25 מ"ר בנוי (fallback — דירה)
const MAX_ROOM_DIFF   = 0;  // חדרים: הפרש 0 (exact) — ½ חדר = אותה קטגוריה
const MAX_ROOM_WIDE   = 1;  // fallback: ±1 חדר
const MIN_COMPARABLES = 3;  // מינימום לפני שמרחיבים פילטר

// ─── composite size helpers ─────────────────────────────────────────────────
// לבית עם מגרש: composite = בנוי + 0.4×מגרש. כשאין plotSqm ב-deal השוואה,
// ה-composite מצטמצם לבנוי בלבד — כך בתים ללא שטח מגרש מקבלים רלוונטיות נמוכה יותר.
const COMP_PLOT_WEIGHT = 0.4;

function compSize(d: Deal, ptype: string, isLand: boolean): number | null {
  if (isLand) return d.plotSqm;
  if (ptype === "house") return d.areaSqm != null ? d.areaSqm + COMP_PLOT_WEIGHT * (d.plotSqm ?? 0) : null;
  return d.areaSqm;
}

function subjectSize(input: PropertyInput, ptype: string, isLand: boolean): number | null {
  if (isLand) return input.plotSqm ?? null;
  if (ptype === "house") return (input.areaSqm ?? 0) + COMP_PLOT_WEIGHT * (input.plotSqm ?? 0) || null;
  return input.areaSqm ?? null;
}

function pickComparables(deals: Deal[], input: PropertyInput, ptype: string): ComparableDeal[] {
  const isLand = ptype === "land";
  // לבית: composite size (בנוי + 0.4×מגרש). לדירה: בנוי בלבד. לקרקע: מגרש בלבד.
  const sizeOf = (d: Deal) => compSize(d, ptype, isLand);
  const sizeInput = subjectSize(input, ptype, isLand);

  // tolerance מותאמת: לבית, composite גדול יותר → tolerance גדולה יחסית
  const pctTight = ptype === "house" ? 0.25 : null; // ±25% composite
  const pctWide  = ptype === "house" ? 0.55 : null; // ±55% composite
  const absTight = pctTight && sizeInput ? Math.max(MAX_SQM_DIFF, Math.round(sizeInput * pctTight)) : MAX_SQM_DIFF;
  const absWide  = pctWide  && sizeInput ? Math.max(MAX_SQM_WIDE, Math.round(sizeInput * pctWide))  : MAX_SQM_WIDE;

  // סינון בסיסי: יש מחיר + יש מטרז
  const base = deals.filter((d) => d.price > 0 && sizeOf(d) != null);

  // פילטר מטרז קשיח עם fallback
  const sizeFiltered = (maxDiff: number, pool: Deal[]) =>
    sizeInput
      ? pool.filter((d) => Math.abs((sizeOf(d) ?? 0) - sizeInput) <= maxDiff)
      : pool;

  // פילטר חדרים קשיח עם fallback (רק לדירה/בית)
  // ½ חדר נחשב אותה קטגוריה (3 = 3.5 = ok אם MAX_ROOM_DIFF=0.5)
  const roomFiltered = (maxDiff: number, pool: Deal[]) =>
    !isLand && input.rooms
      ? pool.filter((d) => d.rooms == null || Math.abs(d.rooms - input.rooms!) <= maxDiff + 0.5)
      : pool;

  // נסה קצר→רחב בשני ממדים בזוגות
  const attempts: [number, number][] = [
    [absTight, MAX_ROOM_DIFF],
    [absTight, MAX_ROOM_WIDE],
    [absWide,  MAX_ROOM_DIFF],
    [absWide,  MAX_ROOM_WIDE],
  ];

  let pool: Deal[] = [];
  for (const [sqmDiff, roomDiff] of attempts) {
    pool = roomFiltered(roomDiff, sizeFiltered(sqmDiff, base));
    if (pool.length >= MIN_COMPARABLES) break;
  }
  // אם כל הניסיונות לא הניבו מספיק — נציג את כל העסקאות שבטווח (כבר מסוננות לפי גיאוגרפיה)
  if (pool.length < MIN_COMPARABLES) pool = base;

  return pool
    .map((d) => {
      const rDiff = !isLand && input.rooms && d.rooms ? Math.abs(d.rooms - input.rooms) : 0;
      const dSize = sizeOf(d);
      // sDiff: ריחוק יחסי (0=זהה, 1=שונה 100%). נרמלה ל-0–4 לסדר גודל דומה לrDiff
      const sDiff = sizeInput && dSize ? Math.abs(dSize - sizeInput) / sizeInput * 4 : 2;
      const relevance = rDiff * 3 + sDiff;
      return { d, relevance, recency: d.dealDate };
    })
    .sort((a, b) => a.relevance - b.relevance || (a.recency < b.recency ? 1 : -1))
    .slice(0, 12)
    .map(({ d }) => ({
      dealDate: d.dealDate,
      price: d.price,
      propertyType: d.propertyType ?? "apartment",
      rooms: d.rooms,
      areaSqm: d.areaSqm,
      plotSqm: d.plotSqm,
      floor: d.floor,
      yearBuilt: d.yearBuilt ?? null,
      dealNature: d.dealNature ?? null,
      street: d.street,
      houseNumber: d.houseNumber ?? null,
      address: d.address ?? null,
      neighborhood: d.neighborhood ?? null,
      pricePerSqm: d.pricePerSqm,
    }));
}

/**
 * בחירת עסקאות השוואה לתצוגה עם עדיפות גיאוגרפית: בניין → רחוב → שכונה.
 * כל העסקאות הרלוונטיות (לפי גודל/חדרים) ממוינות לפי tier גיאוגרפי קודם,
 * ואחר-כך לפי רלוונטיות — כך שעסקאות בניין תמיד יופענה ראשונות גם אם יש רק 1-2.
 */
function buildComparableDeals(
  pool: Deal[],          // pool ברמת שכונה, מסונן לפי propertyType + rooms
  input: PropertyInput,
  ptype: string,
  radiusMeters?: number | null, // הרדיוס שנבחר להערכה (אם קיים)
): ComparableDeal[] {
  const sx = input.streetX ?? null;
  const sy = input.streetY ?? null;
  // סנן עסקאות חלקיות/זכויות לפני הצגה
  const minPps = MIN_PPSQM[ptype] ?? 5_000;
  pool = pool.filter((d) => d.pricePerSqm == null || d.pricePerSqm >= minPps);

  // אין קואורדינטות → בחירה רגילה ללא עדיפות גיאוגרפית
  if (sx == null || sy == null) return pickComparables(pool, input, ptype);

  const isLand = ptype === "land";
  // לבית: composite size (בנוי + 0.4×מגרש) — מביא עסקאות עם מגרש דומה לפני עסקאות ללא מגרש
  const sizeInput = subjectSize(input, ptype, isLand);
  const sizeOf    = (d: Deal) => compSize(d, ptype, isLand);

  const pctTight = ptype === "house" ? 0.25 : null;
  const pctWide  = ptype === "house" ? 0.55 : null;
  const absTight = pctTight && sizeInput ? Math.max(MAX_SQM_DIFF, Math.round(sizeInput * pctTight)) : MAX_SQM_DIFF;
  const absWide  = pctWide  && sizeInput ? Math.max(MAX_SQM_WIDE, Math.round(sizeInput * pctWide))  : MAX_SQM_WIDE;

  // סינון גודל/חדרים על כל ה-pool (אותה שרשרת fallback כמו pickComparables)
  const base = pool.filter((d) => d.price > 0 && sizeOf(d) != null);
  const szF  = (diff: number, p: Deal[]) =>
    sizeInput ? p.filter((d) => Math.abs((sizeOf(d) ?? 0) - sizeInput) <= diff) : p;
  const rmF  = (diff: number, p: Deal[]) =>
    !isLand && input.rooms
      ? p.filter((d) => d.rooms == null || Math.abs(d.rooms - input.rooms!) <= diff + 0.5)
      : p;

  let filtered = base;
  for (const [sqm, rm] of [[absTight, MAX_ROOM_DIFF], [absTight, MAX_ROOM_WIDE],
                            [absWide,  MAX_ROOM_DIFF], [absWide,  MAX_ROOM_WIDE]] as [number, number][]) {
    const c = rmF(rm, szF(sqm, base));
    if (c.length >= MIN_COMPARABLES) { filtered = c; break; }
  }
  if (filtered.length < MIN_COMPARABLES) filtered = base;

  // tier: עדיפות לטקסט (שם רחוב + מספר בית) — אמין יותר כשכל עסקאות הרחוב שמורות עם קואורדינטה זהה
  const STREET_PREFIX_RE = /^(שד'?|שדרות|רחוב|רח')\s*/i;
  const normSt = (s: string) => s.replace(STREET_PREFIX_RE, "").trim();
  const inStreetNorm = input.streetName ? normSt(input.streetName) : null;

  // תמיד כלול עסקאות מאותו מספר בית מדויק — גם אם נסננו ע"י גודל/חדרים.
  // אלו הן העסקאות הרלוונטיות ביותר למשתמש, יש להציגן ללא תלות בשטח.
  if (inStreetNorm && input.houseNumber) {
    const ihnExact = parseInt(input.houseNumber);
    if (!isNaN(ihnExact)) {
      // חפש ב-pool המקורי (לפני סינון גודל) — base כולל deals עם price + sizeOf(d) != null
      // אבל deals בדיוק מאותו בניין עשויים להיות ב-pool עם sizeOf(d)=null — חפש ב-pool ישירות
      const exactBldg = pool.filter(d => {
        if (!d.price || !d.street) return false;
        const ds = normSt(d.street);
        if (!(ds === inStreetNorm || inStreetNorm.includes(ds))) return false;
        const dhn = parseInt(d.houseNumber ?? '');
        return !isNaN(dhn) && dhn === ihnExact;
      });
      if (exactBldg.length > 0) {
        const inFiltered = new Set(filtered);
        const missing = exactBldg.filter(d => !inFiltered.has(d));
        if (missing.length > 0) filtered = [...missing, ...filtered];
      }
    }
  }
  const BUILDING_HN_RANGE = 0; // מספר זהה בדיוק = אותו בניין (97/99 ≠ 98, גם אם סמוכים)

  const MAX_RADIUS = Math.max(radiusMeters ?? 0, COMP_RADIUS_LADDER[COMP_RADIUS_LADDER.length - 1]);
  const tier = (d: Deal): 0 | 1 | 2 | 3 => {
    // בדיקה טקסטואלית ראשונה — מתגברת על בעיית קואורדינטת-מרכז-רחוב
    if (inStreetNorm && d.street) {
      const ds = normSt(d.street);
      // אסור: ds.includes(inStreetNorm) — מונע false-match ("אבא הלל סילבר" ← "אבא הלל")
      const sameStreet = ds === inStreetNorm || inStreetNorm.includes(ds);
      if (sameStreet) {
        if (input.houseNumber && d.houseNumber) {
          const ihn = parseInt(input.houseNumber);
          const dhn = parseInt(d.houseNumber);
          if (!isNaN(ihn) && !isNaN(dhn) && Math.abs(dhn - ihn) <= BUILDING_HN_RANGE)
            return 0; // אותו בניין / בניין צמוד
        }
        return 1; // אותו רחוב
      }
    }
    // fallback: קואורדינטות — match גיאוגרפי בלבד, לא מאשר "אותו רחוב"
    // tier 1 (רחוב) שמור לאישור טקסטואלי בלבד; geo ≤350מ' = "קרבת מקום" (tier 2)
    if (d.x == null || d.y == null || sx == null || sy == null) return 3;
    const dist = itmDistance(sx, sy, d.x, d.y);
    if (dist <= BUILDING_RADIUS) return 0;
    if (dist <= MAX_RADIUS)      return 2;
    return 3;
  };

  const TIER_LABELS: Record<number, "building" | "street" | "radius" | "neighborhood"> = {
    0: "building", 1: "street", 2: "radius", 3: "neighborhood",
  };

  // קרבת מספר בית לחישוב עדיפות בתוך tier (0 = מדויק/סמוך מאוד, 1 = אחר)
  const hnProximity = (d: Deal): number => {
    if (!input.houseNumber || !d.houseNumber) return 1;
    const ihn = parseInt(input.houseNumber);
    const dhn = parseInt(d.houseNumber);
    if (isNaN(ihn) || isNaN(dhn)) return 1;
    return Math.abs(dhn - ihn) <= 2 ? 0 : 1; // ±2 מספרים = אותו בניין ממש
  };

  return filtered
    .map((d) => {
      const rDiff = !isLand && input.rooms && d.rooms ? Math.abs(d.rooms - input.rooms) : 0;
      const sz    = sizeOf(d);
      const sDiff = sizeInput && sz ? Math.abs(sz - sizeInput) / sizeInput * 4 : 2;
      const t = tier(d) as number;
      const hn = hnProximity(d);
      return { d, tier: t, hnProx: hn, relevance: rDiff * 3 + sDiff, recency: d.dealDate };
    })
    // מיון: tier → קרבת מספר בית → רלוונטיות → עדכניות
    // (בתוך אותו tier, כתובת מדויקת קודמת לפני match מושלם של חדרים)
    .sort((a, b) =>
      a.tier - b.tier ||
      a.hnProx - b.hnProx ||
      a.relevance - b.relevance ||
      (a.recency < b.recency ? 1 : -1)
    )
    .slice(0, 12)
    .map(({ d, tier: t }) => ({
      dealDate:     d.dealDate,
      price:        d.price,
      propertyType: d.propertyType ?? "apartment",
      rooms:        d.rooms,
      areaSqm:      d.areaSqm,
      plotSqm:      d.plotSqm,
      floor:        d.floor,
      yearBuilt:    d.yearBuilt ?? null,
      dealNature:   d.dealNature ?? null,
      street:       d.street,
      houseNumber:  d.houseNumber ?? null,
      address:      d.address ?? null,
      neighborhood: d.neighborhood ?? null,
      pricePerSqm:  d.pricePerSqm,
      tier:         TIER_LABELS[t],
    }));
}

/** מגמת ₪/מ"ר בשכונה — בקטסטים רבעוניים מ-24 ח' אחרונים (חציון לכל רבעון) */
function computeTrend(neighborhoodDeals: Deal[]): import("./types").PriceTrend | null {
  const vals = neighborhoodDeals.filter(
    (d) => d.pricePerSqm && d.pricePerSqm > 0 && d.dealDate,
  );
  if (vals.length < 8) return null; // לא מספיק נתונים למגמה אמינה
  // קיבוץ לרבעונים
  const buckets = new Map<string, number[]>();
  for (const d of vals) {
    const [y, m] = d.dealDate.split("-").map(Number);
    const q = Math.floor((m - 1) / 3) + 1;
    const key = `${y}-Q${q}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(d.pricePerSqm!);
  }
  const points = [...buckets.entries()]
    .map(([label, arr]) => ({ label, ppsqm: Math.round(percentile(arr, 50)) }))
    .filter((p) => p.ppsqm > 0)
    .sort((a, b) => (a.label < b.label ? -1 : 1));
  if (points.length < 3) return null;
  const first = points[0].ppsqm;
  const last = points[points.length - 1].ppsqm;
  const changePct = first > 0 ? Math.round(((last - first) / first) * 100) : 0;
  // טווח חודשים מקורב לפי מס' הרבעונים
  return { points, changePct, months: points.length * 3 };
}

function confidenceFromCount(n: number): "high" | "medium" | "low" {
  if (n >= 25) return "high";
  if (n >= 10) return "medium";
  return "low";
}

/** percentile עם אינטרפולציה ליניארית (p בין 0 ל-100) */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (rank - low) * (sorted[high] - sorted[low]);
}

/** עסקה שמופיעה פעמיים במאגר (מזהה שונה, אותם פרטים) נספרת פעם אחת */
export function uniqueDeals(deals: Deal[]): Deal[] {
  const seen = new Set<string>();
  return deals.filter((d) => {
    const key = [d.street, d.houseNumber, d.dealDate, original(d).price, d.areaSqm, d.floor].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** אחוזון משוקלל של זוגות [ערך, משקל] */
function weightedPercentile(pairs: [number, number][], p: number): number {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((s, x) => s + x[1], 0);
  let acc = 0;
  for (const [value, weight] of sorted) {
    acc += weight;
    if (acc >= total * (p / 100)) return value;
  }
  return sorted[sorted.length - 1][0];
}

/**
 * גישת ההשוואה לדירה: מתאימים כל עסקה לנכס (שטח, קומה), משקללים לפי קרבה בזמן, בניין ושטח,
 * ולוקחים חציון משוקלל. עסקאות מסכימות ורבות → טווח צר; מפוזרות או מעטות → טווח רחב.
 */
export function appraiseApartment(
  deals: Deal[],
  input: Pick<PropertyInput, "areaSqm" | "floor" | "houseNumber">,
  refISO: string,
  minPpsqm: number,
): { ppsqm: number; half: number } | null {
  const area = input.areaSqm;
  if (!area) return null;
  const hn = parseInt(input.houseNumber ?? "");
  const pairs: [number, number][] = [];
  for (const d of deals) {
    if (d.pricePerSqm == null || !isFinite(d.pricePerSqm) || d.pricePerSqm < minPpsqm || !d.areaSqm) continue;
    let value = d.pricePerSqm * Math.pow(d.areaSqm / area, APPRAISAL.sizeElasticity);
    if (input.floor != null && d.floor != null) {
      const diff = Math.max(-APPRAISAL.floorMaxDiff, Math.min(APPRAISAL.floorMaxDiff, input.floor - d.floor));
      value *= 1 + APPRAISAL.floorStep * diff;
    }
    const years = Math.max(0, (Date.parse(refISO) - Date.parse(d.dealDate)) / (365.25 * 864e5));
    const sameBuilding = !isNaN(hn) && parseInt(d.houseNumber ?? "") === hn;
    const weight =
      Math.exp(-years / APPRAISAL.recencyYears) *
      (sameBuilding ? APPRAISAL.sameBuildingWeight : 1) *
      Math.exp(-Math.abs(d.areaSqm - area) / area / APPRAISAL.sizeWeightScale);
    pairs.push([value, weight]);
  }
  if (pairs.length < MIN_DEALS_FOR_ESTIMATE) return null;
  const total = pairs.reduce((s, x) => s + x[1], 0);
  if (!(total > 0)) return null;
  const ppsqm = weightedPercentile(pairs, 50);
  const effectiveDeals = total ** 2 / pairs.reduce((s, x) => s + x[1] ** 2, 0);
  const dispersion = (weightedPercentile(pairs, 75) - weightedPercentile(pairs, 25)) / 2 / ppsqm;
  const half = Math.max(
    APPRAISAL.rangeMin,
    APPRAISAL.rangeBase + APPRAISAL.rangeDispersion * dispersion + APPRAISAL.rangeSample / Math.sqrt(effectiveDeals),
  );
  return { ppsqm, half };
}

/** קצב שינוי שנתי של ₪/מ"ר (שיפוע לוג-ליניארי), או 0 כשאין מספיק עסקאות. */
export function annualTrend(deals: Deal[], minPpsqm: number): number {
  const pts = deals
    .filter((d) => d.pricePerSqm != null && d.pricePerSqm >= minPpsqm && isFinite(d.pricePerSqm) && d.dealDate)
    .map((d) => ({ t: Date.parse(d.dealDate) / (365.25 * 864e5), y: Math.log(d.pricePerSqm!) }));
  if (pts.length < TREND_MIN_DEALS) return 0;
  const mt = pts.reduce((a, p) => a + p.t, 0) / pts.length;
  const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  let num = 0, den = 0;
  for (const p of pts) { num += (p.t - mt) * (p.y - my); den += (p.t - mt) ** 2; }
  if (den === 0) return 0;
  const g = Math.exp(num / den) - 1;
  return Math.max(-TREND_MAX_ANNUAL, Math.min(TREND_MAX_ANNUAL, g));
}

/** עותק מותאם-זמן → העסקה המקורית (לתצוגה מציגים תמיד את המחיר האמיתי) */
const ORIGINAL = new WeakMap<Deal, Deal>();
const original = (d: Deal): Deal => ORIGINAL.get(d) ?? d;

/** ערך המדד האחרון שנסגר עד החודש הנתון (חלון של 6 חודשים שמסתיים בו) */
function indexAt(index: Record<string, number>, month: string): number | null {
  let last: string | null = null;
  for (const m of Object.keys(index)) if (m <= month && (!last || m > last)) last = m;
  return last ? index[last] : null;
}

function shiftMonth(month: string, by: number): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
}

/** מצמיד עסקה למחירי השוק בתאריך היעד; null כשאין מדד לתקופה (לא מעבר לחודש שלפני היעד) */
function adjustToMarket(d: Deal, index: Record<string, number> | null, refISO: string): Deal | null {
  if (!index) return null;
  const lastMonth = shiftMonth(refISO.slice(0, 7), -1);
  // המדד נגרר 3 חודשים (חלון 6 ח') — נקודת ההשוואה לעסקה היא 3 חודשים אחריה
  const dealMonth = shiftMonth(d.dealDate.slice(0, 7), 3);
  const now = indexAt(index, lastMonth);
  const then = indexAt(index, dealMonth < lastMonth ? dealMonth : lastMonth);
  if (!now || !then) return null;
  const f = Math.max(1 - MARKET_INDEX_MAX_CHANGE, Math.min(1 + MARKET_INDEX_MAX_CHANGE, now / then));
  const adj = { ...d, price: Math.round(d.price * f), pricePerSqm: d.pricePerSqm != null ? Math.round(d.pricePerSqm * f) : d.pricePerSqm };
  ORIGINAL.set(adj, original(d));
  return adj;
}

/** מעתיק עסקה עם ₪/מ"ר ומחיר מוצמדים לתאריך היעד לפי קצב שנתי g. */
function adjustToDate(d: Deal, g: number, refISO: string): Deal {
  if (!g) return d;
  const years = (Date.parse(refISO) - Date.parse(d.dealDate)) / (365.25 * 864e5);
  if (!(years > 0)) return d;
  const f = Math.pow(1 + g, years);
  const adj = { ...d, price: Math.round(d.price * f), pricePerSqm: d.pricePerSqm != null ? Math.round(d.pricePerSqm * f) : d.pricePerSqm };
  ORIGINAL.set(adj, original(d));
  return adj;
}
