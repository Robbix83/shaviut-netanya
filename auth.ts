import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAdminAuthorized } from "@/lib/adminAuth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  callbacks: {
    authorized: async ({ auth }) => !!auth,
    async signIn({ user }) {
      // הרשאת אדמין (fail-closed): אם ADMIN_EMAIL מוגדר — רק הוא מורשה;
      // אם אינו מוגדר — נחסם בפרודקשן, ומותר רק בפיתוח מקומי.
      return isAdminAuthorized(user.email, {
        adminEmail: process.env.ADMIN_EMAIL,
        isProduction: process.env.NODE_ENV === "production",
      });
    },
  },
  pages: {
    signIn: "/admin/login",
    error: "/admin/login",
  },
});
