"use client";

import { useEffect, useState } from "react";
import type { AccessibilityResult, PoiCategory } from "@/lib/govmap";

interface Props {
  address?: string | null;
  neighborhoodId?: string | null;
  neighborhood?: string | null;
  x?: number | null;
  y?: number | null;
}

const CAT_META: Record<PoiCategory, { label: string; icon: string }> = {
  train:  { label: "תחנת רכבת",   icon: "🚆" },
  bus:    { label: "תחנת אוטובוס", icon: "🚌" },
  school: { label: "בית ספר",      icon: "🏫" },
  park:   { label: "פארק",         icon: "🌳" },
};

const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} ק"מ` : `${m} מ'`);

function scoreColor(s: number): string {
  if (s >= 8) return "text-emerald-600";
  if (s >= 5) return "text-amber-600";
  return "text-red-500";
}
function scoreBg(s: number): string {
  if (s >= 8) return "bg-emerald-500";
  if (s >= 5) return "bg-amber-500";
  return "bg-red-400";
}

interface ApiResp {
  accessibility?: AccessibilityResult;
  approximate?: boolean;
  locationLabel?: string | null;
  embedUrl?: string;
  error?: string;
}

export default function AccessibilityPanel(props: Props) {
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!props.x && !props.y && !props.address && !props.neighborhoodId && !props.neighborhood) {
      setErr("אין מיקום");
      setLoading(false);
      return;
    }
    const q = new URLSearchParams();
    if (props.x) q.set("x", String(Math.round(props.x)));
    if (props.y) q.set("y", String(Math.round(props.y)));
    if (!props.x && !props.y) {
      if (props.neighborhoodId) q.set("neighborhoodId", props.neighborhoodId);
      if (props.neighborhood)   q.set("neighborhood",   props.neighborhood);
    }

    fetch(`/api/accessibility?${q}`)
      .then(async (r) => ({ status: r.status, body: (await r.json()) as ApiResp }))
      .then(({ status, body }) => {
        if (status === 503 && body.error === "no_poi_data") {
          setErr("no_poi_data");
        } else if (body.error || !body.accessibility) {
          setErr("אין נתוני נגישות למיקום זה");
        } else {
          setData(body);
        }
      })
      .catch(() => setErr("שגיאת רשת"))
      .finally(() => setLoading(false));
  }, [props.address, props.neighborhoodId, props.neighborhood]);

  if (loading)
    return <div className="py-6 text-center text-xs text-slate-400 animate-pulse">טוען נתוני נגישות…</div>;

  if (err === "no_poi_data")
    return (
      <div className="py-4 px-4 text-center text-xs text-slate-400">
        נתוני התשתיות טרם נאספו. הריצו <code className="bg-slate-100 px-1 rounded">npm run fetch:poi</code> כדי לאכלס את המפה.
      </div>
    );
  if (err || !data?.accessibility)
    return <div className="py-4 text-center text-xs text-slate-400">אין נתוני נגישות למיקום זה</div>;

  const { score, nearest } = data.accessibility;

  return (
    <div className="p-4 space-y-4 text-sm" dir="rtl">
      {/* כותרת + הסתייגות דיוק */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide">מיקום ותשתיות</h4>
        {data.approximate ? (
          <span className="rounded-full bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5 text-[10px] font-medium">
            ~ הערכה לפי מרכז השכונה{data.locationLabel ? ` (${data.locationLabel})` : ""}
          </span>
        ) : (
          <span className="rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 text-[10px] font-medium">
            כתובת מדויקת{data.locationLabel ? ` · ${data.locationLabel}` : ""}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ציון + מרחקים */}
        <div className="space-y-3">
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 flex items-center gap-3">
            <div className="flex flex-col items-center justify-center">
              <span className={`text-3xl font-black leading-none ${scoreColor(score)}`}>{score}</span>
              <span className="text-[10px] text-slate-400 mt-0.5">מתוך 10</span>
            </div>
            <div className="flex-1">
              <p className="text-[11px] font-medium text-slate-500 mb-1">ציון נגישות</p>
              <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                <div className={`h-full ${scoreBg(score)}`} style={{ width: `${score * 10}%` }} />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            {nearest.map((n) => (
              <div
                key={n.category}
                className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-2"
              >
                <span className="text-slate-600 text-xs flex items-center gap-1.5">
                  <span className="text-base">{CAT_META[n.category].icon}</span>
                  {CAT_META[n.category].label}
                  {n.name && <span className="text-slate-400 text-[10px]">· {n.name}</span>}
                </span>
                <span className={`text-xs font-bold ${n.found ? "text-slate-800" : "text-slate-300"}`}>
                  {n.found ? fmtDist(n.distanceMeters) : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* מפה ממוזערת — govmap */}
        {data.embedUrl && (
          <div className="rounded-xl overflow-hidden border border-slate-200 min-h-[180px]">
            <iframe
              src={data.embedUrl}
              title="מפת המיקום (govmap)"
              className="w-full h-full min-h-[180px]"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </div>
        )}
      </div>

      <p className="text-[10px] text-slate-400">
        מקור נקודות-עניין: OpenStreetMap · מפה: govmap.gov.il · מרחקים אוויריים
      </p>
    </div>
  );
}
