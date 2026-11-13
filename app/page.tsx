import ValuationWizard from "@/components/ValuationWizard";
import ScrollToWizard from "@/components/ScrollToWizard";
import { getStore } from "@/lib/store";

// פריים — Netanya from the air is the opening shot: the coast fills the screen, the question sits on its
// lower edge like a film title, the valuation waits under it. The rest of the page keeps flying over the city.

/** Aerial photographs by a friend of the owner, used with permission. Each comes at 1000px and 2000px. */
function Aerial({ name, alt, className, eager = false }: { name: string; alt: string; className?: string; eager?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/images/aerial/${name}-2000.jpg`}
      srcSet={`/images/aerial/${name}-1000.jpg 1000w, /images/aerial/${name}-2000.jpg 2000w`}
      sizes="(min-width: 1024px) 70vw, 100vw"
      alt={alt}
      width={2000}
      height={1125}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : undefined}
      className={className}
    />
  );
}

export default async function Home() {
  const store = getStore();
  const stats = await store.getStats().catch(() => ({ dealCount: 0, neighborhoodCount: 0 }));
  const dealCount = stats.dealCount;
  const agentName = process.env.NEXT_PUBLIC_AGENT_NAME;
  const agentLicense = process.env.NEXT_PUBLIC_AGENT_LICENSE;
  const agentPhoto = process.env.NEXT_PUBLIC_AGENT_PHOTO;

  return (
    <main dir="rtl" className="overflow-x-clip bg-white text-ink">
      <a href="#check" className="sr-only focus:not-sr-only focus:fixed focus:right-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-white focus:px-5 focus:py-3 focus:font-semibold focus:text-ink focus:shadow-lg">
        דלג לבדיקת העסקאות
      </a>
      {/* ═══════════ OPENING CARD ═══════════ */}
      <section className="px-3 pt-3 lg:px-4 lg:pt-4" aria-labelledby="home-h1">
        <div className="relative">
          {/* the photograph is a rounded card: on the phone it holds the title, on desktop the title and the valuation */}
          <div className="absolute inset-x-0 top-0 h-[max(66svh,540px)] overflow-hidden rounded-[32px] bg-ink lg:bottom-0 lg:h-auto">
            <Aerial
              name="breakwaters"
              alt="חוף נתניה מהאוויר: שוברי גלים בים כחול ומגדלי מגורים לאורך החוף"
              eager
              className="fr-push absolute inset-0 h-full w-full object-cover object-[50%_60%]"
            />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/55 to-transparent" aria-hidden="true" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-b from-transparent via-black/45 to-black/85" aria-hidden="true" />
          </div>

          <header className="absolute inset-x-0 top-0 z-20 mx-auto flex min-h-[68px] max-w-6xl items-center justify-between gap-3 px-5 pt-[env(safe-area-inset-top)] text-white lg:px-10">
            <span className="text-[19px] font-semibold tracking-[-0.01em]">שוויות נתניה</span>
            <nav className="flex gap-1.5" aria-label="ניווט">
              <a href="#how" className="gh-pill hidden bg-white/15 text-white backdrop-blur-md sm:inline-flex">איך זה עובד</a>
              <ScrollToWizard className="gh-pill hidden bg-white font-semibold text-ink lg:inline-flex">לבדיקת עסקאות</ScrollToWizard>
            </nav>
          </header>

          <div className="relative z-10 mx-auto max-w-6xl lg:grid lg:min-h-[calc(100svh-32px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:items-end lg:gap-12 lg:px-10 lg:pb-12 lg:pt-28">
            <div className="flex min-h-[max(66svh,540px)] flex-col justify-end px-6 pb-8 text-white lg:min-h-0 lg:px-0 lg:pb-4">
              <h1
                id="home-h1"
                className="max-w-[12ch] text-[clamp(42px,11.6vw,58px)] font-semibold leading-[1.02] tracking-[-0.035em] lg:max-w-none lg:text-[clamp(60px,5.8vw,92px)]"
              >
                באיזה מחיר נמכרו דירות לידך?
              </h1>
              <p className="mt-3 max-w-[46ch] text-[17px] leading-relaxed text-white/90 lg:text-[20px]">
                מקלידים כתובת בנתניה ורואים עסקאות אמת שנמכרו בבניין, ברחוב ובסביבה.
              </p>
              <ul className="mt-4 flex flex-wrap gap-2 text-[13px]">
                {dealCount > 0 && (
                  <li className="rounded-full border border-white/20 bg-white/15 px-3 py-1.5 backdrop-blur-md">
                    <span className="font-semibold tabular-nums">{dealCount.toLocaleString("he-IL")}</span> עסקאות אמת
                  </li>
                )}
                <li className="rounded-full border border-white/20 bg-white/15 px-3 py-1.5 backdrop-blur-md">מתווך מורשה</li>
                <li className="rounded-full border border-white/20 bg-white/15 px-3 py-1.5 backdrop-blur-md">חינם, בלי הרשמה</li>
              </ul>
              <ScrollToWizard className="gh-press mt-6 flex min-h-[56px] w-full items-center justify-center rounded-full bg-white text-[17px] font-semibold text-ink lg:hidden">
                לבדיקת עסקאות חינם
              </ScrollToWizard>
            </div>

            {/* ═══════════ THE VALUATION ═══════════ */}
            <div id="check" className="mt-6 max-w-3xl scroll-mt-4 px-1 text-ink lg:mt-0 lg:self-center lg:px-0">
              <ValuationWizard />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════ NETANYA FROM ABOVE ═══════════ */}
      <section className="mx-auto mt-28 grid max-w-6xl gap-7 px-5 lg:mt-40 lg:grid-cols-12 lg:items-end lg:gap-x-8 lg:gap-y-10" aria-labelledby="above-h">
        <h2 id="above-h" className="text-[clamp(34px,8vw,72px)] font-semibold leading-none tracking-[-0.035em] lg:col-span-12">
          נתניה, מלמעלה.
        </h2>
        <Aerial
          name="beach-tower"
          alt="מגדל בבנייה מעל חוף רחצה בנתניה, ובתי מגורים לאורך הים"
          className="aspect-[4/3] w-full rounded-[28px] object-cover lg:col-span-7 lg:row-start-2"
        />
        <p className="max-w-[30ch] text-[22px] leading-snug lg:col-span-4 lg:col-start-9 lg:row-start-2 lg:self-center lg:text-[26px]">
          עיר שממשיכה להיבנות מול הים. בכל אחד מהבניינים האלה נמכרו דירות, וכל עסקה כזו מספרת משהו על המחירים בסביבה שלכם.
        </p>
        <Aerial
          name="cliff-coast"
          alt="המצוק והחוף של נתניה, ומגדלים חדשים באופק"
          className="aspect-square w-[72%] justify-self-end rounded-[28px] object-cover lg:col-span-4 lg:col-start-9 lg:row-start-3 lg:w-full lg:self-start"
        />
        <Aerial
          name="cliff-marina"
          alt="קו הרקיע של נתניה מעל המצוק, ועבודות ים מול החוף"
          className="aspect-[21/9] w-full rounded-[28px] object-cover lg:col-span-7 lg:col-start-2 lg:row-start-3 lg:mt-20 lg:self-start"
        />
      </section>

      {/* ═══════════ THE DATA, OVER THE TOWERS ═══════════ */}
      <section className="mt-28 px-3 lg:mt-40 lg:px-4" aria-labelledby="data-h">
        <div className="relative overflow-hidden rounded-[32px] bg-ink">
          <Aerial
            name="towers-dunes-b"
            alt="מגדלי מגורים בין העיר לחולות, והים מאחוריהם"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/10" aria-hidden="true" />
          <div className="relative mx-auto flex min-h-[78svh] max-w-6xl flex-col justify-end px-6 pb-10 text-white lg:min-h-[86svh] lg:px-10 lg:pb-14">
            <h2 id="data-h" className="max-w-[16ch] text-[clamp(34px,8vw,72px)] font-semibold leading-[1.02] tracking-[-0.035em]">
              {dealCount > 0 ? `${dealCount.toLocaleString("he-IL")} עסקאות אמת.` : "עסקאות אמת."}
            </h2>
            <p className="mt-3 max-w-[40ch] text-[17px] leading-relaxed text-white/90 lg:text-[20px]">
              מכירות שדווחו לרשות המסים בנתניה. מוצגות קודם העסקאות הקרובות ביותר לנכס שלכם.
            </p>
            <ScrollToWizard className="gh-press mt-6 flex min-h-[56px] w-full items-center justify-center rounded-full bg-white text-[17px] font-semibold text-ink sm:w-auto sm:self-start sm:px-8">
              לבדיקת עסקאות חינם
            </ScrollToWizard>
          </div>
        </div>
      </section>

      {/* ═══════════ HOW IT WORKS ═══════════ */}
      <section id="how" className="mx-auto mt-28 grid max-w-6xl scroll-mt-6 gap-8 px-5 lg:mt-40 lg:grid-cols-12 lg:items-center" aria-labelledby="how-h">
        <div className="lg:col-span-6">
          <h2 id="how-h" className="text-[clamp(34px,8vw,72px)] font-semibold leading-none tracking-[-0.035em]">איך זה עובד</h2>
          <div className="mt-6 space-y-4 text-[clamp(22px,5.6vw,36px)] font-medium leading-snug">
            <p className="max-w-[34ch]">מקלידים רחוב ומספר בית בנתניה.</p>
            <p className="max-w-[34ch]">רואים את העסקאות שנמכרו בבניין, ברחוב ובסביבה.</p>
            <p className="max-w-[34ch]">ומחליטים אם לדבר עם מתווך מורשה. רק אם תרצו.</p>
          </div>
        </div>
        <Aerial
          name="towers-sea"
          alt="מגדלי מגורים מול הים בנתניה"
          className="aspect-[4/5] w-full rounded-[28px] object-cover lg:col-span-5 lg:col-start-8"
        />
      </section>

      {/* ═══════════ AGENT ═══════════ */}
      <section className="mx-auto mt-28 max-w-6xl px-5" aria-labelledby="agent-h">
        <div className="flex flex-col gap-4 rounded-[32px] bg-butter-soft p-6 sm:flex-row sm:items-center sm:p-8">
          {agentPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={agentPhoto} alt={agentName ?? "המתווך"} width={80} height={80} loading="lazy" className="h-20 w-20 shrink-0 rounded-full object-cover ring-4 ring-white" />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-light text-xl font-semibold text-brand" aria-hidden="true">
              {(agentName ?? "מ").slice(0, 1)}
            </div>
          )}
          <div className="flex-1">
            <h2 id="agent-h" className="text-[22px] font-semibold tracking-[-0.02em]">מי מאחורי האתר</h2>
            <p className="mt-1 text-[15px] leading-relaxed text-slate-600">
              {agentName ? `${agentName}, ` : ""}מתווך מקרקעין מורשה{agentLicense ? ` · רישיון ${agentLicense}` : ""}.
              הדוח נשלח אליכם ישירות, ואם תרצו, אפשר לעבור עליו יחד.
            </p>
          </div>
          <ScrollToWizard className="gh-pill min-h-[52px] justify-center bg-ink px-6 font-semibold text-white">לבדיקת עסקאות</ScrollToWizard>
        </div>
      </section>

      {/* ═══════════ FOOTER ═══════════ */}
      <footer className="mx-auto max-w-6xl px-5 pb-[calc(40px+env(safe-area-inset-bottom))] pt-14 text-xs leading-relaxed text-slate-500">
        <p className="max-w-[70ch]">
          המידע באתר הוא סקר מחירים לפי עסקאות שדווחו לרשות המסים. הוא אינו קובע את שווי הנכס, אינו שומת מקרקעין ואינו מחליף שמאי מקרקעין.
        </p>
        <div className="mt-3 flex gap-1">
          <a href="/privacy" className="flex min-h-[44px] items-center px-3 first:ps-0 hover:text-ink">מדיניות פרטיות</a>
          <a href="/terms" className="flex min-h-[44px] items-center px-3 hover:text-ink">תנאי שימוש</a>
          <a href="/accessibility" className="flex min-h-[44px] items-center px-3 hover:text-ink">הצהרת נגישות</a>
        </div>
        <p className="mt-2">צילומי האוויר באתר באדיבות הצלם ובאישורו.</p>
        <p className="mt-3 max-w-[70ch]">
          © 2026 שוויות נתניה. כל הזכויות שמורות. אין להעתיק, לשכפל או להפיץ את התוכן, העיצוב, הנתונים או הקוד של האתר, כולם או חלקם, בלי אישור מראש ובכתב.
        </p>
        <p className="mt-1">
          האתר הוקם על ידי{" "}
          <a href="mailto:robxsys@gmail.com" className="font-semibold underline underline-offset-2 hover:text-ink">
            רוביקס מערכות אוטומציה
          </a>
        </p>
      </footer>
    </main>
  );
}
