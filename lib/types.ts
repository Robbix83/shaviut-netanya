// ===== מבני נתונים מרכזיים =====

/** סוג הנכס. apartment=דירה, house=בית צמוד-קרקע, land=מגרש/קרקע */
export type PropertyType = "apartment" | "house" | "land";

/** עסקת נדל"ן בודדת (מנורמלת ממאגר רשות המסים / nadlan.gov.il) */
export interface Deal {
  /** מזהה ייחודי יציב (גוש-חלקה-תת + תאריך + מחיר) */
  id: string;
  dealDate: string; // ISO yyyy-mm-dd
  price: number; // ש"ח
  propertyType: PropertyType; // נגזר מ-dealNature
  rooms: number | null;
  areaSqm: number | null; // שטח בנוי במ"ר (לקרקע: null)
  plotSqm: number | null; // שטח מגרש במ"ר (לבית/קרקע)
  floor: number | null;
  yearBuilt: number | null;
  dealNature: string | null; // למשל "דירה בבית קומות"
  address: string | null;   // כתובת מלאה (אם קיימת)
  houseNumber: string | null; // מספר בית (אם קיים בנתוני נדל"ן)
  street: string | null;
  neighborhoodId: string; // UNIQ_ID של נדל"ן
  neighborhood: string | null;
  settlement: string; // "נתניה"
  x: number | null; // ITM
  y: number | null;
  pricePerSqm: number | null; // נגזר: price / areaSqm
}

/** שכונה (יחידת האזור שעליה מחשבים שווי) */
export interface Neighborhood {
  id: string; // UNIQ_ID
  name: string;
  settlement: string;
  x: number | null;
  y: number | null;
  dealCount?: number;
}

/** תוצאת הערכת שווי המוחזרת למשתמש */
export interface Valuation {
  estimateLow: number;
  estimateHigh: number;
  estimateMid: number;
  pricePerSqmLow: number;
  pricePerSqmHigh: number;
  pricePerSqmMid: number;
  /** האם המחיר למ"ר מתייחס לשטח בנוי (דירה/בית) או לשטח מגרש (קרקע) */
  pricePerSqmBasis: "built" | "plot";
  propertyType: PropertyType;
  basedOnDeals: number; // כמה עסקאות שימשו לחישוב
  windowMonths: number; // חלון הזמן בפועל (6/12/24 ח')
  floorAdjusted?: boolean; // האם ההשוואות סוננו לקומה דומה (±2)
  compRadiusMeters?: number | null; // רדיוס שבו נבחרו ההשוואות (null = שכונה מלאה)
  compSearchScope?: "building" | "street" | "radius" | "neighborhood"; // שלב ההיררכיה שנמצאו בו
  priceTrend?: PriceTrend | null; // מגמת ₪/מ"ר בשכונה לאורך זמן
  neighborhood: string | null;
  comparableDeals: ComparableDeal[]; // עסקאות לדוגמה להצגה
  buildingRights?: BuildingRights | null; // נמשך מ-GIS (שלב מאוחר יותר)
  renewal?: RenewalInfo | null; // התחדשות עירונית באזור (מקור: הרשות להתחדשות עירונית)
  confidence: "high" | "medium" | "low";
  asOf: string; // עד איזה תאריך הנתונים מעודכנים
  /** האם מודל ה-composite (בנוי+מגרש) הופעל בפועל — false לבית שאין לו plotSqm בעסקאות ההשוואה */
  compositeUsed?: boolean;
  /** true = נכס הוא בית עם מגרש משמעותי (>200מ"ר) אבל ההערכה לא כוללת את ערך המגרש
   *  (כי עסקאות ההשוואה חסרות נתוני plotSqm) */
  plotNotValued?: boolean;
}

/** עסקה לדוגמה שמוצגת למשתמש כ"הוכחה" */
export interface ComparableDeal {
  dealDate: string;
  price: number;
  rooms: number | null;
  areaSqm: number | null;
  plotSqm: number | null;
  floor: number | null;
  yearBuilt: number | null;
  dealNature: string | null;
  street: string | null;
  houseNumber: string | null;
  address: string | null;
  neighborhood: string | null;
  pricePerSqm: number | null;
  /** קרבה גיאוגרפית לנכס — בניין → רחוב → רדיוס → שכונה */
  tier?: "building" | "street" | "radius" | "neighborhood";
}

