"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { trackEvent } from "@/lib/analytics";
import AddressSearch, { StreetSuggestion } from "./AddressSearch";
import CbsPanel from "./CbsPanel";
import MavatPanel from "./MavatPanel";
import AccessibilityPanel from "./AccessibilityPanel";
import {
  isHouseNumberRequired,
  isValidHouseNumber,
  formatEvaluatedAddress,
  HOUSE_NUMBER_REQUIRED_MESSAGE,
} from "@/lib/houseNumberRule";
import { formatComparableAddress } from "@/lib/comparableAddress";

type PropertyType = "apartment" | "house" | "land";

interface TeaserData {
  cbs:    { score: number; precision: "high" | "city" } | null;
  mavat:  { upside: boolean; demolition: boolean } | null;
  access: { score: number; nearest: { category: string; distanceMeters: number; found: boolean }[] } | null;
}

interface NeighborhoodOpt {
  id: string;
  name: string;
  x?: number;
  y?: number;
}
interface Comparable {
  dealDate: string;
  price: number;
  propertyType: PropertyType;
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
  tier?: "building" | "street" | "radius" | "neighborhood";
}
interface Valuation {
  estimateLow: number;
  estimateMid: number;
  estimateHigh: number;
  pricePerSqmLow: number;
  pricePerSqmMid: number;
  pricePerSqmHigh: number;
  pricePerSqmBasis: "built" | "plot";
  propertyType: PropertyType;
  basedOnDeals: number;
  windowMonths: number;
  neighborhood: string | null;
  comparableDeals: Comparable[];
  floorAdjusted?: boolean;
  compRadiusMeters?: number | null;
  compSearchScope?: "building" | "street" | "radius" | "neighborhood";
  renewal?: RenewalInfo | null;
  priceTrend?: PriceTrend | null;
  confidence: "high" | "medium" | "low";
  preliminary?: boolean;
  asOf: string;
  compositeUsed?: boolean;
  plotNotValued?: boolean;
  /** קרקע או נכס בבנייה: אין אומדן מספרי (הסכומים 0), המתווך בודק אישית */
  manualReview?: boolean;
  manualReviewReason?: "land" | "off_plan";
}
interface PriceTrend {
  points: { label: string; ppsqm: number }[];
  changePct: number;
  months: number;
}
interface NearbyComplex {
  name: string;
  distanceMeters: number;
  tier: "veryClose" | "near";
  addedUnits: number;
  mapLink: string;
}
interface RenewalInfo {
  nearby: NearbyComplex[];
  moreNearbyCount: number;
  complexes: number;
  addedUnits: number;
  examples: string[];
  mapLink: string;
  cityComplexes: number;
  neighborhoodOnly: boolean;
  asOf: string;
}

// smooth scrolling only when the user hasn't asked for reduced motion
const scrollBehavior = (): ScrollBehavior =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
const nis = (n: number) => "₪" + Math.round(n).toLocaleString("he-IL");
// "2025-09-19" → "09/2025"
const fmtDate = (iso: string) => {
  if (!iso) return "";
  const [y, m] = iso.split("-");
  return m && y ? `${m}/${y}` : iso;
};
const ROOM_OPTIONS = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6];
const PROPERTY_TYPES: { value: PropertyType; label: string; icon: string }[] = [
  { value: "apartment", label: "דירה", icon: "🏢" },
  { value: "house", label: "בית פרטי", icon: "🏡" },
  { value: "land", label: "מגרש / קרקע", icon: "🌳" },
];

// פרטי המתווך — חובה חוקית (חוק המתווכים) + אות אמון. ערוך לפרטים האמיתיים שלך.
const AGENT = {
  name: process.env.NEXT_PUBLIC_AGENT_NAME || "שם המתווך",
  license: process.env.NEXT_PUBLIC_AGENT_LICENSE || "0000000",
  photo: process.env.NEXT_PUBLIC_AGENT_PHOTO || "", // URL לתמונה (אופציונלי)
  // ציטוט אמיתי בלבד — אם לא הוגדר, לא מציגים ציטוט (לא ממציאים המלצות).
  testimonial: process.env.NEXT_PUBLIC_AGENT_TESTIMONIAL || "",
  // תג "מאומת" רק כשהוגדר מספר רישיון אמיתי.
  licensed: Boolean(process.env.NEXT_PUBLIC_AGENT_LICENSE),
};

// מתי המוכר שוקל למכור — מסנן לידים חמים
const SELL_TIMING = [
  { value: "now", label: "בקרוב (עד 3 ח׳)" },
  { value: "year", label: "בשנה הקרובה" },
  { value: "curious", label: "רק בודק/ת שווי" },
];

// "מה משפיע על השווי" — תגיות אינטראקטיביות שמתאימות את ההערכה (כלי עזר משוער, לא נתון)
const VALUE_FACTORS: { key: string; label: string; icon: string; mult: number }[] = [
  { key: "renovated", label: "משופצת/חדשה", icon: "🔨", mult: 0.08 },
  { key: "sea", label: "נוף לים", icon: "🌊", mult: 0.12 },
  { key: "parking", label: "חניה", icon: "🅿️", mult: 0.05 },
  { key: "elevator", label: "מעלית", icon: "🛗", mult: 0.05 },
  { key: "balcony", label: "מרפסת/סוכה", icon: "🪟", mult: 0.04 },
  { key: "needsReno", label: "דרוש שיפוץ", icon: "🧰", mult: -0.1 },
];
/** ביטחון נמוך והטווח נחתך: מסמנים כהערכה ראשונית ומציעים בדיקה אישית */
function PreliminaryNote({ onContact }: { onContact?: () => void }) {
  return (
    <div className="mt-2 space-y-1 text-sm text-slate-700">
      <p className="font-semibold">הערכה ראשונית</p>
      <p>
        לכתובת הזו יש פחות עסקאות דומות.{" "}
        {onContact ? (
          <button type="button" onClick={onContact} className="gh-press font-semibold text-brand underline underline-offset-2">
            לבדיקה אישית
          </button>
        ) : (
          "מומלץ לבקש בדיקה אישית."
        )}
      </p>
    </div>
  );
}

/** קרקע / נכס בבנייה: במקום מספר — הסבר קצר שהמתווך בודק אישית */
function ManualReviewNote({ reason }: { reason?: "land" | "off_plan" }) {
  const offPlan = reason === "off_plan";
  return (
    <div className="my-3 space-y-1">
      <p className="text-2xl font-black tracking-[-0.02em] text-brand sm:text-[1.7rem]">
        {offPlan ? "נכס בבנייה דורש בדיקה אישית" : "מגרשים דורשים בדיקה אישית"}
      </p>
      <p className="mx-auto max-w-sm text-sm text-slate-600">
        {offPlan
          ? "מחיר נכס שעוד לא נמסר תלוי בפרויקט, במפרט ובמועד המסירה, ועסקאות יד שנייה בסביבה לא משקפות אותו. השאירו פרטים ונחזור אליכם עם הערכה."
          : 'מחיר מגרש תלוי בזכויות הבנייה, בתב"ע ובחלקים בבעלות, ואלה לא מופיעים בנתונים הציבוריים. השאירו פרטים ונחזור אליכם עם הערכה.'}
      </p>
    </div>
  );
}
/** כותרת קטנה מעל הטווח / ההודעה */
/** דירה: הטווח צר (±10%) ולא מכסה כל מכירה — אומרים זאת ישר */
const ESTIMATE_NOTE = "הערכה ראשונית לפי עסקאות באזור. המחיר הסופי תלוי במצב הדירה.";

function resultLabel(v: { manualReview?: boolean; manualReviewReason?: "land" | "off_plan" }) {
  if (!v.manualReview) return "טווח שווי משוער";
  return v.manualReviewReason === "off_plan" ? "נכס בבנייה" : "מגרש";
}

