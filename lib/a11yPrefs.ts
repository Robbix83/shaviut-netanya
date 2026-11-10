/** מפתח האחסון והסקריפט המוקדם של תפריט הנגישות. קובץ רגיל (לא "use client"), כי ה-layout בצד השרת משתמש בסקריפט. */
export const A11Y_STORAGE_KEY = "a11y-prefs";

export const A11Y_BOOT_SCRIPT = `try{var p=JSON.parse(localStorage.getItem("${A11Y_STORAGE_KEY}")||"{}"),c=document.documentElement.classList;if(p.text===1)c.add("a11y-text-1");if(p.text===2)c.add("a11y-text-2");if(p.contrast)c.add("a11y-contrast");if(p.links)c.add("a11y-links");if(p.motion)c.add("a11y-no-motion")}catch(e){}`;
