import ValuationWizard from "@/components/ValuationWizard";
import ScrollToWizard from "@/components/ScrollToWizard";
import { getStore } from "@/lib/store";

// פריים — Netanya is the opening shot: the real cliff fills the screen, the question sits on its lower
// edge like a film title, the valuation waits under it. Near-black ground, warm paper, sunset orange.

/** Every picture on the page, credited in full: title, author, source and licence, each linked.
 *  Licence evidence (incl. the cliffs photo's Wikimedia VRT ticket 2022050610001973) is in docs/image-credits.json. */
const CREDITS: { title: string; by: string; page: string; licence: string; licenceUrl?: string; changed?: string }[] = [
  {
    title: "Netanya cliffs",
    by: "אלדר אלדדי (Eldar Eldadi)",
    page: "https://commons.wikimedia.org/wiki/File:Netanya_cliffs.jpg",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.he",
    changed: "נחתכה והוכהתה בשוליים מאחורי הטקסט",
  },
  {
    title: "חוף הים בנתניה, 1935",
    by: "זולטן קלוגר, אוסף התצלומים הלאומי",
    page: "https://commons.wikimedia.org/wiki/File:THE_SEASHORE_AT_NATANYA._%D7%97%D7%95%D7%A3_%D7%94%D7%99%D7%9D_%D7%91%D7%A0%D7%AA%D7%A0%D7%99%D7%94.D25-045.jpg",
    licence: "נחלת הכלל",
  },
  {
    title: "שכונת גבע בנתניה, 1935",
    by: "זולטן קלוגר, אוסף התצלומים הלאומי",
    page: "https://commons.wikimedia.org/wiki/File:THE_GEVA_NEIGHBOURHOOD_IN_NATANYA._%D7%A9%D7%9B%D7%95%D7%A0%D7%AA_%D7%92%D7%91%D7%A2_%D7%91%D7%A0%D7%AA%D7%A0%D7%99%D7%94.D25-041.jpg",
    licence: "נחלת הכלל",
  },
  {
    title: "מראה כללי של נתניה, 1935",
    by: "זולטן קלוגר, אוסף התצלומים הלאומי",
    page: "https://commons.wikimedia.org/wiki/File:GENERAL_VIEW_OF_NATANYA._%D7%9E%D7%A8%D7%90%D7%94_%D7%9B%D7%9C%D7%9C%D7%99_%D7%A9%D7%9C_%D7%94%D7%A2%D7%99%D7%A8_%D7%A0%D7%AA%D7%A0%D7%99%D7%94.D25-053.jpg",
    licence: "נחלת הכלל",
  },
];

