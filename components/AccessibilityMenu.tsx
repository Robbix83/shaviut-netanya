"use client";

import { useEffect, useRef, useState } from "react";
import { A11Y_STORAGE_KEY } from "@/lib/a11yPrefs";

/**
 * תפריט נגישות — בנוי באתר עצמו, בלי תוסף חיצוני.
 * ההגדרות נשמרות כ-class על <html> (ראו globals.css, "a11y-") וב-localStorage של המבקר.
 * הסקריפט A11Y_BOOT_SCRIPT ב-layout מחיל אותן לפני הציור הראשון, כדי שלא יהיה הבהוב.
 */

type Prefs = { text: 0 | 1 | 2; contrast: boolean; links: boolean; motion: boolean };
const DEFAULTS: Prefs = { text: 0, contrast: false, links: false, motion: false };

function apply(p: Prefs) {
  const c = document.documentElement.classList;
  c.toggle("a11y-text-1", p.text === 1);
  c.toggle("a11y-text-2", p.text === 2);
  c.toggle("a11y-contrast", p.contrast);
  c.toggle("a11y-links", p.links);
  c.toggle("a11y-no-motion", p.motion);
}

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(A11Y_STORAGE_KEY) || "{}") };
  } catch {
    return DEFAULTS;
  }
}

export default function AccessibilityMenu() {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setPrefs(load()); }, []);

  function update(next: Prefs) {
    setPrefs(next);
    apply(next);
    try { localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(next)); } catch {}
  }

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) btnRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") close(); }
    function onDown(e: MouseEvent | TouchEvent) {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !btnRef.current?.contains(t)) close(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  const toggles: { key: "contrast" | "links" | "motion"; label: string }[] = [
    { key: "contrast", label: "ניגודיות גבוהה" },
    { key: "links", label: "הדגשת קישורים" },
    { key: "motion", label: "עצירת אנימציות" },
  ];
  const changed = prefs.text !== 0 || prefs.contrast || prefs.links || prefs.motion;

  return (
    <div className="a11y-menu" dir="rtl">
      <button
        ref={btnRef}
        type="button"
        aria-label="תפריט נגישות"
        aria-expanded={open}
        aria-controls="a11y-panel"
        onClick={() => (open ? close() : setOpen(true))}
        className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-[calc(1.5rem+env(safe-area-inset-right))] z-50 flex h-12 w-12 items-center justify-center rounded-full bg-[#1d4ed8] text-white shadow-[0_8px_24px_-6px_rgba(18,19,43,0.35)]"
      >
        {/* סמל הנגישות הבינלאומי */}
        <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="4.5" r="1.6" fill="currentColor" stroke="none" />
          <path d="M5 8.5c2.3.7 4.6 1 7 1s4.7-.3 7-1" />
          <path d="M12 9.5v4.5" />
          <path d="M12 14l-3 6" />
          <path d="M12 14l3 6" />
        </svg>
      </button>

      {open && (
        <div
          ref={panelRef}
          id="a11y-panel"
          role="dialog"
          aria-label="הגדרות נגישות"
          className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] right-[calc(1.5rem+env(safe-area-inset-right))] z-50 w-[min(18rem,calc(100vw-3rem))] rounded-3xl bg-white p-4 text-[#0c0c0b] shadow-[0_18px_40px_-12px_rgba(18,19,43,0.45)] ring-1 ring-slate-200"
        >
          <div className="flex items-center justify-between">
            <p className="text-base font-bold">נגישות</p>
            <button type="button" onClick={() => close()} aria-label="סגירת תפריט הנגישות" className="flex h-10 w-10 items-center justify-center rounded-full text-xl leading-none hover:bg-slate-100">×</button>
          </div>

          <p id="a11y-text-lbl" className="mt-2 text-sm font-medium text-slate-700">גודל טקסט</p>
          <div role="group" aria-labelledby="a11y-text-lbl" className="mt-1.5 grid grid-cols-3 gap-1.5">
            {([0, 1, 2] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={prefs.text === t}
                onClick={() => update({ ...prefs, text: t })}
                className={`min-h-[44px] whitespace-nowrap rounded-full px-1 font-semibold ${prefs.text === t ? "bg-[#0c0c0b] text-white" : "bg-slate-100 text-slate-800"}`}
                style={{ fontSize: `${14 + t * 2}px` }}
              >
                {t === 0 ? "רגיל" : t === 1 ? "גדול" : "גדול מאוד"}
              </button>
            ))}
          </div>

          <div className="mt-3 space-y-1.5">
            {toggles.map((o) => (
              <button
                key={o.key}
                type="button"
                aria-pressed={prefs[o.key]}
                onClick={() => update({ ...prefs, [o.key]: !prefs[o.key] })}
                className={`flex min-h-[44px] w-full items-center justify-between rounded-2xl px-4 text-[15px] font-medium ${prefs[o.key] ? "bg-[#0c0c0b] text-white" : "bg-slate-100 text-slate-800"}`}
              >
                <span>{o.label}</span>
                <span aria-hidden="true" className="text-sm">{prefs[o.key] ? "פעיל" : "כבוי"}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <a href="/accessibility" className="flex min-h-[44px] items-center text-sm font-medium underline">הצהרת נגישות</a>
            {changed && (
              <button type="button" onClick={() => update(DEFAULTS)} className="min-h-[44px] rounded-full px-3 text-sm font-medium text-slate-800 hover:bg-slate-100">
                איפוס
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