function ValueFactors({ low, high }: { low: number; high: number }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const factor = [...sel].reduce(
    (f, k) => f * (1 + (VALUE_FACTORS.find((x) => x.key === k)?.mult ?? 0)),
    1,
  );
  const r = (n: number) => Math.round((n * factor) / 1000) * 1000;
  const changed = sel.size > 0;
  return (
    <div className="rounded-3xl bg-butter-soft p-4">
      <p className="text-[15px] font-bold text-ink">מה משפיע על השווי שלך?</p>
      <p className="mt-0.5 text-xs text-slate-500">סמנו מאפיינים כדי לדייק את ההערכה</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {VALUE_FACTORS.map((f) => {
          const on = sel.has(f.key);
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setSel((s) => { const n = new Set(s); n.has(f.key) ? n.delete(f.key) : n.add(f.key); return n; })}
              aria-pressed={on}
              className={`gh-press rounded-full px-3 py-1.5 min-h-[44px] text-[13px] font-medium ${
                on
                  ? f.mult >= 0 ? "bg-ink text-white" : "bg-red-700 text-white"
                  : "bg-white text-slate-700"
              }`}
            >
              {f.label} <span className="tabular-nums opacity-70">{f.mult >= 0 ? "+" : ""}{Math.round(f.mult * 100)}%</span>
            </button>
          );
        })}
      </div>
      {changed && (
        <div className="gh-in mt-3 rounded-2xl bg-white p-3 text-center">
          <p className="text-xs font-medium text-slate-600">הערכה מותאמת (משוערת)</p>
          <p className="text-lg font-black tabular-nums text-brand">{nis(r(low))} – {nis(r(high))}</p>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">* התאמה משוערת בלבד — כלי עזר, אינו תחליף לבדיקת שמאי.</p>
    </div>
  );
}