export default async function Home() {
  const store = getStore();
  const stats = await store.getStats().catch(() => ({ dealCount: 0, neighborhoodCount: 0 }));
  const dealCount = stats.dealCount;
  const agentName = process.env.NEXT_PUBLIC_AGENT_NAME;
  const agentLicense = process.env.NEXT_PUBLIC_AGENT_LICENSE;

  return (
    <main dir="rtl" className="overflow-x-clip bg-white text-ink">
      {/* ═══════════ OPENING CARD ═══════════ */}
      <section className="px-3 pt-3 lg:px-4 lg:pt-4" aria-labelledby="home-h1">
        <div className="relative">
          {/* the photograph is a rounded card: on the phone it holds the title, on desktop the title and the valuation */}
          <div className="absolute inset-x-0 top-0 h-[max(66svh,540px)] overflow-hidden rounded-[32px] bg-ink lg:bottom-0 lg:h-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/netanya-cliffs.jpg"
              alt="מצוקי נתניה ממבט אווירי: מגדלי מגורים מעל הים"
              width={1920}
              height={1280}
              fetchPriority="high"
              className="fr-push absolute inset-0 h-full w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/55 to-transparent" aria-hidden="true" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-b from-transparent via-black/45 to-black/85" aria-hidden="true" />
            <p className="absolute left-5 top-[76px] z-10 max-w-[calc(100%-40px)] text-[11px] text-white/80">
              מצוקי נתניה, 2022. צילום: אלדר אלדדי, CC BY-SA 4.0
            </p>
          </div>

          <header className="absolute inset-x-0 top-0 z-20 mx-auto flex min-h-[68px] max-w-6xl items-center justify-between gap-3 px-5 pt-[env(safe-area-inset-top)] text-white lg:px-10">
            <span className="text-[19px] font-semibold tracking-[-0.01em]">שוויות נתניה</span>
            <nav className="flex gap-1.5" aria-label="ניווט">
              <a href="#how" className="gh-pill hidden bg-white/15 text-white backdrop-blur-md sm:inline-flex">איך זה עובד</a>
              <ScrollToWizard className="gh-pill hidden bg-white font-semibold text-ink lg:inline-flex">לבדיקת שווי</ScrollToWizard>
            </nav>
          </header>

          <div className="relative z-10 mx-auto max-w-6xl lg:grid lg:min-h-[calc(100svh-32px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:items-end lg:gap-12 lg:px-10 lg:pb-12 lg:pt-28">
            <div className="flex min-h-[max(66svh,540px)] flex-col justify-end px-6 pb-8 text-white lg:min-h-0 lg:px-0 lg:pb-4">
              <h1
                id="home-h1"
                className="max-w-[12ch] text-[clamp(42px,11.6vw,58px)] font-semibold leading-[1.02] tracking-[-0.035em] lg:max-w-none lg:text-[clamp(60px,5.8vw,92px)]"
              >
                כמה שווה הנכס שלך?
              </h1>
              <p className="mt-3 max-w-[46ch] text-[17px] leading-relaxed text-white/90 lg:text-[20px]">
                מקלידים כתובת בנתניה ורואים עסקאות אמת שנמכרו בבניין, ברחוב ובסביבה, וטווח שווי לפיהן.
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
                לבדיקת שווי חינם
              </ScrollToWizard>
            </div>

            {/* ═══════════ THE VALUATION ═══════════ */}
            <div id="check" className="mt-6 max-w-3xl scroll-mt-4 px-1 text-ink lg:mt-0 lg:self-center lg:px-0">
              <ValuationWizard />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════ NETANYA, 1935 ═══════════ */}
      <section className="mx-auto mt-28 grid max-w-6xl gap-7 px-5 lg:mt-40 lg:grid-cols-12 lg:items-end lg:gap-x-8 lg:gap-y-10" aria-labelledby="then-h">
        <h2 id="then-h" className="text-[clamp(34px,8vw,72px)] font-semibold leading-none tracking-[-0.035em] lg:col-span-12">
          נתניה, 1935.
        </h2>
        <figure className="lg:col-span-7 lg:row-start-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/netanya-seashore-1935.jpg"
            alt="חוף הים בנתניה ב-1935: המצוק והים, בלי בניין אחד"
            width={1920}
            height={1280}
            loading="lazy"
            className="aspect-[4/3] w-full rounded-[28px] object-cover"
          />
          <figcaption className="mt-2 text-[14px] text-slate-500">חוף הים בנתניה, 1935. צילום: זולטן קלוגר.</figcaption>
        </figure>
        <p className="max-w-[30ch] text-[22px] leading-snug lg:col-span-4 lg:col-start-9 lg:row-start-2 lg:self-center lg:text-[26px]">
          על אותו מצוק עומדים היום מגדלים. תשעים שנה של בנייה, ובכל רחוב נמכרו דירות. כל עסקה כזו מספרת משהו על המחיר של הנכס שלכם.
        </p>
        <figure className="w-[72%] justify-self-end lg:col-span-4 lg:col-start-9 lg:row-start-3 lg:w-auto lg:self-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/netanya-geva-1935.jpg"
            alt="שכונת גבע בנתניה ב-1935: בתים ראשונים בין החולות"
            width={1920}
            height={1280}
            loading="lazy"
            className="aspect-square w-full rounded-[28px] object-cover"
          />
          <figcaption className="mt-2 text-[14px] text-slate-500">שכונת גבע, 1935.</figcaption>
        </figure>
        <figure className="lg:col-span-7 lg:col-start-2 lg:row-start-3 lg:mt-20 lg:self-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/netanya-general-1935.jpg"
            alt="מראה כללי של נתניה ב-1935: רחוב רחב ובתים לבנים נמוכים"
            width={1920}
            height={1280}
            loading="lazy"
            className="aspect-[21/9] w-full rounded-[28px] object-cover"
          />
          <figcaption className="mt-2 text-[14px] text-slate-500">מראה כללי של העיר, 1935.</figcaption>
        </figure>
      </section>

      {/* ═══════════ HOW IT WORKS ═══════════ */}
      <section id="how" className="mx-auto mt-28 max-w-6xl scroll-mt-6 px-5 lg:mt-40" aria-labelledby="how-h">
        <h2 id="how-h" className="text-[clamp(34px,8vw,72px)] font-semibold leading-none tracking-[-0.035em]">איך זה עובד</h2>
        <div className="mt-6 space-y-4 text-[clamp(22px,5.6vw,36px)] font-medium leading-snug">
          <p className="max-w-[34ch]">מקלידים רחוב ומספר בית בנתניה.</p>
          <p className="max-w-[34ch]">רואים את העסקאות שנמכרו בבניין, ברחוב ובסביבה, וטווח שווי לפיהן.</p>
          <p className="max-w-[34ch]">ומחליטים אם לדבר עם מתווך מורשה. רק אם תרצו.</p>
        </div>
      </section>

      {/* ═══════════ AGENT ═══════════ */}
      <section className="mx-auto mt-28 max-w-6xl px-5" aria-labelledby="agent-h">
        <div className="flex flex-col gap-4 rounded-[32px] bg-butter-soft p-6 sm:flex-row sm:items-center sm:p-8">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-light text-xl font-semibold text-brand" aria-hidden="true">
            {(agentName ?? "מ").slice(0, 1)}
          </div>
          <div className="flex-1">
            <h2 id="agent-h" className="text-[22px] font-semibold tracking-[-0.02em]">מי מאחורי ההערכה</h2>
            <p className="mt-1 text-[15px] leading-relaxed text-slate-600">
              {agentName ? `${agentName}, ` : ""}מתווך מקרקעין מורשה{agentLicense ? ` · רישיון ${agentLicense}` : ""}.
              הדוח נשלח אליכם ישירות, ואם תרצו, אפשר לעבור עליו יחד.
            </p>
          </div>
          <ScrollToWizard className="gh-pill min-h-[52px] justify-center bg-ink px-6 font-semibold text-white">לבדיקת שווי</ScrollToWizard>
        </div>
      </section>

      {/* ═══════════ FOOTER ═══════════ */}
      <footer className="mx-auto max-w-6xl px-5 pb-[calc(40px+env(safe-area-inset-bottom))] pt-14 text-xs leading-relaxed text-slate-500">
        <p className="max-w-[70ch]">
          ההערכה היא אינדיקציה המבוססת על נתוני עסקאות פומביים ואינה תחליף להערכת שמאי מוסמך.
        </p>
        <div className="mt-3 flex gap-1">
          <a href="/privacy" className="flex min-h-[44px] items-center px-3 first:ps-0 hover:text-ink">מדיניות פרטיות</a>
          <a href="/terms" className="flex min-h-[44px] items-center px-3 hover:text-ink">תנאי שימוש</a>
        </div>
        <div className="mt-2">
          <p>תמונות, דרך Wikimedia Commons:</p>
          <ul className="mt-1 space-y-1">
            {CREDITS.map((c) => (
              <li key={c.page}>
                <a href={c.page} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-ink">{c.title}</a>, {c.by},{" "}
                {c.licenceUrl ? (
                  <a href={c.licenceUrl} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-ink">{c.licence}</a>
                ) : (
                  c.licence
                )}
                {c.changed ? `. ${c.changed}.` : "."}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-3">© 2026 · שוויות נתניה</p>
      </footer>
    </main>
  );
}
