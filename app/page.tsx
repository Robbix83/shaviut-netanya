import ValuationWizard from "@/components/ValuationWizard";
import ScrollToWizard from "@/components/ScrollToWizard";
import { getStore } from "@/lib/store";

export default async function Home() {
  const store = getStore();
  const [leadCount, stats] = await Promise.all([
    store.countLeads().catch(() => 0),
    store.getStats().catch(() => ({ dealCount: 0, neighborhoodCount: 0 })),
  ]);
  const { dealCount, neighborhoodCount } = stats;
  return (
    <main dir="rtl">

      {/* ═══════════════════════ HERO ═══════════════════════ */}
      <section className="relative min-h-screen bg-hero-dark flex items-center overflow-x-clip">

        {/* Decorative elements — overflow-hidden בנפרד כדי לא לחתוך את הdropdown */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* Mesh grid overlay */}
          <div
            className="absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                "linear-gradient(to right,#ffffff 1px,transparent 1px),linear-gradient(to bottom,#ffffff 1px,transparent 1px)",
              backgroundSize: "72px 72px",
            }}
          />
          {/* Radial glow blobs */}
          <div className="absolute -top-40 right-[10%] h-[600px] w-[600px] rounded-full bg-brand/25 blur-[120px]" />
          <div className="absolute -bottom-20 left-[5%] h-[400px] w-[400px] rounded-full bg-blue-500/20 blur-[100px]" />
          <div className="absolute top-1/2 left-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600/10 blur-[80px]" />
        </div>

        <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-5 py-16 lg:grid-cols-2 lg:items-center lg:py-24">

          {/* ── Copy ── */}
          <div className="text-center lg:text-right">

            {/* Eyebrow badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-semibold text-blue-200 backdrop-blur-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" />
              </span>
              מומחיות מקומית · נתניה 🏙️
            </div>

            {/* Headline */}
            <h1 className="mt-6 text-4xl font-black leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-[3.4rem]">
              כמה{" "}
              <span className="relative inline-block">
                <span className="relative z-10 text-brand-glow">באמת</span>
                <span className="absolute inset-x-0 -bottom-1 h-3 rounded-full bg-brand/30 blur-sm" />
              </span>{" "}
              שווה
              <br />
              <span className="text-white/90">הדירה שלך בנתניה?</span>
            </h1>

            <p className="mt-5 text-lg leading-relaxed text-white/65">
              גלו תוך 30 שניות את שווי הנכס שלכם — לפי עסקאות אמיתיות שנמכרו
              באזורכם, ממאגר רשות המסים. בחינם, ללא התחייבות.
            </p>

            {/* Trust pills */}
            <ul className="mt-6 flex flex-wrap justify-center gap-2 lg:justify-end">
              {[
                { icon: "✓", text: "מבוסס נתונים אמיתיים", color: "text-green-400" },
                { icon: "⚡", text: "תוצאה מיידית", color: "text-yellow-400" },
                { icon: "📊", text: "דוח עסקאות מלא", color: "text-blue-400" },
              ].map((item) => (
                <li
                  key={item.text}
                  className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-sm font-medium text-white/80 backdrop-blur-sm"
                >
                  <span className={`${item.color} font-bold`}>{item.icon}</span>
                  {item.text}
                </li>
              ))}
            </ul>

            {/* Mini stats */}
            <div className="mt-10 flex justify-center gap-4 sm:gap-8 lg:justify-end">
              {[
                { value: `${neighborhoodCount}`, label: "שכונות בנתניה" },
                { value: `${Math.floor(dealCount / 1000) * 1000}+`.replace(/\B(?=(\d{3})+(?!\d))/g, ","), label: "עסקאות במאגר" },
                { value: "חינם", label: "ללא עלות" },
                ...(leadCount >= 5
                  ? [{ value: `${Math.floor(leadCount / 5) * 5}+`, label: "הערכות ניתנו" }]
                  : []),
              ].map((s) => (
                <div key={s.label} className="text-center">
                  <p className="text-3xl font-black text-white">{s.value}</p>
                  <p className="mt-0.5 text-xs font-medium text-white/45">{s.label}</p>
                </div>
              ))}
            </div>

            {/* CTA arrow */}
            <div className="mt-8 flex justify-center lg:justify-end">
              <ScrollToWizard className="group inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-bold text-white shadow-[0_0_30px_rgba(13,62,251,0.5)] transition hover:bg-brand-dark hover:shadow-[0_0_40px_rgba(13,62,251,0.7)] lg:hidden">
                קבלו הערכת שווי
                <svg className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              </ScrollToWizard>
            </div>
          </div>

          {/* ── Wizard card ── */}
          <div id="check" className="relative">
            {/* Glow ring behind card */}
            <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-brand/20 blur-2xl" />
            {/* Card glass border */}
            <div className="rounded-3xl border border-white/10 bg-white/5 p-1 backdrop-blur-sm shadow-2xl">
              <ValuationWizard />
            </div>
          </div>
        </div>

        {/* Bottom fade to white */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-white to-transparent" />
      </section>

      {/* ═══════════════════════ VIDEO SHOWCASE ═══════════════════════ */}
      <section className="relative bg-slate-950 px-5 py-16 overflow-hidden">
        {/* Background glow */}
        <div className="pointer-events-none absolute -top-32 left-1/2 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-brand/15 blur-[120px]" />

        <div className="relative mx-auto max-w-5xl">
          {/* Header */}
          <div className="mb-10 text-center">
            <span className="inline-block rounded-full border border-brand/30 bg-brand/10 px-4 py-1 text-sm font-semibold text-blue-300">
              נתניה מלמעלה
            </span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              הטיילת שעל חוף הים התיכון
            </h2>
            <p className="mt-2 text-white/50 text-sm">
              נוף ייחודי · אוויר ים · ביקוש גבוה לנכסים
            </p>
          </div>

          {/* Video */}
          <div className="relative overflow-hidden rounded-2xl shadow-[0_0_80px_rgba(13,62,251,0.25)] ring-1 ring-white/10">
            <video
              src="https://d8j0ntlcm91z4.cloudfront.net/user_3EmCVY2h0BZPB50TZVh8f3eqYkj/hf_20260607_203720_a1d15db6-70b1-41af-8922-220d3d354cf9.mp4"
              autoPlay
              loop
              muted
              playsInline
              className="w-full aspect-video object-cover"
            />
            {/* Overlay gradient for cinematic feel */}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-slate-950/20" />

            {/* Bottom caption */}
            <div className="absolute bottom-4 right-4 flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs font-medium text-white/80">טיילת נתניה · חוף הים התיכון</span>
            </div>
          </div>

          {/* CTA under video */}
          <div className="mt-8 text-center">
            <ScrollToWizard className="inline-flex items-center gap-2 rounded-full bg-brand px-7 py-3 text-sm font-bold text-white shadow-[0_0_30px_rgba(13,62,251,0.5)] transition hover:bg-brand-dark hover:shadow-[0_0_40px_rgba(13,62,251,0.7)]">
              גלו כמה שווה הדירה שלכם
              <span>←</span>
            </ScrollToWizard>
          </div>
        </div>
      </section>

      {/* ═══════════════════════ HOW IT WORKS ═══════════════════════ */}
      <section className="relative bg-white px-5 py-20">
        <div className="mx-auto max-w-5xl">

          {/* Section header */}
          <div className="mb-14 text-center">
            <span className="inline-block rounded-full bg-brand/8 px-4 py-1 text-sm font-semibold text-brand">
              פשוט ומהיר
            </span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              איך זה עובד?
            </h2>
            <p className="mt-2 text-slate-500">שלושה צעדים — דוח שווי מלא תוך דקה</p>
          </div>

          {/* Steps */}
          <div className="relative grid gap-8 sm:grid-cols-3">
            {/* Connector line (desktop) */}
            <div className="pointer-events-none absolute top-10 right-[16.6%] left-[16.6%] hidden h-px bg-gradient-to-l from-transparent via-brand/30 to-transparent sm:block" />

            {[
              {
                n: "01",
                icon: "📍",
                title: "מזינים כתובת",
                desc: "בחרו שכונה בנתניה — הכלי מזהה מיד עסקאות אמיתיות באזורכם.",
                color: "from-blue-500 to-brand",
              },
              {
                n: "02",
                icon: "🏠",
                title: "ממלאים פרטים",
                desc: "חדרים, שטח וקומה — פחות מ-30 שניות.",
                color: "from-violet-500 to-blue-600",
              },
              {
                n: "03",
                icon: "📊",
                title: "מקבלים שווי",
                desc: "טווח שווי + עסקאות ברדיוס + דוח מלא לנייד.",
                color: "from-indigo-500 to-violet-600",
              },
            ].map((s) => (
              <div
                key={s.n}
                className="group relative flex flex-col items-center rounded-2xl bg-white p-7 text-center shadow-sm ring-1 ring-slate-100 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:ring-brand/20"
              >
                {/* Step number */}
                <div className="absolute -top-3.5 right-5 rounded-full bg-brand px-2.5 py-0.5 text-xs font-black tracking-wide text-white shadow">
                  {s.n}
                </div>

                {/* Icon */}
                <div className={`mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${s.color} text-3xl shadow-lg`}>
                  {s.icon}
                </div>

                <h3 className="text-lg font-bold text-slate-800">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════ TRUST BAR ═══════════════════════ */}
      <section className="relative overflow-hidden bg-hero-dark py-16">
        {/* Shimmer overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(to right,#ffffff 1px,transparent 1px),linear-gradient(to bottom,#ffffff 1px,transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/60 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-brand/40 to-transparent" />

        <div className="relative mx-auto max-w-4xl px-5">
          <div className="flex flex-wrap items-center justify-around gap-10 text-center">
            {[
              { value: "100%", label: "עסקאות אמיתיות", sub: "ממאגר רשות המסים", icon: "🏛️" },
              { value: `${neighborhoodCount}`, label: "שכונות מכוסות", sub: "כל נתניה", icon: "🗺️" },
              { value: "חינם", label: "ללא עלות", sub: "ושקיפות מלאה", icon: "✨" },
            ].map((s) => (
              <div key={s.value} className="flex flex-col items-center gap-1">
                <span className="mb-1 text-2xl">{s.icon}</span>
                <p className="text-4xl font-black tracking-tight text-white">{s.value}</p>
                <p className="text-sm font-semibold text-white/80">{s.label}</p>
                <p className="text-xs text-white/40">{s.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════ AGENT STRIP ═══════════════════════ */}
      <section className="border-y border-slate-100 bg-gradient-to-l from-brand/4 to-blue-50/60 px-5 py-10">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center sm:flex-row sm:text-right">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-blue-600 text-3xl shadow-md">
            🤝
          </div>
          <div className="flex-1">
            <p className="font-bold text-slate-800">מתווך מורשה · נתניה</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">
              הדוח נשלח אליכם ישירות — ואם תרצו, מתווך מקצועי עם ניסיון בשוק המקומי
              יהיה זמין לענות על כל שאלה.
            </p>
          </div>
          <ScrollToWizard className="shrink-0 rounded-xl bg-brand px-5 py-3 text-sm font-bold text-white shadow transition hover:bg-brand-dark min-h-[44px] flex items-center">
            קבלו הערכה עכשיו ←
          </ScrollToWizard>
        </div>
      </section>

      {/* ═══════════════════════ FOOTER ═══════════════════════ */}
      <footer className="bg-slate-950 py-10 text-center text-sm text-slate-500">
        <div className="mx-auto max-w-4xl px-5">
          <div className="mb-4 flex justify-center gap-1 text-xl">
            🏠
          </div>
          <p className="text-slate-400 font-medium">שווי דירה נתניה</p>
          <p className="mt-2 text-xs leading-relaxed text-slate-600 max-w-lg mx-auto">
            ההערכה היא אינדיקציה המבוססת על נתוני עסקאות פומביים ואינה תחליף להערכת שמאי מוסמך.
          </p>
          <div className="mt-4 flex justify-center gap-1 text-xs">
            <a href="/privacy" className="transition hover:text-white px-4 py-3 min-h-[44px] flex items-center">מדיניות פרטיות</a>
            <span className="text-slate-700 flex items-center">·</span>
            <a href="/terms" className="transition hover:text-white px-4 py-3 min-h-[44px] flex items-center">תנאי שימוש</a>
          </div>
          <p className="mt-5 text-xs text-slate-700">© 2026 · כל הזכויות שמורות</p>
        </div>
      </footer>
    </main>
  );
}
