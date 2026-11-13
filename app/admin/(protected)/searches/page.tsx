import { listSearches, isInternalSearch, type SearchRow } from "@/lib/searchLog";

export const dynamic = "force-dynamic";

const OUTCOME: Record<SearchRow["outcome"], { label: string; cls: string }> = {
  ok: { label: "קיבל שווי", cls: "bg-emerald-50 text-emerald-700" },
  no_match: { label: "כתובת לא זוהתה", cls: "bg-red-50 text-red-700" },
  insufficient_data: { label: "אין מספיק עסקאות", cls: "bg-amber-50 text-amber-700" },
  house_number_required: { label: "חסר מספר בית", cls: "bg-slate-100 text-slate-600" },
};
const TYPE: Record<string, string> = { apartment: "דירה", house: "בית", land: "מגרש" };

function sourceLabel(s: string | null): string {
  if (isInternalSearch(s)) return "בדיקה פנימית";
  const v = (s || "").toLowerCase();
  if (v === "direct") return "ישיר";
  if (/facebook|fb|instagram|meta|^ig$|^an$/.test(v)) return "פייסבוק/אינסטגרם";
  if (/google/.test(v)) return "גוגל";
  try {
    return new URL(v).hostname.replace(/^www\./, "");
  } catch {
    return v.slice(0, 24);
  }
}
const ils = (n: number | null) => (n == null ? "" : "₪" + Math.round(n).toLocaleString("he-IL"));
const ilTime = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "";
const ilDay = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }) : "");

function countBy(rows: SearchRow[], key: (r: SearchRow) => string): [string, number][] {
  const m = new Map<string, number>();
  rows.forEach((r) => m.set(key(r), (m.get(key(r)) || 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function propertyText(r: SearchRow): string {
  const parts = [TYPE[r.propertyType || ""] || r.propertyType || ""];
  if (r.rooms) parts.push(`${r.rooms} חד׳`);
  if (r.areaSqm) parts.push(`${r.areaSqm} מ״ר`);
  if (r.floor != null) parts.push(`קומה ${r.floor}`);
  return parts.filter(Boolean).join(" · ");
}

export default async function Searches() {
  const { rows: all, error } = await listSearches(500);
  const rows = all.filter((r) => !isInternalSearch(r.source)); // הסטטיסטיקה בלי בדיקות פנימיות; הטבלה מציגה הכול
  const internalCount = all.length - rows.length;
  const today = ilDay(new Date().toISOString());
  const todayCount = rows.filter((r) => ilDay(r.createdAt) === today).length;
  const okCount = rows.filter((r) => r.outcome === "ok").length;
  const failCount = rows.length - okCount;
  const byHood = countBy(rows.filter((r) => r.neighborhood), (r) => r.neighborhood as string).slice(0, 8);
  const bySource = countBy(rows, (r) => sourceLabel(r.source));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-800">חיפושים</h1>
        <p className="text-sm text-slate-500 mt-0.5">כל בדיקת שווי באתר, גם של מי שלא השאיר פרטים. בלי שם, טלפון או IP.
          {internalCount > 0 && ` המספרים לא כוללים ${internalCount} בדיקות פנימיות (מנהל מחובר או בדיקות מערכת).`}</p>
      </div>

      {error && <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">{error}</div>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="היום" value={todayCount} />
        <Stat label="סה״כ" value={rows.length} />
        <Stat label="קיבלו שווי" value={okCount} />
        <Stat label="נכשלו" value={failCount} warn={failCount > 0} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Breakdown title="לפי שכונה" items={byHood} total={okCount || 1} />
        <Breakdown title="מאיפה הגיעו" items={bySource} total={rows.length || 1} />
      </div>

      <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-800">כל החיפושים</h2>
          <span className="text-xs text-slate-400 bg-slate-50 px-2.5 py-1 rounded-full border border-slate-200">{all.length} רשומות</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 text-right">
                {["מתי", "כתובת", "שכונה", "נכס", "תוצאה", "שווי שהוצג", "מקור"].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {all.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap tabular-nums">{ilTime(r.createdAt)}</td>
                  <td className="px-4 py-3 text-slate-800">{[r.street, r.houseNumber].filter(Boolean).join(" ") || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{r.neighborhood || "—"}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{propertyText(r)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${OUTCOME[r.outcome]?.cls || ""}`}>
                      {OUTCOME[r.outcome]?.label || r.outcome}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-800 whitespace-nowrap tabular-nums">
                    {r.estimateLow ? `${ils(r.estimateLow)}–${ils(r.estimateHigh)}` : ""}
                  </td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{sourceLabel(r.source)}</td>
                </tr>
              ))}
              {all.length === 0 && !error && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                    עוד אין חיפושים. כל בדיקת שווי באתר תופיע כאן.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-5">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className={`text-4xl font-black mt-1 tabular-nums ${warn ? "text-red-600" : "text-slate-800"}`}>{value}</p>
    </div>
  );
}

function Breakdown({ title, items, total }: { title: string; items: [string, number][]; total: number }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-5">
      <h2 className="text-sm font-bold text-slate-700 mb-4">{title}</h2>
      <div className="space-y-3">
        {items.map(([k, v]) => (
          <div key={k} className="flex items-center gap-3">
            <span className="w-32 text-xs text-slate-600 shrink-0 truncate">{k}</span>
            <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
              <div className="bg-slate-700 h-2 rounded-full" style={{ width: `${Math.round((v / total) * 100)}%` }} />
            </div>
            <span className="text-xs text-slate-500 w-8 text-left shrink-0 tabular-nums">{v}</span>
          </div>
        ))}
        {items.length === 0 && <p className="text-xs text-slate-400 text-center py-2">אין נתונים</p>}
      </div>
    </div>
  );
}
