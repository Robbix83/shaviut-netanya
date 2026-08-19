import { getStore } from "@/lib/store";
import LeadsTable from "./LeadsTable";
import type { Lead } from "@/lib/types";

function isoToday() { return new Date().toISOString().slice(0, 10); }
function isoWeekAgo() { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); }
function isoMonthAgo() { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); }
function isoTwoMonthsAgo() { const d = new Date(); d.setMonth(d.getMonth() - 2); return d.toISOString().slice(0, 10); }

const PT_LABEL: Record<string, { label: string; color: string }> = {
  apartment: { label: "דירה 🏢", color: "bg-blue-500" },
  house:     { label: "בית 🏡",  color: "bg-emerald-500" },
  land:      { label: "מגרש 🌳", color: "bg-amber-500" },
};
const STATUS_META: Record<string, { label: string; color: string }> = {
  new:          { label: "חדש",          color: "bg-blue-500" },
  contacted:    { label: "פנוי",         color: "bg-green-500" },
  in_progress:  { label: "בטיפול",       color: "bg-yellow-500" },
  closed:       { label: "נסגר",         color: "bg-emerald-600" },
  not_relevant: { label: "לא רלוונטי",   color: "bg-slate-400" },
};

export default async function Dashboard() {
  const store = getStore();
  const leads: Lead[] = await store.getLeads();

  const today = isoToday();
  const weekAgo = isoWeekAgo();
  const monthAgo = isoMonthAgo();
  const twoMonthsAgo = isoTwoMonthsAgo();

  const todayCount   = leads.filter((l) => (l.createdAt || "").slice(0, 10) === today).length;
  const weekCount    = leads.filter((l) => (l.createdAt || "") >= weekAgo + "T").length;
  const monthCount   = leads.filter((l) => (l.createdAt || "") >= monthAgo + "T").length;
  const prevMonthCount = leads.filter((l) => {
    const d = l.createdAt || "";
    return d >= twoMonthsAgo + "T" && d < monthAgo + "T";
  }).length;

  // trend vs last month
  const trend = prevMonthCount > 0
    ? Math.round(((monthCount - prevMonthCount) / prevMonthCount) * 100)
    : monthCount > 0 ? 100 : 0;

  // breakdown
  const byType: Record<string, number> = {};
  leads.forEach((l) => { const t = (l as any).propertyType || "apartment"; byType[t] = (byType[t] || 0) + 1; });
  const byStatus: Record<string, number> = {};
  leads.forEach((l) => { const s = l.status || "new"; byStatus[s] = (byStatus[s] || 0) + 1; });

  // conversion: closed / total
  const convRate = leads.length > 0
    ? Math.round(((byStatus["closed"] || 0) / leads.length) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">לוח בקרה</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {leads.length} לידים סה״כ · המרה {convRate}%
          </p>
        </div>
        <span className="text-xs text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
          {new Date().toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" })}
        </span>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="היום" value={todayCount} icon="📅" gradient="from-sky-50 to-blue-100" text="text-blue-700" />
        <StatCard label="השבוע" value={weekCount} icon="📆" gradient="from-indigo-50 to-indigo-100" text="text-indigo-700" />
        <StatCard label="החודש" value={monthCount} trend={trend} icon="🗓️" gradient="from-violet-50 to-violet-100" text="text-violet-700" />
        <StatCard label="סה״כ" value={leads.length} icon="📋" gradient="from-slate-50 to-slate-100" text="text-slate-700" />
      </div>

      {/* Breakdown row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-white border border-slate-200 p-5">
          <h2 className="text-sm font-bold text-slate-700 mb-4">לפי סוג נכס</h2>
          <div className="space-y-3">
            {Object.entries(byType).map(([type, count]) => (
              <BarRow
                key={type}
                label={PT_LABEL[type]?.label || type}
                barColor={PT_LABEL[type]?.color || "bg-brand"}
                value={count}
                total={leads.length}
              />
            ))}
            {Object.keys(byType).length === 0 && (
              <p className="text-xs text-slate-400 text-center py-2">אין נתונים</p>
            )}
          </div>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-5">
          <h2 className="text-sm font-bold text-slate-700 mb-4">לפי סטטוס</h2>
          <div className="space-y-3">
            {Object.entries(byStatus).map(([status, count]) => (
              <BarRow
                key={status}
                label={STATUS_META[status]?.label || status}
                barColor={STATUS_META[status]?.color || "bg-brand"}
                value={count}
                total={leads.length}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Leads table */}
      <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-800">כל הלידים</h2>
          <span className="text-xs text-slate-400 bg-slate-50 px-2.5 py-1 rounded-full border border-slate-200">
            {leads.length} רשומות
          </span>
        </div>
        <LeadsTable leads={leads} />
      </div>
    </div>
  );
}

function StatCard({
  label, value, trend, icon, gradient, text,
}: { label: string; value: number; trend?: number; icon: string; gradient: string; text: string }) {
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${gradient} p-5 relative overflow-hidden`}>
      <div className="flex items-start justify-between">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide opacity-60 ${text}`}>{label}</p>
          <p className={`text-4xl font-black mt-1 ${text}`}>{value}</p>
        </div>
        <span className="text-2xl opacity-60">{icon}</span>
      </div>
      {trend !== undefined && (
        <div className={`mt-2 flex items-center gap-1 text-xs font-semibold ${trend >= 0 ? "text-green-600" : "text-red-500"}`}>
          <span>{trend >= 0 ? "↑" : "↓"}</span>
          <span>{Math.abs(trend)}% מהחודש הקודם</span>
        </div>
      )}
    </div>
  );
}

function BarRow({ label, value, total, barColor }: { label: string; value: number; total: number; barColor: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 text-xs text-slate-600 shrink-0 truncate">{label}</span>
      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
        <div className={`${barColor} h-2 rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-500 w-10 text-left shrink-0">{value} ({pct}%)</span>
    </div>
  );
}