/** זכויות בנייה / פוטנציאל (נמשך ממקורות GIS — שלב 3) */
export interface BuildingRights {
  landUse: string | null; // ייעוד קרקע (מגורים/חקלאי/מסחרי...)
  plans: string[]; // מספרי תב"ע רלוונטיים
  buildingPercent: number | null; // אחוזי בנייה (אם זמין מובנה)
  maxUnits: number | null; // יח"ד מותרות (אם זמין)
  note: string | null; // אינדיקציה/הסתייגות
  sources: string[]; // מקורות המידע
}

/** מגמת מחירים בשכונה (₪/מ"ר לאורך זמן) */
export interface PriceTrend {
  points: { label: string; ppsqm: number }[]; // רבעונים כרונולוגיים
  changePct: number; // אחוז שינוי על פני התקופה
  months: number; // טווח בחודשים
}

/** מתחם התחדשות בודד בקרבת הכתובת */
export interface NearbyComplex {
  name: string;
  distanceMeters: number;
  tier: "veryClose" | "near"; // ≤150מ' / ≤500מ'
  addedUnits: number;
  mapLink: string;
}

/** התחדשות עירונית בקרבת הכתובת (תמ"א/פינוי-בינוי) — מקור: הרשות להתחדשות עירונית */
export interface RenewalInfo {
  nearby: NearbyComplex[]; // מתחמים ברדיוס (≤500מ'), ממוינים לפי מרחק
  moreNearbyCount: number; // מתחמים נוספים 500–1000מ' (שורת סיכום בלבד)
  complexes: number; // מס' מתחמים (בשכונה — לתצוגת fallback)
  addedUnits: number; // יח"ד נוספות (לפי הקשר)
  examples: string[]; // לתצוגת fallback (ללא קואורדינטות)
  mapLink: string;
  cityComplexes: number; // סה"כ מתחמים בעיר
  neighborhoodOnly: boolean; // true = אין קואורדינטות לכתובת → תצוגת שכונה
  asOf: string;
}

/** פרטי הנכס שהמשתמש הזין */
export interface PropertyInput {
  neighborhoodId: string;
  neighborhood?: string | null;
  propertyType?: PropertyType; // ברירת מחדל: apartment
  rooms?: number | null;
  areaSqm?: number | null; // שטח בנוי
  plotSqm?: number | null; // שטח מגרש (בית/קרקע)
  floor?: number | null;
  yearBuilt?: number | null; // שנת בנייה — פילטר קריטי (ישן≠חדש)
  houseNumber?: string | null; // מספר בית — להצמדה לבניין הספציפי
  streetName?: string | null;  // שם הרחוב — לסינון לפי שם כשהקואורדינטות גסות
  streetX?: number | null; // קואורדינטת הרחוב שנבחר (ITM) — לסינון לפי מרחק
  streetY?: number | null;
}

/** ליד שנקלט */
export interface Lead {
  id?: string;
  createdAt?: string;
  name: string;
  phone: string;
  email?: string | null;
  address: string | null;
  neighborhood: string | null;
  propertyType?: PropertyType;
  rooms: number | null;
  areaSqm: number | null;
  plotSqm?: number | null;
  floor?: number | null;
  houseNumber?: string | null;
  estimateLow: number | null;
  estimateHigh: number | null;
  source: string | null; // utm / campaign
  consent: boolean; // = consentReport (תאימות לאחור)
  // --- מטא-דאטה של הסכמה (חוק הגנת הפרטיות תיקון 13 + חוק הספאם) ---
  sellTiming?: string | null; // now / year / curious — סינון לידים חמים
  consentReport?: boolean; // הסכמה לקבלת הדוח (חובה)
  consentMarketing?: boolean; // הסכמה לדיוור שיווקי (רשות)
  consentWordingVersion?: string | null;
  consentAt?: string | null; // חותמת זמן ההסכמה
  optOutAt?: string | null; // חותמת הסרה מדיוור
  alertOptIn?: boolean; // נרשם להתראה על עסקאות דומות חדשות באזור
  lastAlertAt?: string | null; // חותמת ההתראה האחרונה ששלחנו (למניעת כפילות)
  status?: LeadStatus;
  tabuStatus?: TabuStatus | null; // סטטוס בדיקת נסח טאבו (מעודכן ידנית)
  tabuOrderedAt?: string | null; // מתי הוזמן הנסח
  tabuNotes?: string | null; // הערות חופשיות מהמתווך על הנסח
}

export type LeadStatus = "new" | "contacted" | "in_progress" | "closed" | "not_relevant";

/** סטטוס בדיקת נסח טאבו — מעודכן ידנית ע"י המתווך */
export type TabuStatus = "pending" | "ordered" | "clean" | "needs_review";
