/** מפתח האחסון והסקריפט המוקדם של תפריט הנגישות. קובץ רגיל (לא "use client"), כי ה-layout בצד השרת משתמש בסקריפט. */
export const A11Y_STORAGE_KEY = "a11y-prefs";

/** הגדרות המבקר. מדרגות (0–2) לטקסט ולגובה שורה, השאר מתג. */
export type A11yPrefs = {
  text: 0 | 1 | 2;
  lh: 0 | 1 | 2;
  spacing: boolean;
  font: boolean;
  contrast: boolean;
  gray: boolean;
  links: boolean;
  motion: boolean;
};

export const A11Y_DEFAULTS: A11yPrefs = {
  text: 0, lh: 0, spacing: false, font: false, contrast: false, gray: false, links: false, motion: false,
};

/** ה-class שכל הגדרה שמה על <html> (העיצוב ב-globals.css, "a11y-"). */
export function a11yClasses(p: A11yPrefs): Record<string, boolean> {
  return {
    "a11y-text-1": p.text === 1,
    "a11y-text-2": p.text === 2,
    "a11y-lh-1": p.lh === 1,
    "a11y-lh-2": p.lh === 2,
    "a11y-spacing": p.spacing,
    "a11y-font": p.font,
    "a11y-contrast": p.contrast,
    "a11y-gray": p.gray,
    "a11y-links": p.links,
    "a11y-no-motion": p.motion,
  };
}

/** מחיל את ההגדרות השמורות לפני הציור הראשון, כדי שלא יהיה הבהוב. חייב להתאים ל-a11yClasses. */
export const A11Y_BOOT_SCRIPT = `try{var p=JSON.parse(localStorage.getItem("${A11Y_STORAGE_KEY}")||"{}"),c=document.documentElement.classList;if(p.text===1)c.add("a11y-text-1");if(p.text===2)c.add("a11y-text-2");if(p.lh===1)c.add("a11y-lh-1");if(p.lh===2)c.add("a11y-lh-2");if(p.spacing)c.add("a11y-spacing");if(p.font)c.add("a11y-font");if(p.contrast)c.add("a11y-contrast");if(p.gray)c.add("a11y-gray");if(p.links)c.add("a11y-links");if(p.motion)c.add("a11y-no-motion")}catch(e){}`;
