"use client";

import { useEffect, useState } from "react";
import type { MarketAnalysis, PriceBadge } from "@/lib/marketData";

interface Props {
  neighborhoodId?: string | null;
  neighborhood?: string | null;
  propertyType?: string;
  rooms?: number | null;
  areaSqm?: number | null;
  plotSqm?: number | null;
  estimateLow?: number | null;
  estimateHigh?: number | null;
  streetName?: string | null;
  houseNumber?: string | null;
}

const BADGE_CONFIG: Record<PriceBadge, { label: string; cls: string; icon: string }> = {
  below: { label: "מחיר נמוך מהשוק",  cls: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: "📉" },
  match: { label: "מחיר תואם שוק",    cls: "bg-blue-100 text-blue-700 border-blue-200",         icon: "✅" },
  above: { label: "מחיר גבוה מהשוק",  cls: "bg-amber-100 text-amber-700 border-amber-200",      icon: "📈" },
};

const NIS = (n: number | null | undefined) =>
  n != null ? "₪" + Math.round(n).toLocaleString("he-IL") : "—";

const FMT_DATE = (iso: string) =>
  new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });

export default function MarketPanel(props: Props) {
  const [data, setData] = useState<MarketAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!props.neighborhoodId && !props.neighborhood) {
      setErr("אין שכונה");
      setLoading(false);
      return;
    }
    const q = new URLSearchParams();
    if (props.neighborhoodId) q.set("neighborhoodId", props.neighborhoodId);
    if (props.neighborhood)   q.set("neighborhood",   props.neighborhood);
    if (props.propertyType)   q.set("propertyType",   props.propertyType);
    if (props.rooms != null)  q.set("rooms",           String(props.rooms));
    if (props.areaSqm != null) q.set("areaSqm",        String(props.areaSqm));
    if (props.plotSqm != null) q.set("plotSqm",        String(props.plotSqm));
    if (props.estimateLow != null)  q.set("estimateLow",  String(props.estimateLow));
    if (props.estimateHigh != null) q.set("estimateHigh", String(props.estimateHigh));
    if (props.streetName)   q.set("streetName",   props.streetName);
    if (props.houseNumber)  q.set("houseNumber",  props.houseNumber);

    fetch(`/api/market?${q}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) setErr(j.error);
        else setData(j.analysis);
      })
      .catch(() => setErr("שגיאת רשת"))
      .finally(() => setLoading(false));
  }, [props.neighborhoodId, props.neighborhood]);

  if (loading) return <div className="py-6 text-center text-xs text-slate-400 animate-pulse">טוען נתוני שוק…</div>;
  if (err || !data) return <div className="py-4 text-center text-xs text-slate-400">אין נתוני שוק לשכונה זו</div>;

  const badge = data.priceBadge ? BADGE_CONFIG[data.priceBadge] : null;
  const diffSign = (data.priceDiffPct ?? 0) >= 0 ? "+" : "";

  return (
    <div className="p-4 space-y-4 text-sm" dir="rtl">
      {/* שורת סיכום */}
      <div className="flex flex-wrap items-center gap-3">
        {badge && (
          <span className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${badge.cls}`}>
            {badge.icon} {badge.label}
            {data.priceDiffPct != null && (
              <span className="opacity-70">({diffSign}{data.priceDiffPct}%)</span>
            )}
          </span>
        )}
        {data.isHotLead && (
          <span className="rounded-full bg-red-100 border border-red-200 text-red-700 px-3 py-1 text-xs font-bold">
            🔥 ליד חם — פוטנציאל מכירה מהיר
          </span>
        )}
      </div>

      {/* מדדי שוק */}
      <div className={`grid gap-3 ${data.streetScope ? "grid-cols-4" : "grid-cols-3"}`}>
        <MetricBox
          label="חציון ₪/מ״ר בשכונה"
          value={NIS(data.medianPricePerSqm)}
          sub={`${data.basedOnDeals} עסקאות · ${data.windowMonths} חודשים`}
        />
        {data.streetScope && data.streetMedianPricePerSqm != null && (
          <MetricBox
            label={data.streetScope === "building" ? "חציון ₪/מ״ר — בניין" : "חציון ₪/מ״ר — רחוב"}
            value={NIS(data.streetMedianPricePerSqm)}
            sub={`${data.streetBasedOnDeals} עסקאות · 4 שנים`}
            scopeHighlight={data.streetScope}
          />
        )}
        <MetricBox
          label="₪/מ״ר של הנכס הזה"
          value={data.leadPricePerSqm ? NIS(data.leadPricePerSqm) : "—"}
          sub={data.priceDiffPct != null ? `${diffSign}${data.priceDiffPct}% מהחציון` : ""}
          highlight={data.priceBadge}
        />
        <MetricBox
          label="מגמה 24 חודשים"
          value={data.trend ? `${data.trend.changePct >= 0 ? "+" : ""}${data.trend.changePct}%` : "—"}
          sub={data.trend ? `${data.trend.points.length} רבעונים` : "אין מספיק נתונים"}
          trendDir={data.trend ? (data.trend.changePct >= 0 ? "up" : "down") : undefined}
        />
      </div>

      {/* עסקאות אחרונות */}
      {data.recentDeals.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
            עסקאות אחרונות בשכונה
          </h4>
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-100 bg-slate-50">
                  <th className="text-right px-3 py-2 font-medium">תאריך</th>
                  <th className="text-right px-3 py-2 font-medium">רחוב</th>
                  <th className="text-right px-3 py-2 font-medium">חד'</th>
                  <th className="text-right px-3 py-2 font-medium">מ"ר</th>
                  <th className="text-right px-3 py-2 font-medium">קומה</th>
                  <th className="text-right px-3 py-2 font-medium">מחיר</th>
                  <th className="text-right px-3 py-2 font-medium">₪/מ"ר</th>
                </tr>
              </thead>
              <tbody>
                {data.recentDeals.map((d, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-500">{FMT_DATE(d.dealDate)}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {d.street ? `${d.street}${d.houseNumber ? " " + d.houseNumber : ""}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{d.rooms ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{d.areaSqm ?? d.plotSqm ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{d.floor ?? "—"}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{NIS(d.price)}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {d.pricePerSqm ? NIS(d.pricePerSqm) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">
            מקור: נדל״ן גוב · עודכן עד {new Date(data.asOf).toLocaleDateString("he-IL")}
          </p>
        </div>
      )}
    </div>
  );
}

function MetricBox({
  label, value, sub, highlight, trendDir, scopeHighlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: PriceBadge | null;
  trendDir?: "up" | "down";
  scopeHighlight?: "building" | "street" | null;
}) {
  const valueColor =
    highlight === "below" ? "text-emerald-600" :
    highlight === "above" ? "text-amber-600" :
    trendDir === "up"     ? "text-emerald-600" :
    trendDir === "down"   ? "text-red-500" :
    "text-slate-800";

  const boxCls =
    scopeHighlight === "building" ? "rounded-xl bg-brand/8 border border-brand/20 p-3 space-y-0.5" :
    scopeHighlight === "street"   ? "rounded-xl bg-blue-50 border border-blue-100 p-3 space-y-0.5" :
    "rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-0.5";

  return (
    <div className={boxCls}>
      <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-black ${valueColor}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}