// גרף מגמת מחירים — ₪/מ"ר רבעוני בשכונה
function TrendChart({ t }: { t: PriceTrend }) {
  const max = Math.max(...t.points.map((p) => p.ppsqm), 1);
  const min = Math.min(...t.points.map((p) => p.ppsqm));
  const up = t.changePct >= 0;
  return (
    <div className="rounded-3xl bg-butter-soft p-4">
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-bold text-ink">מגמת מחירים בשכונה</p>
        <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${up ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
          {up ? "▲" : "▼"} {Math.abs(t.changePct)}% ב-{Math.round(t.months / 12) >= 1 ? `${Math.round(t.months / 12)} שנים` : `${t.months} ח׳`}
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-1" style={{ height: 70 }} dir="ltr">
        {t.points.map((p, i) => {
          const h = 12 + ((p.ppsqm - min) / Math.max(max - min, 1)) * 50;
          return (
            <div key={i} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <div
                className={`w-full rounded-t ${i === t.points.length - 1 ? "bg-brand" : "bg-brand/25"}`}
                style={{ height: `${h}px` }}
                title={`${p.label}: ₪${p.ppsqm.toLocaleString("he-IL")}/מ"ר`}
              />
              <span className="text-[10px] tabular-nums text-slate-500">{(() => { const [y, q] = p.label.split("-"); return q ? `${q}/${y.slice(2)}` : p.label; })()}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-slate-500 text-center">₪/מ"ר חציוני לפי רבעון · מבוסס עסקאות אמיתיות</p>
    </div>
  );
}

// פאנל התחדשות עירונית — מתחמים בקרבת הכתובת (לפי מרחק אמיתי). מקור: הרשות להתחדשות עירונית. בלי חישוב אחוזים.
function RenewalPanel({ r }: { r: RenewalInfo }) {
  const hasNearby = r.nearby.length > 0;
  return (
    <div className="rounded-3xl bg-amber-50 p-4">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <p className="text-sm font-extrabold text-amber-900">
            {r.neighborhoodOnly ? "התחדשות עירונית בשכונה" : "התחדשות עירונית בקרבת הכתובת"}
          </p>

          {/* מסלול מדויק — מתחמים לפי מרחק */}
          {!r.neighborhoodOnly && hasNearby && (
            <>
              <p className="mt-1 text-xs text-amber-800">
                ייתכן שלנכס שלך <strong>פוטנציאל שווי לא ממומש</strong>:
              </p>
              <div className="mt-2 space-y-1.5">
                {r.nearby.slice(0, 4).map((c, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 rounded-xl bg-amber-100/60 px-2 py-1.5 text-xs">
                    <span className="font-medium text-amber-900">
                      {c.tier === "veryClose" ? "סמוך מאוד" : "בסמוך"} · {c.name}
                      {c.addedUnits ? ` · +${c.addedUnits} יח"ד` : ""}
                    </span>
                    <span className="shrink-0 whitespace-nowrap font-bold tabular-nums text-amber-800">~{c.distanceMeters} מ׳</span>
                  </div>
                ))}
              </div>
              {r.moreNearbyCount > 0 && (
                <p className="mt-1 text-xs text-amber-700">+ עוד {r.moreNearbyCount} מתחמים ברדיוס של ק״מ.</p>
              )}
            </>
          )}

          {/* fallback — אין קואורדינטות לכתובת */}
          {r.neighborhoodOnly && (
            <p className="mt-1 text-xs leading-relaxed text-amber-800">
              בשכונה מקודמים <strong>{r.complexes} מתחמי התחדשות</strong> (תמ"א 38 / פינוי-בינוי).
              לא ניתן לחשב מרחק מדויק לכתובת זו. ייתכן <strong>פוטנציאל שווי לא ממומש</strong>.
            </p>
          )}

          <p className="mt-2 rounded-lg bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
            מכירה לפני בירור זכויות עלולה לעלות לך מאות אלפי ₪. שווה לבדוק לפני שמחליטים.
          </p>
          {r.mapLink && (
            <a href={r.mapLink} target="_blank" rel="noreferrer"
              className="mt-1 inline-flex items-center min-h-[44px] px-1 text-xs font-medium text-amber-700 underline">
              למפת המתחמים הרשמית ←
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// תיאור עסקת השוואה לפי סוג נכס
function compDesc(c: Comparable): string {
  if (c.propertyType === "land") return `מגרש ${c.plotSqm ?? "?"} מ"ר`;
  if (c.propertyType === "house")
    return `${c.rooms ?? "?"} חד' · ${c.areaSqm ?? "?"} מ"ר בנוי${
      c.plotSqm ? ` · מגרש ${c.plotSqm} מ"ר` : ""
    }`;
  return `${c.rooms ?? "?"} חד' · ${c.areaSqm ?? "?"} מ"ר`;
}

function ReportSection({
  title, subtitle, children,
}: {
  title: string; subtitle: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-3xl bg-butter-soft overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 min-h-[52px] text-right"
      >
        <div>
          <p className="text-sm font-bold text-slate-800">{title}</p>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        <svg className={`h-4 w-4 text-slate-600 transition-transform duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && <div className="bg-white">{children}</div>}
    </div>
  );
}

const TIER_BADGE: Record<string, { label: string; cls: string }> = {
  building:     { label: "אותו בניין",   cls: "bg-brand/10 text-brand-dark border-brand/20" },
  street:       { label: "אותו רחוב",    cls: "bg-blue-50 text-blue-700 border-blue-200" },
  radius:       { label: "בקרבת מקום",   cls: "bg-slate-100 text-slate-600 border-slate-200" },
  neighborhood: { label: "שכונה",         cls: "bg-slate-100 text-slate-500 border-slate-200" },
};

function CompDealCard({ c }: { c: Comparable }) {
  const addr = formatComparableAddress(c.street, c.address, c.houseNumber, c.tier);

  const tierBadge = c.tier ? TIER_BADGE[c.tier] : null;

  return (
    <div className={`rounded-2xl px-4 py-3 text-sm ${
      c.tier === "building" ? "bg-white ring-2 ring-brand/25" : "bg-butter-soft"
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-[11rem] flex-1 space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            {addr.isRealAddress ? (
              <span className="min-w-0 font-semibold text-slate-800 [overflow-wrap:anywhere]">{addr.text}</span>
            ) : (
              <span className="text-slate-500 text-xs italic">{addr.text}</span>
            )}
            {tierBadge && (
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${tierBadge.cls}`}>
                {tierBadge.label}
              </span>
            )}
            {c.propertyType === "house" && c.dealNature ? (
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                {c.dealNature}
              </span>
            ) : c.propertyType !== "house" && c.floor != null ? (
              <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                קומה {c.floor}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-slate-500">
            {[compDesc(c), c.yearBuilt ? `בנ' ${c.yearBuilt}` : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="shrink-0 text-left">
          <p className="font-black tabular-nums text-ink">{nis(c.price)}</p>
          <p className="text-xs text-slate-500">
            {c.pricePerSqm ? `₪${c.pricePerSqm.toLocaleString("he-IL")}/מ"ר · ` : ""}
            {fmtDate(c.dealDate)}
          </p>
        </div>
      </div>
    </div>
  );
}

function ShevahSection({
  estimateMid,
  onScrollToForm,
}: {
  estimateMid: number;
  onScrollToForm: () => void;
}) {
  const [status, setStatus] = useState<"yes" | "no" | null>(null);
  const gain = Math.round(estimateMid * 0.35); // אומדן רווח גס (35% מהמחיר כרווח טיפוסי)
  const tax = Math.round(gain * 0.25);

  return (
    <div className="rounded-3xl bg-butter-soft p-4">
      <p className="text-[15px] font-bold text-ink">מה לגבי מס שבח?</p>
      <p className="mt-0.5 text-xs text-slate-500">שאלה שמוכרים רבים שוכחים לשאול לפני שחותמים</p>

      <p className="mt-3 text-sm text-slate-600">האם זו דירת המגורים היחידה שלכם?</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => { setStatus("yes"); trackEvent("shevah_only_property"); }}
          aria-pressed={status === "yes"}
          className={`gh-press flex-1 rounded-full py-2.5 min-h-[44px] text-sm font-medium ${
            status === "yes" ? "bg-ink font-bold text-white" : "bg-white text-slate-700"
          }`}
        >
          כן, יחידה
        </button>
        <button
          type="button"
          onClick={() => { setStatus("no"); trackEvent("shevah_not_only_property", { estimateMid }); }}
          aria-pressed={status === "no"}
          className={`gh-press flex-1 rounded-full py-2.5 min-h-[44px] text-sm font-medium ${
            status === "no" ? "bg-ink font-bold text-white" : "bg-white text-slate-700"
          }`}
        >
          לא, יש לי נוספות
        </button>
      </div>

      {status === "yes" && (
        <div className="gh-in mt-3 rounded-2xl bg-emerald-50 px-3 py-2.5">
          <p className="text-sm font-bold text-emerald-900">ייתכן שתהיו פטורים ממס שבח</p>
          <p className="mt-1 text-xs leading-relaxed text-green-700">
            על דירת מגורים יחידה קיים פטור מלא — בכפוף לתנאים (18 חודשי בעלות ועוד).
            מתווך מנוסה יוודא שאתם עומדים בתנאים ולא מפספסים זכות.
          </p>
        </div>
      )}

      {status === "no" && (
        <div className="gh-in mt-3 space-y-2">
          <div className="rounded-2xl bg-red-50 px-3 py-2.5">
            <p className="text-sm font-bold text-red-900">מס שבח — עלות שאסור לשכוח</p>
            <p className="mt-1 text-xs leading-relaxed text-red-700">
              על נכס שאינו דירה יחידה, מס שבח עשוי להגיע ל‑<strong>25%</strong> מהרווח.
              לפי ערך הנכס הנוכחי — הרווח הממוצע עשוי להניב{" "}
              <strong>מס של ₪{tax.toLocaleString("he-IL")} ומעלה</strong>.
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-red-700">
              יש פטורים, הנחות לינאריות ופטור לדירה חלופית שמתווך בקיא יכול לסייע למצות.{" "}
              <strong>מכירה ללא בדיקה עלולה לעלות לכם מאות אלפי ₪.</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={() => { trackEvent("shevah_cta_click"); onScrollToForm(); }}
            className="btn-primary w-full text-sm"
          >
            בואו נבדוק יחד מה ניתן לחסוך ←
          </button>
        </div>
      )}
    </div>
  );
}

export default function ValuationWizard() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const [propertyType, setPropertyType] = useState<PropertyType>("apartment");
  const [neighborhoods, setNeighborhoods] = useState<NeighborhoodOpt[]>([]);
  const [neighborhoodId, setNeighborhoodId] = useState("");
  const [address, setAddress] = useState("");
  const [selectedStreet, setSelectedStreet] = useState<StreetSuggestion | null>(null);
  const [houseNumber, setHouseNumber] = useState("");
  const [showNeighFallback, setShowNeighFallback] = useState(false);
  const [houseNumberNotFound, setHouseNumberNotFound] = useState(false);

  const [rooms, setRooms] = useState<number | null>(null);
  const [area, setArea] = useState<string>(""); // שטח בנוי
  const [plot, setPlot] = useState<string>(""); // שטח מגרש
  const [floor, setFloor] = useState<string>("");
  const [yearBuilt, setYearBuilt] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [valuation, setValuation] = useState<Valuation | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consentReport, setConsentReport] = useState(true); // חובה: דוח + פרטיות — מסומן מראש כי המשתמש ביקש את הדוח
  const [consentMarketing, setConsentMarketing] = useState(false); // רשות: שיווק
  const [alertOptIn, setAlertOptIn] = useState(false); // רשות: התראות על עסקאות דומות
  const [sellTiming, setSellTiming] = useState<string>(""); // מתי שוקלים למכור
  const [submitted, setSubmitted] = useState(false);
  const [teaserData, setTeaserData] = useState<TeaserData | null>(null);
  const leadFormRef = useRef<HTMLDivElement>(null);

  // OTP
  const [otpState, setOtpState] = useState<"idle" | "sending" | "sent" | "verifying">("idle");
  const [otpCode, setOtpCode] = useState("");
  const [otpToken, setOtpToken] = useState(() => {
    // שחזור token מ-sessionStorage אם הדף נרענן בזמן האימות
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("otp_token") || "";
    }
    return "";
  });
  const [otpCountdown, setOtpCountdown] = useState(0);

  const streetSuggestionRef = useRef<{ id: string; name: string } | null>(null);

  // כשמספר הבית משתנה — resolve שכונה לפי כתובת מלאה (רחוב + מספר)
  useEffect(() => {
    if (!selectedStreet?.street) return;
    const street = selectedStreet.street;
    const trimmed = houseNumber.trim();
    const timer = setTimeout(async () => {
      if (!trimmed) {
        setSelectedStreet((prev) => prev ? { ...prev, neighborhoodId: "", neighborhoodName: "" } : null);
        setHouseNumberNotFound(false);
        return;
      }

      const fullAddress = `${street} ${trimmed} נתניה`;
      let browserX: number | null = null;
      let browserY: number | null = null;
      let govmapReachable = false;

      // שלב א: גיאוקד מהדפדפן — govmap ציבורי, לא נחסם מדפדפן
      try {
        const gmRes = await fetch(
          `https://es.govmap.gov.il/TldSearch/api/DetailsByQuery?query=${encodeURIComponent(fullAddress)}&lyrs=16399&gid=govmap`,
          { signal: AbortSignal.timeout(4000) }
        );
        if (gmRes.ok) {
          const gmData = await gmRes.json();
          govmapReachable = true;
          const order: string[] = gmData.order || Object.keys(gmData.data || {});
          for (const type of order) {
            const first = gmData.data?.[type]?.[0];
            if (first?.X && first?.Y) { browserX = first.X; browserY = first.Y; break; }
          }
        }
      } catch { /* CORS / network — fallback שקט */ }

      // אם govmap היה נגיש ואמר שהכתובת לא קיימת — עצור כאן, אל תשאל את השרת
      if (govmapReachable && !browserX) {
        setHouseNumberNotFound(true);
        const s = streetSuggestionRef.current;
        if (s?.id) {
          setNeighborhoodId(s.id);
          setSelectedStreet((prev) =>
            prev ? { ...prev, neighborhoodId: s.id, neighborhoodName: s.name } : null
          );
        }
        return;
      }

      // שלב ב: resolve שכונה בשרת (govmap מצא x,y או לא היה נגיש)
      try {
        const body = browserX && browserY
          ? { street, x: browserX, y: browserY }
          : { street, address: fullAddress };
        const res = await fetch("/api/resolve-address", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const j = await res.json();
          if (j.neighborhoodId) {
            setNeighborhoodId(j.neighborhoodId);
            setHouseNumberNotFound(false);
            setSelectedStreet((prev) =>
              prev ? {
                ...prev,
                neighborhoodId: j.neighborhoodId,
                neighborhoodName: j.neighborhoodName,
                // עדכון קואורדינטות לרמת מספר בית — govmap גיאוקד את הכתובת המלאה
                x: browserX ?? prev.x,
                y: browserY ?? prev.y,
              } : null
            );
            return;
          }
        }
      } catch {}

      // fallback שקט — govmap לא היה נגיש (CORS), local lookup נכשל
      setHouseNumberNotFound(false);
      const s = streetSuggestionRef.current;
      if (s?.id) {
        setNeighborhoodId(s.id);
        setSelectedStreet((prev) =>
          prev ? { ...prev, neighborhoodId: s.id, neighborhoodName: s.name } : null
        );
      }
    }, 600);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseNumber, selectedStreet?.street]);

  const source = useRef<string>("");
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    source.current =
      p.get("utm_source") || p.get("utm_campaign") || document.referrer || "direct";
    fetch("/api/neighborhoods")
      .then((r) => r.json())
      .then((j) => setNeighborhoods(j.neighborhoods || []))
      .catch(() => {});
  }, []);

  const neighborhoodName = neighborhoods.find((n) => n.id === neighborhoodId)?.name || "";
  const neighborhoodCoords = neighborhoods.find((n) => n.id === neighborhoodId);
  // כתובת הנכס שהוערך — מהמצב הקיים של האשף (הרחוב/מספר בית שהמשתמש בפועל בחר/הזין),
  // לא שחזור מעסקאות ההשוואה.
  const evaluatedAddress = formatEvaluatedAddress(selectedStreet?.street ?? null, houseNumber);

  // טעינת נתוני teaser כשמגיעים לשלב 3
  useEffect(() => {
    if (step !== 3) return;
    const q = new URLSearchParams();
    if (neighborhoodName) q.set("neighborhood", neighborhoodName);
    const cx = selectedStreet?.x ?? neighborhoodCoords?.x;
    const cy = selectedStreet?.y ?? neighborhoodCoords?.y;
    if (cx) q.set("x", String(cx));
    if (cy) q.set("y", String(cy));
    fetch(`/api/teaser?${q}`)
      .then((r) => r.json())
      .then((j) => setTeaserData(j))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // countdown timer עבור OTP
  useEffect(() => {
    if (otpCountdown <= 0) return;
    const t = setInterval(() => setOtpCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [otpCountdown]);

  const fmtCountdown = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const isLand = propertyType === "land";
  const isHouse = propertyType === "house";
  const needsArea = !isLand; // דירה/בית
  const needsPlot = isLand || isHouse; // בית/מגרש
  const houseNumberRequired = isHouseNumberRequired(propertyType);

  const canCalc =
    (!needsArea || !!area) && (!needsPlot || !!plot) && (isLand || isHouse || !!rooms) &&
    isValidHouseNumber(propertyType, houseNumber);

  function validateSize(): string | null {
    if (needsArea) {
      const a = Number(area);
      const max = isHouse ? 1000 : 400;
      const min = isHouse ? 40 : 20;
      if (!a || a < min || a > max)
        return `נא להזין שטח בנוי ריאלי (${min}–${max} מ"ר)`;
    }
    if (needsPlot) {
      const p = Number(plot);
      if (!p || p < 100 || p > 5000) return 'נא להזין שטח מגרש ריאלי (100–5000 מ"ר)';
    }
    return null;
  }

  async function calcValuation() {
    setError(null);
    if (!isValidHouseNumber(propertyType, houseNumber)) return setError(HOUSE_NUMBER_REQUIRED_MESSAGE);
    const sizeErr = validateSize();
    if (sizeErr) return setError(sizeErr);
    setLoading(true);
    try {
      const r = await fetch("/api/valuation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          neighborhoodId,
          propertyType,
          rooms: isLand ? null : rooms,
          areaSqm: needsArea && area ? Number(area) : null,
          plotSqm: needsPlot && plot ? Number(plot) : null,
          floor: !isLand && floor ? Number(floor) : null,
          yearBuilt: yearBuilt ? Number(yearBuilt) : null,
          houseNumber: houseNumber.trim() || null,
          streetName: selectedStreet?.label ?? null,
          streetX: selectedStreet?.x ?? null,
          streetY: selectedStreet?.y ?? null,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.message || "אירעה שגיאה. נסו שוב.");
        return;
      }
      setValuation(j.valuation);
      trackEvent("valuation_viewed", {
        neighborhood: j.valuation.neighborhood,
        propertyType,
        rooms,
        confidence: j.valuation.confidence,
      });
      setStep(3);
    } catch {
      setError("בעיית תקשורת. נסו שוב.");
    } finally {
      setLoading(false);
    }
  }

  async function sendOTP() {
    setError(null);
    if (name.trim().length < 2) return setError("נא להזין שם מלא");
    if (!/^0\d{8,9}$/.test(phone.replace(/[-\s]/g, ""))) return setError("מספר טלפון לא תקין");
    if (!consentReport) return setError("נא לאשר קבלת הדוח (סעיף חובה)");
    setOtpState("sending");
    try {
      const r = await fetch("/api/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.replace(/[-\s]/g, ""), name: name.trim() }),
      });
      const j = await r.json();
      if (!r.ok) { setError(j.message || "שגיאה בשליחה."); setOtpState("idle"); return; }
      setOtpToken(j.token);
      // שמור token ב-sessionStorage — מגן מפני אובדן בעת רענון דף
      if (typeof window !== "undefined") sessionStorage.setItem("otp_token", j.token);
      trackEvent("otp_requested");
      setOtpState("sent");
      setOtpCountdown(300); // 5 דקות
      // בדוולופמנט: הצג בקונסולה
      if (j.devOtp) console.info(`[DEV] OTP for ${phone}: ${j.devOtp}`);
    } catch {
      setError("בעיית תקשורת. נסו שוב."); setOtpState("idle");
    }
  }

  async function verifyAndSubmit() {
    if (otpCode.trim().length !== 6) return setError("נא להזין קוד 6 ספרות");
    setError(null);
    setOtpState("verifying");
    try {
      const vr = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: otpToken, code: otpCode.trim() }),
      });
      const vj = await vr.json();
      if (!vj.valid) {
        setError(vj.message || "קוד שגוי.");
        setOtpState("sent");
        return;
      }
      // קוד אומת — שמור ליד
      await submitLead();
    } catch {
      setError("בעיית תקשורת. נסו שוב."); setOtpState("sent");
    }
  }

  async function submitLead() {
    setError(null);
    if (name.trim().length < 2) return setError("נא להזין שם מלא");
    if (!/^0\d{8,9}$/.test(phone.replace(/[-\s]/g, ""))) return setError("מספר טלפון לא תקין");
    if (!consentReport) return setError("נא לאשר קבלת הדוח");
    setLoading(true);
    try {
      const r = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone: phone.replace(/[-\s]/g, ""),
          address: address.trim() || neighborhoodName,
          neighborhood: valuation?.neighborhood || neighborhoodName,
          propertyType,
          rooms: isLand ? null : rooms,
          areaSqm: needsArea && area ? Number(area) : null,
          plotSqm: needsPlot && plot ? Number(plot) : null,
          floor: !isLand && floor ? Number(floor) : null,
          houseNumber: houseNumber.trim() || null,
          sellTiming,
          source: source.current,
          consent: consentReport, // תאימות לאחור
          consentReport,
          consentMarketing,
          alertOptIn,
          consentWordingVersion: "2026-06-v1",
          // קלט חישוב השווי — השרת מחשב מחדש ומתעלם מכל פלט שמגיע מהלקוח.
          valuationInput: {
            neighborhoodId,
            propertyType,
            rooms: isLand ? null : rooms,
            areaSqm: needsArea && area ? Number(area) : null,
            plotSqm: needsPlot && plot ? Number(plot) : null,
            floor: !isLand && floor ? Number(floor) : null,
            yearBuilt: yearBuilt ? Number(yearBuilt) : null,
            houseNumber: houseNumber.trim() || null,
            streetName: selectedStreet?.label ?? null,
            streetX: selectedStreet?.x ?? null,
            streetY: selectedStreet?.y ?? null,
          },
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.message || "אירעה שגיאה. נסו שוב.");
        return;
      }
      trackEvent("lead_submitted", { sellTiming, consentMarketing, alertOptIn });
      setSubmitted(true);
      setStep(4);
    } catch {
      setError("בעיית תקשורת. נסו שוב.");
    } finally {
      setLoading(false);
    }
  }

  // שורת מחיר-למ"ר + גודל, מותאמת לסוג הנכס
  const sizeSummary = (v: Valuation) => {
    const per = v.pricePerSqmBasis === "plot" ? 'למ"ר מגרש' : 'למ"ר בנוי';
    const sz = v.pricePerSqmBasis === "plot" ? `מגרש ${plot} מ"ר` : `${area} מ"ר`;
    return `≈ ${nis(v.pricePerSqmMid)} ${per} · ${sz}`;
  };

  return (
    <div className="mx-auto w-full max-w-xl rounded-3xl bg-white p-5 shadow-card sm:p-7">
      <Stepper step={step} />

      {/* שלב 1 — סוג נכס + מיקום */}
      {step === 1 && (
        <div className="gh-step space-y-4">
          <h2 className="text-2xl font-extrabold">מה הנכס שלך ואיפה?</h2>
          <div>
            <label className="field-label">סוג הנכס</label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
              {PROPERTY_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setPropertyType(t.value)}
                  className={`gh-press flex items-center justify-center rounded-full px-2 text-[15px] min-h-[48px] ${
                    propertyType === t.value
                      ? "bg-ink font-bold text-white"
                      : "bg-butter-soft font-medium text-slate-700"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          {/* חיפוש כתובת חכם */}
          <div>
            <label className="field-label">כתובת הנכס</label>
            <AddressSearch
              neighborhoods={neighborhoods}
              selected={selectedStreet}
              houseNumber={houseNumber}
              houseNumberNotFound={houseNumberNotFound}
              required={houseNumberRequired}
              onHouseNumberChange={setHouseNumber}
              onSelect={(s) => {
                // שמור שכונת ה-autocomplete כ-fallback פנימי
                streetSuggestionRef.current = s.neighborhoodId
                  ? { id: s.neighborhoodId, name: s.neighborhoodName }
                  : null;
                // אל תציג שכונה עדיין — השיוך יתבצע לאחר הזנת מספר הבית
                setSelectedStreet({ ...s, neighborhoodId: "", neighborhoodName: "" });
                setNeighborhoodId(s.neighborhoodId); // שמור פנימית לצורך כפתור "המשך"
                setAddress(s.label);
                setHouseNumber("");
                setShowNeighFallback(!s.neighborhoodId);
              }}
              onClear={() => {
                setSelectedStreet(null);
                setNeighborhoodId("");
                setAddress("");
                setHouseNumber("");
                setShowNeighFallback(false);
                setHouseNumberNotFound(false);
                streetSuggestionRef.current = null;
              }}
            />
            {/* fallback: אם הרחוב לא נמצא, אפשר לבחור שכונה ידנית */}
            {!selectedStreet && (
              <button
                type="button"
                className="mt-2 text-xs text-slate-500 underline hover:text-slate-600 min-h-[44px] px-2"
                onClick={() => setShowNeighFallback(!showNeighFallback)}
              >
                {showNeighFallback ? "סגור" : "לא מוצאים את הרחוב? בחרו שכונה ידנית"}
              </button>
            )}
            {showNeighFallback && !selectedStreet && (
              <>
                <select
                  aria-label="בחרו שכונה"
                  className="field-input bg-white mt-2"
                  value={neighborhoodId}
                  onChange={(e) => setNeighborhoodId(e.target.value)}
                >
                  <option value="">— בחרו שכונה —</option>
                  {neighborhoods.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
                {houseNumberRequired && (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <label htmlFor="addr-house-number-fallback" className="text-xs font-medium text-slate-600 shrink-0">
                        מספר בית<span className="text-red-500"> *</span>:
                      </label>
                      <input
                        id="addr-house-number-fallback"
                        type="text"
                        inputMode="numeric"
                        dir="ltr"
                        className="field-input max-w-[90px] text-center"
                        placeholder="12"
                        autoComplete="address-line2"
                        aria-required
                        value={houseNumber}
                        onChange={(e) => setHouseNumber(e.target.value.replace(/[^\d\w]/g, ""))}
                      />
                    </div>
                    {!houseNumber.trim() && (
                      <p className="text-xs font-medium text-amber-600">{HOUSE_NUMBER_REQUIRED_MESSAGE}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <button
            className="btn-primary w-full"
            disabled={!neighborhoodId || !isValidHouseNumber(propertyType, houseNumber)}
            onClick={() => { trackEvent("wizard_step1_complete", { propertyType, neighborhoodId }); setStep(2); }}
          >
            המשך →
          </button>
        </div>
      )}

      {/* שלב 2 — פרטי הנכס (מותנה בסוג) */}
      {step === 2 && (
        <div className="gh-step space-y-5">
          <h2 className="text-2xl font-extrabold">פרטי הנכס</h2>

          {!isLand && (
            <div>
              <label className="field-label">מספר חדרים</label>
              <div className="flex flex-wrap gap-2">
                {ROOM_OPTIONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRooms(r)}
                    aria-label={`${r} חדרים`}
                    aria-pressed={rooms === r}
                    className={`gh-press rounded-full px-4 py-2.5 text-[15px] tabular-nums min-h-[44px] min-w-[52px] ${
                      rooms === r
                        ? "bg-ink font-bold text-white"
                        : "bg-butter-soft font-medium text-slate-700"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {needsArea && (
              <div>
                <label className="field-label" htmlFor="prop-area">שטח בנוי במ"ר</label>
                <input
                  id="prop-area"
                  type="number"
                  inputMode="numeric"
                  className="field-input"
                  placeholder={isHouse ? "180" : "100"}
                  autoComplete="off"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                />
              </div>
            )}
            {needsPlot && (
              <div>
                <label className="field-label" htmlFor="prop-plot">שטח מגרש במ"ר</label>
                <input
                  id="prop-plot"
                  type="number"
                  inputMode="numeric"
                  className="field-input"
                  placeholder="350"
                  autoComplete="off"
                  value={plot}
                  onChange={(e) => setPlot(e.target.value)}
                />
              </div>
            )}
            {!isLand && (
              <div>
                <label className="field-label" htmlFor="prop-floor">{isHouse ? "קומות" : "קומה"}</label>
                <input
                  id="prop-floor"
                  type="number"
                  inputMode="numeric"
                  className="field-input"
                  placeholder={isHouse ? "2" : "3"}
                  autoComplete="off"
                  value={floor}
                  onChange={(e) => setFloor(e.target.value)}
                />
              </div>
            )}
            {/* שנת בנייה — קריטית לדיוק (ישן vs חדש) */}
            <div>
              <label className="field-label">שנת בנייה משוערת <span className="font-normal text-slate-500">(לא חובה)</span></label>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {[
                  { label: "לפני 1975", value: "1965" },
                  { label: "1975–1990", value: "1982" },
                  { label: "1990–2005", value: "1997" },
                  { label: "2005–2015", value: "2010" },
                  { label: "2015+", value: "2020" },
                  // שנה עתידית = טרם נמסרה → השרת מחזיר בדיקה אישית במקום מספר
                  { label: "בבנייה", value: String(new Date().getFullYear() + 1) },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setYearBuilt(yearBuilt === opt.value ? "" : opt.value)}
                    className={`gh-press rounded-full px-1 py-3 text-xs text-center tabular-nums min-h-[44px] ${
                      yearBuilt === opt.value
                        ? "bg-ink font-bold text-white"
                        : "bg-butter-soft font-medium text-slate-700"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <div className="flex gap-3">
            <button className="btn-ghost" onClick={() => setStep(1)}>
              ← חזרה
            </button>
            <button
              className="btn-primary flex-1"
              disabled={loading || !canCalc}
              onClick={calcValuation}
            >
              {loading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  משווים לעסקאות באזור…
                </>
              ) : "חשב שווי לפי עסקאות אמיתיות"}
            </button>
          </div>
        </div>
      )}

      {/* שלב 3 — תוצאה + שער ליד */}
      {step === 3 && valuation && (
        <div className="gh-step space-y-4">
          {/* ── כרטיס שווי ראשי ── */}
          <div className="relative overflow-hidden rounded-3xl bg-butter-soft p-5 text-center text-ink">

            <div className="relative">
              {/* Confidence badge — scope-based */}
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold mb-3 ${
                valuation.compSearchScope === "building" ? "border-transparent bg-emerald-100 text-emerald-800"
                : valuation.compSearchScope === "street" ? "border-transparent bg-teal-100 text-teal-800"
                : valuation.compSearchScope === "radius" ? "border-transparent bg-amber-100 text-amber-900"
                : "border-transparent bg-butter-deep text-slate-700"
              }`}>
                {valuation.compSearchScope === "building" ? "מבוסס על אותו בניין"
                 : valuation.compSearchScope === "street" ? "מבוסס על אותו רחוב"
                 : valuation.compSearchScope === "radius" ? "טווח מהשכונה הקרובה"
                 : "מבוסס על השכונה"}
              </span>

              {evaluatedAddress && (
                <p className="text-sm font-bold text-ink">{evaluatedAddress}</p>
              )}
              <p className="text-sm font-medium text-slate-600">
                {resultLabel(valuation)}{valuation.neighborhood ? ` · ${valuation.neighborhood}` : ""}
              </p>

              {valuation.manualReview ? (
                <ManualReviewNote reason={valuation.manualReviewReason} />
              ) : (
                <p className="my-3 flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1 text-3xl font-black tracking-[-0.03em] text-brand tabular-nums sm:text-[2.2rem]">
                  <span className="whitespace-nowrap">{nis(valuation.estimateLow)}</span>
                  <span className="text-xl font-light text-slate-500">—</span>
                  <span className="whitespace-nowrap">{nis(valuation.estimateHigh)}</span>
                </p>
              )}

              {!valuation.manualReview && <p className="text-sm font-medium text-slate-600">{sizeSummary(valuation)}</p>}
              {valuation.propertyType === "apartment" && !valuation.manualReview && !valuation.preliminary && (
                <p className="mt-2 text-sm text-slate-600">{ESTIMATE_NOTE}</p>
              )}
              {valuation.preliminary && (
                <PreliminaryNote onContact={() => leadFormRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "center" })} />
              )}

              <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-butter-deep px-3 py-1 text-xs text-slate-700">
                מבוסס על {valuation.basedOnDeals} עסקאות ·{" "}
                {valuation.compSearchScope === "building" ? "אותו בניין" :
                 valuation.compSearchScope === "street"   ? "אותו רחוב" :
                 valuation.compSearchScope === "radius"   ? `רדיוס ${valuation.compRadiusMeters} מ'` :
                 "שכונה"}
                {valuation.floorAdjusted ? " · קומה דומה" : ""}
              </div>
            </div>
          </div>

          {!valuation.manualReview && (
            <>
              <ValueFactors low={valuation.estimateLow} high={valuation.estimateHigh} />

              <ShevahSection
                estimateMid={valuation.estimateMid}
                onScrollToForm={() => leadFormRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "center" })}
              />
            </>
          )}

          {valuation.priceTrend && <TrendChart t={valuation.priceTrend} />}

          {valuation.plotNotValued && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm" dir="rtl">
              <p className="font-bold text-amber-800">שטח המגרש לא נכלל בהערכה</p>
              <p className="mt-1 text-amber-700 text-xs leading-relaxed">
                עסקאות הבתים הקיימות בנתונים חסרות נתוני שטח מגרש — לכן ההערכה מבוססת על שטח הבנייה בלבד.
                לבית עם מגרש משמעותי, ערך הקרקע עשוי להוסיף סכום משמעותי מעל להערכה המוצגת.
              </p>
            </div>
          )}

          {valuation.comparableDeals.length > 0 && (
            <div>
              <p className="mb-2 text-[15px] font-bold text-ink">
                עסקאות שנמכרו באזורך
              </p>
              <div className="space-y-2">
                {valuation.comparableDeals.slice(0, 3).map((c, i) => (
                  <CompDealCard key={i} c={c} />
                ))}
              </div>
              {/* כותרת המסבירה מאיפה נלקחו העסקאות */}
              {valuation.compSearchScope && valuation.compSearchScope !== "neighborhood" && (
                <p className="mt-1.5 text-xs text-slate-500">
                  {valuation.compSearchScope === "building"
                    ? "מוצגות קודם עסקאות מאותו בניין (5 שנים אחרונות)"
                    : valuation.compSearchScope === "street"
                    ? "מוצגות קודם עסקאות מאותו רחוב (5 שנים אחרונות)"
                    : `מוצגות קודם עסקאות ברדיוס ${valuation.compRadiusMeters}מ' (5 שנים אחרונות)`}
                </p>
              )}
              {valuation.propertyType !== "apartment" && !valuation.manualReview && (
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  {valuation.propertyType === "house"
                    ? "רשות המסים אינה מפרסמת שטח מגרש לבתים — לכן עסקאות ההשוואה אינן מסוננות לפי גודל אדמה. האומדן מחושב לפי בנוי בלבד ועשוי לסטות מהמציאות בבתים עם מגרשים גדולים."
                    : `* המחיר הכולל מושפע משטח המגרש — ההערכה מנורמלת לנכסך (≈${nis(valuation.pricePerSqmMid)} למ"ר מגרש).`
                  }
                </p>
              )}
            </div>
          )}

          {valuation.renewal && <RenewalPanel r={valuation.renewal} />}

          {/* ── עסקאות מטושטשות (teaser) ── */}
          {valuation.comparableDeals.length > 3 && (
            <div className="relative overflow-hidden rounded-3xl bg-butter-soft">
              <p className="px-4 pt-3 pb-2 text-sm font-bold text-slate-700">
                +{valuation.comparableDeals.length - 3} עסקאות נוספות באזורך
              </p>
              <div className="space-y-2 px-4 pb-2 select-none pointer-events-none">
                {valuation.comparableDeals.slice(3, 6).map((c, i) => (
                  <div key={i} className="flex items-center justify-between rounded-2xl bg-white px-4 py-2.5 blur-[3px]">
                    <span className="text-sm text-slate-600">{compDesc(c)}</span>
                    <span className="font-black text-slate-900">{nis(c.price)}</span>
                  </div>
                ))}
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-transparent via-butter-soft/80 to-butter-soft">
                <button
                  onClick={() => leadFormRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "center" })}
                  className="gh-press rounded-full bg-brand px-5 py-2.5 min-h-[44px] text-sm font-bold text-white"
                >
                  לדוח המלא
                </button>
              </div>
            </div>
          )}

          {/* ── תובנות נעולות (CBS / נגישות / MAVAT) ── */}
          {teaserData && (teaserData.cbs || teaserData.access || teaserData.mavat) && (
            <div className="rounded-3xl bg-butter-soft p-4 space-y-3">
              <p className="text-[15px] font-bold text-ink">עוד מה שגילינו עבורך</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {/* CBS */}
                {teaserData.cbs && (
                  <TeaserCard
                    icon="🏘️"
                    label="פרופיל שכונה"
                    score={teaserData.cbs.score}
                    sub={teaserData.cbs.precision === "city" ? "ממוצע עירוני" : "אזור ספציפי"}
                    onUnlock={() => leadFormRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "center" })}
                  />
                )}
                {/* נגישות */}
                {teaserData.access && (
                  <TeaserCard
                    icon="📍"
                    label="נגישות"
                    score={teaserData.access.score}
                    sub={(() => {
                      const bus = teaserData.access.nearest?.find((n) => n.category === "bus");
                      return bus?.found ? `תחנה ${bus.distanceMeters}מ'` : "תחבורה ציבורית";
                    })()}
                    onUnlock={() => leadFormRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "center" })}
                  />
                )}
                {/* MAVAT */}
                {teaserData.mavat && (
                  <div className="rounded-2xl bg-white p-3 text-center flex flex-col items-center gap-1.5">
                    <p className="text-xs font-bold text-slate-500 leading-tight">תכנון עירוני</p>
                    <p className="text-xs font-extrabold leading-tight">
                      {teaserData.mavat.upside
                        ? <span className="text-emerald-700">פוטנציאל</span>
                        : teaserData.mavat.demolition
                        ? <span className="text-orange-700">פינוי-בינוי</span>
                        : <span className="text-slate-600">יציב</span>}
                    </p>
                    <button
                      onClick={() => leadFormRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "center" })}
                      className="gh-press mt-1 rounded-full bg-butter-soft px-3 py-1.5 text-xs font-semibold text-ink min-h-[44px] flex items-center justify-center"
                    >
                      פרטים ↓
                    </button>
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-500 text-center">
                פרטים מלאים — מפת תכנון, ניתוח שכונה, עסקאות — בדוח המלא
              </p>
            </div>
          )}

          <div ref={leadFormRef} data-lead-form className="rounded-3xl bg-butter-deep p-5">
            <h3 className="text-lg font-extrabold text-slate-900">
              {otpState === "sent" || otpState === "verifying"
                ? "שלחתי לך את הדוח בוואטסאפ"
                : "רוצים את הדוח המלא?"}
            </h3>
            <p className="mb-4 text-sm text-slate-700">
              {otpState === "sent" || otpState === "verifying"
                ? `כדי לפתוח את הדוח, הזינו את הקוד שקיבלתם בוואטסאפ למספר ${phone}.`
                : "דוח עסקאות מלא + הערכה מותאמת אישית, ישירות לוואטסאפ שלכם."}
            </p>

            {/* שלב 3א — שם + טלפון */}
            {(otpState === "idle" || otpState === "sending") && (
              <div className="space-y-3">
                {/* שכבת אמון — מתווך מורשה (חובה חוקית) */}
                <div className="flex items-center gap-3 rounded-2xl bg-white p-3">
                  {AGENT.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={AGENT.photo} alt={AGENT.name} className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sun text-base font-bold text-ink" aria-hidden="true">{AGENT.name.slice(0, 1)}</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-800">{AGENT.name}</p>
                    <p className="text-xs text-slate-500">מתווך מורשה · רישיון {AGENT.license}</p>
                  </div>
                  {AGENT.licensed && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">רישיון בתוקף</span>
                  )}
                </div>
                {AGENT.testimonial && <p className="text-xs italic text-slate-600">"{AGENT.testimonial}"</p>}

                {/* שאלת תזמון — מסנן לידים חמים */}
                <div>
                  <label className="field-label">מתי אתם שוקלים למכור?</label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {SELL_TIMING.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setSellTiming(t.value)}
                        aria-pressed={sellTiming === t.value}
                        className={`gh-press rounded-full px-2 py-2.5 text-[13px] min-h-[44px] ${
                          sellTiming === t.value
                            ? "bg-ink font-bold text-white"
                            : "bg-white font-medium text-slate-700"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="sr-only" htmlFor="lead-name">שם מלא</label>
                <input
                  id="lead-name"
                  className="field-input"
                  placeholder="שם מלא"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <label className="sr-only" htmlFor="lead-phone">טלפון נייד</label>
                <input
                  id="lead-phone"
                  className="field-input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="טלפון נייד (לקבלת הדוח בוואטסאפ)"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />

                {/* 2 הסכמות נפרדות — נדרש בתיקון 13 לחוק הגנת הפרטיות */}
                <label className="flex items-start gap-3 text-xs text-slate-700 cursor-pointer">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-brand" checked={consentReport}
                    onChange={(e) => setConsentReport(e.target.checked)} />
                  <span>אני מאשר/ת קבלת דוח השווי בוואטסאפ ואת <a href="/privacy" target="_blank" className="underline">מדיניות הפרטיות</a>.</span>
                </label>
                <label className="flex items-start gap-3 text-xs text-slate-700 cursor-pointer">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-brand" checked={consentMarketing}
                    onChange={(e) => setConsentMarketing(e.target.checked)} />
                  <span>אני מאשר/ת יצירת קשר ודיוור שיווקי בנוגע לנכס (לא חובה · ניתן להסיר בכל עת).</span>
                </label>
                <label className="flex items-start gap-3 text-xs text-slate-700 cursor-pointer">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-brand" checked={alertOptIn}
                    onChange={(e) => setAlertOptIn(e.target.checked)} />
                  <span>עדכנו אותי כשיימכר נכס דומה באזורי (התראת שוק חינמית).</span>
                </label>

                {error && <p role="alert" className="text-sm font-medium text-red-600">{error}</p>}
                <button
                  className="btn-primary w-full"
                  disabled={otpState === "sending"}
                  onClick={sendOTP}
                >
                  {otpState === "sending" ? "שולח..." : "שלחו לי את הדוח"}
                </button>
              </div>
            )}

            {/* מעקף ה-OTP בצד-לקוח הוסר (Wave 0A-2): השרת אוכף הוכחת OTP,
                ולכן הכפתור לא יכול היה ליצור ליד ורק היה מבלבל. */}

            {/* שלב 3ב — הזנת קוד */}
            {(otpState === "sent" || otpState === "verifying") && (
              <div className="space-y-3">
                <div className="relative">
                  <input
                    className="field-input text-center text-2xl tracking-[0.4em] font-bold"
                    type="text"
                    inputMode="numeric"
                    dir="ltr"
                    aria-label="קוד אימות בן 6 ספרות"
                    autoComplete="one-time-code"
                    enterKeyHint="done"
                    maxLength={6}
                    placeholder="_ _ _ _ _ _"
                    value={otpCode}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "");
                      setOtpCode(v);
                      if (v.length === 6) setTimeout(verifyAndSubmit, 120);
                    }}
                    autoFocus
                  />
                  {otpCountdown > 0 && (
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                      {fmtCountdown(otpCountdown)}
                    </span>
                  )}
                </div>
                {error && <p role="alert" className="text-sm font-medium text-red-600">{error}</p>}
                <button
                  className="btn-primary w-full"
                  disabled={otpState === "verifying" || otpCode.length !== 6}
                  onClick={verifyAndSubmit}
                >
                  {otpState === "verifying" ? "פותח..." : "פתחו את הדוח ←"}
                </button>
                <button
                  className="w-full text-center text-xs text-slate-500 underline py-3 min-h-[44px]"
                  disabled={otpCountdown > 270} // מאפשר שליחה מחדש רק אחרי 30ש'
                  onClick={() => { setOtpState("idle"); setOtpCode(""); setOtpToken(""); setError(null); if (typeof window !== "undefined") sessionStorage.removeItem("otp_token"); }}
                >
                  {otpCountdown > 270 ? `שלח מחדש בעוד ${fmtCountdown(otpCountdown - 270)}ש'` : "לא קיבלתם קוד? שלח שנית"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* שלב 4 — דוח מלא */}
      {step === 4 && submitted && valuation && (
        <div className="gh-step space-y-5">
          <div className="text-center">
            <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white" aria-hidden="true">
              <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
            </div>
            <h2 className="text-2xl font-extrabold">הדוח שלך מוכן, {name}!</h2>
            <p className="text-sm text-slate-600">שלחנו לך עותק גם ב-WhatsApp</p>
          </div>

          <div className="relative overflow-hidden rounded-3xl bg-butter-soft p-5 text-center text-ink">
            <div className="relative">
              <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold mb-3 ${
                valuation.compSearchScope === "building" ? "bg-emerald-100 text-emerald-800"
                : valuation.compSearchScope === "street" ? "bg-teal-100 text-teal-800"
                : valuation.compSearchScope === "radius" ? "bg-amber-100 text-amber-900"
                : "bg-butter-deep text-slate-700"
              }`}>
                {valuation.compSearchScope === "building" ? "מבוסס על אותו בניין"
                 : valuation.compSearchScope === "street" ? "מבוסס על אותו רחוב"
                 : valuation.compSearchScope === "radius" ? "טווח מהשכונה הקרובה"
                 : "מבוסס על השכונה"}
              </span>
              {evaluatedAddress && (
                <p className="text-sm font-bold opacity-90">{evaluatedAddress}</p>
              )}
              <p className="text-sm font-semibold opacity-80">
                {resultLabel(valuation)}{valuation.neighborhood ? ` · ${valuation.neighborhood}` : ""}
              </p>
              {valuation.manualReview ? (
                <ManualReviewNote reason={valuation.manualReviewReason} />
              ) : (
                <p className="my-2 flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1 text-3xl font-black tracking-[-0.03em] text-brand tabular-nums sm:text-4xl">
                  <span className="whitespace-nowrap">{nis(valuation.estimateLow)}</span>
                  <span>–</span>
                  <span className="whitespace-nowrap">{nis(valuation.estimateHigh)}</span>
                </p>
              )}
              {!valuation.manualReview && <p className="text-sm font-medium opacity-85">{sizeSummary(valuation)}</p>}
              {valuation.propertyType === "apartment" && !valuation.manualReview && !valuation.preliminary && (
                <p className="mt-2 text-sm opacity-85">{ESTIMATE_NOTE}</p>
              )}
              {valuation.preliminary && <PreliminaryNote />}
              <p className="mt-2 text-xs opacity-70">
                מבוסס על {valuation.basedOnDeals} עסקאות ·{" "}
                {valuation.compSearchScope === "building" ? "אותו בניין" :
                 valuation.compSearchScope === "street" ? "אותו רחוב" :
                 valuation.compSearchScope === "radius" ? `רדיוס ${valuation.compRadiusMeters}מ'` :
                 "שכונה"}
                {valuation.floorAdjusted ? " · קומה דומה" : ""}
              </p>
            </div>
          </div>

          {valuation.plotNotValued && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm mb-3" dir="rtl">
              <p className="font-bold text-amber-800">שטח המגרש לא נכלל בהערכה</p>
              <p className="mt-1 text-amber-700 text-xs leading-relaxed">
                עסקאות הבתים בנתונים חסרות נתוני שטח מגרש — ההערכה מבוססת על שטח בנייה בלבד.
                לבית עם מגרש משמעותי, ערך הקרקע עשוי להוסיף סכום משמעותי.
              </p>
            </div>
          )}

          <div>
            <p className="mb-2 text-sm font-bold text-slate-700">
              דוח עסקאות מלא — {valuation.comparableDeals.length} עסקאות שנמכרו באזורך:
            </p>
            <div className="max-h-96 space-y-2 overflow-auto pl-1">
              {(["building", "street", "radius", "neighborhood"] as const).map((tier) => {
                const group = valuation.comparableDeals.filter((c) => (c.tier ?? "neighborhood") === tier);
                if (group.length === 0) return null;
                const badge = TIER_BADGE[tier];
                return (
                  <div key={tier}>
                    <p className={`mb-1 mt-3 rounded-full border px-3 py-0.5 text-xs font-bold inline-flex items-center gap-1 ${badge.cls}`}>
                      {badge.label}
                    </p>
                    {group.map((c, i) => (
                      <CompDealCard key={`${tier}-${i}`} c={c} />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          {valuation.renewal && <RenewalPanel r={valuation.renewal} />}

          {/* ── פאנלים מלאים — נגלים רק בדוח ── */}
          <ReportSection title="פרופיל שכונה" subtitle="נתוני אוכלוסייה ושכר · מפקד 2022">
            <CbsPanel neighborhood={valuation.neighborhood} />
          </ReportSection>

          <ReportSection title="תכנון עירוני" subtitle="תכניות בנייה ויעודי קרקע · מבא&quot;ת">
            <MavatPanel
              neighborhood={valuation.neighborhood || undefined}
              x={selectedStreet?.x ?? neighborhoodCoords?.x ?? null}
              y={selectedStreet?.y ?? neighborhoodCoords?.y ?? null}
            />
          </ReportSection>

          <ReportSection title="נגישות ותשתיות" subtitle="מרחקים לתחבורה, חינוך ופארקים">
            <AccessibilityPanel
              neighborhoodId={neighborhoodId || undefined}
              neighborhood={valuation.neighborhood || undefined}
              x={selectedStreet?.x ?? neighborhoodCoords?.x ?? null}
              y={selectedStreet?.y ?? neighborhoodCoords?.y ?? null}
            />
          </ReportSection>

          <div className="rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-600">
            נחזור אליך בהקדם עם סקירה מותאמת אישית.
          </div>
        </div>
      )}

      <p className="mt-5 text-center text-xs leading-relaxed text-slate-500">
        ההערכה היא אינדיקציה המבוססת על עסקאות פומביות ממאגר רשות המסים ואינה תחליף
        להערכת שמאי מוסמך.
      </p>
    </div>
  );
}

function TeaserCard({
  icon, label, score, sub, onUnlock,
}: {
  icon: string; label: string; score: number; sub: string;
  onUnlock: () => void;
}) {
  const color = score >= 7 ? "text-emerald-600" : score >= 4.5 ? "text-amber-600" : "text-red-500";
  const bar   = score >= 7 ? "bg-emerald-500"   : score >= 4.5 ? "bg-amber-500"   : "bg-red-400";
  return (
    <div className="rounded-2xl bg-white p-3 text-center flex flex-col items-center gap-1.5">
      <p className="text-xs font-bold text-slate-500 leading-tight">{label}</p>
      <p className={`text-lg font-black leading-none ${color}`}>{score}<span className="text-[10px] font-normal text-slate-500">/10</span></p>
      <div className="w-full h-1.5 rounded-full bg-butter-deep overflow-hidden">
        <div className={`h-full ${bar}`} style={{ width: `${score * 10}%` }} />
      </div>
      <p className="text-xs text-slate-500 leading-tight">{sub}</p>
      <button
        onClick={onUnlock}
        className="gh-press mt-0.5 rounded-full bg-butter-soft px-3 py-1.5 min-h-[44px] text-xs font-semibold text-ink flex items-center justify-center"
      >
        פרטים ↓
      </button>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  const labels = ["מיקום", "פרטי הנכס", "התוצאה"];
  return (
    <div className="mb-6">
      <div className="flex items-center justify-center gap-0">
        {labels.map((l, i) => {
          const n = i + 1;
          const done = step > n;
          const active = step === n;
          return (
            <div key={l} className="flex items-center">
              {/* Step dot */}
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-black transition-colors duration-200 ${
                    done
                      ? "bg-ink text-white"
                      : active
                      ? "bg-brand text-white"
                      : "bg-butter-soft text-slate-500"
                  }`}
                >
                  {done ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    n
                  )}
                </div>
                <span className={`text-xs font-medium ${active ? "text-brand" : done ? "text-ink" : "text-slate-500"}`}>
                  {l}
                </span>
              </div>
              {/* Connector */}
              {i < labels.length - 1 && (
                <div className={`mx-2 mb-4 h-0.5 w-10 rounded-full transition-colors duration-200 ${step > n ? "bg-ink" : "bg-butter-deep"}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
