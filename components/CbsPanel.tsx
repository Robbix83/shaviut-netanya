"use client";

import { useEffect, useState } from "react";
import type { CbsProfile } from "@/lib/cbs";

interface Props {
  neighborhood?: string | null;
}

function scoreColor(s: number) {
  if (s >= 7.5) return "text-emerald-600";
  if (s >= 4.5) return "text-amber-600";
  return "text-red-500";
}
function scoreBg(s: number) {
  if (s >= 7.5) return "bg-emerald-500";
  if (s >= 4.5) return "bg-amber-500";
  return "bg-red-400";
}
function scoreLabel(s: number) {
  if (s >= 7.5) return "גבוה";
  if (s >= 4.5) return "בינוני";
  return "נמוך";
}

const fmt = (n: number | null, suffix = "") =>
  n != null ? `${n.toLocaleString("he-IL")}${suffix}` : "—";

const fmtPct = (n: number) => `${n.toFixed(1)}%`;

const fmtWage = (n: number | null) =>
  n != null ? `₪${Math.round(n / 1000)}K` : "—";

export default function CbsPanel({ neighborhood }: Props) {
  const [profile, setProfile] = useState<CbsProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams();
    if (neighborhood) q.set("neighborhood", neighborhood);

    fetch(`/api/cbs?${q}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => {
        if (!ok || body.error) setErr(body.error ?? "שגיאה");
        else setProfile(body.profile);
      })
      .catch(() => setErr("שגיאת רשת"))
      .finally(() => setLoading(false));
  }, [neighborhood]);

  if (loading)
    return (
      <div className="py-6 text-center text-xs text-slate-400 animate-pulse">
        טוען פרופיל שכונה (למ"ס)…
      </div>
    );

  if (err || !profile)
    return (
      <div className="py-4 text-center text-xs text-slate-400">
        {err === "no_cbs_data"
          ? <>הריצו <code className="bg-slate-100 px-1 rounded">npm run fetch:cbs</code> כדי לאכלס נתוני למ"ס.</>
          : "אין נתוני למ\"ס זמינים"}
      </div>
    );

  const { score, precision, pop, density, ageMedian,
          age0_19, age20_64, age65, academicPct, medWage,
          ownPct, cityMedWage } = profile;

  const wageDiff =
    medWage != null && cityMedWage != null
      ? Math.round(((medWage - cityMedWage) / cityMedWage) * 100)
      : null;

  return (
    <div className="p-4 space-y-4 text-sm" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide">
          פרופיל שכונה — מפקד 2022
        </h4>
        {precision === "city" ? (
          <span className="rounded-full bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5 text-[10px] font-medium">
            ~ ממוצע נתניה (אין מיפוי לאזור סטטיסטי)
          </span>
        ) : (
          <span className="rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 text-[10px] font-medium">
            נתון לאזור סטטיסטי{profile.statArea ? ` ${profile.statArea}` : ""}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Score + key metrics */}
        <div className="space-y-3">
          {/* Socioeconomic score */}
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 flex items-center gap-3">
            <div className="flex flex-col items-center justify-center shrink-0">
              <span className={`text-3xl font-black leading-none ${scoreColor(score)}`}>{score}</span>
              <span className="text-[10px] text-slate-400 mt-0.5">מתוך 10</span>
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] font-medium text-slate-500">מדד חברתי-כלכלי</p>
                <span className={`text-[10px] font-bold ${scoreColor(score)}`}>{scoreLabel(score)}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                <div className={`h-full ${scoreBg(score)}`} style={{ width: `${score * 10}%` }} />
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                מחושב מנתוני שכר והשכלה — יחסי לטווח נתניה
              </p>
            </div>
          </div>

          {/* Key metrics grid */}
          <div className="grid grid-cols-2 gap-2">
            <MetricTile label="אוכלוסייה" value={pop ? `${Math.round(pop / 1000)}K` : "—"} icon="👥" />
            <MetricTile label="גיל חציוני" value={fmt(ageMedian, " שנה")} icon="📅" />
            <MetricTile
              label="שכר חציוני"
              value={fmtWage(medWage)}
              icon="💰"
              sub={wageDiff != null
                ? `${wageDiff > 0 ? "+" : ""}${wageDiff}% מממוצע נתניה`
                : undefined}
              subColor={wageDiff != null ? (wageDiff >= 0 ? "text-emerald-600" : "text-red-500") : undefined}
            />
            <MetricTile label="עם תואר אקדמי" value={fmtPct(academicPct)} icon="🎓" />
          </div>
        </div>

        {/* Age distribution + ownership */}
        <div className="space-y-3">
          {/* Age distribution */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-2">
            <p className="text-[11px] font-bold text-slate-500">התפלגות גילאים</p>
            <AgeBar label="0–19 (צעירים)" pct={age0_19} color="bg-sky-400" />
            <AgeBar label="20–64 (עובדים)" pct={age20_64} color="bg-emerald-400" />
            <AgeBar label="65+ (קשישים)" pct={age65} color="bg-purple-400" />
          </div>

          {/* Ownership */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 space-y-2">
            <p className="text-[11px] font-bold text-slate-500">מצב דיור</p>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600">בעלות על דירה</span>
              <span className="font-bold text-slate-800">{fmtPct(ownPct)}</span>
            </div>
            {density != null && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">צפיפות אוכ' לק"מ²</span>
                <span className="font-bold text-slate-800">{Math.round(density).toLocaleString("he-IL")}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="text-[10px] text-slate-400">
        מקור: הלשכה המרכזית לסטטיסטיקה — מפקד אוכלוסין ודיור 2022 · data.gov.il
      </p>
    </div>
  );
}

function MetricTile({
  icon, label, value, sub, subColor,
}: {
  icon: string; label: string; value: string;
  sub?: string; subColor?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-3 py-2.5">
      <p className="text-base">{icon}</p>
      <p className="text-sm font-black text-slate-800 leading-tight mt-0.5">{value}</p>
      <p className="text-[10px] text-slate-400 leading-tight">{label}</p>
      {sub && <p className={`text-[10px] font-semibold mt-0.5 ${subColor ?? "text-slate-500"}`}>{sub}</p>}
    </div>
  );
}

function AgeBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
        <span>{label}</span>
        <span className="font-semibold">{fmtPct(pct)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}
