import { getStore } from "@/lib/store";
import { listSearches, isInternalSearch, type SearchRow } from "@/lib/searchLog";
import { getMetaInsights, type MetaDay } from "@/lib/metaAds";
import { isTestLead } from "@/lib/leadQuality";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

const PILOT_START = "2026-11-12";
const TYPE: Record<string, string> = { apartment: "דירה", house: "בית", land: "מגרש" };

const ilDay = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }) : "");
const ilTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
const shekel = (n: number, digits = 0) => "₪" + n.toLocaleString("he-IL", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const int = (n: number) => n.toLocaleString("he-IL");
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(a / b < 0.1 ? 1 : 0)}%` : "–");
const dmy = (d: string) => d.split("-").reverse().slice(0, 2).join(".");

function channel(source: string | null): "meta" | "direct" | "other" {
  const v = (source || "").toLowerCase();
  if (!v || v === "direct") return "direct";
  if (/facebook|fb|instagram|meta|^ig$|^an$/.test(v)) return "meta";
  return "other";
}
const CHANNEL: Record<string, string> = { meta: "פייסבוק / אינסטגרם", direct: "כניסה ישירה", other: "אחר" };
const PLACEMENT: Record<string, string> = {
  "facebook/feed": "פיד פייסבוק",
  "facebook/facebook_reels": "ריילס פייסבוק",
  "facebook/facebook_stories": "סטורי פייסבוק",
  "instagram/feed": "פיד אינסטגרם",
  "instagram/instagram_reels": "ריילס אינסטגרם",
  "instagram/instagram_stories": "סטורי אינסטגרם",
  "audience_network/an_classic": "Audience Network",
};

export default async function Overview({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from: fromParam } = await searchParams;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromParam ?? "") ? fromParam! : PILOT_START;
  const today = ilDay(new Date().toISOString());
  const store = getStore();

  const [meta, searchRes, allLeads, stats, asOf] = await Promise.all([
    getMetaInsights(from, today),
    listSearches(2000),
    store.getLeads(),
    store.getStats().catch(() => null),
    store.dataAsOf().catch(() => null),
  ]);

  const searches = searchRes.rows.filter((r) => ilDay(r.createdAt) >= from && !isInternalSearch(r.source));
  const leads = allLeads.filter((l) => ilDay(l.createdAt) >= from);
  const realLeads = leads.filter((l) => !isTestLead(l));
  const valuations = searches.filter((r) => r.outcome === "ok");
  const metaValuations = valuations.filter((r) => channel(r.source) === "meta");

  const metaOk = meta.connected && meta.error === null ? meta : null;
  const days: MetaDay[] = metaOk ? metaOk.days : [];
  const sum = (k: keyof Omit<MetaDay, "date">) => days.reduce((s, d) => s + d[k], 0);
  const spend = sum("spend");
  const impressions = sum("impressions");
  const clicks = sum("clicks");
  const landing = sum("landingViews");
  const pixelValuations = sum("valuations");

  // one row per day from the start date, so quiet days show as zeros
  const dates: string[] = [];
  for (let d = new Date(from + "T12:00:00Z"); ilDay(d.toISOString()) <= today; d.setUTCDate(d.getUTCDate() + 1)) dates.push(ilDay(d.toISOString()));

  const staleDays = asOf ? Math.round((Date.now() - new Date(asOf + "T00:00:00Z").getTime()) / 86_400_000) : null;
  const metaReady = metaOk !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">סקירה</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            מ־{dmy(from)} עד היום · מודעות, חיפושים ולידים במקום אחד · לידי בדיקה לא נספרים
          </p>
        </div>
        <form className="flex items-center gap-2 text-sm">
          <label htmlFor="from" className="text-slate-500">מתאריך</label>
          <input id="from" name="from" type="date" defaultValue={from} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5" />
          <button className="rounded-lg bg-slate-800 px-3 py-1.5 font-semibold text-white">הצג</button>
        </form>
      </div>

      {!meta.connected && (
        <Notice>
          נתוני המודעות עוד לא מחוברים. כדי לחבר: ב־Vercel מוסיפים את <code>META_ADS_TOKEN</code> (מפתח System User עם הרשאת ads_read) ואת{" "}
          <code>META_AD_ACCOUNT_ID</code>. עד אז רואים כאן רק את מה שקרה באתר.
        </Notice>
      )}
      {meta.connected && meta.error && <Notice>מטא החזירה שגיאה: {meta.error}</Notice>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="הוצאה על מודעות" value={metaReady ? shekel(spend) : "–"} />
        <Stat label="נכנסו לאתר מהמודעה" value={metaReady ? int(landing) : "–"} />
        <Stat label="קיבלו שווי" value={int(valuations.length)} sub={`${int(metaValuations.length)} מהמודעה`} />
        <Stat label="לידים אמיתיים" value={int(realLeads.length)} sub={leads.length > realLeads.length ? `${leads.length - realLeads.length} בדיקות לא נספרו` : undefined} />
        <Stat
          label="עלות לליד"
          value={metaReady && realLeads.length ? shekel(spend / realLeads.length) : "–"}
          sub={metaReady && metaValuations.length ? `${shekel(spend / metaValuations.length, 2)} לשווי` : undefined}
        />
      </div>

      <Card title="המשפך">
        <div className="space-y-2">
          {[
            { name: "ראו את המודעה", n: impressions, prev: 0, meta: true },
            { name: "לחצו על הקישור", n: clicks, prev: impressions, meta: true },
            { name: "נכנסו לאתר", n: landing, prev: clicks, meta: true },
            { name: "קיבלו שווי (מהמודעה)", n: metaValuations.length, prev: landing, meta: false },
            { name: "השאירו טלפון (אמיתיים)", n: realLeads.length, prev: valuations.length, meta: false },
          ].map((s) => (
            <div key={s.name} className="grid grid-cols-[1fr_5rem_4rem] items-center gap-3 text-sm sm:grid-cols-[12rem_1fr_6rem_5rem]">
              <span className="text-slate-700">{s.name}</span>
              <div className="hidden h-2 overflow-hidden rounded-full bg-slate-100 sm:block">
                <div className="h-2 rounded-full bg-slate-700" style={{ width: s.prev ? `${Math.min(100, (s.n / s.prev) * 100)}%` : "100%" }} />
              </div>
              <span className="text-left font-bold tabular-nums text-slate-800">{s.meta && !metaReady ? "–" : int(s.n)}</span>
              <span className="text-left tabular-nums text-slate-500">{s.prev ? pct(s.n, s.prev) : ""}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-400">
          האחוז הוא מתוך השלב הקודם (לידים: מתוך כל מי שקיבל שווי). {metaReady ? `הפיקסל של מטא ספר ${int(pixelValuations)} צפיות בשווי. ` : ""}חיפושים נשמרים מ־12.11 בשעה 20:05.
        </p>
      </Card>

      <Card title="לפי יום">
        <Table
          head={["יום", "הוצאה", "קליקים", "נכנסו", "שווי (כל האתר)", "שווי מהמודעה", "לידים"]}
          rows={dates
            .slice()
            .reverse()
            .map((d) => {
              const m = days.find((x) => x.date === d);
              const vs = valuations.filter((r) => ilDay(r.createdAt) === d);
              return [
                dmy(d),
                m ? shekel(m.spend, 2) : "–",
                m ? int(m.clicks) : "–",
                m ? int(m.landingViews) : "–",
                int(vs.length),
                int(vs.filter((r) => channel(r.source) === "meta").length),
                int(realLeads.filter((l) => ilDay(l.createdAt) === d).length),
              ];
            })}
        />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="מאיפה הגיעו מי שקיבלו שווי">
          <Bars items={countBy(valuations, (r) => CHANNEL[channel(r.source)])} />
        </Card>
        <Card title="איפה המודעה הופיעה">
          {metaOk ? (
            <Table
              head={["מיקום", "הוצאה", "נכנסו", "שווי", "עלות לשווי"]}
              rows={metaOk.placements
                .filter((p) => p.spend >= 0.5 || p.valuations > 0)
                .map((p) => [
                  PLACEMENT[`${p.platform}/${p.position}`] ?? `${p.platform} ${p.position}`,
                  shekel(p.spend, 2),
                  int(p.landingViews),
                  int(p.valuations),
                  p.valuations ? shekel(p.spend / p.valuations, 2) : "–",
                ])}
            />
          ) : (
            <p className="py-4 text-center text-sm text-slate-400">יופיע אחרי חיבור נתוני המודעות</p>
          )}
        </Card>
      </div>

      <Card title="לידים" action={<a href="/admin/dashboard" className="text-xs font-semibold text-slate-600 underline">לניהול הלידים</a>}>
        <Table
          head={["מתי", "שכונה", "נכס", "שווי שהוצג", "מקור", ""]}
          rows={leads.map((l) => [
            ilTime(l.createdAt),
            l.neighborhood || "—",
            leadProperty(l),
            l.estimateLow ? `${shekel(l.estimateLow)}–${shekel(l.estimateHigh ?? l.estimateLow)}` : "",
            CHANNEL[channel(l.source)],
            isTestLead(l) ? <Pill key="t" tone="muted">בדיקה</Pill> : <Pill key="r" tone="good">אמיתי</Pill>,
          ])}
          empty="עוד אין לידים בתקופה הזו"
        />
      </Card>

      <Card title="מצב הנתונים">
        <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
          <Fact label="עסקאות במאגר" value={stats ? int(stats.dealCount) : "–"} />
          <Fact label="העסקה האחרונה" value={asOf ? dmy(asOf) + "." + asOf.slice(0, 4) : "–"} />
          <Fact
            label="לפני"
            value={staleDays == null ? "–" : `${int(staleDays)} ימים`}
            warn={staleDays != null && staleDays > 120}
            sub={staleDays != null && staleDays > 120 ? "צריך איסוף חדש (docs/HARVEST.md)" : undefined}
          />
        </div>
      </Card>
    </div>
  );
}

function leadProperty(l: Lead): string {
  return [TYPE[l.propertyType ?? ""] ?? "", l.rooms ? `${l.rooms} חד׳` : "", l.areaSqm ? `${l.areaSqm} מ״ר` : ""].filter(Boolean).join(" · ");
}

function countBy(rows: SearchRow[], key: (r: SearchRow) => string): [string, number][] {
  const m = new Map<string, number>();
  rows.forEach((r) => m.set(key(r), (m.get(key(r)) || 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{children}</div>;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-black tabular-nums text-slate-800">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-700">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty?: string }) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-right text-xs text-slate-500">
            {head.map((h, i) => (
              <th key={i} className="px-5 py-2 font-medium whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {r.map((c, j) => (
                <td key={j} className={`px-5 py-2.5 whitespace-nowrap ${j === 0 ? "text-slate-800" : "tabular-nums text-slate-600"}`}>{c}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={head.length} className="px-5 py-8 text-center text-slate-400">{empty ?? "אין נתונים"}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Bars({ items }: { items: [string, number][] }) {
  const total = items.reduce((s, [, v]) => s + v, 0) || 1;
  return (
    <div className="space-y-3">
      {items.map(([k, v]) => (
        <div key={k} className="flex items-center gap-3">
          <span className="w-36 shrink-0 truncate text-xs text-slate-600">{k}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-slate-700" style={{ width: `${Math.round((v / total) * 100)}%` }} />
          </div>
          <span className="w-12 shrink-0 text-left text-xs tabular-nums text-slate-500">{v} · {pct(v, total)}</span>
        </div>
      ))}
      {items.length === 0 && <p className="py-2 text-center text-xs text-slate-400">אין נתונים</p>}
    </div>
  );
}

function Fact({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-black tabular-nums ${warn ? "text-red-600" : "text-slate-800"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function Pill({ tone, children }: { tone: "good" | "muted"; children: React.ReactNode }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone === "good" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
      {children}
    </span>
  );
}
