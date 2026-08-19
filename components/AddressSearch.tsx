"use client";

import { useEffect, useRef, useState } from "react";

export interface StreetSuggestion {
  label: string;            // שם הרחוב להצגה
  street: string;
  neighborhoodId: string;
  neighborhoodName: string;
  x?: number | null;        // קואורדינטת הרחוב (ITM) — לסינון לפי מרחק
  y?: number | null;
  houseNumber?: string;     // מספר בית (אם הוזן) — לדיוק לרמת בניין
}

interface Props {
  onSelect: (s: StreetSuggestion) => void;
  onClear: () => void;
  onHouseNumberChange?: (n: string) => void;
  selected: StreetSuggestion | null;
  houseNumber?: string;
  houseNumberNotFound?: boolean;
  neighborhoods?: { id: string; name: string; x?: number; y?: number }[];
}

interface ApiSuggestion {
  label: string;
  street: string;
  neighborhoodId: string;
  neighborhoodName: string;
  x?: number | null;
  y?: number | null;
}

export default function AddressSearch({ onSelect, onClear, selected, houseNumber, houseNumberNotFound, onHouseNumberChange }: Props) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<ApiSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function h(e: MouseEvent | TouchEvent) {
      const t = e.target as Node;
      if (!listRef.current?.contains(t) && !inputRef.current?.contains(t))
        setOpen(false);
    }
    document.addEventListener("mousedown", h as EventListener);
    document.addEventListener("touchstart", h as EventListener, { passive: true });
    return () => {
      document.removeEventListener("mousedown", h as EventListener);
      document.removeEventListener("touchstart", h as EventListener);
    };
  }, []);

  function handleInput(v: string) {
    setQuery(v);
    setOpen(true);
    if (debounce.current) clearTimeout(debounce.current);
    if (v.trim().length < 1) { setSuggestions([]); return; }
    debounce.current = setTimeout(() => fetchSuggestions(v), 300);
  }

  function triggerSearch() {
    if (query.trim().length >= 1) {
      if (debounce.current) clearTimeout(debounce.current);
      setOpen(true);
      fetchSuggestions(query);
    }
  }

  async function fetchSuggestions(q: string) {
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const r = await fetch(`/api/autocomplete?q=${encodeURIComponent(q)}`, { signal: controller.signal });
      if (!r.ok) { setSuggestions([]); return; }
      const j = await r.json();
      setSuggestions(j.suggestions ?? []);
    } catch { setSuggestions([]); }
    finally { clearTimeout(timer); setLoading(false); }
  }

  function pick(s: ApiSuggestion) {
    setOpen(false);
    setSuggestions([]);
    setQuery(s.street);
    // השכונה כבר מגיעה עם ההצעה — אין צורך בקריאה נוספת
    onSelect({
      label: s.street,
      street: s.street,
      neighborhoodId: s.neighborhoodId,
      neighborhoodName: s.neighborhoodName,
      x: s.x ?? null,
      y: s.y ?? null,
    });
  }

  function clear() {
    setQuery(""); setSuggestions([]); onClear();
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  // — מצב "נבחר" — רחוב + שדה מספר בית
  if (selected) {
    return (
      <div className="space-y-2">
        <div className="rounded-xl border-2 border-green-200 bg-green-50 px-4 py-3 flex items-center gap-3">
          <span className="text-green-500 text-xl font-bold flex-shrink-0">✓</span>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-slate-800 truncate">{selected.street}</p>
            {selected.neighborhoodName
              ? <p className="text-xs font-semibold text-green-700">{selected.neighborhoodName}, נתניה</p>
              : <p className="text-xs text-slate-400">הזינו מספר בית לשיוך שכונה</p>}
          </div>
          <button onClick={clear} className="text-slate-400 hover:text-slate-700 text-lg flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center" title="שנה" aria-label="שנה רחוב">✕</button>
        </div>
        {/* מספר בית — מאפשר חיפוש ברמת בניין ספציפי */}
        <div className="flex items-center gap-2">
          <label htmlFor="addr-house-number" className="text-xs font-medium text-slate-600 shrink-0">מספר בית:</label>
          <input
            id="addr-house-number"
            type="text"
            inputMode="numeric"
            dir="ltr"
            className="field-input max-w-[90px] text-center"
            placeholder="12"
            autoComplete="address-line2"
            value={houseNumber ?? ""}
            onChange={(e) => onHouseNumberChange?.(e.target.value.replace(/[^\d\w]/g, ""))}
          />
          <span className="text-xs text-slate-400">(לא חובה — ישפר דיוק)</span>
          {houseNumberNotFound && (
            <span className="text-xs font-medium text-amber-600">⚠ מספר לא נמצא — שכונה משוייכת לפי שם הרחוב</span>
          )}
        </div>
      </div>
    );
  }

  // — מצב חיפוש —
  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id="addr-street-search"
          aria-label="חיפוש רחוב"
          type="text"
          dir="rtl"
          className="field-input pe-10"
          placeholder="הקלד שם רחוב (ויצמן, הרצל, ביל&quot;ו...)"
          value={query}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => handleInput(e.target.value)}
          onCompositionEnd={(e) => handleInput((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === "Enter" && triggerSearch()}
          onFocus={() => { if (query.length >= 1) { setOpen(true); triggerSearch(); } }}
        />
        <button
          type="button"
          aria-label="חפש רחוב"
          className="absolute left-1 top-1/2 -translate-y-1/2 text-slate-400 hover:text-brand transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          onMouseDown={(e) => { e.preventDefault(); triggerSearch(); }}
          onTouchEnd={(e) => { e.preventDefault(); triggerSearch(); }}
        >
          {loading ? (
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 11-8 8z"/>
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth="2">
              <circle cx="8" cy="8" r="5"/><path d="m13 13 3 3" strokeLinecap="round"/>
            </svg>
          )}
        </button>
      </div>

      {open && suggestions.length > 0 && (
        <div ref={listRef} className="absolute z-50 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden max-h-72 overflow-y-auto">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              aria-label={`בחר ${s.street}`}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-right hover:bg-brand/5 transition-colors border-b border-slate-100 last:border-0"
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              onTouchEnd={(e) => { e.preventDefault(); pick(s); }}
            >
              <span className="text-brand/50 flex-shrink-0">📍</span>
              <span className="flex-1 min-w-0 text-right">
                <span className="block text-sm font-medium text-slate-800 truncate">{s.street}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {open && !loading && query.length >= 1 && suggestions.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-slate-100 bg-white px-4 py-3 text-sm text-slate-500 shadow-lg">
          לא נמצא רחוב — בחרו שכונה ידנית
        </div>
      )}
    </div>
  );
}
