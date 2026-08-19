"use client";

import { useEffect, useState } from "react";
import type { MavatData, PlanStatus } from "@/lib/mavat";

interface Props {
  address?: string | null;
  neighborhood?: string | null;
  x?: number | null;
  y?: number | null;
}

const STATUS_CFG: Record<PlanStatus, { label: string; cls: string }> = {
  תקפה:   { label: "תקפה",   cls: "bg-emerald-100 text-emerald-700" },
  הופקדה: { label: "הופקדה", cls: "bg-blue-100 text-blue-700" },
  אושרה:  { label: "אושרה",  cls: "bg-green-100 text-green-700" },
  בהכנה:  { label: "בהכנה",  cls: "bg-yellow-100 text-yellow-700" },
  נדחתה:  { label: "נדחתה",  cls: "bg-red-100 text-red-500" },
  בוטלה:  { label: "בוטלה",  cls: "bg-slate-100 text-slate-400" },
  אחר:    { label: "אחר",    cls: "bg-slate-100 text-slate-500" },
};

export default function MavatPanel({ address, neighborhood, x, y }: Props) {
  const [data, setData] = useState<MavatData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!x && !y && !address && !neighborhood) {
      setErr("אין כתובת");
      setLoading(false);
      return;
    }
    const q = new URLSearchParams();
    // קואורדינטות מדויקות — עדיפות ראשונה (מונעות פתרון כתובת שגוי)
    if (x) q.set("x", String(Math.round(x)));
    if (y) q.set("y", String(Math.round(y)));
    // fallback: שם שכונה בנתניה (לא כתובת טקסטואלית שעלולה לפגוע במקום אחר)
    if (!x && !y && neighborhood) q.set("neighborhood", neighborhood);

    fetch(`/api/mavat?${q}`)
      .then((r) => r.json())
      .then((j) => { if (j.error) setErr(j.error); else setData(j.data); })
      .catch(() => setErr("שגיאת רשת"))
      .finally(() => setLoading(false));
  }, [x, y, address, neighborhood]);

  if (loading) return <div className="py-6 text-center text-xs text-slate-400 animate-pulse">טוען נתוני תכנון MAVAT…</div>;
  if (err || !data) return <div className="py-4 text-center text-xs text-slate-400">אין נתוני תכנון לאזור זה</div>;

  const activePlans  = data.plans.filter((p) => p.status === "תקפה" || p.status === "הופקדה" || p.status === "אושרה");
  const pendingPlans = data.plans.filter((p) => p.status === "בהכנה");

  return (
    <div className="p-4 space-y-4 text-sm" dir="rtl">
      {/* Badges */}
      <div className="flex flex-wrap gap-2">
        {data.potentialValueIncrease && (
          <span className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
            📈 פוטנציאל עליית ערך — תכנית עם יח"ד חדשות באזור
          </span>
        )}
        {data.hasDemolition && (
          <span className="flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">
            🏗️ נמצאו מבנים לפינוי/הריסה בקרבת מקום
          </span>
        )}
        {!data.potentialValueIncrease && !data.hasDemolition && (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500">
            אין שינויים מהותיים מתוכננים בקרבת מקום
          </span>
        )}
      </div>

      {/* Summary numbers */}
      <div className="grid grid-cols-3 gap-3">
        <MetricBox icon="📋" label="תכניות תקפות/מאושרות" value={String(activePlans.length)} />
        <MetricBox icon="⏳" label="תכניות בהכנה" value={String(pendingPlans.length)} />
        <MetricBox icon="🏗️" label="ישויות לפינוי/הריסה" value={String(data.demolitions.length)} />
      </div>

      {/* Active + pending plans */}
      {data.plans.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide">תכניות בנייה באזור</h4>
            <a
              href={data.mavat_url}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-brand hover:underline"
            >
              פתח ב-MAVAT ↗
            </a>
          </div>
          <div className="space-y-2">
            {data.plans.slice(0, 6).map((plan) => {
              const sc = STATUS_CFG[plan.status] ?? STATUS_CFG["אחר"];
              return (
                <div key={plan.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-700 truncate">{plan.name || plan.number}</p>
                      {plan.name && plan.number && (
                        <p className="text-[10px] text-slate-400">{plan.number}</p>
                      )}
                      {plan.type && (
                        <p className="text-[10px] text-slate-500 mt-0.5">{plan.type}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${sc.cls}`}>{sc.label}</span>
                      {(plan.newUnits ?? 0) > 0 && (
                        <span className="rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-bold">
                          +{plan.newUnits} יח"ד
                        </span>
                      )}
                    </div>
                  </div>
                  {plan.objectives && (
                    <p className="text-[10px] text-slate-500 mt-1.5 line-clamp-2">{plan.objectives}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5">
                    {plan.lastUpdated && (
                      <span className="text-[10px] text-slate-400">
                        עודכן: {new Date(plan.lastUpdated).toLocaleDateString("he-IL")}
                      </span>
                    )}
                    {plan.url && (
                      <a
                        href={plan.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-brand hover:underline"
                      >
                        פרטים מלאים ↗
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Demolitions */}
      {data.demolitions.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">פינוי / הריסה</h4>
          <div className="space-y-1.5">
            {data.demolitions.slice(0, 4).map((d, i) => (
              <div key={i} className="rounded-lg border border-orange-100 bg-orange-50 px-3 py-2">
                <p className="text-xs font-medium text-orange-800">{d.entityType}</p>
                <p className="text-[10px] text-orange-600 truncate">{d.planName}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Land use */}
      {data.landUses.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">ייעוד קרקע</h4>
          <div className="flex flex-wrap gap-1.5">
            {data.landUses.slice(0, 8).map((z, i) => (
              <span key={i} className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] text-slate-600">
                {z.zoneName}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10px] text-slate-400">מקור: מבט / MAVAT — מינהל התכנון, ישראל</p>
    </div>
  );
}

function MetricBox({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-center">
      <span className="text-xl">{icon}</span>
      <p className="text-lg font-black text-slate-800 mt-0.5">{value}</p>
      <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{label}</p>
    </div>
  );
}
