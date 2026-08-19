import { auth } from "@/auth";
import { NextResponse } from "next/server";

/**
 * מגן על /admin/* (פרט לדף הכניסה).
 *
 * משתמשים בעטיפת next-auth v5 `auth((req) => …)` — כאשר מועברת פונקציה,
 * next-auth מריץ אותה תמיד עם `req.auth` (ה-session או null), והפונקציה
 * אחראית במלואה על ההחלטה. לכן ה-bypass לפיתוח חייב לרוץ כאן במפורש.
 *
 * ה-bypass מגודר ב-NODE_ENV !== "production" ולכן לעולם אינו יוצר
 * נתיב fail-open בפרודקשן.
 */
export default auth((req) => {
  if (
    process.env.ADMIN_DEV_BYPASS === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    return NextResponse.next();
  }

  if (!req.auth) {
    const loginUrl = new URL("/admin/login", req.nextUrl.origin);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  // מגן על כל /admin/* פרט לדף הכניסה עצמו
  matcher: ["/admin/((?!login).*)"],
};
