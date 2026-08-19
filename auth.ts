import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  callbacks: {
    authorized: async ({ auth }) => !!auth,
    async signIn({ user }) {
      // אם ADMIN_EMAIL מוגדר — רק האדמין מורשה
      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail && user.email !== adminEmail) return false;
      return true;
    },
  },
  pages: {
    signIn: "/admin/login",
    error: "/admin/login",
  },
});
