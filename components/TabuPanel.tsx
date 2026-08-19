"use client";

import { useState } from "react";
import type { TabuStatus } from "@/lib/types";

interface Props {
  leadId: string;
  address?: string | null;
  neighborhood?: string | null;
  initialStatus?: TabuStatus | null;
  initialNotes?: string | null;
  initialOrderedAt?: string | null;
  onStatusChange?: (status: TabuStatus) => void;
}

const STATUS_OPTS: { value: TabuStatus; label: string; icon: string; cls: string }[] = [
  { value: "pending",      label: "טרם הוזמן",  icon: "🔴", cls: "bg-slate-100 text-slate-500" },
  { value: "ordered",      label: "בהמתנה",     icon: "🟡", cls: "bg-amber-100 text-amber-700" },
  { value: "clean",        label: "נקי",        icon: "🟢", cls: "bg-emerald-100 text-emerald-700" },
  { value: "needs_review", label: "לבדיקה",     icon: "⚠️", cls: "bg-red-100 text-red-700" },
];

const TABU_SERVICE_URL = "https://www.gov.il/he/service/land_registration_extract";

export const TABU_BADGE: Record<TabuStatus, { label: string; cls: string }> = {
  pending:      { label: "טאבו: טרם הוזמן", cls: "bg-slate-100 text-slate-400" },
  ordered:      { label: "טאבו: בהמתנה",   cls: "bg-amber-100 text-amber-700" },
  clean:        { label: "טאבו: נקי ✓",    cls: "bg-emerald-100 text-emerald-700" },
  needs_review: { label: "טאבו: לבדיקה",   cls: "bg-red-100 text-red-700" },
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export default function TabuPanel({
  leadId, address, neighborhood,
  initialStatus, initialNotes, initialOrderedAt,
  onStatusChange,
}: Props) {
  const [status, setStatus]   = useState<TabuStatus>(initialStatus ?? "pending");
  const [notes, setNotes]     = useState(initialNotes ?? "");
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [orderedAt]           = useState(initialOrderedAt);

  async function save(newStatus: TabuStatus, newNotes: string) {
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`/api/admin/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabuStatus: newStatus, tabuNotes: newNotes || null }),
      });
      onStatusChange?.(newStatus);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      alert("שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  }

  const currentOpt = STATUS_OPTS.find((o) => o.value === status)!;

  // build a helpful govmap/search link for locating gush/helka
  const searchQuery = address
    ? encodeURIComponent(address + (address.includes("נתניה") ? "" : " נתניה"))
    : neighborhood
    ? encodeURIComponent(neighborhood + " נתניה")
    : null;
  const govmapParcelUrl = searchQuery
    ? `https://www.govmap.gov.il/?q=${searchQuery}&c=&z=9&lay=PARCEL_ALL`
    : "https://www.govmap.gov.il/?z=9&lay=PARCEL_ALL";

  return (
    <div className="p-4 space-y-5 text-sm" dir="rtl">
      {/* הסבר */}
      <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700 space-y-1">
        <p className="font-semibold">בדיקת נקיון משפטי — נסח טאבו</p>
        <p>
          בדיקת הערות אזהרה, עיקולים ומשכנתאות מתבצעת דרך הזמנת נסח רשמי מרשם המקרקעין.
          אין API ציבורי לשליפה אוטומטית — יש להזמין ידנית.
        </p>
      </div>

      {/* שלב 1 — מציאת גוש/חלקה */}
      <div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">שלב 1 — זהה גוש וחלקה</p>
        <a
          href={govmapParcelUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
        >
          🗺️ פתח Govmap — שכבת גוש/חלקה
          {address && <span className="text-slate-400 font-normal truncate max-w-[180px]">({address})</span>}
        </a>
        <p className="text-[10px] text-slate-400 mt-1">לחץ על הנכס על המפה לקבלת מספרי גוש וחלקה</p>
      </div>

      {/* שלב 2 — הזמנת נסח */}
      <div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">שלב 2 — הזמן נסח טאבו</p>
        <a
          href={TABU_SERVICE_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-brand text-white px-4 py-2 text-xs font-semibold hover:opacity-90 transition"
        >
          📄 הזמן נסח טאבו (gov.il)
        </a>
        <p className="text-[10px] text-slate-400 mt-1">
          שירות דיגיטלי של משרד המשפטים · תשלום מינימלי · חתום אלקטרונית
        </p>
      </div>

      {/* שלב 3 — עדכון סטטוס */}
      <div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">שלב 3 — עדכן סטטוס לאחר קבלת הנסח</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {STATUS_OPTS.map((o) => (
            <button
              key={o.value}
              onClick={() => setStatus(o.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                status === o.value
                  ? o.cls + " border-current ring-2 ring-offset-1 ring-current ring-opacity-30"
                  : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
              }`}
            >
              {o.icon} {o.label}
            </button>
          ))}
        </div>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="הערות (אופציונלי): ממצאים, שמות בעלים, הערות אזהרה שנמצאו…"
          rows={2}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 placeholder-slate-300 outline-none focus:border-brand resize-none mb-2"
        />

        <div className="flex items-center gap-3">
          <button
            onClick={() => save(status, notes)}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg bg-brand text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition"
          >
            {saving ? "שומר…" : "שמור"}
          </button>
          {saved && <span className="text-xs text-emerald-600 font-medium">✓ נשמר</span>}
          {orderedAt && (
            <span className="text-[10px] text-slate-400">
              הוזמן ב-{fmtDate(orderedAt)}
            </span>
          )}
        </div>
      </div>

      {/* סטטוס נוכחי */}
      <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
        <span className="text-[10px] text-slate-400">סטטוס נוכחי:</span>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${currentOpt.cls}`}>
          {currentOpt.icon} {currentOpt.label}
        </span>
      </div>
    </div>
  );
}
