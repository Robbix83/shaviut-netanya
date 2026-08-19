export const metadata = { title: "תנאי שימוש | שווי דירה נתניה" };

export default function Terms() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <a href="/" className="text-sm text-brand">
        → חזרה לעמוד הבית
      </a>
      <h1 className="mt-4 text-3xl font-extrabold">תנאי שימוש</h1>
      <div className="mt-6 space-y-4 leading-relaxed text-slate-700">
        <h2 className="text-xl font-bold">אופי השירות</h2>
        <p>
          השווי המוצג באתר הוא <strong>אינדיקציה</strong> המבוססת על עסקאות פומביות שדווחו לרשות
          המסים. הוא אינו מהווה הערכת שמאי מקרקעין מוסמך, אינו תחליף לבדיקה פרטנית של הנכס, ואין
          להסתמך עליו לצורך קבלת החלטות כלכליות או משפטיות.
        </p>
        <h2 className="text-xl font-bold">דיוק הנתונים</h2>
        <p>
          הנתונים מתעדכנים מעת לעת וייתכנו אי-דיוקים, פערי זמן או חוסרים. השווי בפועל של נכס מושפע
          מגורמים רבים (מצב הנכס, שיפוצים, כיווני אוויר, זכויות בנייה ועוד) שאינם נכללים בהערכה
          האוטומטית.
        </p>
        <h2 className="text-xl font-bold">קניין רוחני</h2>
        <p>התכנים באתר מוגנים. אין לעשות בהם שימוש מסחרי ללא אישור.</p>
        <h2 className="text-xl font-bold">יצירת קשר</h2>
        <p>
          השארת פרטים מהווה הסכמה ליצירת קשר בנוגע לנכס ולשירותי תיווך, בכפוף למדיניות הפרטיות.
        </p>
        <p className="text-sm text-slate-500">
          תנאים אלה נמסרים למטרות כלליות ואינם מהווים ייעוץ משפטי.
        </p>
      </div>
    </main>
  );
}
