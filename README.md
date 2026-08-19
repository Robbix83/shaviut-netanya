# שווי דירה נתניה — מחולל לידים למוכרי דירות

כלי "כמה שווה הדירה שלך בנתניה?" — מגנט לידים מבוסס **עסקאות אמיתיות** ממאגר רשות המסים.
בעל דירה מזין כתובת ופרטי נכס, מקבל טווח שווי + עסקאות שנמכרו באזורו, ובתמורה לדוח המלא
משאיר פרטים — שמגיעים אליך מיד ב-WhatsApp ולגיליון.

## ארכיטקטורה

```
app/                     Next.js (App Router, RTL עברית)
  page.tsx               דף הנחיתה
  privacy/ , terms/      עמודים משפטיים
  api/autocomplete/      השלמת כתובות (govmap)
  api/valuation/         חישוב שווי (מנוע + DB)
  api/lead/              קליטת ליד → store + WhatsApp + Sheet
components/ValuationWizard.tsx   משפך 3 שלבים
lib/
  types.ts               מבני נתונים
  store.ts               שכבת אחסון (local JSON / Supabase)
  valuation.ts           מנוע השווי (טווח לפי עסקאות בשכונה)
  govmap.ts              השלמת כתובות + כתובת→קואורדינטות
  notify.ts              WhatsApp (Green API) + Google Sheet
scripts/
  seed-local.ts             מאגר דוגמה לפיתוח (npm run seed:local)
  discover-neighborhoods.ts גילוי 19 שכונות נתניה (שם/מזהה/קואורדינטות) מה-API
  discover-streets.ts       גילוי רחובות אמיתיים פר-שכונה → data/streets.json
  harvest.ts                אספן עסקאות אמיתי (Playwright, חודשי, מצב גלוי)
  google-apps-script.gs     webhook לגיליון
supabase/schema.sql      סכמת בסיס הנתונים
```

## הרצה מקומית

```bash
npm install
cp .env.example .env.local      # DATA_SOURCE=local כבר מוגדר
npm run seed:local              # יוצר נתוני דוגמה ב-data/
npm run dev                     # http://localhost:3000
```

> נתוני ה-seed הם **דוגמה ריאליסטית** (שכונות אמיתיות + מחירי מ"ר מקורבים). לנתונים אמיתיים — ראו "איסוף נתונים".

## איסוף נתונים אמיתיים (חודשי)

נתוני העסקאות של nadlan.gov.il מוגנים ב-**reCAPTCHA Enterprise** + הגבלת-קצב. לכן אוספים
אותם מראש ל-DB באמצעות דפדפן אמיתי (Playwright) שמנווט דרך החיפוש של האתר, פעם בחודש,
בקצב מנומס, לנתניה בלבד. ה-SPA פותר את ה-reCAPTCHA בעצמו ואנו מיירטים את תגובת `/deal-data`.

```bash
npm i -D playwright
npx playwright install chromium
npm run harvest                          # → data/deals.json (חלון דפדפן ייפתח)
# או, מול Supabase:
DATA_SOURCE=supabase npm run harvest
```

> ⚠️ **חובה להריץ על מחשב רגיל במצב גלוי (headed).** reCAPTCHA Enterprise נותן ציון נמוך
> לדפדפן headless וב-IP של דאטה-סנטר (ענן) ומחזיר 405 — האיסוף ייכשל שם. על מחשב ביתי
> עם חלון דפדפן גלוי זה עובר חלק. (`HARVEST_HEADLESS=true` רק לבדיקה — צפוי להיכשל בענן.)
>
> זרימת האיסוף: דף הבית → הקלדת שם שכונה בחיפוש → בחירת תוצאת "שכונה" → ה-SPA טוען את
> העסקאות (`POST /deal-data`, מקודד base64+gzip) → אנו מפענחים ומנרמלים ל-`lib/types.ts`.

## חיבור Supabase (פרודקשן)

1. צרו פרויקט ב-[supabase.com](https://supabase.com) (free tier).
2. הריצו את `supabase/schema.sql` ב-SQL Editor.
3. ב-`.env.local` (וב-Vercel): הגדירו `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, ו-`DATA_SOURCE=supabase`.
4. הריצו `DATA_SOURCE=supabase npm run harvest` לאכלוס העסקאות.

## התראות לידים

- **WhatsApp (Green API):** צרו אינסטנס ב-[green-api.com](https://green-api.com), חברו את הוואטסאפ שלכם ב-QR, והגדירו `GREEN_API_ID_INSTANCE`, `GREEN_API_TOKEN_INSTANCE`, `LEAD_NOTIFY_WHATSAPP` (הנייד שלכם, פורמט 9725XXXXXXXX).
- **גיליון Google:** העתיקו את `scripts/google-apps-script.gs` ל-Apps Script של הגיליון, פרסו כ-Web App, והדביקו את כתובת ה-/exec ב-`GOOGLE_SHEETS_WEBHOOK`.

שתי ההתראות הן best-effort — אם לא מוגדרות, הליד עדיין נשמר ב-DB.

## פריסה (Vercel)

```bash
npx vercel        # או חברו את הריפו ב-vercel.com
```
הגדירו את משתני הסביבה ב-Vercel Project Settings. הוסיפו דומיין מותאם.

## משפטי

מיועד למתווך/ת מורשה/ית. השווי מוצג כ**אינדיקציה** (לא הערכת שמאי). יש הסכמת דיוור מפורשת
(חוק התקשורת תיקון 40) ועמודי פרטיות/תנאים. מומלץ אימות מול עו"ד לפני העלייה לאוויר.
```
