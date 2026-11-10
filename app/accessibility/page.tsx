export const metadata = { title: "הצהרת נגישות | שווי דירה נתניה" };

// פרטי הפנייה בנושא נגישות — מאותם משתני סביבה של כרטיס המתווך, כדי שלא יתיישנו בנפרד
const agentName = process.env.NEXT_PUBLIC_AGENT_NAME || "";
const agentPhone = process.env.NEXT_PUBLIC_AGENT_PHONE || "";
const accessibilityEmail = process.env.NEXT_PUBLIC_ACCESSIBILITY_EMAIL || "";

export default function AccessibilityStatement() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <a href="/" className="text-sm text-brand">
        → חזרה לעמוד הבית
      </a>
      <h1 className="mt-4 text-3xl font-extrabold">הצהרת נגישות</h1>
      <div className="mt-6 space-y-4 leading-relaxed text-slate-700">
        <p>
          אנו רואים חשיבות בכך שכל אדם, כולל אנשים עם מוגבלות, יוכל לבדוק את שווי הנכס שלו ולקבל את
          הדוח באתר באופן עצמאי ושוויוני.
        </p>

        <h2 className="text-xl font-bold">רמת הנגישות באתר</h2>
        <p>
          האתר הונגש בהתאם לתקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות),
          התשע&quot;ג-2013, ולתקן הישראלי ת&quot;י 5568 המבוסס על הנחיות WCAG 2.0, ברמה AA.
        </p>

        <h2 className="text-xl font-bold">מה הונגש</h2>
        <ul className="list-disc space-y-1 ps-6">
          <li>אפשר להשתמש בכל האתר, כולל אשף בדיקת השווי וטופס השארת הפרטים, באמצעות המקלדת בלבד.</li>
          <li>חיפוש הרחוב תומך בניווט בחצים ובבחירה במקש Enter, ומודיע לקורא המסך כמה רחובות נמצאו.</li>
          <li>במעבר בין שלבי האשף, קורא המסך מודיע על השלב החדש.</li>
          <li>לכל שדה ולכל קבוצת כפתורים יש תווית, והכפתורים מציינים איזו אפשרות נבחרה.</li>
          <li>לכל רכיב שנבחר במקלדת יש מסגרת מיקוד ברורה.</li>
          <li>ניגודיות הצבעים עומדת בדרישות התקן, ולתמונות יש טקסט חלופי.</li>
          <li>אפשר להגדיל את התצוגה עד 200% בלי לאבד תוכן, והאתר מותאם לטלפון נייד.</li>
          <li>האתר מכבד את הגדרת המערכת להפחתת תנועה.</li>
          <li>לגרף מגמת המחירים יש חלופה טקסטואלית לקורא מסך.</li>
        </ul>
        <p>
          האתר אינו משתמש בתוסף נגישות חיצוני. ההתאמות בנויות באתר עצמו, וכלי ההגדלה וקוראי המסך של
          הדפדפן ומערכת ההפעלה פועלים בו כרגיל.
        </p>

        <h2 className="text-xl font-bold">דפדפנים וטכנולוגיות מסייעות</h2>
        <p>
          האתר נבדק בגרסאות עדכניות של Chrome, Safari, Edge ו-Firefox, במחשב ובטלפון נייד. הבדיקה כללה
          כלי בדיקה אוטומטי וניווט במקלדת בלבד.
        </p>

        <h2 className="text-xl font-bold">רכיבים שייתכן שאינם נגישים במלואם</h2>
        <ul className="list-disc space-y-1 ps-6">
          <li>
            המפה המוטמעת בדוח המלא מגיעה מאתר ממשלתי חיצוני (govmap) ואינה בשליטתנו. המרחקים לתחבורה,
            לבתי ספר ולפארקים מופיעים גם כטקסט מתחת למפה.
          </li>
        </ul>
        <p>
          אם נתקלתם ברכיב שאינו נגיש, או שאתם צריכים את המידע בדרך אחרת, פנו אלינו ונמסור לכם את דוח
          השווי בטלפון או בהודעה.
        </p>

        <h2 className="text-xl font-bold">פניות בנושא נגישות</h2>
        <p>נשמח לקבל הערות והצעות לשיפור, ונשיב לכל פנייה בהקדם.</p>
        <ul className="space-y-1">
          {agentName && <li>איש קשר: {agentName}</li>}
          {agentPhone && (
            <li>
              טלפון: <a href={`tel:${agentPhone.replace(/[^\d+]/g, "")}`} className="underline" dir="ltr">{agentPhone}</a>
            </li>
          )}
          {accessibilityEmail && (
            <li>
              דוא&quot;ל: <a href={`mailto:${accessibilityEmail}`} className="underline" dir="ltr">{accessibilityEmail}</a>
            </li>
          )}
        </ul>

        <p className="text-sm text-slate-500">הצהרה זו עודכנה בנובמבר 2026.</p>
      </div>
    </main>
  );
}
