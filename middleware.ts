import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export async function middleware(req: NextRequest) {
  if (
    process.env.ADMIN_DEV_BYPASS === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    return NextResponse.next();
  }
  return (auth as (req: NextRequest) => Promise<NextResponse>)(req);
}

export const config = {
  // מגן על כל /admin/* פרט לדף הכניסה עצמו
  matcher: ["/admin/((?!login).*)"],
};
