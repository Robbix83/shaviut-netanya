"use client";

import { useState } from "react";
import type { Lead, LeadStatus } from "@/lib/types";
import MarketPanel from "@/components/MarketPanel";
import MavatPanel from "@/components/MavatPanel";
import AccessibilityPanel from "@/components/AccessibilityPanel";
import TabuPanel, { TABU_BADGE } from "@/components/TabuPanel";
import CbsPanel from "@/components/CbsPanel";
import type { TabuStatus } from "@/lib/types";

type PanelTab = "market" | "mavat" | "access" | "tabu" | "cbs";

/** פרסר כתובת עברית: "ויצמן 98, נתניה" → { street: "ויצמן", houseNumber: "98" } */
function parseAddress(addr: string | null): { street: string | null; houseNumber: string | null } {
  if (!addr) return { street: null, houseNumber: null };
  const clean = addr.replace(/,?\s*נתניה\s*$/i, "").trim();
  const m = clean.match(/^(.+?)\s+(\d+[א-ת]?)$/);
  if (m) return { street: m[1].trim(), houseNumber: m[2] };
  return { street: clean, houseNumber: null };
}

const STATUS_OPTS: { value: LeadStatus; label: string; color: string }[] = [
  { value: "new",          label: "חדש",         color: "bg-blue-100 text-blue-700" },
  { value: "contacted",    label: "פנוי",         color: "bg-green-100 text-green-700" },
  { value: "in_progress",  label: "בטיפול",       color: "bg-yellow-100 text-yellow-700" },
  { value: "closed",       label: "נסגר",         color: "bg-emerald-100 text-emerald-700" },
  { value: "not_relevant", label: "לא רלוונטי",   color: "bg-slate-100 text-slate-500" },
];

const PT_ICON: Record<string, string> = { apartment: "🏢", house: "🏡", land: "🌳" };
const TIMING: Record<string, { label: string; cls: string }> = {
  now:     { label: "🔥 חם",  cls: "bg-red-100 text-red-700" },
  year:    { label: "השנה",   cls: "bg-yellow-100 text-yellow-700" },
  curious: { label: "בודק",   cls: "bg-slate-100 text-slate-500" },
};

const NIS = (n: number | null | undefined) =>
  n ? "₪" + Math.round(n).toLocaleString("he-IL") : "—";

const FMT_DATE = (iso: string | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }) +
    " " +
    d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
  );
};

