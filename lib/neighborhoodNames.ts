/**
 * lib/neighborhoodNames.ts
 * שמות שכונות שקוצצו ל-20 תווים בכותרות הקטלוג של nadlan.gov.il (נתוני V2).
 * השם המלא נלקח מהשדה neighborhoodName בתגובות הגולמיות של האתר עצמו (audit/wave0g*),
 * ולא מנוחש. כשהשם המלא לא נמצא במקור — מסירים רק את המילה הקטועה.
 * מתוקן בזמן קריאה (store), כך שהנתונים בטבלאות ובקובץ ה-V2 הקפוא נשארים כפי שהם.
 */
const DISPLAY_NAMES: Record<string, string> = {
  "65209730": "נאות גנים (שיכון ותיקים)", // catalog: "נאות גנים - שיכון ות"
  "65210243": 'מע"ר - מרכז עירוני ראשי', // catalog: 'מע"ר - מרכז עירוני ר'
  "65210388": "אזור תעשיה קריית אליעזר קפלן", // catalog: "אזור תעשיה קריית אל"
  "65210387": "קריית יהלום", // catalog: "קריית יהלום - פארק ת" (full name not in any source)
};

export function neighborhoodDisplayName(id: string | null | undefined, name: string | null | undefined): string | null {
  return (id && DISPLAY_NAMES[id]) || name || null;
}

/** מחזיר עותק עם שם מתוקן, או את אותו אובייקט כשאין מה לתקן */
export function withNeighborhoodName<T extends { neighborhoodId?: string | null; neighborhood?: string | null }>(d: T): T {
  const fixed = d.neighborhoodId ? DISPLAY_NAMES[d.neighborhoodId] : undefined;
  return fixed && fixed !== d.neighborhood ? { ...d, neighborhood: fixed } : d;
}

export function withNeighborhoodTitle<T extends { id: string; name: string }>(n: T): T {
  const fixed = DISPLAY_NAMES[n.id];
  return fixed && fixed !== n.name ? { ...n, name: fixed } : n;
}
