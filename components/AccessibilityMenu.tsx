"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { A11Y_DEFAULTS, A11Y_STORAGE_KEY, a11yClasses, type A11yPrefs } from "@/lib/a11yPrefs";

/**
 * תפריט נגישות — בנוי באתר עצמו, בלי תוסף חיצוני.
 * ההגדרות נשמרות כ-class על <html> (ראו globals.css, "a11y-") וב-localStorage של המבקר.
 * הסקריפט A11Y_BOOT_SCRIPT ב-layout מחיל אותן לפני הציור הראשון, כדי שלא יהיה הבהוב.
 * עיצוב: כותרת כהה, כרטיסי פעולה עם אייקון בשתי עמודות, מקובצים ל"טקסט" ו"ויזואלי".
 */

const NAVY = "#0f1d45";

function apply(p: A11yPrefs) {
  const c = document.documentElement.classList;
  for (const [cls, on] of Object.entries(a11yClasses(p))) c.toggle(cls, on);
}

function load(): A11yPrefs {
  try {
    return { ...A11Y_DEFAULTS, ...JSON.parse(localStorage.getItem(A11Y_STORAGE_KEY) || "{}") };
  } catch {
    return A11Y_DEFAULTS;
  }
}

const icon = (d: ReactNode) => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const ICONS = {
  text: icon(<><path d="M4 7V5h11v2" /><path d="M9.5 5v14" /><path d="M7.5 19h4" /><path d="M14 12v-1h6v1" /><path d="M17 11v8" /><path d="M16 19h2" /></>),
  lh: icon(<><path d="M10 6h10M10 12h10M10 18h10" /><path d="M5 4v16" /><path d="M3 6l2-2 2 2M3 18l2 2 2-2" /></>),
  spacing: icon(<><path d="M3 18l3.5-10L10 18M4.3 14.5h4.4" /><path d="M14 8v10M14 8h3a2.5 2.5 0 010 5h-3M14 13h3.5a2.5 2.5 0 010 5H14" /></>),
  font: icon(<><path d="M4 18l4.5-12L13 18M5.7 14h5.6" /><circle cx="17.5" cy="15" r="3" /><path d="M20.5 12v6" /></>),
  contrast: icon(<><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17a8.5 8.5 0 000-17z" fill="currentColor" /></>),
  gray: icon(<path d="M12 3.5s-6 6.6-6 10.5a6 6 0 0012 0c0-3.9-6-10.5-6-10.5z" fill="currentColor" />),
  links: icon(<><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></>),
  motion: icon(<><circle cx="12" cy="12" r="8.5" /><path d="M10 9v6M14 9v6" /></>),
};

type StepKey = "text" | "lh";
type ToggleKey = "spacing" | "font" | "contrast" | "gray" | "links" | "motion";
type Tile = { label: string; icon: ReactNode } & ({ step: StepKey } | { toggle: ToggleKey });

const SECTIONS: { title: string; tiles: Tile[] }[] = [
  {
    title: "טקסט",
    tiles: [
      { label: "טקסט גדול יותר", icon: ICONS.text, step: "text" },
      { label: "גובה שורה", icon: ICONS.lh, step: "lh" },
      { label: "ריווח אותיות", icon: ICONS.spacing, toggle: "spacing" },
      { label: "גופן קריא", icon: ICONS.font, toggle: "font" },
    ],
  },
  {
    title: "ויזואלי",
    tiles: [
      { label: "ניגודיות", icon: ICONS.contrast, toggle: "contrast" },
      { label: "גווני אפור", icon: ICONS.gray, toggle: "gray" },
      { label: "הדגשת קישורים", icon: ICONS.links, toggle: "links" },
      { label: "עצירת אנימציות", icon: ICONS.motion, toggle: "motion" },
    ],
  },
];

export default function AccessibilityMenu() {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<A11yPrefs>(A11Y_DEFAULTS);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setPrefs(load()); }, []);

  function update(change: (p: A11yPrefs) => A11yPrefs) {
    setPrefs((prev) => {
      const next = change(prev);
      apply(next);
      try { localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) btnRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("[data-first]")?.focus();
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

  const changed = JSON.stringify(prefs) !== JSON.stringify(A11Y_DEFAULTS);

  function renderTile(t: Tile) {
    const level = "step" in t ? prefs[t.step] : prefs[t.toggle] ? 1 : 0;
    const active = level > 0;
    const onClick = () =>
      "step" in t
        ? update((p) => ({ ...p, [t.step]: ((p[t.step] + 1) % 3) as 0 | 1 | 2 }))
        : update((p) => ({ ...p, [t.toggle]: !p[t.toggle] }));
    return (
      <button
        key={t.label}
        type="button"
        onClick={onClick}
        aria-pressed={"step" in t ? undefined : active}
        aria-label={"step" in t ? `${t.label}: ${["רגיל", "בינוני", "גדול"][level]}` : undefined}
        className={`flex min-h-[76px] flex-col justify-center gap-2 rounded-2xl px-3 py-3 text-start transition-colors ${
          active ? "bg-[#e8ecf7] ring-2 ring-[#0f1d45]" : "bg-slate-100 hover:bg-slate-200/70"
        }`}
      >
        <span className="flex items-center gap-2.5">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${active ? "bg-[#0f1d45] text-white" : "bg-white text-[#0f1d45]"}`}>
            {t.icon}
          </span>
          <span className="text-[14px] font-medium leading-tight text-slate-900">{t.label}</span>
        </span>
        {"step" in t && (
          <span aria-hidden="true" className="flex gap-1 ps-[50px]">
            {[1, 2].map((i) => (
              <span key={i} className={`h-1.5 flex-1 rounded-full ${level >= i ? "bg-[#0f1d45]" : "bg-slate-300"}`} />
            ))}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="a11y-menu" dir="rtl">
      <button
        ref={btnRef}
        type="button"
        aria-label="תפריט נגישות"
        aria-expanded={open}
        aria-controls="a11y-panel"
        onClick={() => (open ? close() : setOpen(true))}
        className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-[calc(1.5rem+env(safe-area-inset-right))] z-50 flex h-12 w-12 items-center justify-center rounded-full text-white shadow-[0_8px_24px_-6px_rgba(18,19,43,0.35)]"
        style={{ background: NAVY }}
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
          className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-50 flex max-h-[calc(100dvh-7rem)] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-[28px] bg-slate-100 text-[#0c0c0b] shadow-[0_18px_40px_-12px_rgba(18,19,43,0.45)]"
        >
          <div className="flex shrink-0 items-center justify-between rounded-b-[22px] px-4 py-3 text-white" style={{ background: NAVY }}>
            <p className="flex items-center gap-2 text-lg font-bold">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white" style={{ color: NAVY }}>
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="12" cy="4.5" r="1.6" fill="currentColor" stroke="none" />
                  <path d="M5 8.5c2.3.7 4.6 1 7 1s4.7-.3 7-1M12 9.5v4.5M12 14l-3 6M12 14l3 6" />
                </svg>
              </span>
              נגישות
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => update(() => A11Y_DEFAULTS)}
                disabled={!changed}
                aria-label="איפוס כל הגדרות הנגישות"
                className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-40"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 12a8 8 0 102.3-5.7L4 8.5" /><path d="M4 4v4.5h4.5" />
                </svg>
              </button>
              <span aria-hidden="true" className="h-5 w-px bg-white/30" />
              <button data-first type="button" onClick={() => close()} aria-label="סגירת תפריט הנגישות" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {SECTIONS.map((s) => (
              <section key={s.title} aria-labelledby={`a11y-sec-${s.title}`} className="rounded-3xl bg-white p-3">
                <h2 id={`a11y-sec-${s.title}`} className="mb-2.5 px-1 text-[15px] font-semibold text-slate-700">{s.title}</h2>
                <div className="grid grid-cols-2 gap-2">{s.tiles.map(renderTile)}</div>
              </section>
            ))}
          </div>

          <div className="flex shrink-0 items-center justify-between px-4 py-2.5 text-white" style={{ background: NAVY }}>
            <a href="/accessibility" className="flex min-h-[44px] items-center gap-1.5 text-sm font-medium hover:underline">
              הצהרת נגישות
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
              </svg>
            </a>
            <span className="text-xs text-white/70">נשמר במכשיר זה</span>
          </div>
        </div>
      )}
    </div>
  );
}