export default function LeadsTable({ leads }: { leads: Lead[] }) {
  const [rows, setRows]       = useState<Lead[]>(leads);
  const [filter, setFilter]   = useState<LeadStatus | "all">("all");
  const [updating, setUpdating] = useState<string | null>(null);
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<Record<string, PanelTab>>({});
  const [tabuStatuses, setTabuStatuses] = useState<Record<string, TabuStatus>>({});

  const visible = filter === "all" ? rows : rows.filter((l) => l.status === filter);

  async function changeStatus(id: string, status: LeadStatus) {
    setUpdating(id);
    try {
      await fetch(`/api/admin/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setRows((r) => r.map((l) => (l.id === id ? { ...l, status } : l)));
    } catch {
      alert("שגיאה בעדכון סטטוס");
    } finally {
      setUpdating(null);
    }
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setActiveTab((prev) => prev[id] ? prev : { ...prev, [id]: "market" });
  }

  function getTab(id: string): PanelTab { return activeTab[id] ?? "market"; }
  function setTab(id: string, tab: PanelTab) { setActiveTab((prev) => ({ ...prev, [id]: tab })); }

  const statusColor = (s: string | undefined) =>
    STATUS_OPTS.find((o) => o.value === s)?.color ?? "bg-slate-100 text-slate-500";

  const hasMarketData = (l: Lead) =>
    !!(l.neighborhood || (l as any).neighborhoodId);

  return (
    <div>
      {/* filter bar */}
      <div className="flex gap-2 px-5 py-3 border-b border-slate-100 flex-wrap">
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-1 rounded-full text-xs font-medium transition ${filter === "all" ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
        >
          הכל ({rows.length})
        </button>
        {STATUS_OPTS.map((o) => {
          const cnt = rows.filter((l) => l.status === o.value).length;
          return (
            <button
              key={o.value}
              onClick={() => setFilter(o.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${filter === o.value ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {o.label} ({cnt})
            </button>
          );
        })}
      </div>

      {/* table */}
      {visible.length === 0 ? (
        <p className="p-8 text-center text-slate-400 text-sm">אין לידים</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-100">
                <th className="px-3 py-3 w-6" />
                <th className="text-right px-4 py-3 font-medium">שם</th>
                <th className="text-right px-4 py-3 font-medium">טלפון</th>
                <th className="text-right px-4 py-3 font-medium">נכס</th>
                <th className="text-right px-4 py-3 font-medium">כתובת</th>
                <th className="text-right px-4 py-3 font-medium">שכונה</th>
                <th className="text-right px-4 py-3 font-medium">שווי משוער</th>
                <th className="text-right px-4 py-3 font-medium">מקור</th>
                <th className="text-right px-4 py-3 font-medium">תאריך</th>
                <th className="text-right px-4 py-3 font-medium">סטטוס</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {visible.map((lead) => {
                const pt = (lead as any).propertyType || "apartment";
                const isOpen = expanded.has(lead.id!);
                return (
                  <>
                    <tr
                      key={lead.id}
                      className={`border-b border-slate-50 transition ${isOpen ? "bg-slate-50" : "hover:bg-slate-50"}`}
                    >
                      {/* expand toggle */}
                      <td className="px-3 py-3">
                        {hasMarketData(lead) && (
                          <button
                            onClick={() => toggleExpand(lead.id!)}
                            className="text-slate-300 hover:text-brand transition text-base leading-none"
                            title="נתוני שוק"
                          >
                            {isOpen ? "▼" : "▶"}
                          </button>
                        )}
                      </td>

                      <td className="px-4 py-3 font-medium text-slate-800">
                        {lead.name}
                        {lead.sellTiming && TIMING[lead.sellTiming] && (
                          <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${TIMING[lead.sellTiming].cls}`}>
                            {TIMING[lead.sellTiming].label}
                          </span>
                        )}
                        {(() => {
                          const ts = tabuStatuses[lead.id!] ?? (lead as any).tabuStatus as TabuStatus | undefined;
                          if (!ts || ts === "pending") return null;
                          const b = TABU_BADGE[ts];
                          return (
                            <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${b.cls}`}>
                              {b.label}
                            </span>
                          );
                        })()}
                      </td>

                      <td className="px-4 py-3 text-slate-600 font-mono text-xs">{lead.phone}</td>

                      <td className="px-4 py-3">
                        <span className="text-base">{PT_ICON[pt] || "🏠"}</span>
                        {lead.rooms   && <span className="text-xs text-slate-500 ml-1">{lead.rooms}חד'</span>}
                        {lead.areaSqm && <span className="text-xs text-slate-400 ml-1">{lead.areaSqm}מ"ר</span>}
                      </td>

                      <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                        {(() => {
                          const { street, houseNumber: hn } = parseAddress(lead.address);
                          const streetPart = street
                            ? `${street}${(lead as any).houseNumber || hn ? " " + ((lead as any).houseNumber || hn) : ""}`
                            : lead.address || "—";
                          const floorPart = (lead as any).floor != null ? ` · קומה ${(lead as any).floor}` : "";
                          return streetPart + floorPart;
                        })()}
                      </td>

                      <td className="px-4 py-3 text-slate-600 text-xs">{lead.neighborhood || "—"}</td>

                      <td className="px-4 py-3 text-slate-800 font-medium text-xs">
                        {lead.estimateLow && lead.estimateHigh
                          ? `${NIS(lead.estimateLow)}–${NIS(lead.estimateHigh)}`
                          : "—"}
                      </td>

                      <td className="px-4 py-3 text-slate-400 text-xs max-w-[100px] truncate">
                        {lead.source?.replace(/^https?:\/\//, "").slice(0, 20) || "—"}
                      </td>

                      <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                        {FMT_DATE(lead.createdAt)}
                      </td>

                      <td className="px-4 py-3">
                        <select
                          value={lead.status || "new"}
                          disabled={updating === lead.id}
                          onChange={(e) => changeStatus(lead.id!, e.target.value as LeadStatus)}
                          className={`text-xs font-medium rounded-full px-2 py-1 border-0 cursor-pointer outline-none ${statusColor(lead.status)} ${updating === lead.id ? "opacity-50" : ""}`}
                        >
                          {STATUS_OPTS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </td>

                      <td className="px-4 py-3">
                        <a
                          href={`https://wa.me/972${lead.phone.replace(/^0/, "")}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-green-600 hover:text-green-700 text-lg"
                          title="פתח WhatsApp"
                        >
                          💬
                        </a>
                      </td>
                    </tr>

                    {/* expanded panel with tabs */}
                    {isOpen && (
                      <tr key={`${lead.id}-panel`} className="bg-slate-50 border-b border-slate-100">
                        <td />
                        <td colSpan={10} className="px-2 pb-3">
                          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                            {/* tab bar */}
                            <div className="flex border-b border-slate-100 bg-slate-50">
                              {(["market", "mavat", "access", "tabu", "cbs"] as PanelTab[]).map((tab) => (
                                <button
                                  key={tab}
                                  onClick={() => setTab(lead.id!, tab)}
                                  className={`px-4 py-2.5 text-xs font-semibold transition border-b-2 ${
                                    getTab(lead.id!) === tab
                                      ? "border-brand text-brand bg-white"
                                      : "border-transparent text-slate-500 hover:text-slate-700"
                                  }`}
                                >
                                  {tab === "market" ? "📊 נתוני שוק"
                                    : tab === "mavat" ? "🏛️ תכנון (MAVAT)"
                                    : tab === "access" ? "📍 מיקום ותשתיות"
                                    : tab === "tabu" ? "📄 טאבו"
                                    : "🏘️ פרופיל שכונה"}
                                </button>
                              ))}
                            </div>
                            {/* tab content */}
                            {getTab(lead.id!) === "market" ? (
                              <MarketPanel
                                neighborhoodId={(lead as any).neighborhoodId}
                                neighborhood={lead.neighborhood}
                                propertyType={pt}
                                rooms={lead.rooms}
                                areaSqm={lead.areaSqm}
                                plotSqm={(lead as any).plotSqm}
                                estimateLow={lead.estimateLow}
                                estimateHigh={lead.estimateHigh}
                                streetName={parseAddress(lead.address).street}
                                houseNumber={parseAddress(lead.address).houseNumber}
                              />
                            ) : getTab(lead.id!) === "mavat" ? (
                              <MavatPanel
                                address={lead.address}
                                neighborhood={lead.neighborhood}
                              />
                            ) : getTab(lead.id!) === "access" ? (
                              <AccessibilityPanel
                                address={lead.address}
                                neighborhoodId={(lead as any).neighborhoodId}
                                neighborhood={lead.neighborhood}
                              />
                            ) : getTab(lead.id!) === "tabu" ? (
                              <TabuPanel
                                leadId={lead.id!}
                                address={lead.address}
                                neighborhood={lead.neighborhood}
                                initialStatus={(lead as any).tabuStatus ?? null}
                                initialNotes={(lead as any).tabuNotes ?? null}
                                initialOrderedAt={(lead as any).tabuOrderedAt ?? null}
                                onStatusChange={(s) =>
                                  setTabuStatuses((prev) => ({ ...prev, [lead.id!]: s }))
                                }
                              />
                            ) : (
                              <CbsPanel neighborhood={lead.neighborhood} />
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
